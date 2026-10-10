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



---

## 三锁前置（任何任务第一步）

展开任务前必须先锁定三项，缺一项就停下问用户，禁止默认值：

1. **模型版本**：Seedance 2.0 / Seedance 2.5 / MiniMax H3（含 H3 Max）
2. **画幅**：16:9 / 9:16 / 21:9（1:1 仅明确指定时用）
3. **投放面 + 风格轨道 + 交付形态**：见 SKILL.md 锁③

不同投放面的段头骨架、时长红线、台词写法、Must not 处置都不一样，  
详细对照表见 `SKILL.md` 的「投放面参数总表（唯一权威）」。

---

## 快速开始

1. 把 `超级liqi提示词` 整个目录放进你的 skills 目录。
2. 复制注册表种子：`references/style-registry.seed.json` → 项目级 `style-registry.json`。
3. 给一段故事或剧本，说清三锁。
4. 按 Step -1 → 6 走；每一步该加载哪份 reference，查 `SKILL.md` 的 Load Map。

### 交付前必跑

```bash
# Seedance 面
node scripts/check_prompt.mjs <文件.md> --surface cn
node scripts/check_prompt.mjs <文件.md> --surface cn --official   # 额外查官方 API 的 500 字门禁

# MiniMax H3 面（与上者不可混跑，脚本会自识别并早退提示）
node scripts/check_prompt_h3.mjs <文件.md>

# 画面表述扫描（多镜 / 整合镜必跑）
python scripts/audit_literal.py <提示词包.md>

# 有剧本 / 资产库时
python scripts/audit_project.py <包.md> --script <剧本.txt> --assets <资产库目录>

# 投国内平台时
python scripts/audit_risk.py <文件.md>
```

**有 ERROR 不许交付。**&#x4E94;个脚本都不要求 PATH 里有特殊工具，除了两个 Python 包。

---

## 依赖

```bash
pip install -r requirements.txt   # matplotlib + pillow，仅两个脚本需要
```

- Python >= 3.8
- Node >= 16（脚本用 `node:fs` 前缀写法）
- 零 npm 依赖
- 不依赖 python-docx / pandas

可选的外部技能（**不装也能用**）：MiniMax 官方 `h3-prompt-writing`，  
装了则 H3 字段以官方为准；`lengyi-shotlist` / `seedance-video-prompt` 用于专项转交。

---

## 目录结构

```
SKILL.md                 主 pipeline（Step -1 ~ Step 6），含「投放面参数总表」唯一权威
references/              45 份规则与示例（44 md + 1 json），按需加载 1-2 份，不要全读
                         （含 `术语对照表_glossary.md` 中英对照表，英文用户从这里进）
scripts/                 12 个机械校验与工具脚本
docs/sample-emotion-curve.png   generate_emotion_curve.py 的输出样例
LICENSE / README.md / CHANGELOG.md / requirements.txt / .gitignore
```

---

## 边界

- 覆盖：叙事类短片（动画、剧情、志怪写实、宣传警示、PREVIS 预演）
- 不覆盖：电商带货、TVC 品牌落版、口播种草、舞蹈与 FPV 专项、专项武打编排、玄幻法术体系
- 这些内容会转交给更合适的专项技能，转交表见 `references/任务模板路由.md` 第四节

---

## 贡献

新增风格锚请按 `references/风格锚_模板.md` 的十节骨架落值，  
并回写 `style-registry.json`。已有 6 条风格轨道、30 个 style_id，  
其中 **9 个已落值**（覆盖率 30%），**其余欢迎补**。

已落值的 9 个：

| id | 中文名 | 轨道 | 备注 |
|---|---|---|---|
| celshade-guoman-2d | 国漫 2D 赛璐璐 | 卡通轨 | 稳，长片与多题材通吃 |
| anime-2d | 日系动画 2D | 卡通轨 | 稳；**禁环绕**（2D 画绕必崩） |
| webtoon-2d | 韩漫条漫 | 卡通轨 | 中；竖屏 9:16 专项 |
| ink-wash-2d | 水墨淡彩东方手绘 | 手绘轨 | 险；易出 2.5D |
| gothic-puppet | 哥特定格木偶 | 定格木偶轨 | 中；含反向删词表 |
| npr-celshaded-3d | 三渲二 NPR | 三渲二轨 | 稳；长片一致性最好，必带资产图 |
| stylized-pixar-3d | 风格化 3D（皮克斯式） | 三渲二轨 | 稳；软过渡无描边，与三渲二互斥在着色方式 |
| photoreal-pbr | 影视级 PBR | 写实轨 | 险；必带不完美词防塑料脸 |
| documentary-live-action | 纪实实拍 | 写实轨 | 中；与 PBR 的区别是「摄影师在场的痕迹」 |

---

## 许可

MIT，见 LICENSE。

