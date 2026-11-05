#!/usr/bin/env bash
# -*- coding: utf-8 -*-
# liqi 一键自检（v5.37.1）
#
# 治的两层病：
#   ① **自测靠记忆手敲，漏一套也看不出来**。改一行判据要跑一堆脚本，实际从来没人全跑。
#   ② **「0 过 / 0 败」也算绿**。自测跑挂了但把失败吞掉、或者用例一个都没注册，末行照样写
#      「0 败」。所以这里不只看到退出码，还要看到「N 过 / 0 败」且 **N ≥ 1**。
#      （这不是假想：W-EMPTY-TIMELINE 那一批之前，90 个夹具全绿，而官方两个黄金样例的
#        20 个镜块长期「段数 0」——绿是因为那条判据根本没跑。）
#
# 组数对账不在本脚本里做：数字只在文档写一次，由 `scan_conflicts.py` 的 K7 拿源码实际数
# 比对文档声称值。本脚本只认「跑通 + 0 败 + 用例数 ≥ 1」，避免又长出一份要手工同步的副本。
#
# 用法：
#   bash scripts/run_all_checks.sh            # 十七套自测
#   bash scripts/run_all_checks.sh --full     # 另跑三个官方样例，与基线数字比对
#   bash scripts/run_all_checks.sh --list     # 只列步骤，不执行
# 环境变量：
#   NODE=...  指定 node（默认依次找 node / nodejs）
#   PY=...    指定 python（默认依次找 python3 / python / py——py 是 Windows 官方启动器）
# 退出码：0 全过；1 有失败或样例数字漂移；2 用法错误 / 运行时缺失 / 不在技能包根目录
set -u

HERE=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd) || exit 2
ROOT=$(cd "$HERE/.." && pwd) || exit 2
cd "$HERE" || exit 2

if [ ! -f "$ROOT/SKILL.md" ]; then
  echo "❌ 不在技能包根目录（找不到 $ROOT/SKILL.md）" >&2
  exit 2
fi

FULL=0
LIST=0
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    --list) LIST=1 ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "❌ 未知参数：$arg（可用：--full / --list / --help）" >&2; exit 2 ;;
  esac
done

# ── 运行时探测 ──────────────────────────────────────────────────────────────
NODE=${NODE:-}
if [ -z "$NODE" ]; then
  for c in node nodejs; do
    if command -v "$c" >/dev/null 2>&1; then NODE=$(command -v "$c"); break; fi
  done
fi
PY=${PY:-}
if [ -z "$PY" ]; then
  for c in python3 python py; do
    if command -v "$c" >/dev/null 2>&1; then PY=$(command -v "$c"); break; fi
  done
fi

# Windows 的 Python 默认控制台编码不是 UTF-8，含中文/emoji 的子进程输出会变问号并打断
# selftest 的字符串断言（2026-10-24 实测：boundary N4 两条假败即此因，UTF8=1 后只剩真败）。
export PYTHONUTF8=1
# P0-3（v5.50.0）：全套自测期间写下的门禁日志一律标 selftest——
# 否则临时夹具的日志会混进 real 口径，「real 占比」从第一天就被污染
# （--full 样例比对走 --no-log，不写日志，不受影响）。
export LIQI_ORIGIN=selftest

# ── 第 0 步·环境医生预检（v5.52.0 · C17）───────────────────────────────────
# 红项（python 缺席 / 目录不可写 / node 过旧）在这里就停，带着修复提示停——
# 环境不对时后面十五套的失败全是噪音。黄项（ffmpeg/ffprobe/UTF-8）只提示不拦，
# 它们只影响渲染后机检与含中文断言的自测。PY 显式导出给医生，同一探测口径。
if [ -n "$PY" ]; then export PY; fi
if [ -n "$NODE" ]; then
  _envout=$("$NODE" check_env.mjs "$ROOT" 2>&1); _envrc=$?
  printf '%s\n' "$_envout" | sed 's/^/  /'
  if [ "$_envrc" -eq 1 ]; then
    echo "❌ 环境医生报红项（见上）——先按提示修复；黄项不影响除渲染机检外的其余门。" >&2
    exit 2
  fi
  echo ""
