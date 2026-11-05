---
name: liqi-lens
description: 镜头表与光专精包。把一场戏拆成可执行镜头表（景别/角度/视角/光位/光比/轴线/时长），输出可直接投喂的镜头卡，并机检三任务、轴线与可算的分镜配额（Q2 常规机位需人工）。适合写分镜、拆镜头、给视频模型写镜头；只做单张静态图、角色一致性或风格选择的活不要用。
version: "0.2.1"
category: "AI 视频 / 分镜"
platforms: ["WorkBuddy", "Claude Code", "Codex", "任意可执行 Node 的 Agent"]
license: MIT
---

# liqi-lens · 镜头表与光专精包

从 `liqi-video-forge v6.19.8` 的视听层、光学块、轴线规则与分镜配额里抽出来的**镜头表**工具。
不依赖主包，单独也能用。

## 什么时候用

- 已经有一场戏/一段剧情，要拆成能拍的镜头清单
- 需要把景别、角度、视角、光位、光比、轴线、时长一次写清
- 写完镜头表，想机检三任务、轴线、光比与 11 项配额
- 想给每个镜头生成一张可直接投喂的镜头卡

## 什么时候不要用

- 只做单张静态图、不需要镜头表：用 `liqi-style` / `liqi-cast`
- 只差运镜词：用 `liqi-move`
- 需要角色一致性、风格选择、剧本门控：那是其它专精包的事

## 它给了什么

| 层 | 内容 |
|---|---|
| 镜头判断 | 三任务（情绪 / 动作 / 压力）、三大调度、剪辑六律、四阶呼吸 |
| 光学 | 景别 9 档、透视 3 类、景深 3 档、视角 7 档、防漂移句 |
| 光 | 物理光源铁律、日景防冷光、光位 / 光比 |
| 空间 | 轴线三铁律、跨轴四过渡、反打匹配、轴线声明 |
| 配额 | 11 项区间 + C1 三件套 + S21/S22 |
| 可选表演 | 说前/说时/说后、呼吸、视线、一处微变化 |

**镜头表是制片层，不是最终提示词。** 正文写可见结果句，不写 mm / f 值 / ISO / 镜头型号。

## 工作流

1. **写表**：按 `references/06-shot-table.md` 写 `shot-list.json`；每镜至少一个三任务。
2. **机检**：`node scripts/check_lens.mjs shot-list.json`；先清 ERROR，再看 WARN 与「未查」。
3. **出卡**：`node scripts/shot_list.mjs shot-list.json` 生成镜头卡；`--md` 出表，`--json` 出规范化数据。
4. **投喂**：把每镜的 `画面` / `prompt_en` 投给模型；防漂移句已按视角自动补。

## 快速开始

```bash
# 合格样例：6 镜 2 段，0 ERROR / 0 WARN
node scripts/check_lens.mjs examples/shot-list-good.json

# 生成镜头卡（默认）/ Markdown 表 / 规范化 JSON
node scripts/shot_list.mjs examples/shot-list-good.json
node scripts/shot_list.mjs examples/shot-list-good.json --md
node scripts/shot_list.mjs examples/shot-list-good.json --json

# 不合格样例：11 ERROR / 5 WARN
node scripts/check_lens.mjs examples/shot-list-bad.json

# 自测
npm test
```

## CLI 参数表

| 脚本 | 参数 | 说明 |
|---|---|---|
| `check_lens.mjs` | `<shot-list.json>` | 逐镜字段 + 轴线 + 配额；相对路径按包根解析 |
| `shot_list.mjs` | `<shot-list.json>` | 默认输出镜头卡 |
| | `--md` / `--json` | 表 / 规范化 JSON；互斥 |
| `check_sync.mjs` | `[主包目录]` | 缺省读 `LIQI_CORE` 或 `../liqi-video-forge` |
| `check_golden.mjs` | 无 | 黄金输出逐行 diff；`npm test` 会跑 |
| `selftest.mjs` | 无 | 57 条自测 |

