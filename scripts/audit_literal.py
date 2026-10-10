#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抽象表述与高风险画面表述扫描。

作用：把「模型演不出来的话」机械扫出来，避免靠人眼扫会漏。
只扫**可复制正文**（自动排除 `#` 参数行、`>` 说明行、`——` 容器内行、
表格行、以及明确标注为文档层的行），因为只有正文会真正送进模型。

判定依据见 references/抽象表述判定口径.md。

用法：
  python audit_literal.py <提示词包.md> [--detail] [--seg 段1,段2]

  --detail 打印逐条命中的上下文
  --seg    只扫指定段/镜标题，逗号分隔

九类必改清单：
  A 程度评价（X得+评价）   B 孤句判断       C 画面比喻
  D 摄影/后期术语          E 不可控时长     F 剪辑语
  G 模糊指代               H 画面行听觉词   I 神情内心评价

另有 S 类：高敏感画面表述（缺镜头手法兜底时命中）。

脚本定位是**不漏**，不是**不误报**——输出全是候选，须人工判。
内置误报剔除表（群像/画像/镜像/影像 四件套等），但仍需人工过一遍。

退出码：0 = 干净；1 = 有候选待判；2 = 有高危候选（A类/D类/F类/S类）。
"""
import argparse
import re
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# ────────────────────────────────────────────────────────────
# 规则表：(类别, 正则, 命中说明, 建议改法)
# ────────────────────────────────────────────────────────────
RULES = [
    # ── A 程度评价：X 得 + 评价（最危险的一类）
    ('A', r'[白黑红黄青灰]得(发光|发亮|过分|异常|离谱|吓人)', 'A 程度评价（会诱发模型真加辉光/真改色）',
     '拆成可观测特征＋对照基准：「白得发光」→「肤色白、带蜡质光泽」'),
    ('A', r'[白黑红黄青灰]得[^，。；]{2,10}', 'A 程度评价（「X 得＋感受」，非可观测特征）',
     '换成可观测：「白得什么都没有」→「月光照在青石板上，石板面反白，看不出石纹与缝」'),
    ('A', r'(瘦|细|胖|宽|窄|长|短|大|小|厚|薄)得(脱了形|过分|异常|离谱|不像话|出奇)',
     'A 程度评价', '拆成可观测特征：「细得过分」→「腰身细，束腰处衣料收得极紧」'),
    ('A', r'(安静|平静|沉稳|从容)得', 'A 程度评价', '换成可观测（呼吸起伏、无位移、视线不游移）'),
    ('A', r'(憔悴|疲惫|苍老|虚弱|松弛)', 'A 状态评价词', '换成外观：「眼窝深陷、两颊塌陷」'),

    # ── B 孤句判断：缺位置/光照/颜色
    ('B', r'(屋里|室内|院内|四周|周围|天色|光线|气氛|空气)(很|极|十分|格外)?'
          r'(暗|亮|静|空|沉闷|压抑|诡异|阴沉)[。]', 'B 孤句判断（无位置/光照/颜色）',
     '补三件套：位置＋光照＋颜色'),
    ('B', r'[。；](屋里|室内|院内|四周|周围)(很|极|十分)?(暗|亮|静|空)[。]', 'B 孤句判断',
     '补三件套：位置＋光照＋颜色'),
    ('B', r'(月亮|月色|天色)[^，。；]{0,10}(很|极|十分|格外)?'
          r'(暗|亮|惨白|苍白|阴沉|压抑)[。]', 'B 孤句判断（无位置/光照/颜色）',
     '补三件套：位置＋光照＋颜色'),

    # ── C 画面比喻
    ('C', r'像[一那这]?(条|块|团|片|道|抹|把|只|个)[^，。；]{1,10}(的|一样|似的)', 'C 画面比喻',
     '拆成形状＋材质＋度量'),
    ('C', r'像[^，。；]{2,12}(一样|似的|一般|般)[^，。；]{0,4}', 'C 画面比喻',
     '拆成形状＋材质＋度量'),
    ('C', r'(如同|仿佛|好似|宛如|犹如|像是)[^，。；]{2,20}', 'C 画面比喻', '拆成形状＋材质＋度量'),

    # ── D 摄影/后期术语（模型会按字面执行）
    ('D', r'(瞳孔|眼神|目光|眼睛)(空焦|失焦|焦点不在|没有焦点|空洞)', 'D 摄影术语（模型会真生成失焦）',
     '改「瞳孔不收不放，视线不落在…上」'),
    ('D', r'焦点不在任何(东西|物体|地方)', 'D 摄影术语', '改「视线不落在任何一张脸上」'),
    ('D', r'面部肌肉不动|面部没有表情|面无表情', 'D 生理不可能表述（会僵脸）',
     '只写需要的那一处：下颌绷紧 / 咬肌隆起'),
    ('D', r'(留白|意境|氛围感|电影感|高级感|质感拉满|细节丰富)', 'D 空泛美学词（slop）',
     '删除或换成可观测内容'),

    # ── E 不可控时长
    ('E', r'(许久|良久|半晌|半天|好一会儿|好一阵|过了好久|站了一会儿|停了一会儿'
          r'|一会儿|一阵|片刻)[^，。；]{0,4}', 'E 不可控时长',
     '改可数：停两息 / 约两秒 / 三次呼吸（注：「一会儿」若已写成「约两秒」等可数形式则不命中）'),

    # ── F 剪辑语进正文
    ('F', r'(闪回|闪切|叠化|淡入|淡出|转场|蒙太奇|时间跳|定格|慢放|快切)', 'F 剪辑语进正文',
     '改后期工序写法（施工：…）或改镜头原语'),

    # ── G 模糊指代
    ('G', r'(某种|某个|一样)东西', 'G 模糊指代', '给材质与轮廓'),
    ('G', r'(一团|一片|一坨)(看不出|不知|不明|模糊)[^，。；]{0,8}(的)?(东西|物件|物体)?',
     'G 模糊指代（高敏感场景若刻意保留，须配材质兜底）', '补材质与形状'),

    # ── H 画面行里的听觉词
    ('H', r'(死寂|寂静|静谧|一片安静|无声)中[，,]', 'H 画面行出现听觉词', '删除，声音归四层混音'),
    ('H', r'^(死寂|寂静|静谧)[。]，?', 'H 画面行出现听觉词', '删除，声音归四层混音'),

    # ── I 神情/内心评价
    ('I', r'(神情|神色|眼神|目光|表情)(复杂|空洞|茫然|呆滞|涣散|深邃|耐人寻味)',
     'I 神情评价', '换成眉/眼/嘴的具体动作'),
    ('I', r'(若有所思|心事重重|若有所悟|心虚地|心怀鬼胎)', 'I 内心评价', '换成可见动作与视线落点'),
    ('I', r'眼里?(没有光|失去了光|黯淡)', 'I 文学表述', '改「瞳孔反光减弱，上眼睑下垂遮住三分之一虹膜」'),

    # ── S 高敏感画面表述（缺镜头手法兜底时命中）
    ('S', r'(伤口|渗液|渗血|血迹|流血|红肿|破皮|溃烂|结痂渗)', 'S 伤情本体入画（高敏感）',
     '用五手法兜底：画外/前景遮挡/局部特写/逆光暗部轮廓/空镜承接，只给结果不拍过程'),
    ('S', r'(剪影|黑色的?轮廓|暗部中的人影)[^，。；]{0,10}(站着|坐着|立在|出现在)',
     'S 剪影当人物唯一呈现（模型读不懂「剪影」）', '改给正面/侧面并写明光怎么落在脸上'),
    ('S', r'(全程|始终)不与(热源|危险|火)[^，。；]{0,6}同框',
     'S 儿童与危险物口径过严（会与核心动作打架）', '改「不与危险发生的瞬间同框」'),

    # ── 英文规则（MiniMax H3 面专用：正文强制全英文，上面九类的中文式命中不到）
    # H3 面正文必须英文，九类禁令在英文里同样成立，故逐类补英文对应式。
    # 刻意**不建**的规则（建了会 57/57 全误报）：
    #   · `the shot cuts to …` —— H3 多镜切点的正规表达（配 `At 00:04.000` 时间码）
    #   · `no gradients` / `no rendered volume` / `no specular highlights` —— 风格锚的负向排除句
    #   · `gaunt` —— 角色外貌锁里的合法外形词，属可渲染体征，不是状态评价
    ('A', r'\b(so|too|incredibly|impossibly|unnaturally|abnormally)\s+'
          r'(white|pale|bright|dark|still|quiet|smooth|soft|clean)\b',
     'A 程度评价（英文；会诱发模型真加辉光/真改色）',
     '拆成可观测特征＋对照基准：「so white it glows」→「the skin reads white with a waxy sheen」'),
    ('A', r'\b(glowing|radiant|dazzling|luminous)\s+(white|pale|bright)\b',
     'A 程度评价（英文）', '换成可观测的光源与受光面描述'),
    ('A', r'\b(devastated|exhausted|weary|haggard)\b',
     'A 状态评价词（英文）', '换成外观：深陷的眼窝、塌陷的两颊'),

    ('C', r'\bas if\b', 'C 画面比喻（英文；若为说话方式的副词从句则人工判为合规）',
     '拆成形状＋材质＋度量'),
    ('C', r'\bas though\b', 'C 画面比喻（英文）', '拆成形状＋材质＋度量'),
    ('C', r'\blike (a|an|the) [a-z]{2,12}\b', 'C 画面比喻（英文）', '拆成形状＋材质＋度量'),
    ('C', r'\b(resembl\w+|akin to|similar to|not unlike)\b', 'C 画面比喻（英文）',
     '拆成形状＋材质＋度量'),

    ('D', r'\b(cinematic|moody|atmospheric|epic|stunning|breathtaking|ethereal)\b',
     'D 空泛美学词（英文 slop）', '删除或换成可观测内容'),
    ('D', r'\b(masterpiece|highly detailed|ultra[- ]?detailed|photorealistic|hyper[- ]?realistic)\b',
     'D 空泛美学词（英文 slop）', '删除——与手绘水墨轨的风格锚直接冲突'),
    ('D', r'\b(8k|4k|high resolution|best quality)\b', 'D 画质词（英文 slop）', '删除'),
    ('D', r'\b(depth of field|bokeh|out of focus)\b', 'D 摄影术语（英文；模型会真生成失焦）',
     '改「视线不落在…上」这类可观测状态'),
    ('D', r'\b(his|her|their) face (is |stays )?(blank|expressionless|impassive)\b',
     'D 生理不可能表述（英文；会僵脸）', '只写需要的那一处：下颌绷紧 / 咬肌隆起'),

    ('E', r'\bfor (a while|a long while|a moment|some time|a long moment|little while)\b',
     'E 不可控时长（英文）', '改可数：for two beats / for three breaths / for about two seconds'),
    ('E', r'\b(briefly|momentarily|after some time|several moments later|a moment later)\b',
     'E 不可控时长（英文）', '改可数时长'),

    ('G', r'\b(something|some kind of|a certain)\b',
     'G 模糊指代（英文；若为间接引语的内容则人工判为合规）', '给材质与轮廓'),
    ('G', r'\b(an? )?(indistinct|unclear|undefined|vague) (shape|form|mass)\b',
     'G 模糊指代（英文）', '补材质与形状'),

    ('I', r'\b(a )?(complicated|complex|unreadable|inscrutable|knowing|thoughtful) (look|expression|gaze)\b',
     'I 神情评价（英文）', '换成眉/眼/嘴的具体动作'),
    ('I', r'\b(lost in thought|deep in thought|preoccupied|blankly)\b', 'I 内心评价（英文）',
     '换成可见动作与视线落点'),
]

# ────────────────────────────────────────────────────────────
# 误报剔除：命中后先过这一层
# ────────────────────────────────────────────────────────────
FALSE_POSITIVE_PATTERNS = [
    # 「像」的四件套
    r'群像', r'画像', r'镜像', r'影像', r'录像', r'塑像', r'雕像', r'佛像', r'人像',
    # 「空」的合法用法
    r'空间', r'空气', r'空隙', r'天空', r'空镜', r'空地', r'空院', r'空椅', r'空碗',
    r'空着', r'空了', r'空手', r'空无一人',
    # 「松」的合法用法（松开是动作，松弛才是评价；皮肤松弛是可渲染的体征）
    r'松开', r'松手', r'松了口气', r'皮肤松弛', r'松弛的皮肤',
    # 「定格」在后期注记里合法
    r'（施工', r'后期', r'施工：',
    # 「数字电影感」等固定档位名不是 slop
    r'数字电影感', r'胶片颗粒',
    # 刻意留白（剧本/资产册锁定的形制，不是表述问题）
    r'看不出是什么', r'字朝里', r'不可读', r'虚焦', r'一团模糊', r'没有五官',
]

# 必锁 / 可见性 行：F 类（剪辑语）在此豁免——素材复用型「闪回」说明允许出现在这两行
F_EXEMPT_LINE = re.compile(r'^\s*(必锁|可见性)[：:]')

# 文末附文停扫标记：整片包的「四 全局制作纪律 / 附 改动复验报告 / 附 校验结果」
# 属**文档层**，不是投喂正文，但它们落在最后一个镜块之后，
# 会被当成本镜正文扫进去（实测「转场表完整性 —— OK」触发 F 剪辑语 ×2）。
# 命中即停止扫描——附文本来就不该参与抽象表述判定。
ANNEX_STOP = re.compile(r'^\s*#{1,6}\s*(附[一二三四五六七八九十]?[、.．]|附录|全局制作纪律|'
                        r'[一二三四五六七八九十]+[、.．]\s*全局制作纪律)')

CATEGORY_NAME = {
    'A': 'A 程度评价', 'B': 'B 孤句判断', 'C': 'C 画面比喻',
    'D': 'D 摄影术语', 'E': 'E 不可控时长', 'F': 'F 剪辑语',
    'G': 'G 模糊指代', 'H': 'H 画面行听觉词', 'I': 'I 神情评价',
    'S': 'S 高敏感画面',
}
HIGH_RISK_CATS = {'A', 'D', 'F', 'S'}


def is_body_line(line):
    """判断是否为可复制正文行（排除文档层与容器层）。"""
    s = line.strip()
    if not s:
        return False
    if s.startswith('#'):
        return False
    if s.startswith('>'):
        return False
    if s.startswith('——') or s.startswith('──'):
        return False
    if s.startswith('|'):
        return False
    if s.startswith('```'):
        return False
    if s.startswith('【参数】') or s.startswith('参数：'):
        return False
    # 说明性小标题
    if re.match(r'^(注|说明|提示|示例|反面|正面)[：:]', s):
        return False
    # ── 否定式与声音层：这些行里的禁项/听觉词是合法的
    if s.startswith('Must not') or s.startswith('Must not：'):
        return False
    if re.match(r'^(环境层|动作层|呼吸层|逼近层|对白|声音设计|音效)[：:]', s):
        return False
    # ── 台词行与音色注行（台词铁律：一字不动；音色注是表演/声音层）
    if re.search(r'[\{｢]', s) or '台词' in s[:12] or re.match(r'^\s*\d+-\d+s\s*台词', s):
        return False
    if re.match(r'^\s*[^：:]{1,12}音色[（(]', s):
        return False
    # ── 段间衔接说明（给剪辑看，不进投喂正文）
    if re.match(r'^\s*(衔接|转场注记|连续性)[：:]', s):
        return False
    # ── 风格串行：固定串，不参与抽象判定
    if 'Where Winds Meet' in s or '风格串' in s[:10] or s.startswith('非遗'):
        return False
    # ── 卷尾纪律条目：数字编号 + 铁律/通则/纪律/逻辑
    if re.match(r'^\s*\d*\s*[^：:]{1,20}(铁律|通则|纪律|逻辑)[：:]', s):
        return False
    # ── 文档层小标题
    if re.match(r'^(幕首承接|幕末交接|本幕段次清单|幕首|幕末|附|附录|全局制作)[：:]?', s):
        return False
    return True


def strip_false_positive(text, m):
    """命中落在误报语境里就剔除。取命中前后各 6 字做语境判断。"""
    a = max(0, m.start() - 6)
    b = min(len(text), m.end() + 6)
    ctx = text[a:b]
    for fp in FALSE_POSITIVE_PATTERNS:
        if re.search(fp, ctx):
            return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('file')
    ap.add_argument('--detail', action='store_true')
    ap.add_argument('--seg', help='只扫指定段/镜，逗号分隔')
    args = ap.parse_args()

    try:
        raw = open(args.file, encoding='utf-8').read()
    except Exception as e:
        print('读取失败：', e)
        return 2

    lines = raw.splitlines()

    # 段/镜标题切分
    # 兼容四种编号：`镜 N`／`段 N`／`Shot N`（老李·liqi 面）／`U01`（MiniMax H3 面）。
    # 旧版不认 `U`，H3 面一个标题都匹配不上 → in_body 恒为 False →
    # 整包零命中却报「✅ 未检出抽象表述候选」（实测 57 单元全漏，属静默假通过）。
    # 同时补 Markdown 标题前缀 `#{0,6}` 与小数秒（28.5s）。
    seg_pat = re.compile(
        r'^\s*#{0,6}\s*(镜\s*\d+|段\s*\d+|Shot\s*\d+|U\s*\d+)'
        r'[｜|]?\s*(.+?)（(\d+(?:\.\d+)?)s')
    cur_seg = '(未分段)'
    in_body = False  # 卷首（第一个段/镜标题之前）属文档层，不扫
    hits = []
    seen = set()
    for ln, line in enumerate(lines, 1):
        if ANNEX_STOP.match(line):
            break               # 进入文末附文（文档层），停止扫描
        m = seg_pat.match(line)
        if m:
            cur_seg = m.group(1).replace(' ', '')
            in_body = True
        if not in_body:
            continue
        if args.seg:
            allow = [x.strip() for x in args.seg.split(',')]
            if cur_seg not in allow:
                continue
        if not is_body_line(line):
            continue
        for cat, pat, why, fix in RULES:
            if cat == 'F' and F_EXEMPT_LINE.match(line):
                continue
            for mm in re.finditer(pat, line):
                if strip_false_positive(line, mm):
                    continue
                key = (ln, cat, mm.group(0))
                if key in seen:
                    continue          # 同一处被多条规则命中时只报一次
                seen.add(key)
                hits.append({
                    'ln': ln, 'seg': cur_seg, 'cat': cat,
                    'word': mm.group(0), 'why': why, 'fix': fix,
                    'ctx': line.strip(),
                })

    if not hits:
        print('✅ 未检出抽象表述候选。')
        return 0

    # 汇总
    by_cat = {}
    for h in hits:
        by_cat.setdefault(h['cat'], []).append(h)
    by_seg = {}
    for h in hits:
        by_seg.setdefault(h['seg'], []).append(h)

    print('=' * 68)
    print('抽象表述扫描：%s' % args.file)
    print('=' * 68)
    print()
    print('候选总数：%d' % len(hits))
    print()
    print('按类别：')
    for c in sorted(by_cat):
        flag = '🔴' if c in HIGH_RISK_CATS else '🟡'
        print('  %s %-16s %3d' % (flag, CATEGORY_NAME[c], len(by_cat[c])))
    print()
    print('按段/镜：')
    for s in sorted(by_seg, key=lambda x: (len(x), x)):
        cats = sorted(set(h['cat'] for h in by_seg[s]))
        hi = [c for c in cats if c in HIGH_RISK_CATS]
        flag = '🔴' if hi else '🟡'
        print('  %s %-10s %3d 条  类别：%s' % (flag, s, len(by_seg[s]), ' '.join(cats)))
    print()

    if args.detail:
        print('-' * 68)
        print('逐条明细')
        print('-' * 68)
        for h in hits:
            print('L%-5d [%s] %s' % (h['ln'], h['seg'], h['word']))
            print('      类：%s' % h['why'])
            print('      改：%s' % h['fix'])
            print('      原：%s' % h['ctx'][:100])
            print()
    else:
        print('（加 --detail 看逐条上下文与改法）')

    print()
    print('提示：本脚本只报候选，不判真伪。按 references/抽象表述判定口径.md '
          '第三节「必留类」与第四节「误报源四件套」人工过一遍。')

    high = [h for h in hits if h['cat'] in HIGH_RISK_CATS]
    return 2 if high else 1


if __name__ == '__main__':
    sys.exit(main())
