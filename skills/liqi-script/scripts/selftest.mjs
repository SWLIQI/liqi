#!/usr/bin/env node
// 自测：词表/哈希、合格/不合格样例、逐项变异、输出模式、坏 JSON、同步跳过。零依赖。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const run = (s, a, opts) => spawnSync(process.execPath, [path.join(HERE, s), ...a], { encoding: 'utf8', cwd: ROOT, ...(opts || {}) });
const results = [];
const check = (n, c, e) => results.push([n, c, e || '']);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liqi-script-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* noop */ } });
const clone = o => JSON.parse(JSON.stringify(o));
const sameAs = (rel, out) => out.replace(/\r\n/g, '\n') ===
  fs.readFileSync(path.join(ROOT, 'examples', rel), 'utf8').replace(/\r\n/g, '\n');
const writeTmp = (name, obj) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2), 'utf8');
  return p;
};

let vocab;
let synced;
let good;
try {
  vocab = JSON.parse(fs.readFileSync(path.join(ROOT, 'script-vocab.json'), 'utf8'));
  synced = JSON.parse(fs.readFileSync(path.join(ROOT, 'SYNCED.json'), 'utf8'));
  good = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'script-good.json'), 'utf8'));
} catch (e) {
  console.error('ERROR: 读不了词表/同步清单/样例：' + e.message);
  process.exit(1);
}
const goodPath = path.join(ROOT, 'examples', 'script-good.json');
const badPath = path.join(ROOT, 'examples', 'script-bad.json');

// 1) 词表与同步
check('五阶门控', vocab.gates.length === 5 && vocab.gates.every((g, i) => g.id === i + 1));
check('钩子/筹码/功能枚举完整', vocab.openingHooks.length === 4 && vocab.tailHooks.length === 4 &&
  vocab.chipTypes.length === 4 && vocab.functions.length === 7);
check('语速与阈值', vocab.rates.hardMax === 6.5 && vocab.rates.planningCap === 3.2 &&
  vocab.lineWarnChars === 24 && vocab.lineErrorChars === 30);
check('来源哈希与 SYNCED 一致', Object.keys(vocab.sourceHashes).length === 4 &&
  Object.entries(vocab.sourceHashes).every(([k, v]) => synced.sources['references/' + k] === v));

// 2) 合格样例
const ok = run('check_script.mjs', [goodPath]);
check('合格样例 exit=0', ok.status === 0, 'status=' + ok.status);
check('合格样例 0 ERROR / 0 WARN', /结果：0 ERROR \/ 0 WARN/.test(ok.stdout), ok.stdout.slice(-200));
check('合格样例五门全绿', /Gate 1 核心前提 ✓.*Gate 5 脚本页 ✓/.test(ok.stdout));
check('合格样例统计 2 场 / 8 句 / 62 字', /场景 2 \/ 台词 8 \/ 可发音 62 字/.test(ok.stdout));

