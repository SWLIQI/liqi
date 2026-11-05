#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
liqi 提示词包项目级审计（机械校验器之外的三项人工复核自动化）。

check_prompt.mjs 只查单镜格式合规；本脚本查跨镜与跨文档的问题：

  A. 台词一致性  —— 剧本原文台词是否与提示词包逐字对齐（用户铁律：台词一字不差）
  B. 资产锚覆盖  —— 每镜是否指定了参考图；引用的图名是否真实存在于资产库
  C. 角色描述漂移 —— 同一角色在不同镜的服装/外貌描述是否自相矛盾
  D. 时长一致性  —— 镜标题时长 vs # duration；是否超时长红线。**红线由锁①模型版本决定，
                   不是由块标题格式决定**（2.5：硬上限 30s / 滑窗阈值 20s；2.0：15s；
                   H3：15s）——见 SKILL.md「投放面参数总表」。
                   模型版本从包内【模型版本】声明读取，未声明则 --model 显式传，
                   都没有则按最严 15s 判并报 WARN（不静默放宽）
  E. 转场表完整  —— 相邻镜对的转场注记是否有缺漏
  F. 资产层纪律  —— 裸 HEX / 版本互锁双向 / 道具条目上限 / 身份判定字段存在性与枚举 /
                   未决（unresolved）禁落 outputs / **素材形态 M0·M1·M2 与图号一致性
                   （F7，v5.9.0）**。**F1 与 F7 不需要 --registry**
  G. 台账对账    —— 连续性台账（--ledger）与提示词包对账：持物矛盾 / 持物漏写 /
                   离手无落点 / 角色漏登 / 时段标签不一致 / 段号对不上 / 空账元检查。
                   **拿外部事实源核提示词**——与 C、C2 门（只在提示词内部找矛盾）互补
  N. 剧本量化门禁 —— 场序号连续性与唯一性（N1）/ 情节点密度（N2）/
                   改编稿事实权威链五级标注（N3）。**三条全是「没标就不算通过」口径**
  N4. 伏笔生命周期  —— 伏笔表（--foreshadow）：ID/状态枚举/回收时距；
                    **v5.20.0 扩**：反转分级 L1/L2/L3（E-FORESHADOW-LEVEL）+ 锚点数下限
                    （L2≥3 / L3≥4，W-FORESHADOW-ANCHOR）+ 大反转间距 ≤4 集
                    （W-FORESHADOW-GAP）。表行 5 列旧格式照常（级别默认 L1）
  N5/N6. 筹码账与尾钩链 —— 分集结构表（--epstruct，v5.20.0）：筹码四类枚举
                    （E-EPSTRUCT-TYPE）/尾钩四型枚举（E-EPSTRUCT-HOOKTYPE）/
                    空值三码全 WARN。规范见 references/尾钩与筹码账.md
  N3b. 改编转换表 —— 改编转换表（--adapttable，v5.20.0）：每集合规处理列非空
                    （W-ADAPT-COMPLIANCE）/爽点配方编号校验。见叙事层 §6.4b
  V. 元检查        —— 断言纪律（E-UNVERIFIED-CLAIM，v5.16.0）：包内出现通过性/能力性断言
                   却无任何校验结果痕迹 = ERROR。口径见 agent平台适配.md 铁律 3（不得声称
                   「已校验」），本门把它从「无脚本平台纪律」推广为全环境机械兜底；
                   段缝声明（E-SEAM-UNDECLARED，v5.16.0）：2.5/H3 面总时长超单条硬上限
                   （必须滑窗拆分成多个生成单元）却未锁【段缝声明】= ERROR。
                   **与 D0 / Z 同级：元检查，不计入十类**

用法：
  python audit_project.py <提示词包.md> [--script <剧本.txt>] [--assets <资产库目录>]
                          [--cast <角色名,角色名>] [--coverage] [--model <版本>] [--limit <秒>]
                          [--registry <asset-registry.json>] [--ledger <continuity-ledger.md>]

  --script    剧本纯文本（docx 需先转 txt；标准剧本格式：角色名独占一行、可选语气行、台词行）
  --assets    参考图目录，用于校验图名是否真实存在
  --cast      剧本角色名，逗号分隔（用于识别台词）。不传时自动从提示词包的「人物：」行与 @锚点
              收集；收集不准再显式传入
  --coverage  额外统计剧本台词被提示词包的采用率（含动作描写误判，仅供参考）
  --model     锁①模型版本：2.5 / 2.0 / h3（大小写与写法均可）。不传则读包内
              【模型版本】声明；包里也没声明时按最严 15s 判并报 WARN
  --limit     单镜时长硬上限，覆盖 --model 推出的值（临时核对用；正式跑别传，
              传了等于绕过「红线由模型版本决定」这条口径）
  --auto      **门禁默认化（v5.24.0 推荐默认开）**：就近自动挂载
              asset-registry.json / continuity-ledger.md / decisions.jsonl / 伏笔表 /
              分集结构表 / 改编转换表 / 剧本，并打印《门禁覆盖矩阵》。
              只填空值、不覆盖手动输入。**这条是治「门禁名义存在、实际不跑」的**——
              不传 opt-in 一律跳过，绿了也不代表查过。
              A / C / D2 / F / G / N3b / N4 / N5-N6 共十来门都靠它才有输入。
              要一次跑全部门禁（含 node 侧），用 `python scripts/audit_all.py <包>`。
  --adapt     本项目是改编（小说 / 网文 / 大纲 / 已有剧本）。开 N3：全剧 0 处
              FACT/INFERENCE/ASSUMPTION/USER_OVERRIDE/OPEN_ITEM 标注 → 报「无法核对」
  --epstruct  分集结构表 .md（见 references/尾钩与筹码账.md §三）。N5/N6 门核对筹码四类枚举、
              尾钩四型枚举与下集回收非空——多集项目（A3 且 ≥2 集）建议给
  --adapttable 改编转换表 .md（见 叙事层_剧本门控与台词.md §6.4b）。N3b 门核对每集合规处理列非空
  --ledger    连续性台账 .md（规范见 references/连续性台账.md）。G 门拿它逐段核提示词：
              台账记持刀而包内写空手 = G1 ERROR；持物变了却没变更行 = G3 ERROR；
              包内点名了台账没登的人 = G4 WARN；时段标签不一致 = G5 ERROR。
              不给则 G 门跳过（不报 OK）

退出码：0 = 全部通过；1 = 有 ERROR；2 = 只有 WARN
"""
import argparse
import difflib
import io
import json
import os
import re
import sys

from gates_log import append_gate_log, log_disabled
import liqi_config

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

RESET = '\033[0m'
RED = '\033[31m'
YEL = '\033[33m'
GRN = '\033[32m'
DIM = '\033[90m'   # 「未查」用灰：它既不是错（红）也不是警告（黄），是「本门没跑」


def color(s, c):
    return c + s + RESET if sys.stdout.isatty() else s


# 与 check_prompt.mjs 及 SKILL.md Step 3 第 1 条对齐：
#  1. 「镜」与镜号之间允许零个或多个空白（旧版要求恰好一个空格）
#  2. 时长括号允许带副标题「（15s · 动作）」——旧版写成「（\d+s）」要求括号内只有秒数，
#     导致带副标题的镜块整块识别不到（实测报「块数 0」）
# 时长允许小数：实测存在「段 5｜第一幕·拾灵上（28.5s）」这类写法，
# 旧版只认整数会整块漏掉（37 段只识别出 35 段）。
#  3. 编号兼容三种面：`镜 N`（分镜面）／`段 N`（liqi 整合段面）／`U01`（MiniMax H3 面）。
#  4. 标题里常含场景括注（「场 1 · 某处庙宇前殿（日）· 拾香（14s）」）。
#     旧正则 `[^\n（]*?` 会卡在标题里第一个「（」上直接匹配失败——
#     H3 面 57 个单元只认出 6 个（实测报「镜数 6」，且被误读成「通过」）。
#     故改为：在标题行内取**最后一个**含秒数的括注作为时长。
SHOT_HEAD_RE = re.compile(r'^#{0,6}\s*(?:镜|段|U)\s*(\d+[A-Za-z]?)｜(.*)$')
SHOT_DUR_RE = re.compile(r'（\s*(\d+(?:\.\d+)?)\s*s[^）]*）')
CAST_LINE_RE = re.compile(r'^（[^）]*）$')


def dur_num(s):
    """时长转数值：整数秒返回 int，小数秒返回 float（28.5s 这类写法要原样保留）"""
    f = float(s)
    return int(f) if f == int(f) else f


def split_shots(text):
    """按镜切块，返回 [(镜号, 标题, 秒数, 块内容), ...]"""
    out = []
    for p in re.split(r'\n(?=#{0,6}\s*(?:镜|段|U)\s*\d+[a-z]?｜)', text):
        head = p.split('\n', 1)[0]
        m = SHOT_HEAD_RE.match(head)
        if not m:
            continue
        durs = list(SHOT_DUR_RE.finditer(m.group(2)))
        if not durs:
            continue
        last = durs[-1]
        out.append((m.group(1), m.group(2)[:last.start()].strip(),
                    dur_num(last.group(1)), p))
    return out


# 正文边界：与 check_prompt.mjs 保持一致（Must not / 参数行 / 分隔线 / 技术规格）
# 参数行标记支持两种写法：`# duration`（旧）与 `【参数】duration`（去 Markdown 符号后）
BODY_END_RES = [
    re.compile(r'^Must\s*not', re.I),
    re.compile(r'^(?:#|【参数】)\s*(duration|ratio|输出规格|后期)'),
    re.compile(r'^——\s*以下不进正文'),
    re.compile(r'^技术规格[：:]'),
]

# 参考素材引用（v5.37.2 · MA-5）：官方 2.5 示例写 `@图像1`（role=reference_image），
# liqi 旧写法是 `@图片1`，两种都数；只数去重后的编号（@图片3 出现三次仍是 1 张）。
REF_RES = {
    'image': re.compile(r'@\s*(?:图片|图像|Image|image|IMAGE)\s*[_#－-]?\s*(\d+)'),
    'video': re.compile(r'@\s*(?:视频|Video|video|VIDEO)\s*[_#－-]?\s*(\d+)'),
    'audio': re.compile(r'@\s*(?:音频|Audio|audio|AUDIO)\s*[_#－-]?\s*(\d+)'),
}


def body_of(block):
    """
    只取可复制正文 = 第一个代码块围栏内的内容。

    提示词正文都在 ``` 里，第一个围栏闭合即正文结束。之后的内容（跨镜说明、
    对照表、文档注释）不算正文，不该参与台词比对与正文扫描。

    兼容无围栏的写法：没有围栏时退化为「到 Must not / 参数行为止」。
    """
    out, in_code = [], False
    for l in block.split('\n'):
        if l.strip() == '```':
            if in_code:
                break          # 第一个代码块闭合 → 正文结束
            in_code = True
            continue
        if any(r.match(l) for r in BODY_END_RES):
            break
        out.append(l)
    return '\n'.join(out)


def norm(s):
    return re.sub(r'\s+', '', s)


def shot_key(s):
    m = re.match(r'(\d+)([a-z]?)', s)
    return (int(m.group(1)), m.group(2))


# ---------------------------------------------------------------- A. 台词
SCENE_RE = re.compile(r'^(?:外景|内景|场景|场|第\s*[一二三四五六七八九十百零\d]+\s*场)')


def _is_action_line(s):
    """
    动作描写行 vs 台词行的启发式判定。
    剧本里台词与动作描写常紧邻排布且无空行分隔，无法 100% 区分，
    这里只对「明显是动作描写」的行判 True（宁可放过，不可错杀）：
      - 以第三人称作主语且句中无对话语气标记（…… ？ ！ 「」）
      - 或整行为舞台/镜头指示（xx 看着 yy。／镜头……／画面……）
    """
    if re.search(r'[？?！!…「」“”]', s):
        return False
    if re.match(r'^(?:镜头|画面|切|淡入|淡出|特写|全景|中景|近景)', s):
        return True
    # 「她走进来了。」「县令皱眉。」这类：主语 + 单个谓词，且句中无第二人称/逗号停顿
    if re.match(r'^(?:她|他|它|她们|他们|它们)[^，,。]{0,10}(?:着|了|过|起|下|上|进|出|回|来|去)[^，,。]{0,8}[。.]?$', s):
        return True
    if re.match(r'^[一-龥]{2,4}(?:皱眉|抬头|点头|摇头|低头|转身|沉默|不语|看着|看着她|看着他)[^，,]{0,6}[。.]?$', s):
        return True
    return False


def extract_script_dialogues(path, cast):
    """
    从标准格式剧本提取台词：(说话人, 语气, 台词)

    支持同一角色连续多行台词（旧版只取第一行，会漏台词）。
    收集范围：角色名（+可选语气行）之后，直到空行 / 下一个角色名 / 场景头 / 分隔线为止，
    其中被 _is_action_line 判为动作描写的行跳过。
    """
    lines = [l.rstrip() for l in open(path, encoding='utf-8')]
    out = []
    i = 0
    while i < len(lines):
        if lines[i].strip() in cast:
            sp = lines[i].strip()
            j = i + 1
            tone = ''
            if j < len(lines) and CAST_LINE_RE.match(lines[j].strip()):
                tone = lines[j].strip()
                j += 1
            k = j
            got = []
            while k < len(lines):
                s = lines[k].strip()
                if not s:
                    break
                if s in cast:
                    break
                if SCENE_RE.match(s) or s.startswith('—'):
                    break
                if CAST_LINE_RE.match(s):
                    k += 1
                    continue          # 中途插入的语气行：跳过，继续收
                if _is_action_line(s):
                    k += 1
                    continue          # 动作描写：跳过
                got.append(s)
                k += 1
            for s in got:
                out.append((sp, tone, s))
            i = k if k > j else j + 1
            continue
        i += 1
    return out


# 台词判定：必须含标点，或长度 >= 10。
# 「」/{} 在 liqi 包里不只装台词，还装资产名、角色名、场景名、匾额字
# （例：关键道具 / 骨簪 / 主要角色 / 静室 / 文士），无标点短串一律视为标注而非台词。
DIALOG_PUNCT_RE = re.compile(r'[，。？！…、；：,?!]')


def _is_dialogue(s):
    if len(s) < 2:
        return False
    return bool(DIALOG_PUNCT_RE.search(s)) or len(s) >= 10


def _script_sentences(path):
    """把剧本切成句子，用于给包内台词找最相近的原文（不依赖结构化提取，避免漏台词）"""
    t = open(path, encoding='utf-8').read()
    t = re.sub(r'^[—\-=·\s]{3,}$', '', t, flags=re.M)   # 去掉分隔线
    out = []
    for s in re.split(r'[。？！；\n]', t):
        n = norm(s)
        if len(n) >= 6:
            out.append(n)
    return out


def audit_dialogue(pkg_text, script_path, cast, shots=None, coverage=False):
    """
    台词一致性双向检查。

    方向 1（ERROR 级，主检查）：包内台词 → 剧本。
      铁律是「写进提示词的台词必须与剧本一字不差」，所以查的是包，不是剧本。
      旧实现反过来查（剧本 → 包），依赖剧本结构化提取的完整性，
      一旦剧本有连续多行台词就会漏提，继而产生大量错位误报。
      本方向直接用剧本全文做子串匹配，不受提取质量影响。

    方向 2（WARN 级，辅检查）：剧本台词 → 包内。
      未出现只提示「可能漏拍」，不报错——不是每句剧本台词都必须进画面。

    相似度用 difflib 整体比值，不用公共前缀（旧实现用前缀，
    相似度 0.18 的两句话也会硬配对，报告完全不可信）。
    """
    errors, warns = [], []
    dialogues = extract_script_dialogues(script_path, cast)

    # 假绿闸门（v4.7.3 实战补）：extract_script_dialogues 只认「角色名独占一行」的标准格式。
    # 喂纯文本剧本会抽出 0 条台词，于是方向 1 的逐句比对仍能过（它用的是全文子串匹配，
    # 不依赖结构化提取），整道门报 OK——实测某志怪剧本 docx 直出就是这样一声不吭地放行。
    # 0 条必须先拦下来，否则这道门等于没跑。
    if not dialogues:
        errors.append('剧本台词抽取为 0 条：--script 需要标准格式（角色名独占一行 → 可选语气行 → 台词行）。'
                      '纯文本/docx 直出请先转：extract_script_docx.py <剧本.docx> --std -o 剧本_标准.txt'
                      '（角色名自动识别不准时加 --cast 名字1,名字2）')

    # 只从「可复制正文」提取，排除文档层（转场表、对照表、说明行）
    if shots:
        scan_text = '\n'.join(body_of(b[3]) for b in shots)
    else:
        scan_text = pkg_text

    # 台词符号双兼容：liqi 旧面「」、Seedance 2.5 面 {}
    #
    # 必须要求引号前紧邻「归属冒号」（`角色（语气）：{台词}` / `：「台词」`）。
    # 不能裸扫所有 「」/{} —— liqi 包的【生成目标】【保真预算】【必锁】【可见性】
    # 等段落大量用「」引述剧本原文的动作描写（例：「变软发皱、像泡涨窗纸」
    # 「走三步、停下、回头、又走」），裸扫会把这些描写当台词去比对剧本，
    # 一次跑出十几条假 ERROR（实测 12 条里 11 条是这么来的）。
    # 台词在包内铁律要求三写（时间轴 + 镜行尾 + 声音设计）；本门机械校时间轴 + 声音设计两处，两处都是 `：{台词}`，
    # 所以加了这个前置冒号不会漏掉任何真台词。
    raw_q = [m.group(1) for m in re.finditer(r'[：:]\s*[「{]([^」}]{2,})[」}]', scan_text)]
    pkg_q, seen = [], set()
    for q in raw_q:
        n = norm(q)
        if n and n not in seen and _is_dialogue(n):
            seen.add(n)
            pkg_q.append(n)

    script_raw = open(script_path, encoding='utf-8').read()
    blob = norm(script_raw)          # 剧本全文（去空白），用于一字不差的子串命中
    sents = _script_sentences(script_path)

    # ---------------- 方向 1：包内台词必须在剧本里找得到 ----------------
    for q in pkg_q:
        if q in blob:
            continue                                   # 一字不差，通过
        # 跨镜拆分：整句是剧本某句的连续片段
        if any(q in s and len(q) >= 4 for s in sents):
            warns.append(f'台词为剧本原句片段（跨镜拆分，可接受）：「{q[:24]}…」')
            continue
        best, bestr = 0.0, ''
        for s in sents:
            r = difflib.SequenceMatcher(None, q, s).ratio()
            if r > best:
                best, bestr = r, s
        # 首个差异位置
        k = 0
        for x, y in zip(q, bestr):
            if x != y:
                break
            k += 1
        if best >= 0.95:
            warns.append(f'台词与剧本存在用字/标点微差（相似度 {best:.0%}）：\n'
                         f'    包内：{q[:60]}\n'
                         f'    剧本：{bestr[:60]}\n'
                         f'    第 {k} 字后开始不同')
        elif best >= 0.60:
            errors.append(f'台词疑似改写（相似度 {best:.0%}）：\n'
                          f'    包内：{q[:60]}\n'
                          f'    剧本：{bestr[:60]}\n'
                          f'    第 {k} 字后开始不同')
        else:
            errors.append(f'台词在剧本里找不到对应（相似度仅 {best:.0%}）：「{q[:60]}」\n'
                          f'    最相近的剧本原文：{bestr[:60]}')

    # ---------------- 方向 2：剧本台词是否被包采用（默认关闭） ----------------
    # 剧本里台词与动作描写常紧邻排布且无空行分隔，无法 100% 自动区分，
    # 这一路必然带噪声（实测会把动作描写当台词，覆盖率数字不可信），
    # 因此默认不跑，需要粗看漏拍情况时用 --coverage 打开。
    if coverage:
        joined = '|'.join(pkg_q)
        missed = []
        for sp, tone, raw in dialogues:
            n = norm(raw)
            if not n or n in joined:
                continue
            if any(n in q or q in n for q in pkg_q):
                continue
            missed.append(f'{sp}「{raw[:28]}」')
        if missed:
            warns.append(f'[参考] 剧本有 {len(missed)}/{len(dialogues)} 条台词未出现在提示词包'
                         f'（含动作描写误判，仅供参考）：' + '；'.join(missed[:5]) +
                         ('…' if len(missed) > 5 else ''))

    return dialogues, errors, warns


# ------------------------------------------------------------ B. 资产锚
def audit_assets(pkg_text, assets_dir, shots):
    """
    首帧锚覆盖：兼容三种写法
      - `# 首帧参考：<图名>`（早期写法）
      - `【参考素材职责】` 内逐行 `@图片N用于X，不采用Y`（liqi 终稿格式）
      - `# refs: 5（Subject 1 / 2 / …，上限 12）`（MiniMax H3 面 Ref2VA 写法）
    只认第一种会让整个终稿格式的包误报「全部块未指定首帧参考」（实测 62/62 全中）；
    不认 `# refs` 会让 H3 面的包同样全数误报（实测 57/57 全中）。
    """
    errors, warns = [], []
    # v6.19.7 修系统性误报：原式只认 `首帧参考：`（全角冒号）与 `@图片N`（2.5 面写法），
    # 而 **2.0 面**的参数行是 `# 首帧参考: 图1 …`（半角冒号）+ `# 投喂图序（…）：图1=…`。
    # 后果：全部 2.0 面存量包（实测 EP01/EP05/EP21）一律误报「全部块未指定首帧参考」，
    # 而 2.5 面因用 `@图片N` 不受影响——同一条判据对两个面判罚不同，正是本包最忌的「判据分叉」。
    ANCHOR_RE = re.compile(r'(?:#|【参数】)\s*首帧参考\s*[：:]'
                           r'|(?:#|【参数】)\s*投喂图序'
                           r'|【参考素材职责】'
                           r'|(?:#|【参数】)\s*refs\s*[：:]'
                           r'|@(?:图片|视频|音频)\d'
                           r'|图\d+\s*=')
    missing = [(num, title) for num, title, dur, body in shots
               if not ANCHOR_RE.search(body)]
    if missing and len(missing) == len(shots):
        warns.append('全部块未指定首帧参考（纯文生视频流水线可忽略；走 I2V 时需逐块补）')
    else:
        for num, title in missing:
            warns.append(f'块{num} {title} 未指定首帧参考（I2V 时不知道喂哪张图）')

    if not assets_dir:
        return errors, warns
    if not os.path.isdir(assets_dir):
        errors.append(f'资产库目录不存在：{assets_dir}')
        return errors, warns

    avail = {os.path.splitext(f)[0] for f in os.listdir(assets_dir)
             if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))}
    used = set(re.findall(r'「([^」]+)」\s*图', pkg_text))

    for x in sorted(used - avail):
        errors.append(f'引用了资产库里没有的图：「{x}」——生成时会找不到参考')
    for x in sorted(avail - used):
        warns.append(f'资产图未被任何镜引用：「{x}」')
    return errors, warns


