#!/usr/bin/env node
// 按关键词/维度/稳定性/轨道挑风格。零依赖。
// 用法：node scripts/pick_style.mjs "古风 雨夜" [--dimension 2D|3D|实拍] [--stability 稳|中|险] [--track 卡通轨] [--limit 3]
import path from 'node:path';
import url from 'node:url';
import { readJson } from './lib/io.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const INDEX = readJson(path.join(ROOT, 'style-index.json'), 'style-index.json');
if (!Array.isArray(INDEX) || !INDEX.length) {
  console.error('ERROR: style-index.json 为空或不是数组');
  process.exit(1);
}

function fail(msg) {
  console.error('ERROR: ' + msg);
  process.exit(1);
}

const argv = process.argv.slice(2);
const KNOWN = new Set(['dimension', 'stability', 'track', 'limit']);
const opts = {};
const words = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    if (!KNOWN.has(k)) fail('未知参数 --' + k + '（可用：--dimension / --stability / --track / --limit）');
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) fail('--' + k + ' 缺值');
    opts[k] = v;
    i++;
  } else {
    words.push(a);
  }
}
const query = words.join(' ').trim();

const DIMS = [...new Set(INDEX.map(x => String(x.dimension)))];
const TRACKS = [...new Set(INDEX.map(x => String(x.track)))];
const STABS = [...new Set(INDEX.map(x => String(x.stability)))];

let dimension = null;
if (opts.dimension) {
  dimension = DIMS.find(d => d.toUpperCase() === opts.dimension.toUpperCase()) || null;
  if (!dimension) fail('--dimension 非法：' + opts.dimension + '（可用：' + DIMS.join(' / ') + '）');
}

let stability = null;
if (opts.stability) {
  const want = opts.stability === '动态' ? '险（动态）' : opts.stability;
  if (!STABS.includes(want)) {
    fail('--stability 非法：' + opts.stability + '（可用：' + STABS.join(' / ') + '；「险」包含「险（动态）」）');
  }
  stability = want;
}

let track = null;
if (opts.track) {
  if (!TRACKS.includes(opts.track)) {
    fail('--track 非法：' + opts.track + '（可用：' + TRACKS.join(' / ') + '）');
  }
  track = opts.track;
}

let limit = 3;
if (opts.limit !== undefined) {
  limit = Number(opts.limit);
  if (!Number.isInteger(limit) || limit < 1) fail('--limit 必须是正整数（当前 ' + opts.limit + '）');
}

if (!query && !dimension && !stability && !track) {
  fail('至少给一个关键词，或用 --dimension / --stability / --track 过滤');
}

const stabMatch = (value, want) => {
  const v = String(value);
  if (want === '险') return v === '险' || v.startsWith('险');
  return v === want;
};

let pool = INDEX.slice();
if (dimension) pool = pool.filter(x => String(x.dimension).toUpperCase() === dimension.toUpperCase());
if (stability) pool = pool.filter(x => stabMatch(x.stability, stability));
if (track) pool = pool.filter(x => x.track === track);

const tokens = query.split(/[\s,，、]+/).filter(Boolean).map(t => t.toLowerCase());
// 用户说人话，风格名说的是行话：补一层同义词，否则「古风」这种词一条都搜不到
const SYN = {
  '古风': ['古装', '国风', '水墨', '仙侠', '宋式', '唐卡', '敦煌', '工笔', '年画', '皮影', '青花', '汉画像', '金碧'],
  '二次元': ['2d', '赛璐璐', '漫画', '动漫', '条漫', '波普'],
  '写实': ['写实', 'photoreal', '实拍', '纪实', '纪录片'],
  '复古': ['复古', '港风', '月份牌', '胶片', '合成器', '像素'],
  '3d': ['3d', '三渲二', '皮克斯', '黏土', '定格', 'lowpoly'],
  '国潮': ['国潮', '新中式', '青花', '金碧', '敦煌', '唐卡'],
  '恐怖': ['暗黑', '哥特', '悬疑', '黑色电影'],
  '甜': ['甜宠', '奶油', '水彩']
};
const expanded = [...new Set(tokens.flatMap(t => [t, ...(SYN[t] || [])]))];
const scored = pool.map(x => {
  let score = 0;
  const hit = [];
  const hay = (x.name + ' ' + x.display + ' ' + x.track + ' ' + (x.marker_words || []).join(' ')).toLowerCase();
  for (const t of expanded) {
    if (x.name.toLowerCase().includes(t) || x.display.toLowerCase().includes(t)) { score += 3; hit.push(t); }
    else if ((x.marker_words || []).some(w => w.toLowerCase().includes(t))) { score += 2; hit.push(t); }
    else if (hay.includes(t)) { score += 1; hit.push(t); }
  }
  return { ...x, score, hit };
});

const ranked = (tokens.length ? scored.filter(x => x.score > 0) : scored)
  .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name), 'zh'))
  .slice(0, limit);

console.log('查询：' + (query || '(无关键词，仅过滤)') +
  (dimension ? ' | 维度 ' + dimension : '') +
  (stability ? ' | 稳定性 ' + stability : '') +
  (track ? ' | 轨道 ' + track : ''));
console.log('候选池 ' + pool.length + ' / ' + INDEX.length + '\n');

if (!ranked.length) {
  console.log('没有匹配的风格。');
  console.log('换法：用更通用的词，或直接 --track 卡通轨 / 写实轨 / 手绘轨 / 三渲二轨 / 定格木偶轨 / 平面工艺轨。');
  process.exit(0);
}

ranked.forEach((x, i) => {
  console.log((i + 1) + '. ' + x.name + '  (' + x.slug + ')');
  console.log('   轨道 ' + x.track + ' · ' + x.dimension + ' · 头身比 ' + x.heads +
    ' · 稳定性 ' + x.stability + (x.ip_note ? ' · IP 约束' : ''));
  console.log('   命中：' + ([...new Set(x.hit)].join('、') || '(过滤命中)'));
  console.log('   取参数：node scripts/get_style.mjs ' + x.slug);
});
