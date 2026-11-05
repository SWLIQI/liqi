---
name: liqi-script
description: 剧本门控与台词专精包。检查一场/一集剧本的五阶门控（前提/结构/因果链/实体/脚本页）、台词七维标注、语速排期、VO/OS 红线与去AI味，输出剧本卡与逐句时长表。适合短剧/短片剧本写完自检；只写分镜镜头、调运镜或改画风的活不要用。
version: "0.2.0"
category: "AI 视频 / 剧本"
platforms: ["WorkBuddy", "Claude Code", "Codex", "任意可执行 Node 的 Agent"]
license: MIT
---

# liqi-script · 剧本门控与台词专精包

从 `liqi-video-forge v6.19.8` 的叙事层、方言与旁白、去AI味、尾钩与筹码账里抽出来的**剧本自检**工具。
不依赖主包，单独也能用。

## 什么时候用

- 剧本初稿/改稿写完，想按五阶门控逐项过一遍
- 台词太长、语速排不下、每句都像念稿
- 多集项目要检查尾钩、下集回收与筹码变化
- 有 VO/OS（画外旁白/画外音），怕声画穿帮

## 什么时候不要用

- 只写分镜镜头、景别/机位/光位：用 `liqi-lens`
- 只调运镜词：用 `liqi-move`
- 角色一致性、风格选择：用 `liqi-cast` / `liqi-style`
- 纯文学写作、不改台词的活：这不是通用写作包

## 五阶门控

| Gate | 管什么 | 机检 |
|---|---|---|
| 1 Premise | 30 字前提四要素 + 开场钩子四选一 | ✓ |
| 2 Structure | 三幕 30% / 50% / 20%，结尾卡点 | 比例可算；卡点人工 |
| 3 Beat Sheet | 每场：目标→阻碍→升级→转折→不可逆结果；情节点 | ✓ 结构 + 密度 |
| 4 Entity Bounds | 角色唯一、场景角色/台词 speaker 可追溯 | ✓ |
| 5 Script Page | 场景头、动作/环境描述、台词页；不写镜头 | ✓ 结构 + 词表 |

## 台词七维与语速

台词七维：**角色辨识度 / 潜台词层级 / 冲突推进力 / 类型语感 / 信息效率 / 节奏与音乐性 / 金句潜力**。
每句用 `functions` 标注命中的维度；标了「潜台词层级」就必须写 `subtext`。

语速口径（本包采用主包的**实测校准**）：

- 单句：`slow` 2.8 / `normal` 3.5 / `fast` 5.0 字/秒；物理硬闸 **6.5**
- 排期：全剧口播均值 **>3.2 字/秒**报警（实测排期上限）
- 单句 **>24 字**警告，**>30 字**必须拆镜
- 标点停顿另算：逗号/顿号约 0.2s，句号/感叹/问号约 0.4s

## VO / OS 与去AI味

- 对白锁口型；**VO/OS 不锁口型**，`lipsync=true` 是硬错误。
- VO+OS 镜数占比 ≤30%（本包先按行占比报警，分镜层复核）；VO 口播 ≤80 字/分钟。
- 剧本页**不写镜头**（镜头/机位/景别/特写/光位/构图…交给 `liqi-lens`）。
- 动作描述不写「内心/想起/仿佛/空气凝固」等不可拍词；不用「电影感/高级感/氛围感」等 slop 词。

## 工作流

1. **写 JSON**：按 `references/06-script-schema.md` 写 `script.json`（前提/三幕/角色/场景/台词）。
2. **机检**：`node scripts/check_script.mjs script.json`；先清 ERROR，再看 WARN/备注。
3. **出卡**：`node scripts/script_card.mjs script.json` 生成剧本卡与逐句时长表；`--md` / `--json` 另出。
4. **改稿**：改完重跑；台词冻结后不再改字（本包不替你改台词）。

## 快速开始

```bash
node scripts/check_script.mjs examples/script-good.json
node scripts/script_card.mjs examples/script-good.json
node scripts/script_card.mjs examples/script-good.json --md
node scripts/script_card.mjs examples/script-good.json --json
node scripts/check_script.mjs examples/script-bad.json
npm test
```

## CLI 参数表

