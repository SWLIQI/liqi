#!/usr/bin/env node
// 把镜头表转成可投喂的镜头卡 / Markdown 表 / 规范化 JSON。零依赖。
// 用法：node scripts/shot_list.mjs <shot-list.json> [--md|--json]
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { readJson } from './lib/io.mjs';
import { validateShotList } from './lib/lens.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const flags = new Set();
let file = '';
for (const a of argv) {
  if (a === '--md' || a === '--json') flags.add(a);
  else if (a.startsWith('--')) { console.error('ERROR: 未知参数 ' + a + '（可用：--md / --json）'); process.exit(1); }
  else if (!file) file = a;
  else { console.error('ERROR: 只能给一个镜头表文件'); process.exit(1); }
}
if (!file) { console.error('用法：node scripts/shot_list.mjs <shot-list.json> [--md|--json]'); process.exit(1); }
if (flags.size === 2) { console.error('ERROR: --md 与 --json 不能同时用'); process.exit(1); }

const p = path.isAbsolute(file) ? file : path.join(ROOT, file);
if (!fs.existsSync(p)) {
  console.error('文件不存在：' + file);
  if (!path.isAbsolute(file)) console.error('提示：相对路径按包根解析，包外 cwd 也可以直接用相对路径。');
  process.exit(1);
}

const vocab = readJson(path.join(ROOT, 'lens-vocab.json'), 'lens-vocab.json');
const data = readJson(p, file);
const { errors, warns, rows } = validateShotList(data, vocab);
if (errors.length) {
  console.error('校验未通过（' + errors.length + ' ERROR），不输出镜头卡：');
  errors.forEach(e => console.error('  · ' + e));
  process.exit(1);
}
warns.forEach(w => console.error('WARN: ' + w));

const mdCell = v => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

function card(r) {
  const x = r.raw;
  const lines = [];
  lines.push('【' + r.id + '｜' + r.scene + '｜' + x.duration + 's｜' + r.size.name + '】');
  lines.push('任务：' + x.task);
  lines.push('景别：' + r.size.name + '（' + r.level + '/9）· 角度：' + x.angle + ' · 视角：' + r.fov.deg + '°（' + r.perspective + '）');
  lines.push('主体：' + x.subject);
  lines.push('动作：' + x.action);
  let light = '光：' + x.light + ' · 光源：' + x.light_source;
  if (x.light_ratio) light += ' · 光比：' + x.light_ratio;
  lines.push(light);
  if (r.people >= 2) lines.push('轴线：' + x.axis + ' · 机位：' + x.axis_side);
  lines.push('运镜：' + x.move + (x.technique ? ' · 重技法：' + x.technique : ''));
  if (x.composition) lines.push('构图：' + x.composition);
  lines.push('画面：' + x.visual);
  lines.push('防漂移：' + vocab.guardSentences[r.perspective]);
  if (x.prompt_en) lines.push('EN：' + x.prompt_en);
  return lines.join('\n');
}

if (flags.has('--json')) {
  const out = {
    title: data.title || '',
    ratio: data.ratio || '',
    shots: rows.map(r => Object.assign({}, r.raw, {
      level: r.level,
      perspective: r.perspective,
      drift_guard: vocab.guardSentences[r.perspective]
    }))
  };
  console.log(JSON.stringify(out, null, 2));
} else if (flags.has('--md')) {
  console.log('| # | 场景 | 景别 | 角度 | 视角 | 光位 | 光比 | 运镜 | 时长 | 轴线 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  rows.forEach(r => {
    const x = r.raw;
    console.log('| ' + [r.id, x.scene, x.shot_size, x.angle, r.fov.deg + '°', x.light, x.light_ratio || '—', x.move, x.duration + 's', x.axis || '—'].map(mdCell).join(' | ') + ' |');
  });
} else {
  console.log(rows.map(card).join('\n\n'));
}