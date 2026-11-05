#!/usr/bin/env node
// 由角色设定生成 4 View 资产板提示词块。零依赖。
// 用法：node scripts/cast_sheet.mjs <cast.json> [--check]
import fs from 'node:fs';
import { validate, FACE, WARDROBE } from './lib/validate.mjs';

const file = process.argv[2];
const wantCheck = process.argv.includes('--check');
if (!file) {
  console.error('用法：node scripts/cast_sheet.mjs <cast.json> [--check]');
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
if (errors.length) {
  console.error('校验未通过（' + errors.length + ' ERROR）：');
  errors.forEach(e => console.error('  · ' + e));
  warns.forEach(w => console.error('  ~ ' + w));
  process.exit(1);
}

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const g = cast.gender === '男' || cast.gender === 'male' ? 'male' : 'female';
const anchorCN = cast.age_range + '岁' + (g === 'male' ? '男性' : '女性') + (cast.identity ? '（' + cast.identity + '）' : '');
const faceCn = plain(cast.face) ? cast.face : {};
const wardrobeCn = plain(cast.wardrobe) ? cast.wardrobe : {};
const faceEn = plain(cast.face_en) ? cast.face_en : {};
const wardrobeEn = plain(cast.wardrobe_en) ? cast.wardrobe_en : {};
// 有 *_en 就用英文，否则用中文（中文对部分模型偏弱，README 已说明）
const face = Object.fromEntries(Object.entries(faceCn).map(([k, v]) => [k, faceEn[k] || v]));
const wardrobe = Object.fromEntries(Object.entries(wardrobeCn).map(([k, v]) => [k, wardrobeEn[k] || v]));
const palette = Array.isArray(cast.palette) ? cast.palette : [];
const versions = Array.isArray(cast.versions) ? cast.versions : [];
const height = Number(cast.height_cm);

const paletteText = palette.map(c => {
  if (typeof c === 'string') return c;
  return (c.name || '色名待补') + ' ' + c.hex + (c.part ? '（' + c.part + '）' : '');
}).join('、');

// 全卡只允许这几处带字；未启用音色时少一处。
const textSlots = ['height value', 'palette color names'];
if (cast.audio_label) textSlots.push('bottom-band English timbre label');

const card = 'professional 4-view character sheet, 16:9, bright gray studio background, ' +
  'fine blueprint guide grid, zero annotation lines, zero leader lines, zero arrows; ' +
  'card text only in these places: ' + textSlots.join(', ') + '; ' +
  'no other renderable text, no garbled characters';

const left = [
  'close-up head portrait, sharp facial detail',
  'face shape: ' + face.bone,
  'brows: ' + face.brow,
  'eyes: ' + face.eye,
  'pupils: ' + face.pupil,
  'nose: ' + face.nose,
  'lips: ' + face.lip,
  'jawline: ' + face.jaw,
  'ears: ' + face.ear,
  face.mark && face.mark !== '无' ? 'distinctive mark: ' + face.mark : '',
  'skin and facial structure: ' + face.skin,
  'neutral expression, mouth closed, eyes open',
  'top of head fully inside frame with 5% headroom, bottom edge cuts two fingers below the collarbone, chin at 85-90% of the panel height',
  'shoulders covered by the same outer garment as the right panels, collar visible, shoulders and neck not bare',
  'no props, no view name text, no character name text, no panel number text, no caption, no annotation lines, no leader lines, no arrows',
  anchorCN
].filter(Boolean).join(', ');

const right = [
  'three full-body views in one frame, three equal vertical thirds, order: front, 90-degree side profile, back',
  'head fully inside frame in all three views; keep head shape, hairstyle, neck and shoulder line, but render a featureless face: no eyes, no nose, no mouth, smooth untextured facial plane, blank face',
  'full body from top of head to shoes in all three views, no cropped head, no cropped feet, shoes and soles fully visible, feet aligned to one ground baseline',
  'shoulder width, torso length, limb length and hem length identical across the three views',
  'wardrobe: ' + wardrobe.fabric + ', ' + wardrobe.texture + ', ' + wardrobe.drape + ', ' + wardrobe.wear + ', ' + wardrobe.metal + ', ' + wardrobe.seam
].join(', ');

const heightLine = 'HEIGHT LINE: vertical reference line at the far left of the three body panels, ' +
  'zero mark precisely aligned to the ground baseline, extending from the feet to the top of the head, ' +
  'short tick marks, value "' + height + ' cm" beside the line, ' +
  'clear gap between line and body, never overlapping or crossing the figure';

const paletteLine = 'PALETTE: circular color swatches in a corner, each labeled with its Chinese color name and hex value: ' + paletteText;

const bottom = cast.audio_label
  ? 'bottom band (12%): thin horizontal waveform strip on the left, abstract monochrome waveform, ' +
    'no axes, no ticks, no numbers, no legend, no text; on the right the English timbre label "' +
    cast.audio_label + '", one line, fully legible, no distortion, no missing glyphs'
  : 'bottom band (12%): thin horizontal waveform strip only, no label';

const negative = [
  'different face', 'drifting features', 'inconsistent age', 'plastic skin',
  'props', 'annotation lines', 'leader lines', 'arrows', 'watermark',
  'unintelligible scribbles', 'gibberish marks',
  'clear facial features in the right-side views', 'second recognizable face',
  'duplicate front view panel', 'extra fifth panel', 'five-panel layout',
  'view name text', 'character name text', 'panel number text', 'border text',
  'caption', 'subtitle', 'logo', 'signature', 'UI elements',
  'head out of frame', 'cropped head', 'mosaic censoring bar', 'pixelated face'
].join(', ');

const out = [];
out.push('[4 VIEW CHARACTER SHEET]');
out.push('CARD: ' + card);
out.push('SUBJECT: ' + (cast.name || '') + ' · ' + anchorCN);
out.push('');
out.push('LAYOUT: main view area 88%, bottom detail band 12%, separated by one thin straight divider line; the band contains no face or body and does not count as a panel');
out.push('');
out.push('LEFT (25%): ' + left);
out.push('');
out.push('RIGHT (75%): ' + right);
out.push('');
out.push(heightLine);
out.push('');
out.push(paletteLine);
out.push('');
out.push('BOTTOM: ' + bottom);
out.push('');
out.push('NEGATIVE (base): ' + negative);
if (versions.length) {
  out.push('');
  out.push('NEGATIVE (per version — use only the line matching the version you render, never combine versions):');
  versions.forEach(v => {
    const terms = Array.isArray(v.interlock_en) && v.interlock_en.length ? v.interlock_en : v.interlock;
    out.push('  - ' + v.name + ': ' + terms.join(', '));
  });
  out.push('');
  out.push('VERSIONS:');
  versions.forEach(v => {
    out.push('  - ' + v.name + ' [' + v.verdict + ']' + (v.diff ? ': ' + v.diff : ''));
  });
}

console.log(out.join('\n'));

if (wantCheck) {
  console.log('\n--- 文字锁 16 项 ---');
  FACE.forEach((k, i) => console.log('  ' + String(i + 1).padStart(2) + '. ' + k.padEnd(8) + (face[k] || '(缺)')));
  WARDROBE.forEach((k, i) => console.log('  ' + String(i + 11).padStart(2) + '. ' + k.padEnd(8) + (wardrobe[k] || '(缺)')));
  console.log('      性别锚点: ' + anchorCN);
  console.log('      身高线: ' + height + ' cm');
  console.log('      色板: ' + paletteText);
  console.log('\n--- 出图前九问 ---');
  [
    '左 25% / 右 75% 三等分，顺序 正面→90°侧面→背面',
    '右区写了「头部完整入画 + 面部不刻画五官」+ featureless face，且没有误写「无头」',
    '16 项写满，性别锚点收尾',
    '表情中性',
    '零道具',
    '三个 HEX 带 #、带中文色名、来自注册表',
    '右区是「保头无脸」不是「无头」',
    '三格完整到鞋，不裁头不裁脚',
    '排版 88% + 12%、身高线数值、音色标签 ≤8 词、负向词无裸 text/letters/words、零引线'
  ].forEach((q, i) => console.log('  ' + (i + 1) + '. [ ] ' + q));
  warns.forEach(w => console.log('  ~ ' + w));
} else if (warns.length) {
  warns.forEach(w => console.error('WARN: ' + w));
}