# ------------------------------------------------------------ B2. 场景图覆盖（v6.19.5）
# 立这条的起因（2026-11-05 复盘）：实战出现「12 段无场景参考图」——每段都挂了角色图，
# 于是 B 门的 ANCHOR_RE 每块都能命中（它只查「有没有参考图声明」），一路绿灯放行；
# 但缺的是**场景族**那一张，模型只能凭文字猜空间，跨段接不上。
#
# 为什么单查场景族（S 编号）不查角色族：场景是每段必有的公共前提，且「一段一个场景」
# 边界清晰；角色族有群像锚（C09–C11 一类一个编号对多人）、剪影态、马甲态，
# 映射歧义大，写死会大面积误报。先把零歧义的那一半补上。
def audit_scene_shot_coverage(pkg_text, registry=None, shots=None):
    """每段必须挂一张「本段场景」的参考图（按注册表 entry_no 判定）。"""
    errors, warns = [], []
    if not registry or not os.path.isfile(registry):
        return errors, []
    try:
        d = json.load(io.open(registry, encoding='utf-8'))
    except Exception:
        return [], []
    scenes = {}
    for _slug, v in (d.get('scenes') or {}).items():
        nm = (v or {}).get('display_name')
        en = (v or {}).get('entry_no')
        if nm and en:
            scenes[nm] = en
    if not scenes or not shots:
        return [], []

    for num, title, dur, body in shots:
        m = re.search(r'场景[：:]\s*([^\n｜|（(]+)', body)
        if not m:
            continue                       # 没有场景行 → 由 C3 的「找不到场景行」负责，这里不重复报
        name = m.group(1).strip()
        hits = [n for n in scenes if n in name or name in n]
        if len(hits) != 1:
            continue                       # 场景名匹配不上 → C3 已报，不叠加噪声
        en = scenes[hits[0]]
        if en not in body:
            warns.append('段%s「%s」未挂场景 %s（%s）的参考图 —— 该段只挂了角色图时 B 门照样绿灯，'
                         '模型只能凭文字猜空间，跨段接不上' % (num, title, en, hits[0]))
    return errors, warns


# ------------------------------------------------------------ C. 角色漂移
def load_rules_from_registry(path):
    """从 asset-registry.json 生成互斥规则（角色与道具）。

    两种资产各取一种版本容器：
      characters.*.versions.*.codename  → 版本名（「素白中衣」/「藕荷衣裙」）
      props.*.state_arc.current/other_states → 态名（「展开可读态」/「卷起封存态」）
    每条 rule 的 sets 即上面各版本各自的词集；某镜同时命中**每个**词集 → 串版。

    ⚠️ 场景不走这里——场景的判定语义不同（「声明时段 × 该时段禁写词」，
    而不是「两个版本名同现」），由下面的 load_scene_variant_rules +
    audit_scene_variants 单独处理（v5.6.3）。
    """
    import json
    try:
        data = json.load(io.open(path, encoding='utf-8'))
    except Exception as e:
        raise SystemExit('读注册表失败：%s' % e)
    rules = []

    # 角色：版本名互为词集
    for slug, ch in (data.get('characters') or {}).items():
        vers = ch.get('versions') or {}
        names = [v.get('codename') for v in vers.values() if v.get('codename')]
        if len(names) >= 2:
            rules.append((ch.get('display_name') or slug, [[n] for n in names]))

    # 道具：状态弧的态名互为词集
    for slug, pr in (data.get('props') or {}).items():
        arc = pr.get('state_arc') or {}
        names = [s for s in [arc.get('current')] + list(arc.get('other_states') or []) if s]
        if len(names) >= 2:
            rules.append(((pr.get('display_name') or slug) + '（道具状态）',
                          [[n] for n in names]))

    return rules


# ------------------------------------------------------------ C2. 场景时段漂移
# 声明行：时段写在这几行里才算「本镜声明了哪个时段」。
# 只认冒号开头的字段行，避免正文叙述（「他想起那日正午…」）被误判成声明。
DECL_LINE_RE = re.compile(
    r'^\s*(?:场景|时间线锚点|时间锚点|时段|时间|光源|氛围|环境)\s*[：:]')


def load_scene_variant_rules(path):
    """从注册表载入场景时段变体规则。

    返回 [(场景名, {时段标签: [该时段禁写词...]}, [slug...], [全项目时段标签...]), ...]

    时段标签的来源：优先取 lighting_anchors.<时段>.label（如 noon→「正午」），
    缺失时退化为时段键本身（`noon`）。两种写法都认，因为提示词里
    既可能写「时间线锚点：正午」，也可能直接写 `noon`。

    第 4 项是该场景**未登记**的全项目时段标签，用来抓「剧本这场是黄昏、
    但注册表只建了正午/深夜」这类缺口。
    """
    import json
    try:
        data = json.load(io.open(path, encoding='utf-8'))
    except Exception as e:
        raise SystemExit('读注册表失败：%s' % e)
    anchors = data.get('lighting_anchors') or {}

    def labels_of(keys):
        out = {}
        for k in keys:
            lab = (anchors.get(k) or {}).get('label') or k
            out[lab] = k
            if k != lab:
                out.setdefault(k, k)
        return out

    all_labels = labels_of(list(anchors.keys()) or [])
    out = []
    for slug, sc in (data.get('scenes') or {}).items():
        variants = sc.get('variants') or {}
        if len(variants) < 2:
            continue
        by_label = {}
        for key, v in variants.items():
            lab = (anchors.get(key) or {}).get('label') or key
            words = [w for w in (v.get('lock_out') or []) if w]
            by_label[lab] = words
            if key != lab:                      # 英文时段键也作为可识别标签
                by_label.setdefault(key, words)
        if len(by_label) < 2:
            continue
        own = set(by_label)
        rest = [l for l in all_labels if l not in own]
        out.append((sc.get('display_name') or slug, by_label, [slug], rest))
    return out


def audit_scene_variants(pkg_text, shots, rules=None):
    """场景时段串版：**声明了某个时段，却写了该时段禁写的别版特征**。

    与 C 门（角色/道具）的语义不同，这是本次专门优化的地方：

      C  门（角色）：同一镜**同时出现两个版本名** → 串版
      C2 门（场景）：同一镜**声明了时段 T，又命中 T.lock_out 里的词** → 串版

    为什么场景必须换语义：场景的提示词通常**只写当前时段的光照描述，不会写时段名**，
    所以「两个版本名同现」几乎永不触发（v5.6.2 实测：召回极低）。而 lock_out 里
    记的正是「别版特征」，所以「声明 T + 命中 T 的禁写词」才是场景的正确判据。

    判定细节：
      · 声明只在 DECL_LINE_RE 认定的字段行里找（场景/时间线锚点/光源/氛围/环境），
        正文叙述不参与，避免误报；
      · 没声明时段 → 跳过（不猜，不误报）；
      · 声明了 ≥2 个时段 → 直接报「同时声明两个时段」（这本身就是矛盾）；
      · 声明了该场景**未登记**的时段 → 报 WARN（多半是注册表漏建变体）；
      · 命中词在整个镜块正文里搜。

    ⚠️ 召回取决于 lock_out 的**完备性**：T.lock_out 必须覆盖「其余变体的标志性特征」，
    只写一两条就会漏。本门对词数 < 3 的变体发 WARN 提示补齐。
    """
    errors, warns = [], []
    if not rules:
        warns.append(_skip_msg(
            '未配置场景时段变体规则',
            kind=SKIP_INPUT,          # 缺的是注册表里的配置，补配置即可
            hint='传 --registry <asset-registry.json> 且注册表里有 ≥2 个时段的 '
                 'scenes.*.variants 即可启用；规则从 variants.*.lock_out 自动生成'))
        return errors, warns

    # 互锁词过薄 → 召回到不了，先提示补齐（整包只提示一次）
    # 中英标签指向同一份词表（同一 list 对象），按 id 去重，避免「正午（2 条）、noon（2 条）」重复报
    thin = []
    seen_words = set()
    for scene_name, by_label, _slugs, _rest in rules:
        for lab, words in by_label.items():
            if id(words) in seen_words:
                continue
            seen_words.add(id(words))
            if len(words) < 3:
                thin.append('%s·%s（%d 条）' % (scene_name, lab, len(words)))
    if thin:
        warns.append('互锁词过薄：%s。C2 门按「声明时段 × 该时段 lock_out」判定，'
                     'lock_out 里没写到的别版特征就查不出来——'
                     '每个变体的 lock_out 要覆盖**其余所有变体**的标志性特征'
                     '（三维度：色温 / 光质 / 影子形态），建议每版 ≥3 条' % '、'.join(thin))

    for num, title, dur, body in shots:
        lines = body.split('\n')
        decl = '\n'.join(l for l in lines if DECL_LINE_RE.match(l))
        for scene_name, by_label, slugs, rest in rules:
            if scene_name not in body and not any(s in body for s in slugs):
                continue                        # 本镜不是这个场景
            declared = [lab for lab in by_label if lab in decl]
            if len(declared) >= 2:
                errors.append('块%s %s：同时声明了两个时段（%s）——一处场景只能是一个时段，'
                              '先确定这一镜到底是哪个时段'
                              % (num, title, ' × '.join(declared)))
                continue
            if not declared:
                # 没声明本场景已登记的时段；若声明了别的时段，多半是注册表漏建变体
                outside = [lab for lab in rest if lab in decl]
                if outside:
                    warns.append('块%s %s：声明「%s」，但该场景未登记「%s」变体——'
                                 '补建 variants 或改成本片确实有的时段'
                                 % (num, title, '、'.join(outside), '、'.join(outside)))
                continue
            lab = declared[0]
            hit = [w for w in by_label[lab] if w and w in body]
            if hit:
                errors.append('块%s %s：声明「%s · %s」，却写了该时段的禁写特征「%s」——串版。'
                              '按版本互锁词删掉不属于本版的那一个（三维度：色温 / 光质 / 影子形态）'
                              % (num, title, scene_name, lab, '、'.join(hit)))
    return errors, warns


def load_rules_from_file(path):
    """从 --versions 规则文件读，格式：
    [{"name": "角色A", "sets": [["素白中衣", "素白丝质中衣"], ["藕荷衣裙", "藕荷色衣裙"]]}]
    """
    import json
    try:
        data = json.load(io.open(path, encoding='utf-8'))
    except Exception as e:
        raise SystemExit('读版本规则失败：%s' % e)
    out = []
    for item in data:
        sets = [s for s in (item.get('sets') or []) if s]
        if len(sets) >= 2:
            out.append((item.get('name') or '未命名', sets))
    return out


def audit_character(pkg_text, shots, rules=None):
    """检查同一镜里是否同时出现互斥的版本特征（串版）。

    ⚠️ 2026-10-13 重写：旧版把判定词表**写死**成某一个项目的具体服装串
    （如「淡青绿/灰青色棉布长衫」），换任何项目都匹配不上，于是静默报 OK——
    这正是本 skill 第四条信念要堵的「假绿比漏检更危险」。
    现在规则必须外部配置，没配置就明确报「本门跳过」，**绝不报 OK**。

    rules: [(label, [[词集A...], [词集B...], ...]), ...]
           同一条 rule 里**每个**词集都命中至少一个词 → 判为串版。
    """
    errors, warns = [], []
    if not rules:
        warns.append(_skip_msg(
            '未配置版本互斥词表',
            kind=SKIP_INPUT,          # 缺的是注册表里的配置，补配置即可
            hint='传 --registry <asset-registry.json> 或 --versions <规则.json> 启用；'
                 '规则从注册表的 characters.*.versions.*.codename（角色）与 '
                 'props.*.state_arc（道具状态）自动生成，无需手写项目词。'
                 '（场景时段不走本门，见 C2 门）'))
        return errors, warns

    for num, title, dur, body in shots:
        head = body[:1200]  # 只看整体风格段，避免正文叙述干扰
        for label, sets in rules:
            hits = [[w for w in one if w and w in head] for one in sets]
            if all(hits):
                which = ' × '.join('/'.join(h) for h in hits)
                errors.append('块%s %s：%s 同时出现互斥版本特征（%s）——串版。'
                              '按版本互锁词删掉不属于本版的那一个' % (num, title, label, which))
    return errors, warns


# ------------------------------------------------------------ D. 时长
# 时长红线唯一事实源：SKILL.md「投放面参数总表」（按锁①模型版本分列）。
# 历史缺陷：曾按块标题格式判（「段 N｜」→30s、「镜 N｜」→15s），那是拿格式代替维度——
# 同一份分镜包投 2.5 面是 30s 上限，投 2.0/H3 面是 15s 上限，与标题写「段」还是「镜」无关。
# cap = 硬上限（超了 ERROR，必须滑窗拆分）；soft = 滑窗阈值（超了 WARN，建议拆）。
# v5.37.1：上表搬去 references/model-limits.json，与 check_prompt.mjs 共用同一份
# （历史缺陷：只有这里有一份事实源，L1 层写死 30s，两机对同一份 2.0 面 20s 包结论相反）。
# JSON 读不到时回落下面的内置副本，保证脚本在任何环境下都能跑。
MODEL_DURATION_FALLBACK = {
    '2.5':   {'cap': 30, 'soft': 20, 'floor': None,
              'refs': {'image': 30, 'video': 10, 'audio': 10, 'total': 50}},
    '2.0':   {'cap': 15, 'soft': 15, 'floor': 4,
              'refs': {'image': 9, 'video': 3, 'audio': 3, 'total': 12}},
    'h3':    {'cap': 15, 'soft': 15, 'floor': 4,
              'refs': {'image': 9, 'video': 3, 'audio': 3, 'total': 12}},
    'h3max': {'cap': 15, 'soft': 15, 'floor': 5,   # Max 只出 5–15s（SKILL.md 参数总表 / MiniMaxH3适配.md §一）
              'refs': {'image': 9, 'video': 3, 'audio': 3, 'total': 12}},
}
# 未声明型号时的兜底：最严的 15s + 最严的 12 份素材（与 model_limits.mjs 的 FALLBACK_LIMIT 同口径）
FALLBACK_REFS = {'image': 9, 'video': 3, 'audio': 3, 'total': 12}
FALLBACK_CAP = 15   # 未声明模型版本时的兜底：取最严的 15s，绝不静默放宽到 30s


def load_model_limits():
    """读 references/model-limits.json；读不到就用内置副本（不阻断校验）。"""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..',
                        'references', 'model-limits.json')
    try:
        with io.open(path, encoding='utf-8') as f:
            data = json.load(f)
        models = {}
        for k, v in (data.get('models') or {}).items():
            models[k] = {'cap': v.get('cap'), 'soft': v.get('soft'),
                         'floor': v.get('floor'), 'refs': v.get('refs')}
        if models:
            return models
    except Exception:
        pass
    return dict(MODEL_DURATION_FALLBACK)


MODEL_DURATION = load_model_limits()


_CODE_IN_MSG = re.compile(r'\b([EW]-[A-Z][A-Z0-9-]*)\b|\b(G\d)\b')

# ── 「未查」与「不合格」分账（v5.37.3）───────────────────────────────────
# 三个官方样例的 38 条 warning 里，**30 条是「你没传 --registry/--ledger/--script」**，
# 只有 8 条是真的查出问题。两者共用 [WARN] 通道和同一个计数 ⇒ warning 数不能当
# 质量信号读：用户看到「0 error / 10 warning」会以为快过了，其实是「10 门没跑」。
# 更糟的是真问题被埋掉——E01S02 的 7 条真黄字夹在 10 条「未查」中间，扫一眼就滑过去了。
# 口径与 Z 门 / G7 / S22 / CT 一致：**未查必须出声，但不能算进「不合格」**。
# 判定契约：新写「未查」消息必须含下列任一标记，否则会被当成人不合格计数。
_SKIP_MARKS = ('本门未查', '本门跳过', '这不是通过', '不适用 ≠ 通过')

# ── 「未查」再分两类（v5.37.6）──────────────────────────────────────────────
# 上一版把「未查」从「不合格」里拆出来了，但只要它还叫一个数（「12 未查」），
# 用户仍然不知道该干什么——因为这 12 条的下一步动作**根本不同**：
#   缺输入：输入侧缺东西（少传一个参数、配置没写、剧本里没标情节点）→ 补齐再跑
#   门槛  ：输入齐了，但样本量/粒度不够（2 个镜块凑不出 25%~40% 的占比）
#           → 补参数没用，只能换粒度复扫
# 混报的后果是实际发生过的：E01S02 报 12 条未查，其中 10 条只要跑一次
# `--config auto` 就没了，另 2 条怎么补参数都不会变——用户按同一句话对待它们，
# 于是两条不可满足的判据被当成「这包还有问题」，而十条真能消掉的被当成「就这样」。
SKIP_INPUT = '缺输入'
SKIP_MISSING = '缺产物'
SKIP_THRESH = '门槛'
# 未查的三类：都是「该查没查」，只是下一步动作不同。
SKIP_KINDS = (SKIP_INPUT, SKIP_MISSING, SKIP_THRESH)

# 第四档：**不适用**（v5.37.8）。它不是未查的一种——「这个包没有这个场景」和
# 「该查却没查」是两件事。混进未查的后果是具体的：一个没写「镜头裁定」表的包
# **永远拿不到「全部通过」**（至少 1 条未查），于是「全绿」这个信号对它永久不可达。
# 不可达的信号没人追；更糟的是它的提示文案还写着「补齐输入后重跑」——
# 可「镜头裁定」表只在改动复验时才需要，根本没有「补齐」这回事，文案和行为一起错。
# 所以单独摘出来：单列一档，**不参与退出码**，但必须在报告里出声，并写明「不适用 ≠ 通过」。
SKIP_NA = '不适用'

# 认得全部四类标签（_skip_msg 校验用这张表），但只有前三个算未查。
KIND_LABELS = SKIP_KINDS + (SKIP_NA,)

# 类别只从括号里的标签认，不从措辞猜——猜法就是上一版踩过的坑
# （`startswith('本门未查')` 只覆盖一种写法，另外四条 skip 消息被算成「门响了」）。
# 不适用不走括号：它的句子是「本门不适用（原因）」，连「未查」两个字都不该出现——
# 写了就是自相矛盾（「未查」= 该查没查，「不适用」= 不该查）。
_KIND_RE = re.compile('（(' + '|'.join(SKIP_KINDS) + ')：')
_NA_MARK = '本门不适用'

_SKIP_NEXT = {
    SKIP_INPUT: '补齐输入后重跑才算查过',
    SKIP_NA: '这一门本包永远没验过；改动复验时才需要它',
    SKIP_MISSING: '这份产物项目里还没有——先做上游那道工序（或从模板起一份）再跑',
    SKIP_THRESH: '换粒度（把整场拆细、多给几个镜块）后复扫才算查过',
}

# v5.37.7：「缺输入」内部还有一层，而且是最容易误判的一层——
#   缺输入：文件在项目里，只是没传参 → 跑一次 `--auto` / `--config auto` 就有
#   缺产物：文件根本不存在 → 补参数永远补不上，得先做上游那道工序
# 两者都用「补齐输入后重跑」一句话，等于把「你已经有的东西没拿来用」和
# 「你压根没做」说成同一件事。E01S02 就是后者的典型：11 条缺输入里一条参数都补不动，
# 因为那个目录只有 包.md 和 beats.txt。


def _skip_msg(reason, kind, hint=None):
    """生成一条「未查」消息：`本门未查（<类别>：<原因>）——这不是通过。<下一步>`。

    **`kind` 没有默认值，是故意的**（v5.37.12）。默认值就是那个「替你回答」的东西：
    写的人没说，默认值替他答「缺输入」——而有的跳过根本不是缺输入。给它一个必填参数，
    漏了就当场 `TypeError`，比事后从汇总行里看出「部分包永远拿不到全绿」便宜太多。

    kind 写错直接抛——未查不带类别，报告层就只能把它归进「未分类」，
    而「未分类」在汇总行里是要被点名报出来的（等于当场承认这条消息没写完）。
    """
    if kind not in KIND_LABELS:
        raise ValueError('未查类别只认 %s，收到 %r' % ('/'.join(KIND_LABELS), kind))
    if kind == SKIP_NA:
        return '本门不适用（%s）——**不适用 ≠ 通过**。%s' % (
            reason, hint or _SKIP_NEXT[kind])
    return '本门未查（%s：%s）——**这不是通过**。%s' % (
        kind, reason, hint or _SKIP_NEXT[kind])


def _skip_kind(msg):
    """从消息取类别：`本门不适用` → 不适用；`（缺输入：…）` 这类标签 → 那三类；
    都没有返回 None（由报告层归「未分类」）。"""
    s = str(msg)
    if _NA_MARK in s:
        return SKIP_NA
    m = _KIND_RE.search(s)
    return m.group(1) if m else None


def _is_na(msg):
    """这条未查是不是「本门不适用」。"""
    return _skip_kind(msg) == SKIP_NA


def _is_skip(msg):
    s = str(msg)
    return any(k in s for k in _SKIP_MARKS)


def _retag(msg, kind):
    """把一条未查消息改判成另一个类别（只在报告层用）。

    只改两个地方：括号里的类别标记，以及**默认尾句**（自定义 hint 不动——那是门自己写的
    下一步建议，比通用文案准）。改判必须保持消息其余部分一字不变，否则「未查」的原文
    在日志里就查不到出处了。
    """
    if kind == _skip_kind(msg):
        return msg
    out = _KIND_RE.sub('（%s：' % kind, str(msg), count=1)
    if _SKIP_NEXT[SKIP_INPUT] in out:
        out = out.replace(_SKIP_NEXT[SKIP_INPUT], _SKIP_NEXT[kind])
    return out


def _dep_of(section_name):
    """门名 → 它依赖哪个输入。表就是 COVERAGE_GATES，不另维护一份。

    前缀匹配是为了吃掉 `（互斥特征）` / `（废镜隔离）` 这类尾巴；
    `in_pkg`（包内自足）与 None 都不参与「缺产物」的判定——它们不是文件。
    """
    for gate, dep in COVERAGE_GATES:
        if dep and dep != 'in_pkg' and (section_name or '').startswith(gate):
            return dep
    return None


def _presence(args, probe, dep):
    """这份输入现在是什么状态：given 已传参 / found 项目里有但没传 / missing 项目里没有。"""
    deps = dep if isinstance(dep, tuple) else (dep,)
    if any(getattr(args, d, None) for d in deps):
        return 'given'
    if any(getattr(probe, d, None) for d in deps):
        return 'found'
    return 'missing'


def _relabel_missing_inputs(sections, args, probe):
    """把「缺输入」里那些「项目里根本没有这份产物」的，改判「缺产物」。

    为什么放在报告层而不是消息生成处：门函数拿不到包路径，也不该为了一句提示去拿——
    「这份输入在不在」是**项目级事实**，在这里一次算完，门函数只负责说「这门没跑、为什么」。

    只改判 `缺输入`。`门槛` 是样本量问题、`缺输入` 里判定为 found 的本来就是补参数能解决，
    两类都不该被这条规则碰到。
    """
    out = []
    for name, errs, warns, skips in sections:
        dep = _dep_of(name)
        new = []
        for k in skips:
            if dep and _skip_kind(k) == SKIP_INPUT and _presence(args, probe, dep) == 'missing':
                k = _retag(k, SKIP_MISSING)
            new.append(k)
        out.append((name, errs, warns, new))
    return out


