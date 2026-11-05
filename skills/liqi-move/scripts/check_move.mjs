#!/usr/bin/env node
// 检查一份分镜/镜头描述里的运镜用词：具名复合镜头、抽象词、超出词表的运镜。
// 三类都是 ERROR，任一命中即 exit 1。零依赖。
// 用法：node scripts/check_move.mjs <文件.md>
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { readJson, readText } from './lib/io.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VOCAB = readJson(path.join(ROOT, 'move-vocab.json'), 'move-vocab.json');

const file = process.argv[2];
if (!file) { console.error('用法：node scripts/check_move.mjs <文件.md>'); process.exit(1); }

// 相对路径按包根解析，不依赖当前工作目录。
const p = path.isAbsolute(file) ? file : path.join(ROOT, file);
let stat;
try {
  stat = fs.statSync(p);
} catch (e) {
  console.error('文件不存在：' + file);
  if (!path.isAbsolute(file)) console.error('提示：相对路径按包根解析；从包外调用请用绝对路径。');
  process.exit(1);
}
if (!stat.isFile()) { console.error('不是文件：' + file); process.exit(1); }

const text = readText(p, file);
const errors = [];
const warns = [];
const allowed = Array.isArray(VOCAB.vocabulary) ? VOCAB.vocabulary : [];
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 1) 具名复合镜头：文档明确禁止直接写，必须用原语拼
(VOCAB.bannedNamedMoves || []).filter(t => text.includes(t)).forEach(t => {
  errors.push('出现具名复合镜头「' + t + '」：用原语拼装（' + allowed.join(' / ') + '），不要直接写');
});

// 2) 抽象词：H3 面要求替换成具体视觉描述
(VOCAB.bannedGenericWords || []).filter(t => new RegExp(esc(t), 'i').test(text)).forEach(t => {
  errors.push('出现抽象词「' + t + '」：换成具体的视觉与听觉细节（光位、材质、动作、声音）');
});

// 3) 运镜用词是否超出骨架库的实际取值
const CAMERA_TERMS = ['推', '拉', '摇', '移', '跟', '升降', '环绕', '变焦', '甩', '俯冲', '摇臂', '滑轨', '手持', '斯坦尼康', '旋转'];
const found = CAMERA_TERMS.filter(t => text.includes(t));
// 推/拉/移/跟 会被 缓推/后拉/横移/跟拍 包含，allowed 判断已覆盖，不再单字豁免。
const outside = found.filter(t => !allowed.some(a => String(a).includes(t)));
outside.forEach(t => {
  errors.push('运镜词「' + t + '」不在骨架库 7 词表里：改用 ' + allowed.join(' / ') + '，或拆成两个原语');
});

console.log('文件：' + file);
console.log('库内允许：' + allowed.join('、'));
console.log('命中运镜词：' + (found.join('、') || '无'));
console.log('结果：' + errors.length + ' ERROR / ' + warns.length + ' WARN');
errors.forEach(e => console.log('  · ' + e));
warns.forEach(w => console.log('  ~ ' + w));

if (errors.length) {
  console.log('\n怎么改：');
  console.log('  1. 具名复合镜头 → 拆成两个原语，按时间轴分段写。');
  console.log('  2. 抽象词 → 写光位、材质、动作幅度、声音，不写评价词。');
  console.log('  3. 超纲运镜 → 用 7 词表里的词，或确认是否该另开镜头。');
}

process.exit(errors.length ? 1 : 0);
