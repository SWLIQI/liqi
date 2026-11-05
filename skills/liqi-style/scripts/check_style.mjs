#!/usr/bin/env node
// 校验一份风格锚：必备小节、索引条目、stability 字段、色值 HEX、索引字段类型。零依赖。
// 用法：node scripts/check_style.mjs references/anchors/写实PBR.md
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { readJson, readText } from './lib/io.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const STABILITY = ['稳', '中', '险', '险（动态）'];
const DIMENSIONS = ['2D', '3D', '实拍'];

const file = process.argv[2];
if (!file) { console.error('用法：node scripts/check_style.mjs <锚文件.md>'); process.exit(1); }

const p = path.isAbsolute(file) ? file : path.join(ROOT, file);
let stat;
try {
  stat = fs.statSync(p);
} catch (e) {
  console.error('文件不存在：' + file);
  process.exit(1);
}
if (!stat.isFile()) { console.error('不是文件：' + file); process.exit(1); }

const text = readText(p, file);
const name = path.basename(p).replace(/\.md$/, '');
const index = readJson(path.join(ROOT, 'style-index.json'), 'style-index.json');
if (!Array.isArray(index)) { console.error('ERROR: style-index.json 必须是数组'); process.exit(1); }
const entry = index.find(x => x && x.name === name);

const errors = [];
const warns = [];

const REQUIRED = [
  { label: '九段锚', re: /^## .*九段/m },
  { label: '色值表', re: /^## .*色值/m },
  { label: '运镜池', re: /^## .*运镜池/m },
  { label: '崩点清单', re: /^## .*崩点/m }
];
REQUIRED.forEach(r => { if (!r.re.test(text)) errors.push('缺「' + r.label + '」小节'); });

const blocks = [];
const parts = text.split(/^## /m);
for (let i = 1; i < parts.length; i++) {
  const seg = parts[i];
  const nl = seg.indexOf('\n');
  blocks.push({ title: seg.slice(0, nl).trim(), body: seg.slice(nl + 1).trim() });
}

const nine = blocks.find(b => b.title.includes('九段'));
if (nine && !nine.body) errors.push('「九段锚」小节为空');

const color = blocks.find(b => b.title.includes('色值'));
if (color) {
  if (!color.body) {
    errors.push('「色值表」小节为空');
  } else {
    const tokens = color.body.match(/#[0-9A-Za-z]+/g) || [];
    const bad = [...new Set(tokens.filter(h => !/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(h)))];
    if (bad.length) errors.push('色值表里有非法 HEX：' + bad.slice(0, 5).join(', '));
  }
}

if (!entry) {
  errors.push('style-index.json 里没有该锚（跑 build_index.mjs 重建）');
} else {
  if (typeof entry.slug !== 'string' || !entry.slug.trim()) errors.push('索引 slug 缺失或不是字符串');
  if (typeof entry.display !== 'string' || !entry.display.trim()) errors.push('索引 display 缺失');
  if (typeof entry.track !== 'string' || !entry.track.trim()) errors.push('索引 track 缺失');
  if (!DIMENSIONS.includes(entry.dimension)) {
    errors.push('索引 dimension 非法：' + entry.dimension + '（允许 ' + DIMENSIONS.join(' / ') + '）');
  }
  if (typeof entry.heads !== 'string' || !entry.heads.trim()) errors.push('索引 heads 缺失');
  if (!STABILITY.includes(entry.stability)) {
    errors.push('索引 stability 非法：' + entry.stability + '（允许 ' + STABILITY.join(' / ') + '）');
  }
  if (typeof entry.file !== 'string' || !entry.file) {
    errors.push('索引 file 缺失');
  } else if (!fs.existsSync(path.join(ROOT, 'references', entry.file))) {
    errors.push('索引 file 指向的锚不存在：' + entry.file);
  }
  if (!Array.isArray(entry.marker_words) || !entry.marker_words.length ||
      entry.marker_words.some(w => typeof w !== 'string' || !w.trim())) {
    errors.push('索引 marker_words 必须是非空字符串数组');
  }
  if (entry.ip_note !== undefined && typeof entry.ip_note !== 'string') {
    errors.push('索引 ip_note 必须是字符串');
  }
  if ((entry.slug === 'ghibli-2d' || entry.slug === 'stylized-pixar-3d') && !entry.ip_note) {
    errors.push('索引缺 IP 约束（' + entry.slug + '）');
  }
  if (path.resolve(p) !== path.resolve(path.join(ROOT, 'references', entry.file))) {
    warns.push('输入路径与索引 entry.file 不一致（只按文件名匹配）');
  }
}

console.log('锚：' + name);
console.log('索引：' + (entry
  ? entry.slug + ' / ' + entry.track + ' / ' + entry.dimension + ' / ' + entry.heads + ' / ' + entry.stability
  : '(无)'));
console.log('IP：' + (entry && entry.ip_note ? '有约束（投喂词禁点名）' : '无'));
console.log('字节：' + Buffer.byteLength(text, 'utf8'));
console.log('结果：' + (errors.length ? errors.length + ' ERROR' : '0 ERROR') + (warns.length ? ' / ' + warns.length + ' WARN' : ''));
errors.forEach(e => console.log('  · ' + e));
warns.forEach(w => console.log('  ~ ' + w));
process.exit(errors.length ? 1 : 0);