fi

# ── 颜色（非 tty 或 NO_COLOR 时全灰）────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  GRN=$'\033[32m'; RED=$'\033[31m'; YEL=$'\033[33m'; DIM=$'\033[90m'; RST=$'\033[0m'
else
  GRN=; RED=; YEL=; DIM=; RST=
fi

# ── 步骤表：名称 / 覆盖说明 / 命令 ──────────────────────────────────────────
# 顺序按「最常被改坏」排：判据本体 → 判据边界 → 风格 → 契约 → 包一致性
STEP_NAME=()
STEP_NOTE=()
STEP_CMD=()
STEP_SHOW=()
add_step() {
  STEP_NAME+=("$1"); STEP_NOTE+=("$2"); shift 2
  STEP_CMD+=("$*")
  # 展示用短命令：运行时换成 basename（--list 里不必暴露本机的 node 绝对路径）
  _first=$1; shift; STEP_SHOW+=("${_first##*/} $*")
}

if [ -n "$NODE" ]; then
  add_step "check_prompt 单包判据自测" "投喂块语法 / 全部规则码 / 五种段骨架 / 锁①型号" "$NODE selftest_check_prompt.mjs"
  add_step "check_prompt_h3 base 与 Ref2VA 分流" "H3 三字段 vs 六段式 / # mode: / h3max 下限" "$NODE selftest_check_prompt_h3.mjs"
  add_step "check_style 风格锚一致性" "风格路由 / 负面词自洽 / 出图面识别" "$NODE selftest_check_style.mjs"
  add_step "gates_stats 判读结论" "未查分类合计 / 停滞·收敛·恶化判定 / 未查不进 Top 榜" "$NODE selftest_gates_stats.mjs"
  add_step "环境医生自测" "python 探测与红黄分级 / 假名注入必红 / ffmpeg 缺席降黄 / MSYS 路径转换 / CLI --json 纯度（C17）" "$NODE selftest_check_env.mjs"
fi
if [ -n "$PY" ]; then
  add_step "边界与跨机同判（JS ↔ Python）" "长段三条件 / 15% 容差 / 2.0 面 20s 双机同判" "$PY selftest_boundary.py"
  add_step "契约核销器自测" "契约格式 / 核销状态机" "$PY audit_contract.py --self-test"
  add_step "audit_risk 过审预检自测" "正文边界（围栏 / 说明行 / 表格 / 禁令）/ 风险分档位 / 假绿防线" "$PY selftest_audit_risk.py"
  add_step "audit_literal 抽象表述自测" "13 类各一正例 / 正文排除七分支 / 误报表 / 附文止扫 / 假绿三路 / 英文大小写与词形" "$PY selftest_audit_literal.py"
  add_step "audit_render 渲染后机检自测" "假绿防线三路 / 黑帧 / 冻帧（含冻到片尾无 end 的解析）/ 静音 / 画幅 / 时长对账 / --json 纯度（无 ffmpeg 的机器只跑 R1-R3——跳过不是通过）" "$PY selftest_audit_render.py"
  add_step "渲染台账自测" "add 落盘与四码 / harness_error 不进 scored / 重 roll 超 3 停对账 / 实录缺料警告 / stats --json 纯度 / 不存在台账不当零条（C18）" "$PY selftest_render_ledger.py"
  add_step "教训库聚合自测" "双台账罗列与高频返工分组 / --top 截断 / 坏行跳过 / 空树与缺参（C24）" "$PY selftest_lessons_aggregate.py"
  add_step "连续性锁对账自测" "锁面逐字（含标点）/ 负面区命中不算 / 解锁跳过 / 空跑防护 / 镜号范围无交集 / --json 纯度（C28）" "$PY selftest_audit_continuity_lock.py"
  add_step "liqi.json 项目配置自测" "未知键 / 类型 / 相对路径按配置目录 / 显式 CLI 优先 / --json 纯度" "$PY selftest_config.py"
  add_step "audit_all 总账末段与 --config" "行内未查必须出现且与行内数字一致 / 默认退出码不受影响 / --strict 算失败 / 全量配置后未查归零" "$PY selftest_audit_all.py"
  add_step "冲突模式扫描器自测" "K1 围栏 / K5 跳出口径 / K7 组数 / K8 skip 类别（含豁免与去重）" "$PY selftest_scan_conflicts.py"
