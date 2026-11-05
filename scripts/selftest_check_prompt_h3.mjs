#!/usr/bin/env node
/**
 * selftest_check_prompt_h3.mjs —— check_prompt_h3.mjs 的结构分发自测（v5.37.1）
 *
 * 为什么单独建一个：H3 校验器此前**没有任何自测**，而它的结构判据刚刚从「一套六段」改成
 * 「按 # mode: 分两套」（审查报告 MA-3）。这种「默认值变了」的改动最容易静默回归：
 * 改错一处，base 包会重新被当成六段包刷一片 E-SECTION-MISSING，或者反过来六段包不再被要求顺序。
 *
 * 覆盖：
 *   M1  base 三字段包（# mode: T2VA）       → 0 error，且按 base 判
 *   M2  base 包缺 non_diegetic_music        → E-SECTION-MISSING（且提示 base 三字段）
 *   M3  Ref2VA 六段齐全                     → 无 E-SECTION
 *   M4  Ref2VA 缺 detailed_description      → E-SECTION-MISSING
 *   M5  Ref2VA 段序错（overall 在 detailed 前）→ E-SECTION-ORDER
 *   M6  声明 T2VA 却写六段                  → W-MODE-FIELD-MISMATCH + E-SECTION-MISSING
 *   M7  既无 # mode: 也无任何可反推字段      → W-MODE-UNDECLARED
 *   M8  # mode: 乱写                        → W-MODE-UNDECLARED
 *   M9  时长 4s × h3max 档                  → E-DURATION（Max 5s 下限）
 *   M10 base 模式不报 W-STYLE-ANCHOR（风格句在 [Shot 1] 之后是官方写法）
 *
 * 用法：node selftest_check_prompt_h3.mjs
 * 退出码：0 = 全过；1 = 有败
 * 不调模型、不花额度、不写任何文件（走进程内调用，不 spawn）。
 */

import { checkBlock } from './check_prompt_h3.mjs';
import { MODEL_LIMITS } from './model_limits.mjs';

const BASE_MD = [
  '# model: MiniMax-H3 | # mode: T2VA | # duration: 8s | # ratio: 16:9',
  '',
  'integrated_multimodal_description: [Shot 1] Flat hand-painted artwork on paper, a narrow alley at dusk. '
    + 'An old man in a gray coat stands under the eave, one hand on the wooden door frame, looking toward the '
    + 'far end of the lane. Slow dolly in. [Shot 2] At 00:04.000, the camera cuts to a close-up of his hand '
    + 'tightening on the frame, dust drifting in the light. He speaks quietly. <d>[Chinese] 风要起了。</d>',
  'overall_soundscape: Wind moving through the alley, a distant metal sign creaking, footsteps on wet stone.',
  'non_diegetic_music: N/A',
].join('\n');

const REF_MD = [
  '# model: MiniMax-H3 | # mode: Ref2VA | # duration: 8s',
  '',
  'subject_definitions:',
  '  <Subject 1> is an old man in a gray coat, silver hair, a brass-tipped cane in his right hand.',
  'summary: A quiet room, one old man waiting for the wind.',
  'retention_analysis:',
  '  <Subject 1> fully_preserved across all shots.',
  'detailed_description: |',
  '  Flat hand-painted artwork on paper, low saturation, a single warm lamp as the only strong hue.',
  '  [Shot 1] The old man sits still in the dim room, cane against the wall, lamp above his left shoulder.',
  '  [Shot 2] At 00:04.000, the camera cuts to his hand tightening on the cane, dust drifting in the light.',
  'overall_soundscape: Room tone, a clock ticking off-screen, the cane tapping once on the floor.',
  'non_diegetic_music: N/A',
].join('\n');

/** 把 md 文本做成 checkBlock 吃的 block 结构（与 CLI 的 splitBlocks 产物同形） */
function blockOf(md, title = '（全文）') {
  const lines = md.split('\n');
  return { title, lines, start: 1 };
}

function run(md, limit = MODEL_LIMITS.h3) {
  const issues = [];
  const info = checkBlock(blockOf(md), issues, limit);
  return { issues, codes: new Set(issues.map((i) => i.code)), info };
}

// ---------------------------------------------------------------- harness

let pass = 0;
const fails = [];

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(`  ✗ ${name}\n${detail}`);
    console.log(`  ✗ ${name}`);
    console.log(detail);
  }
}

const has = (r, code) => r.codes.has(code);
const errOf = (r, code) => r.issues.find((i) => i.code === code && i.level === 'error');

console.log('check_prompt_h3.mjs 结构分发自测：10 组');

