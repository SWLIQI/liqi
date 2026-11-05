# 第三方内容与许可声明

## 一、不含第三方内容

`move-index.json` 由脚本从自有项目 `liqi-video-forge` 的 `references/镜头骨架库.md` 解析生成；
`move-vocab.json` 的 7 个用词取自同一文件。禁止清单的 7 条来源词逐条回查
`references/MiniMaxH3适配.md`，另有 3 条本地扩展。两份都是自有内容（MIT），未收录他人文档或数据集。

## 二、来源

| 本包内容 | 来自 | 版本 | 许可 |
|---|---|---|---|
| `move-index.json` | `liqi-video-forge/references/镜头骨架库.md` | 6.19.8 | MIT |
| `move-vocab.json` 用词部分 | 同上 | 6.19.8 | MIT |
| `move-vocab.json` 禁止清单（7 条来源词） | `liqi-video-forge/references/MiniMaxH3适配.md` §九 | 6.19.8 | MIT |
| `move-vocab.json` 禁止清单（3 条本地扩展） | `references/bans.json`（本仓库作者策展） | 0.2.0 | MIT |
| `SKILL.md` / `scripts/*` / `examples/*` | 本仓库作者撰写 | 0.2.0 | MIT |

上游许可：MIT License，Copyright (c) 2026 超级liqi提示词 contributors。

## 三、一条已知缺口

主包文档写明"运镜只有 12 个原语"，但**未枚举这 12 个**（指向外部 `h3-camera-shots`）。
本包因此只提供骨架库实际使用的 7 个用词，不冒充原语清单。

## 四、同步

`SYNCED.json` 记录两个来源文件（骨架库 + H3 适配）的 SHA-256。
`build_index.mjs` 会读取 H3 适配文件，对 `references/bans.json` 里标注来源的 7 条禁止词
逐条确认仍出现在原文；找不到就重建失败。本地扩展的 3 条不参与回查。
