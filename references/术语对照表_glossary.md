# 术语对照表 Glossary（中文 ↔ English）

用途：给非中文读者（与非中文代码）一张查词表，也供本机脚本做国际化映射时参考。
本表**不定义规则**，只做译名对照；规则以各自文件为准。

---

## 一、三锁（Three Locks）

| 中文 | English | 说明 |
|---|---|---|
| 三锁前置 | three-lock preamble | 任何任务第一步，缺一项就停下问用户 |
| 锁① 模型版本 | Lock 1 — model target | Seedance 2.0 / Seedance 2.5 / MiniMax H3 |
| 锁② 画幅 | Lock 2 — aspect ratio | 16:9 / 9:16 / 21:9 |
| 锁③ 投放面 + 风格轨道 + 交付形态 | Lock 3 — surface + style track + delivery form | 三项同锁 |
| 投放面 | delivery surface | 国内面 / 国际面 / Seedance 2.5 面 / MiniMax H3 面 |
| 国内面 | CN surface | 即梦、豆包、Dreamina、火山方舟 Ark |
| 国际面 | international surface | Sora、Veo、Runway、Kling 国际版 |
| 段头骨架 | segment-header skeleton | 投放面决定，两套骨架绝不可混用 |
| 全能参考模式 | all-reference mode | Seedance 2.5 的两种任务模式之一 |
| 首尾帧模式 | first/last-frame mode | 只有 `first_frame` + `last_frame` 双图 |

---

## 二、六条风格轨道（Six Style Tracks）

| 中文 | English | 判断要点 |
|---|---|---|
| 卡通轨 | Cartoon track | 赛璐璐上色、色块干净、硬边阴影 |
| 写实轨 | Realistic track | PBR 材质；含影视级 CGI 与纪实实拍两个分支 |
| 手绘轨 | Hand-painted track | 水墨 / 水彩 / 绘本 / 版画，平面无体积 |
| 定格木偶轨 | Stop-motion puppet track | 黏土、微缩布景、手工痕迹本身就是风格本体 |
| 三渲二轨 | NPR cel-shaded 3D track | 3D 模型 + 卡通着色；含三渲二与风格化 3D 两个分支 |
| 平面工艺轨 | Flat craft track | 皮影 / 剪纸 / 折纸，单层平面 |

相关：风格锚 = style anchor；风格 id = `style_id`；已落值 = ready；待建 = draft；
条件准入 = conditional；不入 = rejected；稳定性 = stability（稳 stable / 中 medium / 险 risky）。

---

## 三、流程与编号（Steps）

| 中文 | English | 说明 |
|---|---|---|
| Step -1 剧本门控 | Step -1 screenplay gate | 可选；五阶门控 Gate 1–5 |
| Step 0 资产依赖分级 | Step 0 asset dependency grading | A0–A3 |
| Step 1 时长 / 字数 / 台词 | Step 1 duration / length / dialogue | |
| Step 2 全片统一风格锚 | Step 2 film-wide style anchor | 九段 |
| Step 2.5 资产层 | Step 2.5 asset layer | 4 View 板、出图链 |
| Step 3 逐镜提示词 | Step 3 per-shot prompts | 11 小节 |
| Step 4 质量过关 | Step 4 quality gate | P0–P2 |
| Step 5 转场与台账 | Step 5 transitions & continuity ledger | |
| Step 6 交付 | Step 6 delivery | |

---

## 四、九段锚（Nine-block Style Anchor）

| 段 | 中文 | English |
|---|---|---|
| ① | 画风与材质质感 | art style & material texture |
| ② | 配色与色域 | palette & colour gamut |
| ③ | 运动签名 | motion signature |
| ④ | 角色锁定 | character lock |
| ⑤ | 场景锁定 | location lock |
| ⑥ | 道具锁定 | prop lock |
| ⑦ | 光色基调 | lighting & colour key |
| ⑧ | 声音签名 | sound signature |
| ⑨ | 排除项 | exclusions |

---

## 五、预算类（Budgets）

| 中文 | English | 说明 |
|---|---|---|
| 保真预算（主 / 次 / 省） | fidelity budget (primary / secondary / save) | 一次只押一个主花费 |
| 色彩预算 | colour budget | 每镜只声明一个唯一重音色 |
| 可见性预算 | visibility budget | 每个出镜对象写可见范围 |
| 像素账 | pixel budget | 裁开后脸部像素够不够当身份锚 |
| 字数额度 | length quota | 整合镜 4800 字符 / 单镜 I2V 800 / T2V 1000 |
| 时长带宽 | duration bandwidth | 见投放面参数总表 |

