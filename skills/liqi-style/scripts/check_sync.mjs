#!/usr/bin/env node
// 同步检查：锚与注册表来自主包，主包升级后这里可能过期。
// 用法：node scripts/check_sync.mjs [主包目录]
// 退出码：0 一致；1 有差异或元数据损坏；2 跳过（未找到主包，跳过 ≠ 通过）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import url from 'node:url';
import { readJson } from './lib/io.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const synced = readJson(path.join(ROOT, 'SYNCED.json'), 'SYNCED.json');
if (!synced || typeof synced !== 'object' || !synced.sources ||
    typeof synced.sources !== 'object' || Array.isArray(synced.sources)) {
  console.error('ERROR: SYNCED.json 缺 sources 对象，无法比对');
  process.exit(1);
}

const core = process.argv[2] || process.env.LIQI_CORE || path.resolve(ROOT, '..', 'liqi-video-forge');
let coreStat;
try {
  coreStat = fs.statSync(core);
} catch (e) {
  console.log('SKIPPED：未找到主包目录（' + core + '）');
  console.log('跳过不等于通过——要验证请用 LIQI_CORE 指定主包。');
  process.exit(2);
}
if (!coreStat.isDirectory()) {
  console.error('ERROR: 主包路径不是目录：' + core);
  process.exit(1);
}

const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const diffs = [];
for (const [rel, want] of Object.entries(synced.sources)) {
  const p = path.join(core, rel);
  if (!fs.existsSync(p)) { diffs.push(rel + ' 已不存在'); continue; }
  let got;
  try {
    got = sha(p);
  } catch (e) {
    diffs.push(rel + ' 读取失败：' + e.message);
    continue;
  }
  if (got !== want) {
    diffs.push(rel + ' 内容已变（记录 ' + String(want).slice(0, 12) + ' / 当前 ' + got.slice(0, 12) + '）');
  }
}

console.log('主包：' + core);
console.log('记录版本：' + synced.coreVersion + '，来源文件 ' + Object.keys(synced.sources).length + ' 个');
console.log('来源键是主包原名；本包对应 references/anchors/<name>.md（只重命名）。');
if (diffs.length) {
  console.log('差异 ' + diffs.length + ' 处：');
  diffs.forEach(d => console.log('  · ' + d));
  console.log('\n处理：重新拷入变更的锚，跑 build_index.mjs，再重建 SYNCED.json。');
  process.exit(1);
}
console.log('全部一致。');
