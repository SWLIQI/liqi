#!/usr/bin/env node
/**
 * gates_stats.mjs —— 门失败统计
 *
 * 用法：
 *   node gates_stats.mjs [目录…] [-r] [--tool check_prompt.mjs] [--top 10]
 *                        [--lookback 5] [--json] [--fail-on-stall]
 *
 *   -r / --recursive  连同子目录里所有 .gates.jsonl 一起统计（v5.37.16）。
 *     为什么需要它：日志写在「被校验文件同目录」——包放在 项目/分镜/ 下，日志就落在
 *     `分镜/` 里。一个项目跑几次就散成好几份，默认只看顶层等于只看到一部分；
 *     多项目汇总同理：`gates_stats.mjs ~/projects -r` 一次吃完。
 *     不带 -r 时行为与旧版**逐字节等价**（只读 <目录>/.gates.jsonl）。
 *
 * 读 <目录>/.gates.jsonl（默认当前目录），回答四件事：
 *   1. 哪道门最常响 —— 那条规则模型最常无视，该改的是措辞；
 *   2. 哪道门从没响过 —— 死门，或规则已被内化（对照各脚本 --help 的码表人工判断）；
 *   3. 那堆「未查」是能补参数消掉的（缺输入），还是补参数也没用的（门槛）；
 *   4. 同一个文件来回改，到底在收敛还是在原地踏步 —— 看最近几次的序列，不看总数。
 *
 * 数据来源：check_prompt.mjs / check_prompt_h3.mjs / check_style.mjs / audit_literal.py / audit_risk.py /
 * audit_project.py / audit_contract.py（后两个经 gates_log.py 写同构日志）
 * 每次运行追加的一行 JSON（默认记录，--no-log 关闭）。
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
// 带值的选项，其值是参数不是目录——否则 `--top 10` 里的 10 会被当成目录去扫。
const VALUE_OPTS = new Set(['--tool', '--top', '--lookback']);
const dirArgs = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a.startsWith('-')) { if (VALUE_OPTS.has(a)) i += 1; continue; }
  dirArgs.push(a);
}
const roots = (dirArgs.length ? dirArgs : [process.cwd()]).map((d) => path.resolve(d));
const recursive = argv.includes('-r') || argv.includes('--recursive');
const getOpt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const toolFilter = getOpt('--tool', null);
const topN = Number(getOpt('--top', '10'));
const asJson = argv.includes('--json');
// v5.37.9：供 CI 用。默认关——「连续几次没进步」在人的眼里是提醒，在流水线里才是失败，
// 而现有用法（人看统计）不该因为多了这个判据就突然退出码非 0。
const failOnStall = argv.includes('--fail-on-stall');

/** 收集要读的 .gates.jsonl。origin = 相对扫描根的目录，用于区分同名包。 */
function findLogs(root) {
  const out = [];
  const direct = path.join(root, '.gates.jsonl');
  if (fs.existsSync(direct)) out.push({ p: direct, origin: '' });
  if (!recursive) return out;
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const q = path.join(d, e.name);
      if (e.isDirectory()) { walk(q); continue; }
      if (e.name !== '.gates.jsonl' || q === direct) continue;
      const rel = path.relative(root, d).replace(/\\/g, '/');
      out.push({ p: q, origin: rel || '.' });
    }
  };
  walk(root);
  return out;
}

const seen = new Set();
const logs = [];
for (const root of roots) {
  for (const it of findLogs(root)) {
    if (seen.has(it.p)) continue;
    seen.add(it.p);
    logs.push(it);
  }
}

if (!logs.length) {
  console.log(`没有找到 ${roots.map((r) => path.join(r, '.gates.jsonl')).join(' 或 ')}${recursive ? '（含子目录）' : ''}`);
  console.log('先跑一次交付前校验（默认会记录），或确认目录写对了'
    + (recursive ? '。' : '；日志也可能落在包所在子目录，试加 -r。'));
  process.exit(0);
}

const runs = [];
for (const { p: lp, origin } of logs) {
  let text = '';
  try { text = fs.readFileSync(lp, 'utf8'); } catch { continue; }
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let rec;
    try { rec = JSON.parse(s); } catch { continue; }
    if (toolFilter && rec.tool !== toolFilter) continue;
    // 只在递归模式下打标记：不带 -r 时 key 与旧版完全一致，趋势分组不漂。
    if (origin) rec.__origin = origin;
    runs.push(rec);
  }
}

const originKey = (r) => (r.__origin ? `${r.__origin}/${r.file}` : r.file);

if (runs.length === 0) {
  console.log('没有匹配的运行记录。');
  process.exit(0);
}

