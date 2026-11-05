# 超级liqi提示词

**[English README](README.en.md)** · 中文版

把故事、剧本或已有分镜，锻造成**可直接投喂 AI 视频模型的终稿级提示词包**，  
并在上游补齐资产、剧本、表演三层。

A prompt-forging skill that turns a story / screenplay / rough storyboard into  
production-ready prompts for AI video models, with asset, screenplay and acting  
layers built in upstream.

---

## 它解决什么问题

大多数人写 AI 视频提示词的失败方式是一样的：形容词堆得多、运镜写得好，  
但生成出来角色不像、镜头之间接不上、台词念不完、第三天重抽又变了个人。

本技能的做法是把这些拆成可机械校验的层：

| 层             | 管什么                         |
| ------------- | --------------------------- |
| 剧本层（Step -1）  | 五阶门控、台词七维诊断、语速实测校准          |
| 资产层（Step 2.5） | 4 View 角色资产板、像素账、光照锚点、注册表复用 |
| 表演层（Step 3）   | FACS 四区拆解、真假笑、强度三档          |
| 空间层（Step 3）   | 轴线三态、站位四要素、取景半径铁律           |
| 视听层（Step 3）   | 三任务法则、光色预算、反形容词转译           |
| 质控层（Step 4）   | P0~P2 三级门禁、三步复验、过审双向闭环      |

### 两条贯穿全流程的信念

**其一：逐单元投喂，所以每个单元必须自足。** 每个镜块（或资产条目）都是单独复制进生成工具的，
模型看不到卷首、也看不到上一镜。所以画风压句必须内联进每个单元的正文字——写「承接风格锚 `<id>`」
等于没写，因为 `<id>` 是给人看的注册表索引，模型不认识这个字符串。这类问题由
`check_style.mjs` 的 S7「逐单元落点」守着。

同一个道理还有一条：**身份也要内联**。模型在一段几百字的正文里要**先认出「谁是谁」再谈怎么拍**，
所以每镜在**镜号标题（与站位三行）之后、`整体风格：` 之前**有一行 **`出场人物：甲——<外形地标 + 服装主色形制 + 一件随身物>；乙——…`**，
本镜在场角色一个不漏。**身份归这行，画风归下一行——一行一个职责**，别让模型做阅读理解。
缺则 `check_prompt.mjs` 报 `E-IDENTITY-NOT-INLINE`（见 SKILL.md Step 3 第 5 小节）。

**其二：门最危险的状态不是报错，是「什么都没查却说通过」。** 空文件、格式不对、抽取为 0 条——
这些情况下的绿灯比红灯有害得多。五道校验门都建了假绿防线，输入层抽不到东西直接报错退出。

---

## 前置锁（第零道锁 + 三锁 · 任何任务第一步）

展开任务前必须先锁定四项，缺一项就停下问用户，禁止默认值：

0. **〇 赛道分流（第零道锁）**：① 国内剧 / ② 海外剧 / ③ 解说叙事类 / ④ 其他。
   它决定「**这一类内容该怎么写**」——语速口径、VO 容量、资产口径、字幕要求的上位口径。
   **与投放面是两条正交轴**，完整规则见 `references/赛道分流.md`（① 最常见，但**不是默认值**，仍须必问）。
1. **模型版本**：Seedance 2.0 / Seedance 2.5 / MiniMax H3（含 H3 Max）
2. **画幅**：**六值** 16:9 / 9:16 / 21:9 / 4:3 / 3:4 / 1:1（4:3、3:4、1:1 仅明确指定时用；**H3 面维持四值** 16:9 / 9:16 / 21:9 / 1:1）。白名单唯一事实源：`references/model-limits.json` 的 `ratio_whitelist`
3. **投放面 + 风格轨道 + 交付形态**：见 SKILL.md 锁③。投放面＝**段头骨架族**，共 5 个
   （国内面 / 国际面 / Seedance 2.5 面 / Seedance 2.0 面 / MiniMax H3 面），由「平台 + 模型版本」共同决定，
   与锁① 是**决定关系**——选定模型版本后可用面基本就定了。

不同投放面的段头骨架、时长红线、台词写法、Must not 处置都不一样，  
详细对照表见 `references/投放面参数总表.md`（**v6.0.0 起单表成册迁自 SKILL.md；该表按模型版本分列，不是按投放面**）。

---

## 快速开始

