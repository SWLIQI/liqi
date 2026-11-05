#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抽象表述与高风险画面表述扫描。

作用：把「模型演不出来的话」机械扫出来，避免靠人眼扫会漏。
只扫**可复制正文**（自动排除 `#` 参数行、`>` 说明行、`——` 容器内行、
表格行、以及明确标注为文档层的行），因为只有正文会真正送进模型。

判定依据见 references/抽象表述判定口径.md。

用法：
  python audit_literal.py <提示词包.md> [--detail] [--seg 段1,段2] [--no-log]

  --detail  打印逐条命中的上下文
  --seg     只扫指定段/镜标题，逗号分隔
  --no-log  本次不写 .gates.jsonl（默认写，写失败静默跳过，不影响退出码）

九类必改清单：
  A 程度评价（X得+评价）   B 孤句判断       C 画面比喻
  D 摄影/后期术语          E 不可控时长     F 剪辑语
  G 模糊指代               H 画面行听觉词   I 神情内心评价

另有 S 类：高敏感画面表述（缺镜头手法兜底时命中）。
另有 J 类（v5.18.0）动作可生成度 与 K 类（v5.21.0）道具光效——**两个独立轴，均不计入九类**。九类管「抽象 → 具体」的转译，
J 类管「具体但做不到」的降级（判据：这个动作在生活视频里常见吗）。与 FACS 的边界见 RULES 内注。

脚本定位是**不漏**，不是**不误报**——输出全是候选，须人工判。
内置误报剔除表（群像/画像/镜像/影像 四件套等），但仍需人工过一遍。

