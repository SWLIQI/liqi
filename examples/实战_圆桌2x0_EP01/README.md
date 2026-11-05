# 实战样例 · Seedance 2.0 面《死了七年的人》EP01

> **用途**：全库唯一的 **Seedance 2.0 面**端到端成品包。6 段 × 15s、合计 90s，
> 展示 2.0 面的三件特有事：**镜头编号事件序骨架**（`镜头1：…｜镜头2：…`）、
> **秒级时间轴禁用**、**跨段衔接走 I2V 首帧绑定**。

**🔴 本样例不可一键复跑——这是设计如此，不是缺料**

| 项 | 状态 |
|---|---|
| `包.md` | ✅ 完整（六段正文 + 参数行 + 投喂图序） |
| 剧本 / `beats.txt` | ❌ 不随包（本片为用户实战项目剧本，未获授权分发） |
| `asset-registry.json` / 台账 / `decisions.jsonl` | ❌ 不随包（素材形态 **M2 = 已入库**，资产在用户侧） |

对比：`examples/黄金样例_A2_夜巡/` 是**可复跑**基准（剧本 / beats / registry / 台账 / 决策流水全齐，12 个文件）；
本样例是**格式基准**，两者用途不同，不要拿本样例当复跑起点。

---

## 能用来做什么

```bash
# ① 单包判据（不依赖剧本与资产库）—— 实测 0 error / 12 warning，构成见下表
node scripts/check_prompt.mjs examples/实战_圆桌2x0_EP01/包.md --model 2.0 --no-log

# ② 抽象表述 / 过审预检（两份都能跑通；输出为候选，需人工判定）
python scripts/audit_literal.py examples/实战_圆桌2x0_EP01/包.md --no-log
python scripts/audit_risk.py    examples/实战_圆桌2x0_EP01/包.md --no-log
```

**12 个 warning 的实际构成**（这是真实生产包，瑕疵照实记，不修饰）：

| 码 | 条数 | 含义 |
|---|---|---|
| `W-CONTEXT-LEAK` | 4 | 滑窗拆分的段之间写了「接上 / 继续 / 仍穿着」 |
| `W-SPATIAL-NO-FRAME-REF` | 3 | 方位用了人物自身左右，未写成「画面左 / 画面右」观众视角 |
| `W-LENGTH-CAP` | 2 | 单行字数超限（最长行 161 字） |
| `W-SHOTSIZE-MISSING` | 2 | 段头未写景别 |
| `W-SHOT-MULTI-SCALE` | 1 | 同一镜号写了多个主导景别 |

## 不能用来做什么

- ❌ `audit_project.py`（A 台词一致性 / N 剧本量化 / G 台账对账）——缺 `剧本_标准.txt` 与 `continuity-ledger.md`
- ❌ `check_prompt.mjs --beats`——缺 `beats.txt`
- ❌ 任何以本样例为输入的「全链复跑」脚本

## 这份样例证明什么、不证明什么

- ✅ 证明 2.0 面的**骨架、参数行、段缝声明、投喂图序**在真实项目里长这样
- ✅ 证明 2.0 面在 6×15s 结构下能过 `check_prompt --model 2.0` 的**阻断级判据**（0 error）
- ⚠️ 但**不是零瑕疵**：12 个 warning 分五类（见上表），抄格式时别把它们一起抄走
- ❌ **不**证明成片已生成——见包首 `【渲染状态】未渲染`
- ❌ **不**证明资产层 / 剧本层判据（本样例没走那两层）