## 镜头卡长什么样

```
【03｜巷口｜4s｜特写】
任务：改变人物情绪
景别：特写（8/9）· 角度：过肩 · 视角：29°（长焦）
主体：沈知微与黑影
动作：停步，回头
光：侧逆光 · 光源：巷口路灯 · 光比：1:4
轴线：沈知微在画面左三分之一（西侧），黑影在右三分之一（东侧），隔雨帘相望 · 机位：左
运镜：缓推
画面：主体占画面六成以上，背景只剩色块与光斑，雨珠挂在伞骨上
防漂移：本镜任何部分都不变为广角覆盖，背景全程保持压缩与融化，更宽的取景靠机位拉远实现而不是换透视
EN：medium close-up, 45-degree side angle, slow push-in, rain-soaked alley, woman turning her head
```

完整卡片见 `examples/shot-cards.txt`，表格见 `examples/shot-table.md`。

## 机检边界（必须说清）

- **能机检**：三任务缺失、9 档景别、角度、7 档视角、7 词运镜、2–15 秒、光位、物理光源、光比格式、多人镜轴线/左右/机位侧、同场景上一个多人镜跨轴、Q1/Q3/Q4/Q5/Q6/Q7/Q8/Q9/Q10/Q11、C1、S21、S22。
- **需人工**：Q2 常规机位占比（数据模型没有正面/过肩字段）、轴线语义对不对、表演装不装得下、构图好不好。
- **未查 ≠ 通过**：镜数不够门槛时 Q1/Q3/Q4/Q8/Q9 会明确写「本门未查」。
- **Q9 门槛是 4，不是主包的 8**：本包只有 7 个合法运镜词，8 永远不可达；`minShotsForMove` 仍是 8 镜。
- **短包**：2–15 秒是通用护栏；H3 面单镜按 4–15 秒另管。
- **输入处理**：镜头表只在本地读取，不上传、不落盘；`check_lens` / `shot_list` 只写 stdout。

## 文件

- `references/01-shot-grammar.md` — 三任务、三大调度、剪辑六律、反形容词、构图四件套
- `references/02-optics.md` — 景别九档、透视、景深、视角表、防漂移、真假运镜
- `references/03-light-and-axis.md` — 物理光源、日景防冷光、轴线三铁律、跨轴四过渡、反打
- `references/04-quota.md` — 11 项配额、ERROR/WARN 分级、S 码、最小样本
- `references/05-performance-optional.md` — 说前三态、呼吸、视线、一处微变化
- `references/06-shot-table.md` — 镜头表字段 Schema
- `examples/shot-list-good.json` / `shot-list-bad.json` — 合格/不合格样例
- `examples/check-pass.txt` / `check-fail.txt` / `shot-cards.txt` / `shot-table.md` / `selftest-output.txt`
- `examples/shot-list.normalized.json` — `--json` 的派生字段示例
- `scripts/check_golden.mjs` — 黄金输出逐行 diff（`npm test` 会跑）

## 边界

- 不做风格、不做角色、不做剧本叙事
- 不重复 `liqi-move` 的 24 条场型骨架；本包只把运镜当成镜头表的一行
- 不承诺「构图一定帅」；只把可检查的规则变成机检，语义仍需人看
- 轴线跨镜检查只看镜头表内的同场景上一个多人镜；台账级的逐镜比对仍需人做

## 来源与同步

5 份来源：`视听层_镜头文法与光色.md`、`光学与空间语言块.md`、`轴线与反打规则.md`、`分镜配额与机检规范.md`、`情绪表演层.md`（v6.19.8，MIT）。
`SYNCED.json` 记录 5 个哈希；主包升级后跑 `node scripts/check_sync.mjs <主包目录>`。
本包 references 是**改写压缩**，不是逐字节拷贝；哈希用于发现上游变化。
5 个上游文件不随包分发，第三方核验需要主包 v6.19.8；主包不在时返回 SKIPPED（跳过 ≠ 通过）。