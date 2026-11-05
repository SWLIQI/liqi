# liqi-script · 剧本门控与台词专精包

剧本写完先过五道门：**前提 / 结构 / 因果链 / 实体 / 脚本页**。
再查台词七维、语速排期、VO/OS 红线与去AI味，输出剧本卡与逐句时长表。

从 [liqi-video-forge](https://github.com/SWLIQI/liqi) v6.19.8 的叙事层、方言与旁白、去AI味、尾钩与筹码账抽出，不依赖主包。

## 运行前提

- Node.js ≥ 16（ESM，脚本为 `.mjs`）；零第三方依赖
- 全部文件名 ASCII，解压后跨平台一致
- Windows 控制台中文乱码时先执行 `chcp 65001`

## 输入处理

镜头表/剧本只在本地读取；`check_script` / `script_card` 只写 stdout，不上传、不落盘。
`check_sync` 会打印主包绝对路径，属于本地信息，不随包外传。

## 快速开始

```bash
node scripts/check_script.mjs examples/script-good.json
node scripts/script_card.mjs examples/script-good.json
node scripts/script_card.mjs examples/script-good.json --md
node scripts/script_card.mjs examples/script-good.json --json
node scripts/check_script.mjs examples/script-bad.json
npm test
```

## 输入

```json
{
  "title": "雨夜巷口",
  "episode": "EP01",
  "premise": {
    "protagonist": "沈知微",
    "desire": "穿过巷口回家",
    "obstacle": "黑影堵住去路",
    "cost": "被认出身份"
  },
  "opening_hook": "认知反差",
  "acts": [
    { "name": "铺垫", "percent": 30 },
    { "name": "冲突", "percent": 50 },
    { "name": "转折", "percent": 20 }
  ],
  "characters": ["沈知微", "黑影"],
  "scenes": [
    {
      "id": "S01",
      "interior_exterior": "外景",
      "location": "巷口",
      "time": "夜",
      "characters": ["沈知微", "黑影"],
      "goal": "穿过巷口回家",
      "obstacle": "黑影堵住去路",
      "escalation": "她绕行，黑影先一步挡住",
      "turn": "黑影叫出她的名字",
      "result": "她停步回头",
      "duration": 24,
      "action_time": 2,
      "plot_points": ["黑影叫出她的名字（信息翻转）"],
      "description": "雨丝斜落，积水映着路灯",
      "lines": [
        {
          "id": "L01",
          "speaker": "黑影",
          "text": "你终于来了。",
          "type": "对白",
          "rate": "normal",
          "functions": ["冲突推进力", "信息效率"],
          "subtext": "我等你很久",
          "action": "从雨里走出"
        }
      ]
    }
  ]
}
```

完整字段表见 `references/06-script-schema.md`。

## 输出

`check_script`：

```
剧本：雨夜巷口（EP01）
场景 2 / 台词 8 / 可发音 62 字 / 台词 24.1s / 预算 42s / 口播均值 3.09 字/秒
Gate 1 核心前提 ✓ · Gate 2 结构 ✓ · Gate 3 场景因果节拍 ✓ · Gate 4 实体边界 ✓ · Gate 5 脚本页 ✓
结果：0 ERROR / 0 WARN
```

`script_card` 会输出每场的 Gate 3 因果链、情节点、脚本页与逐句时长表：

```
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

## 机检什么

- 前提四要素、开场钩子四选一、三幕 30/50/20
- 每场五段因果（目标/阻碍/升级/转折/结果）、情节点数量
- 角色唯一、场景角色/台词 speaker 可追溯
- 场景头、动作/环境描述、不写镜头语言
- 台词长度（>24 WARN / >30 ERROR）、语速（2–6.5，硬闸 6.5）、逐句时长、场景预算
- functions 七维枚举、标了「潜台词层级」必须有 subtext
- VO/OS 不锁口型、VO 行占比/口播量、旁白只能 VO/OS
- 不可拍心理词、slop 词、AI 腔词
- 尾钩四型/内容/回收集号、筹码四类/内容

## 机检不查什么

- 潜台词好不好、类型语感、角色语言指纹是否真的立住
- 三视角审稿、结尾卡点是否真的停在「前一帧」
- 表演装不装得下（那是 `liqi-lens` 的景别 × 表演耦合）
- Q2/结构审美：三幕比例只算数，不判断故事好不好

**未标注 ≠ 通过**：情节点、functions、尾钩/筹码没标时只提示，不冒充已核对。

## 黄金输出守卫

`npm test` 会先跑 `selftest.mjs`（84 条），再跑 `check_golden.mjs`：把 5 个脚本输出与 `selftest-output.txt` 逐行比对。改脚本后必须同步更新 `examples/`，否则 test 会失败。`check_golden` 为了自举守卫会再跑一次 selftest，`npm test` 实际跑两遍 selftest（功能无害，耗时约翻倍）。

## 常见问题

- **为什么 normal 是 3.5，全剧均值却按 3.2 报警？** 3.5 是逐句可行区间；3.2 是主包 96 条配音实测的排期上限，两者一个管「念不念得完」，一个管「挤不挤」。
- **台词 >24 和 >30 有什么区别？** >24 建议拆镜；>30 必须拆镜（本包直接 ERROR）。
- **VO/OS 为什么不能 lipsync=true？** 画外声不锁口型；一边说不锁、一边要求口型同步，模型会二选一。
- **剧本里能写镜头吗？** 不能。镜头/景别/光位交给 `liqi-lens`；本包只查剧本页。
- **三幕没写 acts 会怎样？** 只 WARN「未声明」，不阻断；完整剧本建议写 30/50/20。
- **情节点怎么标？** 每场 `plot_points` 数组，写成「…（信息翻转 / 关系变化 / 意图变化）」；全剧 ≥5，15s 段 ≥1。
- **主包不在怎么同步？** `check_sync` 返回 SKIPPED，并明确跳过 ≠ 通过。

## 目录

```
SKILL.md                          说明与工作流
script-vocab.json                 门控/七维/语速/词表
references/01-gates.md            五阶门控、前提、三幕、因果链、实体、N 码
references/02-dialogue.md         七维、三法则、语言三件套、三段式重构
references/03-speech-rate.md      理论档 vs 实测校准、算式、五档、拆镜
references/04-voiceover.md        VO/OS、容量、声画信息差、方言标注
references/05-deai-and-hooks.md   去AI味、尾钩四型、筹码四类、三视角
references/06-script-schema.md    剧本表字段 Schema
scripts/check_script.mjs          校验剧本
scripts/script_card.mjs           剧本卡 / 表 / JSON
scripts/check_sync.mjs            与主包比对 4 个哈希
scripts/check_golden.mjs          黄金输出逐行 diff
scripts/selftest.mjs              84 条自测
examples/                         合格/不合格样例与输出
examples/sync-verified.txt        开发机 4/4 同步核验记录
```

## 边界

不替你改台词（冻结后一字不差）；不做分镜/运镜/风格/角色。
只把能变成数值和结构的门控查出来，语义与审美仍需人看。

## 许可

MIT。4 份来源来自 liqi-video-forge v6.19.8（MIT），详见 `THIRD-PARTY-NOTICES.md`。