// ---- 聚合 ----
const byTool = {};
const files = new Set();
const codeAgg = {}; // code -> { count, tools:Set, lastTs, lastFile }
// v4.8.3 D4：删掉 err/warn 两个死字段——.gates.jsonl 只记运行级 errors/warns 总数，
// 记不到单码层级，旧版初始化 0 后永不递增，--json 里恒为 0 是误导；
// 单码层级查对应脚本的码表（见 质控层_门禁与过审.md 第二节；数量以脚本实现为准，不手维护数）。
for (const r of runs) {
  byTool[r.tool] = (byTool[r.tool] || 0) + 1;
  files.add(originKey(r));
  for (const [c, n] of Object.entries(r.codes || {})) {
    const a = (codeAgg[c] ||= { count: 0, tools: new Set(), lastTs: '', lastFile: '' });
    a.count += n;
    a.tools.add(r.tool);
    if (!a.lastTs || r.ts > a.lastTs) { a.lastTs = r.ts; a.lastFile = r.file; }
  }
}

// 「未查」不是「响了」（v5.37.3）：SEC-SKIP / UNCODED 这两类桶记的是「门没跑」，
// 混进 Top 榜会让判读说出「最常响的是 SEC-SKIP，优先改它的措辞」——而它没有措辞，
// 它代表的是「你少传了一个 --registry」。单列出来，且**不进排名**。
const SKIP_BUCKETS = new Set(['SEC-SKIP', 'UNCODED']);
// 不适用（v5.37.8）单开一桶：它既不是「响了」，也不是「没跑」——是「本包没这个场景」。
// 并进跳过会让「该跑没跑」和「不该跑」变成同一个数。
const NA_BUCKETS = new Set(['SEC-NA']);
const rankable = {};
const skipped = {};
const nas = {};
for (const [c, a] of Object.entries(codeAgg)) {
  if (NA_BUCKETS.has(c)) nas[c] = a;
  else if (SKIP_BUCKETS.has(c)) skipped[c] = a;
  else rankable[c] = a;
}

// ---- 未查分类合计（v5.37.6）---------------------------------------------
// 老记录没有 skip_input / skip_thresh 字段（那时还没分类），这类一律算「未分类」——
// 不能并进「缺输入」：那会把「补个参数就行」和「补参数没用」混成一句话，
// 而这正是这一版要拆开的东西。
// schema 版本分布（v5.37.10）：没有 v 字段 = v1 老记录。
// 有这个区分，「未分类」才能分清是「采集时没这字段」还是「新写的消息漏标」。
const legacyRuns = runs.filter((r) => r.v == null).length;
const legacyWithSkips = runs.filter((r) => r.v == null && r.skips > 0).length;
// v2 但连分类字段一个都没有：要么是 node 侧脚本（本来就不分类），要么是漏标。
const v2Unclassified = runs.filter(
  (r) => r.v >= 2 && r.skips > 0 && r.skip_untagged == null).length;

let skipIn = 0; let skipMiss = 0; let skipTh = 0; let skipUn = 0;
for (const r of runs) {
  if (!r.skips) continue;
  const i = r.skip_input || 0;
  const m = r.skip_missing || 0;
  const t = r.skip_thresh || 0;
  skipIn += i; skipMiss += m; skipTh += t;
  skipUn += r.skip_untagged == null ? Math.max(0, r.skips - i - m - t) : r.skip_untagged;
}

// ---- 历史趋势（v5.37.6）-------------------------------------------------
// 「未查 10 → 10 → 10」和「10 → 6 → 0」在总数上完全一样，但前者是没人管，后者在收敛。
// 按「同一文件 + 同一工具」切时间序列，只取最近 LOOKBACK 次。
// 趋势只看最近几次：看太远会把「上次补完输入就清零了」和「这次又缺了」混在一起。
const LOOKBACK = Math.max(1, Number(getOpt('--lookback', '5')) || 5);
const groups = {};
for (const r of runs) {
  (groups[`${originKey(r)}::${r.tool}`] ||= []).push(r);
}
const trend = [];
for (const [key, list] of Object.entries(groups)) {
  if (list.length < 2) continue;                       // 只跑过一次谈不上趋势
  list.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const win = list.slice(-LOOKBACK);
  const [file, tool] = key.split('::');
  const pick = (f) => win.map((r) => (r[f] || 0));
  const skips = pick('skips');
  trend.push({ file, tool, runs: win.length, total: list.length,
               errors: pick('errors'), warns: pick('warns'), skips,
               verdict: verdict(skips) });
}
// 谁最该看排最前：停顿的、恶化的在前，已清零的在后。
const RANK = (v) => (v.startsWith('停滞') ? 0 : v.startsWith('在恶化') ? 1 : v.startsWith('在收敛') ? 2 : 3);
trend.sort((a, b) => RANK(a.verdict) - RANK(b.verdict) || b.skips[b.skips.length - 1] - a.skips[a.skips.length - 1]);
const stalled = trend.filter((t) => t.verdict.startsWith('停滞'));

