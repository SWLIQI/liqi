#!/usr/bin/env node
/**
 * gates_dead_codes.mjs —— 门效盘点：哪些码在实战里真的响过，哪些从没响过
 *
 * 🔴 本脚本是【报表】，不是【门】。它零判断、零拦截、恒退 0（用法错退 2）。
 *    理由与「生成批次单」同一条：纯汇总项做成门就是假绿门——
 *    一份「有 116 个死码」的报告本身不是缺陷，把它变成失败条件才是。
 *
 * 治什么病：
 *   v5.37.5~5.37.14 十个版本都在治「假绿」——门没跑却报通过。
 *   但「按 gates_stats 排优先级」这条规矩建立在一份从没被真正采集过的数据上：
 *   全库 562 条记录里 556 条来自 3 个黄金样例的自测，真实项目日志只有个位数。
 *   报表能跑通 ≠ 数据够用。本脚本第一屏就把「数据量」摆在结论前面，
 *   就是为了让「空数据上排出来的优先级」自己暴露出来。
 *
 * 与 gates_stats.mjs 的分工：
 *   gates_stats.mjs  —— 按「文件」聚合趋势，回答「这个包在收敛吗，还是停滞」
 *   gates_dead_codes.mjs —— 按「码」聚合覆盖，回答「这条码到底有没有活过」
 *
 * 用法：
 *   node scripts/gates_dead_codes.mjs [目录…] [--all] [--json] [--min N]
 *
 *   （无目录参数时扫当前目录及子目录下所有 .gates.jsonl）
 *   --all      列出全部响过的码，默认只列 Top 20
 *   --json     输出机器可读 JSON（供 CI / 看板消费）
 *   --min N    只列计数 ≥ N 的码（默认 1）
 *
 * 退出码：0 = 报表已出（无论结论如何）；2 = 用法/读取错误
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const showAll = argv.includes('--all');
const minIdx = argv.indexOf('--min');
const MIN = minIdx >= 0 && argv[minIdx + 1] ? Number(argv[minIdx + 1]) : 1;
const dirArgs = argv.filter((a, i) => !a.startsWith('--') && !(minIdx >= 0 && i === minIdx + 1));
const targets = dirArgs.length ? dirArgs.map((d) => resolve(d)) : [process.cwd()];

// 归档文件里的旧码不参与「文档登记」口径（与 check_skill.mjs 同一条理由）
const ARCHIVE_DOCS = new Set(['liqi全景梳理.md']);
const CODE_RE = /\b([EWS]-[A-Z][A-Z0-9-]*)\b/g;
const PREFIX_RE = /\b[EWS]-[A-Z][A-Z0-9-]*-\*/g;

// ── 采集：所有 .gates.jsonl ───────────────────────────────────────────────
function findLogs(dir, out = []) {
  let st;
  try { st = statSync(dir); } catch { return out; }
  if (st.isFile()) { if (dir.endsWith('.gates.jsonl')) out.push(dir); return out; }
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) findLogs(p, out);
    else if (e.name === '.gates.jsonl') out.push(p);
  }
  return out;
}

const logs = [];
for (const t of targets) findLogs(t, logs);
const uniqLogs = [...new Set(logs)];

if (!uniqLogs.length) {
  const msg = `❌ 在 ${targets.join('、')} 下没找到任何 .gates.jsonl——没有日志不等于没有死码，是「没测」`;
  if (asJson) console.log(JSON.stringify({ error: 'no-logs', targets }, null, 2));
  else console.error(msg);
  process.exit(2);
}

const codeCount = new Map();          // code -> 次数
const codeTools = new Map();          // code -> Set(tool)
const toolRuns = new Map();           // tool -> 次数
const skipTotals = new Map();         // tool -> skip 数
let records = 0, malformed = 0, withSkip = 0;
// P0-3（v5.50.0）：记录来源分组——死码治理只认 real，报表头必须能让「自测数据自证」现形。
const originCnt = { real: 0, golden: 0, selftest: 0, unknown: 0 };
let tsMin = '', tsMax = '';

