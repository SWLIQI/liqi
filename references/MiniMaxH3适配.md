# MiniMax H3 适配规范（liqi 格式 × MiniMax H3 对接）

本文件规定本 skill 的终稿格式（卡通轨见 `终稿格式示例.md`，写实轨见 `写实向终稿示例.md`）投放到 **MiniMax H3**（开源视频生成模型，含 H3 Max 极速版与
H3-Context-IR / H3-Regenerate-2K 两条服务端增强）时的改写规则。依据 MiniMax 官方
`h3-prompt-writing` skill（可选，非必需）里的 `references/base-en.txt`（**该 skill 的 references 目录，不是本 skill 的**） 与 `references/ref-en.txt` 整理。

**总原则：与 Seedance 2.5 适配同源——liqi 的增值层全部保留（风格锚九段、预算体系、可见性限定式、
四层混音、连续性台账、转场注记、参数行、滑窗拆分），只改与 H3 冲突的部分。**

但 H3 的冲突比 2.5 更深，一共四处，必须逐条执行：

| 冲突 | liqi 原样 | H3 要求 |
|---|---|---|
| 语言 | 中文正文 | **正文必须英文**，只有对白与画面可见文字保留原语言 |
| 结构 | 镜块 + 【时间轴】 | **六段式**（Ref2VA）或三字段（base 模式） |
| 素材 | `@图片N` 五分工 | **`<Subject N>` / `<Picture N>` 标签体系**，上限 12 |
| 负向 | `Must not` 行进正文 | **H3 没有 negative 字段**，Must not 不得进正文 |

**分工铁律**：liqi 负责「想清楚」，本文件负责「翻译成 H3 能吃的英文六段式」。
不要跳过 liqi 的 Step -1 到 Step 2 直接写 H3 稿——那样会丢掉预算、轴线、表演与一致性体系，
只剩一堆英文形容词。

**上下游关系**：H3 字段格式以本文件为准；若本机装有 MiniMax 官方 `h3-prompt-writing` skill，
其 `references/base-en.txt` 与 `ref-en.txt` 可作为权威补充。**两者均未安装也不影响使用本文件。**
本文件不重复规定字段细节，只规定 liqi 各小节往哪个字段落。拆镜节拍参考 `h3-storyboard`，
具名运镜参考 `h3-camera-shots`，出片返修参考 `h3-shot-iteration`。

---

## 〇、投放面与轨道（锁③ 扩展）

| 项 | H3 面取值 |
|---|---|
| 段头骨架 | `[Shot 1] 英文画面描述`；第二镜起 `[Shot N] At MM:SS.mmm, ...` |
| 风格轨道 | 卡通轨 / 写实轨 / **手绘轨**（水墨、水彩、绘本、版画等，见 `水墨淡彩2D风格锚.md`） / **定格木偶轨**（哥特、Burton 暗黑童话、微缩布景，见 `哥特定格木偶风格锚.md`） |

**轨道判定**：用户给的是水墨淡彩设定图、绘本插画、水彩分镜，一律走**手绘轨**；
给的是木偶质感、微缩布景、大头细肢的暗黑童话设定图，走**定格木偶轨**。
手绘轨的负面词方向是「写实照片感、3D 渲染、赛璐璐描边、塑料高光」，技术规格方向是
「平面手绘、纸纹可见、无体积渲染、无渐变」；定格木偶轨则是「禁皮克斯迪士尼感、光滑 CGI、写实真人、
动漫、运动模糊」，技术规格方向是「哑光黏土皮肤、微缩布景实拍、轻微定格顿挫、月光蓝低饱和」。
| 时长闸门 | **单条 4–15 秒**。liqi 的「超过 20 秒滑窗拆分」在 H3 面收紧为 **超过 15 秒必须拆** |
| 交付形态 | 同锁③，md 是唯一真相 |

**轨道判定**：用户给的是水墨淡彩设定图、绘本插画、水彩分镜，一律走**手绘轨**。
手绘轨的负面词方向是「写实照片感、3D 渲染、赛璐璐描边、塑料高光」，技术规格方向是
「平面手绘、纸纹可见、无体积渲染、无渐变」。**手绘轨与卡通轨不可混用**——
卡通轨要求「硬边单色阴影 + 粗黑轮廓线」，水墨要的是「细匀墨线 + 边缘晕染」，写反全片质感就废了。

