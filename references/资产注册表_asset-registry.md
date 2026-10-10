# 资产注册表（asset-registry.json）

## 为什么要有这个东西

会话记忆会丢，注册表不会。没有注册表时，每一轮新会话都在重新编造身高、色名、版本互锁词——**跨批次穿帮的头号来源**。这是本 skill 与外部同类 skill 最大的能力差距所在，也是补齐优先级最高的一项。

注册表是**唯一事实源（single source of truth）**。提示词只是它在某一刻的投影。

## 落盘位置

> **本节是全仓定位顺序的唯一依据。**`资产层_锁定与一致性.md` 第六节只指向这里，不再另立一套顺序。

按以下顺序定位，找到即用；三处都没有时，**先在对话中声明「未发现资产注册表，本次在第一顺位新建」并告知落盘路径，再建**——不要静默新建后让用户去猜文件去哪了：

1. **用户指定的资产目录**（用户说在哪就在哪，优先级最高）
2. 项目内已有资产目录（`characters/`、`assets/`、`设定/`）
3. 与输入参考图同目录
4. 项目根目录

文件名固定 `asset-registry.json`。

## Schema

```json
{
  "project": "画皮",
  "updated": "2026-08-30",

  "style_anchor": "古装志怪电影质感，低饱和青灰调，做旧年代感，胶片颗粒",
  "proportion_tier": "realistic",
  "proportion_range": "7-7.5",

  "camera_language": {
    "focal": "35mm 为主，特写 85mm",
    "movement": "缓慢推轨，极少手持",
    "dof": "浅景深，背景轻微散景",
    "eye_level": "多数平视，压迫场景用低机位"
  },

  "atmosphere": {
    "particles": "悬浮尘埃",
    "fog": "无",
    "rain": "无",
    "rule": "尘埃是逆光产物：只有存在逆光或光柱的场景才可见，漫射场景不出现"
  },

  "color_rhythm": {
    "baseline": "低饱和青灰调",
    "turning_point": "第7场真相揭晓，转暖橙",
    "rule": "除第7场外全部锁定基准调"
  },

  "forbidden_elements": [
    "现代建材与金属反光",
    "过曝高光",
    "广角畸变",
    "磨皮塑料感皮肤"
  ],

  "generation": {
    "model": "",
    "seed": null,
    "params": "",
    "note": "出过好图的 seed 记在这里；同一资产复用同一 seed 可显著降低漂移"
  },

  "characters": {
    "character-a": {
      "display_name": "角色A",
      "role": "画皮妖",
      "entry_no": "1",
      "reference_files": ["characters/character-a-ref.png"],

      "durable": {
        "age_appearance": "外表20岁",
        "height_cm": 165,
        "proportion": "7头身",
        "face_anchor": "严格沿用参考图片全部五官样貌；全黑瞳孔无眼白；乌黑柔顺长直发；皮肤苍白半透明带微弱蜡质光泽"
      },
      "transient": {
        "_rule": "只登记会跨场次变化的状态（表情、姿态、伤口、湿衣、持物）。出图时按场次临时附加，不回写进 durable"
      },
      "versions": {
        "A": {
          "codename": "素白中衣",
          "wardrobe": "素白丝质中衣，交领剪裁，无纹样，不配腰带，静态自然垂坠",
          "palette": [
            { "name": "瓷白", "hex": "#F2F0E6", "part": "衣料与皮肤" },
            { "name": "墨黑", "hex": "#1A1A1A", "part": "头发与瞳孔" },
            { "name": "骨质米白", "hex": "#E8E0CC", "part": "骨簪" }
          ],
          "lock_out": ["藕荷色系"],
          "timeline": "全片前期，中秋之前",
          "outputs": { "md": "characters/character-a.md", "png": "characters/character-a.png" }
        },
        "B": {
          "codename": "藕荷衣裙",
          "wardrobe": "藕荷色衣裙",
          "palette": [
            { "name": "藕荷", "hex": "#D8BFD0", "part": "衣裙主色" }
          ],
          "lock_out": ["素白中衣"],
          "timeline": "中秋之后启用",
          "outputs": { "md": "characters/character-b.md", "png": "characters/character-b.png" }
        }
      }
    }
  },
  "props": {
    "haibu-wenshu": {
      "display_name": "海捕文书",
      "entry_no": "18",
      "material": "清代黄麻纸竖幅",
      "scale": "纸高约40cm",
      "palette": [
        { "name": "麻黄", "hex": "#D9C89A", "part": "纸" },
        { "name": "朱红", "hex": "#C1382E", "part": "印泥" }
      ],
      "lock_out": ["现代纸张", "打印感", "乱码错字"],
      "timeline": "全片",
      "outputs": { "md": "props/haibu-wenshu.md", "png": "props/haibu-wenshu.png" }
    }
  },
  "lock_matrix": [
    { "pair": ["character-a.A", "character-a.B"], "reason": "服装阶段切换，中秋为界", "each_locks": "禁对方主色" }
  ]
}
```

