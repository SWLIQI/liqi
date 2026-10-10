#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
liqi 提示词包项目级审计（机械校验器之外的三项人工复核自动化）。

check_prompt.mjs 只查单镜格式合规；本脚本查跨镜与跨文档的问题：

  A. 台词一致性  —— 剧本原文台词是否与提示词包逐字对齐（用户铁律：台词一字不差）
  B. 资产锚覆盖  —— 每镜是否指定了参考图；引用的图名是否真实存在于资产库
  C. 角色描述漂移 —— 同一角色在不同镜的服装/外貌描述是否自相矛盾
  D. 时长一致性  —— 镜标题时长 vs # duration；是否超 15s 红线
  E. 转场表完整  —— 相邻镜对的转场注记是否有缺漏

用法：
  python audit_project.py <提示词包.md> [--script <剧本.txt>] [--assets <资产库目录>]

  --script  剧本纯文本（docx 需先转 txt；标准剧本格式：角色名独占一行、可选语气行、台词行）
  --assets  参考图目录，用于校验图名是否真实存在

退出码：0 = 全部通过；1 = 有 ERROR；2 = 只有 WARN
"""
import argparse
import difflib
import os
import re
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

RESET = '\033[0m'
RED = '\033[31m'
YEL = '\033[33m'
GRN = '\033[32m'


def color(s, c):
    return c + s + RESET if sys.stdout.isatty() else s


# 与 check_prompt.mjs 及 SKILL.md Step 3 第 1 条对齐：
#  1. 「镜」与镜号之间允许零个或多个空白（旧版要求恰好一个空格）
#  2. 时长括号允许带副标题「（15s · 动作）」——旧版写成「（\d+s）」要求括号内只有秒数，
#     导致带副标题的镜块整块识别不到（实测报「块数 0」）
# 时长允许小数：实测存在「段 5｜第一幕·拾灵上（28.5s）」这类写法，
# 旧版只认整数会整块漏掉（37 段只识别出 35 段）。
#  3. 编号兼容三种面：`镜 N`（老李分镜面）／`段 N`（liqi 整合段面）／`U01`（MiniMax H3 面）。
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
    # 台词在包内铁律要求双写（时间轴 + 声音设计），两处都是 `：{台词}`，
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
    ANCHOR_RE = re.compile(r'(?:#|【参数】)\s*首帧参考：'
                           r'|【参考素材职责】'
                           r'|(?:#|【参数】)\s*refs\s*[：:]'
                           r'|@(?:图片|视频|音频)\d')
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


# ------------------------------------------------------------ C. 角色漂移
def audit_character(pkg_text, shots):
    """
    检查同一角色在不同镜的服装关键词是否自相矛盾。
    默认规则：若某镜同时出现「后期体态词」与「前期服装词」，判为矛盾。
    """
    errors, warns = [], []
    LATE_BODY = ('瘦得脱了形', '眼窝深陷', '皮肤松弛', '皮松', '一抓一道白痕')
    EARLY_CLOTH = ('淡青绿/灰青色棉布长衫',)
    LATE_CLOTH = ('旧衣松垮的深褐灰长衫',)

    for num, title, dur, body in shots:
        head = body[:1200]  # 只看整体风格段，避免正文叙述干扰
        if any(w in head for w in LATE_BODY) and any(w in head for w in EARLY_CLOTH):
            errors.append(f'块{num} {title}：角色B同时写了后期体态与前期服装，'
                          f'服装与外貌自相矛盾')
        if any(w in head for w in LATE_CLOTH) and any(w in head for w in EARLY_CLOTH):
            errors.append(f'块{num} {title}：角色B同时出现前后期两种服装描述')
    return errors, warns


# ------------------------------------------------------------ D. 时长
def audit_duration(shots, limit=15):
    errors, warns = [], []
    for num, title, dur, body in shots:
        # 参数行标记支持 `# duration`（旧）与 `【参数】duration`（去 Markdown 符号后）
        d = re.search(r'(?:#|【参数】)\s*duration:\s*(\d+(?:\.\d+)?)s', body)
        if not d:
            errors.append(f'块{num} 缺 duration 参数行')
        elif abs(float(d.group(1)) - dur) > 1e-6:
            errors.append(f'块{num} 标题 {dur}s 与 duration {d.group(1)}s 不一致')
        if dur > limit:
            errors.append(f'块{num} {dur}s 超出 {limit}s 红线，需滑窗拆分')
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


def main():
    ap = argparse.ArgumentParser(description='liqi 提示词包项目级审计')
    ap.add_argument('pkg', help='提示词包 .md')
    ap.add_argument('--script', help='剧本纯文本 .txt（标准剧本格式）')
    ap.add_argument('--assets', help='资产库参考图目录')
    ap.add_argument('--cast', default='',
                    help='剧本角色名，逗号分隔（用于识别台词）。不传时自动从提示词包的「人物：」行与 @锚点 收集；收集不准再显式传入')
    ap.add_argument('--coverage', action='store_true',
                    help='额外统计剧本台词被提示词包的采用率（含动作描写误判，仅供参考）')
    ap.add_argument('--limit', type=int, default=None,
                    help='单镜时长红线；不传则自动判定：整合段格式（段 N｜标题）取 30，'
                         '分镜格式（镜 N｜标题）取 15')
    args = ap.parse_args()

    pkg_text = open(args.pkg, encoding='utf-8').read()
    shots = split_shots(pkg_text)

    # 时长红线自动判定：段 N=整合段（Seedance 2.5 单条上限 30s）；镜 N=分镜（15s 红线）
    limit = args.limit
    if limit is None:
        limit = 30 if re.search(r'^段 \d', pkg_text, re.M) else 15

    sections = []
    total_err = total_warn = 0

    sections.append(('D. 时长一致性',) + audit_duration(shots, limit))
    sections.append(('E. 转场表完整性',) + audit_transitions(pkg_text, shots))
    sections.append(('B. 资产锚覆盖',) + audit_assets(pkg_text, args.assets, shots))
    sections.append(('C. 角色描述漂移',) + audit_character(pkg_text, shots))

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
        sections.append(('A. 台词一致性', [], ['未提供 --script，跳过']))

    print('=' * 78)
    print('liqi 项目级审计报告：%s' % os.path.basename(args.pkg))
    print('块数 %d（镜/段）｜ 剧本台词 %d 条' % (len(shots), n_dialogue))
    print('=' * 78)

    for name, errs, warns in sections:
        print('\n%s  —— %s' % (name, color('OK', GRN) if not errs and not warns else ''))
        for e in errs:
            print('  %s %s' % (color('[ERROR]', RED), e))
        for w in warns:
            print('  %s %s' % (color('[WARN] ', YEL), w))
        total_err += len(errs)
        total_warn += len(warns)

    print('\n' + '=' * 78)
    if total_err:
        print(color('结果：%d error / %d warning' % (total_err, total_warn), RED))
        return 1
    if total_warn:
        print(color('结果：0 error / %d warning' % total_warn, YEL))
        return 2
    print(color('结果：全部通过（0 error / 0 warning）', GRN))
    return 0


if __name__ == '__main__':
    sys.exit(main())
