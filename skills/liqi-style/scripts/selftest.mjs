#!/usr/bin/env node
// 自测：索引/锚全量巡检 + 取参 + 筛选 + 参数异常 + JSON 损坏 + 同步跳过。零依赖。
// 用法：node scripts/selftest.mjs
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const run = (script, args) => spawnSync(process.execPath, [path.join(HERE, script), ...args], { encoding: 'utf8' });
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const results = [];
const check = (name, cond, extra) => results.push([name, cond, extra || '']);

let index;
let reg;
try {
  index = JSON.parse(fs.readFileSync(path.join(ROOT, 'style-index.json'), 'utf8'));
  reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'references', 'style-registry.seed.json'), 'utf8'));
} catch (e) {
  console.error('ERROR: 读不了索引/注册表：' + e.message);
  process.exit(1);
}
const A = path.join(ROOT, 'references', 'anchors');
const anchors = fs.readdirSync(A).filter(f => f.endsWith('.md'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liqi-style-'));

// 1) 数据层
check('索引 50 条', Array.isArray(index) && index.length === 50, '实际 ' + (Array.isArray(index) ? index.length : '非数组'));
check('索引字段类型', index.every(x => x &&
  typeof x.slug === 'string' && x.slug.trim() &&
  typeof x.name === 'string' && x.name.trim() &&
  typeof x.track === 'string' && x.track.trim() &&
  ['2D', '3D', '实拍'].includes(x.dimension) &&
  typeof x.heads === 'string' && x.heads.trim() &&
  typeof x.file === 'string' && x.file.trim() &&
  Array.isArray(x.marker_words) && x.marker_words.length &&
  x.marker_words.every(w => typeof w === 'string' && w.trim())));
check('稳定性值域合法', index.every(x => ['稳', '中', '险', '险（动态）'].includes(x.stability)));
check('锚文件都存在', index.every(x => fs.existsSync(path.join(ROOT, 'references', x.file))));
check('索引与注册表字段 0 差异', index.every(x => {
  const v = reg.styles[x.slug];
  return v && v.display_name === x.display && v.track === x.track &&
    v.dimension === x.dimension && v.heads_range === x.heads && v.stability === x.stability;
}));
check('IP 补丁覆盖 ghibli/pixar', ['ghibli-2d', 'stylized-pixar-3d'].every(s => {
  const x = index.find(i => i.slug === s);
  return x && typeof x.ip_note === 'string' && x.ip_note.length > 0;
}));

const missingSections = [];
for (const f of anchors) {
  const t = fs.readFileSync(path.join(A, f), 'utf8');
  if (!/^## .*九段/m.test(t) || !/^## .*色值/m.test(t) || !/^## .*运镜池/m.test(t) ||
      !/^## .*崩点/m.test(t) || !/^## .*多面压句/m.test(t)) {
    missingSections.push(f);
  }
}
check('50 锚五节齐全（九段/色值/运镜/崩点/多面压句）', missingSections.length === 0, missingSections.slice(0, 5).join(' | '));

// 2) P0：全量巡检，不再只测一个样本
const sweepFail = [];
for (const x of index) {
  const r = run('check_style.mjs', ['references/' + x.file]);
  if (r.status !== 0) sweepFail.push(x.name + '：' + ((r.stdout.trim().split('\n').pop()) || r.stderr.trim()));
}
check('check_style 全量 50/50 通过', sweepFail.length === 0, sweepFail.slice(0, 3).join(' | '));

const broken = path.join(tmp, '写实PBR.md');
fs.writeFileSync(broken, '# 空锚\n', 'utf8');
const brokenRun = run('check_style.mjs', [broken]);
check('check_style 缺节被拦', brokenRun.status !== 0 && /缺「九段锚」/.test(brokenRun.stdout) && /缺「色值表」/.test(brokenRun.stdout));

const badHex = path.join(tmp, 'badhex.md');
fs.writeFileSync(badHex, '# x\n\n## 九段锚\nx\n\n## 色值表\n#GGGGGG\n\n## 运镜池\nx\n\n## 崩点清单\nx\n', 'utf8');
const badHexRun = run('check_style.mjs', [badHex]);
check('check_style 非法 HEX 被拦', badHexRun.status !== 0 && /非法 HEX/.test(badHexRun.stdout));

const readmeRun = run('check_style.mjs', ['README.md']);
check('check_style 非锚文件被拦', readmeRun.status !== 0);

// 3) get_style
const get = run('get_style.mjs', ['写实PBR']);
check('get 取到 写实PBR', get.status === 0 && /photoreal-pbr/.test(get.stdout), 'status=' + get.status);
check('get 含色值/运镜/崩点/九段', /色值/.test(get.stdout) && /运镜池/.test(get.stdout) && /崩点/.test(get.stdout) && /九段/.test(get.stdout));
check('get 默认输出多面压句全文', /## .*多面压句/.test(get.stdout) && /逐字复用/.test(get.stdout));
const brief = run('get_style.mjs', ['写实PBR', '--brief']);
check('get --brief 省略多面压句', brief.status === 0 && !/## .*多面压句/.test(brief.stdout));
const full = run('get_style.mjs', ['写实PBR', '--full']);
check('get --full 输出全文', full.status === 0 && /## 十、/.test(full.stdout));
const getBad = run('get_style.mjs', ['不存在的风格zzz']);
check('get 未知风格退出非零', getBad.status !== 0, 'status=' + getBad.status);
const getNoArg = run('get_style.mjs', []);
check('get 无参数提示用法', getNoArg.status !== 0 && /用法/.test(getNoArg.stderr));
const both = run('get_style.mjs', ['写实PBR', '--brief', '--full']);
check('get --brief/--full 互斥', both.status !== 0 && /不能同时用/.test(both.stderr));

// 4) pick_style
const pick = run('pick_style.mjs', ['古风']);
check('pick 用「古风」能出结果', pick.status === 0 && /1\./.test(pick.stdout), 'status=' + pick.status);
const pickReal = run('pick_style.mjs', ['--dimension', '实拍', '--limit', '10']);
check('pick 支持实拍维度', pickReal.status === 0 && /维度 实拍/.test(pickReal.stdout) && /候选池 7 \/ 50/.test(pickReal.stdout));
const danger = run('pick_style.mjs', ['--stability', '险', '--limit', '10']);
check('pick 险档覆盖 3 条（含险（动态））', danger.status === 0 &&
  /写实PBR/.test(danger.stdout) && /水墨淡彩2D/.test(danger.stdout) && /像素复古游戏/.test(danger.stdout));
const filterOnly = run('pick_style.mjs', ['--dimension', '3D']);
check('pick 仅过滤无关键词可用', filterOnly.status === 0 && /候选池 7 \/ 50/.test(filterOnly.stdout));
const none = run('pick_style.mjs', ['完全不存在的关键词zzz']);
check('pick 无匹配给替代建议', none.status === 0 && /没有匹配/.test(none.stdout) && /--track/.test(none.stdout));
const badLimit = run('pick_style.mjs', ['古风', '--limit', 'abc']);
check('pick 非法 limit 报错', badLimit.status === 1 && /--limit 必须是正整数/.test(badLimit.stderr));
const zeroLimit = run('pick_style.mjs', ['古风', '--limit', '0']);
check('pick limit 0 报错', zeroLimit.status === 1 && /--limit 必须是正整数/.test(zeroLimit.stderr));
const badDim = run('pick_style.mjs', ['古风', '--dimension', '4D']);
check('pick 非法维度报错', badDim.status === 1 && /--dimension 非法/.test(badDim.stderr) && /实拍/.test(badDim.stderr));
const badStab = run('pick_style.mjs', ['古风', '--stability', '超稳']);
check('pick 非法稳定性报错', badStab.status === 1 && /--stability 非法/.test(badStab.stderr));
const badTrack = run('pick_style.mjs', ['古风', '--track', '不存在轨']);
check('pick 非法轨道报错', badTrack.status === 1 && /--track 非法/.test(badTrack.stderr));
const miss = run('pick_style.mjs', ['古风', '--limit']);
check('pick 参数缺值报错', miss.status === 1 && /--limit 缺值/.test(miss.stderr));
const unk = run('pick_style.mjs', ['古风', '--foo']);
check('pick 未知参数报错', unk.status === 1 && /未知参数/.test(unk.stderr));

// 5) 损坏 JSON 与构建/同步
const pkg = path.join(tmp, 'pkg');
fs.mkdirSync(path.join(pkg, 'scripts', 'lib'), { recursive: true });
fs.copyFileSync(path.join(HERE, 'pick_style.mjs'), path.join(pkg, 'scripts', 'pick_style.mjs'));
fs.copyFileSync(path.join(HERE, 'lib', 'io.mjs'), path.join(pkg, 'scripts', 'lib', 'io.mjs'));
fs.writeFileSync(path.join(pkg, 'style-index.json'), '{ broken', 'utf8');
const corrupt = spawnSync(process.execPath, [path.join(pkg, 'scripts', 'pick_style.mjs'), '古风'], { encoding: 'utf8' });
check('索引损坏给中文 ERROR', corrupt.status === 1 && /style-index.json 不是合法 JSON/.test(corrupt.stderr) && !/SyntaxError/.test(corrupt.stderr));

const before = sha(path.join(ROOT, 'style-index.json'));
const dry = run('build_index.mjs', ['--dry-run']);
const after = sha(path.join(ROOT, 'style-index.json'));
check('build_index --dry-run 不写文件', dry.status === 0 && /DRY-RUN/.test(dry.stdout) && before === after);

const sync = run('check_sync.mjs', [path.join(tmp, 'no-such-core')]);
check('check_sync 缺主包 = 跳过(2)', sync.status === 2 && /跳过不等于通过/.test(sync.stdout), 'status=' + sync.status);

let pass = 0;
for (const [name, cond, extra] of results) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '  ' + extra));
  if (cond) pass++;
}
console.log('\n---- ' + pass + '/' + results.length + ' 通过 ----');

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass === results.length ? 0 : 1);
