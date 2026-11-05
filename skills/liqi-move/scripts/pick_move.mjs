#!/usr/bin/env node
// 按场型或意图取镜头骨架。零依赖。
// 用法：node scripts/pick_move.mjs 情绪爆发   或   node scripts/pick_move.mjs 转场
import path from 'node:path';
import url from 'node:url';
import { readJson } from './lib/io.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const INDEX = readJson(path.join(ROOT, 'move-index.json'), 'move-index.json');
const VOCAB = readJson(path.join(ROOT, 'move-vocab.json'), 'move-vocab.json');
if (!Array.isArray(INDEX) || !INDEX.length) {
  console.error('ERROR: move-index.json 为空或不是数组');
  process.exit(1);
}

const q = (process.argv[2] || '').trim();
if (!q) {
  console.error('用法：node scripts/pick_move.mjs <场型或意图>');
  console.error('场型：' + [...new Set(INDEX.map(x => x.scene))].join(' / '));
  process.exit(1);
}

const hits = INDEX.filter(x =>
  x.scene.includes(q) || x.title.includes(q) || x.fit.includes(q) || x.move.includes(q)
);

console.log('查询：' + q + '　命中 ' + hits.length + ' / ' + INDEX.length + ' 条骨架');
if (!hits.length) {
  console.log('没有匹配。可用场型：' + [...new Set(INDEX.map(x => x.scene))].join(' / '));
  process.exit(0);
}

hits.forEach(x => {
  console.log('\n【' + x.scene + ' ' + x.id + ' ' + x.title + '】');
  console.log('  景别机位：' + x.shot);
  console.log('  主运镜：' + x.move);
  console.log('  时间轴：' + x.timeline);
  console.log('  必锁：' + x.locks);
  console.log('  已知失败：' + x.failures);
});

console.log('\n允许的运镜用词（骨架库实际取值）：' + VOCAB.vocabulary.join('、'));
console.log('禁止：' + VOCAB.bannedNamedMoves.join('、') + '（要用原语拼，不能直接写）');