---

## 一、模型与模式选择（锁① 扩展）

锁① 从「二选一」扩为「三选一」：**Seedance 2.5 / Seedance 2.0 / MiniMax H3**。
锁 H3 时再追加一项**生成模式五选一**，按素材情况判定，判定错会直接浪费一次生成：

| 素材情况 | 模式 | H3 技术名 | 输出结构 |
|---|---|---|---|
| 无素材，纯文字 | T2VA | H3-Base-FL2VA | 三字段 |
| 只有 1 张首帧图 | I2VA | H3-Base-FL2VA | 指令行 + 三字段 |
| 首帧 + 尾帧 2 张 | FL2VA | H3-Base-FL2VA | 三字段（写清首帧到尾帧的连续路径） |
| 只有 1 张尾帧图 | L2VA | H3-Base-FL2VA | 三字段（反推开场，收敛到给定尾帧） |
| **多图 / 视频 / 音频，≤12 个** | **Ref2VA** | H3-Ref | **六段式** |

**liqi 主流程（跨镜一致性生产）对应 Ref2VA**，本文件默认按 Ref2VA 讲。
只有单镜独立素材、不需要跨镜继承时才走 base 三字段模式。

**H3 与 H3 Max**：Max 只出 480P/768P、5–15 秒，仅标准生成端点，**不支持 2K**；
两者共用同一套请求协议（只改 `model` 字段），**提示词写法完全通用**。
用法：草稿迭代、批量出片、A/B 测试提示词走 Max 省时间，终稿切回 H3 出 2K。

**服务端增强（可选，不影响提示词写法）**：`H3-Context-IR` 会自动把你的提示词改写成模型最吃的
表示；`H3-Regenerate-2K` 拿 768p 结果加原始上下文重生 2K。**走 API 时这两段由服务端完成，
本地权重没有。** 这不影响本文件的任何改写规则。

---

## 二、符号系统对齐（硬变更，六条）

| 内容 | liqi 原写法 | H3 写法 | 示例 |
|---|---|---|---|
| 台词 | 「原文」/ `{原文}` | `<d>[Chinese] 原文</d>` | `<d>[Chinese] 你来了。</d>` |
| 说话人 | 角色名（语气/语速） | `(S1)` `(S2)`，按**实际出声顺序**分配一次，全片复用 | `<Subject 2> (S1) says, <d>[Chinese] 你来了。</d>` |
| 音乐 | 混在音效行 | `non_diegetic_music:` 段 | `A restrained solo-piano score at a slow tempo...` |
| 音效 | 音效行 | 具体音写进对应 `[Shot N]`；环境底噪写进 `overall_soundscape:` | `overall_soundscape: ...` |
| 字幕 | 禁 | 禁（H3 同样会把文字画出来） | 画面不显示字幕 |
| 结构标签 | 【时间轴】0-7s： | `[Shot 1]` / `[Shot N] At 00:03.000,` | 见模板 |
| 参考素材 | `@图片N` | `<Subject N>` / `<Picture N>` / `<Video N>` / `<Audio N>` | 见第四节 |

**台词格式细节**（官方口径，逐条执行）：

1. 标点只保留 `,` `.` `?` `!`，去掉重复波浪号、emoji、列表符、装饰标点。
2. 完整陈述句以 `.` 结尾，问句 `?`，感叹句 `!`，**都要写在 `</d>` 之前**。
3. 听不清的片段写 `[unclear]`，禁止猜写或改写。
4. **只引用音色/节奏/情绪时，不要把原音频的台词搬进目标视频**。
5. 台词属于被复用的 BGM 或完整配乐的一部分、且没有具体人物发声时，用 `<Audio N>` 作声源，
   **不要凭空编一个 `(Sx)`**。
6. 说话人在画外时写 `<Subject N> (Sx)` 并标注 `off-screen`。

**语言铁律**：英文正文里只有三处可以出现中文——`<d>` 里的对白、歌词、画面里真实存在的文字。
其余一切（风格锚、站位、表演、声音）全是英文。

---

## 三、素材引用（H3 核心机制，最容易写错）

### 3.1 什么时候单列 `<Picture N>`，什么时候不单列

