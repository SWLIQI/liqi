#!/usr/bin/env node
/**
 * selftest_gates_stats.mjs —— 「未查分类 + 历史趋势」回归（v5.37.6）
 *
 * 为什么要有这份：`gates_stats.mjs` 的输出是**判读结论**，不是原始数据。
 * 「停滞：最近 3 次都是 10」这句话只要判据错一点，就会变成「已清零」——
 * 而用户看到「已清零」会真的以为收敛了。结论错比数字错危险得多，所以它自己要上锁。
 *
 * 覆盖：
 *   S1  未查 10 / 10 / 10        → 「停滞」（不是「稳定」）
 *   S2  未查 8 / 6 / 4           → 「在收敛」
 *   S3  未查 2 / 5 / 9           → 「在恶化」
 *   S4  未查 10 / 0              → 「已清零」
 *   S5  只跑过 1 次              → 不进趋势（一次谈不上趋势）
 *   S6  带 skip_input / thresh   → 分类合计对得上
 *   S7  老记录（无分类字段）      → 全算「未分类」，不并进「缺输入」
 *   S8  SEC-SKIP 不计入 Top 榜   → 不能出现「最常响的是 SEC-SKIP」
 *   S9  缺产物与缺输入分开计       → 不并成一类（下一步动作不同：补参数 vs 先造产物）
 *   S10 --lookback 只取最近 N 次
 *   S11 SEC-NA 单开一桶          → 不进 Top 榜、不计入未查总数（不适用 ≠ 没跑）
 *   S12 --fail-on-stall          → 默认不改退出码；开启后停滞退 1，收敛不退
 *   S13 记录有 skips/nas 无码号   → 不许当全绿（码号桶空 ≠ 没发生）
 *   S14 schema 版本               → v1 老记录与 v2 漏标能分开（重跑 vs 改代码）
 *   S15 -r 递归发现子目录日志      → 不带 -r 时子目录的不进来（默认行为不变）
 *   S16 -r 后同名包不串味          → 两处 包.md 各成一条趋势，不并成一条
 *   S17 -r 后 files 按 origin 计   → 同名文件不会被折叠成一个
 *   S18 origin 来源分组            → real/golden/selftest/未标 各自计数，real 占比可算
 *                                    （P0-3：死码治理只认 real，自测数据必须能从报表头上分开）
 *
 * 用法：node scripts/selftest_gates_stats.mjs
 * 退出码：0 = 全过；1 = 有败
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATS = path.join(HERE, 'gates_stats.mjs');

let pass = 0;
const fails = [];

/** 造一份 .gates.jsonl 并跑 stats --json。runs 里只写关心的字段。 */
function makeLog(runs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liqi_gs_'));
  const lines = runs.map((r, i) => JSON.stringify({
    // ts 必须可字符串比较：stats 按 ts 排序取「最近 N 次」
    ts: `2026-10-20T04:0${i}:00.000Z`,
    tool: 'audit_project.py',
    file: '包.md',
    exit: 2,
    errors: 0,
    warns: 0,
    skips: 0,
    codes: {},
    ...r,
  }));
  fs.writeFileSync(path.join(dir, '.gates.jsonl'), lines.join('\n') + '\n', 'utf8');
  return dir;
}

