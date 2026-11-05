# liqi-style · 风格专精包

50 种已落值的视觉风格，按题材挑，取参数块，附崩点与反制。

从 [liqi-video-forge](https://github.com/SWLIQI/liqi) v6.19.8 抽出来，**不依赖主包**。

## 运行前提

- Node.js ≥ 16（ESM，脚本为 `.mjs`）；零第三方依赖
- Windows 控制台中文乱码时先执行 `chcp 65001`
- 解压用资源管理器 / PowerShell `Expand-Archive` / 7-Zip；Git Bash 自带 `unzip` 可能按本地代码页解码中文锚名

## 快速开始

```bash
node scripts/pick_style.mjs "古风 雨夜"
node scripts/pick_style.mjs --stability 险 --limit 10
node scripts/get_style.mjs 写实PBR
node scripts/check_style.mjs references/anchors/写实PBR.md
npm test
```

## CLI

| 脚本 | 参数 | 说明 |
|---|---|---|
| `pick_style.mjs` | `"关键词"` | 支持古风 / 二次元 / 写实 / 复古 / 3D / 国潮 / 恐怖 / 甜 |
| | `--dimension 2D\|3D\|实拍` | 维度过滤 |
| | `--stability 稳\|中\|险` | `险` 包含 `险（动态）` |
| | `--track <轨道名>` | 六轨之一 |
| | `--limit N` | 正整数，默认 3 |
| `get_style.mjs` | `<slug 或 中文名>` | 二选一 |
| | `--brief` / `--full` | 短参数 / 整份锚原文；互斥 |
| `check_style.mjs` | `<锚文件.md>` | 校验五节 / 索引字段 / stability / HEX |
| `build_index.mjs` | `--dry-run` | 只校验不写文件 |
| `check_sync.mjs` | `[主包目录]` | 缺主包返回 SKIPPED（跳过 ≠ 通过） |

## 输出示例

`get_style 写实PBR` 默认会输出色值表、运镜池、崩点清单、九段锚前 24 行，以及**多面压句全文**（逐字复用）：

```
# 写实PBR  (photoreal-pbr)
轨道 写实轨 · 3D · 头身比 7-7.5 · 稳定性 险
锚文件 references/anchors/写实PBR.md

## 三、色值表（风格级起点，项目级以 asset-registry 为准）
| 用途 | 色值 | 说明 |
...
## 二、多面压句（逐字复用，按投放面取用）（全文）
...
```

完整输出见 `examples/get-style-photoreal.txt`。

## 校验

通过：

```
锚：写实PBR
索引：photoreal-pbr / 写实轨 / 3D / 7-7.5 / 险
IP：无
字节：22470
结果：0 ERROR
```

失败示例见 `examples/check-fail.txt`；自测全量输出见 `examples/selftest-output.txt`（50/50 巡检）。

## 稳定性口径

`stability` 来自主包注册表的既有标注，不是本包实测：`稳` / `中` / `险`，另有 1 条 `险（动态）`（`pixel-2d`）。
`--stability 险` 会同时带上 `险（动态）`，共 3 条：`写实PBR`、`水墨淡彩2D`、`像素复古游戏`。

## 常见问题

- **为什么 `get_style` 输出很长？** 默认包含多面压句全文；用 `--brief` 看短版，`--full` 看整份锚。
- **`--stability 险` 为什么有 3 条？** `险（动态）`是险档子档，按主档过滤时一并带上。
- **`seed_note` 说只有 26 个？** 那是上游原样拷贝的过期自述；本包以 `style-index.json` 的 50 条为准。
- **工作室名能写进提示词吗？** 文档层可溯源；投喂词/交付提示词禁止点名作品、导演、工作室。见 `references/ip-notes.local.json`。
- **校验报 stability 非法？** 值域是 `稳` / `中` / `险` / `险（动态）`；跑 `build_index.mjs` 重建索引。
- **主包不在手边怎么同步？** `check_sync` 返回 SKIPPED 并明确「跳过 ≠ 通过」，不会假装通过。
- **锚里提到 `audit_risk.py` / `dedupe_style.py`，包里有吗？** 没有。前者是 `写实PBR` 的过审预检，后者多数写的是「不要跑」；都属于主包工具。本包只做选风格与取参数，过审预检请回主包。

## 目录

```
SKILL.md                              说明与工作流
style-index.json                      50 条索引（slug / 轨道 / 维度 / 头身比 / 稳定性 / IP）
references/anchors/                   50 份风格锚
references/style-registry.seed.json   上游注册表（逐字节原样）
references/ip-notes.local.json        本地 IP 补丁（上游缺的 2 条）
scripts/pick_style.mjs                关键词 → 候选
scripts/get_style.mjs                 按名字取参数块（含多面压句）
scripts/check_style.mjs               校验锚与索引
scripts/build_index.mjs               重建索引（--dry-run）
scripts/check_sync.mjs                与主包比对哈希
scripts/selftest.mjs                  34 条自测
examples/                             输出与校验样例
```

## 边界

不做分镜、不做角色一致性、不做叙事。只做"选风格 + 给参数 + 标崩点"。

## 许可

MIT。锚与注册表来自 liqi-video-forge v6.19.8（MIT），详见 `THIRD-PARTY-NOTICES.md`。