const cards = run('script_card.mjs', [goodPath]);
check('script_card exit=0', cards.status === 0, 'status=' + cards.status);
check('卡片含 Gate 3 / 台词表 / 合计', /Gate 3：/.test(cards.stdout) && /台词表：/.test(cards.stdout) && /合计 16.4s/.test(cards.stdout));
check('卡片标出 VO 不锁口型', /@沈知微（VO，不锁口型）/.test(cards.stdout));
const md = run('script_card.mjs', [goodPath, '--md']);
check('--md 输出场表与台词表', /^\| 场 \| 内\/外/m.test(md.stdout) && /^\| S01 \| 外景/m.test(md.stdout) && /### 台词/.test(md.stdout));
const json = run('script_card.mjs', [goodPath, '--json']);
let jsonOk = false;
try {
  const j = JSON.parse(json.stdout);
  jsonOk = j.scenes.length === 2 && j.stats.lines === 8 && j.gates[1] === 'ok' && j.scenes[0].lines[0].seconds > 0;
} catch (e) { /* noop */ }
check('--json 可解析且派生字段正确', json.status === 0 && jsonOk);

// 3) 不合格样例
const bad = run('check_script.mjs', [badPath]);
check('不合格样例 exit=1', bad.status === 1, 'status=' + bad.status);
[
  ['缺 premise.cost', /premise 缺 cost/],
  ['开场钩子非法', /opening_hook 非法/],
  ['角色重名', /characters 重名/],
  ['尾钩类型非法', /tail_hook\.type 非法/],
  ['尾钩内容为空', /tail_hook\.content 不能为空/],
  ['筹码类型非法', /chips 第 1 项 type 非法/],
  ['内外景非法', /interior_exterior 必须是/],
  ['角色不在 characters', /角色「陌生人」不在 characters/],
  ['缺 obstacle', /缺 obstacle/],
  ['台词 speaker 未知', /台词 L01 的 speaker「陌生人」不在 characters/],
  ['潜台词缺 subtext', /没有 subtext/],
  ['VO 锁口型', /lipsync=true/],
  ['场景超预算', /超过预算/],
  ['场景 id 重复', /场景 id 重复/],
  ['台词 id 重复', /台词 id 重复/],
  ['旁白用于对白', /旁白只能用于 VO\/OS/],
  ['物理硬闸', /物理硬闸/],
  ['functions 非法', /functions 非法：情绪/],
  ['超长句', /超过 30 字/],
  ['三幕比例偏差', /acts 比例/],
  ['goal=result', /goal 与 result 相同/],
  ['无情节点', /没有情节点标注/],
  ['不可拍词', /不可拍词「空气凝固」/],
  ['slop 词', /slop 词/],
  ['镜头语言', /镜头语言「镜头」/],
  ['VO 行占比', /VO\/OS 行占比/],
  ['情节点 <5', /少于 5/],
  ['排期偏紧', /超过实测排期上限/],
  ['余量过大', /余量过大/],
  ['回收缺集号', /recall 不含集号/]
].forEach(([n, re]) => check('坏样例抓到：' + n, re.test(bad.stdout)));
const badCards = run('script_card.mjs', [badPath]);
check('坏样例不输出剧本卡', badCards.status === 1 && !/【S01｜/.test(badCards.stdout));

// 4) 逐项变异
const mutate = (fn, name, re) => {
  const d = clone(good);
  fn(d);
  const r = run('check_script.mjs', [writeTmp(name, d)]);
  check('变异：' + name, r.status === 1 && re.test(r.stdout), r.stdout.slice(-220));
};
const warnMutate = (fn, name, re) => {
  const d = clone(good);
  fn(d);
  const r = run('check_script.mjs', [writeTmp(name, d)]);
  check('变异（只 WARN）：' + name, r.status === 0 && re.test(r.stdout), r.stdout.slice(-220));
};
mutate(d => { delete d.premise.cost; }, 'no-cost.json', /premise 缺 cost/);
mutate(d => { d.opening_hook = '随便'; }, 'bad-hook.json', /opening_hook 非法/);
warnMutate(d => { delete d.acts; }, 'no-acts.json', /未声明三幕比例/);
warnMutate(d => { d.acts[0].percent = 40; d.acts[1].percent = 40; }, 'ratio.json', /主包口径/);
mutate(d => { delete d.scenes[0].obstacle; }, 'no-obstacle.json', /缺 obstacle/);
mutate(d => { d.scenes[0].lines[0].speaker = '陌生人'; }, 'bad-speaker.json', /不在 characters/);
mutate(d => { d.scenes[0].lines[3].text = '让开。'.repeat(16); }, 'long-line.json', /超过 30 字/);
warnMutate(d => { d.scenes[0].lines[0].action = '镜头推近'; }, 'camera.json', /镜头语言/);
warnMutate(d => { d.scenes[0].description = '雨夜，空气凝固'; }, 'unfilmable.json', /不可拍词/);
warnMutate(d => { d.scenes[0].description = '电影感的雨夜'; }, 'slop.json', /slop 词/);
mutate(d => { d.scenes[0].lines[4].lipsync = true; }, 'vo-lipsync.json', /lipsync=true/);
mutate(d => { d.scenes[0].lines[0].rate = 7; }, 'rate7.json', /物理硬闸/);
mutate(d => { d.scenes[0].duration = 5; }, 'over-budget.json', /超过预算/);
mutate(d => { d.scenes[0].lines[0].functions = ['情绪']; }, 'bad-function.json', /functions 非法/);
mutate(d => { delete d.scenes[0].lines[2].subtext; }, 'no-subtext.json', /没有 subtext/);
mutate(d => { d.tail_hook.type = '反转钩'; }, 'bad-tail.json', /tail_hook\.type 非法/);
mutate(d => { d.chips[0].type = '金钱'; }, 'bad-chip.json', /chips 第 1 项 type 非法/);
mutate(d => { d.scenes[1].id = 'S01'; }, 'dup-scene.json', /场景 id 重复/);
mutate(d => { d.scenes[1].lines[0].id = 'L01'; }, 'dup-line.json', /台词 id 重复/);
mutate(d => { d.scenes[0].lines[0].speaker = '旁白'; d.scenes[0].lines[0].type = '对白'; }, 'narration.json', /旁白只能用于 VO\/OS/);
warnMutate(d => { d.scenes.forEach(s => { s.plot_points = []; }); }, 'no-plot.json', /没有情节点标注/);
warnMutate(d => { d.scenes.forEach(s => s.lines.forEach(l => { l.rate = 5; })); }, 'fast-all.json', /超过实测排期上限/);
warnMutate(d => { d.premise.desire = '穿过这条很长很长的巷口回到自己家里'; }, 'long-premise.json', /超过 30 字前提公式/);
{
  const d = clone(good);
  d.scenes[0].lines[0].rate = '3.5';
  const r = run('check_script.mjs', [writeTmp('rate-string.json', d)]);
  check('数字字符串 rate 可用', r.status === 0 && !/rate 非法/.test(r.stdout), r.stdout.slice(-160));
}
warnMutate(d => { d.premise.obstacle = '空气凝固'; }, 'premise-unfilmable.json', /premise\.obstacle 出现不可拍词/);
warnMutate(d => { d.scenes[0].goal = '镜头推近'; }, 'beat-camera.json', /场景 S01 的 goal 出现镜头语言/);
warnMutate(d => { d.scenes[0].plot_points[0] = '电影感的一刻'; }, 'plot-slop.json', /情节点 1 出现 slop 词/);

// 5) 黄金输出逐行守卫（selftest-output 由 check_golden 守）
check('黄金 check-pass 一致', sameAs('check-pass.txt', ok.stdout));
check('黄金 check-fail 一致', sameAs('check-fail.txt', bad.stdout));
check('黄金 script-cards 一致', sameAs('script-cards.txt', cards.stdout));
check('黄金 script-table 一致', sameAs('script-table.md', md.stdout));
check('黄金 normalized 一致', sameAs('script.normalized.json', json.stdout));

// 6) 路径 / 参数 / 坏 JSON
const rel = run('check_script.mjs', ['examples/script-good.json'], { cwd: os.tmpdir() });
check('包外 cwd 相对路径可用', rel.status === 0, 'status=' + rel.status + ' ' + rel.stderr.slice(0, 80));
const noArg = run('script_card.mjs', []);
check('script_card 无参数给用法', noArg.status !== 0 && /用法/.test(noArg.stderr));
const both = run('script_card.mjs', [goodPath, '--md', '--json']);
check('--md/--json 互斥', both.status !== 0 && /不能同时用/.test(both.stderr));

const pkg = path.join(tmp, 'pkg');
fs.mkdirSync(path.join(pkg, 'scripts', 'lib'), { recursive: true });
fs.copyFileSync(path.join(HERE, 'check_script.mjs'), path.join(pkg, 'scripts', 'check_script.mjs'));
fs.copyFileSync(path.join(HERE, 'lib', 'io.mjs'), path.join(pkg, 'scripts', 'lib', 'io.mjs'));
fs.copyFileSync(path.join(HERE, 'lib', 'script.mjs'), path.join(pkg, 'scripts', 'lib', 'script.mjs'));
fs.copyFileSync(path.join(ROOT, 'script-vocab.json'), path.join(pkg, 'script-vocab.json'));
fs.writeFileSync(path.join(pkg, 'broken.json'), '{ broken', 'utf8');
const corrupt = spawnSync(process.execPath, [path.join(pkg, 'scripts', 'check_script.mjs'), 'broken.json'], { encoding: 'utf8', cwd: pkg });
check('剧本损坏给中文 ERROR', corrupt.status === 1 && /不是合法 JSON/.test(corrupt.stderr) && !/SyntaxError/.test(corrupt.stderr));

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
check('check_sync 未知参数报错', syncBad.status === 1 && /未知参数/.test(syncBad.stderr));

let pass = 0;
for (const [n, c, e] of results) {
  console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : '  ' + e));
  if (c) pass++;
}
console.log('\n---- ' + pass + '/' + results.length + ' 通过 ----');
process.exit(pass === results.length ? 0 : 1);