for (const fp of uniqLogs) {
  let text = '';
  try { text = readFileSync(fp, 'utf-8'); } catch { malformed++; continue; }
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let r;
    try { r = JSON.parse(s); } catch { malformed++; continue; }
    records++;
    originCnt[typeof r.origin === 'string' && r.origin in originCnt ? r.origin : 'unknown'] += 1;
    const tool = r.tool || '(未标工具)';
    toolRuns.set(tool, (toolRuns.get(tool) || 0) + 1);
    if (typeof r.ts === 'string' && r.ts) {
      if (!tsMin || r.ts < tsMin) tsMin = r.ts;
      if (!tsMax || r.ts > tsMax) tsMax = r.ts;
    }
    if (typeof r.skips === 'number' && r.skips > 0) {
      skipTotals.set(tool, (skipTotals.get(tool) || 0) + r.skips);
      withSkip += r.skips;
    }
    const codes = r.codes && typeof r.codes === 'object' ? r.codes : {};
    for (const [c, n] of Object.entries(codes)) {
      const k = String(c);
      const v = Number(n) || 1;
      codeCount.set(k, (codeCount.get(k) || 0) + v);
      if (!codeTools.has(k)) codeTools.set(k, new Set());
      codeTools.get(k).add(tool);
    }
  }
}

// ── 文档登记口径 ─────────────────────────────────────────────────────────
// 注意两种写法并存：check_prompt 的 E-/W- 码在文档里写全名（`E-TIMELINE-GAP`），
// 而 check_style 的 S 码与契约核销的 CT 项常写成裸号（`S1` / `CT3`）。
// 只按全名比对，会把 S1-STYLE-UNDECLARED 误报成「文档里查不到」——那是脚本的假阳性，不是文档缺登记。
const docCodes = new Set();
const docBare = new Set();          // 裸号：S1 / S2 / CT3 …
const refDir = join(ROOT, 'references');
if (existsSync(refDir)) {
  for (const f of readdirSync(refDir)) {
    if (!f.endsWith('.md') || ARCHIVE_DOCS.has(f)) continue;
    let t = '';
    try { t = readFileSync(join(refDir, f), 'utf-8'); } catch { continue; }
    const clean = t.replace(PREFIX_RE, '');
    for (const m of clean.matchAll(CODE_RE)) docCodes.add(m[1]);
    for (const m of clean.matchAll(/\b(S[0-9]{1,2}|CT[1-8])\b/g)) docBare.add(m[1]);
  }
}
// 带后缀的 S 码（S1-STYLE-UNDECLARED）只要裸号 S1 在文档里登记过就算登记
const isRegistered = (code) => {
  if (docCodes.has(code)) return true;
  const m = code.match(/^(S[0-9]{1,2}|CT[1-8])(?:[-:]|$)/);
  return !!(m && docBare.has(m[1]));
};
const registeredTotal = docCodes.size;   // 只数全名码；裸号另见 docBare

const fired = [...codeCount.entries()]
  .filter(([, n]) => n >= MIN)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const dead = [...docCodes].filter((c) => !codeCount.has(c)).sort();
// 「文档无」只查真正的规则码。S 码带后缀时是 S1-STYLE-UNDECLARED（不带横线的 S-），
// 所以判定要用 CODE_LIKE 而不是 `^[EWS]-`——否则 S 码会被误判成「非规则码」。
const CODE_LIKE = /^(?:[EWS]-|S[0-9]|CT[1-8])/;
const undoc = [...codeCount.keys()]
  .filter((c) => CODE_LIKE.test(c) && !isRegistered(c))
  .sort();
// 剩下的才是真·汇总键：SEC-SKIP / SEC-NA / SEC:B / 词:肌肉
const synthetic = [...codeCount.keys()]
  .filter((c) => !CODE_LIKE.test(c))
  .sort();

// S 码在文档里是裸号（S1），所以不能只认 `S-` 前缀
const byPrefix = (arr, p) => arr.filter((c) => c.startsWith(p + '-') || (p === 'S' && /^S[0-9]/.test(c)));

if (asJson) {
  const knownRecs = records - originCnt.unknown;
  const realShare = knownRecs ? Math.round((originCnt.real / knownRecs) * 100) : null;
  console.log(JSON.stringify({
    scope: { targets, logs: uniqLogs.length },
    data: {
      records, malformed, skipSignals: withSkip,
      origins: originCnt,
      real_pct: realShare,
      tsRange: [tsMin, tsMax],
      tools: Object.fromEntries([...toolRuns.entries()].sort((a, b) => b[1] - a[1])),
    },
    fired: fired.map(([code, n]) => ({ code, n, tools: [...(codeTools.get(code) || [])] })),
    dead: { total: dead.length, registered: registeredTotal, byPrefix: { E: byPrefix(dead, 'E'), W: byPrefix(dead, 'W'), S: byPrefix(dead, 'S'), other: dead.filter((c) => !/^[EWS]/.test(c)) } },
    undocumented: undoc,
    nonCodeKeys: synthetic,
  }, null, 2));
  process.exit(0);
}

// ── 人读报表 ─────────────────────────────────────────────────────────────
const L = (s = '') => console.log(s);
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));