---

## 六、镜头与表演（Camera & Acting）

| 中文 | English | 说明 |
|---|---|---|
| 轴线三态 | axis three states | 建立 establish / 保持 hold / 跨越 cross |
| 站位四要素 | four elements of blocking | 位置 position / 依托物 anchor object / 朝向 facing / 姿态 posture |
| 空间分级 S0–S4 | spatial grading S0–S4 | 决定写到哪一层 |
| 取景半径铁律 | framing-radius rule | 景别 × 物理距离决定谁能入画 |
| 单实例铁律 | single-instance rule | 防同角色分身 |
| 景别 | shot size | 7 档 |
| 原语群 | primitive group | 推拉 / 摇俯仰 / 变焦 / 环绕 / 手持，同段不混用 |
| FACS 四区 | FACS four zones | 眉区 brow / 眼区 eye / 颧颊 cheek / 嘴下颌 jaw |
| 强度三档 | intensity three levels | 痕 trace / 显 visible / 强 strong |
| 分层铁律 | layering rule | AU 编号与英文 kernel 一律不进投喂正文 |

---

## 七、声音（Sound）

| 中文 | English |
|---|---|
| 四层混音 | four-layer mix |
| 环境层 | ambient layer |
| 动作层 | action layer |
| 呼吸层 | breathing layer |
| 逼近层 | approaching-threat layer |
| 对白 | dialogue |
| 台词三写 | dialogue triple-write（Seedance 面） |
| 台词一写 | dialogue single-write（H3 面） |
| 语速三档 | speech-rate three tiers |

---

## 八、资产与一致性（Assets）

| 中文 | English |
|---|---|
| 4 View 角色资产板 | 4-View character asset board |
| 左区头部近景 | left panel — head close-up（身份锚） |
| 右区无头三联 | right panel — headless front/side/rear |
| 文字锁（16 项） | 16-point verbal lock |
| 光照锚点 | lighting anchors |
| 互锁词 | interlock words |
| 亲缘推导 | kinship derivation |
| 版本拆分 | version splitting |
| 资产注册表 | asset registry（`asset-registry.json`） |
| 风格注册表 | style registry（`style-registry.json`） |

---

## 九、门禁与规则码（Gates & Rule Codes）

| 中文 | English | 说明 |
|---|---|---|
| P0 致命（阻断交付） | P0 blocking | 必须重构 |
| P1 结构（自动修复） | P1 structural | |
| P2 审美（优化建议） | P2 aesthetic | |
| 三步复验 | three-step re-verification | 改稿必跑 |
| 改动复验报告 | re-verification report | 未附视为未完成复验 |

规则码前缀：

| 码 | 含义 | Meaning |
|---|---|---|
| `E-` | 阻断级，必须修完再交付 | blocking error |
| `W-` | 建议级 | warning |
| `S1`–`S9` | `check_style.mjs` 的九项风格门禁 | style gate checks |
| `E-WRONG-SCRIPT` | 投放面不匹配，脚本自识别后早退 | wrong script for this surface |
| `W-OFFICIAL-500` | 超过官方 API 的 500 字门禁 | exceeds official API length quota |
| `W-OFFICIAL-1000W` | 超过官方 API 的 1000 词门禁 | exceeds official API word quota |

---

## 十、其他高频词

| 中文 | English |
|---|---|
| 整合镜 | merged shot |
| 滑窗拆分 | sliding-window split |
| 拍 | beat |
| 转场注记 | transition notes |
| 连续性台账 | continuity ledger |
| 参数行 | parameter lines（不进正文） |
| 刚性约束 | hard constraints |
| `Must not` | `Must not`（唯一允许否定式的地方，≤1 行） |
| 抽象表述九类 | nine classes of abstract phrasing |
| 去 AI 味 | de-AI-ify |
| slop 词 | slop words |
| 精度梯度 | precision gradient（Level 0–4） |
| 崩点 | collapse risk |
| 压句 | compression sentence（逐字复用） |
| 串轨 | style-track contamination |
| 返修分级 | rework grading |
| 看板 | offline storyboard HTML |

---

## 附：给非中文读者的三条提醒

1. 文件名是中文，但每份文件顶部都有用途说明。按 `SKILL.md` 的 Load Map 找文件即可，
   Load Map 里「情况 → 文件」的对应关系不依赖文件名。
2. 投 MiniMax H3 面时正文必须英文；`audit_literal.py` 内置了英文对应规则，
   中文规则命中不到的英文抽象表述它照样能扫。
3. 本表只做译名对照。规则冲突时以 `SKILL.md` 与对应 reference 为准。
