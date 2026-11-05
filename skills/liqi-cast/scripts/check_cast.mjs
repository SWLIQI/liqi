#!/usr/bin/env node
// 只校验不生成：检查角色设定的 16 项是否齐、身高/色值/互锁词是否合法。
// 用法：node scripts/check_cast.mjs <cast.json>
import fs from 'node:fs';
import { validate, FACE, WARDROBE } from './lib/validate.mjs';

const file = process.argv[2];
if (!file) {
  console.error('用法：node scripts/check_cast.mjs <cast.json>');
  process.exit(1);
}

let cast;
try {
  cast = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error('ERROR: 读不了 ' + file + '：' + e.message);
  process.exit(1);
}

const { errors, warns } = validate(cast);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const C = plain(cast) ? cast : {};
const face = plain(C.face) ? C.face : {};
const wardrobe = plain(C.wardrobe) ? C.wardrobe : {};
const palette = Array.isArray(C.palette) ? C.palette : [];
const versions = Array.isArray(C.versions) ? C.versions : [];

const ageOk = typeof C.age_range === 'string' && /^\d+\s*[~-]\s*\d+$/.test(C.age_range);
const meta = [C.age_range ? C.age_range + (ageOk ? '岁' : '') : '', C.gender || ''].filter(Boolean).join(' ');
console.log('角色：' + (C.name || '(无名)') + (meta ? '  ' + meta : ''));

console.log('\n五官 10 项：');
FACE.forEach((k, i) => {
  const v = face[k];
  const has = typeof v === 'string' && v.trim() !== '';
  const icon = k === 'mark' ? (has ? '✓' : '△') : (has ? '✓' : '✗');
  const shown = has ? v : (k === 'mark' ? '(未声明；无特征请写「无」)' : '(缺)');
  console.log('  ' + icon + ' ' + String(i + 1).padStart(2) + '. ' + k.padEnd(8) + shown);
});

console.log('\n服装 6 项：');
WARDROBE.forEach((k, i) => {
  const v = wardrobe[k];
  const has = typeof v === 'string' && v.trim() !== '';
  console.log('  ' + (has ? '✓' : '✗') + ' ' + String(i + 11).padStart(2) + '. ' + k.padEnd(8) + (has ? v : '(缺)'));
});

const hv = C.height_cm;
const hText = hv === undefined || hv === null || hv === ''
  ? '(缺)'
  : (Number.isFinite(Number(hv)) ? hv + ' cm' : hv + '（非法）');
console.log('\n身高线：' + hText);

console.log('\n色板 ' + palette.length + ' 色：');
if (!palette.length) console.log('  (缺)');
palette.forEach((c, i) => {
  if (typeof c === 'string') {
    console.log('  ' + (i + 1) + '. ' + c + (/^#/.test(c) ? '  (缺中文色名)' : ''));
  } else if (plain(c)) {
    console.log('  ' + (i + 1) + '. ' + (c.name || '(缺色名)') + ' ' + (c.hex || '(缺HEX)') + (c.part ? '（' + c.part + '）' : ''));
  } else {
    console.log('  ' + (i + 1) + '. (非法项)');
  }
});

if (versions.length) {
  console.log('\n版本：');
  versions.forEach(v => {
    if (!plain(v)) { console.log('  · (非法项)'); return; }
    const n = Array.isArray(v.interlock) ? v.interlock.length : 0;
    const en = Array.isArray(v.interlock_en) ? v.interlock_en.length : 0;
    console.log('  · ' + (v.name || '(无名)') + '  [' + (v.verdict || '未声明') + ']' +
      '  互锁词 ' + n + ' 个' + (en ? ' / EN ' + en + ' 个' : ''));
  });
}

console.log('\n结果：' + (errors.length ? errors.length + ' ERROR' : '0 ERROR') + (warns.length ? ' / ' + warns.length + ' WARN' : ''));
errors.forEach(e => console.log('  · ' + e));
warns.forEach(w => console.log('  ~ ' + w));
process.exit(errors.length ? 1 : 0);