L('');
L('门效盘点（哪些码真响过）');
L('='.repeat(64));
L(`扫描：${uniqLogs.length} 个 .gates.jsonl ｜ 记录 ${records} 条 ｜ 解析失败 ${malformed} 条`);
if (tsMin) L(`时间跨度：${tsMin.slice(0, 10)} → ${tsMax.slice(0, 10)}`);
{
  const knownRecs = records - originCnt.unknown;
  const realShare = knownRecs ? Math.round((originCnt.real / knownRecs) * 100) : null;
  L(`来源：real ${originCnt.real} ｜ golden ${originCnt.golden} ｜ selftest ${originCnt.selftest} ｜ 未标 ${originCnt.unknown}` +
    (realShare === null ? '（记录均未标 origin——跑一轮 v5.50.0 后的门即有）' : `（real 占 ${realShare}%）`));
  if (knownRecs >= 10 && realShare !== null && realShare < 50) {
    L('  ⚠️  real 占比不过半——死码清单主要由自测/样例数据支撑，去留别据此裁（P0-3 口径）。');
  }
}
L('');

L('一、数据够不够（先看这个，再看结论）');
L('-'.repeat(64));
const toolRows = [...toolRuns.entries()].sort((a, b) => b[1] - a[1]);
for (const [t, n] of toolRows) L(`  ${pad(n, 5)}  ${t}`);
L('');
if (records < 100) {
  L('  ⚠️  记录不足 100 条。此时的「死码清单」主要是「没人跑过」，');
  L('     不是「规则没价值」——两者结论完全相反，别拿去当删码依据。');
} else if (records < 1000) {
  L('  ⚠️  记录量偏少。死码清单可作参考，但还不能据此删码。');
} else {
  L('  ✅ 记录量足够做覆盖判断。');
}
if (withSkip) L(`  另有「跳过/未查」信号 ${withSkip} 条（比任何单个码都多时，说明问题是没跑，不是没规则）`);
L('');

L(`二、真的响过（${fired.length} 个码，${showAll ? '全部' : 'Top 20'}）`);
L('-'.repeat(64));
if (!fired.length) {
  L('  （一个都没有。日志存在但 codes 全空 = 这些文件全绿，或门根本没扫到正文）');
} else {
  for (const [code, n] of (showAll ? fired : fired.slice(0, 20))) {
    L(`  ${pad(n, 5)}  ${pad(code, 34)} ${[...(codeTools.get(code) || [])].join(',')}`);
  }
  if (!showAll && fired.length > 20) L(`  … 另有 ${fired.length - 20} 个，用 --all 展开`);
}
L('');

L(`三、从没响过（${dead.length} / ${registeredTotal} 个登记码）`);
L('-'.repeat(64));
if (!docCodes.size) {
  L('  ⚠️  读不到 references/ 里的登记码，本节跳过（不是 0 个死码）');
} else {
  for (const p of ['E', 'W', 'S']) {
    const list = byPrefix(dead, p);
    if (!list.length) continue;
    L(`  ${p}-*：${list.length} 个`);
    for (let i = 0; i < list.length; i += 3) L('    ' + list.slice(i, i + 3).map((c) => pad(c, 32)).join(''));
  }
  const other = dead.filter((c) => !/^[EWS]/.test(c));
  if (other.length) L(`  其他：${other.join('  ')}`);
}
L('');

L(`四、日志有、文档无（${undoc.length} 个）`);
L('-'.repeat(64));
if (!docCodes.size) {
  L('  ⚠️  读不到 references/，本节跳过（不是 0 个）');
} else {
  L(undoc.length ? '  ' + undoc.join('  ') : '  （无。规则码名全都能在 references/ 里查到含义）');
}
if (synthetic.length) {
  L('');
  L(`  另：日志里的「非规则码汇总键」${synthetic.length} 个（不是码，不进两向对照）：`);
  L('  ' + synthetic.join('  '));
}
L('');

L('五、怎么读这份报表');
L('-'.repeat(64));
L('  · 「从没响过」有三种成因，必须分开处理，别一锅端：');
L('      ① 真没场景（规则合理，只是这类包没做过）→ 保留，标「未验证」');
L('      ② 参数没人传（opt-in 门，如 --foreshadow / --decisions）→ 是流程缺口，不是规则缺口');
L('      ③ 已废弃（被新码取代）→ 删，并同步删文档');
L('  · 「响过但只有 1 次」的码比死码更值得看——可能是误报。');
L('  · 排序依据只能是本报表，不是待办清单的顺序。见 references/待办路线图.md。');
L('');
L('='.repeat(64));
process.exit(0);