def _split_skips(sections):
    """(name, errs, warns) → (name, errs, warns, skips)。

    在 main 里统一做一次，不去改每个门的返回签名——门只管「查到什么」，
    「查没查」是报告层的事，放这里只需要一处判定。
    """
    out = []
    for name, errs, warns in sections:
        sk = [w for w in warns if _is_skip(w)]
        wn = [w for w in warns if not _is_skip(w)]
        out.append((name, list(errs), wn, sk))
    return out


def _issues_from_sections(sections, na_by_name=None):
    """把 (name, errs, warns, skips) 摊平成 gates_log 吃的 issue 列表（v5.37.1）。

    gates_log.append_gate_log 只需要 code / level；本节大多数消息**不带码号**（D 门、
    转场表、台账对账等）。三级降级取码：
      ① 消息正文里的码号（E-xxx / W-xxx / G3）
      ② 所在门的名字（`D. 时长一致性` → `SEC:D`）—— 至少能看出「哪道门最常响」
      ③ 都没有才记 UNCODED（记 UNCODED 而不是丢掉，否则 stats 会把它们算成「没响过」）

    v5.37.3：未查的判定从 `startswith('本门未查')` 改成 `_is_skip()`。旧判定只认
    「本门未查」这个前缀，而 `未配置…本门跳过` / `未给 --registry，F2—F6 跳过` /
    `未给 --ledger，G 门跳过` / `未提供 --script，N 门跳过` 四条**不含该前缀**，
    于是被算成所在门「响了」——stats 的头名会变成「最常响的是 SEC:F / SEC:G」，
    而那几道门一次都没真跑过。这正是上面注释想防的坑，自己踩了一半。
    """
    out = []
    na_by_name = na_by_name or {}
    for name, errs, warns, skips in sections:
        m2 = re.match(r'\s*([A-Za-z0-9/]+)\.', name or '')
        sec_tag = 'SEC:%s' % m2.group(1) if m2 else 'SEC:?'
        # 「不适用」单独一级（v5.37.8）：混进 skip 会让 stats 把它算成「门没跑」，
        # 而它根本不该跑——两者在日志里必须能分开数。
        for level, msgs in (('error', errs), ('warn', warns), ('skip', skips),
                            ('na', na_by_name.get(name, []))):
            for msg in msgs:
                m = _CODE_IN_MSG.search(msg)
                if m:
                    code = m.group(1) or m.group(2)
                elif level == 'na':
                    code = 'SEC-NA'
                elif level == 'skip' or _is_skip(msg):
                    # 「未查」不是「响了」。混进各门的计数会让 stats 的头名变成
                    # 「最常响的是 SEC:D」——而 SEC:D 一次都没真跑过。单独归桶。
                    code = 'SEC-SKIP'
                else:
                    code = sec_tag
                it = {'code': code or 'UNCODED', 'level': level, 'msg': str(msg)[:200]}
                if level == 'skip':
                    # v5.37.6：把类别写进日志，gates_stats 才能回答「这堆未查里
                    # 有几条是补个参数就能消掉的」。取不到类别就留空，由 stats 报「未分类」。
                    it['kind'] = _skip_kind(msg)
                out.append(it)
    return out


def _skip_section(reason, kind, hint=None):
    """v5.37.1：门没跑时的统一返回——WARN 一条「未查，这不是通过」。

    历史缺陷：D2 / N4 / N5-N6 / N3b / R / D3 六门在输入缺失时直接 `return errors, warns`
    （或压根不装配 section），报告里连这一节的名字都不出现，「没查」被读成「没问题」。
    与 Z 门 / G7 / S22 / CT 的既有口径对齐：未查必须出声。

    v5.37.6：带类别（缺输入 / 门槛），见 `_skip_msg`。
    """
    return ([], [_skip_msg(reason, kind=kind, hint=hint)])


def detect_model_version(pkg_text):
    """从包内【模型版本】/【三锁】模型= 读锁①；读不到再全文搜型号串。读不到返回 None。"""
    # v5.29.0：冒号改可选——示范写法与正则不一致时，写成 `【模型版本】2.5` 会静默回落
    # 成最严 15s 判据并报 D0 WARN，人还以为是漏声明。两种写法都认。
    # v5.37.1：补【三锁】模型= 声明位。examples/ 里 `【三锁】模型=2.5` 是标准写法，
    # 旧实现只搜「Seedance 2.5」整串，写成裸 `模型=2.5` 就识别不到 → 静默按最严 15s 判。
    raw = ''
    for pat in (r'【模型版本】\s*[:：]?\s*([^\n【|｜]+)',
                r'【三锁】[^\n]*?模型\s*[=＝:：]\s*([^\n|｜【]+)'):
        m = re.search(pat, pkg_text)
        if m and m.group(1).strip():
            raw = m.group(1).strip()
            break
    if not raw:
        m2 = re.search(r'(Seedance\s*2\.5|Seedance\s*2\.0|MiniMax[\s-]*H3(?:\s*Max)?|H3(?:\s*Max)?)',
                       pkg_text, re.I)
        raw = m2.group(1) if m2 else ''
    if not raw:
        return None
    r = raw.lower()
    if re.search(r'2\.5|seedance\s*2\.5', r):
        return '2.5'
    if re.search(r'2\.0|seedance\s*2\.0', r):
        return '2.0'
    # v5.37.1：H3 Max 必须排在 H3 前面 —— 旧顺序把「H3 Max」吃成 h3，
    # 它在 model-limits.json 里的 5s 下限（三处文档都写了）永不生效（审查报告 MA-4）。
    if re.search(r'h3\s*max', r):
        return 'h3max'
    if re.search(r'h3|minimax', r):
        return 'h3'
    # 裸写「2」按 2.5 还是 2.0 判都可能错，宁可不判——交给调用方报「未识别」走兜底
    return None


def audit_duration(shots, cap=15, soft=15, model=None, floor=None):
    errors, warns = [], []
    tag = f'锁①={model}' if model else '锁①未声明'
    # v5.37.1：下限由 model-limits.json 的 floor 给出（2.0/H3=4s，H3 Max=5s）。
    # 旧实现把 4 写死在判据里，H3 Max 的 5s 下限三处文档都写了却从未生效。
    if floor is None and model:
        floor = MODEL_DURATION.get(model, {}).get('floor')
    for num, title, dur, body in shots:
        # 参数行标记支持 `# duration`（旧）与 `【参数】duration`（去 Markdown 符号后）
        # v5.37.2：值改三态——整数秒 / 智能时长（`-1` 或 `auto`）/ 认不出。
        # 旧正则只认「数字+s」，于是官方写法 `# duration: -1` 被报成「缺 duration 参数行」，
        # 而同口径的 check_prompt.mjs 则静默放过——**同一件事两台机一台说缺、一台不说**。
        # 外部依据：火山方舟《创建视频生成任务》「duration = -1 适配规则」：
        # Seedance 2.0 系列与 2.5（非视频编辑任务）由模型在有效区间内自选整数秒。
        # https://console.volcengine.com/ark/region:cn-beijing/docs/ark/create-video-generation-task-api?lang=zh
        d = re.search(r'(?:#|【参数】)\s*duration\s*[:：]\s*([^\s|｜]+)', body)
        if not d:
            errors.append(f'块{num} 缺 duration 参数行（——E-PARAM-DUR-MISSING：参数行必须显式写时长）')
        else:
            raw = d.group(1).rstrip('s').replace('−', '-').replace('－', '-')
            if raw in ('-1', 'auto', '自动'):
                pass  # 智能时长：无秒数可比，硬上限仍按标题时长判（下面两步不受影响）
            elif not re.match(r'^\d+(?:\.\d+)?$', raw):
                errors.append(f'块{num} duration 值无法识别：{d.group(1)}'
                              f'（——E-PARAM-DUR-MISSING：写整数秒或 -1/auto）')
            elif abs(float(raw) - dur) > 1e-6:
                errors.append(f'块{num} 标题 {dur}s 与 duration {raw}s 不一致'
                              f'（——E-PARAM-DUR-MISMATCH：复制粘贴改标题忘改参数行）')
        # v5.37.2 · 审查报告 MA-5：素材上限此前零机检（2.5 的 30/10/10/50 与 2.0·H3 的 9/3/3/12
        # 只写在文档与 model-limits.json 里，没有脚本读 refs）。按**单镜块**去重计数——
        # 上限是「一次调用能塞几份素材」，整包跨十几镜时 @图片1~20 是正常分镜引用。
        # 与 check_prompt.mjs 同口径：超限时型号已声明 = E、兜底档 = W。
        _rl = MODEL_DURATION.get(model, {}).get('refs') if model else FALLBACK_REFS
        if _rl:
            _b = body_of(body)
            _got = {k: len(set(rx.findall(_b))) for k, rx in REF_RES.items()}
            _total = sum(_got.values())
            _over = []
            if _got['image'] > (_rl.get('image') or 0):
                _over.append('图 %d 张 > %d' % (_got['image'], _rl['image']))
            if _got['video'] > (_rl.get('video') or 0):
                _over.append('视频 %d 段 > %d' % (_got['video'], _rl['video']))
            if _got['audio'] > (_rl.get('audio') or 0):
                _over.append('音频 %d 条 > %d' % (_got['audio'], _rl['audio']))
            if _total > (_rl.get('total') or 0):
                _over.append('合计 %d 份 > %d' % (_total, _rl['total']))
            if _over:
                _lvl = errors if model else warns
                _code = 'E-REF-OVER-LIMIT' if model else 'W-REF-OVER-LIMIT'
                _lvl.append('块%s 参考素材超单镜上限：%s（%s）——%s：先砍素材再改 Prompt'
                            % (num, '；'.join(_over), tag, _code))
        if dur > cap:
            # v5.37.1：消息里补码号 —— 此前 D 门只管人读，selftest_boundary.py 的 codes()
            # 抓不到「超硬上限」这件事，跨机一致性用例没法断言它。与 check_prompt.mjs 同名。
            errors.append(f'块{num} {dur}s 超出 {cap}s 硬上限（{tag}）——E-OVER-30S：必须滑窗拆分')
        elif soft < cap and dur > soft:
            # v5.19.0 三条件放行制（权威：references/长段放行与段缝成本对账.md）：
            # >20s 不再是平铺红线——循环的病根是节拍供给不足 + 没有停止语义。
            # A 段头【长段声明】/ B 时间轴段数 ≥4 / C 末拍收束定格，三条件齐免报；
            # 缺任一按 check_prompt.mjs 同口径点名（两个脚本判据必须一致）。
            declared = '【长段声明】' in body
            # v5.30.0 修跨机判据不一致：旧正则 findall 只捕获到段**前缀**（如「【时间轴】16」），
            # last_seg 里永远不含「定格」→ C 条件永远不成立 → 本脚本从未放行过任何长段，
            # 而 check_prompt.mjs 会放行（第二阶段判据层边界包实测：L1 三条件齐，cp 过 / ap 不过）。
            # 修法：捕获整行，让末拍收束检查看到真实末段文本。
            # v5.37.1：补无前缀裸位骨架（`0-4s 全景 · …`）与 2.0 面镜头编号骨架（`镜头1：…`）。
            # 此前这里只认【时间轴】与 Shot N 两种前缀，裸位/编号包的 dense 恒为 0 → 长段被误判
            # 「节拍不足」，与 check_prompt.mjs 的 parseSegments（已认 5 种骨架）不同口径。
            segs = re.findall(r'^(?:【时间轴】\s*\d|Shot\s*\d+\s*\(|镜头\s*\d+\s*[：:｜|]|\d{1,2}(?:\.\d+)?\s*[-–~]\s*\d)[^\n]*',
                              body, re.M | re.I)
            dense = len(segs) >= 4
            last_seg = segs[-1] if segs else ''
            tail_ok = bool(re.search(r'定格|完全静止|保持该姿态', last_seg))
            if not (declared and dense and tail_ok):
                missing = []
                if not declared:
                    missing.append('段头未写【长段声明】')
                if not dense:
                    missing.append(f'时间轴 {len(segs)} 段 <4（长段节拍供给不足）')
                if not tail_ok:
                    missing.append('末拍无收束定格措辞')
                warns.append(f'块{num} {dur}s 越过 {soft}s 放行线（{tag}）——W-OVER-20S：'
                             f'{"；".join(missing)}；补三条件或滑窗拆分每窗 ≤{soft}s')
        if floor and 0 < dur < floor:
            warns.append(f'块{num} {dur}s 低于 {tag} 的 {floor}s 下限（官方 {floor}–{cap}s 档）')
    return errors, warns


# ------------------------------------------------------------ E. 转场表
def audit_transitions(pkg_text, shots):
    errors, warns = [], []
    order = sorted({s[0] for s in shots}, key=shot_key)
    need = [(order[i], order[i + 1]) for i in range(len(order) - 1)]
    # 转场表行兼容四种写法：
    #   `| 3 → 4 | ... |`
    #   `| 镜3→镜4 | ... |`
    #   `| 镜32→镜33（日→黄昏） | 换时硬切 | ... |`   ← liqi 终稿带换场说明
    #   `| U01 → U02 | 同场紧接 | ... |`              ← MiniMax H3 面（单元号锚定）
    # 旧版正则只认第一种，终稿格式整张表都被判「无转场表」（实测 62 镜全漏）；
    # 漏 `U` 前缀会让 H3 面的转场表被整张判为缺失（实测 57 单元全漏）。
    tbl = re.findall(r'^\|\s*(?:镜|段|U)?\s*(\d+[a-z]?)\s*→\s*(?:镜|段|U)?\s*(\d+[a-z]?)'
                     r'\s*(?:（[^）]*）)?\s*\|', pkg_text, re.M)
    if not tbl:
        # 整合段格式（Seedance 2.5 面等）：无独立转场表，转场由段末拍承接
        warns.append('无转场表（整合段格式：转场由各段末拍承接，段间衔接需人工核对）')
        return errors, warns
    have = set(tbl)
    for a, b in need:
        if (a, b) not in have:
            errors.append(f'转场表缺 {a}→{b}')
    for a, b in tbl:
        if (a, b) not in set(need):
            warns.append(f'转场表多出失效行 {a}→{b}')
    return errors, warns


# ------------------------------------------------------------ S. 分镜配额
# v5.7.0 新增。把「镜头多样性」从原则变成可统计的区间配额。
# 规范见 references/分镜配额与机检规范.md；越界分级：只有 Q7/Q10/Q11 报 ERROR，
# 其余 WARN；S22 是元检查（统计不到就报 FAIL，绝不报 OK）。
#
# 解析口径与 check_prompt.mjs 的 SHOTSIZE 对齐：liqi 镜块的景别/机位写在段头第一句，
# 形如「特写，固定机位」「中景，固定机位，随视线轻微横移」。
# ⚠️ 景别词表必须长词优先（大特写先于特写、中近景先于近景、中全景先于全景），
#    否则「大特写」会被「特写」抢先匹配成 8 档。

SHOTSIZE_WORDS = [
    ('大特写', 9), ('ECU', 9), ('ecu', 9),
    ('大远景', 1),
    ('中全景', 4),
    ('中近景', 6),
    ('特写', 8),
    ('近景', 7),
    ('中景', 5),
    ('全景', 3),
    ('远景', 2),
]
# ⚠️ 按词长降序排——「大远景」含「远景」、「中全景」含「全景」、「中近景」含「近景」、
#    「大特写」含「特写」，顺序反了就会把长词误判成短词档（实测连踩两次）。
#    改成自动排序后，以后加新档位词也不会再踩这个坑。
SHOTSIZE_WORDS = sorted(SHOTSIZE_WORDS, key=lambda x: -len(x[0]))

# 常规机位：平视 + 正面/过肩 + 平稳（无重技法）。近似口径——WARN 级，误报成本低。
ANGLE_REGULAR = ('固定机位', '平视', '正面', '过肩')
ANGLE_SIDE45 = ('侧45', '45度侧', '斜侧', '侧前方', '侧 45')
ANGLE_SIDE = ('侧面', '正侧')
ANGLE_UP = ('仰拍', '仰角', '低角度', '低机位')
ANGLE_DOWN = ('俯拍', '俯角', '高角度', '鸟瞰', '高机位')
ANGLE_DUTCH = ('荷兰角', '倾斜构图', '斜构图')

# 运镜规范名 → 触发词。长词优先同理。
# ⚠️ v5.16.0 修误报（P0-1）：旧版用单字「摇」与裸「手持」「晃动」做子串匹配，
#   「烛火摇曳」「树影摇晃」被误判为「摇」运镜，「手持灯笼」被误判为「手持晃动」——
#   文戏/夜景镜几乎必中，导致 S18 运镜种数虚高（假绿）、S19 连续同运镜误报，
#   且误报的「手持晃动」会触发 S19 的 shaky 豁免，把真连续同运镜放行（假绿的反向）。
#   修法：触发词一律用完整词，禁止单字与裸手持/晃动；合法的「手持跟随」由「跟随」覆盖。
MOVE_WORDS = [
    ('滑动变焦', ('滑动变焦', '推拉变焦', 'dolly zoom')),
    ('环绕', ('环绕', '绕行', 'arc shot')),
    ('Snorricam', ('snorricam',)),
    ('鱼眼', ('鱼眼', 'fisheye')),
    ('摇臂', ('摇臂', 'crane')),
    ('POV', ('pov', '第一人称视角', '主观视角')),
    ('升降', ('升降', '升镜', '降镜', 'vertical move')),
    ('推近', ('推近', '缓慢推近', '推镜', 'dolly in', 'push in')),
    ('拉远', ('拉远', '拉镜', 'dolly out', 'pull back')),
    ('横移', ('横移', '平移', 'truck', 'pan')),
    ('跟随', ('跟随', '跟拍', '跟随镜头')),
    ('摇镜', ('摇镜', '摇摄', '右摇', '左摇', '横摇', '纵摇', '上摇', '下摇')),
    ('手持晃动', ('手持摄影', '手持跟拍', '手持镜头', '手持晃动', '镜头晃动', '画面晃动',
                 '微晃', '剧烈晃动', 'handheld', 'steadicam')),
    # v5.37.3：补「固定」。此前词表只收位移/变焦类动作，固定机位不算运镜 ——
    # 于是**全静态的合法包一个运镜词都解析不出**，被 S22 判成「本门没有真正查过，不算通过」
    # 并报 ERROR。那是把「正确地写了固定机位」当成「格式坏了」。
    # 固定是运镜的反面，但它是一个**明确的选择**，不是「没写」。
    ('固定', ('固定机位', '机位固定', '机位静止', '固定镜头', '静态机位', '固定')),
]

# S19（连续第 3 镜同运镜）必须排除「固定」：三镜固定机位在对话戏/静物戏里极常见，
# 它不构成「同一个机位拍了三遍」的观感问题。计入种数、不计入连续同运镜。
STATIC_MOVES = frozenset({'固定'})

# v5.16.0 运镜命中守卫：方向摇（右摇/下摇…）后接「晃动摆」的是物体摆动
# （「投下摇晃」「向右摇动」「枝干左摇」），不是运镜——子串匹配分不开，加一道尾字排除。
_MOVE_SWAY_TAIL = '晃动摆'


def _move_hit(text, w):
    """触发词命中判定：普通词纯子串；以「摇」结尾的方向摇排除物体摆动尾字。"""
    if w not in text:
        return False
    if not w.endswith('摇'):
        return True
    for m in re.finditer(re.escape(w), text):
        if text[m.end():m.end() + 1] not in _MOVE_SWAY_TAIL:
            return True
    return False
# 重技法（注意力税，全片总预算管住）
HEAVY_MOVES = ('滑动变焦', '环绕', 'Snorricam', '鱼眼', '升降', '摇臂', 'POV')
HEAVY_QUOTA = {'滑动变焦': 1, '环绕': 3, 'Snorricam': 1, '鱼眼': 2,
               '升降': 2, '摇臂': 2, 'POV': 3}

FOCAL_WORDS = ('广角', '标准镜头', '长焦', '微距', 'mm', '焦段')

# 段/块级配额声明：块内出现即对该块生效
QUOTA_DECL_RE = re.compile(r'【配额声明】\s*([^\n【]+)')
DECL_JUMP = '极限景别跳跃'      # 豁免 S18（该块与相邻块的档位差）
DECL_REGULAR = '常规机位主导'   # 豁免 S11（该块不计入常规机位分子）
DECL_HEAVY = '重技法集中段'     # 豁免 S17（该块的重技法不计入全片上限）


def _parse_shot_meta(text):
    """从镜块文本解析 (景别档位|None, 机位分类|None, [运镜规范名...], [焦段词...])。

    机位分类取命中的第一个（按 常规→侧45→侧面→仰→俯→荷兰 顺序），
    因为一个镜通常只标一个主角度。
    """
    size = None
    for w, lvl in SHOTSIZE_WORDS:
        if w in text:
            size = lvl
            break
    angle = None
    for words, name in ((ANGLE_REGULAR, '常规'), (ANGLE_SIDE45, '侧45'),
                        (ANGLE_SIDE, '侧面'), (ANGLE_UP, '仰角'),
                        (ANGLE_DOWN, '俯角'), (ANGLE_DUTCH, '荷兰角')):
        if any(x in text for x in words):
            angle = name
            break
    moves = [name for name, ws in MOVE_WORDS if any(_move_hit(text, x) for x in ws)]
    focals = [f for f in FOCAL_WORDS if f in text]
    return size, angle, moves, focals