这是官方文档里最容易被写错的一条，直接决定角色会不会被画成设定表：

> **一张图只用来定义角色、场景、服装或风格时，不要单列 `<Picture N>` 条目，
> 直接写进对应的 `<Subject N>` 定义里。**
> 只有该图本身要当某颗镜头的首帧、尾帧、关键帧或分镜锚点时，才单列 `<Picture N>`。

对照 liqi 的内联锁定策略：

| liqi 条件 | H3 写法 |
|---|---|
| 有干净参考主体图，已声明首帧 | 单列 `<Picture N> is the first frame of [Shot X].`，**再补一句该帧的构图、主体位置与镜头方向** |
| 有参考图但未声明为首帧 | 写进 `<Subject N>` 定义：颜色 + 轮廓 + 可辨识特征 |
| 无参考图（T2VA） | subject_definitions 里不出现该主体，全量内联到 detailed_description |
| 整合镜拆出的子片段 | `<Subject N>` 定义一次，后续 Shot 沿用同一标签，不重新定义 |

**三视图 / 4 View 板只能当 `<Subject N>` 定义，绝不能当首帧。**
它是设定表版式，一旦当首帧，模型有概率照着画出三宫格或四宫格排版。
同理，带水印、带色卡、带标注文字的资产图都不能当首帧。

### 3.2 五分工怎么翻译成 H3

liqi 的「仅用于 X，不继承 Y」在 H3 分两处落地：

- **用途声明**写进 `<Subject N>` 定义句里（对应「仅用于 X」）
- **保留程度**写成 `retention_analysis` 的关系标记（对应「不继承 Y」的正面表达）

四种标记，只能从这四个里选，不能自造：

| 标记 | 含义 | liqi 对应 |
|---|---|---|
| `fully_preserved` | 定义的角色被完整保留 | 身份特征全继承 |
| `partially_preserved` | 仍用，但部分特征被改或只部分保留 | 继承脸不继承服装 |
| `attribute_transfer` | 特征被转移到另一个可辨识主体 | 换人穿这套衣服 |
| `weak_reference` | 只保留风格、类别、构图或氛围的大致相似 | 只取画风不取内容 |

音频的四个标记是另一套：`fully_copy` / `partially_copy` / `reference` / `weak_reference`。

### 3.3 素材上限与编号

- Ref2VA 参考资产 **≤12 个**（图片、视频、音频合计）。
- `<Video N>` 与 `<Audio N>` 各自独立编号，同一份视频文件可以同时是 `<Video 1>` 和 `<Audio 2>`。
- 普通参考视频**不会因为文件里有声音就自动产生 `<Audio N>`**，只有你要用它的声音时才定义。
- **不要在 summary 和 retention_analysis 里引入新标签**，只能用 subject_definitions 定义过的。

---

## 四、六段式映射表（liqi 小节 → H3 落点）

Ref2VA 六段，顺序与字段名**一个字都不能改**：

```text
subject_definitions  →  summary  →  retention_analysis  →  detailed_description
                     →  overall_soundscape  →  non_diegetic_music
```

| liqi 小节 | H3 落点 | 写法要点 |
|---|---|---|
| 镜号与标题 | `[Shot N]` 标记 + 参数行 | 时长不写进正文，落参数行 |
| 场景与人物 | `detailed_description` 各 Shot 内 | 出场对象逐 Shot 写明位置；画外者写 off-screen |
| 站位与轴线 | `detailed_description` 内，英文写三行 | 画面位置 + 依托物 + 朝向 + 位移，与 liqi 站位行同构 |
| 生成视频起始行 | 不进正文 → 参数行 | H3 无此字段 |
| 整体风格 | `detailed_description` **开头一句**，在 `[Shot 1]` 之前 | 风格锚英文压句，见 `水墨淡彩2D风格锚.md` |
| 本镜保真预算 | `detailed_description` 内正向写 | 主/次/省写成「Detail goes to X; Y stays flat」 |
| 本镜光色基调 + 色彩预算 | `detailed_description` 内 | 唯一重音色写成「the only strong hue in the frame is X」 |
| 时间线分镜（【时间轴】段） | 拆成 `[Shot N]`，**一段一镜** | 切点写 `[Shot N] At MM:SS.mmm` |
| 声音设计 环境层 | `overall_soundscape:` | 一句话概括整片环境音 |
| 声音设计 动作层 / 呼吸层 / 逼近层 | 对应 `[Shot N]` 内 | 具体声音锚到具体镜 |
| 声音设计 对白 | `<d>` 内，写在对应 Shot | **只写一次**，见第五节台词三写的变更 |
| 刚性约束 必锁 | `detailed_description` 内正向写 | 必锁用「它是 X」，不写排除式 |
| 可见性限定式 | `detailed_description` 内 | 只/仅 + 范围，英文同样用限定式 |
| **Must not 行** | **不进正文**，降级为参数行注释 | H3 无 negative 字段，见第六节 |
| 参数行 | 保留，扩展 | 加 model / mode / ref 数量，见第七节 |
| 风格锚（九段） | 压缩成一两句英文 + 风格 `<Subject N>` | 见第八节 |

