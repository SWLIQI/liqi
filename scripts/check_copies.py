#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
三副本同步机检（v5.44.0 · P2）

为什么要有这个脚本
------------------
v5.43.1 的 durFactor 只在主库落地，两个副本仍停在 v5.43.0，
结果是同一份 30s 包：主库不报 W-LENGTH-CAP、两副本误报。
而三处的自测都报 12/12 全绿——**漂移不会让任何一处报警**。
那一轮是靠人肉比对抓到的。这个脚本把人肉比对换成机检。

判什么
------
1. 副本的 scripts/ 是否与主库逐字节一致（不一致 = 判据分叉，ERROR）；
2. 副本的 references/ 是否与主库一致（副本自有文件除外，见 OWNED_BY_COPY）；
3. 副本 SKILL.md 的底座版本是否与主库一致（crew 跟随主库；liqi专家团 用自有版本线，
   改看它横幅里声明的底座版本）。

四态口径（与本库一致）
----------------------
* 副本不存在 → WARN「跳过」（不是通过）；
* 比对通过   → 通过；
* 不一致     → ERROR（判据分叉是真缺陷，不是建议项）。

用法
----
    python scripts/check_copies.py                 # 自动发现副本
    python scripts/check_copies.py --json          # CI 用
退出码：0 = 全部一致；1 = 有不一致；2 = 输入不可用（主库路径找不到）。
"""
import argparse
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                 # 主库根（目录名已不参与身份判定）
SKILLS_DIR = os.path.dirname(ROOT)
USER_DIR = os.path.dirname(SKILLS_DIR)

# 副本定位（v6.0.0 修正）
#
# 旧版把副本路径写成「ROOT 的兄弟目录」，前提是主库在 ~/.workbuddy/skills/ 下。
# 主库搬到桌面后，SKILLS_DIR 变成 Desktop，于是跑去 C:\Users\张\Desktop\liqi专家团 找副本，
# 找不到就报「单副本环境，不适用」——又一次退化成假绿。副本的真实位置与主库放哪儿无关，
# 所以改成按固定安装位搜索，并额外 glob 插件目录（市场名可能不是 my-experts）。
def _home_workbuddy():
    return os.path.join(os.path.expanduser("~"), ".workbuddy")


def _find_copies():
    root_dir = os.path.join(_home_workbuddy(), "skills")
    crew_roots = []
    for base in (os.path.join(_home_workbuddy(), "plugins", "marketplaces"),
                 os.path.join(_home_workbuddy(), "plugins")):
        if not os.path.isdir(base):
            continue
        try:
            for mp in sorted(os.listdir(base)):
                for rel in (("plugins", "liqi-crew", "skills", "liqi-crew-orchestrator"),
                            ("liqi-crew", "skills", "liqi-crew-orchestrator")):
                    p = os.path.join(base, mp, *rel)
                    if os.path.isdir(p):
                        crew_roots.append(p)
        except OSError:
            pass
    return [
        ("liqi专家团", [os.path.join(root_dir, "liqi专家团"),
                    os.path.join(SKILLS_DIR, "liqi专家团")]),
        ("liqi-crew(插件)", crew_roots or [
            os.path.join(_home_workbuddy(), "plugins", "marketplaces", "my-experts", "plugins",
                         "liqi-crew", "skills", "liqi-crew-orchestrator")]),
    ]


# 去重后保留第一个存在的路径
def _first_existing(paths):
    for p in paths:
        if os.path.isdir(p):
            return [p]
    return paths[:1]


CANDIDATES = [(n, _first_existing(ps)) for n, ps in _find_copies()]

# 同名副本的可见性（v6.19.0）
#
# 实测事故：插件市场 `experts` 与 `my-experts` 各有一份 liqi-crew。_find_copies() 会把两份
# 都收进来，但 _first_existing() 只留第一份（按市场名排序，experts 在前），于是 my-experts
# 那份自 6.9.0 起再没人看过——而本脚本照样打印「三副本一致」。这是「假绿」的另一种形态：
# 不是没查，是查了另一份，还替被忽略的那份报了平安。
#
# 不改成多路径遍历：主循环里 label 同时是 owned 口径的键与报告的分组名，一份变多份会把
# 「专家团自有 7 份 references」这类语义搅乱，风险高于收益。改为**把被忽略的副本显式列出来**：
# 版本与主库一致 → info（看得见即可）；不一致 → WARN（有漂移就必须响）。
def _ver_of(root_dir):
    p = os.path.join(root_dir, "SKILL.md")
    if not os.path.isfile(p):
        return None
    m = re.search(r'^version:\s*["\']?([\d.]+)', open(p, encoding="utf-8").read(4000), re.M)
    return m.group(1) if m else None


def _all_existing(paths):
    return [p for p in paths if os.path.isdir(p)]


IGNORED_COPIES = []
for _n, _ps in _find_copies():
    if _n == "liqi专家团":
        continue  # 专家团用自有版本号（7.x），与主库不同号是设计如此，不做版本比对
    for _p in _all_existing(_ps)[1:]:
        IGNORED_COPIES.append((_n, _p, _ver_of(_p)))

# 副本自有文件：不参与一致性比对（团队自建，主库没有）
# 两副本的 7 份团队自建 references 同源同名，登记口径一致。
_TEAM_REFS = {
    "专家路由.md", "人设卡与关系网规范.md", "原子镜头契约.md",
    "情境选型与权重机制.md", "投喂闸门清单.md", "过审与平台红线.md",
    "配音与字幕规程.md",
}

OWNED_BY_COPY = {
    "liqi专家团": {"references": set(_TEAM_REFS), "scripts": set()},
    "liqi-crew(插件)": {"references": set(_TEAM_REFS), "scripts": set()},
}

# 主库身份判据（v6.0.0 修正）
#
# 旧版写死 MAIN_DIR_NAME = "超级liqi提示词"，靠「目录名等于这个字符串」认主库。
# 主库改名成 liqi-video-forge 之后，suite 16 从「真比对」退化成「不适用」——
# 打印一行 0 ERROR / 0 WARN 就收工，等于这项检查自我了下线，而全套仍报 16/16 全绿。
# 后果实测：两副本落后主库 11 个版本（5.44.1 / 7.3.0 底座），14 与 19 处 scripts 不一致，
# 无一处在报警。
#
# 改判据：目录名不是身份，语义才是身份。
#   ① 先排除「当前就在副本里」——副本自己当基准会把自有文件误判成缺失；
#   ② 再看 SKILL.md 的 name 是否 liqi 系——改名不改语义词，这条能跟着版本线一起走。
SKIP_NAMES = {"__pycache__", ".gates.jsonl", "decisions.jsonl", "liqi.json"}
SKIP_SUFFIX = {".pyc", ".jsonl"}


def copy_name_of(root):
    """当前目录若是已知副本，返回副本名；否则 None。"""
    r = os.path.realpath(root)
    for name, paths in CANDIDATES:
        for p in paths:
            if os.path.realpath(p) == r:
                return name
    return None


def skill_identity(root):
    """读 SKILL.md frontmatter 的 name。读不到返回 None。"""
    p = os.path.join(root, "SKILL.md")
    if not os.path.isfile(p):
        return None
    head = open(p, encoding="utf-8").read(4000)
    m = re.search(r"^name:\s*[\"']?([A-Za-z0-9._-]+)", head, re.M)
    return m.group(1) if m else None


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(65536), b""):
            h.update(b)
    return h.hexdigest()


def list_files(d):
    out = {}
    if not os.path.isdir(d):
        return out
    for name in sorted(os.listdir(d)):
        if name in SKIP_NAMES or name.startswith("."):
            continue
        p = os.path.join(d, name)
        if os.path.isfile(p):
            if os.path.splitext(name)[1] in SKIP_SUFFIX:
                continue
            out[name] = p
    return out


# 安装镜像（v6.19.1）
#
# 事故：WorkBuddy 实际加载的是 ~/.workbuddy/skills/<name>/ 这一份，而副本定位只找
# 「liqi专家团」与插件市场 crew——安装位不在候选里。于是桌面主库做到 6.18.0、
# 跑起来的还是 6.0.1，落后 18 个版本，所有机检一律 0/0。这不是「忘了同步」，
# 是**没有任何机制指向它**（sync_copies 也只遍历 CANDIDATES）。
#
# 三条设计取舍，都是为了避免重犯本脚本历史上踩过的坑：
#  ① 不写死目录名——按 SKILL.md 的 name 语义找同名目录（v6.0.0 的老教训：目录名不是身份）；
#  ② 不判方向——比**内容相等**（relpath→md5 全量），谁新谁旧让人看版本号判断。
#     单向「主库 → 镜像」隐含「主库永远新」，但真正被加载的是镜像，用户可能直接改镜像；
#  ③ 不排除自身——从哪边跑都拿另一边作对照，天然对称。
def _skill_name(path):
    p = os.path.join(path, "SKILL.md")
    if not os.path.isfile(p):
        return None
    head = open(p, encoding="utf-8").read(2000)
    m = re.search(r"^name:\s*[\"']?([A-Za-z0-9._\-\u4e00-\u9fff]+)", head, re.M)
    return m.group(1) if m else None


def find_install_mirrors():
    me = os.path.abspath(ROOT)
    mine = _skill_name(ROOT)
    if not mine:
        return []
    base = os.path.join(_home_workbuddy(), "skills")
    if not os.path.isdir(base):
        return []
    out = []
    for d in sorted(os.listdir(base)):
        p = os.path.join(base, d)
        if not os.path.isdir(p) or os.path.abspath(p) == me:
            continue
        if _skill_name(p) == mine:
            out.append(p)
    return out


def _tree_hash(root_dir):
    """relpath → md5。跳过 .git / __pycache__ / *.pyc / *.jsonl（运行时产物与门禁日志）。"""
    h = {}
    for cur, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in SKIP_NAMES and not d.startswith(".")]
        for name in files:
            if name in SKIP_NAMES or name.startswith("."):
                continue
            if os.path.splitext(name)[1] in SKIP_SUFFIX:
                continue
            p = os.path.join(cur, name)
            rel = os.path.relpath(p, root_dir).replace("\\", "/")
            try:
                with open(p, "rb") as f:
                    h[rel] = hashlib.md5(f.read()).hexdigest()
            except OSError:
                h[rel] = "<unreadable>"
    return h


def base_version_of(text):
    """从 SKILL.md 取底座版本。
    - crew：直接读 frontmatter 的 version（跟随主库）；
    - liqi专家团：读维护横幅里「同步到主库 vX.Y.Z」的声明。"""
    m = re.search(r"^version:\s*[\"']?([\d.]+)", text, re.M)
    frontmatter = m.group(1) if m else None
    # 取**最后一处**声明：维护横幅是累积留档，会同时写着历史同步过的旧版本号，
    # 取第一处会拿到过期的（实测：横幅里先写 v5.43.0、后写 v5.44.0，取首个会误判不一致）。
    hits = re.findall(r"同步到主库\s*v?([\d.]+)", text)
    return frontmatter, (hits[-1] if hits else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="CI：stdout 只输出 JSON")
    args = ap.parse_args()
    chatter = sys.stderr if args.json else sys.stdout

    if not os.path.exists(os.path.join(ROOT, "SKILL.md")):
        print("E-INPUT：主库路径找不到 SKILL.md —— %s" % ROOT, file=chatter)
        return 2

    # 只在主库里跑才有意义，但「主库」不能靠目录名认（改名就把检查废了）。
    def skip(msg, label):
        if args.json:
            print(json.dumps({"skipped": True, "reason": msg, "label": label}, ensure_ascii=False, indent=2))
        else:
            print("\nliqi 三副本同步检查\n")
            print("  ○ %s\n" % msg)
            print("合计：0 ERROR / 0 WARN —— 不适用（%s）\n" % label)
        return 0

    here_copy = copy_name_of(ROOT)
    if here_copy:
        return skip("当前目录是副本「%s」。三副本同步检查只在主库运行——"
                    "在副本里跑会把副本自己当基准，把副本自有文件误判成对方缺失。请到主库跑。"
                    % here_copy, "在副本里跑不具判定力")

    ident = skill_identity(ROOT)
    if not (ident and ident.lower().startswith("liqi")):
        return skip("当前目录的 SKILL.md name = %s，不是 liqi 系技能包（前置辨识失败）"
                    "——不是本检查的对象" % (ident or "（读不到）"), "非 liqi 系技能包")

    main_skill = open(os.path.join(ROOT, "SKILL.md"), encoding="utf-8").read()
    main_ver, _ = base_version_of(main_skill)
    main_scripts = list_files(os.path.join(ROOT, "scripts"))
    main_refs = list_files(os.path.join(ROOT, "references"))

    errors, warns = [], []
    info = []
    sections = []

    for label, paths in CANDIDATES:
        path = next((p for p in paths if os.path.isdir(p)), None)
        if not path:
            # 取舍说明：单副本（只装主库）是合法用法，不该被这条卡住；
            # 本脚本要抓的是「装了副本但漂移」，不是「没装副本」。
            # 所以这里记为 info 而非 ERROR/WARN——漂移必须报警，没装副本不必报警。
            info.append("%s：副本路径不存在，视为不适用（单副本环境）——%s"
                        % (label, " / ".join(paths)))
            continue

        owned = OWNED_BY_COPY.get(label, {"references": set(), "scripts": set()})

        # 0) owned 主文件身份守卫（v6.6.2 · 2026-10-28 覆盖事故立）
        # 事故：主库一次性同步脚本把 SKILL.md 复制进了 liqi专家团，其自有 SKILL.md（团队
        # 自版本号）被静默覆盖——owned 文件不参与比对，覆盖对机检完全不可见（本脚本盲区）。
        # 守卫：横幅型副本（自有 SKILL.md）的 frontmatter name 必须还是它自己；
        # 变成主库名 = 被覆盖，带恢复提示报 ERROR。
        skill_p = os.path.join(path, "SKILL.md")
        if os.path.isfile(skill_p) and label == "liqi专家团":
            head = open(skill_p, encoding="utf-8").read(4000)
            m_name = re.search(r"^name:\s*[\"']?([A-Za-z0-9._\-\u4e00-\u9fff]+)", head, re.M)
            got = m_name.group(1) if m_name else None
            if got is None or got == "liqi-video-forge":
                errors.append(
                    "%s：自有 SKILL.md 身份异常（name=%r，不应是主库名 liqi-video-forge）——owned 主文件疑似被主库内容覆盖。"
                    "恢复：目录内 SKILL.md.bak_* 取最新一份为底，重放版本号与维护横幅（见文件内事故留痕）"
                    % (label, got))

        # 1) scripts 逐字节
        their = list_files(os.path.join(path, "scripts"))
        diff_scripts = []
        for name, p in main_scripts.items():
            if name in owned.get("scripts", set()):
                continue
            if name not in their:
                diff_scripts.append("%s（副本缺）" % name)
            elif sha(p) != sha(their[name]):
                diff_scripts.append("%s（内容不一致）" % name)
        # 副本多出来的脚本（主库没有）
        extra = [n for n in their if n not in main_scripts and n not in owned.get("scripts", set())]

        # 2) references 逐字节
        their_refs = list_files(os.path.join(path, "references"))
        diff_refs = []
        for name, p in main_refs.items():
            if name in owned.get("references", set()):
                continue
            if name not in their_refs:
                diff_refs.append("%s（副本缺）" % name)
            elif sha(p) != sha(their_refs[name]):
                diff_refs.append("%s（内容不一致）" % name)

        # 3) 版本
        txt = open(os.path.join(path, "SKILL.md"), encoding="utf-8").read()
        their_ver, their_base = base_version_of(txt)
        ver_ok = (their_ver == main_ver) or (their_base == main_ver)

        sections.append({
            "copy": label,
            "path": path,
            "declared_version": their_ver,
            "declared_base": their_base,
            "scripts_diff": diff_scripts,
            "scripts_extra": extra,
            "refs_diff": diff_refs,
            "version_ok": ver_ok,
        })

        if diff_scripts:
            errors.append("%s：scripts 与主库不一致 %d 处 —— %s（判据分叉：同一份包在不同入口判罚不同，"
                          "且各自 12/12 全绿不会报警）"
                          % (label, len(diff_scripts), "、".join(diff_scripts[:6])))
        if diff_refs:
            errors.append("%s：references 与主库不一致 %d 处 —— %s"
                          % (label, len(diff_refs), "、".join(diff_refs[:6])))
        if not ver_ok:
            errors.append("%s：底座版本不一致（主库 %s ／ 该副本 version=%s 横幅底座=%s）"
                          % (label, main_ver, their_ver, their_base))
        if extra:
            warns.append("%s：副本多出主库没有的脚本 %s —— 确认是副本自建还是主库漏同步"
                         % (label, "、".join(extra[:5])))

    # 安装镜像：WorkBuddy 真正加载的那一份。此前完全不在视野内（见 find_install_mirrors 注释）。
    for mirror in find_install_mirrors():
        a, b = _tree_hash(ROOT), _tree_hash(mirror)
        only_a = sorted(set(a) - set(b))
        only_b = sorted(set(b) - set(a))
        diff = sorted(k for k in (set(a) & set(b)) if a[k] != b[k])
        try:
            mtext = open(os.path.join(mirror, "SKILL.md"), encoding="utf-8").read(2000)
            mm = re.search(r'^version:\s*["\']?([\d.]+)', mtext, re.M)
            mver = mm.group(1) if mm else "?"
        except OSError:
            mver = "?"
        if only_a or only_b or diff:
            sample = (only_a + diff)[:5]
            errors.append(
                "安装镜像与主库内容不一致 —— 主库 v%s ／ 镜像 v%s；镜像缺 %d 个、多 %d 个、内容不同 %d 个%s"
                % (main_ver, mver, len(only_a), len(only_b), len(diff),
                   ("（如 " + "、".join(sample) + "）") if sample else ""))
        else:
            info.append("安装镜像与主库逐文件一致（%d 个文件，版本 %s）——%s"
                        % (len(a), mver, mirror))

    stale_dup = [(n, p, v) for n, p, v in IGNORED_COPIES if v != main_ver]
    ok_dup = [(n, p, v) for n, p, v in IGNORED_COPIES if v == main_ver]
    if stale_dup:
        warns.append("同名的其他副本停在旧版本（本脚本只校验第一份，不会替它们报平安）：%s"
                     " —— 要么补同步，要么删掉旧市场残留；留着不管就会一直旧下去"
                     % "；".join("%s @ %s（version=%s）" % (n, p, v) for n, p, v in stale_dup))
    if ok_dup:
        info.append("同名的其他副本已与主库同版本（未逐文件比对）：%s"
                    % "；".join("%s @ %s" % (n, p) for n, p, v in ok_dup))

    if args.json:
        print(json.dumps({"main_version": main_ver, "sections": sections,
                          "errors": errors, "warns": warns},
                         ensure_ascii=False, indent=2))
    else:
        print("\nliqi 三副本同步检查 —— 主库 v%s\n" % main_ver)
        for s in sections:
            ok = not s["scripts_diff"] and not s["refs_diff"] and s["version_ok"]
            print("  %s %s（version=%s 底座=%s）"
                  % ("✅" if ok else "❌", s["copy"], s["declared_version"], s["declared_base"]))
            print("     scripts 差异 %d ／ references 差异 %d ／ 版本一致 %s"
                  % (len(s["scripts_diff"]), len(s["refs_diff"]),
                     "是" if s["version_ok"] else "否"))
            for d in s["scripts_diff"][:8]:
                print("       · scripts/%s" % d)
            for d in s["refs_diff"][:8]:
                print("       · references/%s" % d)
        if not sections:
            print("  ○ 没有找到任何副本——单副本环境，本项不适用")
        print("")
        for e in errors:
            print("  ❌ %s" % e)
        for w in warns:
            print("  ⚠️  %s" % w)
        for i in info:
            print("  ○ %s" % i)
        tail = ("有 ERROR，副本已漂移，同步后再交付" if errors
                else ("有一致性 WARN，值得看一眼（不是「全对」）" if warns
                      else ("三副本一致" if sections else "单副本环境，不适用")))
        print("\n合计：%d ERROR / %d WARN —— %s\n" % (len(errors), len(warns), tail))

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
