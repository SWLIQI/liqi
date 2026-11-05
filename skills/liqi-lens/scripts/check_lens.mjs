#!/usr/bin/env node
// 检查一份镜头表：逐镜字段、三类拦截、轴线、光位/光比与 11 项配额的机检部分。零依赖。
// 用法：node scripts/check_lens.mjs examples/shot-list-good.json
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { readJson } from './lib/io.mjs';
import { validateShotList, pct } from './lib/lens.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const file = process.argv[2];
if (!file) { console.error('用法：node scripts/check_lens.mjs <shot-list.json>'); process.exit(1); }

const p = path.isAbsolute(file) ? file : path.join(ROOT, file);
if (!fs.existsSync(p)) {
  console.error('文件不存在：' + file);
  if (!path.isAbsolute(file)) console.error('提示：相对路径按包根解析，包外 cwd 也可以直接用相对路径。');
  process.exit(1);
}

const vocab = readJson(path.join(ROOT, 'lens-vocab.json'), 'lens-vocab.json');
const data = readJson(p, file);
const { errors, warns, notes, stats } = validateShotList(data, vocab);

if (stats) {
  console.log('镜头表：' + stats.total + ' 镜 / ' + stats.segments + ' 段');
  console.log('统计：特写 ' + pct(stats.closeShare) + ' · 侧 45° ' + pct(stats.side45Share) +
    ' · 侧面 ' + pct(stats.sideShare) + ' · 焦段 ' + stats.fovKinds + ' 种 · 运镜 ' + stats.moveKinds + ' 种');
}
console.log('结果：' + errors.length + ' ERROR / ' + warns.length + ' WARN');
errors.forEach(e => console.log('  · ' + e));
warns.forEach(w => console.log('  ~ ' + w));
if (notes.length) {
  console.log('\n备注（未查不等于通过）：');
  notes.forEach(n => console.log('  - ' + n));
}
process.exit(errors.length ? 1 : 0);