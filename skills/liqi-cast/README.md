# liqi-cast · 角色一致性专精包

给一个角色设定，产出可直接投喂的 **4 View 资产板**提示词，并机检五官 10 项、服装 6 项、身高、色板与版本互锁词。

从 [liqi-video-forge](https://github.com/SWLIQI/liqi) v6.19.8 的资产层抽出来，只保留"让同一张脸在几十个镜头里不漂"这一件事，**不依赖主包、不依赖三锁**。

## 它解决什么

同一角色出现在 ≥2 个镜头时，最常见的三种崩法：

1. 三视图脸不一样 —— 因为拿全身图当参考，脸只有 285–320 px，模型读不清只能现编
2. 服装塑料感 —— 因为只写了"棉麻长衫"，没写纹理、垂坠、扣具
3. 换装后换了个人 —— 因为没有版本互锁，两版的负面词互相不排斥

这个包把这三件事变成可执行的检查。

## 安装

把整个 `liqi-cast` 目录放进你的 skills 目录即可（目录名要与 `SKILL.md` 的 `name` 一致）。
不需要 Node 之外的依赖；Node ≥ 16。压缩包内路径全部为 ASCII，Windows / macOS / Linux 解压后一致。

> Windows 控制台若中文输出乱码，先执行 `chcp 65001` 切到 UTF-8 代码页。

## 用法

```bash
# 校验设定是否够完整（缺项列出具体字段）
node scripts/check_cast.mjs examples/cast-good.json

# 生成 4 View 提示词块（加 --check 附带 16 项清单与九问）
node scripts/cast_sheet.mjs examples/cast-good.json --check

# 自测：28 条，覆盖合格 / 不合格 / 类型异常 / 边界规则
npm test        # 或 node scripts/selftest.mjs
```

## 输入

完整字段与类型约束见 `examples/cast.schema.json`；可直接复制的合格样例见 `examples/cast-good.json`。
必填：`name`、`gender`、`age_range`、`height_cm`、`face`（10 项）、`wardrobe`（6 项）、`palette`（≥3 项，建议带中文色名）。

## 英文覆盖（可选）

默认把中文字段原样拼进提示词。若你的模型对中文描述偏弱，可在 JSON 里加同名英文块：

- `face_en`：对应 `face` 的十个字段
- `wardrobe_en`：对应 `wardrobe` 的六个字段
- `interlock_en`：对应某个版本的 `interlock`

示例：

    "face_en": { "bone": "cold oval face, high cheekbones" },
    "wardrobe_en": { "fabric": "heavy twill cotton-linen" },
    "interlock_en": ["blood stains", "bandages", "torn hem"]

有英文就用英文，没有就回落中文；不必全部提供。

## 输出

骨架见 `SKILL.md`，完整全文见 `examples/expected-output.txt`；不合格样例的预期报错见 `examples/expected-bad-output.txt`。
`--check` 会在提示词后追加 16 项清单、性别锚点、身高线、色板与出图前九问。

## 目录

```
SKILL.md                              说明与工作流
references/01-layout-and-levels.md    什么时候建链、左25%/右75%、像素账
references/02-text-locks.md           五官 10 + 服装 6 + 性别锚点 + 身高 + 色板
references/03-version-interlock.md    版本拆分、出现四态、身份四选一
references/04-feeding-and-rework.md   三条投喂铁律、九问、常见崩法
examples/cast-good.json               合格样例
examples/cast-bad.json                不合格样例
examples/cast.schema.json             输入字段 JSON Schema
examples/expected-output.txt          合格样例完整输出
examples/expected-bad-output.txt      不合格样例预期报错
examples/selftest-output.txt          28/28 自测输出
scripts/cast_sheet.mjs                设定 → 提示词块
scripts/check_cast.mjs                只校验不生成
scripts/selftest.mjs                  28 条自测
scripts/check_sync.mjs                与主包比对哈希，检测规则过期
SYNCED.json                           来源文件哈希与主包版本
```

## 常见问题

- **右区能不能画脸？** 不能。保头无脸；画了会和左区打架。见 `references/01-layout-and-levels.md` 硬约束 4。
- **只有一个镜头要不要建？** A0 / A1 不建，直接写提示词。见 `references/01-layout-and-levels.md`。
- **换装算新角色吗？** 不算，拆变体；持续身份变了才算新资产。见 `references/03-version-interlock.md`。
- **互锁词写中文还是英文？** 都能跑；英文更稳，用 `interlock_en`。见 `references/02-text-locks.md`。
- **身高不知道怎么办？** 先定再出卡；`height_cm` 是必填。见 `references/02-text-locks.md`。
- **自测都查什么？** 28 条：合格输出、不合格拦截、类型异常不抛栈、互锁词边界、同步跳过语义。

## 边界

- **不做**：剧本、分镜、风格选择——那是主包与其他专精包的事
- **不做跨集台账**：版本互锁只覆盖单个角色内的变体，跨集复用仍按主包台账人工管理
- 机检只查结构（互锁词非空、不自我矛盾、两版不雷同），语义上的「互斥」仍需人判断
- **不承诺**一次出图就完美；这套东西的价值是**可复现**
- 单张插图、不需要跨镜一致性的活，不要用（版式成本不划算）

## 许可

MIT。内容改编自 liqi-video-forge v6.19.8（同为 MIT），详见 `THIRD-PARTY-NOTICES.md`。
