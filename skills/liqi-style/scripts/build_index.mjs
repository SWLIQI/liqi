#!/usr/bin/env node
// 由注册表 + 锚文件名重建 style-index.json。主包升级后跑一次。
// 用法：node scripts/build_index.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { readJson } from './lib/io.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const dryRun = process.argv.includes('--dry-run');

const REG = readJson(path.join(ROOT, 'references', 'style-registry.seed.json'), 'style-registry.seed.json');
if (!REG || typeof REG !== 'object' || !REG.styles || typeof REG.styles !== 'object' || Array.isArray(REG.styles)) {
  console.error('ERROR: 注册表缺 styles 对象');
  process.exit(1);
}

const anchorsDir = path.join(ROOT, 'references', 'anchors');
if (!fs.existsSync(anchorsDir)) {
  console.error('ERROR: 找不到 references/anchors/ 目录');
  process.exit(1);
}
const files = fs.readdirSync(anchorsDir).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));

// 上游注册表逐字节保留；本地 IP 补丁单独放 ip-notes.local.json，重建时合并进索引。
const overlayPath = path.join(ROOT, 'references', 'ip-notes.local.json');
let overlay = {};
if (fs.existsSync(overlayPath)) {
  const o = readJson(overlayPath, 'ip-notes.local.json');
  overlay = o && typeof o === 'object' && o.styles && typeof o.styles === 'object' ? o.styles : {};
}

const clean = s => String(s).replace(/\s/g, '').replace(/[（(].*?[）)]/g, '').replace(/(2D|3D)$/i, '');
const idx = [];
const problems = [];

for (const [slug, v] of Object.entries(REG.styles)) {
  if (!v || typeof v !== 'object') {
    problems.push(slug + ' → 注册表条目不是对象');
    continue;
  }
  const parts = [v.display_name, ...String(v.display_name).split(/[·/／、（）()]/)]
    .map(clean).filter(x => x.length >= 2);
  const hit = files.filter(a => {
    const A = clean(a);
    return parts.some(p => A === p || A.includes(p) || p.includes(A));
  });
  if (hit.length !== 1) { problems.push(slug + ' → ' + (hit.join('/') || '无匹配')); continue; }
  const item = {
    slug, name: hit[0], display: v.display_name, track: v.track,
    dimension: v.dimension, heads: v.heads_range, stability: v.stability,
    file: 'anchors/' + hit[0] + '.md', marker_words: v.marker_words || []
  };
  const note = v.ip_note || overlay[slug];
  if (note) item.ip_note = note;
  idx.push(item);
}

const orphan = files.filter(f => !idx.some(i => i.name === f));
if (problems.length || orphan.length) {
  console.error('重建失败：');
  problems.forEach(p => console.error('  · ' + p));
  if (orphan.length) console.error('  · 未进索引的锚：' + orphan.join(', '));
  process.exit(1);
}

const tracks = {};
idx.forEach(x => { tracks[x.track] = (tracks[x.track] || 0) + 1; });
console.log('索引 ' + idx.length + ' 条；轨道分布：' + JSON.stringify(tracks));
console.log('IP 补丁：' + idx.filter(x => x.ip_note).length + ' 条带约束');

const target = path.join(ROOT, 'style-index.json');
const out = JSON.stringify(idx, null, 1) + '\n';
let old = '';
try { old = fs.readFileSync(target, 'utf8'); } catch (e) { /* 首次生成 */ }

if (dryRun) {
  console.log('DRY-RUN：将写入 ' + idx.length + ' 条（未写文件）');
  process.exit(0);
}
if (old === out) {
  console.log('style-index.json 无变化，未写入');
  process.exit(0);
}

const tmp = target + '.tmp';
try {
  fs.writeFileSync(tmp, out, 'utf8');
  fs.renameSync(tmp, target);
  console.log('已重建 style-index.json');
} catch (e) {
  try { fs.unlinkSync(tmp); } catch (ignored) { /* noop */ }
  console.error('ERROR: 写入失败：' + e.message);
  process.exit(1);
}