| 脚本 | 参数 | 说明 |
|---|---|---|
| `check_script.mjs` | `<script.json>` | 五阶/七维/语速/VO/尾钩；相对路径按包根解析 |
| `script_card.mjs` | `<script.json>` | 默认剧本卡；`--md` / `--json` 互斥 |
| `check_sync.mjs` | `[主包目录]` | 缺省读 `LIQI_CORE` 或 `../liqi-video-forge` |
| `check_golden.mjs` | 无 | 黄金输出逐行 diff；`npm test` 会跑 |
| `selftest.mjs` | 无 | 84 条自测 |

## 剧本卡长什么样

```
剧本：雨夜巷口（EP01）
Gate 1 核心前提 ✓ · Gate 2 结构 ✓ · Gate 3 场景因果节拍 ✓ · Gate 4 实体边界 ✓ · Gate 5 脚本页 ✓

【S01｜外景·巷口｜夜｜24s】
Gate 3：目标 穿过巷口回家 → 阻碍 黑影堵住去路 → 升级 她绕行，黑影先一步挡住 → 转折 黑影叫出她的名字 → 结果 她停步回头
情节点：黑影叫出她的名字（信息翻转 · 沈知微立场动摇）；…
出场人物：@沈知微、@黑影
环境：雨丝斜落，积水映着路灯，巷口没有别人
@黑影（从雨里走出）：「你终于来了。」
@沈知微（VO，不锁口型）：「师父说过，伞骨断了，就回不去了。」
台词表：
  #    角色    类型  字数  语速  时长   累计
  L01  黑影     对白   5    3.5  1.8s   1.8s
  …
  合计 16.4s（含动作 2s） / 预算 24s / 余 7.6s
```

完整卡/表见 `examples/script-cards.txt` 与 `examples/script-table.md`。

## 机检边界（必须说清）

- **能机检**：前提四要素/开场钩子、三幕比例、场景五段因果、情节点数量、角色/speaker 一致性、场景头、台词长度/语速/时长/预算、functions 枚举、潜台词缺 subtext、VO/OS 锁口型、VO 容量、镜头词/不可拍词/slop 词、尾钩类型/回收、筹码类型。
- **需人工**：潜台词好不好、类型语感、三视角审稿、表演装不装得下、结尾卡点是否真的「前一帧」。
- **未标注 ≠ 通过**：情节点、functions、尾钩/筹码没标时只提示，不冒充已核对。
- **语速**：2–6.5 字/秒是逐句可行性；全剧均值 >3.2 是排期偏紧（实测口径）。

## 文件

- `references/01-gates.md` — 五阶门控、30 字前提、三幕、因果链、情节点、实体、N 码
- `references/02-dialogue.md` — 七维诊断、三大法则、语言三件套、三段式重构、台词冻结
- `references/03-speech-rate.md` — 理论档 vs 实测校准、算式、六步、五档、字数速查、拆镜
- `references/04-voiceover.md` — VO/OS/对白、容量、声画信息差、三条硬线、方言标注
- `references/05-deai-and-hooks.md` — 去AI味、slop、六模式、尾钩四型、筹码四类、三视角
- `references/06-script-schema.md` — 剧本表字段 Schema
- `examples/script-good.json` / `script-bad.json` — 合格/不合格样例
- `examples/check-pass.txt` / `check-fail.txt` / `script-cards.txt` / `script-table.md` / `script.normalized.json` / `selftest-output.txt`
- `examples/sync-verified.txt` — 开发机 4/4 同步核验记录

## 边界

- 不替你改台词：台词冻结后一字不差；本包只诊断结构/时长/用词
- 不做分镜镜头、不做运镜、不做风格/角色
- 不承诺剧本好看：只把能变成数值和结构的门控查出来，语义仍需人看
- 三视角审稿是自检附件，不是交付硬门

## 来源与同步

4 份来源：`叙事层_剧本门控与台词.md`、`方言与旁白规程.md`、`去AI味对照清单.md`、`尾钩与筹码账.md`（v6.19.8，MIT）。
`SYNCED.json` 记录 4 个哈希；主包升级后跑 `node scripts/check_sync.mjs <主包目录>`。
本包 references 是**改写压缩**，不是逐字节拷贝；哈希用于发现上游变化。
4 个上游文件不随包分发，第三方核验需要主包 v6.19.8；主包不在时返回 SKIPPED（跳过 ≠ 通过）。