// M1
{
  const r = run(BASE_MD);
  check('M1 base 三字段包 → 0 error，且按 base 判',
    !r.issues.some((i) => i.level === 'error') && r.info.mode === 'base',
    `  mode=${r.info.mode}；error=${r.issues.filter((i) => i.level === 'error').map((i) => i.code).join(',') || '无'}`);
}

// M2
{
  const md = BASE_MD.replace('non_diegetic_music: N/A', '');
  const r = run(md);
  const e = errOf(r, 'E-SECTION-MISSING');
  check('M2 base 包缺 non_diegetic_music → E-SECTION-MISSING（提示 base 三字段）',
    !!e && /base 三字段/.test(e.msg),
    `  命中=${[...r.codes].join(',') || '无'}；msg=${e ? e.msg : '（无）'}`);
}

// M3
{
  const r = run(REF_MD);
  check('M3 Ref2VA 六段齐全 → 无 E-SECTION-*',
    ![...r.codes].some((c) => c.startsWith('E-SECTION')) && r.info.mode === 'ref2va',
    `  mode=${r.info.mode}；命中=${[...r.codes].join(',') || '无'}`);
}

// M4
{
  const md = REF_MD.split('\n').filter((l) => !/^(detailed_description|  Flat|  \[Shot)/.test(l)).join('\n');
  const r = run(md);
  check('M4 Ref2VA 缺 detailed_description → E-SECTION-MISSING',
    has(r, 'E-SECTION-MISSING'),
    `  命中=${[...r.codes].join(',') || '无'}`);
}

// M5
{
  // 把 overall_soundscape 挪到 detailed_description 之前 → 段序错
  const lines = REF_MD.split('\n');
  const iOverall = lines.findIndex((l) => l.startsWith('overall_soundscape:'));
  const iDesc = lines.findIndex((l) => l.startsWith('detailed_description:'));
  const moved = lines.splice(iOverall, 1)[0];
  lines.splice(iDesc, 0, moved);
  const r = run(lines.join('\n'));
  check('M5 Ref2VA 段序错 → E-SECTION-ORDER',
    has(r, 'E-SECTION-ORDER'),
    `  命中=${[...r.codes].join(',') || '无'}`);
}

// M6
{
  const md = REF_MD.replace('# mode: Ref2VA', '# mode: T2VA');
  const r = run(md);
  check('M6 声明 T2VA 却写六段 → W-MODE-FIELD-MISMATCH + E-SECTION-MISSING',
    r.info.mode === 'base' && has(r, 'W-MODE-FIELD-MISMATCH') && has(r, 'E-SECTION-MISSING'),
    `  mode=${r.info.mode}；命中=${[...r.codes].join(',') || '无'}`);
}

// M7
{
  const r = run('# duration: 8s\n\nsomething else entirely\n');
  check('M7 判不出模式 → W-MODE-UNDECLARED',
    has(r, 'W-MODE-UNDECLARED'),
    `  命中=${[...r.codes].join(',') || '无'}`);
}

// M8
{
  const md = BASE_MD.replace('# mode: T2VA', '# mode: V2VA');
  const r = run(md);
  check('M8 # mode: 乱写 → W-MODE-UNDECLARED（并落回结构反推）',
    has(r, 'W-MODE-UNDECLARED') && r.info.mode === 'base',
    `  mode=${r.info.mode}；命中=${[...r.codes].join(',') || '无'}`);
}

// M9
{
  const md = BASE_MD.replace('# duration: 8s', '# duration: 4s');
  const rOk = run(md, MODEL_LIMITS.h3);
  const rMax = run(md, MODEL_LIMITS.h3max);
  const e = errOf(rMax, 'E-DURATION');
  check('M9 4s × h3max → E-DURATION（H3 档放行）',
    !has(rOk, 'E-DURATION') && !!e && /5-15s/.test(e.msg),
    `  h3 命中 E-DURATION=${has(rOk, 'E-DURATION')}（应 false）；h3max=${!!e}；msg=${e ? e.msg : '（无）'}`);
}

// M10
{
  const rBase = run(BASE_MD);
  const rRef = run(REF_MD);
  check('M10 base 模式不报 W-STYLE-ANCHOR（Ref2VA 才查风格锚位置）',
    !has(rBase, 'W-STYLE-ANCHOR') && !has(rRef, 'W-STYLE-ANCHOR'),
    `  base 命中=${has(rBase, 'W-STYLE-ANCHOR')}；ref 命中=${has(rRef, 'W-STYLE-ANCHOR')}（ref 的锚句在 [Shot 1] 前，也不该报）`);
}

console.log('─'.repeat(56));
console.log(`结果：${pass} 过 / ${fails.length} 败`);
for (const f of fails) console.log(f);
process.exit(fails.length > 0 ? 1 : 0);