function stats(runs, extraArgs = []) {
  const dir = makeLog(runs);
  try {
    const out = execFileSync(process.execPath, [STATS, dir, '--json', ...extraArgs], { encoding: 'utf8' });
    return JSON.parse(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 同上，但**不因退出码非 0 抛异常**——要断言退出码本身时用这个。 */
function statsStatus(runs, extraArgs = []) {
  const dir = makeLog(runs);
  try {
    const r = spawnSync(process.execPath, [STATS, dir, ...extraArgs], { encoding: 'utf8' });
    return r.status;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function check(name, fn) {
  let ok = false;
  let why = '';
  try {
    const r = fn();
    ok = r === true;
    why = ok ? '' : String(r);
  } catch (e) {
    why = `抛异常：${e.message}`;
  }
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (ok) pass += 1;
  else fails.push(`${name}：${why}`);
}

const series = (ns) => ns.map((n) => ({ skips: n }));

// ---- S1~S4：判读结论 ----
check('S1 未查 10 / 10 / 10 → 「停滞」', () => {
  const v = stats(series([10, 10, 10])).trend[0];
  return (v && v.verdict.startsWith('停滞')) || `判为「${v && v.verdict}」`;
});

check('S2 未查 8 / 6 / 4 → 「在收敛」', () => {
  const v = stats(series([8, 6, 4])).trend[0];
  return (v && v.verdict.startsWith('在收敛')) || `判为「${v && v.verdict}」`;
});

check('S3 未查 2 / 5 / 9 → 「在恶化」', () => {
  const v = stats(series([2, 5, 9])).trend[0];
  return (v && v.verdict.startsWith('在恶化')) || `判为「${v && v.verdict}」`;
});

check('S4 未查 10 / 0 → 「已清零」', () => {
  const v = stats(series([10, 0])).trend[0];
  return (v && v.verdict === '已清零') || `判为「${v && v.verdict}」`;
});

check('S5 只跑过 1 次 → 不进趋势', () => {
  const d = stats(series([10]));
  return d.trend.length === 0 || `趋势里出现了 ${d.trend.length} 组`;
});

// ---- S6/S7：分类合计 ----
check('S6 带分类字段 → 缺输入 / 门槛 / 未分类 各自累加', () => {
  const d = stats([
    { skips: 4, skip_input: 3, skip_thresh: 1, skip_untagged: 0 },
    { skips: 2, skip_input: 0, skip_thresh: 2, skip_untagged: 0 },
  ]);
  const k = d.skipped_kinds;
  return (k.input === 3 && k.thresh === 3 && k.untagged === 0)
    || `input=${k.input} thresh=${k.thresh} untagged=${k.untagged}（应 3/3/0）`;
});

check('S7 老记录无分类字段 → 全算「未分类」，不并进「缺输入」', () => {
  const d = stats([{ skips: 5 }]);
  const k = d.skipped_kinds;
  // 老记录没有分类，`skips` 只能是「未分类」。并进「缺输入」会让用户
  // 按「补个参数就行」去处理一批还不知道是什么原因的未查。
  return (k.input === 0 && k.untagged === 5)
    || `input=${k.input} untagged=${k.untagged}（应 0/5）`;
});

// ---- S8：未查不进 Top 榜 ----
check('S8 SEC-SKIP 不进「最常响」榜', () => {
  const d = stats([
    { skips: 3, codes: { 'SEC-SKIP': 3, 'E-SECTION-MISSING': 1 } },
  ]);
  const codes = d.top.map((t) => t.code);
  return (!codes.includes('SEC-SKIP') && codes.includes('E-SECTION-MISSING'))
    || `Top 榜=${JSON.stringify(codes)}`;
});

check('S9 缺产物与缺输入分开计，不并成一类', () => {
  const d = stats([
    { skips: 12, skip_input: 1, skip_missing: 10, skip_thresh: 1, skip_untagged: 0 },
  ]);
  const k = d.skipped_kinds;
  // 缺产物若被并进缺输入，报告会说「跑一次 --auto 就少了 11 条」——用户跑了，
  // 一条都不会少，因为那 10 份文件根本没做出来。这正是要防的误导。
  return (k.input === 1 && k.missing === 10 && k.thresh === 1)
    || `input=${k.input} missing=${k.missing} thresh=${k.thresh}（应 1/10/1）`;
});

check('S10 --lookback 只取最近 N 次', () => {
  const d = stats(series([9, 8, 7, 6, 5, 4, 3]), ['--lookback', '2']);
  const t = d.trend[0];
  return (t && t.runs === 2 && t.skips.join(',') === '4,3')
    || `runs=${t && t.runs} skips=${t && t.skips.join(',')}（应 2 / 4,3）`;
});

check('S11 SEC-NA 单开一桶：不进 Top 榜、不计入未查总数', () => {
  const d = stats([
    { skips: 3, nas: 1, skip_input: 3, codes: { 'SEC-NA': 1, 'SEC-SKIP': 3 } },
  ]);
  // 不适用被并进未查的话，报告会说「有 4 条没跑」——其中 1 条本来就不该跑。
  return (d.na_total === 1 && d.skipped_total === 3 && !d.top.some((t) => t.code === 'SEC-NA'))
    || `na=${d.na_total} skip=${d.skipped_total} top=${JSON.stringify(d.top.map((t) => t.code))}`;
});

check('S12 --fail-on-stall：默认不改退出码，开启后停滞即失败', () => {
  // 默认必须保持 0——现有用法是「人看统计」，不能因为它多了个判据就突然变红。
  const dflt = statsStatus(series([10, 10, 10]));
  const stall = statsStatus(series([10, 10, 10]), ['--fail-on-stall']);
  const shrink = statsStatus(series([10, 6, 0]), ['--fail-on-stall']);
  // 收敛的不该被判失败，否则这个开关只会教人把它关掉。
  return (dflt === 0 && stall === 1 && shrink === 0)
    || `默认=${dflt}（应 0） 停滞=${stall}（应 1） 收敛=${shrink}（应 0）`;
});

check('S13 记录有 skips/nas 但无码号 → 不能当全绿', () => {
  // 只给 skips/nas、不给 codes：旧实现只看码号桶 ⇒ 桶是空的 ⇒ 走进「✅ 没有任何命中」。
  // 日志明说 10 条没跑，报告却全绿——这就是本库一直在防的假绿。
  const d = stats([{ skips: 10, nas: 1 }]);
  return (d.skipped_total === 10 && d.na_total === 1)
    || `skipped_total=${d.skipped_total}（应 10） na_total=${d.na_total}（应 1）`;
});

check('S14 schema 版本：v1 老记录与 v2 漏标能分开', () => {
  // 没有 v 字段 = v1（采集时还没有分类字段）；v2 有 skips 却一个分类字段都没写 = 漏标。
  // 分不开的话，提示语只能含糊地写「或者是老记录」——而这两件事的下一步完全不同：
  // 前者重跑一次就有，后者要去改代码。
  const a = stats([{ skips: 5 }]);
  const b = stats([{ v: 2, skips: 5 }]);
  const ok1 = a.legacy_runs === 1 && a.v2_unclassified_runs === 0;
  const ok2 = b.legacy_runs === 0 && b.v2_unclassified_runs === 1;
  return (ok1 && ok2)
    || `v1: legacy=${a.legacy_runs}/v2漏标=${a.v2_unclassified_runs}（应 1/0）；`
     + `v2: legacy=${b.legacy_runs}/v2漏标=${b.v2_unclassified_runs}（应 0/1）`;
});

// ---- S15~S17：递归聚合（v5.37.16）----
//
// 为什么要有这三组：日志写在「被校验文件同目录」，包放在 项目/分镜/ 下就落到 分镜/。
// 一个项目跑几次会散成好几份，默认只读顶层 = 只看到一部分，而用户会把它当全量读。
// 递归是解法，但递归一开就有两个新风险：① 子目录被意外纳入（改变既有口径）；
// ② 两处同名 `包.md` 被并成同一条趋势（数字对不上还看不出来）。各锁一组。

/** 造一棵树：{dir: 相对子目录, runs: [...]}。 */
function makeTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'liqi_gs_tree_'));
  for (const s of spec) {
    const d = s.dir ? path.join(root, s.dir) : root;
    fs.mkdirSync(d, { recursive: true });
    const lines = s.runs.map((r, i) => JSON.stringify({
      ts: `2026-10-20T04:${String(i).padStart(2, '0')}:00.000Z`,
      tool: 'audit_project.py', file: '包.md', exit: 2,
      errors: 0, warns: 0, skips: 0, codes: {}, ...r,
    }));
    fs.writeFileSync(path.join(d, '.gates.jsonl'), lines.join('\n') + '\n', 'utf8');
  }
  return root;
}

function statsTree(spec, extraArgs = []) {
  const root = makeTree(spec);
  try {
    const args = [STATS, root, '--json', ...extraArgs];
    const out = execFileSync(process.execPath, args, { encoding: 'utf8' });
    return JSON.parse(out);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

check('S15 不带 -r 时子目录日志不进来（默认行为不变）', () => {
  const spec = [{ dir: '', runs: [{ skips: 1 }, { skips: 1 }] },
                { dir: '分镜', runs: [{ skips: 1 }, { skips: 1 }, { skips: 1 }] }];
  const dflt = statsTree(spec).runs;
  const rec = statsTree(spec, ['-r']).runs;
  return (dflt === 2 && rec === 5) || `默认=${dflt}（应 2） 递归=${rec}（应 5）`;
});

check('S16 -r 后两处同名包各成一条趋势，不并成一条', () => {
  // 并成一条的话，两处「包.md」的历史会被混着排序，趋势结论整个失真。
  const spec = [{ dir: '', runs: [{ skips: 10 }, { skips: 0 }] },
                { dir: '分镜', runs: [{ skips: 10 }, { skips: 10 }] }];
  const d = statsTree(spec, ['-r']);
  const files = [...d.files].sort().join(',');
  return (d.trend.length === 2 && files === '分镜/包.md,包.md')
    || `趋势组=${d.trend.length}（应 2） files=${files}（应 分镜/包.md,包.md）`;
});

check('S17 -r 下文件的 origin 前缀要进趋势条目，便于定位', () => {
  const spec = [{ dir: 'E01', runs: [{ skips: 3 }, { skips: 2 }] }];
  // 只有子目录一份日志：递归能找到；不带 -r 则顶层没有 → 直接「没有找到」退出 0。
  const d = statsTree(spec, ['-r']);
  const t0 = d.trend[0];
  return (t0 && t0.file === 'E01/包.md') || `trend[0].file=${t0 && t0.file}（应 E01/包.md）`;
});

// ---- S18：来源分组（P0-3，v5.50.0）----
// 此前 562 条记录里 556 条来自黄金样例自测，real 占比只活在注释里——「按门效数据排
// 优先级」的地基是自证。老记录无 origin → 未标，**未标不许被算成 real**（否则老日志
// 一多，占比又变成想要什么结论就有什么结论）。
check('S18 origin 分组：real/golden/selftest/未标 各自计数，未标不算 real', () => {
  const d = stats([
    { origin: 'real', skips: 1 },
    { origin: 'real', skips: 1 },
    { origin: 'selftest', skips: 2 },
    { skips: 3 },               // 老记录无 origin → 未标
  ]);
  const o = d.origins;
  return (o.real === 2 && o.selftest === 1 && o.unknown === 1 && o.golden === 0 && d.real_pct === 67)
    || `real=${o.real} golden=${o.golden} selftest=${o.selftest} 未标=${o.unknown} real_pct=${d.real_pct}（应 2/0/1/1/67）`;
});

console.log(`\n结果：${pass} 过 / ${fails.length} 败`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
