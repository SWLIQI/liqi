# 第三方内容与许可声明

## 一、本包不含第三方内容

`liqi-style` 的 `references/anchors/` 与 `style-registry.seed.json` 来自自有项目
`liqi-video-forge`（MIT），主编在此前发布该主包时**未把风格锚列为第三方内容**，
因此本包不产生新的署名义务，也未收录任何他人文档或数据集。

## 二、来源

| 本包内容 | 来自 | 版本 | 许可 |
|---|---|---|---|
| `references/anchors/*.md`（50 份） | `liqi-video-forge/references/风格锚_*.md` | 6.19.8 | MIT |
| `references/style-registry.seed.json` | 同上 | 6.19.8 | MIT |
| `references/ip-notes.local.json` | 本仓库作者撰写的本地合规补丁 | 0.2.2 | MIT |
| `SKILL.md` / `scripts/*` / `examples/*` | 本仓库作者撰写 | 0.2.2 | MIT |

上游许可：MIT License，Copyright (c) 2026 liqi-video-forge contributors。

## 三、同步

`SYNCED.json` 记录 51 个来源文件（50 锚 + 注册表）的 SHA-256，键名为主包原名
`references/风格锚_*.md`；本包对应 `references/anchors/*.md`，只重命名、不改内容。
主包升级后：重拷锚 → `node scripts/build_index.mjs` → `node scripts/check_sync.mjs <主包目录>`。

## 四、IP 补丁

上游注册表里有 8 条 `ip_note`。`ghibli-2d` 与 `stylized-pixar-3d` 在上游缺约束，
本包用 `references/ip-notes.local.json` 补齐，并由 `build_index.mjs` 合并进索引；
注册表本身保持逐字节不变，`check_sync` 仍可 51/51 核验。

## 五、未引入

主包的 `references/external/`（16 份带各自许可的第三方文档）一份都没有带进来。