def audit_shot_quota(shots, pkg_text=''):
    """S 系列：分镜配额构成检查。

    ⚠️ 假绿防线（S22）：统计不到镜块或过半镜块解析不出景别时，报 FAIL 而非报 OK——
       「没统计却报通过」比漏检更危险。
    ⚠️ 未解析出景别的镜**计入分母、不计入分子**，并在报告里列出镜号，
       占比永远可算，不会出现除零或空集假绿。
    """
    errors, warns = [], []
    if not shots:
        # 统计不到镜块 = 本门没有真正查过。Z 门也会报，但单独看 S 段的人不该被骗。
        errors.append('S22 配额统计失效：未识别到任何镜/段块，本门没有真正查过，不算通过。'
                      '块头需形如「镜 1｜标题 5s」或「段 1｜标题 15s」（标题必须带秒数）')
        return errors, warns

    # 只统计叶子块（块内含 duration 参数行）。容器段（如「## 段 1｜夜探（25s）」）
    # 本身不是镜头，计入分母会污染占比；混合格式下尤其明显。
    leaves = [s for s in shots if re.search(r'(?:#|【参数】)\s*duration:', s[3])]
    if not leaves:
        errors.append('S22 配额统计失效：有 %d 个块但都不含 duration 参数行，'
                      '无法识别哪些是真镜头（叶子块）。本门没有真正查过，不算通过'
                      % len(shots))
        return errors, warns

    metas = []
    unresolved = []
    for num, title, dur, body in leaves:
        size, angle, moves, focals = _parse_shot_meta(body)
        decl = ''.join(QUOTA_DECL_RE.findall(body))
        metas.append({'num': num, 'size': size, 'angle': angle,
                      'moves': moves, 'focals': focals, 'decl': decl})
        if size is None:
            unresolved.append(str(num))

    n = len(metas)
    # ---- S22 元检查 ----
    if unresolved and len(unresolved) * 2 > n:
        errors.append('S22 配额统计失效：%d/%d 个镜块解析不出景别（未解析：%s）。'
                      '本门没有真正查过，不算通过——检查块头格式是否为'
                      '「镜 N｜标题（Ns）」，以及段头是否写了景别词'
                      % (len(unresolved), n, '、'.join(unresolved[:8])))
        return errors, warns
    if all(not m['moves'] for m in metas):
        errors.append('S22 配额统计失效：所有镜块都解析不出运镜词。'
                      '本门没有真正查过，不算通过')
        return errors, warns

    def pct(cnt):
        return cnt * 100.0 / n

    # ── 配额类判据的最小样本量（v5.37.3）────────────────────────────────
    # 这几条是**每集分布**口径（原始出处按 57 单元一集标定），不是「单镜合规」。
    # 镜块太少时它们不是「严格」，是**数学上不可满足**：
    #   · 占比类：n=2 时占比只有 0/50/100 三档，25%~40% 要命中 0.5~0.8 个镜 → 必然越界；
    #   · 种数类：焦段 ≥4 种、运镜 ≥8 种，2 个镜块凑不出来。
    # 后果：任何短包必挂 4~5 条**永远修不掉**的黄字。用户修不动就只能忽略，
    # 于是真判据（S16 荷兰角超额 / S19 连续同运镜 / S22 统计失效）一起失效。
    # 处理：够不上门槛时报「未查 + 门槛数字」，不报「不合格」——**未查 ≠ 通过**。
    QUOTA_MIN_RATIO = 3   # 占比类：从 n=3 起，1/n 的粒度才有可能落进 25%~40%
    QUOTA_MIN_FOCAL = 4   # 焦段种数 ≥4 → 至少 4 个镜块才可能凑齐
    QUOTA_MIN_MOVE = 8    # 运镜种数 ≥8 → 至少 8 个镜块才可能凑齐
    _skipped_quota = []
    if n < QUOTA_MIN_RATIO:
        _skipped_quota += ['S10', 'S11', 'S12', 'S13']
    if n < QUOTA_MIN_FOCAL:
        _skipped_quota += ['S17']
    if n < QUOTA_MIN_MOVE:
        _skipped_quota += ['S18']
    if _skipped_quota:
        warns.append(_skip_msg(
            '配额类 %s：镜块 %d 不够门槛' % ('/'.join(_skipped_quota), n),
            kind=SKIP_THRESH,
            hint='占比判据按每集分布标定，%d 个镜块时占比粒度是 %.0f%%，'
                 '区间型（25%%~40%% / 30%%~40%%）在这里数学上不可满足；'
                 '种数判据则要凑够种数。按段/场出片时这几条不适用，'
                 '成片或整集复扫时再跑' % (n, 100.0 / n)))

    _ratio_ok = n >= QUOTA_MIN_RATIO

    # ---- Q1 / S10 人物特写占比 25%~40% ----
    if _ratio_ok:
        closeups = [m for m in metas if m['size'] in (8, 9)]
        cp = pct(len(closeups))
        if not (25.0 <= cp <= 40.0):
            warns.append('S10 人物特写占比 %.0f%%（%d/%d），越出 25%%~40%% 区间。'
                         '注：物件特写不计入，若本包以物件特写为主属误报，请人工核对'
                         % (cp, len(closeups), n))

    # ---- Q2 / S11 常规机位 ≤30% ----
    if _ratio_ok:
        regular = [m for m in metas if m['angle'] == '常规'
                   and DECL_REGULAR not in m['decl']]
        rp = pct(len(regular))
        if rp > 30.0:
            warns.append('S11 常规机位占比 %.0f%%（%d/%d），超过 30%%。'
                         '补侧 45° 与过肩变化，否则全片节奏雷同'
                         % (rp, len(regular), n))

    # ---- Q3 / 侧45 30%~40% ----
    if _ratio_ok:
        s45 = [m for m in metas if m['angle'] == '侧45']
        p45 = pct(len(s45))
        if not (30.0 <= p45 <= 40.0):
            warns.append('S12 侧 45° 机位占比 %.0f%%，越出 30%%~40%% 区间' % p45)

    # ---- Q4 / 侧面 ≤15% ----
    if _ratio_ok:
        side = [m for m in metas if m['angle'] == '侧面']
        sp = pct(len(side))
        if sp > 15.0:
            warns.append('S13 侧面机位占比 %.0f%%，超过 15%%' % sp)

    # ---- Q5 / Q6 大仰角、大俯角各 ≤3 ----
    # 计数类（≤3 次/集）在 0 镜时恒真，n 小也不误报，故不加门槛
    for name, tag, code in (('仰角', '大仰角', 'S14'), ('俯角', '大俯角', 'S15')):
        cnt = sum(1 for m in metas if m['angle'] == name)
        if cnt > 3:
            warns.append('%s %s %d 次，超过 3 次/集' % (code, tag, cnt))

    # ---- Q7 / S16 荷兰角 ≤1（ERROR） ----
    dutch = [m for m in metas if m['angle'] == '荷兰角']
    if len(dutch) > 1:
        errors.append('S16 荷兰角 %d 次，超过 1 次/集——荷兰角是风格化手段，'
                      '超过 1 次就从手法变默认' % len(dutch))

    # ---- Q8 / S17 焦段种数 ≥4 ----
    if n >= QUOTA_MIN_FOCAL:
        focal_set = set()
        for m in metas:
            focal_set.update(m['focals'])
        if len(focal_set) < 4:
            warns.append('S17 焦段种数 %d，少于 4 种（%s）'
                         % (len(focal_set), '、'.join(sorted(focal_set)) or '无'))

    # ---- Q9 / S18 运镜种数 ≥8 ----
    if n >= QUOTA_MIN_MOVE:
        move_set = set()
        for m in metas:
            move_set.update(m['moves'])
        if len(move_set) < 8:
            warns.append('S18 运镜种数 %d，少于 8 种（%s）'
                         % (len(move_set), '、'.join(sorted(move_set)) or '无'))

    # ---- Q10 / S19 连续同运镜禁第 3 镜（ERROR） ----
    run = 1
    for i in range(1, n):
        prev, cur = metas[i - 1], metas[i]
        # 「固定」不算连续同运镜（见 STATIC_MOVES 注释）：三镜固定机位是正常手法。
        same = bool((set(prev['moves']) & set(cur['moves'])) - STATIC_MOVES)
        shaky = any('手持晃动' in m['moves'] for m in (prev, cur))
        run = run + 1 if same else 1
        if run >= 3 and not shaky:
            errors.append('S19 连续第 3 镜同运镜（块%s 起，运镜 %s）——'
                          '第三镜必然读成同一个机位拍了三遍，换运镜或换景别'
                          % (cur['num'], '、'.join(sorted((set(prev['moves']) & set(cur['moves'])) - STATIC_MOVES))))

    # ---- Q11 / S20 重技法全片上限（ERROR） ----
    heavy_cnt = {}
    for m in metas:
        if DECL_HEAVY in m['decl']:
            continue
        for mv in m['moves']:
            if mv in HEAVY_MOVES:
                heavy_cnt[mv] = heavy_cnt.get(mv, 0) + 1
    for mv, cnt in sorted(heavy_cnt.items()):
        if cnt > HEAVY_QUOTA[mv]:
            errors.append('S20 重技法「%s」%d 次，超过全片上限 %d 次——'
                          '重技法是注意力税，全片总预算就那么多'
                          % (mv, cnt, HEAVY_QUOTA[mv]))

    # ---- S21 相邻景别档位差 ≥3（WARN，声明即豁免） ----
    # v5.29.0：补【包级】豁免。按块声明（14 字/块）在 10 镜级样例里 9 块都要写，
    # 直接把单镜 800 字额度吃穿；而 Q1/Q3/C1 三条配额本身就强迫跨档。
    # 包级声明写在包首（不进正文、不计入单镜额度），一次豁免全片 S21。
    global_jump = '全片采用极限景别跳跃' in (pkg_text or '')
    for i in range(1, n):
        prev, cur = metas[i - 1], metas[i]
        if prev['size'] is None or cur['size'] is None:
            continue
        gap = abs(prev['size'] - cur['size'])
        if gap >= 3:
            if global_jump or DECL_JUMP in prev['decl'] or DECL_JUMP in cur['decl']:
                continue
            warns.append('S21 块%s（%d 档）→ 块%s（%d 档）跨度 %d 档，'
                         '需按资产审美 §13.4 补过渡素材或传前一镜输出图；'
                         '如为极限景别跳跃手法，写【配额声明】本段采用极限景别跳跃（逐段）'
                         '，或包首写【配额声明】全片采用极限景别跳跃（一次豁免全片）'
                         % (prev['num'], prev['size'], cur['num'], cur['size'], gap))

    if unresolved:
        warns.append('S22 附：以下 %d 个镜块未解析出景别（计入分母、不计入分子）：%s'
                     % (len(unresolved), '、'.join(unresolved[:8])))
    return errors, warns


# ------------------------------------------------------------ C3. 场景开口一致性
# 立这条的起因（v6.19.3）：asset-registry 的 scene.light_port 记着每个场景的采光口
# （S06 地下礼堂＝「南端主入口双开门 + 拱顶垂一串裸灯泡」，**无窗**），
# 但此前没有任何脚本读 light_port —— 「登记了却无门消费」＝等于没登记（与 MA-5 同病）。
#
# 实测代价（EP20 三版）：首镜光位都写「冷蓝自画左窗进入」，模型会自己补一扇窗；
# 而 S06 光位是跨集固定的（EP03/EP04 同场景），多一扇窗＝跨集接戏断。
# 全库 107 包实测：本门对存量 0 误报，对 EP20 三版全命中。
#
# 为什么只查「建筑开口」不查「灯」：开口是结构件，场景注册表必然记载且不可能被氛围合理化；
# 而灯（烛台 / 台灯 / 顶灯）属于可以换道具的活动光源，写死会误伤。
OPENING_WORDS = ['落地窗', '推拉窗', '天窗', '气窗', '窗', '天井', '洞口', '采光井']


def _scene_name_from_pkg(pkg_text):
    """取包里声明的第一个场景名。写镜细则要求「场景：<注册表全名>（…）」，
    实测多数旧包写成「场景：长宴席（同上）」——那种情况本门报不出结论，只提示一次。"""
    m = re.search(r'场景[：:]\s*([^\n｜|（(]+)', pkg_text)
    return m.group(1).strip() if m else None


def audit_scene_openings(pkg_text, registry=None):
    """场景开口与注册表不符：借了场景没有的建筑开口当光源。

    判据（可机械判定，零语义猜测）：
      · 场景行能唯一匹配到注册表 display_name → 该场景 light_port 里没出现的开口词，
        若在「光色 / 光源 / 光线 / 环境光」类行里出现 → ERROR（跨集一致性会断）；
      · 场景行存在但匹配不上注册表 → WARN（这是格式纪律问题：场景名必须写注册表全名）；
      · 场景行不存在 → WARN 一次（场景类检查全部无法生效，不静默）。
    """
    errors, warns = [], []
    if not registry or not os.path.isfile(registry):
        return errors, ['场景开口一致性：未提供 --registry，本门跳过（跳过不是通过）']
    try:
        d = json.load(io.open(registry, encoding='utf-8'))
    except Exception as e:
        return ['场景开口一致性：注册表解析失败 %s' % e], warns

    scenes = {}
    for _slug, v in (d.get('scenes') or {}).items():
        nm = (v or {}).get('display_name')
        lp = ((v or {}).get('light_port') or {}).get('desc') or ''
        if nm:
            scenes[nm] = (v.get('entry_no') or _slug, lp)

    name = _scene_name_from_pkg(pkg_text)
    if not name:
        return errors, ['场景开口一致性：包内找不到「场景：」行——场景类判据（含 C2 时段）无法生效，补一行注册表全名']

    hits = [n for n in scenes if n and (n in name or name in n)]
    if len(hits) != 1:
        return errors, ['场景开口一致性：场景名「%s」无法唯一匹配注册表（命中 %d 个）——'
                        '按写镜细则写注册表全名，否则 C2/C3 两道场景门都失效' % (name, len(hits))]

    nm = hits[0]
    entry_no, lp = scenes[nm]
    allowed = {w for w in OPENING_WORDS if w in lp}
    bad = {}
    for ln in pkg_text.split('\n'):
        if not re.search(r'光色|光源|光线|环境光', ln):
            continue
        for w in OPENING_WORDS:
            if w in ln and w not in allowed:
                # 「无窗 / 不见窗」是合法否定，不算借光
                if re.search(r'无窗|没有窗|不见窗|窗外?景?不|禁.{0,3}窗', ln):
                    continue
                bad.setdefault(w, ln.strip()[:60])
    for w, sample in bad.items():
        errors.append('E-SCENE-OPENING：场景「%s」（%s）的采光口是「%s」，'
                      '包里却把「%s」当光源 —— 模型会自己补一个不存在的开口，跨集光位断裂。'
                      '例：%s' % (nm, entry_no, lp or '未登记', w, sample))
    return errors, warns


# ------------------------------------------------------------ C4. 缝隙光不得当环境底
# 立这条的起因（v6.19.4）：EP20 三版都把「冷蓝自南墙门缝渗入」写成「为环境底」。
# 物理上不成立——S06 的采光口是「门缝 + 拱顶裸灯泡串」，一道门缝的进光量撑不起
# 108 人厅堂的环境照度，它只能是轮廓光/辅光。写成环境底只有两种结局：
#   ① 模型老实照做 → 全场剪影，人脸全黑；
#   ② 模型不老实 → 自造一个不明冷光源，与同场景的 EP03/EP04 光位对不上。
#
# 为什么这条能机械判：它不依赖语义猜测，只依赖两个可枚举的事实——
#   · 光源类型里有没有「缝隙类开口」（门缝/窗缝/天窗/洞口）；
#   · 同场景 light_port 里有没有「其它人造光源」（灯）；
#   · 包里有没有把这道光写成「环境底/铺满/压满/为主光」。
# 三条同时成立 → 该光不足以当底，报 WARN（「环境底」的解释空间留给人，不擅自判死）。
# 全库 107 包实测：存量 0 命中，EP20 两处命中。
SLIT_WORDS = ['门缝', '窗缝', '窗', '天窗', '洞口', '采光井', '缝隙']
LAMP_WORDS = ['灯', '烛']
AS_KEY_WORDS = ['为环境底', '环境底', '铺满', '压满', '压到主体', '为主光', '整体基调', '全片基调']


def audit_slit_light_as_key(pkg_text, registry=None):
    """缝隙光 / 窗外光被当成环境底：进光量与用法不匹配。"""
    warns = []
    if not registry or not os.path.isfile(registry):
        return [], []
    try:
        d = json.load(io.open(registry, encoding='utf-8'))
    except Exception:
        return [], []

    name = _scene_name_from_pkg(pkg_text)
    if not name:
        return [], []
    scenes = {}
    for _slug, v in (d.get('scenes') or {}).items():
        nm = (v or {}).get('display_name')
        if nm:
            scenes[nm] = ((v or {}).get('light_port') or {}).get('desc') or ''
    hits = [n for n in scenes if n and (n in name or name in n)]
    if len(hits) != 1:
        return [], []
    lp = scenes[hits[0]]

    # 该场景是否还有别的（人造）光源可以承担环境底
    if not any(w in lp for w in LAMP_WORDS):
        return [], []          # 唯一光源就是缝隙光 → 它本来就是底，不判

    for ln in pkg_text.split('\n'):
        if not re.search(r'光色|光源|光位|基调', ln):
            continue
        if any(s in ln for s in SLIT_WORDS) and any(k in ln for k in AS_KEY_WORDS):
            warns.append('W-SLIT-AS-KEY：场景「%s」的缝隙光被写成环境底 —— 该场景另有'
                         '「%s」，缝隙光进光量只够做轮廓/辅光；写成环境底会让模型要么全场剪影、'
                         '要么自造光源。例：%s'
                         % (hits[0], '、'.join(w for w in LAMP_WORDS if w in lp), ln.strip()[:56]))
    return [], warns


# ------------------------------------------------------------ F. 资产层纪律
# v6.9.1：lookbehind 补 \ 与 / ——资产编号出现在文件路径里（角色\C01_xxx.png）时，
# C01 是角色卡 id 不是色值；C 恰是合法 hex 字母，路径分隔符不排除就会整包误报。
BARE_HEX_RE = re.compile(r'(?<![0-9A-Za-z#\\/])(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})(?![0-9A-Za-z])')