退出码：0 = 干净；1 = 有候选待判；2 = 有高危候选（A / D / F / K / M / S 类）。
"""
import argparse
import re
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gates_log import append_gate_log, log_disabled

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# ────────────────────────────────────────────────────────────
# 规则表：(类别, 正则, 命中说明, 建议改法)
# ────────────────────────────────────────────────────────────
RULES = [
    # ── A 程度评价：X 得 + 评价（最危险的一类）
    ('A', r'[白黑红黄青灰]得(发光|发亮|过分|异常|离谱|吓人)', 'A 程度评价（会诱发模型真加辉光/真改色）',
     '拆成可观测特征＋对照基准（只落颜色/可见状态/对照基准三类词）：「白得发光」→「面色白，两颊不见血色」。🔴 旧改法「带蜡质光泽」已废止——蜡是喻体（判据二）、光泽是光效（K 类）'),
    ('A', r'[白黑红黄青灰]得[^，。；]{2,10}', 'A 程度评价（「X 得＋感受」，非可观测特征）',
     '换成可观测：「白得什么都没有」→「月光照在青石板上，石板面反白，看不出石纹与缝」'),
    ('A', r'(瘦|细|胖|宽|窄|长|短|大|小|厚|薄)得(脱了形|过分|异常|离谱|不像话|出奇)',
     'A 程度评价', '拆成可观测特征：「细得过分」→「腰身细，束腰处衣料收得极紧」'),
    ('A', r'(安静|平静|沉稳|从容)得', 'A 程度评价', '换成可观测（呼吸起伏、无位移、视线不游移）'),
    ('A', r'(憔悴|疲惫|苍老|虚弱|松弛)', 'A 状态评价词', '换成外观：「眼窝深陷、两颊塌陷」'),

    # ── B 孤句判断：缺位置/光照/颜色
    ('B', r'(屋里|室内|院内|四周|周围|天色|光线|气氛|空气)(很|极|十分|格外)?'
          r'(暗|亮|静|空|沉闷|压抑|诡异|阴沉)[。]', 'B 孤句判断（无位置/光照/颜色）',
     '补三件套：位置＋光照＋颜色；光照再补光比 1:N 与色温 K（带观感锚可写），禁「半尺/一米」裸度量'),
    ('B', r'[。；](屋里|室内|院内|四周|周围)(很|极|十分)?(暗|亮|静|空)[。]', 'B 孤句判断',
     '补三件套：位置＋光照＋颜色；光照再补光比 1:N 与色温 K（带观感锚可写），禁「半尺/一米」裸度量'),
    ('B', r'(月亮|月色|天色)[^，。；]{0,10}(很|极|十分|格外)?'
          r'(暗|亮|惨白|苍白|阴沉|压抑)[。]', 'B 孤句判断（无位置/光照/颜色）',
     '补三件套：位置＋光照＋颜色；光照再补光比 1:N 与色温 K（带观感锚可写），禁「半尺/一米」裸度量'),

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
     '转场/生成批次/后期工序剥离进转场注记表，正文只写本段末帧停在哪——🔴 旧改法「分两次生成，后期硬切」是制作注记不是画面描述，已废止'),

    # ── G 模糊指代
    # v4.8.3 A4：旧版只认「某种/某个/一样 + 东西」——口径.md 第七节自家例句
    # 「某个物件」「一团什么」漏报。补物件/物体后缀与「一团什么」裸指代。
    ('G', r'(某种|某个|一样)(东西|物件|物体)', 'G 模糊指代', '给材质与轮廓＋数量与绑定位置（防桌上一个、手里一个、背景又一个）'),
    ('G', r'(一团|一片|一坨)什么', 'G 模糊指代', '给材质与轮廓＋数量与绑定位置（防桌上一个、手里一个、背景又一个）'),
    ('G', r'(一团|一片|一坨)(看不出|不知|不明|模糊)[^，。；]{0,8}(的)?(东西|物件|物体)?',
     'G 模糊指代（高敏感场景若刻意保留，须配材质兜底）', '补材质与形状'),

    # ── H 画面行里的听觉词
    # v4.8.3 A4：旧版只认「X中，」与行首「X。」两种形状——口径.md 第八节自家例句
    # 「一片寂静里」漏报（结尾是「里」不是「中，」），「万籁俱寂」未入表。
    # 后缀集补「里/之下」；万籁俱寂是四字成语，本体即听觉场景，无需后缀也拦。
    ('H', r'(死寂|寂静|静谧|一片安静|无声)(中|里|之下)[，。]?', 'H 画面行出现听觉词', '删除，声音归四层混音（声音段豁免反形容词，但仍禁空泛结果词）'),
    ('H', r'^(死寂|寂静|静谧)[。]，?', 'H 画面行出现听觉词', '删除，声音归四层混音（声音段豁免反形容词，但仍禁空泛结果词）'),
    ('H', r'万籁俱寂', 'H 画面行出现听觉词', '删除，声音归四层混音（声音段豁免反形容词，但仍禁空泛结果词）'),

    # ── I 神情/内心评价
    ('I', r'(神情|神色|眼神|目光|表情)(复杂|空洞|茫然|呆滞|涣散|深邃|耐人寻味)',
     'I 神情评价', '换成眉/眼/嘴的具体动作'),
    ('I', r'(若有所思|心事重重|若有所悟|心虚地|心怀鬼胎)', 'I 内心评价', '换成可见动作与视线落点'),
    ('I', r'眼里?(没有光|失去了光|黯淡)', 'I 文学表述', '改成可命名形态：「上眼睑压下来遮住瞳孔上缘，眼神发直」。🔴 禁微观解剖度量（三分之一虹膜/瞳孔放大3毫米），见 §二之二'),

    # ── J 动作可生成度（v5.18.0 · 独立轴，不计入九类）
    # 九类管「抽象 → 具体」的转译；本类管「具体但做不到」的降级——来源：船长套件 script-pass 硬规则 4
    # （「常见动作是 AI 生成的生命线——它只会演它见过千万次的动作」，判据：这个动作在生活视频里常见吗）。
    # 🔴 与 FACS 的边界（v5.18.0 裁决）：FACS 允许的「眼睑撑开 / 嘴角上提 / 眉心拧住」是
    #    有肌肉、有幅度、有秒数的结构化动作，**全部保留**；本类只收「无量无幅度的文学化微描写」。
    #    ⇒ 词表严禁收录「眼睑 / 嘴角 / 眉心 / 眉头上扬」等 FACS 结构词，否则两套规则互殴。
    ('J', r'(睫毛|眼睫|睫羽)(轻|微微|一)?(颤|抖动|颤动|扑闪)',
     'J 文学化微动作（模型没见过或量级太小）', '换成常见动作的面部版本：眼睑撑开/眼尾眯（FACS），或删'),
    ('J', r'(以寸计|寸许|半寸|一寸半|挪了?半寸|收了半寸|退了半寸)',
     'J 以寸计的位移（模型无法执行）', '换整体可见位移：后退一步 / 侧身让开半步以上，或删'),
    ('J', r'指尖(轻|微微)?(颤|抖|发抖|蜷缩)',
     'J 文学化微动作', '换握紧 / 松开 / 抬起这类可执行动作'),

    # ── K 道具光效（v5.21.0 · 第二个独立轴，不计入九类）
    # 来源：老李 model-adapters.md §5.0.3 / 机检 C20d·C18e。九类管「抽象→具体」，
    # 本类管「写具体了反而长歪」（判据二）：反光道具写光效 → 出片道具被「点火」。
    # 零光效描写：只留材质本色，光斑/受光/照射/映出/泛光/亮起类从句一律不写。
    # 词表刻意不收「反光率」（它是材质属性不是光效描写，收了会全量误报）。
    ('K', r'(玉佩|银镯|玉镯|宝石|翡翠|镜面|铜镜|金属|银器|瓷|漆器|玻璃|琉璃|水面)'
          r'[^，。；]{0,12}(光斑|受光|照射|照在|映出|倒映|泛光|亮起)',
     'K 道具光效（反光物写光效，出片会被「点火」）',
     '零光效描写：只留材质本色（玉面呈青玉原色/哑光金属本色）；光源改在人物身上复述，不与道具同句共现'),
    ('K', r'(光斑|受光|照射|照在|映出|倒映|泛光|亮起)'
          r'[^，。；]{0,12}(玉佩|银镯|玉镯|宝石|翡翠|镜面|铜镜|金属|银器|瓷|漆器|玻璃|琉璃)',
     'K 道具光效（光效词与反光物共现）',
     '零光效描写：只留材质本色；动作上去触发（不举向、不靠近光源）'),

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
     'G 模糊指代（英文；若为间接引语的内容则人工判为合规）', '给材质与轮廓＋数量与绑定位置（防桌上一个、手里一个、背景又一个）'),
    ('G', r'\b(an? )?(indistinct|unclear|undefined|vague) (shape|form|mass)\b',
     'G 模糊指代（英文）', '补材质与形状'),

    ('I', r'\b(a )?(complicated|complex|unreadable|inscrutable|knowing|thoughtful) (look|expression|gaze)\b',
     'I 神情评价（英文）', '换成眉/眼/嘴的具体动作'),
    ('I', r'\b(lost in thought|deep in thought|preoccupied|blankly)\b', 'I 内心评价（英文）',
     '换成可见动作与视线落点'),

    # ── M 模型行为禁用字（v5.35.0 新增 · 来源 phileiny/h3-storyboard-skill §五之三）
    # 这一类不触发其他任何规则，也不触发 check_prompt 的格式检查与 audit_risk 的敏感词检查——
    # 门禁全绿但出片必坏，属静默失败，故进高危集（命中退 exit 2）。
    # M6（提示词里出现不该入镜的物件名 → 模型会画进来）脚本抓不到，只进文档，见
    # references/抽象表述判定口径.md §六之二。
    ('M', r'\b(nothing|none|neither)\b[^，。；]{0,30}\b(chang\w*|mov\w*|shift\w*)\b'
          r'|(什麼|什么)?都(不變|不变|沒變|没变|不動|不动|毫無變化|毫无变化)',
     'M1 模型行为（否定式静止 → 整颗冻结，连底噪呼吸都没了）',
     '改正面陈述＋明写底噪：「只有 X 在动，其余保持」，并补呼吸／眨眼／衣料微动'),
    ('M', r'\bno\s+(push[-\s]?in|zoom|pan|dolly|dissolve|cut|fade)\b'
          r'|\b(do not|don\'t)\s+(push|zoom|pan|dolly)\b'
          r'|(禁止|不要|别)[^，。；]{0,4}(推轨|推拉|变焦|摇镜|横移|淡入|叠化)',
     'M2 模型行为（否定式运镜 → 剪点反而漂到 3.5 秒后）',
     '改正面陈述运镜方式；确需固定机位时写「机位固定，画面静止」'),
    ('M', r'\b(widen|spread|expand)(s|ing|ed)?\b'
          r'|(画面)?(扩大|擴展|扩展|蔓延|铺开)[^，。；]{0,12}',
     'M3 模型行为（无终点扩大 → 模型停不下来）',
     '给终点：「扩大到容纳 X 即停」'),
    ('M', r'\b(about|around|roughly)?\s*(one|two|three|four|five)?[-\s]?'
          r'(half|third|quarter|fifth|sixth|seventh|eighth)'
          r'\s+(as tall as|as wide as|of the frame|of the screen|of the image)\b'
          r'|[二三四五六七八九十半]?\s*分之[二三四五六七八九十半]+[^，。；]{0,14}'
          r'(of the frame|画面|画幅|屏幕|构图)'
          r'|占画面[^，。；]{0,8}(三分之二|一半|多半|大部分)',
     'M4 模型行为（分数尺寸 → 被忽略，实测只到 45–52%）',
     '讲裁切关系不讲分数：「头顶齐画框上沿，脚底切在膝下」'),
    ('M', r'(距|距离|离)[^，。；]{0,12}\d+\s*(厘米|公分|釐米|米|cm|mm)\b'
          r'|\b\d+\s*(cm|mm|centimeters?|meters?)\s+(away|from|of)\b',
     'M5 模型行为（带单位距离 → 被忽略）',
     '用参照物比例：「一臂之差」「一步之遥」'),
]

# ── 统一编译（v5.37.3）：全部规则加 IGNORECASE ────────────────────────
# 英文规则原来区分大小写。实测（selftest_audit_literal.py 的 E1/E2 锁住）：
#   `so white.` 命中，`So white.` 不命中；`nothing moves` 命中，`Nothing moves` 不命中；
#   `her face stays blank.` 命中，`Her face stays blank.` 不命中。
# 而 H3 面正文是**正常英文句子**，句首必然大写 —— 等于每条英文规则只在句中生效。
# 本脚本自述定位是「不漏，不是不误报」，这属于直接违背自家声明，故统一忽略大小写。
# 中文规则不受影响（无大小写字符），IGNORECASE 对它们是空操作。
RULES_C = [(cat, re.compile(pat, re.IGNORECASE), why, fix) for cat, pat, why, fix in RULES]

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

# 「定格」在收束窗里合法：三条件放行的【长段声明】收束措辞与 C14 可见终态
# （末拍静止 / 画面定格在 X）是本库**强制要求写**的画面语义，不是后期工序词。
# 2026-10-29《无人出席的圆桌》实战暴露：72 段包每段必写「定格」，
# F 类候选 ~200 条九成是这一族——扫描器落后于《抽象表述判定口径.md》§四
# 「画面定格＝末拍静止收束，合法必留」的既有裁决，按三步复验铁律补齐。
# 只豁免「定格」这个词、且只在 ±6 字语境命中收束/终态标记时——
# 「定格转场」「定格蒙太奇」类真剪辑语照抓（自测 R5/R6 双向锁）。
# 全黑定格单列：该族写作「末 1s 全黑定格」，「全黑」两字恰好把「末 1s」
# 推出 ±6 字窗口（复跑实测 15 条残剩全部是它），词表补 token。
F_FREEZE_CTX = re.compile(r'收束|末\s*1s|末拍|画面定格|全黑定格|完全静止|静止')

# 文末附文停扫标记：整片包的「四 全局制作纪律 / 附 改动复验报告 / 附 校验结果」
# 属**文档层**，不是投喂正文，但它们落在最后一个镜块之后，
# 会被当成本镜正文扫进去（实测「转场表完整性 —— OK」触发 F 剪辑语 ×2）。
# v4.7.3 志怪剧本实战再抓一轮：「一转场注记总表」「二 连续性台账」同样触发 F 类
# （里面的「蒙太奇」「转场」是给剪辑看的文档层词汇，不是投喂正文）；
# 且原正则要求 # 前缀，而交付格式的文档层小标题按用户约定不带 #——改为 # 可选。
# 命中即停止扫描——附文本来就不该参与抽象表述判定。
ANNEX_STOP = re.compile(r'^\s*#{0,6}\s*(附[一二三四五六七八九十]?[、.．：:]|附录|全局制作纪律|'
                        r'[一二三四五六七八九十]+[、.．]\s*全局制作纪律|'
                        r'生成批次单|配音对齐单|'
                        r'[一二三四五六七八九十]+[、.．]?\s*(转场注记|连续性台账))')

CATEGORY_NAME = {
    'A': 'A 程度评价', 'B': 'B 孤句判断', 'C': 'C 画面比喻',
    'D': 'D 摄影术语', 'E': 'E 不可控时长', 'F': 'F 剪辑语',
    'G': 'G 模糊指代', 'H': 'H 画面行听觉词', 'I': 'I 神情评价',
    'J': 'J 动作可生成度', 'K': 'K 道具光效', 'S': 'S 高敏感画面',
    'M': 'M 模型行为',
}
# 高危 = 命中即退 exit 2。M 类（模型行为禁用字）进高危集：这类写法不触发其他任何规则，
# 门禁全绿但出片必坏，是「静默失败」，比误报危险得多。
HIGH_RISK_CATS = {'A', 'D', 'F', 'K', 'M', 'S'}


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
    ap.add_argument('--no-log', action='store_true',
                    help='本次不写 .gates.jsonl（默认写，写失败静默跳过）')
    args = ap.parse_args()

    try:
        raw = open(args.file, encoding='utf-8').read()
    except Exception as e:
        print('读取失败：', e)
        return 2

    lines = raw.splitlines()

    # 段/镜标题切分
    # 兼容四种编号：`镜 N`／`段 N`／`Shot N`（分镜面）／`U01`（MiniMax H3 面）。
    # 旧版不认 `U`，H3 面一个标题都匹配不上 → in_body 恒为 False →
    # 整包零命中却报「✅ 未检出抽象表述候选」（实测 57 单元全漏，属静默假通过）。
    # 同时补 Markdown 标题前缀 `#{0,6}` 与小数秒（28.5s）。
    seg_pat = re.compile(
        r'^\s*#{0,6}\s*(镜\s*\d+|段\s*\d+|Shot\s*\d+|U\s*\d+)'
        r'[｜|]?\s*(.+?)（(\d+(?:\.\d+)?)s')
    # 资产提示词包（v4.7.6）：资产条目头是「资产 CHAR-01｜某角色（4 View 角色资产板）」，
    # 不带时长括注，上面那条一个都匹配不上。不补这条，资产包会掉进
    # 「扫了 0 行」的假绿防线，报 E-NO-BODY-SCANNED —— 那是把「格式不适用」当成了「不合格」。
    asset_pat = re.compile(
        r'^\s*#{0,6}\s*(?:[一二三四五六七八九十]+[、.．]?\s*)?'
        r'((?:资产|角色|场景|道具)\s*[A-Za-z0-9-]*)\s*[｜|]\s*(.+)$')
    cur_seg = '(未分段)'
    in_body = False  # 卷首（第一个段/镜标题之前）属文档层，不扫
    hits = []
    seen = set()
    body_candidate = 0   # 认作正文的行数（--seg 过滤前）
    scanned = 0          # 真正送进规则的行数（--seg 过滤后）
    for ln, line in enumerate(lines, 1):
        if ANNEX_STOP.match(line):
            break               # 进入文末附文（文档层），停止扫描
        m = seg_pat.match(line) or asset_pat.match(line)
        if m:
            cur_seg = m.group(1).replace(' ', '')
            in_body = True
        if not in_body:
            continue
        if not is_body_line(line):
            continue
        body_candidate += 1
        if args.seg:
            allow = [x.strip() for x in args.seg.split(',')]
            if cur_seg not in allow:
                continue
        scanned += 1
        for cat, pat, why, fix in RULES_C:
            if cat == 'F' and F_EXEMPT_LINE.match(line):
                continue
            for mm in pat.finditer(line):
                if strip_false_positive(line, mm):
                    continue
                if cat == 'F' and mm.group(0) == '定格' and \
                        F_FREEZE_CTX.search(line[max(0, mm.start() - 6):mm.end() + 6]):
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

    # ── 假绿防线（v4.7.6）──────────────────────────────────────────────
    # 门最危险的状态不是报错，是「什么都没查却报 ✅」。历史上 H3 面（U01 段头）
    # 就整包漏扫过一次：in_body 恒为 False → 零命中 → 报「未检出」。那次靠补正则
    # 修了 U01，但补正则只能救已知格式。这里做通用兜底：扫了 0 行就别装作通过。
    if scanned == 0:
        print('=' * 68)
        print('❌ 没扫到任何可复制正文行 —— 本门这一次什么都没查，不能算通过。')
        print()
        if body_candidate > 0:
            print('   正文行有 %d 行，但被 --seg 全滤掉了：当前 --seg=%s' % (body_candidate, args.seg))
            print('   对照实际段名重给（段名形如「镜1」「Shot2」「U03」），或去掉 --seg 跑全包。')
        else:
            print('   常见原因：')
            print('   1) 段头没被认出来。认的是 镜 N｜标题（Ns）/ 段 N / Shot N / U01，')
            print('      标题里必须有「（10s」这类时长，可带 Markdown # 前缀与小数秒（28.5s）；')
            print('   2) 文件是空文件、闲聊文本，或只有文档层（# 参数行 / > 说明行 / 表格 / 文末附文）；')
            print('   3) 投的是 MiniMax H3 六段式包——那种格式本门不认，先转成段头式再扫。')
        print()
        print('   自查：把第一个段头贴出来对着上面第 1 条看一眼。没写镜头的草稿先别跑本门。')
        print('   ——E-NO-BODY-SCANNED：本门这一次未实际执行。退出码 2 在本脚本里另有两义'
              '（有高危候选 / 文件读取失败），靠这行字与门上日志区分。')
        print('=' * 68)
        if not log_disabled(sys.argv):
            append_gate_log('audit_literal.py', args.file, 2,
                            [{'code': 'E-NO-BODY-SCANNED', 'level': 'error',
                              'where': '(包级)', 'msg': '抽不到可复制正文行，本门未实际执行'}])
        return 2

    if not hits:
        print('✅ 未检出抽象表述候选。（实扫 %d 行正文）' % scanned)
        if not log_disabled(sys.argv):
            append_gate_log('audit_literal.py', args.file, 0, [])
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
    code = 2 if high else 1
    # 门失败日志：按类别计数（A类/D类/…），stats 聚合后看哪类最常响
    if not log_disabled(sys.argv):
        payload = [{
            'code': h['cat'] + '类',
            'level': 'error' if h['cat'] in HIGH_RISK_CATS else 'warn',
            'where': h['seg'], 'msg': h['why'],
        } for h in hits]
        append_gate_log('audit_literal.py', args.file, code, payload)
    return code


if __name__ == '__main__':
    sys.exit(main())