1. 把 `liqi-video-forge` 整个目录放进你的 skills 目录（**目录名必须与 frontmatter 的 `name` 一致**，v5.47.0 起由中文名改 kebab-case；中文品牌仍是正文标题「超级 liqi提示词」）。
2. 复制注册表种子：`references/style-registry.seed.json` → 项目级 `style-registry.json`。
3. 给一段故事或剧本，说清前置锁（第零道锁 + 三锁）。
4. 按 Step -1 → 6 走；每一步该加载哪份 reference，查 `SKILL.md` 的 Load Map。
   **一份一份加载，不要全读。**

### 交付前必跑

```bash
# ① 主门：逐镜格式与硬规则（Seedance 面；码数以 `check_skill.mjs` 第二项两向对照为准，不手维护数）
node scripts/check_prompt.mjs <包.md> --surface cn
node scripts/check_prompt.mjs <包.md> --surface cn                  # 默认含官方 500 字质量提醒
node scripts/check_prompt.mjs <包.md> --surface cn --no-official    # 只查内部硬上限，关闭官方建议
node scripts/check_prompt.mjs <包.md> --beats <节拍清单.txt>         # 节拍认领对账（E-BEAT-* 7 码）
node scripts/check_prompt.mjs <包.md> --beats auto                   # 就近取包旁的 beats.txt（找不到退 2）
node scripts/check_prompt.mjs <包.md> --beats <节拍清单.txt> --len   # 超字时看节小计与最长行

# ② 风格一致性（P0；视频包与资产包都要跑）
node scripts/check_style.mjs <包.md>

# ③ MiniMax H3 面（与 ① 不可混跑，脚本会自识别并早退提示）
node scripts/check_prompt_h3.mjs <包.md>

# ④ 画面表述扫描（多镜 / 整合镜必跑）
python scripts/audit_literal.py <包.md>

# ⑤ 过审预检（投国内平台时）
python scripts/audit_risk.py <包.md>

# ⑥ 有剧本 / 资产库时（L2 内容一致性：A~N 九类）
python scripts/audit_project.py <包.md> --script <剧本_标准.txt> --assets <资产库目录>
python scripts/audit_all.py <包.md>                    # 一条命令串跑六门 + 《门禁总账》，「未查」单列
python scripts/audit_all.py <包.md> --config auto      # 输入路径写在包同目录 liqi.json 里（推荐）
python scripts/audit_project.py <包.md> --config auto --json   # 同配置 + 机器可读输出（stdout 只有 JSON）

# ⑦ 交付前契约核销（L4 阶段产物完整性：CT1~CT8 四态，N/A 不计入通过项）
python scripts/audit_contract.py <包.md>
python scripts/audit_contract.py --init <包.md>        # 开工时先生成核销表

# 脚本自身回归（改了 scripts/ 之后必跑）
bash scripts/run_all_checks.sh           # 十八套自测一次跑完（第 0 步先跑环境医生）；--full 另跑三个官方样例比基线
node scripts/selftest_check_prompt.mjs   # 145 组击穿用例，改 check_prompt.mjs 后必跑
node scripts/selftest_check_prompt_h3.mjs # 10 组，H3 base 三字段 / Ref2VA 六段式分流
node scripts/selftest_check_style.mjs    # 10 组击穿用例（含负面词自洽），改 check_style.mjs 后必跑
node scripts/selftest_gates_stats.mjs    # 18 组，未查分类 / 停滞·收敛·恶化判读 / --fail-on-stall / schema 版本 / -r 递归 / origin 来源分组（改 gates_stats 后必跑）
python scripts/selftest_boundary.py      # 22 组，判据边界 + JS↔Python 跨机同判 + F7b 编号族别（C33）
python scripts/audit_contract.py --self-test   # 8 组，改 audit_contract.py 后必跑
python scripts/selftest_audit_risk.py    # 17 组，正文边界 + 风险分档位 + 假绿防线
python scripts/selftest_audit_literal.py # 32 组，13 类正例 + 正文排除七分支 + 英文大小写/词形
python scripts/selftest_config.py        # 13 组，liqi.json：未知键/类型/相对路径/CLI 优先/--json 纯度
python scripts/selftest_audit_all.py     # 11 组，总账末段 + --config 端到端：未查归零/错误不降级
python scripts/selftest_scan_conflicts.py  # 13 组，扫描器自己：K1/K5/K7/K8/K9（含豁免与去重）
python scripts/selftest_audit_continuity_lock.py  # 13 组，连续性锁：锁面逐字（含标点）/负面区不算/空跑防护（C28，改 audit_continuity_lock.py 后必跑）

# 项目期内随时：门失败统计（含未查分类 + 同文件历史趋势）
node scripts/gates_stats.mjs <目录> [--fail-on-stall]   # 后者给 CI：连续 3 次没进步就退 1
```

