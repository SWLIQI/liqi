# 变更日志

本文件的版本号的写法：主版本 = 结构级变更，次版本 = 规则增删，修订号 = 修正与措辞调整。

## 4.2.1 — 2026-10-10（移除历史决策档案）

`docs/internal/冲突裁决总表.md` 已删除，**整个仓库不再含第三方体系的裁决记录**。

删之前先把 11 处指向它的引用全部摘掉，避免留下悬空指针：

- 主文件 Overview 的「21 处冲突」句改成：裁决结果已分别落进各层规则文件，不再另设决策档案。
- 主文件 Load Map 的「想知道某条规则为什么这么定」改为指向对应层（叙事 / 资产 / 空间 / 质控各带成因注记）。
- 主文件 References 的「历史决策档案」小节整节移除；武打段的「附录 A」指针移除。
- references 四处引用（空间层 C09/C10、任务模板路由 附录A、看板编译规范 C14、资产层 C12、
  质控层 C13/C16）改为各自的结论性表述或直接删除指针。

> 本文件（CHANGELOG）里保留了对该档案的两处历史记述——那是变更记录，记述的是过去的状态，
> 不是可点击的引用，不需要跟随删除。

## 4.2.0 — 2026-10-10（国际化）

**规则一行没改**，只补英文可用性。

### 新增

- `README.en.md`：完整英文版说明（问题背景 / 六层 / 三锁 / 快速开始 / 交付前必跑的五个脚本 /
  风格覆盖表 / 依赖 / 目录结构 / 边界 / 许可）。中文 README 顶部加了语言切换链接。
- `references/术语对照表_glossary.md`：**中英术语对照总表**，十节：
  三锁、六轨道、Step 编号、九段锚、预算类、镜头与表演、四层混音、资产与一致性、
  P0~P2 与规则码前缀、其他高频词。文末附三条给非中文读者的提醒。

### 改动

- 主文件 frontmatter 的 description 补**英文触发词**（video generation prompt、shot list、
  storyboard、per-shot prompt、Seedance、MiniMax H3、character consistency、style anchor、
  4 View asset board、FACS、dialogue timing、content moderation），并指向术语表与英文 README。
  ⚠️ 写法注意：YAML 纯标量里不能出现「冒号 + 空格」，所以英文段用的是 `English keywords - …`
  而不是 `English keywords: …`。
- 主文件 Overview 后加一段英文入口注记：英文读者从 `README.en.md` 与术语表进；
  并说明投 H3 面时正文必须英文、`audit_literal.py` 内置英文规则。
- Load Map 加一行「读不懂某个中文术语 → 术语表」；References 加术语表条目。

### 关于文件名

`references/` 的 44 份文件仍是中文名，**没有改**。原因：全库有 150 余处互引用用的是中文名，
改名要做全量重写，风险收益比不划算；而 Load Map 里「情况 → 文件」的对应关系不依赖文件名，
英文用户按用途查表即可定位。若将来要做 URL 安全与跨平台，再考虑整体 slug 化并同步全量引用。

## 4.1.0 — 2026-10-10（风格扩容）

新增 4 份风格锚，**已落值从 5 份提到 9 份，覆盖率从 19% 提到 30%**。
四份都按 `references/风格锚_模板.md` 的十节骨架写满，并同步注册进路由表、注册表种子、
SKILL.md 的 References 与 Load Map。

| id | 中文名 | 轨道 | 稳定性 | 锚文件 |
|---|---|---|---|---|
| stylized-pixar-3d | 风格化 3D（皮克斯式） | 三渲二轨 | 稳 | `风格锚_风格化3D皮克斯.md` |
| anime-2d | 日系动画 2D | 卡通轨 | 稳 | `风格锚_日系动画2D.md` |
| webtoon-2d | 韩漫条漫（竖屏专项） | 卡通轨 | 中 | `风格锚_韩漫条漫2D.md` |
| documentary-live-action | 纪实 / 纪录片式实拍 | 写实轨 | 中 | `风格锚_纪实实拍.md` |

选这四项的理由：皮克斯式 3D 与日系 anime 是问得最多的两个缺口；
条漫顺带解决「9:16 竖屏只有画幅语法、没有内容模板」这个一直空着的洞；
纪实实拍把写实轨拆成「影视级 CGI」与「被拍到的」两个分支——此前只有前者，
而两者的崩点方向完全不同（PBR 怕塑料脸，纪实怕过度精修）。

### 顺带修掉的三处

1. **像素由「不入」改为「条件准入」**。原判据「动态必闪」是参数层问题（固定帧数 + 网格对齐 +
   禁中间帧插值即可缓解），不是风格层缺陷，不该把整个风格拒之门外。新增 id `pixel-2d`。
2. **`风格注册表_style-registry.md` 里 `celshade-guoman-2d` 的状态冲突**：文档写「待建占位、不得引用」，
   种子文件与路由表都写「已落值」。已统一为已落值，并注明以种子的 `status` 字段为准。
3. **两处 marker_words 是规则词不是身份词，导致跨风格误报串轨**（都是既存缺陷，补新风格时暴露的）：
   - `celshade-guoman-2d` 挂了「赛璐璐」——那是技法名，导致 anime 与 webtoon 自己的压句
     被判成串轨报错。改为「国漫 2D 赛璐璐」。
   - `photoreal-pbr` 挂了「不完美」「毛孔」——那是防塑料脸的规则词，导致哥特木偶的压句
     被判成串轨报错。改为「影视级 PBR」「写实照片感」。