def audit_asset_discipline(pkg_text, registry=None):
    """资产层可断言的纪律（v5.3.0 新增，v5.6.8 由三条扩为六条，v5.9.0 加 F7 共七条）。

    资产层 14 节里绝大多数规则仍是纯文档，这几条是**误报可控**且不需要语义理解的部分：

    F1 裸 HEX：色值必须带 `#`。裸 hex 在不同工具里会被读成别的数，v4.9.3 曾一次性
       修掉 92 处，做成门防复发。误报控制：只在「旁边有色值语义词」时才判；
       v6.9.1 再补两道——lookbehind 排除路径分隔符（\C01_ 是资产 id 不是色值，
       16x9_15s_2x0 全 24 包各 16 处误报即此因）、`#` 参数行（不进正文区）整行跳扫。
    F2 版本互锁单向加锁：只给 B 加锁忘了给 A 加锁，等于没加锁——这是串版最高频的漏项。
       需要 --registry；没给就明确报跳过，不报 OK。
    F3 道具条目数上限：系列 ≤8（见资产层 5.4）。超过只 WARN——项目级注册表可能跨多集，
       不一律算错，但要提示人工确认。
    F4 身份判定字段存在性：每个资产条目都要有 identity_verdict，缺了＝没判。
    F5 枚举合法性：只认 reuse / new_variant / new_asset / unresolved 四值。
    F7 素材形态 M0/M1/M2 与图号的一致性（v5.9.0）：M0 夹带图号 = 形态违约（ERROR）；
       M1/M2 有图号无接线单 = WARN；图号 ∉ 接线单 = ERROR；有图号无声明 = WARN。
       **不需要 --registry**，故放在早退之前。
    F7b 编号族别混用（v6.13.0 · C33-A1，来源 script-writing-studio-v2 素材自检思想——
       机制参考零拷贝）：结构化定义行（# 投喂图序 / 接线单行）内，图N 绑定的资产族别
       （S=场景 C=角色 P=道具）全包必须一致；路径目录词与前缀字母冲突同报。
    F6 未决禁止出图：identity_verdict == unresolved 且已落盘 outputs → ERROR。
       资产层 5.3 明写的硬规则。未决条目按定义还没有确定外观，出了图就是凭猜测生成的
       参考图，一旦被 B 门认作合法资产锚会反向坐实错误身份。

    ⚠️ F4/F5/F6 只查形式不查内容：不判断该判 reuse 还是 new_asset（那需要语义理解，
       CHANGELOG v5.3.0 已明写身份判定不做成门，本次不改），只保证「判了、判得合法、
       未决不许出图」这三条零误报的字段级断言。
    """
    errors, warns = [], []

    # F1 裸 HEX
    # v6.19.3 收紧：原式 `[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3}` 把 3 位 alnum 一律当色值，
    # 实测在 EP20 三版里把「108 名参与者」的 108、「AAA 三维游戏渲染」的 AAA 判成裸 hex——
    # 2 个假阳性混在 4 个 ERROR 里，噪声率 50%，真错（图号跨族复用）反而被淹。
    # 新判据：只认 6 位，且必须「同时含数字与字母」（真·十六进制色的形态），
    # 上下文窗口从 ±12/6 收到同句内 ±10，并要求出现色值专义词。
    CTX = ('色值', 'HEX', 'hex', '色板')
    HEX6 = re.compile(r'(?<![0-9A-Za-z#\\/])([0-9A-Fa-f]{6})(?![0-9A-Za-z])')
    _line_starts = [0] + [i + 1 for i, ch in enumerate(pkg_text) if ch == '\n']
    import bisect as _bisect
    for m in HEX6.finditer(pkg_text):
        tok = m.group(1)
        if not (re.search(r'\d', tok) and re.search(r'[A-Fa-f]', tok)):
            continue  # 纯数字 / 纯字母的 6 位串不是色值（如 202610、AAAAAA 标语）
        _li = _bisect.bisect_right(_line_starts, m.start()) - 1
        _le = pkg_text.find('\n', _line_starts[_li])
        if _le < 0:
            _le = len(pkg_text)
        _line = pkg_text[_line_starts[_li]:_le]
        if _line.lstrip().startswith('#'):
            continue  # v6.9.1：# 参数行（不进正文区）不参与色值双轨
        s = pkg_text[max(0, m.start() - 10):m.end() + 10]
        if any(w in s for w in CTX):
            errors.append('第 %d 行：色值「%s」缺 # 前缀（色值双轨要求写 #HEX）；'
                          '裸 hex 在不同工具里会被读成别的数' % (_li + 1, m.group(0)))

    # F7 素材形态（M0/M1/M2）与图号的一致性（v5.9.0 新增 · 对齐上游「闸门 6」）
    # 为什么要这一条：liqi 资产层长期**隐含「图要在册」**，但真实工作流是
    # 「本包出提示词 → 用户自己拿去 Seedream 跑图 → 图留在用户平台侧」——图从不进本包上下文。
    # 于是出现两种形态违约：M0 交付里夹带图号（用户没有图，号是凭空写的）、
    # M1 交付里图号与《素材接线单》对不上（用户不知道该挂哪张）。
    # F7 不需要注册表，故放在 `if not registry` 之前——M 轴与注册表无关。
    _mode_m = re.search(r'素材形态\s*[:：]\s*(M[012])', pkg_text)
    _mode = _mode_m.group(1) if _mode_m else None
    _FIG_BODY_RE = re.compile(r'@?图片\s*(\d+)')
    _FIG_ROW_RE = re.compile(r'^\s*\|\s*图\s*(\d+)\s*\|', re.M)
    _figs = set(_FIG_BODY_RE.findall(pkg_text)) | set(_FIG_ROW_RE.findall(pkg_text))
    _sheet_m = re.search(r'(?:#{1,6}\s*)?素材接线单([\s\S]{0,8000})', pkg_text)
    _has_sheet = bool(_sheet_m)
    _sheet_figs = set(_FIG_ROW_RE.findall(_sheet_m.group(1))) if _has_sheet else set()

    if _mode == 'M0' and _figs:
        errors.append('素材形态声明为 M0（纯提示词），但稿中出现图号 %s——**形态违约**。'
                      'M0 下不出现任何图号槽位，一致性全靠文字锁；要么删干净图号，'
                      '要么把首行声明改成 M1 并补《素材接线单》。见 '
                      '`references/资产层_锁定与一致性.md` 素材形态节'
                      % '、'.join('图%s' % f for f in sorted(_figs)))
    elif _mode in ('M1', 'M2'):
        # ⚠️ 无接线单与「图号不在接线单内」是**同一根因**（接线单缺席），
        # 两条都报会变成同一件事说两遍（照 N1 乱序/缺号的处理口径只报一条）。
        # 故：无接线单只报 WARN；有接线单才逐号比对。
        if not _has_sheet:
            if _figs:
                warns.append('素材形态 M%s 且稿中出现图号，但**未附《素材接线单》**——'
                             '用户不知道每个图号该挂哪张。M1/M2 交付必附，见 '
                             '`references/资产层_锁定与一致性.md` 素材形态节' % _mode[1])
            else:
                warns.append('素材形态声明为 M%s（编号占位），但稿中既无图号也无《素材接线单》'
                             '——**声明与实际不符**。确认是否该改声明为 M0' % _mode[1])
        else:
            _orphan = _figs - _sheet_figs
            if _orphan:
                errors.append('图号 %s 不在《素材接线单》内——**图号与接线单不一致**。'
                              '提示词里出现的每个图号，接线单都必须有一行；'
                              '接线单每行提示词也至少要引用一次（未引用标「本次未使用」）'
                              % '、'.join('图%s' % f for f in sorted(_orphan)))
            if not _figs:
                warns.append('素材形态声明为 M%s（编号占位），但稿中一个图号都没有——'
                             '**声明与实际不符**。确认是否该改声明为 M0' % _mode[1])
    elif _figs:
        warns.append('稿中出现图号但**未声明素材形态**——形态未定则一致性靠什么无从核对。'
                     '按 `references/资产层_锁定与一致性.md` 素材形态节，'
                     '交付首行必须写 `素材形态：M0/M1/M2`（M1 为默认）')

    # F7b 编号族别混用（v6.13.0 · C33-A1，来源 script-writing-studio-v2 素材自检思想——机制参考零拷贝）
    # 只查**结构化定义行**：# 投喂图序 参数行、素材接线单表格行。每行按 | ｜ 分格，
    # 格内同时出现 图N 与资产 id（S01/C01/P02 式大写字母+短数字）时记录 图N→族别字母。
    # 两道判据：① 同一图N 全包绑定两个族别字母 = 混用（茅山道士 S5.6.7 的「图指错族」近亲）；
    # ② 路径目录词（场景/角色/道具）与 id 前缀字母双双可判且冲突（如 角色\S03）。
    # 族别表只收 S/C/P——未知前缀不判，防误报；正文散文提及不扫（噪声不可控）。
    _FAM_DIR = {'S': '场景', 'C': '角色', 'P': '道具'}
    _ID_TOK_RE = re.compile(r'(?<![A-Za-z0-9#])([SCP])(\d{1,3})(?![0-9A-Za-z])')
    _fig_fam = {}
    _sheet_pos = pkg_text.find('素材接线单')
    _offset = 0
    for _li, _ln in enumerate(pkg_text.split('\n'), 1):
        _ls = _ln.strip()
        _in_sheet = 0 <= _sheet_pos <= _offset <= _sheet_pos + 8000
        _offset += len(_ln) + 1
        _is_seq = _ls.startswith('#') and '投喂图序' in _ls
        _is_sheet_row = _ls.startswith('|') and '图' in _ln and _in_sheet
        if not (_is_seq or _is_sheet_row) or '图' not in _ln:
            continue
        for _cell in re.split(r'[|｜]', _ln):
            _fm = re.search(r'图\s*(\d+)', _cell)
            if not _fm:
                continue
            _fig = _fm.group(1)
            _letters = {lt for lt, _ in _ID_TOK_RE.findall(_cell)}
            if not _letters:
                continue
            _prev = _fig_fam.setdefault(_fig, {})
            for _lt in _letters:
                _prev[_lt] = _prev.get(_lt, 0) + 1
            if len(_letters) > 1:
                _names = '、'.join('%s=%s' % (lt, _FAM_DIR[lt]) for lt in sorted(_letters))
                errors.append('第 %d 行：图%s 同时绑定多个资产族别（%s）——**编号族别混用**。'
                              '道具、角色、场景编号不能混用；一张图只服务一个族'
                              % (_li, _fig, _names))
                continue
            _lt = next(iter(_letters))
            _dirs_here = [d for d in _FAM_DIR.values() if d in _cell]
            if _lt in _FAM_DIR and len(_dirs_here) == 1 and _dirs_here[0] != _FAM_DIR[_lt]:
                errors.append('第 %d 行：图%s 路径目录「%s」与编号前缀 %s（%s 族）冲突'
                              '——**编号族别混用**。目录词与编号前缀必须同族'
                              '（S=场景 / C=角色 / P=道具）'
                              % (_li, _fig, _dirs_here[0], _lt, _FAM_DIR[_lt]))
    for _fig, _fams in sorted(_fig_fam.items()):
        if len(_fams) > 1:
            _names = '、'.join('%s=%s' % (lt, _FAM_DIR[lt]) for lt in sorted(_fams))
            errors.append('图%s 在全包绑定多个资产族别（%s）——**编号族别混用**。'
                          '一张图只服务一个族；跨段复用同图时职责必须同族'
                          % (_fig, _names))

    if not registry:
        warns.append(_skip_msg(
            '未给 --registry，F2—F6 因此跳过',
            kind=SKIP_INPUT,
            hint='传 --registry 可查版本互锁是否双向加锁、道具条目是否超上限、'
                 '身份判定字段是否落盘且合法'))
        return errors, warns

    import json
    try:
        data = json.load(io.open(registry, encoding='utf-8'))
    except Exception as e:
        errors.append('读注册表失败：%s' % e)
        return errors, warns

    # F2 版本互锁双向
    # ⚠️ 2026-10-14 实战修正：原版只在 characters 里找条目，导致 props / creatures
    # 的版本对一律被判「至少一版没写 lock_out」——那是**查找路径不足**，不是真的单向加锁。
    # 现在按 characters → props → creatures 三处依次查；三处都没有该 slug 时，
    # 报「注册表里找不到该条目」这一条独立诊断，不冒充互锁错误。
    # ⚠️ 2026-10-14（v5.6.2）再补 scenes：`资产注册表_asset-registry.md` 明写「场景的时段
    # 变体本质就是多版本，同样适用双向加锁规则」，但本门此前不认 scenes 桶——
    # 场景变体一旦按文档登记进 lock_matrix 就报「注册表里找不到条目」，是**假错**。
    # 同时版本容器改为按类型取：characters→versions / scenes→variants。
    buckets = [(data.get('characters') or {}), (data.get('props') or {}),
               (data.get('creatures') or {}), (data.get('scenes') or {})]

    def find_entry(slug):
        for b in buckets:
            if slug in b:
                return b[slug]
        return None

    matrix = data.get('lock_matrix') or []
    for pair in matrix:
        pr = pair.get('pair') or []
        if len(pr) != 2:
            continue
        got = []
        for ref in pr:
            slug, _, ver = ref.partition('.')
            entry = find_entry(slug)
            if entry is None:
                errors.append('版本对 %s：注册表里找不到条目「%s」——'
                              'lock_matrix 引用了不存在的资产，先对齐注册表结构'
                              % (' / '.join(pr), slug))
                got = []
                break
            vers = {}
            # 版本容器按类型取：characters→versions / scenes→variants。
            # v5.6.7 再补 damage_states（场景状态/破坏变体）：墙被撞穿、血迹、灰烬、撕裂这类
            # 「事件造成的物理改变」原先无处登记，只能混进 variants 或干脆不登记——不登记的后果
            # 是下一镜参考图指回未破坏的状态，画面凭空复原。它是第三类漂移，与时段变体并列。
            # 三者可能同时存在于同一条目（场景既有 variants.night 又有 damage_states.wall_breach），
            # 故合并取，不能写 `a or b or c`（会只取第一个非空桶，把后两者整个吞掉）。
            for _k in ('versions', 'variants', 'damage_states'):
                for _kk, _vv in (entry.get(_k) or {}).items():
                    if not _kk.startswith('_') and isinstance(_vv, dict):
                        vers[_kk] = _vv
            if ver:
                v = vers.get(ver) or {}
            elif len(vers) == 1:
                v = list(vers.values())[0]
            else:
                # 无版本号的条目（如两个独立道具）：lock_out 写在条目顶层
                v = entry
            got.append((ref, [str(x) for x in (v.get('lock_out') or [])]))
        if len(got) == 2 and (not got[0][1] or not got[1][1]):
            errors.append('版本对 %s：至少一版没写 lock_out——单向加锁等于没加锁，'
                          '两边都要写对方特征' % ' / '.join(x[0] for x in got))

    # F3 道具条目数上限（系列 ≤8）：超过只 WARN——项目级注册表可能跨多集，
    # 不一律算错，提示人工确认。v5.38.1 补实现（此前只有 docstring 与 hint 提及）。
    _props_n = len(data.get('props') or {})
    if _props_n > 8:
        warns.append('道具条目数 %d，超过系列上限 8（关键道具准入门三问，见 '
                     '`references/资产层_锁定与一致性.md` 5.4）——'
                     '项目级注册表可能跨多集，确认是否有条目该拆分或降为非关键道具。'
                     % _props_n)

    # F4/F5/F6 身份判定三断言（v5.6.8）
    # ⚠️ 先说清为什么这里只做三条、不做「判定」本身：
    #   CHANGELOG v5.3.0 把身份判定列进「不做成门的」——判「持续身份是否相同」需要语义理解，
    #   强行做会造出假绿门，那个取舍是对的，本次不改。
    #   但**下面三条是纯字段判断、零语义、零误报**，此前却被一并归进"不做"里，属于决策的
    #   过度延伸：判定需要语义 ≠ 连字段有没有写、值合不合法都不能查。
    #   只查形式不查内容——不判断该判 reuse 还是 new_asset，只保证「判了、判得合法、未决不许出图」。
    VERDICTS = ('reuse', 'new_variant', 'new_asset', 'unresolved')

    # F4 字段存在性：每个资产条目都要有判定结果，缺了＝没判
    for bname in ('characters', 'props', 'creatures', 'scenes'):
        bucket = data.get(bname) or {}
        for slug, entry in bucket.items():
            if not isinstance(entry, dict):
                continue
            if 'identity_verdict' not in entry:
                errors.append('%s.%s 缺 identity_verdict——身份判定结果没落盘。'
                              '四选一：reuse 复用 / new_variant 新变体 / new_asset 新资产 / '
                              'unresolved 未决（见资产层第五节 5.3）' % (bname, slug))

    # F5 枚举合法性：写 unknown / 中文「未决」/ 拼错的 new_varient 此前全部静默通过
    for bname in ('characters', 'props', 'creatures', 'scenes'):
        bucket = data.get(bname) or {}
        for slug, entry in bucket.items():
            if not isinstance(entry, dict) or 'identity_verdict' not in entry:
                continue
            val = entry.get('identity_verdict')
            if val not in VERDICTS:
                errors.append('%s.%s 的 identity_verdict=「%s」不在四值内——'
                              '只认 %s。写成同义词或拼错会让下游整条判定链失效'
                              % (bname, slug, val, ' / '.join(VERDICTS)))

    # F6 未决禁止带默认 ID 出图：这是资产层 5.3 明写的硬规则。
    #    判据纯字段组合：identity_verdict == unresolved 且条目已落盘（有 outputs）。
    #    「未决」的本意是证据不足、挂起——按定义它还没有确定外观，出了图就是一张凭猜测生成的
    #    参考图；一旦被 B 门认作合法资产锚，会反向坐实错误身份，返工是全线的。
    def _has_outputs(node):
        if not isinstance(node, dict):
            return False
        if node.get('outputs'):
            return True
        # 角色的 outputs 挂在 versions.* 层，场景的挂在 variants.* / damage_states.* 层
        for k in ('versions', 'variants', 'damage_states'):
            for vv in (node.get(k) or {}).values():
                if isinstance(vv, dict) and vv.get('outputs'):
                    return True
        return False

    for bname in ('characters', 'props', 'creatures', 'scenes'):
        bucket = data.get(bname) or {}
        for slug, entry in bucket.items():
            if not isinstance(entry, dict):
                continue
            if entry.get('identity_verdict') == 'unresolved' and _has_outputs(entry):
                errors.append('%s.%s 判定未决（unresolved）却已有落盘 outputs——'
                              '未决条目禁止带默认 ID 进 4 View 出图（资产层 5.3）。'
                              '要么补齐证据重新判定，要么删掉 outputs 并挂起'
                              % (bname, slug))

    # F8 软肋物挂靠（v5.20.0）：叙事层纪律「软肋锚点=物」——每个主要角色的软肋
    # 必须挂在一个已登记的物上（characters.*.softspot 指向 props 桶条目，且该条目
    # category == softspot）。查两向：
    #   ① character.softspot 指向的 prop 不存在 → WARN（软肋物没进资产清单，
    #      下游指「没登记的道具」处理，跨镜必漂）；
    #   ② props 里 category=softspot 的条目没有任何 character 引用 → WARN
    #      （挂了类的孤物，多半是分类手滑）。
    # 纯字段零语义：不判断「该不该拿它当软肋」（那是叙事层人工判据），
    # 只保证「说了是软肋物，就得在册、就得有人挂」。
    _chars = data.get('characters') or {}
    _props = data.get('props') or {}
    _soft_props = {s2 for s2, e in _props.items()
                   if isinstance(e, dict) and e.get('category') == 'softspot'}
    _referenced = set()
    for slug, entry in _chars.items():
        if not isinstance(entry, dict):
            continue
        sp = entry.get('softspot')
        if not sp:
            continue
        # 容忍两种写法：bare slug（lie-toukui）或 props/ 前缀路径（props/lie-toukui）——
        # 注册表示例用路径写法（与 reference_files 一致），桶键是 bare slug，故归一化后再比。
        sp_key = sp.split('/')[-1] if '/' in sp else sp
        _referenced.add(sp_key)
        if sp_key not in _props:
            warns.append('W-ASSET-SOFTSPOT-DANGLING 角色 %s 的 softspot 指向「%s」，'
                         '但 props 桶里没有这个条目——软肋物必须先登记进资产清单'
                         '（category: softspot，见资产层道具分类），'
                         '否则下游按未登记道具处理，跨镜必漂' % (slug, sp))
        elif sp_key not in _soft_props:
            warns.append('W-ASSET-SOFTSPOT-CATEGORY 角色 %s 的软肋物「%s」已登记，'
                         '但 category 不是 softspot——软肋物与关键道具同权不同类，'
                         '分类写错会被关键道具的数量上限与准入门三问误判' % (slug, sp))
    for s2 in sorted(_soft_props - _referenced):
        warns.append('W-ASSET-SOFTSPOT-ORPHAN 道具 %s 标了 category=softspot，'
                     '但没有任何角色的 softspot 字段引用它——孤物多半是分类手滑，'
                     '确认是漏挂还是该改回 key' % s2)

    return errors, warns


# ------------------------------------------------------------ N. 剧本量化门禁
# v5.8.1 新增。规范见 references/叙事层_剧本门控与台词.md §6.5。
#
# 上游是「阶段门禁 + 锁稿二十五项质量门」，那套为长剧多批次设计；
# liqi 只吸收**能变成数值且能机械核对**的三条，其余明写「人工核对」，
# 不冒充机检——做成门却查不出东西，比不做更危险。
#
# ⚠️ 三条全是「没标就不算通过」口径：情节点没标注 / 改编稿没做事实权威链标注 →
#    报「无法核对」，绝不把「没查」显示成「通过」（与 Z 门、S22、G7 同一口径）。

# 场序号：只认行首的场头（「场 3」「第 3 场」「场景 3」），避免正文叙述里的「第三场比试」被算进来
SCENE_NO_RE = re.compile(r'^\s*(?:第\s*([0-9一二三四五六七八九十百零]+)\s*场'
                         r'|场\s*([0-9一二三四五六七八九十]+)'
                         r'|场景\s*([0-9一二三四五六七八九十]+))')
# 情节点标注：行首「情节点：」或括号注记「（情节点：…）」
BEAT_MARK_RE = re.compile(r'(?:^|\s|（|\()情节点\s*[：:]')
# 事实权威链五级
FACT_TAGS = ('FACT', 'INFERENCE', 'ASSUMPTION', 'USER_OVERRIDE', 'OPEN_ITEM')