function verdict(series) {
  const last = series[series.length - 1];
  const first = series[0];
  const l3 = series.slice(-3);
  if (last === 0) return '已清零';
  // 连续 3 次一模一样且没归零：不是「稳定」，是没人动它。
  if (l3.length === 3 && l3.every((v) => v === l3[0])) return `停滞：最近 3 次都是 ${last}`;
  if (last < first) return `在收敛（${first} → ${last}）`;
  if (last > first) return `在恶化（${first} → ${last}）`;
  return `持平（${first}）`;
}

const top = Object.entries(rankable)
  .sort((x, y) => y[1].count - x[1].count)
  .slice(0, topN);
// 未查总数取「码号桶」与「记录里的 skips 字段」的较大者（v5.37.9）。
// 为什么不能只看码号桶：一条记录若 `skips: 10` 而 `codes: {}`（老格式 / 手写日志 /
// 落码失败的实现），码号桶是空的 ⇒ 旧实现会走进「✅ 没有任何命中」分支——
// **日志明说 10 条没跑，报告说全绿**。这正是本库一直在防的那类假绿。
const skipByCodes = Object.values(skipped).reduce((s, a) => s + a.count, 0);
const skipByRecords = runs.reduce((s, r) => s + (r.skips || 0), 0);
const skipTotal = Math.max(skipByCodes, skipByRecords);
const naTotal = Math.max(Object.values(nas).reduce((s, a) => s + a.count, 0),
                         runs.reduce((s, r) => s + (r.nas || 0), 0));

// P0-3（v5.50.0）：记录来源分组——死码治理只认 real；自测与样例数据必须能从报表头上分开
// （此前 562 条记录里 556 条是样例自测，占比却只活在注释里）。
// 注意：这里的 `origin` 是**记录字段**（selftest/golden/real），与上方 logs[].origin
// （日志文件所在目录前缀）同名不同义——后者仅用于 -r 递归时区分同名包。
const origins = { real: 0, golden: 0, selftest: 0, unknown: 0 };
for (const r of runs) origins[origins.hasOwnProperty(r.origin) ? r.origin : 'unknown'] += 1;
const knownRuns = runs.length - origins.unknown;
const realPct = knownRuns ? Math.round((origins.real / knownRuns) * 100) : null;

if (asJson) {
  console.log(JSON.stringify({
    runs: runs.length, tools: byTool, files: [...files],
    top: top.map(([c, a]) => ({ code: c, ...a, tools: [...a.tools] })),
    skipped: Object.fromEntries(Object.entries(skipped).map(([c, a]) => [c, a.count])),
    skipped_total: skipTotal,
    skipped_kinds: { input: skipIn, missing: skipMiss, thresh: skipTh, untagged: skipUn },
    na_total: naTotal,
    origins,
    real_pct: realPct,
    legacy_runs: legacyRuns,
    v2_unclassified_runs: v2Unclassified,
    stalled: stalled.length,
    trend,
  }, null, 2));
  // --json 也要守 --fail-on-stall：CI 里多半就是拿 --json 消费的。
  process.exit(failOnStall && stalled.length ? 1 : 0);
}

console.log('门失败统计');
console.log('='.repeat(64));
// 日志可能来自多份（-r 递归）：逐份列出相对路径，只列头 3 份避免刷屏。
const srcLabel = logs.slice(0, 3).map((x) => (x.origin ? `${x.origin}/.gates.jsonl` : '.gates.jsonl')).join('、')
  + (logs.length > 3 ? ` 等 ${logs.length} 份` : '');
console.log(`数据源：${logs.length === 1 ? logs[0].p : `${roots.join('、')}（${logs.length} 份日志：${srcLabel}）`}`);
console.log(`运行 ${runs.length} 次 ｜ 文件 ${files.size} 个 ｜ ` +
  Object.entries(byTool).map(([t, n]) => `${t} ×${n}`).join('，'));
console.log(`来源：real ${origins.real} ｜ golden ${origins.golden} ｜ selftest ${origins.selftest} ｜ 未标 ${origins.unknown}` +
  (realPct === null ? '（记录均未标 origin——跑一轮 v5.50.0 后的门即有）' : `（real 占 ${realPct}%）`));
