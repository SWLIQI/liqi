# 风格注册表 style-registry.json（L0 · 多风格适配的事实源）

> 流程位置：Step 0（注册表初始化）与 Step 2（风格锚）之间。
> 上游＝锁③ 风格轨道选择；下游＝风格锚文件（L1）、SKILL.md 路由（L2）、校验脚本（L3）。
>
> 本文件是 **schema 与字段含义文档**。注册表 JSON 本体是**项目级文件**，落在使用本 skill 的项目目录里，
> 与 `asset-registry.json` 同级，不随 skill 分发——因为色值与角色数值是项目资产，不是 skill 资产。

---

## 一、为什么要有这一层

会话记忆会丢，注册表不会。没有它的时候，同一套风格在三个地方各写一遍：风格锚里写色值、资产注册表里写一遍、
提示词正文再写一遍——三处任何一次偏差就是跨批次色偏与串轨。

有了它，三处都回来查同一份数值。

**与 asset-registry.json 的分工**：

| | style-registry.json | asset-registry.json |
|---|---|---|
| 存什么 | 风格本身的数值与词表 | 项目里具体角色/道具/场景的数值 |
| 粒度 | 一套风格一条 | 一个资产一条 |
| 谁引用谁 | 被引用方 | 只存 `style_track` + `style_id` 两个引用字段，**不复制任何色值** |

**硬规则**：资产注册表里禁止出现风格色值的副本。需要色值时回查 style-registry 的 `palette`。
复制一次就等于埋一颗跨批次色偏的雷。

---

## 二、schema

```json
{
  "version": 1,
  "styles": {
    "<style-id>": {
      "display_name": "中文名",
      "track": "手绘轨",
      "dimension": "2D",
      "heads_range": "5.5-6.5",
      "stability": "险",
      "palette": {
        "primary": "#EDE7DE",
        "secondary": "#A9AFB5",
        "accent": "#A83A32",
        "usage": "primary 为底色/留白，accent 为全片唯一重音色"
      },
      "negative_direction": ["写实照片感", "3D 渲染", "赛璐璐粗描边"],
      "tech_spec": {
        "render_cn": "平面手绘，宣纸底，细匀墨线，平涂一次完成",
        "render_en": "A flat hand-painted picture on one plane, thin even ink outlines",
        "material_rule": "光不做塑造，每块区域从边到边同一明度"
      },
      "motion_pool": {
        "main": ["固定中景", "缓慢推近"],
        "limited": ["摇臂升起"],
        "forbidden": ["甩镜", "360 环绕"]
      },
      "material_budget": { "main": "面部与水痕晕染", "second": "衣料褶皱", "save": "远景群像" },
      "collapse_risks": [
        { "symptom": "出片 2.5D", "cause": "压句含 animation / 否定句", "fix": "换 picture，改正面陈述" }
      ],
      "dedupe_pairs": [
        ["2D animation", "picture"],
        ["glow", "flat warm wash"]
      ],
      "surface_notes": {
        "h3": "压句逐字复用，62 词；改前算 Δ，改完跑 check_prompt_h3.mjs",
        "seedance_2_5": "中文压句写在【生成目标】段首，配色句写在【主体与关系】风格内联",
        "cn": "负面词压成 Must not 一行附正文末"
      },
      "excludes": ["celshade-guoman-2d", "photoreal-pbr"],
      "ref_file": "references/水墨淡彩2D风格锚.md",
      "status": "已落值"
    }
  }
}
```

---

## 三、字段含义

未标「可选」的字段全部必填。

