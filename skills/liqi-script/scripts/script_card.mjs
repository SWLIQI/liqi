#!/usr/bin/env node
// 把剧本转成剧本卡 / Markdown 表 / 规范化 JSON。零依赖。
// 用法：node scripts/script_card.mjs <script.json> [--md|--json]
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { readJson } from './lib/io.mjs';
import { validateScript } from './lib/script.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const flags = new Set();
let file = '';
for (const a of argv) {
  if (a === '--md' || a === '--json') flags.add(a);
  else if (a.startsWith('--')) { console.error('ERROR: 未知参数 ' + a + '（可用：--md / --json）'); process.exit(1); }
  else if (!file) file = a;
  else { console.error('ERROR: 只能给一个剧本文件'); process.exit(1); }
}
if (!file) { console.error('用法：node scripts/script_card.mjs <script.json> [--md|--json]'); process.exit(1); }
if (flags.size === 2) { console.error('ERROR: --md 与 --json 不能同时用'); process.exit(1); }

const p = path.isAbsolute(file) ? file : path.join(ROOT, file);
if (!fs.existsSync(p)) {
  console.error('文件不存在：' + file);
  if (!path.isAbsolute(file)) console.error('提示：相对路径按包根解析，包外 cwd 也可以直接用相对路径。');
  process.exit(1);
}

const vocab = readJson(path.join(ROOT, 'script-vocab.json'), 'script-vocab.json');
const data = readJson(p, file);
const { errors, warns, scenes, gates, stats } = validateScript(data, vocab);
if (errors.length) {
  console.error('校验未通过（' + errors.length + ' ERROR），不输出剧本卡：');
  errors.forEach(e => console.error('  · ' + e));
  process.exit(1);
}
warns.forEach(w => console.error('WARN: ' + w));

const icon = s => s === 'ok' ? '✓' : s === 'warn' ? '△' : '✗';
const mdCell = v => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

if (flags.has('--json')) {
  console.log(JSON.stringify({
    title: data.title || '',
    episode: data.episode || '',
    gates,
    stats,
    scenes
  }, null, 2));
} else if (flags.has('--md')) {
  console.log('| 场 | 内/外 | 地点 | 时间 | 预算 | 台词+动作 | 余量 | 情节点 |');
  console.log('|---|---|---|---|---|---|---|---|');
  scenes.forEach(s => {
    const left = s.duration === null ? '—' : (s.duration - s.total_seconds).toFixed(1) + 's';
    console.log('| ' + [s.id, s.interior_exterior, s.location, s.time,
      s.duration === null ? '—' : s.duration + 's', s.total_seconds.toFixed(1) + 's',
      left, s.plot_points.length].map(mdCell).join(' | ') + ' |');
  });
  console.log('\n### 台词\n');
  console.log('| 台词 | 场 | 角色 | 类型 | 内容 | 功能 | 字数 | 语速 | 时长 |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  scenes.forEach(s => s.lines.forEach(l => {
    console.log('| ' + [l.id, s.id, l.speaker, l.type, l.text, l.functions.join('/') || '—',
      l.chars, l.rate === null ? '—' : l.rate, l.seconds.toFixed(1) + 's'].map(mdCell).join(' | ') + ' |');
  }));
} else {
  console.log('剧本：' + (data.title || '(无名)') + (data.episode ? '（' + data.episode + '）' : ''));
  if (gates) console.log(vocab.gates.map(g => 'Gate ' + g.id + ' ' + g.cn + ' ' + icon(gates[g.id])).join(' · '));
  console.log('');
  scenes.forEach(s => {
    console.log('【' + s.id + '｜' + s.interior_exterior + '·' + s.location + '｜' + s.time + '｜' +
      (s.duration === null ? '—' : s.duration + 's') + '】');
    console.log('Gate 3：目标 ' + (s.goal || '—') + ' → 阻碍 ' + (s.obstacle || '—') +
      ' → 升级 ' + (s.escalation || '—') + ' → 转折 ' + (s.turn || '—') + ' → 结果 ' + (s.result || '—'));
    console.log('情节点：' + (s.plot_points.length ? s.plot_points.join('；') : '未标注'));
    console.log('出场人物：' + s.characters.map(c => '@' + c).join('、'));
    console.log('环境：' + s.description);
    s.lines.forEach(l => {
      const mark = l.type === '对白' ? '' : '（' + l.type + '，不锁口型）';
      const act = l.action ? '（' + l.action + '）' : '';
      console.log('@' + l.speaker + act + mark + '：「' + l.text + '」');
    });
    console.log('台词表：');
    console.log('  #    角色    类型  字数  语速  时长   累计');
    let acc = 0;
    s.lines.forEach(l => {
      acc += l.seconds;
      console.log('  ' + l.id.padEnd(5) + l.speaker.padEnd(7) + l.type.padEnd(5) +
        String(l.chars).padEnd(5) + (l.rate === null ? '—' : l.rate).toString().padEnd(5) +
        (l.seconds.toFixed(1) + 's').padEnd(7) + acc.toFixed(1) + 's');
    });
    const left = s.duration === null ? '—' : (s.duration - s.total_seconds).toFixed(1) + 's';
    console.log('  合计 ' + s.total_seconds.toFixed(1) + 's（含动作 ' + s.action_time + 's） / 预算 ' +
      (s.duration === null ? '—' : s.duration + 's') + ' / 余 ' + left);
    console.log('');
  });
}