**`detailed_description` 的体量**：生成任务通常 **350–500 个英文词**。
对白密集的片段优先保证台词时间轴完整，不必凑字数。
单镜不会因为「只有一镜」就自动变短，按信息量在多镜之间分配细节。

---

## 五、台词写法的变更（重要）

liqi 的**台词三写**（时间线段内 + 镜行尾 + 对白行，三处逐字一致）在 H3 面**降为一写**：

- 台词只在**对应 Shot 的 `<d>` 里出现一次**。
- 不要在 summary、retention_analysis、overall_soundscape、non_diegetic_music 里重复台词。
- 保留的约束是**标签一致**：同一说话人全片用同一个 `(Sx)`，同一主体全片用同一个 `<Subject N>`。

原因：H3 的 `<d>` 会被模型当成发声事件去排时间，重复写会被当成两次发声，口型与时长都会乱。

**台词密度红线照旧**（旁白 ≤4.0 字/秒，对白 ≤5.0 字/秒），但中文台词按中文字数算，
不要把这条套到英文正文的词数上——两者是两件事。

---

## 六、Must not 行与否定式（H3 面最大的坑）

**H3 没有 negative prompt 字段。** 因此：

1. **Must not 行不得进 H3 正文。** 它降级为 md 层的参数行注释：
   ```text
   # Must not（仅供人读，不进 H3 正文）：可读文字、字幕、水印、logo
   ```
2. 必须规避的东西改用**正面描述压制**，不要写否定句。
   例：不要写 `no 3D render`，改成 `flat hand-painted artwork printed on paper, with no illusion of volume`
   ——注意这句的落点仍是「它是平面手绘」，否定成分只作为补语，不作为否定指令。
3. 正文里出现 `no / not / avoid / without` 的频率要压到最低。
   liqi 的 `抽象表述判定口径.md` 与 `scripts/audit_literal.py` 照跑，H3 面额外加一条：
   **否定式在英文正文里同样是「命名即种下」**。
4. 唯一可以保留「不采用」语义的地方是 `<Subject N>` 定义句里对素材用途的限定
   （如「只用于身份，不采用图片背景」）——这是素材职责声明，不是画面否定式，官方允许。

---

## 七、参数行（H3 面扩展）

```text
—— 以下不进正文 ——
# model: MiniMax-H3 | # mode: Ref2VA | # duration: 8s | # ratio: 16:9
# 输出规格: 768p/24fps（终稿走 H3-Regenerate-2K 出 1440p）
# refs: 5（Subject 1-5，上限 12）
# Must not（仅供人读，不进正文）：可读文字、字幕、水印、logo
# 景深注记：第二段微距，其余中景
# 保真预算：主 = 面部与水痕晕染；次 = 衣料褶皱；省 = 远景群像
# 交接：本镜末帧作为下一镜首帧参考
```

画幅、时长、分辨率、帧率**一律不进正文**，由页面或 API 设置。

---

## 八、风格锚压缩规则

liqi 的九段风格锚在 H3 面压成两句英文，写在 `[Shot 1]` 之前。
压缩时按下面顺序取舍：

