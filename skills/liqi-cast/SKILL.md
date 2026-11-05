---
name: liqi-cast
description: 角色一致性专精包。给一个角色设定，产出可直接投喂的 4 View 资产板提示词（左头部近景 + 右保头无脸三联 + 身高线/色板/图底音色条），并机检五官 10 项、服装 6 项、身高、色板与版本互锁词（非空 / 不自我矛盾 / 不雷同）。适用于要做多镜/多集、角色脸和服装必须不漂移的项目；单张插图、不需要跨镜一致性的活不要用。
version: "0.2.1"
category: "图像与视频生成"
platforms: ["WorkBuddy", "Claude Code", "Codex", "任意可执行 Node 的 Agent"]
license: MIT
---

# liqi-cast · 角色一致性专精包

抽自 `liqi-video-forge v6.19.8` 的资产层，只保留「让同一张脸在几十个镜头里不漂」这一件事。
不依赖三锁、不依赖主包，单独也能用。

## 什么时候用

- 同一个人物要出现在 ≥2 个镜头，或跨集出现
- 换装、变年龄、受伤前后需要区分版本，但又必须是同一张脸
- 已经有一堆角色描述，但每次出图脸都不一样

## 什么时候不要用

- 只做单张插图、后景虚化的人物：直接写提示词更快
- 风格化到不需要真脸的（剪影、背影、Q 版火柴人）：版式成本不划算
- 还没定角色设定就想先出图：先定，再进来；4 View 的作用是锁定，不是探索

## 核心概念

**4 View = 左区 + 右区，一次出图，不是四次。**

| 区域 | 内容 | 目的 |
|---|---|---|
| 左区 25% | 头部近景（五官可辨），上下双锁取景 | 锁脸 |
| 右区 75% | 保头无脸三联：正面全身 / 侧面 / 背面 | 锁身形与服装结构 |
| 身高线 | 右区最左的垂直参照线 + `X cm` | 跨镜身形一致 |
| 色板 | 角落圆形色票 + 中文色名 + HEX | 跨批次色偏 |
| 图底 12% | 横向声纹波形 + 英文音色速览标签（≤8 词） | 交付时对齐声画与版本号 |

**右区必须「保头无脸」**：头部保留、面部不画五官。不是无头，也不是画模糊脸。
右区一旦画出清晰五官，就会和左区打架，模型下次不知道该跟哪张。

**全卡只允许三处带字**：身高线数值、色板色名、图底英文音色速览标签。零引线、零标注线、零箭头。

## 工作流

1. **分级**：先判断这个角色需不需要建资产链（见 `references/01-layout-and-levels.md`）。
2. **写设定**：按 `references/02-text-locks.md` 填满五官 10 项 + 服装 6 项 + 性别锚点，并给出 `height_cm` 与三项色板（中文色名 + HEX）。
3. **出图**：用 `scripts/cast_sheet.mjs` 生成提示词块；换装/变龄的互锁词会按版本进入负向段，出哪版只取哪一行。
4. **自检**：跑 `scripts/check_cast.mjs`；出图后再按九问回看一遍。
5. **建版本**：按 `references/03-version-interlock.md` 声明版本与互锁词，不许同名两版。

## 快速开始

```bash
# 1) 校验角色设定（缺项会报 ERROR 与具体字段）
node scripts/check_cast.mjs examples/cast-good.json

# 2) 生成 4 View 提示词块（英文骨架 + 中文字段，可直接投喂）
node scripts/cast_sheet.mjs examples/cast-good.json

# 3) 附带 16 项清单与九问
node scripts/cast_sheet.mjs examples/cast-good.json --check

# 4) 自测（28 条：合格 / 不合格 / 类型异常 / 边界规则）
node scripts/selftest.mjs
```

## 输入格式

完整字段表与类型约束见 `examples/cast.schema.json`。最小结构：

```json
{
  "name": "沈知微",
  "gender": "女",
  "age_range": "22~24",
  "identity": "行走江湖的制伞人",
  "height_cm": 168,
  "face": {
    "bone": "...", "brow": "...", "eye": "...", "pupil": "...", "nose": "...",
    "lip": "...", "jaw": "...", "ear": "...", "mark": "无", "skin": "..."
  },
  "wardrobe": {
    "fabric": "...", "texture": "...", "drape": "...", "wear": "...", "metal": "...", "seam": "..."
  },
  "palette": [
    { "name": "青灰", "hex": "#3A4E48", "part": "外衫" },
    { "name": "墨绿", "hex": "#556B66", "part": "长裙" },
    { "name": "雾灰", "hex": "#7D8C8A", "part": "提亮" }
  ],
  "audio_label": "low, restrained female voice",
  "versions": [
    {
      "name": "沈知微-常服",
      "verdict": "reuse",
      "diff": "靛蓝布衫 + 深灰长裙，无外伤",
      "interlock": ["血渍", "绷带", "破损衣角"],
      "interlock_en": ["blood stains", "bandages", "torn hem"]
    }
  ]
}
```

`face_en` / `wardrobe_en` / `interlock_en` 可选：有英文就用英文，没有就回落中文。

## 输出长什么样

完整全文见 `examples/expected-output.txt`。骨架：

```
[4 VIEW CHARACTER SHEET]
CARD: ... card text only in these places ...
SUBJECT: 沈知微 · 22~24岁女性（行走江湖的制伞人）

LAYOUT: main view area 88%, bottom detail band 12%, ...
LEFT (25%): ... 上下双锁 ... 肩颈不裸露 ... 22~24岁女性（行走江湖的制伞人）
RIGHT (75%): ... featureless face ... 完整到鞋 ...
HEIGHT LINE: ... "168 cm" ...
PALETTE: ... 青灰 #3A4E48（外衫）...
BOTTOM: ... 英文音色速览标签 ...
NEGATIVE (base): ...
NEGATIVE (per version — use only the line matching the version you render):
  - 沈知微-常服: blood stains, bandages, torn hem
VERSIONS:
  - 沈知微-常服 [reuse]: ...
```

上半部分是提示词，`--check` 追加 16 项清单与九问。不合格样例的预期报错见 `examples/expected-bad-output.txt`。

## 文件

- `references/01-layout-and-levels.md` — 什么时候要建资产链、版式的硬约束、像素账
- `references/02-text-locks.md` — 五官 10 项、服装 6 项、性别锚点、身高、色板、负向词纪律
- `references/03-version-interlock.md` — 版本拆分、跨集复用、出现四态、身份判定
- `references/04-feeding-and-rework.md` — 三条投喂铁律、出图后九问、常见崩法与补救
- `examples/cast.schema.json` — 输入字段与类型
- `examples/expected-output.txt` / `expected-bad-output.txt` / `selftest-output.txt` — 完整输出、预期报错与自测输出

## 边界

- 不做剧本、不做分镜、不做风格选择——那是主包与其它专精包的事
- 不做跨集台账：版本互锁只覆盖单个角色内的变体，跨集复用仍按主包台账人工管理
- 机检只查结构（互锁词非空、不自我矛盾、两版不雷同），语义上的「互斥」仍需人判断
- 不承诺「一次出图就完美」；这套东西的价值在于**可复现**，不是一次成
- 不改你的画风，只锁你的脸和衣服

## 来源

本包内容由 `liqi-video-forge v6.19.8` 的资产层与 4 View 模板改写压缩而来，
规则口径以主包为准；若主包升级，跑 `node scripts/check_sync.mjs` 比对（见该脚本头部说明）。
