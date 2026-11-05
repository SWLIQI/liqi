# 字段 Schema

## move-index.json

数组，24 条；由 `build_index.mjs` 从主包 `references/镜头骨架库.md` 解析，不要在文档里另抄一份。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 场型内编号，如 `5.2` |
| `scene` | string | 场型，8 个之一 |
| `title` | string | 骨架标题 |
| `fit` | string | 适用场景 |
| `shot` | string | 景别与机位 |
| `move` | string | 主运镜（必须落在 7 词表内） |
| `timeline` | string | 时间轴分段，形如 `0-3s：…｜3-6s：…`；**不含**「【时间轴】」前缀 |
| `locks` | string | 必锁项 |
| `failures` | string | 已知失败 |

## move-vocab.json

| 字段 | 类型 | 说明 |
|---|---|---|
| `coreVersion` | string | 上游版本，当前 `6.19.8` |
| `source` | string | 骨架库相对路径 |
| `sourceHash` | string | 骨架库 sha256，与 `SYNCED.json` 一致 |
| `sceneCount` | number | 场型数，8 |
| `skeletonCount` | number | 骨架数，24 |
| `vocabulary` | string[] | 7 个实际用词 |
| `bannedNamedMoves` | string[] | 具名复合镜头，5 条 |
| `bannedGenericWords` | string[] | 抽象词，5 条 |
| `bans` | object | 禁止清单来源核验元数据 |
| `bans.file` | string | 回查的上游文件 |
| `bans.namedFromSource` / `namedLocal` | number | 具名清单的来源 / 本地条数（4 / 1） |
| `bans.genericFromSource` / `genericLocal` | number | 抽象词的来源 / 本地条数（3 / 2） |
| `bans.verified` | boolean | `build_index` 时逐条回查通过 |
| `bans.note` | string | 口径说明 |

## 关于 7 词表

骨架库实际只用到 7 个运镜词：固定、横移、缓推、后拉、跟拍、缓降、微推。
主包文档说有 12 个原语，但从未枚举，只指向外部 `h3-camera-shots`。
本包**不冒充**那份清单；7 词表是骨架库的实际取值，超出的运镜会被 `check_move` 拦下。

## 禁止清单的策展

`references/bans.json` 是禁止清单的唯一策展文件：

- `source: "MiniMaxH3适配.md"`：`build_index` 会读取主包原文，逐条确认该词仍存在；找不到就重建失败。
- `source: "local"`：本包扩展，不参与回查。

`move-vocab.json` 的 `bannedNamedMoves` / `bannedGenericWords` 由该文件生成，不要手改生成物。