### 验证

9 个风格逐个构造提示词包跑 `check_style.mjs --surface cn`，**全部 0 ERROR**（此前哥特木偶
因上面的第 3 条会误报）。互斥关系已做双向补齐（新增 17 条反向 exclude）。

## 4.0.0 — 2026-10-10（开源化改造 · 去私有化 + 双投放面统一）

面向开源的第一轮清理。**规则本身没动，动的是版权、范例、一致性与脚本兜底。**

### 新增：投放面参数总表（唯一权威）

主文件新增「投放面参数总表」，三列（Seedance 2.0 / Seedance 2.5 / MiniMax H3）交叉 16 行参数。
历史上轨道数、台词写法、滑窗阈值、帧率、素材上限五组数值曾在七处文件里各说各话，
现在统一收敛到这一张表，其余位置改为指向它。

顺带消解的冲突：

- 风格轨道数曾有 2 / 6 / 4 / 2 四种自称，现在明确「六轨道是通用体系」，
  适配文件里写的是「已验证轨道」，未验证不等于不支持。
- 台词写法：Seedance 面三写、H3 面一写，主文件 Step 3 与适配文件口径已对齐。
- 「七段链条」原文列举六个环节，改为「六段链条」。
- 规则码计数由 32 修正为 33（脚本实际值）。

### 脚本：投放面自识别与门禁补漏

- `check_prompt.mjs`：检测到 H3 六段式包时**直接早退**（退出码 2）并指路 `check_prompt_h3.mjs`，
  不再输出一堆假的 `E-SECTION-MISSING`。可用 `--target seedance-off` 强行跳过该判定。
- `check_prompt.mjs`：新增 `--official`，补上**官方 API 中文 ≤500 字 / 英文 ≤1000 词**门禁
  （规则码 `W-OFFICIAL-500`、`W-OFFICIAL-1000W`）。这条规则以往只写在文档里，没有任何机械兜底。
- `check_prompt.mjs`：新增 `--lang`（语言面）与 `--target`（投放面）参数；
  原 `--surface` 保留为兼容别名——它历史上指语言面，与锁③ 的「投放面」撞名。
- `check_prompt_h3.mjs`：拿到 Seedance 包时明确提示改跑 `check_prompt.mjs`，不再只报一句空结果。
- 删除 `dedupe25d.py`：水墨词表写死且无风格参数，套到其他轨道会反向误伤（套赛璐璐会删掉
  shadow 与 highlight，那是它的风格本体）。已由 `dedupe_style.py` 取代。
- `build_board_lite.py`：补 shebang 与 argparse 描述 / 参数 help。
- `generate_emotion_curve.py`：matplotlib 改为带守卫导入，缺包时提示 `pip install -r requirements.txt`
  而不是抛栈。

### 去私有化

- 主文件 7 处默认范例（轴线 / 站位 / 位移 / 保真预算 / 光色预算 / 必锁 / 可见性）
  原本取自一份私人作品，现全部改为中性占位（旅客甲 / 查验员乙 / 值守员 / 随从 / 关键道具 / 犬只）。
- references 里 16 份文件涉及的私人角色名、作品名、私有 slug（如 `cup-mige.md`、
  `characters/jiang-lian-a.md`）改为中性名称。
- 质控层词表里的「人皮」是志怪恐怖题材的通用词，予以保留；被误替换的两处表项已还原。
- 根目录清理：删除 0 字节的 `_patch3_stage.txt`，`--help.png` 更名归档为
  `docs/sample-emotion-curve.png`（原文件名以 `--` 开头，命令行与 URL 都不安全）。

### 第三方资料处理

- `冲突裁决总表.md` 从 references 移入 `docs/internal/`，定性为历史决策档案。
  日常执行不再依赖它，执行规范以 SKILL.md 与 References 章节为准。
  涉及第三方的 21 处裁决依据与未并入的专项库说明一并收纳在此，不随核心流程分发。
- 主文件 Overview 与 References 分节名去掉第三方署名，改为按能力层命名。
- `h3-prompt-writing`、外部武打专项库由硬依赖改为「可选补充，不装也能用」。

### 元文件补齐

- 新增 LICENSE（MIT）、README.md、requirements.txt、.gitignore、CHANGELOG.md。
- 删除 `scripts/__pycache__` 构建残留。
- 主文件 frontmatter 补 `license` 字段。

### 顺带修正

- 主文件 description 原本只提 `check_prompt.mjs`，漏了 H3 面的 `check_prompt_h3.mjs`，已补全；
  并补上 Seedance 2.0 / 2.5 / MiniMax H3 三种投放目标与「4 View」等可检索关键词。
- 冲突裁决总表相关的引用路径同步更新为 `docs/internal/`。

## 3.0.0 — 2026-09-15（融合稿）

- 合并终端提示词锻造体系与上游短剧工程体系，逐条裁决 21 处冲突。
- 角色资产版式统一为 4 View 资产板。
- 建立 Step -1 ~ Step 6 九步编号，旧编号（Step 3B / 4B / 4D 等）全部作废。
- 引入风格路由表、风格注册表、风格锚十节骨架与 check_style.mjs 门禁。

> 本文件的版本号与 SKILL.md 的 frontmatter 保持一致。
