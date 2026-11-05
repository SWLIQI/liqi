# 第三方内容与许可声明

## 一、本包不含第三方内容

`liqi-cast` 的正文（SKILL.md、references、scripts、examples）全部由本仓库作者撰写，
是基于自有项目 `liqi-video-forge` 的改编压缩，**未收录任何他人的文档、提示词或数据集**。
因此不需要为任何第三方内容提供署名或许可副本。

## 二、来源

| 本包文件 | 改编自 | 版本 | 许可 |
|---|---|---|---|
| `references/01-layout-and-levels.md` | `liqi-video-forge/references/4View资产板_模板.md`、`资产层_锁定与一致性.md` | 6.19.8 | MIT |
| `references/02-text-locks.md` | `liqi-video-forge/references/资产层_锁定与一致性.md` 第三节 | 6.19.8 | MIT |
| `references/03-version-interlock.md` | `liqi-video-forge/references/版本拆分与互锁清单.md` | 6.19.8 | MIT |
| `references/04-feeding-and-rework.md` | `liqi-video-forge/references/4View资产板_模板.md`、`资产层_锁定与一致性.md` | 6.19.8 | MIT |
| `SKILL.md` / `scripts/*` / `examples/*` | 本仓库作者撰写 | 0.2.1 | MIT |

上游许可：MIT License，Copyright (c) 2026 超级liqi提示词 contributors。

## 三、同步

来源文件的哈希记录在 `SYNCED.json`。主包升级后跑 `node scripts/check_sync.mjs <主包目录>`，
哈希不一致会报出具体文件；未提供主包时脚本返回"SKIPPED（跳过 ≠ 通过）"。

## 四、没有引入的内容

主包的 `references/external/`（16 份带各自许可的第三方文档）**一份都没有带进来**。
本包刻意只做单一维度，避免把第三方许可义务扩散到一个新的发布物上。