CN_DIGITS = {'零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
             '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}


def _cn_num(s):
    """中文数字 → int。只支持 1~99 的常用写法，解析不出返回 None（不猜）。"""
    s = s.strip()
    if re.fullmatch(r'\d+', s):
        return int(s)
    if s in CN_DIGITS:
        return CN_DIGITS[s]
    m = re.fullmatch(r'(?:([一二三四五六七八九])?十)?([一二三四五六七八九])?', s)
    if not m or not s:
        return None
    tens, ones = m.group(1), m.group(2)
    if tens is None and ones is None:
        return None
    return (CN_DIGITS.get(tens, 0) if tens else 10 if s.startswith('十') else 0) * 10 \
        + (CN_DIGITS.get(ones, 0) if ones else 0)


def audit_script_gates(script_path, total_seconds=0.0, adapt=False):
    """N1 场序号 / N2 情节点密度 / N3 事实权威链标注。

    N1 重复编号 = ERROR（同一编号两个场 = 下游会当成两条实体，是 liqi 资产层最贵的返工）；
       缺号 / 乱序 = WARN（可能是场次删并，需人工确认，不能替人下结论）。
    N2 情节点是**语义概念**，机检只能数标注。不标注 → 报「无法核对」，不猜。
    N3 改编稿未做五级标注 → 报「无法核对」。
    """
    errors, warns = [], []
    if not script_path:
        warns.append(_skip_msg(
            '未提供 --script，N 门因此跳过',
            kind=SKIP_INPUT,
            hint='传 --script <剧本.txt> 可查场序号连续性与情节点密度'))
        return errors, warns
    try:
        lines = [l.rstrip() for l in open(script_path, encoding='utf-8')]
    except Exception as e:
        errors.append('读剧本失败：%s' % e)
        return errors, warns

    # ---- N1 场序号
    seq = []
    raw_hits = []
    for i, l in enumerate(lines, 1):
        m = SCENE_NO_RE.match(l)
        if not m:
            continue
        raw = next(g for g in m.groups() if g)
        n = _cn_num(raw)
        raw_hits.append((i, raw))
        if n is None:
            warns.append('N1 第 %d 行场序号「%s」解析不出数字——用阿拉伯数字写场序号'
                         '（机检不猜中文数字的复杂写法）' % (i, raw))
            continue
        seq.append((n, i))
    if seq:
        dup = {}
        for n, i in seq:
            dup.setdefault(n, []).append(i)
        for n, ls in sorted(dup.items()):
            if len(ls) > 1:
                errors.append('N1 场序号 %d 重复出现在第 %s 行——同一编号两个场，'
                              '下游资产层会当成两条实体分别建资产'
                              % (n, '、'.join(str(x) for x in ls)))
        nums = [n for n, _ in seq]
        bad_order = [('%d(行%d)' % (b, lb)) for (a, la), (b, lb) in zip(seq, seq[1:]) if b < a]
        if bad_order:
            warns.append('N1 场序号乱序：%s。场次顺序即时间顺序，乱序会让因果链核对失效'
                         % '、'.join(bad_order))
        else:
            # 乱序时缺号多半是同一个根因（场被挪位），一并报会变成两条噪声
            missing = [x for x in range(min(nums), max(nums) + 1) if x not in set(nums)]
            if missing:
                warns.append('N1 场序号缺号：%s。删并场次请补注记，'
                             '否则下游按缺号读会以为漏场'
                             % '、'.join(str(x) for x in missing))
    elif raw_hits:
        warns.append('N1 有 %d 处场头但序号全解析不出数字——改用「场 3」这类写法'
                     % len(raw_hits))

    # ---- N2 情节点密度
    n_beat = sum(1 for l in lines if BEAT_MARK_RE.search(l))
    if n_beat == 0:
        warns.append(_skip_msg(
            'N2 全剧 0 处情节点标注，密度无法核对',
            kind=SKIP_INPUT,          # 缺的是剧本里的标注，补标注再跑；不是缺参数
            hint='情节点是语义概念，机检只能数标注：用「情节点：…」或「（情节点：…）」'
                 '标出每一处意图变化 / 关系变化 / 信息翻转，再跑本门'))
    else:
        if n_beat < 5:
            warns.append('N2 情节点 %d 个，少于单集下限 5 个——一集里观众能记住的转折不足，'
                         '节奏必然发闷。低于 5 个判回炉（见叙事层 §6.2）' % n_beat)
        if total_seconds > 0:
            per15 = n_beat / (total_seconds / 15.0)
            if per15 < 1:
                warns.append('N2 情节点密度 %.2f 个 / 15s，低于 1——'
                             'AI 视频每段独立生成，一个 15s 段里没有任何情节点，'
                             '出片就是一段好看的空镜（全片 %.0fs · %d 个情节点）'
                             % (per15, total_seconds, n_beat))
        else:
            warns.append('N2 未拿到全片时长，15s 段密度这一项跳过——'
                         '传包后按块时长自动汇总，或人工核对（不是通过）')

    # ---- N3 事实权威链（仅改编类）
    if adapt:
        txt = '\n'.join(lines)
        hit = [t for t in FACT_TAGS if t in txt]
        if not hit:
            warns.append(_skip_msg(
                'N3 改编类任务全剧 0 处事实权威链标注，无法核对',
                kind=SKIP_INPUT,      # 同 N2：缺的是标注，补标注再跑
                hint='每处「原作没写明」的都要标 FACT / INFERENCE / ASSUMPTION / '
                     'USER_OVERRIDE / OPEN_ITEM 五级之一，否则模型推断会被当成原作事实'
                     '写进正文（见叙事层 §6.4）'))
    return errors, warns


# ------------------------------------------------------------ G. 连续性台账对账
# v5.7.2 新增。规范见 references/连续性台账.md。
#
# 与 C / C2 门的分工：C 门判「同一镜同时出现两个版本名」、C2 门判「声明时段 T
# 却写了 T.lock_out 里的词」——两门都只在**提示词内部**找自相矛盾。
# G 门是**拿外部事实源去核提示词**：台账说持刀、提示词说空手，两边各自都不矛盾，
# 放一起才矛盾。这一类 C/C2 查不到，所以不能合并进它们。
#
# 与方位卡的分工：方位卡管**不变的空间基准**，台账管**会变的状态**。
# 本门不查站位/朝向（需要语义理解，误报不可控），只查可字符串比对的三类：
# 持物（G1/G2/G3）、角色登记（G4）、时段（G5）。

LEDGER_HEAD_RE = re.compile(r'^#{1,6}\s*(?:段|镜|场|U)\s*(\d+[A-Za-z]?)｜(.*)$')
# G5 兜底用的时段声明行取值（只认时段字段，不认「时间：00:00」这类时间码）
DECL_TIME_RE = re.compile(r'^\s*(?:时间线锚点|时间锚点|时段)\s*[：:]\s*(.+)$')
LEDGER_SECTION_RE = re.compile(r'^(人物账|场景账|时间轴账|变更)\s*[：:]?')
LEDGER_NAME_RE = re.compile(r'@([^\s（(·,，、｜:：]{1,12})')
FIELD_RE = re.compile(r'^([^：:｜]{1,8})\s*[：:]\s*(.*)$')

# 持物字段的别名（台账里写哪个都认）
HOLD_KEYS = ('持物', '道具持拿', '手持')
# 台账侧的「空手值」
EMPTY_HOLD_VALS = ('无', '空手', '徒手', '未持物', '空', '—', '-', 'none')
# 提示词侧的「空手词」（G1 只在明写这些词时报，不因「没写」而报）
EMPTY_HAND_WORDS = ('空手', '徒手', '未持物', '两手空', '双手空', '两手空空')
# 交接词：出现即视为「有交代」，G1/G2 都不再报（离手必有落点，落点可以是画外）
HANDOVER_WORDS = ('递给', '交给', '交还', '递还', '接过', '接住', '放下', '收起',
                  '收入', '入鞘', '插回', '挂回', '掉落', '打落', '脱手', '抛下',
                  '拾起', '拾回', '交换', '递出', '抽出', '拔出')
# 变更行里认的字段名
CHANGE_FIELD_WORDS = ('持物', '道具持拿', '手持', '姿态', '服装', '造型', '站位', '朝向')
# G2 的景别豁免：大远景(1) 与大特写(9)/特写(8) 下道具本就入不了画或看不清，
# 写了反而污染画面——不提示。档位见 SHOTSIZE_WORDS。
G2_SIZE_SKIP = (1, 8, 9)


def _hold_needles(hold):
    """持物值 → 在提示词里要搜到的词。

    台账写「右手·桃木剑」，提示词多半只写「桃木剑」。取**最长分词**兜底：
    分词按长度取最长者（最具体），避免「右手结印」这种只命中「右手」的假通过。
    台账与包用词不一致会报 G2——那不是误报，用词不一致本身就是漂移源，
    统一用词即可消掉。
    """
    out = [hold]
    toks = [t for t in re.split(r'[·、,，/／\s]+', hold) if len(t) >= 2]
    if toks:
        out.append(max(toks, key=len))
    return [x for x in dict.fromkeys(out) if x]


def _char_ctx(body, name, others=()):
    """该角色在本镜块里的「自己的语境」。

    = 每一处 `@name` 起、到下一个 `@` / `；` / `;` / 行末为止的片段，
      外加**提到 name 但没有 @锚点的行**里属于该角色的那一段。

    ⚠️ 为什么必须收窄到这个范围（G1 是 ERROR 级，踩过两次假错）：
      · 按整块找空手词 →「@长风（持剑）；@清羽（空手）」里的「空手」算到长风头上；
      · 改成按 `@name` 收窄后，时间轴行「长风挥剑，清羽空手避让」整行仍会被算进
        长风的语境——**同一个假错换了个入口**。
      故无 @锚点的行要按**其他角色名**再切一次，只留含 name 的段。
    """
    ctx = []
    for line in body.split('\n'):
        idx = 0
        while True:
            j = line.find('@' + name, idx)
            if j < 0:
                break
            k = len(line)
            for sep in ('@', '；', ';'):
                p = line.find(sep, j + 1 + len(name))
                if p > 0:
                    k = min(k, p)
            ctx.append(line[j:k])
            idx = max(k, j + 1)
        if ('@' + name) not in line and name in line:
            seg = line
            for o in others:
                if o != name:
                    seg = seg.replace(o, '\n')
            for s in seg.split('\n'):
                if name in s:
                    ctx.append(s)
    return '\n'.join(ctx)


def parse_ledger(text):
    """解析 continuity-ledger.md。

    返回 [{'num': '1', 'title': '…', 'chars': {名: {'持物': '…', …}},
            'scene': {'时段': '夜', …}, 'changes': ['beat-2 ｜ @长风 …', …]}, …]

    ⚠️ 只解析 md 列表形（规范第六节）。JSON 版是给外部工具对接的并行产物，
       不参与本门。
    """
    entries = []
    for p in re.split(r'\n(?=#{1,6}\s*(?:段|镜|场|U)\s*\d+[A-Za-z]?｜)', text):
        head = p.split('\n', 1)[0]
        m = LEDGER_HEAD_RE.match(head)
        if not m:
            continue
        chars, scene, changes = {}, {}, []
        cur = None
        for line in p.split('\n')[1:]:
            s = line.strip()
            if not s or s.startswith('```'):
                continue
            ms = LEDGER_SECTION_RE.match(s)
            if ms:
                cur = ms.group(1)
                continue
            if s[:1] in ('-', '*', '·', '•'):
                s = s[1:].strip()
            if not s:
                continue
            if cur == '变更':
                changes.append(s)
                continue
            if s.startswith('@'):
                nm = LEDGER_NAME_RE.match(s)
                if not nm:
                    continue
                name = nm.group(1)
                rec = chars.setdefault(name, {})
                for chunk in s.split('｜'):
                    fm = FIELD_RE.match(chunk.strip())
                    if not fm:
                        continue
                    key = fm.group(1).strip()
                    for k in HOLD_KEYS:                     # 别名归一到「持物」
                        if key == k:
                            key = '持物'
                    rec[key] = fm.group(2).strip()
                continue
            if cur == '场景账':
                fm = FIELD_RE.match(s)
                if fm:
                    scene[fm.group(1).strip()] = fm.group(2).strip()
        entries.append({'num': m.group(1), 'title': m.group(2).strip(),
                        'chars': chars, 'scene': scene, 'changes': changes})
    return entries


# ------------------------------------------------------------ S23/S24 打戏跨镜构成
# v5.8.0 新增。逐镜的九码在 check_prompt.mjs（W-COMBAT-*），这两项必须跨镜判：
#   「每 2 镜至少 1 镜全身档」与「贴脸档连续 ≤2 镜」都依赖**相邻关系**，逐镜脚本看不见。
# 上游来源：老李 sd-combat-engine/references/combat-rhythm-and-load-guardrails.md §三。
# ⚠️ 两级都是 WARN，永不作 P0 FAIL——**不得为消除告警而把打戏改呆**（禁止把连续的近景对招
#   拉开成远景，那是把「呆板」当合规）。

COMBAT_TITLE_RE = re.compile(r'打斗|交手|缠斗|对决|混战|厮杀|格斗|大战|激战')
COMBAT_GENRE_RE = re.compile(
    r'taekwondo|boxing|karate|judo|wrestling|muay\s*thai|mma|kung\s*fu|fencing|swordplay'
    r'|拳击|跆拳道|剑道|剑戟|武术|格斗|摔跤|柔道|散打|搏击|对打|交锋', re.I)
TIER_DECL_RE = re.compile(
    r'【打戏声明】\s*[：:]?\s*R([0-3])\s*(?:[·•・\-—|｜,，、]\s*([^\n【]*))?')
# 全身档：能看清身体重心与双脚位置的景别（9 档中的 1~5 档）
FULLBODY_TIERS = (1, 2, 3, 4, 5)
# 贴脸档：只见接触点、不见重心（中近景 / 近景 / 特写 / 大特写）
CLOSEUP_TIERS = (6, 7, 8, 9)
# 豁免 S23/S24 的戏型：这些戏型不按单人贴身几何模板判
COMPOSE_EXEMPT_RE = re.compile(
    r'群战|混战|围杀|对军|乱斗|枪战|狙击|暗杀|追车|儿童'
    r'|术法对轰|远程法术|法阵|对波|万剑归宗|法术'
    r'|大场面|法相|法天象地|巨兽|清场')


def audit_combat_composition(shots, mode='auto'):
    """S23 全身景别不足 / S24 贴脸档连排 >2 镜。

    打戏的说服力来自**身体力学**：蹬地、转胯、腰、肩、手的完整发力链与重心转移。
    全身档是唯一能同时看见「重心」与「位移量」的景别；贴脸档只看得见接触点，
    动作就会读作「原地乱动 / 撞来撞去」。

    ⚠️ 未解析出景别的镜**计入分母、不计入分子**（与 S22 同口径），占比永远可算。
    """
    errors, warns = [], []
    combat = []
    exempt = False
    for num, title, dur, block in shots:
        dm = TIER_DECL_RE.search(block)
        if dm and dm.group(1) == '0':
            continue                       # 显式声明无打戏 → 不算打戏块
        if not (COMBAT_TITLE_RE.search(title) or COMBAT_GENRE_RE.search(block)):
            continue
        combat.append((num, title, dur, block))
        if dm and COMPOSE_EXEMPT_RE.search(dm.group(2) or ''):
            exempt = True
    if mode == 'off' or not combat:
        return errors, warns

    leaves = [s for s in combat if re.search(r'(?:#|【参数】)\s*duration:', s[3])]
    if not leaves:
        # 与 S22 同口径：统计不到真镜头就明说空跑，不报 OK
        warns.append('S23 打戏构成统计失效：有 %d 个打戏块但都不含 duration 参数行，'
                     '无法识别哪些是真镜头。本门没有真正查过，不算通过。'
                     '文戏包请用 --combat off 关闭本门' % len(combat))
        return errors, warns

    metas = []
    unresolved = []
    for num, title, dur, block in leaves:
        size, _a, _m, _f = _parse_shot_meta(block)
        metas.append((num, title, size))
        if size is None:
            unresolved.append(str(num))

    n = len(metas)
    full = [x for x in metas if x[2] in FULLBODY_TIERS]
    need = (n + 1) // 2
    if not exempt and len(full) < need:
        warns.append('S23 打戏全身景别不足：%d 个打戏镜里只有 %d 个全身档，少于 %d（每 2 镜至少 1 镜）。'
                     '全身档（大远景/远景/全景/中全景/中景）是唯一能同时看见重心与位移量的景别，'
                     '缺了它动作就读作「原地乱动」' % (n, len(full), need))

    # S24 贴脸档连排
    if not exempt:
        run, worst = 0, []
        for num, title, size in metas:
            if size in CLOSEUP_TIERS:
                run += 1
                worst.append(num)
                if run > 2:
                    break
            else:
                run, worst = 0, []
        if run > 2:
            warns.append('S24 打戏贴脸档连排 %d 镜（镜 %s），超过 2 镜上限——'
                         '第三镜必须切回全身档，否则观众丢失空间参照'
                         % (run, '、'.join(worst)))

    if unresolved:
        warns.append('S23 有 %d 个打戏镜解析不出景别（镜 %s）：计入分母不计入分子，'
                     '占比可算但召回下降——段头补「镜头：中景 固定」这类景别词'
                     % (len(unresolved), '、'.join(unresolved)))
    return errors, warns


def audit_continuity_ledger(pkg_text, shots, ledger_path, extra_labels=None):
    """G1~G7：台账与提示词包对账。

    七码见 references/连续性台账.md 第七节。三条防误报：
      · G1 只在提示词**明写空手**时报，没写走 G2 的 WARN；
      · G3 只比对台账文件里**相邻两条**，跨段本就可能切场；
      · G5 只比时段标签，不比光照词（那层语义归 C2 门的 lock_out）。

    G7 是假绿防护：解析不出条目时 G1~G6 全返回零命中，一眼看去是绿的——
    那是最危险的一种绿，必须与 Z 门、S22 一样明说「空跑不算通过」。
    """
    errors, warns = [], []
    if not ledger_path:
        warns.append(_skip_msg(
            '未给 --ledger，G 门因此跳过',
            kind=SKIP_INPUT,
            hint='传 --ledger <continuity-ledger.md> 可查台账与提示词包是否对账'
                 '（持物矛盾 / 持物漏写 / 离手无落点 / 角色漏登 / 时段不一致）'))
        return errors, warns

    try:
        ltext = io.open(ledger_path, encoding='utf-8').read()
    except Exception as e:
        errors.append('读台账失败：%s' % e)
        return errors, warns

    entries = parse_ledger(ltext)
    if not entries:
        errors.append('G7 台账解析出 0 条——G1~G6 的「零命中」是空跑，不算通过。'
                      '条目头需形如「## 段 1｜场名」（段/镜/场/U + 编号 + ｜），'
                      '且条目之间以换行 + 该形式起始；请核对台账格式后重跑')
        return errors, warns

    by_num = {}
    for num, title, dur, block in shots:
        by_num.setdefault(shot_key(num), (num, title, block))

    all_names = set()
    for e in entries:
        all_names.update(e['chars'])

    # 时段标签池：台账自身出现过的时段值 + 注册表 lighting_anchors 的标签（给了才加）
    label_pool = set()
    for e in entries:
        tl = (e['scene'].get('时段') or '').strip()
        if tl:
            label_pool.add(tl)
    for lab in (extra_labels or ()):
        if lab:
            label_pool.add(lab)

    prev = None
    for e in entries:
        blk = by_num.get(shot_key(e['num']))
        if blk is None:
            # G6 台账条目编号在包里找不到对应块
            warns.append('G6 台账条目「%s｜%s」在提示词包里找不到对应块——'
                         '台账条目编号必须与包的块编号一致'
                         '（包里是「段 3」就写「段 3」，包里是「U07」就写「U07」）'
                         % (e['num'], e['title'] or '(无标题)'))
            prev = e
            continue

        num, title, block = blk
        body = body_of(block) or block
        size, _angle, _moves, _focals = _parse_shot_meta(block)

        # G1 / G2 持物
        #    空手词与交接词都只在**该角色自己的语境**里找（见 _char_ctx 的注记）；
        #    持物词的命中则放宽到整块——道具可能在时间轴行里被单独描述，
        #    只要在镜里出现过，模型就不会凭空丢掉。
        for name, rec in e['chars'].items():
            hold = (rec.get('持物') or '').strip()
            if not hold or hold in EMPTY_HOLD_VALS:
                continue
            ctx = _char_ctx(body, name, all_names)
            has_handover = any(w in ctx for w in HANDOVER_WORDS)
            hit_empty = [w for w in EMPTY_HAND_WORDS if w in ctx]
            if hit_empty and not has_handover:
                errors.append('G1 块%s %s：台账记 @%s 持「%s」，包内却写「%s」——'
                              '两处直接矛盾。改包或改台账；改台账要在变更行里写清'
                              '落点（递给谁 / 放下 / 打落 / 收起），「没了」不是落点'
                              % (num, title, name, hold, '、'.join(hit_empty)))
                continue
            if has_handover:
                continue
            if any(n in body for n in _hold_needles(hold)):
                continue
            if size in G2_SIZE_SKIP:
                continue          # 大远景 / 特写 / 大特写下道具本就入不了画
            warns.append('G2 块%s %s：台账记 @%s 持「%s」，包内没提到它，也没有交接说明——'
                         '模型大概率把它丢了。要么在提示词里带上，要么确认本镜景别'
                         '确实框不到（若如此，台账持物项补注「本镜不入画」）。'
                         '台账与包的用词要一致，否则一定报'
                         % (num, title, name, hold))

        # G3 离手无落点（只比对台账里相邻两条）
        if prev is not None:
            for name, rec in e['chars'].items():
                if name not in prev['chars']:
                    continue
                old = (prev['chars'][name].get('持物') or '').strip()
                new = (rec.get('持物') or '').strip()
                if old == new:
                    continue
                covered = any((name in c) and any(f in c for f in HOLD_KEYS)
                              for c in e['changes'])
                if not covered:
                    errors.append('G3 台账「%s」→「%s」：@%s 持物由「%s」变「%s」，'
                                  '但本条变更行里没有对应记录——道具离手必有落点，'
                                  '凭空出现同样要有交代（补一条带触发节拍与落点的变更行）'
                                  % (prev['num'], e['num'], name, old or '无', new or '无'))

        # G4 角色漏登：该角色在别的段登过记、本段包内也点名了，本段台账却没登记
        for name in all_names:
            if name in e['chars']:
                continue
            if ('@' + name) in body:
                warns.append('G4 块%s %s：@%s 在本段被点名，但台账本条没登记——'
                             '这个人的状态就没有依据可查。补登六项，'
                             '或确认他本段确实不在场（若如此，从提示词里删掉点名）'
                             % (num, title, name))

        # G5 时段对账：台账时段标签 vs 包内时段声明行
        tl = (e['scene'].get('时段') or '').strip()
        if tl:
            decl_lines = [l for l in block.split('\n') if DECL_LINE_RE.match(l)]
            decl = '\n'.join(decl_lines)
            matched = [lab for lab in label_pool if lab and lab in decl]
            # 长词优先：避免「夜」被「深夜」吃掉（与 SHOTSIZE_WORDS 同一个坑）
            matched = [a for a in matched
                       if not any(a != b and a in b for b in matched)]
            if matched and tl not in matched:
                errors.append('G5 块%s %s：台账本段时段「%s」，包内时段声明行写的是「%s」——'
                              '两处不一致。改包或改台账；时段只从 lighting_anchors 取值，'
                              '不现场编'
                              % (num, title, tl, '、'.join(matched)))
            elif not matched:
                # 池里一个都没命中（多半没给 --registry）。直接比声明行的值，
                # 否则「台账写夜、包里写正午」会因为 正午 不在池里而整条漏掉。
                for l in decl_lines:
                    m2 = DECL_TIME_RE.match(l)
                    if not m2:
                        continue
                    v = m2.group(1).strip()
                    if not v or re.search(r'\d', v) or len(v) > 6:
                        continue      # 「时间：00:00」这类不是时段声明
                    if tl not in v and v not in tl:
                        errors.append('G5 块%s %s：台账本段时段「%s」，包内时段声明行写的是「%s」——'
                                      '两处不一致。改包或改台账；时段只从 lighting_anchors 取值，'
                                      '不现场编'
                                      % (num, title, tl, v))
                        break

        prev = e

    return errors, warns


def derive_cast(pkg_text):
    """--cast 未给时，从提示词包里自动收集角色名：人物行 + @锚点。"""
    import re as _re
    names = set()
    for m in _re.finditer(r'人物[：:]\s*(.+)', pkg_text):
        for n in _re.split(r'[、,，;；/\s]+', m.group(1)):
            n = n.strip()
            if n and len(n) <= 12:
                names.add(n)
    for m in _re.finditer(r'@([^\s（(·,，、]{1,12})', pkg_text):
        names.add(m.group(1).strip())
    return {n for n in names if n and not n.startswith('#')}


# ------------------------------------------------------------ V. 元检查（v5.16.0）
# 断言纪律 + 段缝声明。与 Z 门同一条纪律的两个新切面：
# Z 门查「块没解析到就别报 OK」，本门查「没跑过脚本就别声称通过」与
# 「多段任务必须锁段缝方式」。两条都只做能机械判定的部分，语义判断留给人。
CLAIM_PHRASES = ('已校验', '已通过机检', '机检通过', '全绿', '已验证', '已确认无误',
                 '官方支持', '官方已验证', '保证稳定', '保证一致')
# 有这些痕迹 = 包内附了校验结果，声称通过有据可查
EVIDENCE_MARKERS = ('校验结果', 'check_prompt', 'check_style', 'audit_project',
                    'audit_literal', 'audit_risk', 'audit_contract', '机检结果')
SEAM_DECL_RE = re.compile(r'【段缝声明】')


def audit_meta_checks(pkg_text, shots, model=None, cap=None):
    """V 门：E-UNVERIFIED-CLAIM（断言无证据）+ E-SEAM-UNDECLARED（多段未锁段缝）。

    段缝码只对 2.5 / h3 生效：2.0 面长内容用 Shot N 标签在单次调用内切分，
    没有生成单元之间的段缝（参数总表：2.0 滑窗阈值「不适用」）；
    模型版本未声明时不判——那种包已被 D0 段 WARN 点名，先补【模型版本】。
    """
    errors, warns = [], []
    hit_claims = [p for p in CLAIM_PHRASES if p in pkg_text]
    if hit_claims and not any(m in pkg_text for m in EVIDENCE_MARKERS):
        errors.append(
            'E-UNVERIFIED-CLAIM 包内出现通过性/能力性断言（%s）但找不到任何校验结果痕迹——'
            '没跑过脚本就不许出现「已校验/已通过/全绿/已验证」；'
            '能力未经官方文档或本机实测确认，不得写「官方支持/保证」'
            % '、'.join(hit_claims))
    if shots and model in ('2.5', 'h3') and cap:
        total = 0.0
        for s in shots:
            # v5.37.2：`duration: -1`（智能时长）不得当成 1s 累加进总时长——
            # 旧正则 `([\d.]+)` 会把负号吃掉，把「未知」算成「1 秒」，直接决定段缝门报不报。
            m = re.search(r'(?:#|【参数】)\s*duration\s*[:：]\s*(-?\d+(?:\.\d+)?)', s[3])
            if m and float(m.group(1)) > 0:
                total += float(m.group(1))
        if total > cap and not SEAM_DECL_RE.search(pkg_text):
            errors.append(
                'E-SEAM-UNDECLARED 多段任务（总时长 %.4gs 超单条硬上限 %.4gs，必须拆分）'
                '未声明【段缝声明】——段与段之间必须锁定衔接方式：'
                '① 末帧定格承接（尾帧锚定）② 换机位硬切 ③ 空镜过渡 ④ 技巧型转场'
                % (total, cap))
    return errors, warns


# ------------------------------------------------------------ P1 汲取三件（v5.17.0）
# D2 决策流水 / N4 伏笔生命周期 / R 镜头裁定。三者都是 opt-in：
# 不给输入就是「本门跳过，不是通过」（与 G / N 门同口径），不改变既有包的基线。

# D2 · 决策流水（--decisions decisions.jsonl）。来源：zenstory 决策记录三段式
# （publish → accept → set-authority，字段/类型/范围校验，缺字段越界拒绝写入）。
# liqi 适配：三锁确认后落盘 JSONL，每行 {"lock": "...", "value": "..."}；
# D2 核对必锁项齐全 + 与包内声明一致——锁从「对话确认」变「可审计」。
REQUIRED_LOCKS = ('赛道', '模型版本', '画幅', '投放面', '交付形态')
# 从包内声明提取的模型值 → 决策流水标准值（归一化用）
_MODEL_ALIAS = {
    '2.5': ('2.5', 'seedance 2.5', 'seedance2.5'),
    '2.0': ('2.0', 'seedance 2.0', 'seedance2.0'),
    'h3': ('h3', 'minimax h3', 'minimaxh3'),
}


def audit_decisions(pkg_text, decisions_path, detected_model=None):
    errors, warns = [], []
    if not decisions_path:
        return errors, warns  # 未给 --decisions：本门跳过，不是通过
    try:
        raw = open(decisions_path, encoding='utf-8').read()
    except OSError:
        errors.append('E-DECISIONS-UNREADABLE 决策流水文件读不了：%s' % decisions_path)
        return errors, warns
    rows = []
    for ln, line in enumerate(raw.splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except ValueError:
            errors.append('E-DECISIONS-BADLINE 第 %d 行不是合法 JSONL：%s' % (ln, line[:60]))
            continue
        if not isinstance(row, dict) or 'lock' not in row or 'value' not in row:
            errors.append('E-DECISIONS-BADLINE 第 %d 行缺 lock/value 字段：%s' % (ln, line[:60]))
            continue
        rows.append(row)
    if not rows:
        errors.append('E-DECISIONS-EMPTY 决策流水解析出 0 条——空文件不是已锁定（Z 门同口径）')
        return errors, warns
    seen = {str(r['lock']).strip(): str(r['value']).strip() for r in rows}
    for lock in REQUIRED_LOCKS:
        if lock not in seen:
            errors.append('E-DECISIONS-LOCK-MISSING 必锁项「%s」在决策流水中没有记录——'
                          '锁未落盘 = 未锁定（多会话恢复时以流水为准，不以记忆为准）' % lock)
    # 与包内声明对账（能对上的才对，对不上的项让 D0 / 锁相关门兜底）
    def _norm_model(v):
        v = str(v).strip().lower()
        for canon, aliases in _MODEL_ALIAS.items():
            for a in aliases:
                if a in v:
                    return canon
        return v

    m = re.search(r'【三锁】[^\n]*?模型\s*[=＝]\s*([^｜\n]+)', pkg_text)
    if m and '模型版本' in seen:
        if _norm_model(seen['模型版本']) != _norm_model(m.group(1)):
            errors.append('E-DECISIONS-MISMATCH 决策流水「模型版本=%s」与包内【三锁】声明「%s」不一致'
                          % (seen['模型版本'], m.group(1).strip()))
    if detected_model and '模型版本' in seen:
        if _norm_model(seen['模型版本']) != detected_model:
            errors.append('E-DECISIONS-MISMATCH 决策流水「模型版本=%s」与脚本识别的锁①=%s 不一致'
                          % (seen['模型版本'], detected_model))
    return errors, warns


# N4 · 伏笔生命周期（--foreshadow 伏笔表.md）。来源：ManjuForge 伏笔表
# （ID/类型/埋设集/状态/回收集；埋后 ≥2 集才可回收；允许升级禁止降级；已回收不复活）。
# 表行格式（列序固定）：| F-01 | 类型 | 埋设集 | 状态 | 回收集 |
# 状态枚举：埋设 / 推进 / 已回收 / 废弃；未回收的行回收集写 —。
FORESHADOW_STATES = ('埋设', '推进', '已回收', '废弃')


def audit_foreshadow(foreshadow_path):
    errors, warns = [], []
    if not foreshadow_path:
        return errors, warns  # 未给 --foreshadow：本门跳过，不是通过
    try:
        raw = open(foreshadow_path, encoding='utf-8').read()
    except OSError:
        errors.append('E-FORESHADOW-UNREADABLE 伏笔表读不了：%s' % foreshadow_path)
        return errors, warns
    rows = []
    for ln, line in enumerate(raw.splitlines(), 1):
        line = line.strip()
        if not line.startswith('|') or set(line) <= set('|- '):
            continue
        cells = [c.strip() for c in line.strip('|').split('|')]
        # v5.20.0：5 列旧格式与 7 列扩展格式兼容。
        # 7 列 = | ID | 类型 | 级别 | 埋设集 | 状态 | 回收集 | 锚点数 |
        # 旧表不用改：级别默认 L1、不查锚点数。
        if len(cells) not in (5, 7):
            continue  # 表头或说明行
        if cells[0] in ('ID', 'id', '编号'):
            continue  # 表头行
        rows.append((ln, cells))
    if not rows:
        errors.append('E-FORESHADOW-EMPTY 伏笔表解析出 0 行——'
                      '表行格式应为 | F-01 | 类型 | 埋设集 | 状态 | 回收集 |（空表不是已登记）')
        return errors, warns
    seen_ids = set()
    big_reversals = []  # (级别, 埋设集, fid) —— N4b 大反转间距用
    for ln, cells in rows:
        if len(cells) == 7:
            fid, _ftype, level, s_set, state, e_set, n_anchor = cells
        else:
            fid, _ftype, s_set, state, e_set = cells
            level, n_anchor = 'L1', ''
        if fid in seen_ids:
            errors.append('E-FORESHADOW-DUPID 伏笔 ID 重复：%s（第 %d 行）' % (fid, ln))
        seen_ids.add(fid)
        if state not in FORESHADOW_STATES:
            errors.append('E-FORESHADOW-STATE 伏笔 %s 状态「%s」不在枚举内：%s'
                          % (fid, state, ' / '.join(FORESHADOW_STATES)))
        # N4b-1 反转分级枚举（v5.20.0）
        if level not in ('L1', 'L2', 'L3'):
            errors.append('E-FORESHADOW-LEVEL 伏笔 %s 级别「%s」不在枚举内：'
                          'L1 / L2 / L3（见连载记忆 §2.1）' % (fid, level))
        try:
            start = int(re.sub(r'[^0-9]', '', s_set))
        except ValueError:
            errors.append('E-FORESHADOW-EP 伏笔 %s 埋设集「%s」解析不出集数' % (fid, s_set))
            continue
        # N4b-2 锚点数下限（v5.20.0）：L2 ≥3、L3 ≥4——大反转不给足锚点，
        # 观众要么看不懂要么觉得硬。空列不查（5 列旧格式）。
        if level in ('L2', 'L3') and n_anchor:
            try:
                na = int(re.sub(r'[^0-9]', '', n_anchor))
            except ValueError:
                warns.append('W-FORESHADOW-ANCHOR 伏笔 %s 锚点数「%s」解析不出数字'
                             % (fid, n_anchor))
            else:
                need = 3 if level == 'L2' else 4
                if na < need:
                    warns.append('W-FORESHADOW-ANCHOR 伏笔 %s 为 %s 但只有 %d 个锚点'
                                 '（纪律：%s 需 ≥%d 个锚点，见连载记忆 §2.1）'
                                 % (fid, level, na, level, need))
        if level in ('L2', 'L3'):
            big_reversals.append((level, start, fid))
        if state == '已回收':
            m = re.sub(r'[^0-9]', '', e_set)
            if not m:
                errors.append('E-FORESHADOW-RECYCLE 伏笔 %s 标记「已回收」但回收集为空' % fid)
                continue
            end = int(m)
            if end < start:
                errors.append('E-FORESHADOW-ORDER 伏笔 %s 回收集(%d) 早于埋设集(%d)' % (fid, end, start))
            elif end - start < 2:
                warns.append('W-FORESHADOW-TOOFAST 伏笔 %s 埋设后 %d 集即回收（纪律：埋后 ≥2 集才可回收）'
                             % (fid, end - start))
    # N4b-3 大反转间距（v5.20.0）：相邻 L2+ 反转的埋设集间隔 ≤4 集。
    # 超了就是中段连续 4+ 集没有大反转，观众等不及。
    big_reversals.sort(key=lambda x: x[1])
    for (l0, s0, f0), (l1, s1, f1) in zip(big_reversals, big_reversals[1:]):
        if s1 - s0 > 4:
            warns.append('W-FORESHADOW-GAP 大反转 %s（第 %d 集）与 %s（第 %d 集）'
                         '间隔 %d 集，超过 4 集——中段会塞（见连载记忆 §2.1）'
                         % (f0, s0, f1, s1, s1 - s0))
    return errors, warns


# N5/N6 · 筹码账与尾钩链（--epstruct 分集结构表.md）。v5.20.0 新增。
# 规范见 references/尾钩与筹码账.md——多集项目（A3 且 ≥2 集）的集间纪律。
# 与 --foreshadow/--ledger/--decisions 同族 opt-in：未传 = 本门跳过（不是通过）；
# 传了但解析出 0 行 = ERROR（空表不是已登记，同 E-FORESHADOW-EMPTY 口径）。
# 表行格式（七列列序固定）：
#   | 集 | 核心事件 | 筹码类型 | 筹码内容 | 尾钩类型 | 尾钩内容 | 下集回收 |
# 严重度裁决：类型枚举两码 ERROR（写飞了账就废）；内容为空三码 WARN
# （可能是季中过渡集的有意取舍，阻断不合理）。
EP_STAKE_TYPES = ('信息', '关系', '资源', '力量')
EP_HOOK_TYPES = ('信息钩', '危机钩', '选择钩', '态度钩')
EP_RECALL_RE = re.compile(r'E\s*\d+')


def audit_epstruct(epstruct_path):
    errors, warns = [], []
    if not epstruct_path:
        return errors, warns  # 未给 --epstruct：本门跳过，不是通过
    try:
        raw = open(epstruct_path, encoding='utf-8').read()
    except OSError:
        errors.append('E-EPSTRUCT-UNREADABLE 分集结构表读不了：%s' % epstruct_path)
        return errors, warns
    rows = []
    for ln, line in enumerate(raw.splitlines(), 1):
        line = line.strip()
        if not line.startswith('|') or set(line) <= set('|- '):
            continue
        cells = [c.strip() for c in line.strip('|').split('|')]
        if len(cells) != 7:
            continue
        if cells[0] in ('集', 'ID', '编号'):
            continue  # 表头行
        rows.append((ln, cells))
    if not rows:
        errors.append('E-EPSTRUCT-EMPTY 分集结构表解析出 0 行——'
                      '表行格式应为 | 集 | 核心事件 | 筹码类型 | 筹码内容 | '
                      '尾钩类型 | 尾钩内容 | 下集回收 |'
                      '（空表不是已登记，见 references/尾钩与筹码账.md §三）')
        return errors, warns
    seen_eps = set()
    for ln, cells in rows:
        ep, _event, stake_t, stake_c, hook_t, hook_c, recall = cells
        if ep in seen_eps:
            warns.append('W-EPSTRUCT-DUPEP 第 %d 行集号「%s」重复——同一集两行账，'
                         '对账会重复计数' % (ln, ep))
        seen_eps.add(ep)
        # N5 筹码账
        if stake_t not in EP_STAKE_TYPES:
            errors.append('E-EPSTRUCT-TYPE 第 %d 行（集 %s）筹码类型「%s」不在枚举内：%s'
                          % (ln, ep, stake_t, ' / '.join(EP_STAKE_TYPES)))
        if not stake_c:
            warns.append('W-EPSTRUCT-STAKES-EMPTY 第 %d 行（集 %s）筹码内容为空——'
                         '一集下来主角信息/关系/资源/力量一条都没变，是水集'
                         '（见 尾钩与筹码账.md §二）' % (ln, ep))
        # N6 尾钩链
        if hook_t not in EP_HOOK_TYPES:
            errors.append('E-EPSTRUCT-HOOKTYPE 第 %d 行（集 %s）尾钩类型「%s」不在枚举内：%s'
                          % (ln, ep, hook_t, ' / '.join(EP_HOOK_TYPES)))
        if not hook_c:
            warns.append('W-EPSTRUCT-HOOK-EMPTY 第 %d 行（集 %s）尾钩内容为空——'
                         '多集项目每集必须有尾钩（季终集除外）' % (ln, ep))
        if not recall or not EP_RECALL_RE.search(recall):
            warns.append('W-EPSTRUCT-RECALL-EMPTY 第 %d 行（集 %s）下集回收为空或不含集号'
                         '（格式：E<集号> <秒位> <一句话>，如「E5 0:10 接 28 斤单全景」）——'
                         '钓了不还，观众被吊两次就弃剧' % (ln, ep))
    return errors, warns


# N3b · 改编转换表（--adapttable）。v5.20.0 新增。规范见 叙事层 §6.4b。
# 与 N3（事实权威链五级）分工：N3 管「事实不许漂」，本门管「不爽点→合规爽点」的转换登记——
# 每集改编必须有合规处理列，空 = 过审风险上游失守（audit_risk 只查词，查不了这层）。
# 表行格式（六列列序固定）：
#   | 集 | 真实原型 | 不爽点 | 爽改编 | 爽点配方 | 合规处理 |
SHUANGDIAN_CODES = ('S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07')


def audit_adapttable(adapttable_path):
    errors, warns = [], []
    if not adapttable_path:
        return errors, warns  # 未给 --adapttable：本门跳过，不是通过
    try:
        raw = open(adapttable_path, encoding='utf-8').read()
    except OSError:
        errors.append('E-ADAPTTABLE-UNREADABLE 改编转换表读不了：%s' % adapttable_path)
        return errors, warns
    rows = []
    for ln, line in enumerate(raw.splitlines(), 1):
        line = line.strip()
        if not line.startswith('|') or set(line) <= set('|- '):
            continue
        cells = [c.strip() for c in line.strip('|').split('|')]
        if len(cells) != 6:
            continue
        if cells[0] in ('集', 'ID', '编号'):
            continue  # 表头行
        rows.append((ln, cells))
    if not rows:
        errors.append('E-ADAPTTABLE-EMPTY 改编转换表解析出 0 行——'
                      '表行格式应为 | 集 | 真实原型 | 不爽点 | 爽改编 | '
                      '爽点配方 | 合规处理 |')
        return errors, warns
    for ln, cells in rows:
        ep, _proto, _pain, _adapt, sd, comp = cells
        if not comp:
            warns.append('W-ADAPT-COMPLIANCE 第 %d 行（集 %s）合规处理列为空——'
                         '真实事件改编每集必须写明合规处理（取证路径/执法主体/'
                         '去性化/不教呐违规），见 叙事层 §6.4b' % (ln, ep))
        for code in re.findall(r'S\d+', sd):
            if code not in SHUANGDIAN_CODES:
                warns.append('W-ADAPT-SDCODE 第 %d 行（集 %s）爽点配方「%s」不在 S01~S07 枚举内'
                             % (ln, ep, code))
    return errors, warns


# R · 镜头裁定（来源：Emily2040 sequence invariants——accepted observed state
# overrides planned state；rejected footage is excluded from canon and cannot
# become a continuation source）。改动复验报告里写「镜头裁定」表：
#   | 镜 3 | rejected | 演不了该情绪，重写后由镜 3b 替代 |
# 状态枚举：planned / accepted / rejected / superseded。
# R 门查两件事：状态在枚举内；rejected / superseded 的镜号不得仍以 live 镜块
# （含 duration 参数行）存在于本包——废镜必须移出或替换，否则就是「废镜入 canon」。
TAKE_STATES = ('planned', 'accepted', 'rejected', 'superseded')


def audit_take_verdicts(pkg_text, shots):
    errors, warns = [], []
    verdict_zone = re.search(r'镜头裁定[^\n]*\n((?:[^\n]*\n)*?)(?=\n\s*\n|\Z)', pkg_text)
    if not verdict_zone:
        return errors, warns  # 没写裁定表 = 本门不适用（改动复验未触发时合法）
    zone = verdict_zone.group(1)
    verdicts = {}
    for m in re.finditer(r'(?:镜\s*)?([0-9]+[a-z]?)\s*[｜|:：]\s*(planned|accepted|rejected|superseded)',
                         zone, re.I):
        verdicts[m.group(1).lower()] = m.group(2).lower()
    if not verdicts:
        warns.append('镜头裁定表存在但解析出 0 条——行格式应为「镜 3: rejected（理由）」或 '
                     '| 镜 3 | rejected |；格式修正前本门不算通过')
        return errors, warns
    live = {s[0].lower() for s in shots
            if re.search(r'(?:#|【参数】)\s*duration:', s[3])}
    census = {}
    for num, state in verdicts.items():
        census[state] = census.get(state, 0) + 1
        if state in ('rejected', 'superseded') and num in live:
            errors.append('E-TAKE-IN-CANON 镜 %s 裁定为 %s 但包内仍是 live 镜块（含 duration 参数行）'
                          '——废镜必须移出本包或由替代镜替换，rejected footage 禁入 canon' % (num, state))
    live_planned = [n for n in live if verdicts.get(n) == 'planned']
    if live_planned:
        warns.append('镜 %s 仍处 planned（未复核）——planned 的镜头不能当已接受事实去续写或引用'
                     % '、'.join(sorted(live_planned)[:8]))
    return errors, warns


# ------------------------------------------------------------ D3. 集级时长预算（v5.18.0）
# 来源：船长套件 tolerance ±15% + 时长仪表。liqi 原有 D 门只管**段级硬上限**，
# 集级预算（「一集 120 秒写成 95 或 180」）没有任何门能响——本门补这一层。
# 声明式 opt-in：包首写 `【集级预算】目标 120s ±15%`（± 可省，默认 15%）才查；
# 不写 = 本门不适用（不是通过）。严重度裁决：**WARN 而非船长式 ERROR**——liqi 的时长是
# 「下给模型的生成时长」，集级偏差可能是有意取舍（该拆的段拆了就一定超目标），阻断不合理。
EP_BUDGET_RE = re.compile(r'【集级预算】\s*目标\s*([\d.]+)\s*s?\s*(?:[±+\-]\s*([\d.]+)\s*%)?')


def audit_ep_budget(pkg_text, shots):
    errors, warns = [], []
    m = EP_BUDGET_RE.search(pkg_text)
    if not m:
        return errors, warns          # 未声明：不适用，不出声（基线零影响）
    target = float(m.group(1))
    tol = float(m.group(2)) / 100.0 if m.group(2) else 0.15
    leaves = [s for s in shots if re.search(r'(?:#|【参数】)\s*duration:', s[3])]
    if not leaves:
        warns.append('D3 集级预算：声明了目标 %.4gs 但识别不到任何叶子镜块（含 duration 参数行）'
                     '——本门没有真正查过，不算通过' % target)
        return errors, warns
    total = 0.0
    for s in leaves:
        # v5.37.2：与段缝门（E-SEAM-UNDECLARED）同口径——`-1`（智能时长）跳过，不计入集级预算
        mm = re.search(r'(?:#|【参数】)\s*duration\s*[:：]\s*(-?\d+(?:\.\d+)?)', s[3])
        if mm and float(mm.group(1)) > 0:
            total += float(mm.group(1))
    lo, hi = target * (1 - tol), target * (1 + tol)
    if total < lo or total > hi:
        warns.append('W-EP-DURATION-OUT 集级时长 %.4gs 越出目标 %.4gs ±%d%% 区间（%.4g~%.4gs）——'
                     '写欠先补戏不注水（加冲突不加寒暄）；写超先砍无戏节拍再压台词，'
                     '或确认这是刻意的分段取舍后更新【集级预算】'
                     % (total, target, round(tol * 100), lo, hi))
    return errors, warns


# ── --auto：门禁默认化（v5.24.0） ────────────────────────────────────────────
# 病根：A / C / D2 / F / G / N3b / N4 / N5-N6 全部靠 opt-in，不传就是跳过。
# 真实项目里没人愿意手打八个路径，于是门禁名义存在、实际不跑，
# 最后「全绿」是因为大部分门根本没查过——这是本库最贵的一种假绿。
# 解法：① 就近自动发现输入；② 跑完打印《门禁覆盖矩阵》，把「没查」逐条明说。

AUTO_INPUTS = [
    ('registry', ('asset-registry.json',),
     'F 门资产纪律 / C 门版本漂移 / C2 场景时段'),
    ('ledger', ('continuity-ledger.md', '连续性台账.md', '台账.md'),
     'G 门台账对账'),
    ('decisions', ('decisions.jsonl',),
     'D2 决策流水'),
    ('foreshadow', ('伏笔表.md',),
     'N4 伏笔生命周期'),
    ('epstruct', ('分集结构表.md',),
     'N5/N6 筹码账与尾钩链'),
    ('adapttable', ('改编转换表.md',),
     'N3b 改编转换表'),
    ('script', ('剧本_标准.txt', '剧本.txt', 'script.txt'),
     'A 台词一致性 / N 剧本量化'),
    ('versions', ('versions.json', '版本互斥词表.json'),
     'C 门版本漂移（优先级高于 registry）'),
]

# 覆盖矩阵：门 → 依赖哪个输入。None = 包内自足；'in_pkg' = 包内有对应表才跑。
COVERAGE_GATES = [
    ('A. 台词一致性', 'script'),
    ('B. 资产锚覆盖', None),
    ('C. 版本漂移', ('registry', 'versions')),
    ('C2. 场景时段漂移', 'registry'),
    ('D. 时长一致性', None),
    ('D2. 决策流水', 'decisions'),
    ('D3. 集级时长预算', None),
    ('E. 转场表完整性', None),
    ('F. 资产层纪律', 'registry'),
    ('G. 台账对账', 'ledger'),
    ('N. 剧本量化', 'script'),
    ('N3b. 改编转换表', 'adapttable'),
    ('N4. 伏笔生命周期', 'foreshadow'),
    ('N5/N6. 筹码账与尾钩链', 'epstruct'),
    ('R. 镜头裁定', 'in_pkg'),
    ('S. 分镜配额', None),
    ('V. 元检查', None),
    ('Z. 输入完整性', None),
]


def _search_dirs(pkg_path):
    """包所在目录 + 其父目录 + 若干常见子目录。只找一层，不做全盘遍历。"""
    d = os.path.dirname(os.path.abspath(pkg_path)) or '.'
    cands = [d, os.path.dirname(d)]
    for sub in ('assets', 'docs', 'data', 'script'):
        cands.append(os.path.join(d, sub))
    seen, out = set(), []
    for x in cands:
        if x and x not in seen and os.path.isdir(x):
            seen.add(x)
            out.append(x)
    return out


def auto_fill(args, pkg_path):
    """按 AUTO_INPUTS 就近发现输入；**只填空值，绝不覆盖用户显式给的**。"""
    notes = []
    for name, names, gate in AUTO_INPUTS:
        if getattr(args, name, None):
            continue
        hit = None
        for d in _search_dirs(pkg_path):
            for n in names:
                p = os.path.join(d, n)
                if os.path.isfile(p):
                    hit = p
                    break
            if hit:
                break
        if hit:
            setattr(args, name, hit)
            notes.append('[auto] --%s → %s（%s）' % (name, hit, gate))
    # beats.txt 不归本脚本，但用户最常忘的就是它——顺手提示，别让它静默缺席
    for d in _search_dirs(pkg_path):
        for n in ('beats.txt', '节拍清单.txt'):
            p = os.path.join(d, n)
            if os.path.isfile(p):
                notes.append('[auto] 发现 %s → 请另跑 '
                             '`node scripts/check_prompt.mjs <包> --beats %s`（节拍认领对账）'
                             % (p, os.path.basename(p)))
                break
        else:
            continue
        break
    if not notes:
        notes.append('[auto] 未发现任何可自动挂载的输入——**所有 opt-in 门都会跳过，'
                     '跳过不是通过**。请把 registry / 台账 / 剧本等放到包目录或它的父目录')
    return notes


def _dw(s):
    """显示宽度：东亚宽字符算 2 列，否则 %-Ns 对不齐（中文项目必然踩）。"""
    import unicodedata
    return sum(2 if unicodedata.east_asian_width(c) in 'WF' else 1 for c in s)


def _pad(s, w):
    return s + ' ' * max(0, w - _dw(s))


def print_coverage(args, pkg_text, out=None):
    # v5.37.5：out 默认 stdout，--json 时传 stderr —— 否则覆盖矩阵会混进 JSON 输出，
    # CI 侧 json.loads 直接炸（此前的 `--json --auto` 确实炸，见 CHANGELOG 5.37.5）。
    out = out or sys.stdout
    print('\n' + '=' * 78, file=out)
    print('门禁覆盖矩阵（--auto）', file=out)
    print('=' * 78, file=out)
    ran, skipped = [], []
    for gate, dep in COVERAGE_GATES:
        if dep is None:
            ran.append((gate, '包内自足'))
        elif dep == 'in_pkg':
            if '镜头裁定' in pkg_text:
                ran.append((gate, '包内含「镜头裁定」表'))
            else:
                skipped.append((gate, '包内无「镜头裁定」表（未触发）'))
        else:
            deps = dep if isinstance(dep, tuple) else (dep,)
            got = [d for d in deps if getattr(args, d, None)]
            if got:
                ran.append((gate, '输入：%s' % os.path.basename(getattr(args, got[0]))))
            else:
                skipped.append((gate, '缺 %s' % ' / '.join('--' + d for d in deps)))
    for g, why in ran:
        print('  %s %s %s' % (color('已查', GRN), _pad(g, 24), why), file=out)
    for g, why in skipped:
        print('  %s %s %s' % (color('未查', YEL), _pad(g, 24), why), file=out)
    n = len(ran) + len(skipped)
    print('\n  覆盖 %d / %d ｜ 未查 %d 项 —— **这 %d 门没查过，不是通过**'
          % (len(ran), n, len(skipped), len(skipped)), file=out)


def main():
    ap = argparse.ArgumentParser(description='liqi 提示词包项目级审计')
    ap.add_argument('pkg', help='提示词包 .md')
    ap.add_argument('--script', help='剧本纯文本 .txt（标准剧本格式）')
    ap.add_argument('--assets', help='资产库参考图目录')
    ap.add_argument('--cast', default='',
                    help='剧本角色名，逗号分隔（用于识别台词）。不传时自动从提示词包的「人物：」行与 @锚点 收集；收集不准再显式传入')
    ap.add_argument('--coverage', action='store_true',
                    help='额外统计剧本台词被提示词包的采用率（含动作描写误判，仅供参考）')
    ap.add_argument('--registry', help='asset-registry.json 路径；C 门（角色/道具版本漂移）从它的'
                                       'characters.*.versions.*.codename 与 props.*.state_arc 生成规则；'
                                       'C2 门（场景时段漂移）从 scenes.*.variants.*.lock_out + '
                                       'lighting_anchors.*.label 生成规则')
    ap.add_argument('--versions', help='C 门规则文件 .json，格式：'
                                       '[{"name":"角色A","sets":[["素白中衣"],["藕荷衣裙"]]}]；'
                                       '与 --registry 二选一，都没有则 C 门跳过（不报 OK）')
    ap.add_argument('--adapt', action='store_true',
                    help='本项目是改编（小说 / 网文 / 大纲 / 已有剧本）。'
                         '开启后 N3 检查事实权威链五级标注（FACT/INFERENCE/ASSUMPTION/'
                         'USER_OVERRIDE/OPEN_ITEM）；未标注报「无法核对」，不是通过')
    ap.add_argument('--combat', choices=('auto', 'on', 'off'), default='auto',
                    help='打戏跨镜构成（S23 全身景别 / S24 贴脸连排）开关。'
                         'auto = 检测到打戏信号词才跑（默认）；on = 强制跑；off = 关闭。'
                         '文戏包不跑，防误报拖垮整包机检可信度')
    ap.add_argument('--ledger', help='continuity-ledger.md 路径；G 门（台账与提示词包对账）'
                                     '从它读逐段的人物账/场景账/变更行。不给则 G 门跳过（不报 OK）')
    ap.add_argument('--decisions', help='decisions.jsonl 路径；D2 门（决策流水）核对三锁五项'
                                        '是否齐全且与包内声明一致。不给则 D2 门跳过（不报 OK）')
    ap.add_argument('--foreshadow', help='伏笔表 .md 路径；N4 门（伏笔生命周期）核对状态枚举、'
                                         '回收时距与 ID 唯一性。不给则 N4 门跳过（不报 OK）')
    ap.add_argument('--epstruct', help='分集结构表 .md 路径；N5/N6 门（筹码账与尾钩链）核对'
                                       '筹码四类 / 尾钩四型枚举与三项非空。'
                                       '不给则跳过（跳过不是通过），规范见 '
                                       'references/尾钩与筹码账.md §三')
    ap.add_argument('--config', help='liqi.json 项目配置：把这堆 opt-in 参数收成一份文件。'
                                      '只填未显式指定的参数（显式 CLI > 配置 > --auto 自动发现）。'
                                      '传 auto = 取包同目录的 liqi.json；找不到会报错，不静默跳过。'
                                      'schema 见 scripts/liqi_config.py 的 KEYS')
    ap.add_argument('--auto', action='store_true',
                    help='门禁默认化：就近自动挂载 asset-registry.json / continuity-ledger.md / '
                         'decisions.jsonl / 伏笔表 / 分集结构表 / 改编转换表 / 剧本，'
                         '并打印《门禁覆盖矩阵》。只填未显式指定的参数，不覆盖手动输入')
    ap.add_argument('--adapttable', help='改编转换表 .md 路径；N3b 门核对每集合规处理列非空'
                                         '与爽点配方编号（见 叙事层 §6.4b）')
    ap.add_argument('--model', default=None,
                    help='锁①模型版本（2.5 / 2.0 / h3）；不传则读包内【模型版本】声明，'
                         '都没有则按最严 15s 判并报 WARN')
    ap.add_argument('--limit', type=int, default=None,
                    help='单镜时长硬上限，覆盖 --model 推出的值（临时核对用）')
    # v5.37.1（审查报告 AR-1）：--json 供 CI / 看板消费；默认同时写门日志，
    # 与 check_prompt.mjs / check_style.mjs / audit_literal.py 同一份 .gates.jsonl 汇流，
    # gates_stats.mjs 才能回答「哪道门最常响」——此前项目级审计完全不进统计，口径是半盲的。
    ap.add_argument('--json', action='store_true',
                    help='以 JSON 输出（机器可读：锁①参数 / 各门 errors+warns / 汇总 / exit），'
                         '不打印人类可读报告')
    ap.add_argument('--no-log', action='store_true',
                    help='不把本次结果追加到被校验文件同目录的 .gates.jsonl')
    args = ap.parse_args()

    # v5.37.5：--json 是给 CI / 看板吃的，stdout 必须只有那一段 JSON。
    # 配置说明 / 自动发现说明 / 覆盖矩阵都属于「说给人听的话」，一律改走 stderr。
    # 此前 `--json --auto` 实测 json.loads 直接抛 JSONDecodeError（第 1 行就是 [auto]…）。
    chatter = sys.stderr if args.json else sys.stdout

    # v5.37.5：配置文件先落（用户手写的最具体），--auto 再补剩下的空位。
    # 优先级：显式 CLI > liqi.json > --auto 自动发现 —— 越靠左越「用户说过的」。
    if getattr(args, 'config', None):
        _cfg, _cerrs, _cpath = liqi_config.resolve(
            args.config, args.pkg, liqi_config.PROJECT_KEYS)
        if _cerrs:
            for _e in _cerrs:
                print(_e, file=chatter)
            print('E-CONFIG：配置不可用，已中止——降级继续跑等于假装配过了。', file=chatter)
            sys.exit(2)
        for _n in liqi_config.apply(args, _cfg, liqi_config.given_flags(sys.argv[1:])):
            print(_n, file=chatter)
        print('[config] 生效：%s' % _cpath, file=chatter)
        if _cfg.get('auto'):
            args.auto = True
        print('', file=chatter)

    if args.auto:
        for _n in auto_fill(args, args.pkg):
            print(_n, file=chatter)
        print('', file=chatter)

    # v5.32.0：文件读不了要按文档口径退出码 2 + E-INPUT，不能裸抛 Traceback（可执行层实测：rc=1）
    try:
        pkg_text = open(args.pkg, encoding='utf-8').read()
    except (OSError, UnicodeDecodeError) as e:
        print('E-INPUT: 提示词包读不了：%s' % e)
        sys.exit(2)
    shots = split_shots(pkg_text)

    # 时长红线由锁①模型版本决定（SKILL.md「投放面参数总表」），不由块标题格式决定。
    model = args.model.strip().lower() if args.model else detect_model_version(pkg_text)
    if model and model not in MODEL_DURATION:
        model = None
    if model:
        cap = MODEL_DURATION[model]['cap']
        soft = MODEL_DURATION[model]['soft']
        floor = MODEL_DURATION[model].get('floor')
    else:
        cap = soft = FALLBACK_CAP
        floor = None
    if args.limit is not None:
        cap = args.limit
        soft = min(soft, cap)

    sections = []

    # Z. 输入完整性：块数为 0 时，所有镜级门禁（D / C / C2）都是空跑，
    # 空跑返回的 OK 不成立——这正是本 skill 反复强调的「假绿比漏检更危险」。
    # 单独报出来，避免一份格式没被识别的包被读成「全绿」。
    if not shots:
        sections.append(('Z. 输入完整性',
                         [],
                         ['未识别到任何镜/段块——**下列 D / C / C2 三门的 OK 是空跑，不成立**。'
                          '块头需形如「镜 1｜标题 5s」或「段 1｜标题 15s」（标题里必须带秒数），'
                          '且块与块之间以换行 + 「镜/段/U + 编号 + ｜」起始；'
                          '请核对包的分块格式后重跑']))

    # V. 元检查（断言纪律 / 段缝声明）：与 Z 门同级，不计入十类。
    # 放在 Z 门之后——块都没解析到时本门的段缝统计同样不成立。
    if shots:
        sections.append(('V. 元检查（断言纪律 / 段缝声明）',)
                        + audit_meta_checks(pkg_text, shots, model, cap))
    sections.append(('D. 时长一致性',) + audit_duration(shots, cap, soft, model, floor))
    if not model:
        # 锁①没声明却按 15s 判，可能把合法的 2.5 面 25s 段误判成超红线。
        # 不能静默放宽（那是假绿），也不能闷声报错——把依据说出来，让人能一眼纠正。
        sections.append(('D0. 锁① 声明', [],
                         [f'包内未识别到【模型版本】声明，时长红线按最严 {FALLBACK_CAP}s 判'
                          f'（2.5 面应为 30s/20s）。请在包内补【模型版本】：2.5，或跑时加 --model 2.5']))
    sections.append(('E. 转场表完整性',) + audit_transitions(pkg_text, shots))
    # D3 集级时长预算：包首声明【集级预算】目标 Ns ±M% 才生效（不声明不出声）
    sections.append(('D3. 集级时长预算',) + audit_ep_budget(pkg_text, shots))
    sections.append(('S. 分镜配额构成',) + audit_shot_quota(shots, pkg_text))
    # 打戏跨镜构成：auto 模式下没检测到打戏信号就**不出现这一节**——
    # 不是通过，是本门不适用（文戏包本来就不该被全身景别下限约束）。
    _cs = audit_combat_composition(shots, args.combat)
    if _cs[0] or _cs[1]:
        sections.append(('S2. 打戏构成（全身景别 / 贴脸连排）',) + _cs)
    sections.append(('B. 资产锚覆盖',) + audit_assets(pkg_text, args.assets, shots))
    sections.append(('B2. 场景图覆盖',) + audit_scene_shot_coverage(pkg_text, args.registry, shots))
    rules = []
    scene_rules = []
    if args.versions:
        rules = load_rules_from_file(args.versions)
    elif args.registry:
        rules = load_rules_from_registry(args.registry)
        scene_rules = load_scene_variant_rules(args.registry)
    sections.append(('C. 版本漂移（互斥特征）',) + audit_character(pkg_text, shots, rules))
    sections.append(('C2. 场景时段漂移',) + audit_scene_variants(pkg_text, shots, scene_rules))
    sections.append(('C3. 场景开口一致性',) + audit_scene_openings(pkg_text, args.registry))
    sections.append(('C4. 缝隙光用法',) + audit_slit_light_as_key(pkg_text, args.registry))
    sections.append(('F. 资产层纪律',) + audit_asset_discipline(pkg_text, args.registry))
    # G5 的时段标签池：注册表 lighting_anchors 的键与 label 都收进来，
    # 让「夜 / 深夜 / night」这类同义写法能对上（台账自身的值也在池里）
    time_labels = []
    if args.registry:
        try:
            import json as _json
            _d = _json.load(io.open(args.registry, encoding='utf-8'))
            for _k, _v in (_d.get('lighting_anchors') or {}).items():
                time_labels.append(_k)
                lab = (_v or {}).get('label')
                if lab:
                    time_labels.append(lab)
        except Exception:
            pass
    sections.append(('G. 台账对账',) +
                    audit_continuity_ledger(pkg_text, shots, args.ledger, time_labels))

    n_dialogue = 0
    if args.script:
        cast = set(x.strip() for x in args.cast.split(',') if x.strip())
        if not cast:
            cast = derive_cast(pkg_text)
        dialogues, errs, warns = audit_dialogue(pkg_text, args.script, cast, shots,
                                                coverage=args.coverage)
        n_dialogue = len(dialogues)
        sections.append(('A. 台词一致性', errs, warns))
    else:
        sections.append(('A. 台词一致性',) +
                        _skip_section('未提供 --script', kind=SKIP_INPUT))

    # N. 剧本量化门禁：全片时长只按叶子块汇总（容器段与镜混排时不能重复计）
    _leaves = [s for s in shots if re.search(r'(?:#|【参数】)\s*duration:', s[3])]
    _total = sum(float(s[2]) for s in (_leaves or shots)) if shots else 0.0
    sections.append(('N. 剧本量化门禁',) +
                    audit_script_gates(args.script, _total, args.adapt))
    # v5.37.1 假绿防线：下面这几门过去「没给输入就完全不出现」——用户在报告里看不到它们存在过，
    # 于是「没查」被当成「没问题」，与本项目 Z 门 / G7 / S22 / CT 的口径相反。
    # 统一走 _skip_section：无条件入册，缺失时明写「未查——这不是通过」。
    if args.foreshadow:
        sections.append(('N4. 伏笔生命周期',) + audit_foreshadow(args.foreshadow))
    else:
        sections.append(('N4. 伏笔生命周期',) +
                        _skip_section('未给 --foreshadow', kind=SKIP_INPUT))
    if args.epstruct:
        sections.append(('N5/N6. 筹码账与尾钩链',) + audit_epstruct(args.epstruct))
    else:
        sections.append(('N5/N6. 筹码账与尾钩链',) +
                        _skip_section('未给 --epstruct', kind=SKIP_INPUT))
    if args.adapttable:
        sections.append(('N3b. 改编转换表',) + audit_adapttable(args.adapttable))
    else:
        sections.append(('N3b. 改编转换表',) +
                        _skip_section('未给 --adapttable', kind=SKIP_INPUT))
    # R. 镜头裁定：包内写了「镜头裁定」表才生效（改动复验触发时的废镜隔离检查）
    if '镜头裁定' in pkg_text:
        sections.append(('R. 镜头裁定（废镜隔离）',) + audit_take_verdicts(pkg_text, shots))
    else:
        # 类别是「不适用」而不是「缺输入」：这张表只在改动复验时才需要，
        # 一个从来没做过改动复验的包不该因此永远挂在「未查」上。
        sections.append(('R. 镜头裁定（废镜隔离）',) +
                        _skip_section('包内无「镜头裁定」表，仅改动复验时适用',
                                      kind=SKIP_NA))
    # D2. 决策流水：--decisions 给了才查（三锁确认后落盘的可审计流水）
    if args.decisions:
        sections.append(('D2. 决策流水',) + audit_decisions(pkg_text, args.decisions, model))
    else:
        sections.append(('D2. 决策流水',) +
                        _skip_section('未给 --decisions', kind=SKIP_INPUT))

    # ---- 输出（v5.37.1：--json 机器可读 / --no-log 关日志 / 默认写 .gates.jsonl）
    # v5.37.3：先把「未查」从 warning 里摘出来，再计数——否则 10 条「没传参数」
    # 会把 3 条真问题淹掉，且 warning 数没法当质量信号读。
    sections = _split_skips(sections)
    # v5.37.7：探针——项目里到底有没有这些输入。
    # 无条件跑一遍 auto_fill 到**临时对象**上，不写回 args：写回是 `--auto` 的事，
    # 这里只是要知道「文件在不在」。少了这一步，`缺输入` 就只能一句话盖住两件事。
    class _Probe(object):
        pass

    _probe = _Probe()
    for _name, _names, _gate in AUTO_INPUTS:
        setattr(_probe, _name, None)
    auto_fill(_probe, args.pkg)
    sections = _relabel_missing_inputs(sections, args, _probe)
    # v5.37.8：把「不适用」从 skips 里摘出来，单列一档。**它不进未查计数，也不进退出码**——
    # 「这个包没有这个场景」不该阻止交付；但它必须在报告里出现，且写明「不适用 ≠ 通过」，
    # 否则就从「假绿」换成了「静默省略」，那是更坏的一种。
    na_by_name = {}
    _kept = []
    for _n, _e, _w, _ks in sections:
        _na = [k for k in _ks if _is_na(k)]
        if _na:
            na_by_name[_n] = _na
        _kept.append((_n, _e, _w, [k for k in _ks if not _is_na(k)]))
    sections = _kept
    total_na = sum(len(v) for v in na_by_name.values())
    total_err = sum(len(s[1]) for s in sections)
    total_warn = sum(len(s[2]) for s in sections)
    total_skip = sum(len(s[3]) for s in sections)
    # v5.37.6：未查再分类。**未分类必须单独报**——一条新写的未查消息忘了带类别，
    # 如果被悄悄并进「缺输入」，用户会按「补参数就行」去处理一条其实补参数没用的判据。
    skip_kind_n = dict((k, 0) for k in SKIP_KINDS)
    for _s in sections:
        for _k in _s[3]:
            _kk = _skip_kind(_k)
            if _kk in skip_kind_n:
                skip_kind_n[_kk] += 1
    skip_untagged = total_skip - sum(skip_kind_n.values())
    # 「未查」不算通过：只有 error / warning / 未查 全为 0 才是真·全查全过。
    exit_code = 1 if total_err else (2 if (total_warn or total_skip) else 0)

    if args.json:
        payload = {
            'tool': 'audit_project.py',
            'file': os.path.basename(args.pkg),
            'lock': {'model': model, 'cap': cap, 'soft': soft, 'floor': floor},
            'blocks': len(shots),
            'dialogue_lines': n_dialogue,
            'sections': [
                {
                    'name': name,
                    'status': 'error' if errs else ('warn' if warns else ('skip' if skips else 'ok')),
                    'errors': errs,
                    'warns': warns,
                    'skips': skips,
                    # 不适用单列（v5.37.8）：它不是未查，但也不能消失——
                    # 「没出现」和「不适用」在 JSON 消费侧长得一样。
                    'nas': na_by_name.get(name, []),
                }
                for name, errs, warns, skips in sections
            ],
            'totals': {
                'error': total_err, 'warn': total_warn, 'skip': total_skip,
                'skip_input': skip_kind_n[SKIP_INPUT],
                'skip_missing': skip_kind_n[SKIP_MISSING],
                'skip_thresh': skip_kind_n[SKIP_THRESH],
                'skip_untagged': skip_untagged,
                'na': total_na,
            },
            'exit': exit_code,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print('=' * 78)
        print('liqi 项目级审计报告：%s' % os.path.basename(args.pkg))
        print('块数 %d（镜/段）｜ 剧本台词 %d 条' % (len(shots), n_dialogue))
        print('=' * 78)

        for name, errs, warns, skips in sections:
            _nas = na_by_name.get(name, [])
            if errs or warns or skips:
                _mark = ''
            elif _nas:
                _mark = color('N/A', DIM)      # 只有不适用：不是 OK，也不是问题
            else:
                _mark = color('OK', GRN)
            print('\n%s  —— %s' % (name, _mark))
            for e in errs:
                print('  %s %s' % (color('[ERROR]', RED), e))
            for w in warns:
                print('  %s %s' % (color('[WARN] ', YEL), w))
            for k in skips:
                print('  %s %s' % (color('[SKIP] ', DIM), k))
            # 不适用单独一行灰色（v5.37.8）：和 [SKIP] 同一个视觉层级，
            # 但文案自带「不适用 ≠ 通过」，不会被读成「查过了」。
            for k in _nas:
                print('  %s %s' % (color('[N/A]  ', DIM), k))

        if args.auto:
            print_coverage(args, pkg_text, out=chatter)

        print('\n' + '=' * 78)
        # 三个数分开报：未查 ≠ 不合格，也不能被读成「快过了」。
        _tally = '%d error / %d warning' % (total_err, total_warn)
        if total_skip:
            # 括号里把两类拆开：「缺输入」补参数就有救，「门槛」补参数没用只能换粒度。
            # 这两句话的下一步动作不同，合成一个数等于没告诉用户该干什么。
            _detail = ' / '.join('%s %d' % (k, skip_kind_n[k])
                                 for k in SKIP_KINDS if skip_kind_n[k])
            if skip_untagged:
                _detail += (' / 未分类 %d' % skip_untagged) if _detail else ('未分类 %d' % skip_untagged)
            _tally += ' / %d 未查（%s，未查 ≠ 通过）' % (total_skip, _detail)
        if total_na:
            # 不适用不进退出码，但必须写出来：「没出现」和「不适用」在视觉上一样，
            # 而后者意味着这一门你**永远没验过**。
            _tally += ' / %d 不适用（不适用 ≠ 通过）' % total_na
        if total_err:
            print(color('结果：' + _tally, RED))
        elif total_warn:
            print(color('结果：' + _tally, YEL))
        elif total_skip:
            # 没有 error/warning，但还有门没跑：不是「全部通过」，别写绿字。
            print(color('结果：' + _tally, YEL))
        else:
            # 「全绿但有门不适用」也要写出来：不适用不进退出码，可它不等于验过。
            _tail = (' · %d 不适用（不适用 ≠ 通过）' % total_na) if total_na else ''
            print(color('结果：全部通过（0 error / 0 warning）' + _tail, GRN))

    if not (args.no_log or log_disabled(sys.argv[1:])):
        append_gate_log('audit_project.py', args.pkg, exit_code,
                        _issues_from_sections(sections, na_by_name),
                        target=model or 'undeclared')
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