| 字段 | 含义与写法 |
|---|---|
| display_name | 中文名，写进交付物的风格声明 |
| track | 六条轨道：**卡通轨 / 写实轨 / 手绘轨 / 定格木偶轨 / 三渲二轨 / 平面工艺轨**（皮影 / 剪纸 / 折纸，当前挂的都是待建 id）。轨道决定负面词与技术规格的**大方向**，风格决定落值；枚举与 `SKILL.md` 锁③ 的轨道表、`风格路由表.md` 一致 |
| dimension | 2D / 3D / 平面工艺。决定能不能用体积光、能不能写横向视差 |
| heads_range | 头身比区间（写实 7–7.5；日式 2D 5.5–6.5；皮影 5；剪纸 4–5；Q 版 2–3；孩童在该档 −1.5~2）。**同包禁混档** |
| stability（可选） | 稳 / 中 / 险。长片一致性分级，供选型决策器排序。判据见《风格路由表》 |
| palette | Primary / Secondary / Accent 三色 HEX + usage 说明。场景色板另存，不进这里 |
| negative_direction | 负面词方向，≤16 项。按投放面分流：有 `negative_prompt` 字段的面整份填；无该字段的面压成 `Must not` 一行附正文末 |
| tech_spec | render_cn / render_en / material_rule 三项。这是投喂词里真正复用的句子源头 |
| motion_pool（可选） | 该风格允许的运镜子集。平面手绘禁环绕与横移视差；定格木偶禁丝滑运动模糊；皮影禁横移 |
| material_budget（可选） | 主 / 次 / 省三档。逐镜的「本镜保真预算」从这里派生 |
| collapse_risks | 崩点表。symptom / cause / fix 三元组，**最有用的一节**，按风格差异极大，禁止照抄别家 |
| dedupe_pairs（可选） | 「去立体 / 去写实」词对，供泛化后的 dedupe 脚本读。水墨要删 `glow`，赛璐璐不用删——这就是必须按风格分表的原因 |
| surface_notes（可选） | H3 / Seedance 2.5 / 国内面 各自的注意事项与压句语言 |
| 互斥 excludes | 互斥风格 id 列表，驱动串轨检测。**必须双向登记**（A 排除 B，B 也要排除 A） |
| ref_file（可选） | 对应 L1 风格锚文件名 |
| status（可选） | 已落值 / 待建 / 不入 |

---

## 四、首批种子数据（从现有两份风格锚抽取，阶段 1 落盘用）

> ⚠️ **本节只是 ink-wash-2d 与 gothic-puppet 两条的字段摘录示例，不是事实源。**
> L0 现在有 **9 条**已落值风格，全量数值一律看 `references/style-registry.seed.json`
> （或项目级 `style-registry.json`）。本节任何一行与 L0 有出入，都以 L0 为准并回来改这里。

### ink-wash-2d（水墨淡彩东方手绘 2D）

| 字段 | 值 | 来源 |
|---|---|---|
| track | 手绘轨 | 锚文件开头判定段 |
| dimension | 2D | 平面画，整幅压在一个平面上 |
| heads_range | 5.5–6.5（成人档；孩童 4–4.5，同包禁混档） | §一 第④段（阶段 1 补入，原锚缺失） |
| stability | 险 | 长片一致性排序里排名靠后 |
| palette | primary #EDE7DE（宣纸底）／secondary #A9AFB5（灰青衣物）／accent #A83A32（铜钱朱红，唯一重音色） | §三 色值表 |
| negative_direction | 写实照片感、3D 渲染、赛璐璐粗描边、塑料高光、渐变、体积光、可读文字、水印 | §一 第⑨段 |
| tech_spec.render_en | A flat hand-painted Chinese ink-and-wash picture on xuan paper, held on one plane. | §二 压句 |
| tech_spec.material_rule | 光不做塑造，每块区域从边到边是同一个明度 | §一 第⑦段 |
| motion_pool | main 固定中景/缓慢推近/横向平移/微俯/轻摇；forbidden 甩镜/溜溜球/斯诺瑞康姆/360 环绕/荷兰角/分屏 | §四 运镜池 |
| material_budget | main 面部与水痕晕染；second 衣料褶皱与发丝；save 远景群像与背景植被 | §五 |
| collapse_risks | 出片 2.5D、变 3D 渲染、变赛璐璐卡通、饱和度失控、表情被抹平、动作像橡皮糖 | §六（9 条，阶段 1 全量搬） |
| dedupe_pairs | 英文面：2D animation→picture；illustrated storybook→删；no rendered volume→Light is not modelled；glow→flat warm wash；横向平移→整幅同速率侧移。中文面另三条：**水墨动画/国漫→水墨淡彩画**（中文「动画」与英文 animation 是同一个路由开关）；不要渐变→光不做塑造；暗部提亮/降饱和→从正文删除只留参数行 | §9.1 五个来源 + §2.2 中文面纪律表 |
| excludes | 8 项：gothic-puppet、photoreal-pbr、celshade-guoman-2d、npr-celshaded-3d、stylized-pixar-3d、anime-2d、webtoon-2d、documentary-live-action | 手绘平面与一切体积感方向互斥；**完整清单以 L0 `excludes` 字段为准，本行是摘录** |
| ref_file | references/水墨淡彩2D风格锚.md | — |
| status | 已落值（十节 schema 已改造，2026-10-10） | — |

### gothic-puppet（哥特定格木偶）

