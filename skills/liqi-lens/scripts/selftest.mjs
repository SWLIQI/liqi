#!/usr/bin/env node
// 自测：词表/哈希、合格/不合格样例、逐项变异、输出模式、坏 JSON、同步跳过。零依赖。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const run = (s, a, opts) => spawnSync(process.execPath, [path.join(HERE, s), ...a], { encoding: 'utf8', ...(opts || {}) });
const results = [];
const check = (n, c, e) => results.push([n, c, e || '']);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liqi-lens-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* noop */ } });
const sameAs = (rel, out) => out.replace(/\r\n/g, '\n') ===
  fs.readFileSync(path.join(ROOT, 'examples', rel), 'utf8').replace(/\r\n/g, '\n');
const clone = o => JSON.parse(JSON.stringify(o));
const writeTmp = (name, obj) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2), 'utf8');
  return p;
};

let vocab;
let synced;
let good;
try {
  vocab = JSON.parse(fs.readFileSync(path.join(ROOT, 'lens-vocab.json'), 'utf8'));
  synced = JSON.parse(fs.readFileSync(path.join(ROOT, 'SYNCED.json'), 'utf8'));
  good = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'shot-list-good.json'), 'utf8'));
} catch (e) {
  console.error('ERROR: 读不了词表/同步清单/样例：' + e.message);
  process.exit(1);
}
const badPath = path.join(ROOT, 'examples', 'shot-list-bad.json');
const goodPath = path.join(ROOT, 'examples', 'shot-list-good.json');

// 1) 词表与同步
check('景别 9 档且编号 1–9', vocab.shotSizes.length === 9 && vocab.shotSizes.every((s, i) => s.level === i + 1));
check('景别英文缩写唯一', new Set(vocab.shotSizes.map(s => s.en)).size === vocab.shotSizes.length);
check('Q9 门槛不超过 7 词表上限', vocab.quota.moveKindsMin >= 1 && vocab.quota.moveKindsMin <= vocab.moves.length);
check('焦段 7 档', vocab.fov.length === 7 && vocab.fov.every(f => [135, 107, 84, 47, 29, 18, 8].includes(f.deg)));
check('运镜 7 词', vocab.moves.length === 7 && new Set(vocab.moves).size === 7);
check('词表枚举完整', vocab.angles.length >= 9 && vocab.lightDirections.length === 6 && vocab.tasks.length === 3 &&
  vocab.transitions.length === 4 && vocab.compositions.length === 4 && vocab.heavyTechniques.length === 7);
check('来源哈希与 SYNCED 一致', Object.keys(vocab.sourceHashes).length === 5 &&
  Object.entries(vocab.sourceHashes).every(([k, v]) => synced.sources['references/' + k] === v));

// 2) 合格样例
const ok = run('check_lens.mjs', [goodPath]);
check('合格样例 exit=0', ok.status === 0, 'status=' + ok.status);
check('合格样例 0 ERROR / 0 WARN', /结果：0 ERROR \/ 0 WARN/.test(ok.stdout), ok.stdout.slice(-200));
check('合格样例统计 6 镜 / 2 段', /6 镜 \/ 2 段/.test(ok.stdout));
check('短包 Q9 明示未查', /Q9 本门未查/.test(ok.stdout) && /未查 ≠ 通过/.test(ok.stdout));
check('Q2 明示需人工', /Q2 常规机位占比：需人工/.test(ok.stdout));