## 字段约束（防止注册表自身矛盾）

- `proportion_tier` 是**档位名**（`realistic` ／ `chinese-3d` ／ `anime-3d` ／ `anime-2d` ／ `chibi`），`proportion_range` 是该档位允许的**数值区间**。
- 每个角色的 `proportion` **必须落在 `proportion_range` 区间内**。写之前先核对——档位写 7.5、角色写 7 这种自相矛盾，是注册表最难发现的错误。
- `palette[].hex` 必填，不允许只有 `name`。
- **`durable` 只存持久事实，不存情绪与瞬时状态**。判断标准：这个特征在下一场戏还会成立吗？会 → durable；不会（表情、姿态、伤口、湿衣、持物）→ transient，出图时临时附加，**不回写**。把情绪写进 durable 是跨场次穿帮的隐蔽来源——因为情绪是按场次变的，它会污染所有后续场次。
- `lock_matrix` 里每一对，两个版本的 `lock_out` **都要**写上对方特征（单向加锁等于没加锁）。
- **场景条目与光照锚点**在 `references/场景资产与时间线光照.md` 第七节定义（`lighting_anchors` + `scenes`），与本文档的 `characters` / `props` 同属一个 JSON 文件，合并落盘。
  - `lighting_anchors` 是**项目级**的，全场景共用；改一个时段的数值，所有场景的该时段变体都要复核。
  - 场景的时段变体本质就是多版本，同样适用双向加锁规则（见「冲突解决规则」第 3 条）。

## 读写时机（硬规则）

| 时机 | 动作 |
|---|---|
| 任务开始（Step 0） | 读取注册表；扫 `reference_files` 指向的图；列出已有条目编号 |
| 生成提示词时 | 身高、色值 HEX、互锁词**只从注册表取**，禁止现场编造 |
| 场景任务（Step 2.5） | 读 `lighting_anchors` 取该时段色温/入射角/影子/人工光；读该场景 `light_port`（`fixed` 不得改）；读 `baseline_time` 复用基准版陈设 |
| 任务结束（Step 6.12） | 每个条目回写注册表，含 `outputs` 路径 |
| 新增版本时 | 同步更新 `lock_matrix`，并把新版本特征加进旧版本的 `lock_out` |

## 冲突解决规则

注册表中已存在的值与用户新给的描述冲突时，**不要静默覆盖，也不要静默沿用**——列出来问用户。三种典型：

1. **身高冲突**：注册表 165cm，用户说"她应该更高"→ 问清楚是改设定还是笔误。改了身高，所有同框角色的构图关系都要复核。
2. **色值冲突**：同一角色不同批次色名相同但 HEX 不同 → 以**首次注册值**为准，除非用户明确要求改色；改色必须同步更新所有已出图条目。
3. **版本新增**：新增版本 B 后，必须回头给版本 A 的 `lock_out` 加上 B 的特征。只给 B 加锁、忘了给 A 加锁，是串版最常见的原因。

## 易错点

- **拆分后编号失效**：条目拆分会让其他条目里的交叉引用编号过期。回写注册表后，全包检索旧编号改为当前实际编号。
- **slug 不稳定**：`character_slug` 一旦注册就不再改（改名会让 `reference_files` 和已有图全部失联）。要改名就在 `display_name` 上改。
- **只写不读**：最危险的失败模式是每轮都写注册表但从不读。Step 0 的读取是强制项。
