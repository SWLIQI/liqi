# 第三方内容与许可声明

## 一、不含第三方内容

`liqi-lens` 的正文（SKILL.md、references、scripts、examples）由本仓库作者撰写，
基于自有项目 `liqi-video-forge` 的改写压缩，**未收录任何他人的文档、提示词或数据集**。
因此不需要为任何第三方内容提供署名或许可副本。

## 二、来源

| 本包内容 | 改编自 | 版本 | 许可 |
|---|---|---|---|
| `references/01-shot-grammar.md` | `liqi-video-forge/references/视听层_镜头文法与光色.md` | 6.19.8 | MIT |
| `references/02-optics.md` | `references/光学与空间语言块.md` | 6.19.8 | MIT |
| `references/03-light-and-axis.md` | `references/视听层_镜头文法与光色.md`、`references/轴线与反打规则.md` | 6.19.8 | MIT |
| `references/04-quota.md` | `references/分镜配额与机检规范.md` | 6.19.8 | MIT |
| `references/05-performance-optional.md` | `references/情绪表演层.md` | 6.19.8 | MIT |
| `lens-vocab.json` / `scripts/*` / `examples/*` | 本仓库作者撰写 | 0.2.1 | MIT |

上游许可：MIT License，Copyright (c) 2026 liqi-video-forge contributors。

## 三、同步

`SYNCED.json` 记录 5 个来源文件的 SHA-256，键名为主包原名。
本包的 `references/01-shot-grammar.md` 至 `05-performance-optional.md` 是**改写压缩**，不是逐字节拷贝；哈希用于检测上游是否变化。
主包升级后：回读对应章节 → 更新本包 references 与 `lens-vocab.json` → 重建 `SYNCED.json`。

**5 个上游文件不随包分发**；第三方独立核验需要主包 v6.19.8，把主包放在旁边跑
`node scripts/check_sync.mjs <主包目录>`。当前开发环境对主包目录实测 5/5。

## 四、没有引入的内容

- 主包的 `references/external/`（16 份带各自许可的第三方文档）一份都没有带进来。
- 主包 `表演层_FACS微表情.md` 的 29 个 AU 字典与 26 条配方没有复制；本包只带表演三态/呼吸/视线/一处微变化，需要面部肌肉细节时回主包。