**有 ERROR 不许交付。**

`check_prompt.mjs` / `check_prompt_h3.mjs` / `check_style.mjs` / `audit_literal.py` / `audit_risk.py`
六个脚本默认把每次运行写进**被校验文件同目录**的 `.gates.jsonl`（v5.37.1 起含 `audit_project.py` / `audit_contract.py`）（`--no-log` 关闭；写入失败静默跳过，
绝不影响退出码）。`gates_stats.mjs` 聚合后回答三件事：哪道门最常响（该改的是措辞）、哪道门从没响过
（可能是死门）、失败详情长什么样——用数据反推规则迭代，而不是靠感觉。

**上游是 shuohao 管线时**：`python scripts/script_json_to_liqi.py <script.json> --cast <cast.json>`
把 novel-script 的产出转成节拍清单 + 剧本平文，台词逐字搬运。黄金样例见 `examples/黄金样例_E01S02/`。

---

## 依赖

```bash
pip install -r requirements.txt   # matplotlib + pillow，仅两个脚本需要
```

- Python >= 3.8（未用到 3.9+ 语法）
- Node >= 16（脚本统一用 `node:` 前缀写法）
- Windows：Python 探测顺序为 `python3` → `python` → `py`（`py` 为 Windows 官方启动器，`winget install Python.Python.3` 或 Microsoft Store 安装后即有）；缺 Python 时 `run_all_checks.sh` 整体拒绝运行（exit 2）而不静默跳过——六个 Python 审计门依赖它
- 零 npm 依赖
- 不依赖 python-docx / pandas，docx 解析走 zipfile + ElementTree

可选的外部技能（**不装也能用**）：MiniMax 官方 `h3-prompt-writing`，  
装了则 H3 字段以官方为准；`lengyi-shotlist` / `seedance-video-prompt` 用于专项转交。

---

## 目录结构

```
SKILL.md                 主 pipeline（Step -1 ~ Step 6）——入口层（v6.0.0 起参数总表单表成册迁出）
references/              115 份文件（顶层 113 md + style-registry.seed.json + model-limits.json）
                         ├ 50 份已落值风格锚 + 1 份风格锚模板
                         ├ 工作流_写镜细则.md（v5.48.0：Step 1/2/2.5/3 完整规程）＋ 工作流_交付三步.md（v5.46.0：Step 4/5/6 同）——主文档只留速查层
                         ├ 六层规则文件（资产/空间/视听/表演/质控/叙事）
                         ├ 三面适配（MiniMaxH3 / Seedance2.5 / Seedream5）
                         ├ external/ 16 份第三方参考数据（MIT / MIT-0 / Apache-2.0 / MIT+署名）
                         └ 术语对照表_glossary.md（中英对照，英文用户从这里进）
scripts/                 51 个机械校验与工具脚本（14 个 Node + 36 个 Python + 1 个 shell 编排）
examples/                四套样例：黄金样例_E01S02（两镜格式基准）/ 黄金样例_A2_夜巡 / 实战_梦中人_场1（端到端主力）/ 实战_圆桌2x0_EP01（**2.0 面六段 15s 基准**，v6.9.1 收编——2.0 面此前零样例是模板漂移温床）
docs/                    sample-emotion-curve.png（情绪曲线脚本的输出样例）
LICENSE / THIRD-PARTY-NOTICES.md / README.md / README.en.md / CHANGELOG.md / requirements.txt / .gitignore
```

仓库只收 Markdown 源。需要给非技术同事看的 docx / PDF 时，用任意 md 转 docx 工具现场生成即可。

---

## 边界

- 覆盖：叙事类短片（动画、剧情、志怪写实、宣传警示、PREVIS 预演）
- 不覆盖：电商带货、TVC 品牌落版、口播种草、舞蹈与 FPV 专项、玄幻法术体系
- 这些内容会转交给更合适的专项技能，转交表见 `references/任务模板路由.md` 第四节

---

## 贡献

新增风格锚请按 `references/风格锚_模板.md` 的十节骨架落值，并**同步三处**：

1. L0 数值事实源 `references/style-registry.seed.json`
2. L2 路由 `references/风格路由表.md`（含 `excludes` **双向**登记，单向会让串轨检测漏一半）
3. 锚文件本体 `references/风格锚_<slug>.md`

