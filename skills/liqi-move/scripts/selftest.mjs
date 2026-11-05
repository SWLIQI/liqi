#!/usr/bin/env node
// 自测：数据完整、取骨架、三类拦截、路径解析、坏 JSON、同步跳过。零依赖。
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

let idx;
let voc;
let synced;
try {
  idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'move-index.json'), 'utf8'));
  voc = JSON.parse(fs.readFileSync(path.join(ROOT, 'move-vocab.json'), 'utf8'));
  synced = JSON.parse(fs.readFileSync(path.join(ROOT, 'SYNCED.json'), 'utf8'));
} catch (e) {
  console.error('ERROR: 读不了索引/词表/同步清单：' + e.message);
  process.exit(1);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liqi-move-'));

// 1) 数据层
check('骨架 24 条', idx.length === 24, '实际 ' + idx.length);
check('场型 8 个', new Set(idx.map(x => x.scene)).size === 8);
check('每条 9 字段齐全', idx.every(x => x.id && x.scene && x.title && x.fit && x.shot && x.move && x.timeline && x.locks && x.failures));
check('每场 3 条', [...new Set(idx.map(x => x.scene))].every(s => idx.filter(x => x.scene === s).length === 3));
check('timeline 无【时间轴】前缀', idx.every(x => !x.timeline.includes('【时间轴】')));
check('词表 7 个且无标点污染', voc.vocabulary.length === 7 && voc.vocabulary.every(v => !/[。；;\s]/.test(v)), voc.vocabulary.join(','));

const CAMERA = ['推', '拉', '摇', '移', '跟', '升降', '环绕', '变焦', '甩', '俯冲', '摇臂', '滑轨', '手持', '斯坦尼康', '旋转'];
const dataOutside = idx.filter(x => CAMERA.some(t => x.move.includes(t) && !voc.vocabulary.some(a => a.includes(t))));
check('骨架 move 全部落在 7 词表内', dataOutside.length === 0, dataOutside.slice(0, 3).map(x => x.id + ':' + x.move).join(' | '));

check('bans 元数据完整', voc.bans && voc.bans.verified === true &&
  voc.bans.namedFromSource + voc.bans.namedLocal === voc.bannedNamedMoves.length &&
  voc.bans.genericFromSource + voc.bans.genericLocal === voc.bannedGenericWords.length,
  JSON.stringify(voc.bans));
check('sourceHash 与 SYNCED 一致', voc.sourceHash === synced.sources['references/镜头骨架库.md']);

// 2) pick_move
const p = run('pick_move.mjs', ['情绪爆发']);
check('pick 命中场型 3 条', p.status === 0 && /命中 3/.test(p.stdout), p.stdout.slice(0, 80));
check('pick 输出无冗余时间轴前缀', /时间轴：0-/.test(p.stdout) && !/时间轴：【时间轴】/.test(p.stdout));
check('pick 输出时间轴与必锁', /时间轴/.test(p.stdout) && /必锁/.test(p.stdout));
const p0 = run('pick_move.mjs', ['不存在的场型zzz']);
check('pick 无匹配给可用场型', /可用场型/.test(p0.stdout));
const pNoArg = run('pick_move.mjs', []);
check('pick 无参数给用法', pNoArg.status !== 0 && /用法/.test(pNoArg.stderr));

// 3) check_move：三类都拦
const good = run('check_move.mjs', [path.join(ROOT, 'examples', 'shot-good.md')]);
check('合格镜头描述通过', good.status === 0, 'status=' + good.status + ' ' + good.stdout.slice(0, 100));

const bad = run('check_move.mjs', [path.join(ROOT, 'examples', 'shot-bad.md')]);
check('不合格样例 exit 非零', bad.status !== 0, 'status=' + bad.status);
check('具名复合镜头被判 ERROR', /具名复合镜头/.test(bad.stdout));
check('抽象词被判 ERROR', /抽象词/.test(bad.stdout));
check('超纲运镜被判 ERROR', /不在骨架库/.test(bad.stdout));

const absOnly = path.join(tmp, 'abstract-only.md');
fs.writeFileSync(absOnly, '一个 cinematic 的开场。\n', 'utf8');
const absRun = run('check_move.mjs', [absOnly]);
check('仅抽象词也 exit 非零', absRun.status !== 0 && /抽象词/.test(absRun.stdout), 'status=' + absRun.status);

const outOnly = path.join(tmp, 'outside-only.md');
fs.writeFileSync(outOnly, '镜头环绕主体一圈。\n', 'utf8');
const outRun = run('check_move.mjs', [outOnly]);
check('仅超纲运镜也 exit 非零', outRun.status !== 0 && /不在骨架库/.test(outRun.stdout), 'status=' + outRun.status);

const namedOnly = path.join(tmp, 'named-only.md');
fs.writeFileSync(namedOnly, '滑轨变焦推进。\n', 'utf8');
const namedRun = run('check_move.mjs', [namedOnly]);
check('仅具名复合镜头也 exit 非零', namedRun.status !== 0 && /具名复合镜头/.test(namedRun.stdout), 'status=' + namedRun.status);

const cNoArg = run('check_move.mjs', []);
check('check 无参数给用法', cNoArg.status !== 0 && /用法/.test(cNoArg.stderr));
const cMissing = run('check_move.mjs', [path.join(tmp, 'nope.md')]);
check('check 文件不存在给提示', cMissing.status !== 0 && /文件不存在/.test(cMissing.stderr));

// 从包外 cwd 用相对路径调用，应按包根解析
const rel = run('check_move.mjs', ['examples/shot-good.md'], { cwd: os.tmpdir() });
check('包外 cwd 相对路径可用', rel.status === 0, 'status=' + rel.status + ' ' + rel.stderr.slice(0, 80));

// 4) 坏 JSON 与构建/同步
const pkg = path.join(tmp, 'pkg');
fs.mkdirSync(path.join(pkg, 'scripts', 'lib'), { recursive: true });
fs.copyFileSync(path.join(HERE, 'pick_move.mjs'), path.join(pkg, 'scripts', 'pick_move.mjs'));
fs.copyFileSync(path.join(HERE, 'lib', 'io.mjs'), path.join(pkg, 'scripts', 'lib', 'io.mjs'));
fs.writeFileSync(path.join(pkg, 'move-index.json'), '{ broken', 'utf8');
const corrupt = spawnSync(process.execPath, [path.join(pkg, 'scripts', 'pick_move.mjs'), '情绪爆发'], { encoding: 'utf8' });
check('索引损坏给中文 ERROR', corrupt.status === 1 && /move-index.json 不是合法 JSON/.test(corrupt.stderr) && !/SyntaxError/.test(corrupt.stderr));

const pkg2 = path.join(tmp, 'pkg2');
fs.mkdirSync(path.join(pkg2, 'scripts', 'lib'), { recursive: true });
fs.copyFileSync(path.join(HERE, 'check_sync.mjs'), path.join(pkg2, 'scripts', 'check_sync.mjs'));
fs.copyFileSync(path.join(HERE, 'lib', 'io.mjs'), path.join(pkg2, 'scripts', 'lib', 'io.mjs'));
fs.copyFileSync(path.join(ROOT, 'move-vocab.json'), path.join(pkg2, 'move-vocab.json'));
fs.writeFileSync(path.join(pkg2, 'SYNCED.json'), '{ broken', 'utf8');
const corruptSync = spawnSync(process.execPath, [path.join(pkg2, 'scripts', 'check_sync.mjs')], { encoding: 'utf8' });
check('SYNCED 损坏给中文 ERROR', corruptSync.status === 1 && /SYNCED.json 不是合法 JSON/.test(corruptSync.stderr) && !/SyntaxError/.test(corruptSync.stderr));

const buildNoCore = run('build_index.mjs', [path.join(tmp, 'no-core')]);
check('build_index 缺主包给中文错误', buildNoCore.status === 1 && /找不到骨架库/.test(buildNoCore.stderr));

const sync = run('check_sync.mjs', [path.join(tmp, 'no-core')]);
check('check_sync 缺主包 = 跳过(2)', sync.status === 2 && /跳过不等于通过/.test(sync.stdout), 'status=' + sync.status);

let pass = 0;
for (const [n, c, e] of results) {
  console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : '  ' + e));
  if (c) pass++;
}
console.log('\n---- ' + pass + '/' + results.length + ' 通过 ----');

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass === results.length ? 0 : 1);