if (knownRuns >= 10 && realPct < 50) {
  console.log('  ⚠️  real 占比不过半——门效榜单暂只能读成「自测/样例数据」，死码去留别据此裁（P0-3 口径）。');
}
console.log('='.repeat(64));

if (top.length === 0 && skipTotal === 0) {
  console.log('\n✅ 记录里没有任何规则码命中——要么包全部通过，要么还没跑过有问题的包。');
  if (naTotal > 0) {
    // 全绿但有不适用：不能就这么收工，「不适用」的门从来没被验证过。
    console.log(`   注意：另有 ${naTotal} 条不适用（本包没那个场景），它们不算「验过」。`);
  }
  process.exit(0);
}

if (top.length === 0) {
  // 只有「未查」，没有一条真命中：不能报 ✅，那是「什么都没查」的绿色。
  console.log('\n⚠️  记录里没有真命中，但有未查的门 —— 这不等于包没问题。');
} else {
  console.log(`\n最常响的规则码 Top ${top.length}：\n`);
  for (const [code, a] of top) {
    console.log(`  ×${String(a.count).padStart(4)}  ${code.padEnd(28)} [${[...a.tools].join(',')}]`);
    console.log(`         最近：${a.lastTs.slice(0, 19).replace('T', ' ')}  ${a.lastFile}`);
  }
}

if (naTotal > 0) {
  console.log(`\n另有 ${naTotal} 条「不适用」：本包没有那个场景（如无「镜头裁定」表），该门不该跑。`);
  console.log('  —— 不适用 ≠ 通过：它意味着这一门你**永远没验过**，别把它算进「验过」的账。');
}

if (skipTotal > 0) {
  const _skipWho = Object.keys(skipped).length
    ? Object.entries(skipped).map(([c, a]) => `${c} ×${a.count}`).join('，')
    : '日志里只记了 skips 条数、没有对应码号';
  console.log(`\n另有 ${skipTotal} 条「未查」（${_skipWho}）：`);
  console.log('  —— 这些不是「响了」，是「那段判据没跑」。按下一步动作分两类：');
  if (skipIn) console.log(`     缺输入 ${skipIn} 条：文件在项目里、只是没传参 → 跑一次 --auto / --config auto`);
  if (skipMiss) console.log(`     缺产物 ${skipMiss} 条：项目里根本没有这份文件 → 补参数永远补不上，先做上游那道工序`);
  if (skipTh) console.log(`     门槛   ${skipTh} 条：补参数没用，样本量或粒度不够 —— 换粒度复扫`);
  if (skipUn) {
    let _why;
    if (v2Unclassified) {
      _why = `${v2Unclassified} 条记录是 v2 且有未查、却完全没带分类字段——`
        + '要么是 node 侧脚本（本来就不分类），要么是新写的未查消息忘了带 kind（代码问题）';
    } else if (legacyWithSkips) {
      _why = `${legacyWithSkips} 条记录是 v1 老格式（无 v 字段，采集时还没有分类）——`
        + '重跑一次就会带上分类，不是漏标';
    } else {
      _why = '这些记录的未查消息没带类别';
    }
    console.log(`     未分类 ${skipUn} 条：${_why}`);
  }
  console.log('  —— 未查 ≠ 通过：把它当成绿灯，等于把一道没跑的门当成一把锁。');
}

if (trend.length) {
  console.log(`\n历史趋势（同一文件 + 同一工具，取最近 ${LOOKBACK} 次）：`);
  for (const t of trend) {
    console.log(`\n  ${t.file} · ${t.tool}  ×${t.runs}${t.total > t.runs ? `（共 ${t.total} 次）` : ''}`);
    const row = (label, arr) => console.log(`    ${label}  ${arr.join(' → ')}`);
    row('error ', t.errors);
    row('warn  ', t.warns);
    row('未查  ', t.skips);
    console.log(`    → ${t.verdict}`);
  }
}

if (stalled.length) {
  console.log(`\n⚠️  ${stalled.length} 组「停滞」：最近 3 次一模一样，说明没人动它。`);
  if (failOnStall) console.log('   （--fail-on-stall 下视为失败，退出码 1）');
}

console.log('\n判读：');
if (top.length) {
  console.log(`  · 最常响的是「${top[0][0]}」—— 那条规则最常被无视，优先改它的措辞或提示文案；`);
}
console.log('  · 一直不响的码可能是死门，也可能是规则已被内化，对照码表人工判断；');
console.log('  · 改完措辞重跑统计，看该码计数是否回落。');

// 只在显式开启时改变退出码：默认行为（人看统计）必须保持不变。
if (failOnStall && stalled.length) process.exit(1);
