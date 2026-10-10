#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dedupe_style.py —— 按风格清污染词（dedupe25d.py 的泛化版）

为什么要泛化
  旧脚本 dedupe25d.py 的词表与替换对硬编码在水墨上。套到别的风格会反向误伤：
    · 定格木偶轨：放过「丝滑 / 流畅 / 高光」，而那正是它要删的
    · 赛璐璐轨  ：删掉 shadow 与 highlight，而两段式阴影与高光是它的风格本体
    · 三渲二轨  ：删掉 shadow 与体积词，等于把三渲二删成 2D
    · 写实轨    ：它是「去立体」的，而写实轨要的就是体积
  所以词表必须由风格决定 —— 本脚本从 style-registry.json 的 dedupe_pairs 读。

词表来源（两级）
  1 注册表的 dedupe_pairs    —— 词级，通用，按风格取
  2 内置 LONG_REPL[style]    —— 长句级精调，实战积累，只有个别风格有

用法
  python dedupe_style.py <文件.md>                    # 只扫描报数
  python dedupe_style.py <文件.md> --fix              # 执行替换（默认备份 <名>.bak）
  python dedupe_style.py <文件.md> --style ink-wash-2d
  python dedupe_style.py <文件.md> --registry ../style-registry.json
  python dedupe_style.py <文件.md> --fix --aggressive # 连「删除型」词级替换也执行

style 的确定顺序
  1 --style 参数
  2 文件里搜【风格】<id> 或 # style_id: <id>
  3 都拿不到 -> 报错并列出注册表里可用的 id，不猜

注册表查找顺序
  --registry 参数 > 当前目录 style-registry.json > 文件同目录 style-registry.json
  > skill 的 references/style-registry.seed.json