fi
if [ -n "$NODE" ]; then
  add_step "技能包一致性" "路径存在 / 码表两向一致 / 版本同步 / L1~L6 联动 / 数值源自洽" "$NODE check_skill.mjs .."
fi
if [ -n "$PY" ]; then
  # v5.44.0 新增（P2）：v5.43.1 的 durFactor 只在主库落地，两副本仍停在 v5.43.0，
  # 同一份 30s 包主库不报、两副本误报，而三处自测都 12/12 全绿——漂移不会让任何一处报警。
  # 这一套把「人肉比对副本」换成机检。单副本环境输出「不适用」，不算失败。
  add_step "三副本同步" "scripts/references 逐字节一致 / 底座版本一致（漂移会让同一份包在不同入口判罚不同）" "$PY check_copies.py"
fi

TOTAL=${#STEP_NAME[@]}

if [ "$LIST" -eq 1 ]; then
  echo "liqi 一键自检 · 共 $TOTAL 步"
  i=0
  while [ "$i" -lt "$TOTAL" ]; do
    printf '  %d. %s —— %s\n      %s%s%s\n' "$((i+1))" "${STEP_NAME[$i]}" "${STEP_NOTE[$i]}" "$DIM" "${STEP_SHOW[$i]}" "$RST"
    i=$((i+1))
  done
  [ "$FULL" -eq 1 ] && echo "  另：--full 会跑三个官方样例并与基线数字比对"
  exit 0
fi

echo "liqi 一键自检 —— $ROOT"
echo "  node: ${NODE:-（未找到）}"
echo "  python: ${PY:-（未找到）}"
if [ -z "$NODE" ] || [ -z "$PY" ]; then
  echo "❌ 运行时缺失：本套判据是双语言实现（JS 判据 + Python 审计），两边都要在。" >&2
  if [ -z "$PY" ]; then
    echo "   补 Python：winget install Python.Python.3（或 Microsoft Store 搜 Python；装完即有 python 与 py）。" >&2
    echo "   只想先跑 Node 侧五套：node scripts/check_skill.mjs && node scripts/selftest_check_prompt.mjs && node scripts/selftest_check_prompt_h3.mjs && node scripts/selftest_check_style.mjs && node scripts/selftest_gates_stats.mjs" >&2
  fi
  exit 2
fi
echo ""

pass_n=0
fail_n=0
FAILED=()

run_step() {
  _name=$1; _idx=$2; shift 2
  _out=$("$@" 2>&1); _rc=$?
  _last=$(printf '%s\n' "$_out" | grep -E '结果：|合计：|PASSED' | tail -1)
  _ok=1; _why=''

  if [ "$_rc" -ne 0 ]; then
    _ok=0; _why="退出码 $_rc"
  elif printf '%s' "$_last" | grep -q '0 ERROR / 0 WARN'; then
    : # check_skill 口径：0E/0W 即过
  elif printf '%s' "$_last" | grep -q 'PASSED'; then
    # audit_contract.py --self-test 口径：末行「PASSED（N 组）」，N 从组数里取
    _n=$(printf '%s' "$_last" | sed -n 's/.*（\([0-9][0-9]*\) 组）.*/\1/p')
    if [ -z "$_n" ]; then _ok=0; _why="PASSED 里读不出组数：${_last}"; fi
  elif ! printf '%s' "$_last" | grep -q '0 败'; then
    _ok=0; _why="末行不是「0 败」：${_last:-（无输出）}"
  else
    _n=$(printf '%s' "$_last" | sed -n 's/.*结果：\([0-9][0-9]*\) 过.*/\1/p')
    if [ -n "$_n" ] && [ "$_n" -lt 1 ]; then
      _ok=0; _why="用例数 0 —— 脚本没注册用例，这不是通过"
    fi
  fi

  printf '[%s/%s] %s ' "$_idx" "$TOTAL" "$_name"
  if [ "$_ok" -eq 1 ]; then
    pass_n=$((pass_n+1))
    printf '%s\n' "${GRN}✅ ${_last:-通过}${RST}"
  else
    fail_n=$((fail_n+1))
    FAILED+=("$_name：$_why")
    printf '%s\n' "${RED}❌ $_why${RST}"
    printf '%s\n' "$_out" | tail -12 | sed 's/^/      /'
  fi
}

i=0
while [ "$i" -lt "$TOTAL" ]; do
  # 用全局序号打印，避免 run_step 里再算
  run_step "${STEP_NAME[$i]}" "$((i+1))" ${STEP_CMD[$i]}
  i=$((i+1))
done

# ── 样例回归（--full）──────────────────────────────────────────────────────
# 基线 = v5.37.8 实测值（v5.37.7 起连「未查」的分类明细一起比：只比总数的话，
# 分类逻辑整体退化成「全算缺输入」也能通过，而那正是会让 10 条补不动的产物被当成
# 「补个参数就行」的那种退化）。改判据后这里变了，必须先解释为什么变，
# 再改这张表——「数字变了就跟着改表」等于把基线变成记录当前状态的橡皮章。
EX_FAIL=0
EX_ROWS=()

check_example() {
  _path=$1; _cpe=$2; _cpw=$3; _ape=$4; _apw=$5; _apk=$6; _apd=$7
  _cp=$("$NODE" check_prompt.mjs "$ROOT/$_path" --no-log 2>&1 | grep -E '^结果：' | tail -1)
  _ap=$("$PY" audit_project.py "$ROOT/$_path" --no-log 2>&1 | grep -E '^结果：' | tail -1)
  _got_cpe=$(printf '%s' "$_cp" | sed -n 's/结果：\([0-9][0-9]*\) error.*/\1/p')
  _got_cpw=$(printf '%s' "$_cp" | sed -n 's/.*\/ \([0-9][0-9]*\) warning.*/\1/p')
  _got_ape=$(printf '%s' "$_ap" | sed -n 's/结果：\([0-9][0-9]*\) error.*/\1/p')
  _got_apw=$(printf '%s' "$_ap" | sed -n 's/.*\/ \([0-9][0-9]*\) warning.*/\1/p')
  # 「未查」数也要比：它掉下去说明某道门不再报「未查」了——那可能是好事（补了输入），
  # 也可能是坏事（skip 消息被删、门被静默摘掉）。数字变了就必须解释。
  _got_apk=$(printf '%s' "$_ap" | sed -n 's/.*\/ \([0-9][0-9]*\) 未查.*/\1/p')
  # v5.37.7：未查的**分类明细**也要比。只比总数的话，分类逻辑整体退化成「全算缺输入」
  # 也能过——而那个退化恰恰会让 10 条补不动的产物被当成「补个参数就行」。
  _got_apd=$(printf '%s' "$_ap" | sed -n 's/.*未查（\([^）]*\)）.*/\1/p' | sed 's/，.*//')
  _mark=0
  [ "${_got_cpe:-x}" = "$_cpe" ] && [ "${_got_cpw:-x}" = "$_cpw" ] \
    && [ "${_got_ape:-x}" = "$_ape" ] && [ "${_got_apw:-x}" = "$_apw" ] \
    && [ "${_got_apk:-0}" = "$_apk" ] && [ "${_got_apd:-}" = "$_apd" ] && _mark=1
  _tag=${_path#examples/}; _tag=${_tag%/包.md}
  _got="check_prompt ${_got_cpe:-?}E/${_got_cpw:-?}W ｜ audit_project ${_got_ape:-?}E/${_got_apw:-?}W/${_got_apk:-0}未查（${_got_apd:-?}）"
  if [ "$_mark" -eq 1 ]; then
    EX_ROWS+=("  ${GRN}✅${RST} $_tag —— $_got")
  else
    EX_FAIL=$((EX_FAIL+1))
    EX_ROWS+=("  ${RED}❌${RST} $_tag —— $_got　${DIM}（基线 ${_cpe}E/${_cpw}W ｜ ${_ape}E/${_apw}W/${_apk}未查（${_apd}））${RST}")
  fi
}

if [ "$FULL" -eq 1 ]; then
  echo ""
  echo "样例回归（基线 = v6.4.2 实测。v5.43.0→v6.0.2 的漂移 = W-OFFICIAL-500 默认开（每块 +1）＋其他判据演进；"
  echo "v6.4.2 实测裁决改回 opt-in（500 字口径不适用 30s 长段）后按当前值重录，不再逐项归因；"
  echo "A2 的 1 个 error 是镜7 第二段「段头摇臂 + 正文快推」并存，按「一段只留一个主运镜」属真违规、保留为基线）"
  check_example "examples/实战_梦中人_场1/包.md"   0 6 0 0 10 "缺输入 10"
  check_example "examples/黄金样例_A2_夜巡/包.md"  1 6 0 0 10 "缺输入 10"
  # v5.37.8：R 门（镜头裁定）改判「不适用」后，12 未查 → 11 未查 + 1 不适用。
  # 这一行同时锁「不适用没被算进未查」：退回去就会变成 12，这里立刻红。
  check_example "examples/黄金样例_E01S02/包.md"   0 5 0 2 11 "缺产物 10 / 门槛 1"

  # v5.43.0（外部审计二轮）：「门覆盖 18/18」这块招牌数字此前没有回归保护——裸调用只给 10 未查，
  # 18/18 是 --auto 自动发现输入后才有。把它锁进回归：A2 的 --auto 必须 0E/0W 且覆盖满格，
  # 哪天自动发现退化成 8/18，这里立刻红。
  _auto=$("$PY" audit_project.py "$ROOT/examples/黄金样例_A2_夜巡/包.md" --auto --no-log 2>&1)
  _auto_cov=$(printf '%s' "$_auto" | grep -oE '覆盖 [0-9]+ / [0-9]+' | head -1)
  _auto_res=$(printf '%s' "$_auto" | grep -E '^结果：' | tail -1)
  if [ "$_auto_cov" = "覆盖 18 / 18" ] && printf '%s' "$_auto_res" | grep -q "0 error / 0 warning"; then
    EX_ROWS+=("  ${GRN}✅${RST} 黄金样例_A2_夜巡（--auto）—— $_auto_cov ｜ $_auto_res")
  else
    EX_ROWS+=("  ${RED}❌${RST} 黄金样例_A2_夜巡（--auto）—— 覆盖[$_auto_cov] ｜ $_auto_res（期望 覆盖 18 / 18 且 0E/0W）")
    FAIL=$((FAIL+1))
  fi
  for r in "${EX_ROWS[@]}"; do printf '%s\n' "$r"; done
fi

# ── 总账 ───────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────────────"
if [ "$fail_n" -eq 0 ] && [ "$EX_FAIL" -eq 0 ]; then
  echo "${GRN}自测：$pass_n / $TOTAL 全过${RST}"
  [ "$FULL" -eq 1 ] && echo "${GRN}样例：3 / 3 同基线${RST}"
  echo "${DIM}注意：自测全绿只说明判据没被改坏，不说明门禁有用——覆盖不到的写法照样静默放行。${RST}"
  exit 0
fi
echo "${RED}自测：$pass_n / $TOTAL 过，$fail_n 失败${RST}"
for f in "${FAILED[@]}"; do echo "  ${RED}·${RST} $f"; done
[ "$EX_FAIL" -gt 0 ] && echo "${RED}样例：$EX_FAIL / 3 与基线不符${RST}"
exit 1