| 风格锚段 | 是否进 H3 英文压句 | 说明 |
|---|---|---|
| 画风与材质质感 | **必留** | 决定全片质感，写死在压句里 |
| 配色与色域 | **必留** | 一句话写清调色板 |
| 运动签名 | **必留** | 帧率感、运动幅度、是否抽帧 |
| 角色锁定 | 改走 `<Subject N>` | 不进压句，进 subject_definitions |
| 场景锁定 | 改走 `<Subject N>` | 同上 |
| 道具锁定 | 改走 `<Subject N>` | 同上 |
| 光色基调 | 逐镜写进 Shot | 不进全片压句 |
| 声音签名 | 改走 `overall_soundscape` / `non_diegetic_music` | 不进压句 |
| 排除项 | **丢弃** | H3 无 negative，见第六节 |

**压句逐字复用铁律**：全片每一条提示词的风格压句必须**一字不差**。
改一个词，不同镜头的质感就会漂移。压句统一存放在风格锚文件里（手绘轨 `水墨淡彩2D风格锚.md`、
定格木偶轨 `哥特定格木偶风格锚.md`），用哪套风格就复制哪套。

---

## 九、能力边界（H3 面 + liqi 铁律合并）

1. **单镜 4–15 秒**，超过必拆。liqi 的滑窗拆分阈值在 H3 面是 15 秒。
2. **一镜一个主节拍**（表情类）。一颗镜头塞超过两三个表情节拍，模型会朝平均运动收敛，
   把表情全部抹平，而且不会报错。实测对照：7 秒特写塞 9 个节拍，脸部变化只有 37–42 dB（等同冻结帧）；
   拆成三颗 2–3 秒、每颗一个主节拍，掉到 22–23 dB，表情全部到位。
   **全身位移不受这条限制**——拳脚、重心转移、被打退这类动作一镜 3 秒塞满招式是可行的，
   拆镜理由改成「换角度」而不是「节拍太多」。
3. **不要拍碰撞、不要拍液体的量、不要拍物体被切成两半。** 这些 H3 处理不好。
   解法是不拍那一刻：拍光一闪加物件离开，或把量写死界限。liqi 动作接触戏的链条里，
   「接触」那一段在 H3 面要改写成「接触前一帧 + 接触后的结果态」。
4. **运镜只有 12 个原语**，没有具名复合镜头。滑轨变焦、甩镜、摇臂升起这类具名镜头
   要用原语在句子里拼出来，拼法查 `h3-camera-shots`。
   水墨手绘轨请克制：固定中景、缓推、横移、微俯、轻摇为主，避免甩镜与 360 环绕撕掉安静感。
5. **可读文字无法靠 Prompt 保证**，与 liqi 文字铁律一致，一律后期合成。
6. **抽象词禁令照旧**：`cinematic`、`beautiful`、`high quality` 这类词官方明确要求替换成
   具体的视觉与听觉细节。跑 `scripts/audit_literal.py` 之前先自查这些英文词。
7. **帧级时间点**：`[Shot N] At MM:SS.mmm` 是切点标记，不是帧级剪辑点，不承诺精确到 0.5 秒。
8. **称谓保真**：用户写「人物/主体」就保持中性称谓，不从素材外观反推身份、年龄、关系。

---

## 十、单镜模板（可直接替换 Step 3 投 H3）

以水墨淡彩手绘轨、两名虚构角色（角色 A / 角色 B）、一处庙宇场景为例。**英文正文 + 中文对白**：