作用区间（与旧脚本一致）
  含 `detailed_description:`  -> 只处理 H3 面正文段
  含 ``` 围栏                -> 只处理围栏内
  两者都没有                  -> 全文（会提示）

🔴 硬断言
  作用区间为空 -> 直接退出（退出码 2），不做任何替换。
  这条来自实打实的教训：曾经按围栏切分而文件里围栏已丢，替换全部作用在空集合上，
  报「替换 0 处」却看着像成功，白跑两轮。
"""
import io
import json
import os
import re
import shutil
import sys

# Windows 下 stdout 重定向到管道/文件时默认 cp936，本脚本会 print ⚠/❌，
# 不显式设 utf-8 会 UnicodeEncodeError。与其余 6 个脚本保持一致。
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = os.path.join(HERE, "..", "references", "style-registry.seed.json")

# ---------------------------------------------------------------- 内置长句精调
# 仅登记实战验证过的整句替换对。词级替换一律走注册表的 dedupe_pairs。
LONG_REPL = {
    "ink-wash-2d": [
        ("Hand-painted Chinese ink-and-wash 2D animation on xuan paper, in a quiet "
         "illustrated storybook register. Thin even ink outlines with occasional "
         "dry-brush breaks, flat watercolor washes that bleed slightly at their edges, "
         "no gradients, no rendered volume, no specular highlights. Large areas of bare "
         "paper read as sky and ground.",
         "A flat hand-painted Chinese ink-and-wash picture on xuan paper, held on one "
         "plane. Thin ink outlines with occasional dry-brush breaks; every area is one "
         "flat wash struck once. Light is not modelled, and the same flatness holds "
         "near and far. Large areas of bare paper read as sky and ground."),
        ("Hand-painted Chinese ink-and-wash 2D animation on xuan paper, in a quiet illustrated storybook register.",
         "A flat hand-painted Chinese ink-and-wash picture on xuan paper, held on one plane."),
        ("hand-painted Chinese ink-and-wash 2D animation on xuan paper",
         "a flat hand-painted Chinese ink-and-wash painting on xuan paper, held on one plane"),
        ("Chinese ink-and-wash 2D animation on xuan paper", "Chinese ink-and-wash picture on xuan paper"),
        ("in a quiet illustrated storybook register", "held on one flat plane"),
        ("no gradients, no rendered volume, no specular highlights",
         "Light is not modelled, and the same flatness holds near and far"),
        ("；无体积渲染、无渐变、无高光；", "；色块一次平涂、干后收硬边；"),
        ("；无体积渲染、无渐变、无高光。", "；色块一次平涂、干后收硬边。"),
        ("so the paper carries a warm glow", "so the paper holds one flat warm wash at its centre"),
        ("the paper carries a warm glow", "the paper holds one flat warm wash at its centre"),
        ("that stops well short of any glow on the ground",
         "that stays inside the paper and does not fall on the ground"),
        ("its heat drawn as a warm wash rather than a glow", "its heat drawn as one flat warm wash"),
        ("warm interior glow", "warm interior wash"),
        ("；色块一次平涂、干后收硬边；暗部提亮一档、降饱和一档。", "；色块一次平涂、干后收硬边。"),
        ("；色块一次平涂、干后收硬边；暗部提亮一档、降饱和一档；", "；色块一次平涂、干后收硬边；"),
        ("；暗部提亮一档、降饱和一档。", "。"),
        ("；暗部提亮一档、降饱和一档；", "；"),
        ("留白是一层独立的宣纸层，纸白天空不是空白、是有纸纹的宣纸层。",
         "纸白天空是有纸纹的宣纸面，与画面其余部分同在一个平面。"),
        ("留白是一层独立的宣纸层；日光柱是一层独立的水墨光柱，半透明、边缘有干笔断锋，后期可单独取出。",
         "留白与日光柱都画在同一个平面上，日光柱的边缘留干笔断锋。"),
        ("那片白是一层独立的宣纸层。", "那片白与画面同在一个平面。"),
        ("留白是一层独立的宣纸层。", "留白与画面其余部分同在一个平面上。"),
        ("院门外的白是一层独立的宣纸层，", "院门外是一片纸白，"),
        ("。绘本插画式的静态构图。", "。静态的架上绘画构图。"),
        ("The camera is locked off and pans slowly to the right at an even rate.",
         "The camera is locked off; the whole picture slides slowly to the left as one "
         "plane, every element at the same rate."),
        ("The camera is locked off and pans a little to the right.",
         "The camera is locked off; the whole picture slides a little to the left as "
         "one plane, every element at the same rate."),
        ("# Must not: 仅供人读，不进 H3 正文 —— 可读文字、字幕、水印、logo",
         "# Must not: 仅供人读，不进 H3 正文 —— 可读文字、字幕、水印、logo、三维体积感、"
         "体积光、渐变色阶、塑料高光与镜面反射、景深虚化、空气透视、视差位移、布料反光"),
    ],
}

# 通用扫描（不依赖风格，任何包都该过一遍）
GENERIC_SCAN = [
    ("风格路由词 `animation`", r"\banimation\b"),
    ("风格路由词 `illustrat|storybook`", r"illustrat|storybook"),
    ("否定句 风格类 no X",
     r"\bno (gradients|rendered volume|specular highlights|shading|depth of field|"
     r"motion blur|outline|shadows)\b"),
]

# ---------------------------------------------------------------- 工具
DD_HEAD = re.compile(r"^detailed_description:\s*$", re.M)
FENCE = re.compile(r"(?m)^\s*```[a-zA-Z]*\s*$")
STYLE_DECL = [
    re.compile(r"【风格】\s*([a-z0-9][a-z0-9-]*)"),
    re.compile(r"#\s*style_id\s*[:：]\s*([a-z0-9][a-z0-9-]*)"),
    re.compile(r"style_id\s*[:=]\s*[\"']?([a-z0-9][a-z0-9-]*)"),
]


def regions(s):
    """返回 ([(标签, 起, 止)], 区间种类)。"""
    out = []
    if DD_HEAD.search(s):
        for m in DD_HEAD.finditer(s):
            st = m.end()
            e = re.search(r"(?m)^[a-z_]+:\s*$|^---\s*$", s[st:])
            en = st + e.start() if e else len(s)
            out.append(("detailed_description", st, en))
        return out, "H3 面"
    marks = [m for m in FENCE.finditer(s)]
    if len(marks) >= 2:
        for i in range(0, len(marks) - 1, 2):
            out.append(("fence", marks[i].end(), marks[i + 1].start()))
        return out, "围栏正文"
    return [("whole", 0, len(s))], "全文"


def find_registry(arg, target):
    cands = []
    if arg:
        cands.append(arg)
    cands.append(os.path.join(os.getcwd(), "style-registry.json"))
    cands.append(os.path.join(os.path.dirname(os.path.abspath(target)), "style-registry.json"))
    cands.append(SEED)
    for c in cands:
        if c and os.path.exists(c):
            return c
    return None


def load_styles(path):
    d = json.load(io.open(path, encoding="utf-8"))
    return d.get("styles", {})


def infer_style(s, styles):
    for pat in STYLE_DECL:
        for m in pat.finditer(s):
            sid = m.group(1)
            if sid in styles:
                return sid, "文件声明"
    return None, None


def esc(w):
    return re.escape(w)


