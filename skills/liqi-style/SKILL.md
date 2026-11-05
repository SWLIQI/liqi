---
name: liqi-style
description: 风格专精包。从 50 种已落值的风格里按题材/维度/稳定性挑出合适的，并输出可直接拼进提示词的参数块（色值、运镜池、崩点与反制、九段锚、多面压句）。适合"要选风格、要风格稳定、要在多个模型间保持同一种视觉"的项目；只写一句通用提示词、不在乎风格一致性的活不要用。
version: "0.2.1"
category: "图像与视频生成"
platforms: ["WorkBuddy", "Claude Code", "Codex", "任意可执行 Node 的 Agent"]
license: MIT
---

# liqi-style · 风格专精包

从 `liqi-video-forge v6.19.8` 的 50 份风格锚里抽出来的选择器与参数库。
不依赖三锁、不依赖主包，单独也能用。

## 运行前提

- Node.js ≥ 16（ESM，脚本为 `.mjs`）；零第三方依赖
- Windows 控制台中文乱码时先执行 `chcp 65001`
- 解压用资源管理器 / PowerShell `Expand-Archive` / 7-Zip；Git Bash 自带 `unzip` 可能按本地代码页解码中文锚名

## 什么时候用

- 同一个项目要跨多个镜头/多集，视觉必须统一，但你说不清该选哪种风格
- 已经选了风格，但每次出图颜色、笔触、质感都在飘
- 要在不同模型（Seedance / H3 / Seedream / 通用图像模型）之间保持同一种观感

## 什么时候不要用

- 只想写一句通用提示词、不在意一致性：直接写更快
- 风格要自己现编：这个包是"选已有 + 给参数"，不是风格生成器
- 需要分镜/角色/叙事：那是 `liqi-lens`、`liqi-cast` 等其它包的事

## 六个轨道，50 种风格

| 轨道 | 数量 | 特点 |
|---|---|---|
| 卡通轨 | 18 | 赛璐璐、条漫、动画系，稳定性最好 |
| 写实轨 | 9 | 真人/实拍感，**人脸翻车率最高** |
| 手绘轨 | 10 | 水墨、水彩、工笔、插画 |
| 平面工艺轨 | 8 | 剪纸、年画、皮影、青花、壁画 |
| 三渲二轨 | 3 | 3D 形态 + 2D 渲染 |
| 定格木偶轨 | 2 | 黏土、哥特偶 |

每种风格都标了：**维度**（2D / 3D / 实拍）、**头身比**、**稳定性**（稳 / 中 / 险；`险（动态）`是险档的子档）。

## 工作流

1. **选**：`pick_style.mjs` 给关键词，出 2–3 个候选（带轨道、维度、稳定性、命中原因）。
2. **取**：`get_style.mjs` 取出该风格的色值表、运镜池、崩点清单、九段锚与**多面压句**（默认全文，逐字复用）。
3. **拼**：把颜色与运镜拼进你的提示词；崩点清单逐条对照，别踩已知的坑。
4. **验**：`check_style.mjs` 校验五节（九段/色值/运镜/崩点/多面压句）、索引字段、stability 值与色值 HEX。

## 快速开始

```bash
# 按题材挑（支持同义词：古风、二次元、写实、复古、国潮、恐怖、甜）
node scripts/pick_style.mjs "古风 雨夜"

# 只按维度/稳定性过滤（可以不给关键词）
node scripts/pick_style.mjs --dimension 实拍 --stability 稳 --limit 5
node scripts/pick_style.mjs --stability 险 --limit 10

# 取参数块：默认含多面压句全文
node scripts/get_style.mjs 写实PBR
node scripts/get_style.mjs photoreal-pbr --brief   # 只要短参数
node scripts/get_style.mjs photoreal-pbr --full    # 整份锚原文

# 校验一份锚；全量巡检跑自测
node scripts/check_style.mjs references/anchors/写实PBR.md
node scripts/selftest.mjs
```

## CLI 参数表