三方一致性由 `selftest_check_prompt.mjs` 的注册表一致性用例守护（集合相等 / 锚文件存在 /
中英压句齐全 / excludes 双向 / 命名统一 `风格锚_` 前缀）。**跑一遍自测再提 PR。**

现有 **6 条风格轨道、57 个 style_id**，其中 **50 个已落值（88%）**——**C32 扩容计划 26→50 已于 v6.11.0 完成**（N19 销账）：

| 中文名 | id | 轨道 | 备注 |
|---|---|---|---|
| 国漫 2D 赛璐璐 | `celshade-guoman-2d` | 卡通轨 | 稳，长片与多题材通吃 |
| 日系动画 2D | `anime-2d` | 卡通轨 | 稳；**禁环绕**（2D 画绕必崩） |
| 韩漫条漫 | `webtoon-2d` | 卡通轨 | 中；竖屏 9:16 专项 |
| 暗黑哥特 2D | `gothic-2d` | 卡通轨 | 中；平面本体（墨线平涂剪影），与哥特定格互斥 |
| 水墨淡彩东方手绘 | `ink-wash-2d` | 手绘轨 | 险；易出 2.5D |
| 哥特定格木偶 | `gothic-puppet` | 定格木偶轨 | 中；含反向删词表 |
| 三渲二 NPR | `npr-celshaded-3d` | 三渲二轨 | 稳；长片一致性最好，必带资产图 |
| 风格化 3D（皮克斯式） | `stylized-pixar-3d` | 三渲二轨 | 稳；软过渡无描边，与三渲二互斥在着色方式 |
| 影视级 PBR | `photoreal-pbr` | 写实轨 | 险；必带不完美词防塑料脸 |
| 纪实实拍 | `documentary-live-action` | 写实轨 | 中；与 PBR 的区别是「摄影师在场的痕迹」 |
| 国风电影级 3D | `guofeng-cine-3d` | 写实轨 | 中；唐代院线动画向 |
| 市井写实·中式都市志怪 | `urban-folk-filmstill` | 写实轨 | 中；现代都市志怪的志怪首选，禁血浆走光影 |
| 剪纸 | `papercut-2d` | 平面工艺轨 | 稳；负形镂空，与其余平面工艺互斥 |
| 皮影 | `shadow-puppet-2d` | 平面工艺轨 | 稳；背光透光 |
| 国潮新中式 | `guochao-2d` | 平面工艺轨 | 稳；靛青金线 |
| 民俗年画 | `nianhua-2d` | 平面工艺轨 | 稳；木版套色，无光无影 |
| 厚涂二次元 | `thickpaint-2d` | 卡通轨 | 中（v4.9.1）；软过渡无硬边，与赛璐璐明暗逻辑相反 |
| 黏土定格（通用暖调） | `claymation-3d` | 定格木偶轨 | 稳（v4.9.1）；与哥特的边界在题材与光色不在材质；羊毛毡并入作子档 |
| 美漫波普 | `comic-popart-2d` | 卡通轨 | 稳（v4.9.1）；网点与撞色是图形不是文字，但对话框与拟声词仍禁 |
| 吉卜力系 | `ghibli-2d` | 卡通轨 | 稳（v4.9.1）；手绘水彩背景 + 只用自然光，与 `ink-wash-2d` 互斥 |
| 等距低多边形 3D | `lowpoly-iso-3d` | 三渲二轨 | 稳（v5.42.0 批 3）；正交等距视角 |
| Q 版超变形 2D | `chibi-qban-2d` | 卡通轨 | 稳（v5.42.0 批 3）；2-3 头身是定义，负面词不含 Q 版 |
| 敦煌工笔重彩 2D | `dunhuang-gongbi-2d` | 手绘轨 | 中（v5.42.0 批 3）；矿色叠染 |
| 新海诚系 2D | `shinkai-2d` | 卡通轨 | 稳（v5.42.0 备选批）；光晕与天空渐变 |
| 暗黑二次元 2D | `dark-anime-2d` | 卡通轨 | 中（v5.42.0 批 3）；高对比暗调 |
| 绘本水粉 2D | `gouache-2d` | 卡通轨 | 稳（v5.42.0 备选批）；颗粒干笔触 |
| 古装仙侠·偶剧实拍 | `xianxia-idol-live` | 写实轨 | 中（v6.7.0 批 1 · C32）；剧级精修保留皮肤纹理，仙气实体件三件为限 |
| 都市甜宠·奶油粉调 | `sweet-romance-live` | 写实轨 | 稳（v6.7.0 批 1 · C32）；高调柔光光比压低，与悬疑冷青互斥 |
| 复古港风·九十年代霓虹 | `hk-retro-filmstill` | 写实轨 | 中（v6.7.0 批 1 · C32）；胶片颗粒高对比硬光，字牌一律失焦 |
| 都市悬疑·冷青暗调 | `urban-suspense-live` | 写实轨 | 稳（v6.7.0 批 1 · C32）；低照度画面内光源驱动，档案米黄是唯一暖色 |
| 热血少年漫 2D | `shonen-hotblood-2d` | 卡通轨 | 中（v6.7.0 批 1 · C32）；高饱和硬边＋速度线爆发帧，与 anime 通用档分强度档 |
| 民国月份牌画报 | `republic-calendar-poster` | 手绘轨 | 稳（v6.7.0 批 1 · C32）；擦笔水彩海报程式，与木版年画工艺层互斥 |
| 宋式美学·院体绢本 | `song-aesthetic-2d` | 手绘轨 | 中（v6.8.0 批 2 · C32）；薄染两三成留白为主，与水墨写意笔性相反 |
| 青花瓷韵·釉下钴蓝 | `qinghua-porcelain-2d` | 平面工艺轨 | 稳（v6.8.0 批 2 · C32）；白蓝两值分水五档，全片禁第二色相 |
| 金碧山水·唐式青绿 | `jinbi-landscape-2d` | 手绘轨 | 中（v6.8.0 批 2 · C32）；矿色浓而不刺，点景人物小于山 |
| 汉画像石·拓片剪影 | `han-relief-rubbing` | 平面工艺轨 | 稳（v6.8.0 批 2 · C32）；拓片两值带状横卷，朱砂全片限一处 |
| 青铜铭纹·吉金纹样 | `bronze-motif-2d` | 平面工艺轨 | 稳（v6.9.0 批 3 · C32）；深铜底三色限额，铭文是纹样禁可读化 |
| 戏曲舞台·浓彩程式 | `opera-stage-live` | 写实轨 | 中（v6.9.0 批 3 · C32）；检场空台一桌二椅，舞台顶光正面照 |
| 苗银蜡染·靛蓝冰纹 | `miao-batik-indigo` | 平面工艺轨 | 稳（v6.9.0 批 3 · C32）；蓝底白纹与青花反转互斥，银是唯一金属 |
| 唐卡重彩·矿金满底 | `thangka-mineral-gold` | 手绘轨 | 中（v6.9.0 批 3 · C32）；矿彩满底不留白金线细勾，宗教符号不入戏 |
| 美式漫画·硬线印刷 | `us-comic-ink-2d` | 卡通轨 | 中（v6.10.0 批 4 · C32）；钢笔排线四色印刷，与波普网点分档 |
| 赛博朋克动漫·霓虹义体 | `cyberpunk-anime-2d` | 卡通轨 | 中（v6.10.0 批 4 · C32）；三路霓虹环境光，招牌一律失焦 |
| 合成器波·八十年代图形 | `synthwave-retro-2d` | 卡通轨 | 稳（v6.10.0 批 4 · C32）；自发光几何剪影档，与叙事动画分界 |
| 黑色电影插画·黑白硬光 | `noir-ink-2d` | 卡通轨 | 稳（v6.10.0 批 4 · C32）；纯黑白两值硬边光形，烟头是唯一彩点 |
| 古典油画·明暗法笔触 | `classical-oil-2d` | 手绘轨 | 中（v6.10.0 批 4 · C32）；透明罩染厚涂亮部，单一暖光源 |

（v6.11.0 批 5 · C32 收官 5 锚——极简几何扁平 / 透明水彩 / 西幻魔幻史诗 / 像素艺术·条件准入转正 / 粉笔粉彩——已全量入册；像素艺术稳定性「险（动态）」，转正条款见其锚附录。）

上表是已落值的 50 个；其余 7 个待建 id 的全表见
`references/风格路由表.md` 第二节，落值指南见同文件第五节。

---

## 第三方内容

`references/external/` 收录了 16 份开源项目的文件（**MIT / MIT-0 / Apache-2.0 / MIT+署名**，原样未改 + 来源·许可头注），
用于横向调研与互证。另有调研对象因上游**未声明许可**，本仓库只记来源与自己的结论、不复制其内容。

完整清单、版权行与许可文本见 **[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)**。

---

## 许可

MIT，见 [LICENSE](LICENSE)。第三方内容的许可与版权见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
