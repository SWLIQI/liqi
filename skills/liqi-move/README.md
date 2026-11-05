# liqi-move · 运镜专精包

8 个场型 × 3 条镜头骨架（景别机位 / 主运镜 / 时间轴 / 必锁 / 已知失败），
外加一份运镜用词检查器：具名复合镜头、抽象词、超纲运镜，三类默认 ERROR。

从 [liqi-video-forge](https://github.com/SWLIQI/liqi) v6.19.8 的镜头骨架库抽出，不依赖主包。

## 运行前提

- Node.js ≥ 16（ESM，脚本为 `.mjs`）；零第三方依赖
- 全部文件名 ASCII，Windows / macOS / Linux 解压一致
- Windows 控制台中文乱码时先执行 `chcp 65001`

## 快速开始

```bash
node scripts/pick_move.mjs 情绪爆发
node scripts/pick_move.mjs 转场
node scripts/check_move.mjs examples/shot-good.md
node scripts/check_move.mjs examples/shot-bad.md   # 预期 exit 1
npm test
```

## CLI

| 脚本 | 参数 | 说明 |
|---|---|---|
| `pick_move.mjs` | `<场型或意图>` | 按场型/标题/适用/主运镜匹配 |
| `check_move.mjs` | `<文件.md>` | 相对路径按包根解析 |
| `build_index.mjs` | `[主包目录] [--dry-run]` | 需同时读到骨架库与 H3 适配文件 |
| `check_sync.mjs` | `[主包目录]` | 缺主包返回 SKIPPED（跳过 ≠ 通过） |
| `selftest.mjs` | 无 | 29 条自测 |

## 输出示例

`pick_move 情绪爆发`：

```
查询：情绪爆发　命中 3 / 24 条骨架

【情绪爆发 5.2 推近至大特写】
  景别机位：中近景起手，推至大特写。
  主运镜：缓推（单一原语群）。
  时间轴：0-3s：中近景，<外部动作>｜3-6s：缓推，<动作减弱，表情显现>｜6-9s：大特写，<只剩局部与微动>
  必锁：推近匀速无停顿；终态景别；外部动作在第一段内完成。
  已知失败：推近中途停顿；终态景别不到位；第三段又出现大动作。
```

完整输出见 `examples/pick-emotion.txt`；检查通过/失败见 `examples/check-pass.txt` / `examples/check-fail.txt`。

## 三类检查都拦

| 类别 | 例子 | 处理 |
|---|---|---|
| 具名复合镜头 | 滑轨变焦 / 甩镜 / 摇臂升起 / 360 环绕 | ERROR，用 7 个原语拼 |
| 抽象词 | cinematic / beautiful / high quality | ERROR，换成光位、材质、动作、声音 |
| 超纲运镜 | 环绕 / 变焦 / 甩 / 滑轨 / 手持 / 摇 | ERROR，改用 7 词表或拆成两个原语 |

命中任意一类即 exit 1，并打印逐条改法。`shot-good.md` 应 0 ERROR。

## 7 个用词 vs 12 原语

骨架库实际只用到 7 个：固定、横移、缓推、后拉、跟拍、缓降、微推。
主包文档说有 12 个运镜原语，但**从未枚举**，只指向外部 `h3-camera-shots`；
本包不冒充那份清单，只给骨架库的实际取值。这是已知缺口，不是遗漏。

## 禁止清单的来源

`references/bans.json` 是策展文件：

- `source: "MiniMaxH3适配.md"` 的 7 条（4 具名 + 3 抽象）在 `build_index` 时**逐条回查**主包原文；找不到就重建失败。
- `source: "local"` 的 3 条（希区柯克变焦 / stunning / epic）是本包扩展。

`check_sync` 会打印这个来源/本地构成，并明确「哈希一致只代表来源文件未变」。

## 常见问题

- **为什么抽象词也 exit 1？** v0.2.0 起三类都按 ERROR 处理；要么改具体，要么确认这段描述不该用本包。
- **骨架输出能直接粘吗？** 能。`timeline` 已在数据层清掉「【时间轴】」前缀，`pick_move` 只加一次「时间轴：」。
- **为什么 `--dimension` 之类没有？** 本包只按场型取骨架，不做风格/维度筛选；那是 `liqi-style` 的事。
- **主包不在怎么同步？** `check_sync` 返回 SKIPPED，并明确跳过 ≠ 通过。
- **能改禁止清单吗？** 改 `references/bans.json` 后跑 `build_index`；来源词会回查，本地词标 `local`。
- **自测都查什么？** 29 条：数据结构、三类拦截、包外路径、坏 JSON、缺主包跳过。

## 目录

```
SKILL.md                       说明与工作流
move-index.json                24 条骨架（机读）
move-vocab.json                7 个用词 + 禁止清单 + bans 元数据
references/bans.json           禁止清单策展文件（来源词 / 本地扩展）
references/field-schema.md     两个 JSON 的字段说明
scripts/build_index.mjs        从主包重建索引与词表（--dry-run）
scripts/pick_move.mjs          按场型取骨架
scripts/check_move.mjs         检查三类违规
scripts/check_sync.mjs         与主包比对哈希
scripts/selftest.mjs           29 条自测
examples/                      合格/不合格样例与输出
```

## 边界

不做分镜叙事、不做角色、不做风格；**轴线与反打不在本包**。

## 许可

MIT。骨架与用词禁令来自 liqi-video-forge v6.19.8（MIT），详见 `THIRD-PARTY-NOTICES.md`。
