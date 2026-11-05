# liqi 专精包（monorepo）

主包 `liqi-video-forge` 在仓库根目录。这里是 5 个独立专精包，各自有 `SKILL.md`、`references`、`scripts` 与自测，互不依赖；按需取用，不必整套加载。

| 包 | 版本 | 定位 | 入口 | 自测 |
|---|---|---|---|---|
| liqi-cast | 0.2.1 | 角色一致性：4 View 资产板、五官 10 + 服装 6、版本互锁 | [SKILL.md](liqi-cast/SKILL.md) | `node skills/liqi-cast/scripts/selftest.mjs` |
| liqi-style | 0.2.1 | 50 种已落值风格：挑选、色值/运镜/崩点/九段锚/多面压句 | [SKILL.md](liqi-style/SKILL.md) | `node skills/liqi-style/scripts/selftest.mjs` |
| liqi-move | 0.2.0 | 8×3 场型运镜骨架；具名复合镜头/抽象词/超纲运镜三类拦截 | [SKILL.md](liqi-move/SKILL.md) | `node skills/liqi-move/scripts/selftest.mjs` |
| liqi-lens | 0.2.0 | 镜头表与光：景别/角度/视角/光位/轴线/时长 + 配额 | [SKILL.md](liqi-lens/SKILL.md) | `node skills/liqi-lens/scripts/selftest.mjs` |
| liqi-script | 0.2.0 | 剧本门控：五阶门控、台词七维、语速排期、VO/OS | [SKILL.md](liqi-script/SKILL.md) | `node skills/liqi-script/scripts/selftest.mjs` |

## 用法

每个包都是独立 Skill 目录：把需要的那个目录整体放进你的 skills 目录即可（目录名与 `SKILL.md` 的 `name` 一致）。
命令在仓库根目录也能直接跑；脚本会按自身位置解析包根。

## 下载

每个包的 zip 在站点自托管：`https://swliqi.fun/downloads/liqi-<包名>-v<版本>.zip`。
GitHub 这里是源码目录，便于浏览与提交 issue。

## 许可

MIT。各包内的 `THIRD-PARTY-NOTICES.md` 记录来源与上游版本；主包资产与专精包规则均来自 `liqi-video-forge v6.19.8`。