| 字段 | 值 | 来源 |
|---|---|---|
| track | 定格木偶轨 | 锚文件开头判定段 |
| dimension | 3D（实体微缩实拍） | 有真实光影与景深 |
| heads_range | 1:3.5–1:4.5（头大身细） | §一 第④段、§八 角色表 |
| stability | 中 | 顿挫感是特征，需专门手法维持 |
| palette | primary #1E2630（深夜蓝阴影）／secondary #7C93A8（月光冷蓝）／accent #D08A4E（灯笼暖橙，唯一重音色） | §三 色值表 |
| negative_direction | 皮克斯风、迪士尼风、光滑 CGI 渲染、写实真人、真实人体解剖、动漫风、高光镜面反射、运动模糊、可读文字、水印 | §一 第⑨段 |
| tech_spec.render_en | A Gothic Victorian stop-motion puppet film, a handcrafted dark fairytale shot as real miniature set photography with visible handmade textures. | §二 压句 |
| tech_spec.material_rule | 每一处都保留轻微的定格动画不完美；不用丝滑运动模糊 | §一 第①③段 |
| motion_pool | main 固定中景/缓慢推近/低角度仰拍/微俯/横向平移；limited 荷兰角；forbidden 甩镜/溜溜球/360 环绕/分屏 | §四 运镜池 |
| material_budget | main 面部黏土质感与手工痕迹；second 布料做旧与微缩布景痕迹；save 远景群像与天空 | §五 |
| collapse_risks | 变光滑 CGI、变写实真人、运动太顺滑、动漫化三渲二、色彩变鲜艳、布景变真实大小、表情过度灵活、暖光扩散污染 | §六（9 条） |
| dedupe_pairs | **反向表**：丝滑/流畅/连续动作→二拍一顿挫、起收各留半拍静止；运动模糊→删除；高光/镜面反射/次表面散射/辉光→每个材质词后跟「哑光不反光」；真实人体解剖/肌肉/真实五官比例→木偶比例 1:3.5–1:4.5；辽阔/实景/真实世界尺度→微缩模型痕迹；温暖的光照亮房间→暖光只照亮相邻一小圈；细腻皮肤动态→眉/嘴角/眼睑大位移 | §9.1（阶段 1 正式登记） |
| excludes | 5 项：ink-wash-2d、photoreal-pbr、celshade-guoman-2d、npr-celshaded-3d、stylized-pixar-3d | 与写实轨材质词汇互斥；与手绘轨方向相反；赛璐璐与三渲二会抹掉手作痕迹；**完整清单以 L0 `excludes` 字段为准，本行是摘录** |
| ref_file | references/哥特定格木偶风格锚.md | — |
| status | 已落值（十节 schema 已改造，2026-10-10） | — |

---

## 五、维护纪律

1. **新增风格先落注册表再写风格锚**。反过来做，锚写完了才发现色值与别家撞车。
2. **改色值改两处**：`style-registry.json` 的 palette 与 L1 锚文件的色值表。改完必须同步，否则下游查到两套数。
3. **互斥必须双向登记**。单向登记会让串轨检测漏一半。
4. **`dedupe_pairs` 不能跨风格复用**。水墨的删词表套到赛璐璐上会把描边和两段式阴影当成污染删掉。
5. **`status` 为「待建」的风格可以被路由表指向，但不得直接写进交付物**——想用就先按 `references/风格锚_模板.md` 十节现场落值，落完把 `status` 改成「已落值」并补 `ref_file` 再引用。未落值就引用是 P0 级错误。
6. 每轮产出后回写：本轮用过哪些风格、有没有新增互斥对、有没有发现新崩点（新崩点直接进 `collapse_risks`）。

---

## 六、种子 JSON 的落盘位置

注册表的 **JSON 本体是项目级文件**，与 `asset-registry.json` 同级，不随 skill 分发
（色值与角色数值是项目资产，不是 skill 资产）。

skill 侧只提供种子文件：`references/style-registry.seed.json`。

**项目初始化做法**：项目目录里第一次用到多风格时，把种子文件复制成
`<项目>/style-registry.json`，然后按项目实际用到的风格**增删条目**——
不要留着用不上的风格，留着会让串轨检测报一堆假阳性。

```
cp <skill>/references/style-registry.seed.json  <项目>/style-registry.json
```

复制后必须做两件事：

1. 把本项目用不到的风格条目删掉（或把 `status` 改成 `不入`）。
2. 逐条核对 `palette` 与 L1 锚文件色值表一致——**改一处要同步另一处**。

`celshade-guoman-2d` 已落值（`风格锚_国漫赛璐璐2D.md`），可正常引用。
历史遗留：本文件早期曾把它写成 `status: 待建` 的占位条目，与种子文件和路由表冲突，
现已统一为「已落值」。**以种子文件的 `status` 字段为准，文档描述落后时按字段走。**

