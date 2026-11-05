#!/usr/bin/env node
// 同步检查：本包的规则摘自主包，主包升级后这里可能悄悄过期。
// 用法：node scripts/check_sync.mjs [主包目录]
//   主包目录缺省读环境变量 LIQI_CORE，再缺省尝试 ../liqi-video-forge
// 退出码：0 = 一致；1 = 有差异或本包元数据损坏；2 = 跳过（未找到主包，跳过 ≠ 通过）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let synced;
try {
  synced = JSON.parse(fs.readFileSync(path.join(ROOT, 'SYNCED.json'), 'utf8'));
} catch (e) {
  console.error('ERROR: 读不了 SYNCED.json：' + e.message);
  process.exit(1);
}
if (!synced || typeof synced !== 'object' || !synced.sources ||
    typeof synced.sources !== 'object' || Array.isArray(synced.sources)) {
  console.error('ERROR: SYNCED.json 缺 sources 对象，无法比对');
  process.exit(1);
}

const core = process.argv[2] || process.env.LIQI_CORE || path.resolve(ROOT, '..', 'liqi-video-forge');
if (!fs.existsSync(core)) {
  console.log('SKIPPED：未找到主包目录（' + core + '）');
  console.log('跳过不等于通过——要验证请把主包放在旁边，或用 LIQI_CORE 指定。');
  process.exit(2);
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
console.log('记录版本：' + synced.coreVersion);
if (diffs.length) {
  console.log('发现 ' + diffs.length + ' 处差异：');
  diffs.forEach(d => console.log('  · ' + d));
  console.log('\n处理：回读主包对应章节，更新本包 references 后重新生成 SYNCED.json。');
  process.exit(1);
}
console.log('全部 ' + Object.keys(synced.sources).length + ' 个来源文件哈希一致。');
