#!/usr/bin/env node
// 检查一份剧本：五阶门控、台词七维、语速排期、VO/OS、去AI味与尾钩。零依赖。
// 用法：node scripts/check_script.mjs examples/script-good.json
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { readJson } from './lib/io.mjs';
import { validateScript } from './lib/script.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const file = process.argv[2];
if (!file) { console.error('用法：node scripts/check_script.mjs <script.json>'); process.exit(1); }

const p = path.isAbsolute(file) ? file : path.join(ROOT, file);
if (!fs.existsSync(p)) {
  console.error('文件不存在：' + file);
  if (!path.isAbsolute(file)) console.error('提示：相对路径按包根解析，包外 cwd 也可以直接用相对路径。');
  process.exit(1);
}

const vocab = readJson(path.join(ROOT, 'script-vocab.json'), 'script-vocab.json');
const data = readJson(p, file);
const { errors, warns, notes, gates, stats } = validateScript(data, vocab);
const icon = s => s === 'ok' ? '✓' : s === 'warn' ? '△' : '✗';

console.log('剧本：' + (data && data.title ? data.title : '(无名)') +
  (data && data.episode ? '（' + data.episode + '）' : ''));
if (stats) {
  console.log('场景 ' + stats.scenes + ' / 台词 ' + stats.lines + ' / 可发音 ' + stats.chars + ' 字' +
    ' / 台词 ' + stats.lineSeconds.toFixed(1) + 's / 预算 ' + stats.budget + 's' +
    ' / 口播均值 ' + (stats.avgRate === null ? '—' : stats.avgRate.toFixed(2)) + ' 字/秒');
}
if (gates && typeof gates[1] === 'string') {
  console.log(vocab.gates.map(g => 'Gate ' + g.id + ' ' + g.cn + ' ' + icon(gates[g.id])).join(' · '));
}
console.log('结果：' + errors.length + ' ERROR / ' + warns.length + ' WARN');
errors.forEach(e => console.log('  · ' + e));
warns.forEach(w => console.log('  ~ ' + w));
if (notes.length) {
  console.log('\n备注（未标注不等于通过）：');
  notes.forEach(n => console.log('  - ' + n));
}
process.exit(errors.length ? 1 : 0);