const cards = run('shot_list.mjs', [goodPath]);
check('shot_list exit=0', cards.status === 0, 'status=' + cards.status);
check('卡片含景别/光/防漂移', /景别：/.test(cards.stdout) && /光源：/.test(cards.stdout) && /防漂移：/.test(cards.stdout));
check('卡片含轴线', /轴线：沈知微在画面左三分之一/.test(cards.stdout));
const md = run('shot_list.mjs', [goodPath, '--md']);
check('--md 输出表头与 6 行', /^\| # \| 场景/m.test(md.stdout) && (md.stdout.match(/^\| \d\d \|/gm) || []).length === 6);
const json = run('shot_list.mjs', [goodPath, '--json']);
let jsonOk = false;
try {
  const j = JSON.parse(json.stdout);
  jsonOk = j.shots.length === 6 && j.shots[2].level === 8 && j.shots[2].perspective === '长焦' && !!j.shots[2].drift_guard;
} catch (e) { /* noop */ }
check('--json 可解析且派生字段正确', json.status === 0 && jsonOk);

// 3) 不合格样例
const bad = run('check_lens.mjs', [badPath]);
check('不合格样例 exit=1', bad.status === 1, 'status=' + bad.status);
[
  ['缺三任务', /task 必须是三任务之一/],
  ['抽象词', /抽象词「电影感」/],
  ['非法景别', /shot_size 不在 9 档里/],
  ['非法焦段', /fov_deg 不在/],
  ['缺物理光源', /缺 light_source/],
  ['高级感', /抽象词「高级感」/],
  ['时长越界', /duration 必须在 2–15 秒/],
  ['裸跨轴', /跨轴，但没写 cross_axis/],
  ['连续同运镜', /连续第 3 镜同运镜/],
  ['荷兰角超配', /荷兰角 2 次/],
  ['重技法超限', /重技法「滑动变焦」2 次/]
].forEach(([n, re]) => check('坏样例抓到：' + n, re.test(bad.stdout)));
const badCards = run('shot_list.mjs', [badPath]);
check('坏样例不输出镜头卡', badCards.status === 1 && !/【01｜/.test(badCards.stdout));

// 3b) 黄金输出逐行守卫（selftest-output 由 check_golden 守）
check('黄金 check-pass 一致', sameAs('check-pass.txt', ok.stdout));
check('黄金 check-fail 一致', sameAs('check-fail.txt', bad.stdout));
check('黄金 shot-cards 一致', sameAs('shot-cards.txt', cards.stdout));
check('黄金 shot-table 一致', sameAs('shot-table.md', md.stdout));
check('黄金 normalized 一致', sameAs('shot-list.normalized.json', json.stdout));

// 4) 逐项变异
const mutate = (fn, name, re) => {
  const d = clone(good);
  fn(d);
  const p = writeTmp(name, d);
  const r = run('check_lens.mjs', [p]);
  check('变异：' + name, r.status === 1 && re.test(r.stdout), r.stdout.slice(-200));
};
mutate(d => { delete d.shots[1].task; }, 'no-task.json', /task 必须是三任务之一/);
mutate(d => { d.shots[1].shot_size = '中远景'; }, 'bad-size.json', /shot_size 不在 9 档里/);
mutate(d => { d.shots[2].fov_deg = 50; }, 'bad-fov.json', /fov_deg 不在/);
mutate(d => { delete d.shots[3].light_source; }, 'no-light.json', /缺 light_source/);
mutate(d => { d.shots[4].visual += '，电影感'; }, 'abstract.json', /抽象词「电影感」/);
mutate(d => { d.shots[2].angle = '荷兰角'; d.shots[3].angle = '荷兰角'; }, 'dutch.json', /荷兰角 2 次/);
mutate(d => { d.shots[2].technique = '滑动变焦'; d.shots[3].technique = '滑动变焦'; }, 'heavy.json', /重技法「滑动变焦」2 次/);
mutate(d => { d.shots[2].axis += '，电影感'; }, 'abstract-axis.json', /抽象词「电影感」/);
mutate(d => { delete d.shots[2].axis; }, 'no-axis.json', /多人镜缺轴线声明/);
mutate(d => { d.shots[5].axis_side = '右'; }, 'naked-cross.json', /跨轴，但没写 cross_axis/);
mutate(d => { d.shots[2].move = '缓推'; d.shots[3].move = '缓推'; d.shots[4].move = '缓推'; }, 'same-move.json', /连续第 3 镜同运镜/);
mutate(d => { d.shots[0].duration = 20; }, 'bad-duration.json', /duration 必须在 2–15 秒/);

// 缺光比只 WARN，不拦
{
  const d = clone(good);
  delete d.shots[0].light_ratio;
  const r = run('check_lens.mjs', [writeTmp('no-ratio.json', d)]);
  check('缺光比只 WARN 不拦', r.status === 0 && /没写 light_ratio/.test(r.stdout), r.stdout.slice(-160));
}

// 长包：8 镜用满 7 个合法运镜词，Q9 不应再误报（阈值 4）
{
  const d = clone(good);
  const moves = ['固定', '横移', '缓推', '后拉', '跟拍', '缓降'];
  moves.forEach((m, i) => { d.shots[i].move = m; });
  const a = clone(good.shots[3]);
  a.id = '07'; a.move = '微推'; a.subject = '补镜 A'; a.action = '补动作 A'; a.visual = '补画面 A'; a.segment = '段2'; a.subject_type = '人物';
  delete a.axis; delete a.axis_side; delete a.prompt_en;
  const b = clone(good.shots[3]);
  b.id = '08'; b.move = '固定'; b.subject = '补镜 B'; b.action = '补动作 B'; b.visual = '补画面 B'; b.segment = '段2'; b.subject_type = '人物';
  delete b.axis; delete b.axis_side; delete b.prompt_en;
  d.shots.push(a, b);
  const r = run('check_lens.mjs', [writeTmp('long-8.json', d)]);
  check('长包 8 镜 7 词 Q9 不再误报', r.status === 0 && !/Q9 全片运镜种数/.test(r.stdout) && /运镜 7 种/.test(r.stdout), r.stdout.slice(-200));
}

// 轴上作为中性态：不误判跨轴
{
  const d = clone(good);
  d.shots[5].axis_side = '轴上';
  const r = run('check_lens.mjs', [writeTmp('neutral-axis.json', d)]);
  check('轴上作为中性态不误判跨轴', r.status === 0 && !/跨轴，但没写 cross_axis/.test(r.stdout), r.stdout.slice(-200));
}

// 5) 路径 / 参数 / 坏 JSON
const rel = run('check_lens.mjs', ['examples/shot-list-good.json'], { cwd: os.tmpdir() });
check('包外 cwd 相对路径可用', rel.status === 0, 'status=' + rel.status + ' ' + rel.stderr.slice(0, 80));
const noArg = run('shot_list.mjs', []);
check('shot_list 无参数给用法', noArg.status !== 0 && /用法/.test(noArg.stderr));
const both = run('shot_list.mjs', [goodPath, '--md', '--json']);
check('--md/--json 互斥', both.status !== 0 && /不能同时用/.test(both.stderr));

const pkg = path.join(tmp, 'pkg');
fs.mkdirSync(path.join(pkg, 'scripts', 'lib'), { recursive: true });
fs.copyFileSync(path.join(HERE, 'check_lens.mjs'), path.join(pkg, 'scripts', 'check_lens.mjs'));
fs.copyFileSync(path.join(HERE, 'lib', 'io.mjs'), path.join(pkg, 'scripts', 'lib', 'io.mjs'));
fs.copyFileSync(path.join(HERE, 'lib', 'lens.mjs'), path.join(pkg, 'scripts', 'lib', 'lens.mjs'));
fs.copyFileSync(path.join(ROOT, 'lens-vocab.json'), path.join(pkg, 'lens-vocab.json'));
fs.writeFileSync(path.join(pkg, 'broken.json'), '{ broken', 'utf8');
const corrupt = spawnSync(process.execPath, [path.join(pkg, 'scripts', 'check_lens.mjs'), 'broken.json'], { encoding: 'utf8', cwd: pkg });
check('镜头表损坏给中文 ERROR', corrupt.status === 1 && /不是合法 JSON/.test(corrupt.stderr) && !/SyntaxError/.test(corrupt.stderr));

const pkg2 = path.join(tmp, 'pkg2');
fs.mkdirSync(path.join(pkg2, 'scripts', 'lib'), { recursive: true });
fs.copyFileSync(path.join(HERE, 'check_sync.mjs'), path.join(pkg2, 'scripts', 'check_sync.mjs'));
fs.copyFileSync(path.join(HERE, 'lib', 'io.mjs'), path.join(pkg2, 'scripts', 'lib', 'io.mjs'));
fs.writeFileSync(path.join(pkg2, 'SYNCED.json'), '{ broken', 'utf8');
const corruptSync = spawnSync(process.execPath, [path.join(pkg2, 'scripts', 'check_sync.mjs')], { encoding: 'utf8' });
check('SYNCED 损坏给中文 ERROR', corruptSync.status === 1 && /SYNCED.json 不是合法 JSON/.test(corruptSync.stderr) && !/SyntaxError/.test(corruptSync.stderr));

const sync = run('check_sync.mjs', [path.join(tmp, 'no-core')]);
check('check_sync 缺主包 = 跳过(2)', sync.status === 2 && /跳过不等于通过/.test(sync.stdout), 'status=' + sync.status);
const syncBad = run('check_sync.mjs', ['--foo']);
check('check_sync 未知参数报错', syncBad.status === 1 && /未知参数/.test(syncBad.stderr), 'status=' + syncBad.status);

let pass = 0;
for (const [n, c, e] of results) {
  console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : '  ' + e));
  if (c) pass++;
}
console.log('\n---- ' + pass + '/' + results.length + ' 通过 ----');
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass === results.length ? 0 : 1);