| 脚本 | 参数 | 说明 |
|---|---|---|
| `pick_style.mjs` | `"关键词"` | 题材词；支持古风 / 二次元 / 写实 / 复古 / 3D / 国潮 / 恐怖 / 甜 |
| | `--dimension 2D\|3D\|实拍` | 维度过滤（大小写不敏感） |
| | `--stability 稳\|中\|险` | `险` 包含 `险（动态）`；也可写 `动态` |
| | `--track <轨道名>` | 卡通轨 / 写实轨 / 手绘轨 / 平面工艺轨 / 三渲二轨 / 定格木偶轨 |
| | `--limit N` | 正整数，默认 3 |
| `get_style.mjs` | `<slug 或 中文名>` | 二选一；也支持唯一前缀 |
| | `--brief` / `--full` | 短参数 / 整份锚原文；二者互斥 |
| `check_style.mjs` | `<锚文件.md>` | 相对包根或绝对路径 |
| `build_index.mjs` | `--dry-run` | 只校验、不写 `style-index.json` |
| `check_sync.mjs` | `[主包目录]` | 缺省读 `LIQI_CORE` 或 `../liqi-video-forge` |
| `selftest.mjs` | 无 | 34 条自测，含 50 份锚全量巡检 |

## 输出长什么样

`pick_style`：

```
1. 敦煌工笔重彩2D  (dunhuang-gongbi-2d)
   轨道 手绘轨 · 2D · 头身比 6-6.5 · 稳定性 中
   命中：敦煌、工笔
   取参数：node scripts/get_style.mjs dunhuang-gongbi-2d
```

`get_style` 默认输出：色值表 / 运镜池 / 崩点清单 / 九段锚（前 24 行）/ 多面压句（全文）。
完整示例见 `examples/get-style-photoreal.txt`；校验通过/失败示例见 `examples/check-pass.txt`、`examples/check-fail.txt`。

## 稳定性这件事要说清

`style-index.json` 的 `stability` 字段来自主包注册表的**既有标注**，不是本包的实测数据：

- 值域：`稳` / `中` / `险` / `险（动态）`
- `险（动态）`只有 1 条（`pixel-2d` 像素复古游戏），表示风险随镜头动态变化
- `--stability 险` 会把 `险（动态）`一起带上，共 3 条：`写实PBR`、`水墨淡彩2D`、`像素复古游戏`
- 写实轨（`photoreal-pbr`）是全线翻车率最高的：恐怖谷、塑料脸、手部崩形、换脸

选险档就要接受：必须带资产图、必须写"不完美词"、必须做逐镜复核。

## IP 合规

- **文档层可以写工作室名作溯源；投喂词 / 交付提示词禁止点名具体作品、导演、工作室。**
- 上游注册表自带 8 条 `ip_note`；`ghibli-2d`（吉卜力系 2D）与 `stylized-pixar-3d`（风格化 3D 皮克斯）的缺口由 `references/ip-notes.local.json` 补齐，`build_index.mjs` 合并进索引。
- `get_style` 会打印完整 IP 约束；`pick_style` 用 `IP 约束` 标记。

## 数据说明

- `style-registry.seed.json` 是上游**逐字节原样拷贝**（哈希一致）。它的 `seed_note` 里「当前 26 个」和引用的两份文档（`风格注册表_style-registry.md`、`风格路由表.md`）属于主包内部资料，本包以 `style-index.json` 的 50 条为准。
- `SYNCED.json` 的键是主包原名 `references/风格锚_*.md`；本包对应 `references/anchors/*.md`，**只重命名，不改内容**。
- 部分锚正文会引用主包的 `scripts/*.py`：`dedupe_style.py` 多数写的是「不要跑」；`写实PBR.md` 的过审预检「必跑 `audit_risk.py`」是主包工具。这些脚本不在本包，选风格与取参数不受影响；过审预检请回主包。

## 边界

- 不做分镜、不做角色一致性、不做叙事
- 不承诺"某个风格最好"——只给轨道、参数与已知崩点
- 锚是基准，项目级色值应以 asset-registry 为准

## 来源与同步

50 份锚与注册表来自 `liqi-video-forge v6.19.8`（MIT），51 个哈希记录在 `SYNCED.json`，实测 51/51 一致。
主包升级后：重拷锚 → `node scripts/build_index.mjs` → `node scripts/check_sync.mjs <主包目录>`。
主包不在时 `check_sync` 返回 SKIPPED（跳过 ≠ 通过）。
