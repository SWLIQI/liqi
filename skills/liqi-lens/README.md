# liqi-lens · 镜头表与光专精包

把一场戏拆成可执行镜头表：**景别 / 角度 / 视角 / 光位 / 光比 / 轴线 / 时长 / 三任务**。
输出可直接投喂的镜头卡，并机检轴线与可算的分镜配额（Q2 常规机位需人工）。

从 [liqi-video-forge](https://github.com/SWLIQI/liqi) v6.19.8 的视听层、光学块、轴线规则与配额规范抽出，不依赖主包。

## 运行前提

- Node.js ≥ 16（ESM，脚本为 `.mjs`）；零第三方依赖
- 全部文件名 ASCII，解压后跨平台一致
- Windows 控制台中文乱码时先执行 `chcp 65001`

## 输入处理

- 镜头表只在本地读取；`check_lens` / `shot_list` 只写 stdout，不上传、不落盘。
- `check_sync` 会打印主包绝对路径，属于本地信息，不随包外传。

## 快速开始

```bash
node scripts/check_lens.mjs examples/shot-list-good.json
node scripts/shot_list.mjs examples/shot-list-good.json
node scripts/shot_list.mjs examples/shot-list-good.json --md
node scripts/check_lens.mjs examples/shot-list-bad.json
npm test
```

## 镜头表

输入是一个 JSON：

```json
{
  "title": "雨夜巷口",
  "ratio": "16:9",
  "shots": [
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
      "subject_type": "人物"
    }
  ]
}
```

完整字段表见 `references/06-shot-table.md`。

## 输出

`shot_list` 默认输出镜头卡：

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

完整卡/表见 `examples/shot-cards.txt` 与 `examples/shot-table.md`。

## 机检什么

- 三任务缺失、9 档景别、角度、7 档视角、7 词运镜、2–15 秒
- 光位、物理光源、光比格式
- 多人镜轴线/左右/机位侧；同场景上一个多人镜跨轴必须有 `cross_axis`
- Q1/Q3/Q4/Q5/Q6/Q7/Q8/Q9/Q10/Q11 与 C1、S21、S22
- 具名复合镜头、抽象词（电影感/高级感/cinematic 等）

## 机检不查什么

- **Q2 常规机位占比**：数据模型没有「正面/过肩」字段，不硬算
- 轴线语义对不对、表演装不装得下、构图好不好：需人看
- 镜数不到门槛时 Q1/Q3/Q4/Q8/Q9 会写「本门未查」，**未查 ≠ 通过**

## 黄金输出守卫

`npm test` 会先跑 `selftest.mjs`，再跑 `check_golden.mjs`：把 5 个脚本输出与 `selftest-output.txt` 逐行比对。改脚本后必须同步更新 `examples/`，否则 test 会失败。

## 常见问题

- **6 镜为什么 Q9 是「未查」？** Q9 要 ≥8 镜才统计；统计时要求 ≥4 种运镜（本包 7 词表上限 7，主包口径 8 在本包不可达，已适配）。
- **轴线怎么查？** 同场景的「上一个多人镜」比较 `axis_side`；轴变了必须有 `cross_axis`（中性镜/运动镜/插入特写/重新建轴）。单人镜不建立轴线。
- **`move` 和 `technique` 有什么区别？** `move` 是 7 词表；滑动变焦/环绕/Snorricam 等重技法放 `technique`，Q11 单独计数。
- **光比没写会怎样？** 只 WARN，不拦；但镜头卡会少一行。
- **能直接投喂吗？** 镜头卡里的「画面」和可选 `prompt_en` 就是投喂正文；结构标签给人看。
- **主包不在怎么同步？** `check_sync` 返回 SKIPPED 并明确跳过 ≠ 通过。
- **5 个上游哈希怎么核验？** 本包不带上游文件；把主包 v6.19.8 放旁边，跑 `node scripts/check_sync.mjs <主包目录>`，应显示全部一致。

## 目录

```
SKILL.md                          说明与工作流
lens-vocab.json                   景别/视角/光位/配额/禁用词
references/01-shot-grammar.md     三任务、调度、剪辑、反形容词、构图
references/02-optics.md           景别九档、透视、景深、视角、防漂移
references/03-light-and-axis.md   光源、防冷光、轴线、跨轴、反打
references/04-quota.md            11 项配额与 S 码
references/05-performance-optional.md  三态/呼吸/视线/一处微变化
references/06-shot-table.md       镜头表字段 Schema
scripts/check_lens.mjs            校验镜头表
scripts/shot_list.mjs             生成镜头卡 / 表 / JSON
scripts/check_sync.mjs            与主包比对 5 个哈希
scripts/check_golden.mjs          黄金输出逐行 diff
scripts/selftest.mjs              57 条自测
examples/                         合格/不合格样例与输出
```

## 边界

不做风格、角色、剧本叙事；不重复 `liqi-move` 的 24 条场型骨架。
轴线跨镜检查只覆盖镜头表内同场景的上一个多人镜，台账级逐镜比对仍需人。

## 许可

MIT。5 份来源来自 liqi-video-forge v6.19.8（MIT），详见 `THIRD-PARTY-NOTICES.md`。