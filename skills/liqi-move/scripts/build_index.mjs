#!/usr/bin/env node
// 扫主包的镜头骨架库与 H3 适配文件，生成 move-index.json（24 条骨架）与 move-vocab.json（用词 + 禁止清单）。
// 用法：node scripts/build_index.mjs [主包目录] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import url from 'node:url';
import { readJson, readText } from './lib/io.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const unknown = argv.filter(a => a.startsWith('--') && a !== '--dry-run');
if (unknown.length) {
  console.error('ERROR: 未知参数 ' + unknown.join(' ') + '（可用：--dry-run）');
  process.exit(1);
}
const dryRun = argv.includes('--dry-run');
const core = argv.find(a => !a.startsWith('--')) || process.env.LIQI_CORE || path.resolve(ROOT, '..', 'liqi-video-forge');
const src = path.join(core, 'references', '镜头骨架库.md');
const h3 = path.join(core, 'references', 'MiniMaxH3适配.md');

if (!fs.existsSync(src)) {
  console.error('找不到骨架库：' + src);
  console.error('先确认主包路径，或用 LIQI_CORE 指定。');
  process.exit(1);
}
if (!fs.existsSync(h3)) {
  console.error('找不到 H3 适配文件：' + h3);
  console.error('禁止清单需要回查该文件；先确认主包路径，或用 LIQI_CORE 指定。');
  process.exit(1);
}

const text = readText(src, '镜头骨架库.md');
const scenes = [];
for (const part of text.split(/^## /m).slice(1)) {
  const nl = part.indexOf('\n');
  const scene = part.slice(0, nl).replace(/^[一二三四五六七八九十]+、/, '').trim();
  const body = part.slice(nl + 1);
  const chunks = body.split(/^\*\*(\d+\.\d+)\s+(.+?)\*\*\s*$/m);
  // chunks: [前言, id, title, 内容, id, title, 内容 ...]
  for (let i = 1; i < chunks.length; i += 3) {
    const id = chunks[i].trim();
    const title = chunks[i + 1].trim();
    const content = chunks[i + 2] || '';
    const field = k => {
      const m = content.match(new RegExp('^' + k + '：(.+)$', 'm'));
      return m ? m[1].trim() : '';
    };
    scenes.push({
      id, scene, title,
      fit: field('适用'),
      shot: field('景别机位'),
      move: field('主运镜'),
      timeline: field('时间轴骨架').replace(/【时间轴】/g, '').trim(),
      locks: field('必锁项'),
      failures: field('已知失败')
    });
  }
}

if (!scenes.length) { console.error('解析结果为空，检查骨架库格式是否变了'); process.exit(1); }

const baseMove = s => String(s).replace(/（.*?）/g, '').split(/[，,]/)[0].replace(/[。；;！!\s]+$/g, '').trim();
const vocab = [...new Set(scenes.flatMap(s => baseMove(s.move).split('或')).map(x => x.replace(/[。；;\s]/g, '').trim()).filter(Boolean))].sort();

// 禁止清单：来源词逐条回查 MiniMaxH3适配.md，本地扩展单独标记。
const bans = readJson(path.join(ROOT, 'references', 'bans.json'), 'bans.json');
if (!bans || typeof bans !== 'object' || !Array.isArray(bans.named_moves) || !Array.isArray(bans.generic_words)) {
  console.error('ERROR: references/bans.json 必须是 { named_moves: [], generic_words: [] }');
  process.exit(1);
}
const h3Text = readText(h3, 'MiniMaxH3适配.md');
const problems = [];
const named = [];
const generic = [];
const collect = (list, label, out) => {
  for (const item of list) {
    if (!item || typeof item.term !== 'string' || !item.term.trim()) {
      problems.push(label + ' 有条目缺 term');
      continue;
    }
    const term = item.term.trim();
    if (item.source !== 'MiniMaxH3适配.md' && item.source !== 'local') {
      problems.push(label + '「' + term + '」的 source 非法：' + item.source);
      continue;
    }
    if (item.source === 'MiniMaxH3适配.md' && !h3Text.includes(term)) {
      problems.push(label + '「' + term + '」在 MiniMaxH3适配.md 里找不到（主包可能改过口径）');
      continue;
    }
    out.push(term);
  }
};
collect(bans.named_moves, '具名复合镜头', named);
collect(bans.generic_words, '抽象词', generic);
if (problems.length) {
  console.error('重建失败：');
  problems.forEach(p => console.error('  · ' + p));
  process.exit(1);
}

const count = source => ({
  named: bans.named_moves.filter(x => x && x.source === source).length,
  generic: bans.generic_words.filter(x => x && x.source === source).length
});
const fromSource = count('MiniMaxH3适配.md');
const local = count('local');

const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const meta = {
  coreVersion: '6.19.8',
  source: 'references/镜头骨架库.md',
  sourceHash: sha(src),
  sceneCount: new Set(scenes.map(s => s.scene)).size,
  skeletonCount: scenes.length,
  vocabulary: vocab,
  bannedNamedMoves: named,
  bannedGenericWords: generic,
  bans: {
    file: 'references/MiniMaxH3适配.md',
    namedFromSource: fromSource.named,
    namedLocal: local.named,
    genericFromSource: fromSource.generic,
    genericLocal: local.generic,
    verified: true,
    note: '来源词在 build_index 时逐条回查主包原文；local 为本包扩展。'
  }
};

console.log('骨架 ' + scenes.length + ' 条 / 场型 ' + meta.sceneCount + ' 个');
console.log('用词：' + vocab.join('、'));
console.log('禁止清单：来源 ' + (fromSource.named + fromSource.generic) + ' 条（逐条回查通过）+ 本地扩展 ' + (local.named + local.generic) + ' 条');

if (dryRun) {
  console.log('DRY-RUN：将写出 move-index.json 与 move-vocab.json（未写文件）');
  process.exit(0);
}

const outputs = [
  [path.join(ROOT, 'move-index.json'), JSON.stringify(scenes, null, 1) + '\n'],
  [path.join(ROOT, 'move-vocab.json'), JSON.stringify(meta, null, 1) + '\n']
];
const tmps = [];
try {
  // 先写两个临时文件，再一起替换，避免中途失败留下半更新状态。
  for (const [target, out] of outputs) {
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, out, 'utf8');
    tmps.push([tmp, target]);
  }
  for (const [tmp, target] of tmps) fs.renameSync(tmp, target);
} catch (e) {
  for (const [tmp] of tmps) {
    try { fs.unlinkSync(tmp); } catch (ignored) { /* noop */ }
  }
  console.error('ERROR: 写入失败：' + e.message);
  process.exit(1);
}
console.log('已写出 move-index.json 与 move-vocab.json');
