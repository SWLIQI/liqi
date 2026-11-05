# 镜头表字段 Schema

`shot_list.mjs` / `check_lens.mjs` 的输入是一个 JSON 对象：

```json
{
  "title": "雨夜巷口",
  "ratio": "16:9",
  "shots": []
}
```

## 一、顶层

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | 否 | 项目/场名 |
| `ratio` | string | 否 | 画幅，如 `16:9`；不写不校验 |
| `shots` | array | 是 | 非空镜头数组 |

## 二、单镜字段

| 字段 | 类型 | 必填 | 取值 / 说明 |
|---|---|---|---|
| `id` | string | 是 | 镜号，表内唯一 |
| `scene` | string | 是 | 场名；轴线连续性按场分组 |
| `segment` | string | 是 | 段名；C1（每组三件套）按段分组 |
| `shot_size` | string | 是 | 9 档之一：大远景/远景/全景/中全景/中景/中近景/近景/特写/大特写 |
| `angle` | string | 是 | 平视/俯拍/仰拍/大俯角/大仰角/侧 45°/侧面/过肩/荷兰角/主观视角 |
| `fov_deg` | number | 是 | 135/107/84/47/29/18/8 之一；只作选型，正文写视觉结果 |
| `perspective` | string | 否 | 广角/标准/长焦；写了必须与 `fov_deg` 一致 |
| `move` | string | 是 | 7 词表：固定/横移/缓推/后拉/跟拍/缓降/微推 |
| `duration` | number | 是 | 2–15 秒；H3 面另按 4–15 秒 |
| `light` | string | 是 | 顺光/侧光/侧逆光/逆光/顶光/底光 |
| `light_source` | string | 是 | 物理光源，如「巷口路灯」「窗外月光」 |
| `light_ratio` | string | 否 | `1:4` 这种格式；缺省给 WARN |
| `people` | number | 是 | 本镜在场人物数，≥1 的整数 |
| `task` | string | 是 | 三任务之一：改变人物情绪/实质推进动作/施加戏剧压力 |
| `subject` | string | 是 | 主体 |
| `action` | string | 是 | 动作 |
| `visual` | string | 是 | 可见结果句（景别/透视/景深/光的结果写在这里） |
| `subject_type` | string | 否 | 人物/物件，默认人物；Q1 只把人物特写计入分子 |
| `axis` | string | 多人物必填 | 谁在画面左、谁在右；必须含「左」和「右」 |
| `axis_side` | string | 多人物必填 | 左/右/轴上；本镜机位在轴的哪一侧 |
| `cross_axis` | string | 跨轴必填 | 中性镜/运动镜/插入特写/重新建轴 |
| `composition` | string | 否 | 开场 ECU 两极对冲/中心对称天地立极/剪影轮廓光/极端体量对比 |
| `technique` | string | 否 | 重技法：滑动变焦/环绕/Snorricam/鱼眼/升降/摇臂/POV；Q11 按此计数 |
| `jump_declared` | boolean | 否 | 本镜允许极限景别跳跃；S21 豁免 |
| `reverse` | boolean | 否 | 是否反打镜；语义匹配仍要人看 |
| `prompt_en` | string | 否 | 可选英文提示句；同样会扫抽象词 |

## 三、写法示例

```json
{
  "id": "03",
  "scene": "巷口",
  "segment": "段1",
  "shot_size": "特写",
  "angle": "过肩",
  "fov_deg": 29,
  "move": "缓推",
  "duration": 4,
  "light": "侧逆光",
  "light_source": "巷口路灯",
  "light_ratio": "1:4",
  "people": 2,
  "task": "改变人物情绪",
  "subject": "沈知微与黑影",
  "action": "停步，回头",
  "visual": "主体占画面六成以上，背景只剩色块与光斑，雨珠挂在伞骨上",
  "axis": "沈知微在画面左三分之一（西侧），黑影在右三分之一（东侧），隔雨帘相望",
  "axis_side": "左",
  "subject_type": "人物",
  "jump_declared": true
}
```

## 四、命令

```bash
node scripts/check_lens.mjs examples/shot-list-good.json
node scripts/shot_list.mjs examples/shot-list-good.json
node scripts/shot_list.mjs examples/shot-list-good.json --md
node scripts/shot_list.mjs examples/shot-list-good.json --json
```

`check_lens` 通过不代表语义正确：轴线对不对、表演装不装得下、Q2 常规机位占比，仍需人看。