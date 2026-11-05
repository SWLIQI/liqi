#!/usr/bin/env node
// 按 slug 或中文名取出某风格的参数块（色值 / 运镜池 / 崩点 / 九段锚 / 多面压句）。零依赖。
// 用法：node scripts/get_style.mjs 写实PBR [--brief|--full]
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { readJson, readText } from './lib/io.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const INDEX = readJson(path.join(ROOT, 'style-index.json'), 'style-index.json');
if (!Array.isArray(INDEX) || !INDEX.length) {
  console.error('ERROR: style-index.json 为空或不是数组');
  process.exit(1);
}

const argv = process.argv.slice(2);
const flags = new Set();
let key = '';
for (const a of argv) {
  if (a === '--brief' || a === '--full') {
    flags.add(a);
  } else if (a.startsWith('--')) {
    console.error('ERROR: 未知参数 ' + a + '（可用：--brief / --full）');
    process.exit(1);
  } else if (!key) {
    key = a.trim();
  } else {
    console.error('ERROR: 只能给一个 slug 或中文名');
    process.exit(1);
  }
}
if (!key) {
  console.error('用法：node scripts/get_style.mjs <slug 或 中文名> [--brief|--full]');
  console.error('可选：' + INDEX.slice(0, 8).map(x => x.slug).join(', ') + ' …');
  process.exit(1);
}
if (flags.size === 2) {
  console.error('ERROR: --brief 与 --full 不能同时用');
  process.exit(1);
}
const brief = flags.has('--brief');
const full = flags.has('--full');

const k = key.toLowerCase();
const item = INDEX.find(x => x.slug.toLowerCase() === k)
  || INDEX.find(x => x.name.toLowerCase() === k)
  || INDEX.find(x => x.name.includes(key) || x.display.includes(key));

if (!item) {
  console.error('没找到：' + key);
  const near = INDEX.filter(x => x.name.includes(key.slice(0, 2))).slice(0, 6);
  if (near.length) console.error('相近：' + near.map(x => x.name + '(' + x.slug + ')').join('、'));
  process.exit(1);
}

const p = path.join(ROOT, 'references', item.file);
if (!fs.existsSync(p)) { console.error('锚文件缺失：' + item.file); process.exit(1); }
const text = readText(p, '锚文件 ' + item.file);

console.log('# ' + item.name + '  (' + item.slug + ')');
console.log('轨道 ' + item.track + ' · ' + item.dimension + ' · 头身比 ' + item.heads + ' · 稳定性 ' + item.stability);
console.log('锚文件 references/' + item.file);
if (item.ip_note) console.log('IP 约束：' + item.ip_note);
console.log('');

if (full) {
  console.log('--- 全文 ---\n');
  console.log(text);
  process.exit(0);
}

// 按二级标题切块
const blocks = [];
const parts = text.split(/^## /m);
for (let i = 1; i < parts.length; i++) {
  const seg = parts[i];
  const nl = seg.indexOf('\n');
  blocks.push({ title: seg.slice(0, nl).trim(), body: seg.slice(nl + 1).trim() });
}

const WANT = ['色值', '运镜池', '崩点'];
const picked = blocks.filter(b => WANT.some(w => b.title.includes(w)));
if (!picked.length) {
  console.log('（该锚没有色值 / 运镜池 / 崩点小节，直接看锚文件）');
} else {
  picked.forEach(b => {
    const lines = b.body.split('\n');
    const cap = brief ? 20 : 40;
    console.log('## ' + b.title);
    console.log(lines.slice(0, cap).join('\n'));
    if (lines.length > cap) console.log('…（余 ' + (lines.length - cap) + ' 行，见锚文件）');
    console.log('');
  });
}

const nine = blocks.find(b => b.title.includes('九段'));
if (nine) {
  const lines = nine.body.split('\n');
  const cap = brief ? 12 : 24;
  console.log('## ' + nine.title + '（前 ' + cap + ' 行）');
  console.log(lines.slice(0, cap).join('\n'));
  if (lines.length > cap) console.log('…（余 ' + (lines.length - cap) + ' 行）');
} else {
  console.log('（该锚没有「九段锚」小节）');
}

const multi = blocks.find(b => b.title.includes('多面压句'));
if (brief) {
  // 简短模式不输出多面压句
} else if (multi) {
  console.log('\n## ' + multi.title + '（全文）');
  console.log(multi.body);
} else {
  console.log('\n（该锚没有「多面压句」小节）');
}
