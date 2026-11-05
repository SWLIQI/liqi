# 资产注册表（asset-registry.json）

## 为什么要有这个东西

会话记忆会丢，注册表不会。没有注册表时，每一轮新会话都在重新编造身高、色名、版本互锁词——**跨批次穿帮的头号来源**。这是本 skill 与外部同类 skill 最大的能力差距所在，也是补齐优先级最高的一项。

注册表是**唯一事实源（single source of truth）**。提示词只是它在某一刻的投影。

## 落盘位置

按以下顺序定位，找到即用，找不到就在第一顺位新建：

1. 项目内已有资产目录（`characters/`、`assets/`、`设定/`）
2. 与输入参考图同目录
3. 项目根目录

文件名固定 `asset-registry.json`。

## Schema

```json
{
  "project": "示例项目",
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
      "role": "示例角色",
      "entry_no": "1",
      "reference_files": ["characters/character-a-ref.png"],
      "softspot": "props/lie-toukui",

      "identity_verdict": "new_asset",
      "durable": {
        "age_appearance": "外表20岁",
        "height_cm": 165,
        "proportion": "7头身",
        "face_anchor": "严格沿用参考图片全部五官样貌；全黑瞳孔无眼白；乌黑柔顺长直发；皮肤苍白半透，表面干燥无油光",
        "marks": ["长在身上的标志物、义肢、发簪、痣——跨场次成立的持久事实"]
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
      "category": "key",
      "identity_verdict": "reuse",
      "material": "清代黄麻纸竖幅",
      "scale_phrase": "摊开约两个手掌大小、可单手托起的竖幅",
      "scale_cm": "纸高约40cm",
      "state_arc": {
        "current": "展开可读态",
        "other_states": ["卷起封存态"],
        "rule": "每个要跨镜复用、且影响识别或交接的态各出一张卡（18A/18B 走版本互锁）；场景的结构性破损同样建态，走 scenes.*.damage_states（v5.6.8）"
      },
      "durable": { "material_fact": "黄麻纸、朱红官印、无五官人影图形——跨场次成立的形制事实" },
      "transient": { "_rule": "只登记会跨场次变化的状态（开合、破损、内容物、持有人）。按场次临时附加，不回写进 durable" },
      "palette": [
        { "name": "麻黄", "hex": "#D9C89A", "part": "纸" },
        { "name": "朱红", "hex": "#C1382E", "part": "印泥" }
      ],
      "lock_out": ["现代纸张", "打印感", "乱码错字"],
      "timeline": "全片",
      "outputs": { "md": "props/haibu-wenshu.md", "png": "props/haibu-wenshu.png" }
    },

    "chuan-yuyi-de-ren": {
      "display_name": "穿雨衣的人",
      "entry_no": "22",
      "identity_verdict": "unresolved",
      "_why_unresolved": "S03 只写「穿雨衣的人推门进来」，S07 才被叫出姓名。证据不足以判定与 S07 是否同一人。",
      "identity_unresolved": {
        "candidates": ["character-a（与 S07 同人：雨衣颜色一致）", "新人物（体型与步态与 S07 不同）"],
        "missing_evidence": ["S03—S06 无面部或体型描写", "S07 未回收雨衣这一服饰线索", "无剧本动作可以交叉指认"],
        "impact": "若在 S07 前出图，等于替剧本决定了一名角色的脸；一旦固化成参考图，S07 起的全部镜都要返工",
        "unblock_when": "拿到 S07 的指认台词，或用户确认合并/分列"
      },
      "durable": { "material_fact": "深蓝胶布雨衣，兜帽遮住面部，身形偏瘦——仅此三项是剧本给出的，其余一律不发明" },
      "lock_out": ["清晰面部", "可辨认五官", "任何具体年龄与发型"],
      "timeline": "S03 出现；判定未决，S07 前不得出图"
    }
  },

  "creatures": {
    "qingluan": {
      "display_name": "青鸾",
      "entry_no": "23",
      "identity_verdict": "new_asset",
      "species_phrase": "比成年男子略高的大型禽类，翼展近两人臂长",
      "scale_cm": "站高约 150cm，翼展约 260cm",
      "durable": { "material_fact": "青灰覆羽、尾羽末端泛白、喙与爪呈角质深黄——跨场次成立的形制事实" },
      "versions": {
        "A": {
          "codename": "收羽栖止态",
          "lock_out": ["展翼", "飞行姿态", "羽色发亮"],
          "outputs": { "md": "creatures/qingluan-a.md", "png": "creatures/qingluan-a.png" }
        }
      },
      "palette": [
        { "name": "青灰", "hex": "#6E7773", "part": "覆羽" },
        { "name": "角质黄", "hex": "#8A7550", "part": "喙与爪" }
      ],
      "lock_out": ["哺乳动物形态", "拟人化表情", "卡通比例"],
      "timeline": "M4 起"
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
- **`creatures` 是第四类桶**（v5.6.8 补出）：`audit_project.py` F 门自 v5.6.2 起就按 characters → props → creatures → scenes **四桶**查找，但本文档此前**零提及**，怪物/坐骑/灵兽类资产无处登记（实战里被塞进 `characters`，与人物混用同一套约束）。
  判据：**有持续身份、跨镜复用、需要一致性锁定的非人物活体**放这里；一次性出现的动物（背景里的羊群、路人牵的狗）作布景，不建条目。
  字段同 `characters`（`identity_verdict` / `durable` / `versions` / `palette` / `lock_out` / `outputs`），另加 `species_phrase` 与 `scale_cm`——用途与道具的 `scale_phrase` 相同：防 AI 把坐骑画成宠物尺寸。示例见上方 `qingluan`。
- **`scenes` 也要填 `identity_verdict`**（v5.6.8 统一）：场景是 5.5 去重键的作用对象（同地点同时段一张卡 vs 不同地理/入口建新卡），**场景身份判错正是"同一地点被建成两个场景"的直接成因**，这里缺判定比 characters 更危险。此前本文档没要求、示例没给、实战却在填，三方打架，现统一为必填。
  `durable` 里的 `marks` 才是资产层第七节说的「`durable` 标志物清单」——跨场次成立的标志物（长在身上的标志物、义肢、发簪、痣），其余持久事实（年龄感、身高、头身、面部锚）是同层的兄弟字段，不是标志物。
- **`category` 道具分类（v5.20.0 新增）**：`key` 关键道具（受单集 1-3 / 系列 ≤8 口径）/ `softspot` 软肋物（不占关键道具额度，按主要角色各 1 配置）。见 `资产层_锁定与一致性.md` §5.4b。
- **`characters.*.softspot`（v5.20.0 新增）**：指向 props 桶条目 slug，记该角色的软肋物。F8 门双向核查（指向空 / 分类错写 / 孤物）。
- **`identity_verdict` 记身份判定结果**（v5.1.0，资产层第五节 5.3）：`reuse` 复用 / `new_variant` 新变体 / `new_asset` 新资产 / `unresolved` 未决。**`unresolved` 的条目禁止带默认 ID 进 4 View 出图**——错误身份一旦被固化成参考图，返工是全线的。`characters` / `props` / `creatures` / `scenes` **四类桶都要填**（v5.6.8 统一：`creatures` 是 `audit_project.py` 的合法第四桶，此前文档漏写；`scenes` 此前文档没要求、示例没给、实战却在填，三方打架，现统一为必填）。判定时按「六问 + 四态」先记出现再判身份。
  - **只认英文四值**，写中文「未决」、`unknown`、`new_varient` 一律不合法——`audit_project.py` F 门的 F5 会报 ERROR（v5.6.8）。
  - **每个新条目都要重新判定，不沿用上一条的值**。字段被默认值化（一律 `new_asset`）会让整条判定链失效：F 门只查形式不查内容，**不会**提醒你"这条其实该判 reuse"。
  - **`unresolved` 的三要素有专门容器**（v5.6.8 补出）：5.3 要求未决条目「列候选、缺失证据与影响」，此前 schema 里**没有地方写**——只能塞进 `_` 开头的说明键，而说明键被机械层显式跳过。现在用 `identity_unresolved` 块，四键：`candidates`（候选身份）/ `missing_evidence`（缺什么证据）/ `impact`（判错的返工面）/ `unblock_when`（什么条件下解锁）。`identity_verdict == "unresolved"` 时建议填。
  - **未决条目不得写 `outputs`**。判据是纯字段组合，`audit_project.py` F 门的 F6 会报 ERROR（v5.6.8）。已落盘的图要么删除、要么改挂到 `identity_unresolved.candidates` 下——留着会被 B 门当成合法资产锚，反向坐实错误身份。示例见上方 `chuan-yuyi-de-ren`（`unresolved` 且无 `outputs`）。
- **道具的两个新字段**（v5.2.0）：`scale_phrase` 是可念的尺度短语（手掌大小 / 齐腰高 / 单手持握），与 `scale_cm` 数值并存——前者防 AI 把手持道具画成家具尺寸，后者供人工核对；`state_arc` 记该道具承担哪个态、还有哪些态要另出一张卡。
- `lock_matrix` 里每一对，两个版本的 `lock_out` **都要**写上对方特征（单向加锁等于没加锁）。
- **场景条目与光照锚点**在 `references/场景资产与时间线光照.md` 第七节定义（`lighting_anchors` + `scenes`），与本文档的 `characters` / `props` 同属一个 JSON 文件，合并落盘。
  - `lighting_anchors` 是**项目级**的，全场景共用；改一个时段的数值，所有场景的该时段变体都要复核。
  - **`lighting_anchors.<时段>.label` 是有下游用途的，不能省**（v5.6.3）：`audit_project.py` 的 C2 门（场景时段漂移）靠它把提示词里的「正午 / 黄昏 / 深夜」认成时段名，再拿该时段 `variants.<时段>.lock_out` 检查串版。**缺 `label` 时门退化为认英文时段键**（`noon` / `dusk`），而提示词里通常写中文，等于这门白开。
  - 场景的时段变体本质就是多版本，同样适用双向加锁规则（见「冲突解决规则」第 3 条）；**且每个变体的 `lock_out` 要覆盖其余所有变体的标志性特征**，否则 C2 门查不全。
  - **`scenes.<slug>.damage_states`：第三类漂移的登记处**（v5.6.7 补出，见本节末「三类漂移」）。时段变体（`variants`）回答"几点"，**状态变体（`damage_states`）回答"被事件改成什么样"**——墙被撞穿、血迹、灰烬、撕裂、烧毁都归这里。它与 `variants` 是**并列**的两套，可能同时存在（一个场景既有 `variants.night` 又有 `damage_states.wall_breach`），不要合并进一个桶。
    每条状态写 `label` / `applies_to`（适用于哪几镜）/ `delta`（改了什么）/ `invariant`（什么**不许**跟着变）/ `lock_out` / `outputs`。
    **`damage_states` 不填 `identity_verdict`**（v5.6.8 明写）：它是**状态变体容器**，承载的是"同一场景被改成了什么样"，不是新身份——「这个破口该不该另建一个场景条目」由场景条目自己的 `identity_verdict` 回答，不在状态层重复判定。F 门的 F4/F5 也**不检查** `damage_states` 内部。**`lock_out` 必须写，且两态互锁**——`audit_project.py` 的 F 门从 v5.6.7 起把 `damage_states` 与 `versions` / `variants` 合并取桶做双向校验，缺 `lock_out` 会直接报 ERROR。
  - **`scenes.<slug>.alt_views`：高频场景的备用机位版登记处**（v5.38.2 新增，规则见 `场景资产与时间线光照.md` §2.9）。**第四个视角轴**：`variants` 回答「几点」、 `damage_states` 回答「被改成什么样」、`alt_views` 回答「高频镜次从哪个机位看」—— 场景镜次 >3 时触发，图生图基于主版本三阶产出机位不同的多视角图，每条写 `label`（备用机位版）/ `applies_to`（适用镜次编号）/ `base`（图生图基准产物名）/
 `angle_delta`（机位差异）/ `outputs`。**不填 `identity_verdict`、不设 `lock_out`**： 备用版与主版本是**叠加**关系不是互斥关系（主版本照常服务其余镜次），也不是新身份—— F 门的 F2/F4/F5 **不检查** `alt_views` 内部（该桶不参与版本互锁与身份判定）。
    `invariant` 是关键：破口态只改墙那一处，承重柱数量、窗洞位置、陈设位置、光位全部不变——不写清"什么不许变"，出图时模型会把整个场景重画一遍。

### 三类漂移（v5.6.7 显式化）

| 类别 | 查什么 | 登记处 | 由哪个门查 |
|---|---|---|---|
| 第一类：版本漂移 | 角色/道具的服装、形态、版本互锁 | `characters.*.versions` / `props.*.state_arc` | C 门 |
| 第二类：时段漂移 | 场景的光照时段（正午/黄昏/深夜） | `scenes.*.variants` | C2 门 |
| **第三类：状态漂移** | **事件造成的物理改变**（破口/血迹/灰烬/撕裂/烧毁） | **`scenes.*.damage_states`** | **F 门（双向 lock_out）＋ 人工核对承接** |

第三类此前无处登记，只能混进 `variants` 或干脆不登记。**不登记的后果是：下一镜的参考图仍然指回未破坏的状态，画面凭空复原**——观众一眼看出穿帮，而现有门禁一条都不报。
判据：**凡「上一镜发生的事件改变了场景或物体的物理状态」，就必须在 `damage_states` 开一条，并让后续所有镜的【参考素材职责】指向它的图。** 致变事件与承接镜之间不得有任何一个镜用回完好态的图。

## 读写时机（硬规则）

| 时机 | 动作 |
|---|---|
| 任务开始（Step 0） | 读取注册表；扫 `reference_files` 指向的图；列出已有条目编号 |
| 生成提示词时 | 身高、色值 HEX、互锁词**只从注册表取**，禁止现场编造 |
| 场景任务（Step 2.5） | 读 `lighting_anchors` 取该时段色温/入射角/影子/人工光；读该场景 `light_port`（`fixed` 不得改）；读 `baseline_time` 复用基准版陈设 |
| 任务结束（Step 6.12） | 每个条目回写注册表，含 `outputs` 路径 |
| 新增版本时 | 同步更新 `lock_matrix`，并把新版本特征加进旧版本的 `lock_out` |
| **发生致变事件时**（撞穿/烧毁/流血/撕裂） | **在 `damage_states` 开一条状态**，并让后续所有镜的【参考素材职责】指向它的图——漏了就是"凭空复原" |

## 冲突解决规则

注册表中已存在的值与用户新给的描述冲突时，**不要静默覆盖，也不要静默沿用**——列出来问用户。三种典型：

1. **身高冲突**：注册表 165cm，用户说"她应该更高"→ 问清楚是改设定还是笔误。改了身高，所有同框角色的构图关系都要复核。
2. **色值冲突**：同一角色不同批次色名相同但 HEX 不同 → 以**首次注册值**为准，除非用户明确要求改色；改色必须同步更新所有已出图条目。
3. **版本新增**：新增版本 B 后，必须回头给版本 A 的 `lock_out` 加上 B 的特征。只给 B 加锁、忘了给 A 加锁，是串版最常见的原因。

## 易错点

- **拆分后编号失效**：条目拆分会让其他条目里的交叉引用编号过期。回写注册表后，全包检索旧编号改为当前实际编号。
- **slug 不稳定**：`character_slug` 一旦注册就不再改（改名会让 `reference_files` 和已有图全部失联）。要改名就在 `display_name` 上改。
- **只写不读**：最危险的失败模式是每轮都写注册表但从不读。Step 0 的读取是强制项。
