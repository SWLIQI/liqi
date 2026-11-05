#!/usr/bin/env node
// 同步检查：骨架与用词来自主包，主包升级后可能过期。
// 退出码：0 一致；1 差异或元数据损坏；2 跳过（未找到主包，跳过 ≠ 通过）
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

const core = process.argv.slice(2).find(a => !a.startsWith('--')) ||
  process.env.LIQI_CORE || path.resolve(ROOT, '..', 'liqi-video-forge');
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

const voc = readJson(path.join(ROOT, 'move-vocab.json'), 'move-vocab.json');
if (voc && voc.bans && voc.bans.verified) {
  const sourceCount = Number(voc.bans.namedFromSource || 0) + Number(voc.bans.genericFromSource || 0);
  const localCount = Number(voc.bans.namedLocal || 0) + Number(voc.bans.genericLocal || 0);
  console.log('禁止清单：来源词 ' + sourceCount + ' 条（build 时逐条回查）+ 本地扩展 ' + localCount + ' 条');
} else {
  console.warn('WARN: move-vocab.json 没有 bans 元数据，禁止清单来源未登记');
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

console.log('主包：' + core + '，记录版本 ' + synced.coreVersion);
if (diffs.length) {
  diffs.forEach(d => console.log('  · ' + d));
  console.log('\n处理：重跑 build_index.mjs，再重建 SYNCED.json。');
  process.exit(1);
}
console.log('全部一致（' + Object.keys(synced.sources).length + ' 个来源）。');
console.log('注意：哈希一致只代表来源文件未变；禁止清单语义由 build_index 逐条回查。');
