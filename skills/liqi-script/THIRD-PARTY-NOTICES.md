# 第三方内容与许可声明

## 一、不含第三方内容

`liqi-script` 的正文（SKILL.md、references、scripts、examples）由本仓库作者撰写，
基于自有项目 `liqi-video-forge` 的改写压缩，**未收录任何他人的文档、提示词或数据集**。
因此不需要为任何第三方内容提供署名或许可副本。

## 二、来源

| 本包内容 | 改编自 | 版本 | 许可 |
|---|---|---|---|
| `references/01-gates.md` | `liqi-video-forge/references/叙事层_剧本门控与台词.md` | 6.19.8 | MIT |
| `references/02-dialogue.md` | 同上 | 6.19.8 | MIT |
| `references/03-speech-rate.md` | 同上（第四节语速校准） | 6.19.8 | MIT |
| `references/04-voiceover.md` | `references/方言与旁白规程.md`、`叙事层_剧本门控与台词.md` | 6.19.8 | MIT |
| `references/05-deai-and-hooks.md` | `references/去AI味对照清单.md`、`references/尾钩与筹码账.md`、`叙事层_剧本门控与台词.md` | 6.19.8 | MIT |
| `script-vocab.json` / `scripts/*` / `examples/*` | 本仓库作者撰写 | 0.2.1 | MIT |

上游许可：MIT License，Copyright (c) 2026 liqi-video-forge contributors。

## 三、同步

`SYNCED.json` 记录 4 个来源文件的 SHA-256，键名为主包原名。
本包的 `references/01-gates.md` 至 `05-deai-and-hooks.md` 是**改写压缩**，不是逐字节拷贝；哈希用于检测上游是否变化。
主包升级后：回读对应章节 → 更新本包 references 与 `script-vocab.json` → 重建 `SYNCED.json`。

**4 个上游文件不随包分发**；第三方独立核验需要主包 v6.19.8，把主包放在旁边跑
`node scripts/check_sync.mjs <主包目录>`。`examples/sync-verified.txt` 是开发机 4/4 的核验记录。
96 条中文配音实测原始记录在主包 `叙事层_剧本门控与台词.md` §四，不随本包。

## 四、没有引入的内容

- 主包的 `references/external/`（16 份带各自许可的第三方文档）一份都没有带进来。
- 主包 `表演层_FACS微表情.md` 的 29 个 AU 字典与 26 条配方没有复制；本包只做剧本层，面部肌肉细节回主包。
- 方言部分只带“标注法 + 容量红线”，不带 50 套分区词典。