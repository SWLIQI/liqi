# 剧本表字段 Schema

`check_script.mjs` / `script_card.mjs` 的输入是一个 JSON 对象。

## 一、顶层

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | 是 | 剧本名 |
| `episode` | string | 否 | 集号，如 `EP01`；多集项目建议写 |
| `premise` | object | 是 | 30 字前提四要素 |
| `premise.protagonist` | string | 是 | 主角 |
| `premise.desire` | string | 是 | 核心欲望 |
| `premise.obstacle` | string | 是 | 不可抗力阻碍 |
| `premise.cost` | string | 是 | 失败的致命代价 |
| `opening_hook` | string | 是 | 极端悬念 / 认知反差 / 情绪爆发 / 视觉奇观 |
| `acts` | array | 否 | 3 项 `{name, percent}`；完整剧本建议 30/50/20 |
| `characters` | string[] | 是 | 角色名，唯一 |
| `scenes` | array | 是 | 非空场景数组 |
| `tail_hook` | object | 否 | `{type, content, recall}`；多集项目建议写 |
| `chips` | array | 否 | `[{type, content}]`；筹码四类 |

`tail_hook.type`：信息钩 / 危机钩 / 选择钩 / 态度钩。
`tail_hook.recall` 建议写成 `E2 0:08 …`（含集号）。
`chips[].type`：信息 / 关系 / 资源 / 力量。

> 标「建议」的字段缺省只 WARN，不阻断；但**未标注 ≠ 通过**。标「必填」的字段缺省为 ERROR。

## 二、场景

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 场号，全文件唯一 |
| `interior_exterior` | string | 是 | 内景 / 外景 |
| `location` | string | 是 | 具体地点 |
| `time` | string | 是 | 日/夜/晨/昏… |
| `characters` | string[] | 是 | 本场出场角色，必须在顶层 `characters` 里 |
| `goal` | string | 是 | 场景目标 |
| `obstacle` | string | 是 | 遭遇阻碍 |
| `escalation` | string | 是 | 升级行动 |
| `turn` | string | 是 | 意外转折 |
| `result` | string | 是 | 不可逆新局面 |
| `duration` | number | 是 | 场景预算秒数，1–300 |
| `action_time` | number | 否 | 非台词动作占用的秒数，0–300 |
| `plot_points` | string[] | 建议 | 情节点；全剧 ≥5，15s 段 ≥1；缺省只 WARN，未标注 ≠ 通过 |
| `description` | string | 是 | 环境/动作描述；不写镜头语言、不可拍心理、slop |
| `lines` | array | 否 | 台词；动作场可为空 |

## 三、台词

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 台词号，全文件唯一 |
| `speaker` | string | 是 | 角色名；`旁白` 只能用于 VO/OS |
| `text` | string | 是 | 台词原文；冻结后一字不差 |
| `type` | string | 否 | 对白（默认）/ VO / OS |
| `rate` | string \| number | 否 | `slow` 2.8 / `normal` 3.5 / `fast` 5.0，或 1–6.5 的数字（数字字符串如 `"3.5"` 也接受）；默认 normal |
| `functions` | string[] | 建议 | 七维：角色辨识度 / 潜台词层级 / 冲突推进力 / 类型语感 / 信息效率 / 节奏与音乐性 / 金句潜力；缺省只 WARN |
| `subtext` | string | 条件 | 标了「潜台词层级」时必填 |
| `action` | string | 否 | 微动作；不写镜头语言/不可拍心理/slop |
| `pause_after` | number | 否 | 追加停顿秒数，0–10 |
| `lipsync` | boolean | 否 | VO/OS 为 true 是错误；对白为 false 只 WARN |

## 四、派生字段（只读）

`check_script` / `script_card` 会计算：可发音字数、标点停顿、单句秒数、场景台词总秒数、场景余量、VO 字数/占比、口播均值。输入里不用写。

## 五、最小片段

```json
{
  "title": "雨夜巷口",
  "premise": { "protagonist": "沈知微", "desire": "回家", "obstacle": "黑影挡路", "cost": "被认出" },
  "opening_hook": "认知反差",
  "characters": ["沈知微", "黑影"],
  "scenes": [
    {
      "id": "S01", "interior_exterior": "外景", "location": "巷口", "time": "夜",
      "characters": ["沈知微", "黑影"],
      "goal": "穿过巷口", "obstacle": "黑影挡路", "escalation": "她绕行", "turn": "黑影叫出她的名字", "result": "她停步",
      "duration": 20, "action_time": 1,
      "plot_points": ["黑影叫出她的名字（信息翻转）"],
      "description": "雨丝斜落，积水映着路灯",
      "lines": [
        {
          "id": "L01", "speaker": "黑影", "text": "你终于来了。", "type": "对白",
          "rate": "normal", "functions": ["冲突推进力", "信息效率"],
          "subtext": "我等你很久", "action": "从雨里走出"
        }
      ]
    }
  ]
}
```

## 六、命令

```bash
node scripts/check_script.mjs script.json
node scripts/script_card.mjs script.json
node scripts/script_card.mjs script.json --md
node scripts/script_card.mjs script.json --json
```

**通过机检不等于剧本好**：潜台词质量、类型语感、卡点、表演容量仍需人看。