```text
subject_definitions:
<Subject 1> is the young woman A-Ying, whose identity comes from the character sheet and the half-body portrait: a round soft face, slightly lowered upper eyelids, a faint red flush across the lower eyelids and the bridge of the nose, thin pale brows, black hair gathered into a topknot with a wooden pin and a few loose strands falling at the temples, a slate blue-grey cross-collar jacket, a deep brown apron, tied trousers and cloth shoes.
<Subject 2> is the old man Zhu Weng, whose identity comes from the character sheet: white-streaked hair in a topknot with a wooden pin, a goatee, deep wrinkles, lowered eyelids, a deep indigo cross-collar robe with a brown cloth sash, white socks and black cloth shoes.
<Subject 3> is the temple environment from the front view plate: cinnabar beams and columns, grey tiles, a white wall, an ochre earth slope, dark green pines and stone steps.
<Subject 4> is the barren ground outside the temple from the plate: cracked pale earth, the broken roof frame, two pines, an ochre-red grass slope and pale violet distant mountains.
<Subject 5> is the global art style shared by all five reference images: hand-painted Chinese ink-and-wash 2D animation on xuan paper, muted palette of xuan-paper white, pale lilac grey, slate blue grey, ochre earth and pine green with a single restrained cinnabar accent.

summary:
[reference generation] <Subject 1> climbs the stone steps into <Subject 3>, finds <Subject 2> standing with his back to her in front of the hall, stops two paces behind him and speaks. The three-shot exchange is rendered entirely in <Subject 5>.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - her face, hair, wooden pin, jacket and apron carry through every shot.
<Subject 2> (appears in [Shot 1], [Shot 3]): fully_preserved - his hair, goatee, wrinkles and indigo robe carry through.
<Subject 3> (appears in [Shot 1], [Shot 2]): fully_preserved - the cinnabar beams, grey tiles, stone steps and ochre slope stay in place.
<Subject 4> (appears in [Shot 3]): fully_preserved - the cracked earth, broken roof frame and two pines stay in place.
<Subject 5>: weak_reference - only the overall hand-painted ink-and-wash manner and the muted palette are followed.

detailed_description:
Hand-painted Chinese ink-and-wash 2D animation on xuan paper, in a quiet illustrated storybook register. Thin even ink outlines with occasional dry-brush breaks, flat watercolor washes that bleed slightly at their edges, no gradients, no rendered volume, no specular highlights. Large areas of bare paper read as sky and ground.
[Shot 1] A wide shot holds on <Subject 3> from the base of the steps, the hall filling the upper two thirds of the frame while bare paper reads as sky above the roofline. The cinnabar columns stand at the left and right thirds, grey tiles overlap in flat strokes, and the stone steps cut a pale diagonal across the lower half. <Subject 1> enters at the lower left, small in frame, her slate blue-grey jacket a single flat shape against the ochre slope. She climbs with her hands folded at her waist, one step every two beats, her loose strands of hair moving half a beat behind her. The camera is locked off. Dry wind moves the pine needles in the upper right; one wooden board creaks under her foot. Detail goes to her face and the wet edge of the washes; the background stays a flat ochre field with no further ornament.
[Shot 2] At 00:03.000, the shot cuts to a medium shot from behind <Subject 1>, following her as she reaches the top step at a slow, even pace. <Subject 2> stands in the right third of the frame with his back to her, motionless, his indigo robe hanging straight to his ankles and his topknot catching no light. The gap between them is roughly two paces of bare paper. She shortens her stride as she notices him, her shoulders drawing back a little, and her hands come apart at her waist before folding again. The camera keeps the same height and drifts forward only slightly, staying behind her shoulder so her face is never fully seen. Wind crosses the eaves; fabric whispers once as she stops.
[Shot 3] At 00:06.000, the shot cuts to a close-up of <Subject 1> as she stops two paces behind him and lowers her eyes. Her upper lids drop a little further, her mouth closes, and the flush on the bridge of her nose stays as a flat pink wash. <Subject 1> (S1) says in a quiet young female voice, <d>[Chinese] 老人家，我找你好久了。</d> She closes her mouth and waits, her chin tipped down, breathing once through her nose. <Subject 2> does not turn; his shoulders do not move. The only strong hue in the frame is the cinnabar column behind him. Silence holds for the last beat, and the pine needles stop moving.

overall_soundscape:
Thin high-altitude wind across the eaves, a low wooden creak from the boards underfoot, and one distant temple bell that does not repeat.

non_diegetic_music:
N/A

—— 以下不进正文 ——
# model: MiniMax-H3 | # mode: Ref2VA | # duration: 8s | # ratio: 16:9
# refs: 5（上限 12）
# Must not（仅供人读，不进 H3 正文）：可读文字、字幕、水印、logo
```

模板已按校验器口径写足（`detailed_description` 约 440 英文词），
拿去跑 `scripts/check_prompt_h3.mjs` 应当是 0 error / 0 warning。
**别把它当填空骨架原样套**——词数是按这一镜的信息量算出来的，换场景要重写描述，不是删词。

---

## 十一、交付前校验（H3 面专用流程）

```bash
node scripts/check_prompt_h3.mjs <file>
```