# ---------------------------------------------------------------- 主流程
def main():
    argv = sys.argv[1:]
    if not argv or argv[0].startswith("-"):
        print(__doc__)
        return 0
    target = argv[0]
    def opt(name):
        return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else None
    fix = "--fix" in argv
    aggressive = "--aggressive" in argv
    no_bak = "--no-backup" in argv
    sid_arg = opt("--style")
    reg_arg = opt("--registry")

    if not os.path.exists(target):
        print("文件不存在：%s" % target)
        return 2

    reg = find_registry(reg_arg, target)
    if not reg:
        print("找不到 style-registry.json，也找不到 skill 的种子文件。用 --registry 指定。")
        return 2
    styles = load_styles(reg)

    s = io.open(target, encoding="utf-8").read()

    sid, how = (sid_arg, "--style 参数") if sid_arg else infer_style(s, styles)
    if not sid:
        print("拿不到 style_id。文件里没有【风格】<id> 也没有 # style_id: <id>，且没给 --style。")
        print("注册表 %s 里可用的 id：" % reg)
        for k, v in styles.items():
            print("   %-22s %s  %s" % (k, v.get("display_name", ""), v.get("status", "")))
        return 2
    if sid not in styles:
        print("style_id「%s」不在注册表 %s 里。可用 id：" % (sid, reg))
        for k in styles:
            print("   " + k)
        return 2

    st = styles[sid]
    print("文件：%s" % target)
    print("风格：%s（%s）　来源：%s" % (sid, st.get("display_name", ""), how))
    print("注册表：%s" % reg)
    print("稳定性：%s　轨道：%s　维度：%s" % (
        st.get("stability", "-"), st.get("track", "-"), st.get("dimension", "-")))

    regs, kind = regions(s)
    inside = "\n".join(s[a:b] for _, a, b in regs)
    print("作用区间：%s，%d 段，%d 字符" % (kind, len(regs), len(inside)))
    if not inside.strip():
        print()
        print("🔴 作用区间为空 —— 切分没命中目标，替换会全部空转。先修切分再谈替换。")
        return 2
    print()

    # ---- 扫描项：风格 pairs + 通用 ----
    pairs = [tuple(p) for p in st.get("dedupe_pairs", []) if p and p[0]]
    items = [("词级 %s" % a, esc(a)) for a, b in pairs]
    items += GENERIC_SCAN

    print("=== 扫描（全文计数 / 作用区间内计数）===")
    need = 0
    for name, pat in items:
        a = len(re.findall(pat, s, re.I))
        b = len(re.findall(pat, inside, re.I))
        if b:
            need += 1
        flag = "  <-- 需处理" if b else ""
        print("  %-40s %5d / %5d%s" % (name[:40], a, b, flag))

    del_pairs = [(a, b) for a, b in pairs if not b]
    if del_pairs and not aggressive:
        print()
        print("  注：%d 条替换词为空（即「删除」），词级删除容易把句子删残，" % len(del_pairs))
        print("      默认只报不删。确认安全后加 --aggressive。")

    if not fix:
        print()
        print("（加 --fix 执行替换；区间内需处理项 %d 条）" % need)
        return 0

    # ---- 替换：先长句精调，再词级 ----
    longs = LONG_REPL.get(sid, [])
    out, pos, total, hits = [], 0, 0, {}
    for _, a, b in regs:
        seg = s[a:b]
        for old, new in longs:
            n = seg.count(old)
            if n:
                hits["[长句] " + old[:34]] = hits.get("[长句] " + old[:34], 0) + n
                total += n
                seg = seg.replace(old, new)
        for old, new in pairs:
            if not new and not aggressive:
                continue
            n = len(re.findall(esc(old), seg, re.I))
            if not n:
                continue
            hits["[词级] " + old[:34]] = hits.get("[词级] " + old[:34], 0) + n
            total += n
            seg = re.sub(esc(old), new, seg, flags=re.I)
        out.append(s[pos:a])
        out.append(seg)
        pos = b
    out.append(s[pos:])
    new_s = "".join(out)

    if not no_bak:
        shutil.copy2(target, target + ".bak")
    io.open(target, "w", encoding="utf-8", newline="\n").write(new_s)

    print()
    print("=== 替换 %d 处 ===" % total)
    for k, v in sorted(hits.items(), key=lambda x: -x[1]):
        print("  x%-4d %s…" % (v, k))

    regs2, _ = regions(new_s)
    after = "\n".join(new_s[a:b] for _, a, b in regs2)
    print()
    print("=== 复扫（作用区间内）===")
    bad = 0
    for name, pat in items:
        n = len(re.findall(pat, after, re.I))
        bad += n
        if n:
            print("  %-40s %5d" % (name[:40], n))
    print()
    print("合计残留：%d（目标 0）" % bad)
    return 0


if __name__ == "__main__":
    sys.exit(main())