必查项：六段齐全且顺序对、字段名逐字对、标签在四段里保持一致、`<d>` 成对且带语言标记、
单镜时长 4–15 秒、`detailed_description` 350–500 词、正文无 `Must not` 行、无高频否定式。

另外三个脚本照跑：

- `python scripts/audit_literal.py <file>`——画面表述抽象九类 + 高敏感画面。
  **英文正文同样要跑**，抽象词禁令不分语言：脚本内置英文对应规则（程度评价 / 画面比喻
  as if、as though、like a / 摄影与 slop 词 / 不可控时长 for a while、for a long moment /
  模糊指代 something / 神情评价），命中后按同一套类别输出。
  三处刻意不建规则，建了会全片误报：`the shot cuts to`（H3 多镜切点的正规表达）、
  风格锚里的 `no gradients` / `no rendered volume`（负向排除句）、`gaunt`（外貌锁里的合法体征）。
- `python scripts/audit_project.py <file> --script <剧本.txt> --cast <角色,逗号分隔> --limit 15`
  ——H3 面的 `--limit` 传 15（单条上限）。三个审计脚本都能识别 `U01｜` 单元号
  （含 `###` 前缀与标题里的场景括注，如「场 1 · 某处庙宇前殿（日）· 拾香（14s）」），
  转场表行 `| U01 → U02 | … |` 与 `# refs:` 行也各自认；因此 H3 面的包
  **不应再出现**「无转场表」「全部块未指定首帧参考」这两条 WARN——
  若仍出现，先查单元标题格式，再查这两处解析。
- `python scripts/audit_risk.py <file>`——投国内平台前必跑，H3 不替代审核预检。
  注意看首行的「镜数」：若为 0 或明显小于实际单元数，说明单元标题没被解析到，
  那一屏的「0 触发」是空转，不是通过。

**文末附文停扫**：整片包的「四 全局制作纪律 / 附 改动复验报告 / 附 校验结果」属文档层，
`audit_literal.py` 命中这些标题即停扫（否则附文里的「转场表」等词会被当正文触发 F 类）。

看板编译（要点看板时）：

```bash
python scripts/h3pkg_to_board_src.py <包.md> --script <剧本.txt> \
    --assets <资产条目.md> --out <看板源.md>
python scripts/build_board_lite.py <看板源.md> --out <看板.html>
```

**不要拿包直接喂 `build_board_lite.py`**——H3 面没有 ```text 围栏与 `[起-止秒]` 行，
全片每个单元都会报那两条 WARN，看板出得来但镜头卡是空的、围栏没法复制。
细节见 `看板编译规范.md` §6.1。

---

## 十二、新旧格式速查表

| 项 | liqi 原格式 | H3 适配版 |
|---|---|---|
| 正文语言 | 中文 | **英文**（只有 `<d>` 与画面可见文字保留原语言） |
| 段头 | 【时间轴】0-7s： | `[Shot 1]` / `[Shot N] At 00:03.000,` |
| 台词 | 「原文」/ {原文} | `<d>[Chinese] 原文</d>` |
| 说话人 | 角色名（语气/语速） | `(S1)` `(S2)` 按出声顺序，全片复用 |
| 台词出现次数 | 三写 | **一写**（只在对应 Shot 的 `<d>` 里） |
| 素材引用 | `@图片N` + 五分工 | `<Subject N>` 定义内写来源；首帧才单列 `<Picture N>` |
| 素材上限 | 30 图 | **12 个**（图/视频/音频合计） |
| 三视图 / 4 View 板 | 可作资产 | **只能当 Subject 定义，绝不能当首帧** |
| 音乐 | 混音行 | `non_diegetic_music:` |
| 环境音 | 混音行 | `overall_soundscape:` |
| 动作/呼吸/逼近层 | 混音行 | 写进对应 `[Shot N]` |
| 风格锚 | 九段中文 | 压成 1–2 句英文，写在 `[Shot 1]` 之前，全片逐字复用 |
| 角色/场景/道具锁定 | 内联在风格锚 | 改走 `<Subject N>` |
| Must not | ≤1 行进正文 | **不进正文**，降级为参数行注释 |
| 否定式 | 只 Must not 允许 | 全正文压制，改成正面描述 |
| 参数行 | `# duration` 等 | 加 `# model` `# mode` `# refs` |
| 滑窗阈值 | 20 秒 | **15 秒** |
| 单镜节拍 | 一段一主动作 | 表情类一镜一个主节拍；全身位移可放宽 |
| 运镜 | 原语群 | 12 原语拼装，具名镜头查 `h3-camera-shots` |
| 详细体量 | 按字数预算 | `detailed_description` 350–500 英文词 |

---

## 十三、中文对照版体例（用户读不懂英文时出）

英文正文是 H3 面的硬要求，改不了。但用户看不懂英文就没法审片、没法判断包里写的是什么。解法是**双轨**：英文包照投喂，另出一份中文对照版供审读。**中文版不能替代英文投喂版**，文件头第一句就要把这条说清楚，否则会被误拿去生成。

### 13.1 别做的事：逐单元重译 `subject_definitions`

实测某 57 单元包，`subject_definitions` 占 12437 英文词。但同一主体的定义在 57 个单元里措辞基本一致（有的单元多一句 `Used for identity and costume only`，有的少一句），逐条重译会产出一万多词的重复文本，读起来还看不出差异。**这是纯浪费。**

### 13.2 该做的事：全局注册表 + 单元引用说明

文件按五节组织：

| 节 | 内容 |
|---|---|
| 一 全局固定段落 | 那句逐字重复 57 次的画风锚句，译一次放这儿，正文不再复述；全局画风主体（Subject 12）单列 |
| 二 主体注册表 | Subject 1–N 各写一遍完整中文定义，按人物 / 场景 / 道具 / 画风分组 |
| 三 术语对照表 | 段名（`subject_definitions` → 主体定义）、判值（`fully_preserved` → 完全保留）、景别、运镜、材质、FACS 微表情，列成中英对照 |
| 四 逐单元中文对照 | 每单元五段：引用主体 / 单元概述 / 保留项分析 / 逐镜描述 / 环境声 |
| 五 对照本自检 | 覆盖数、镜头数、台词逐条核验、未译项说明 |

**每个单元的「引用主体」段**取代重译，格式：

```
【引用主体】Subject 2 角色 B（仅用于身份与服装，参考板排版与其空白背景一律丢弃）｜Subject 7 某处庙宇外景与干涸湖底（仅用于结构与地标）｜Subject 12 全局画风
```

即：主体编号 + 中文名 + 该单元对它的**专属限定**（把英文定义里那句 `Used for ... only` 翻出来）。这样语义与逐条重译等价，体量降一个数量级。

**「逐镜描述」段**按 `第 1 镜　…` 起行，`第 N 镜（00:05.000）　…` 带时间码。开头的画风锚句不再重复，只在第一节说明「每单元开头都是它」。

### 13.3 台词一律照录，不译

`<d>[Chinese] ……</d>` 本身就是中文原文。对照本里去掉标签、保留原文，**一个字都不能动**——它是全片铁律里最硬的一条。校验时用 `re.findall(r'<d>\[Chinese\]\s*(.*?)</d>', 原包)` 抽出来逐条 `in` 对照本正文。

### 13.4 交付校验（四项，缺一不可）

1. 单元数 = 原包单元数（`^### U\d\d` 计数），无缺号。
2. **逐单元**比对镜头数：原包取 `detailed_description` 段内的 `^\[Shot N\]`（**不能用全文计数**，`retention_analysis` 里的 `[Shot 1], [Shot 2]` 会把数虚高一倍以上），对照本取 `^第 \d 镜`，逐单元一致。
3. 五段标记各 = 单元数：`【引用主体】/【单元概述】/【保留项分析】/【逐镜描述】/【环境声】`。
4. 台词 81 条逐条 verbatim；正文 ASCII 竖线数 = 0（`s.count('|') >= 2` 的行会被 md2docx 当成表格吞掉）。

### 13.5 交付形态

`.md` 源 + `.docx` 成品（走 `md-to-docx` skill）。转换前先扫一遍正文有没有 `>` 开头行（md2docx 不剥引用符，会原样落进 docx）与 `` `#` `` 这类反引号里的井号——正文里出现井号一律改写成「井号」二字，只在 md 的标题行保留 `#`。转完复检 `#`/`*` 残留 = 0。
