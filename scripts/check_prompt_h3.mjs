#!/usr/bin/env node
/**
 * check_prompt_h3.mjs —— MiniMax H3 面专用机械校验
 *
 * 用法: node check_prompt_h3.mjs <file> [--strict] [--all]
 *
 * 只做机械判定：六段结构、标签一致性、<d> 对白、切点标记、时长闸门、正文纯度。
 * 审美与逻辑仍按 SKILL.md Step 4 人工复核。
 * 字段口径见 references/MiniMaxH3适配.md，权威来源为 h3-prompt-writing skill 的
 * references/base-en.txt 与 references/ref-en.txt。
 */
import { readFileSync } from 'node:fs';

const SECTIONS = [
  'subject_definitions',
  'summary',
  'retention_analysis',
  'detailed_description',
  'overall_soundscape',
  'non_diegetic_music',
];

const RETENTION_VISUAL = ['fully_preserved', 'partially_preserved', 'attribute_transfer', 'weak_reference'];
const RETENTION_AUDIO = ['fully_copy', 'partially_copy', 'reference', 'weak_reference'];

const NEG_WORDS = /\b(no|not|never|avoid|without|free of|devoid of)\b/gi;

// ---------------------------------------------------------------- 切块

function splitBlocks(lines) {
  const blocks = [];
  let cur = { title: '（全文）', lines: [], start: 1 };
  lines.forEach((line, i) => {
    // liqi 参数行形如 "# model: ..."，不能当 markdown 标题去切块，否则参数行会被切出正文
    const isParam = /^#{1,3}\s*(model|mode|duration|ratio|refs|输出规格|景深注记|保真预算|交接|Must\s*not|后期|分辨率|帧率)\s*[:：]/i.test(line);
    const isHead = !isParam && (/^#{1,3}\s+/.test(line) || /^={4,}\s*$/.test(line) || /^镜\s*\d/.test(line));
    const isNewDef =
      /^subject_definitions\s*:/.test(line) &&
      cur.lines.some((l) => /^subject_definitions\s*:/.test(l));
    if (isHead || isNewDef) {
      if (cur.lines.some((l) => l.trim())) blocks.push(cur);
      cur = { title: isHead ? line.replace(/^#+\s*/, '').trim() : '（无标题块）', lines: [], start: i + 1 };
      if (!isHead) cur.lines.push(line);
      return;
    }
    cur.lines.push(line);
  });
  if (cur.lines.some((l) => l.trim())) blocks.push(cur);
  return blocks;
}

// ---------------------------------------------------------------- 取段

/** 把块切成 {name: 段名, body: 段正文} 列表；正文里排除 liqi 参数行（以 # 开头）。 */
function parseSections(block) {
  const out = [];
  let cur = null;
  for (const line of block.lines) {
    const m = line.match(/^(subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music)\s*:\s*(.*)$/);
    if (m) {
      cur = { name: m[1], body: m[2] ? [m[2]] : [], line: 0 };
      out.push(cur);
      continue;
    }
    if (cur) {
      if (/^#{1,2}\s/.test(line)) { cur = null; continue; } // 下一节标题，结束当前段
      cur.body.push(line);
    }
  }
  return out;
}

/** 正文 = 六个段的内容，排除参数行 */
function bodyText(sections) {
  return sections
    .map((s) => s.body.filter((l) => !/^\s*#\s/.test(l)).join('\n'))
    .join('\n');
}

// ---------------------------------------------------------------- 检查

function checkBlock(block, issues) {
  const where = block.title;
  const sections = parseSections(block);
  const found = sections.map((s) => s.name);

  // 1. 六段齐全 + 顺序 + 重复
  for (const need of SECTIONS) {
    if (!found.includes(need)) {
      issues.push({
        level: 'error',
        code: 'E-SECTION-MISSING',
        where,
        msg: `缺少字段 ${need}`,
        hint: 'Ref2VA 六段顺序固定：subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music',
      });
    }
  }
  const order = found.filter((n) => SECTIONS.includes(n));
  for (let i = 1; i < order.length; i++) {
    if (SECTIONS.indexOf(order[i]) <= SECTIONS.indexOf(order[i - 1])) {
      issues.push({
        level: 'error',
        code: 'E-SECTION-ORDER',
        where,
        msg: `字段顺序错：${order[i - 1]} 之后出现 ${order[i]}`,
        hint: '顺序与字段名一个字都不能改',
      });
    }
  }
  const dup = order.filter((n, i) => order.indexOf(n) !== i);
  if (dup.length) {
    issues.push({ level: 'error', code: 'E-SECTION-DUP', where, msg: `字段重复出现：${[...new Set(dup)].join(', ')}`, hint: '一条提示词只有一套六段' });
  }

  const defSec = sections.find((s) => s.name === 'subject_definitions');
  const sumSec = sections.find((s) => s.name === 'summary');
  const retSec = sections.find((s) => s.name === 'retention_analysis');
  const descSec = sections.find((s) => s.name === 'detailed_description');

  const defText = defSec ? defSec.body.join('\n') : '';
  const descText = descSec ? descSec.body.join('\n') : '';
  const allText = bodyText(sections);

  // 2. 标签体系
  const defined = new Set();
  for (const m of defText.matchAll(/<(Subject|Picture|Video|Audio)\s*(\d+)>/g)) defined.add(`${m[1]} ${m[2]}`);

  const used = new Set();
  for (const m of allText.matchAll(/<(Subject|Picture|Video|Audio)\s*(\d+)>/g)) used.add(`${m[1]} ${m[2]}`);

  for (const u of used) {
    if (!defined.has(u)) {
      issues.push({
        level: 'error',
        code: 'E-TAG-UNDEFINED',
        where,
        msg: `<${u.replace(' ', ' ')}> 在正文出现，但 subject_definitions 里没有定义`,
        hint: '所有标签必须在 subject_definitions 定义一次，之后全片沿用，不得在 summary / retention_analysis 引入新标签',
      });
    }
  }
  if (defined.size > 12) {
    issues.push({ level: 'error', code: 'E-REF-LIMIT', where, msg: `参考标签 ${defined.size} 个，超过 Ref2VA 上限 12`, hint: '砍素材再写，不要靠截断' });
  }
  if (used.size && defined.size > used.size) {
    const unused = [...defined].filter((d) => !used.has(d));
    issues.push({ level: 'warn', code: 'W-TAG-UNUSED', where, msg: `定义了但正文从未使用：${unused.join(', ')}`, hint: '确认是否漏写，或从 subject_definitions 删掉' });
  }

  // 3. 对白 <d>
  const open = (allText.match(/<d>/g) || []).length;
  const close = (allText.match(/<\/d>/g) || []).length;
  if (open !== close) {
    issues.push({ level: 'error', code: 'E-DIALOG-PAIR', where, msg: `<d> ${open} 个 / </d> ${close} 个，不成对`, hint: '对白必须写在 <d>原文</d> 里' });
  }
  for (const m of allText.matchAll(/<d>([^<]{0,80})/g)) {
    if (!/^\[[A-Za-z\u4e00-\u9fff]+\]/.test(m[1].trim())) {
      issues.push({
        level: 'error',
        code: 'E-DIALOG-LANG',
        where,
        msg: `<d> 后缺少语言标记：${m[1].slice(0, 40)}`,
        hint: '格式 <d>[Chinese] 台词</d>，语言标记不能省',
      });
    }
  }
  // 对白只写一次
  if (open > 0 && sumSec) {
    const sumD = (sumSec.body.join('\n').match(/<d>/g) || []).length;
    if (sumD > 0) {
      issues.push({ level: 'error', code: 'E-DIALOG-IN-SUMMARY', where, msg: 'summary 里出现了 <d> 对白', hint: '台词只在对应 Shot 写一次，重复写会被当成两次发声' });
    }
  }

  // 4. 切点标记 [Shot N]
  const shots = [...descText.matchAll(/\[Shot\s*(\d+)\]([^\n]*)/g)];
  let maxSec = 0;
  shots.forEach((m, i) => {
    const n = Number(m[1]);
    if (i > 0 && n !== i + 1) {
      issues.push({ level: 'error', code: 'E-SHOT-ORDER', where, msg: `[Shot ${n}] 位置错，第 ${i + 1} 个 Shot 编号应为 ${i + 1}`, hint: 'Shot 按播放顺序连续编号' });
    }
    if (i > 0 && !/At\s+\d{2}:\d{2}\.\d{3}/.test(m[2])) {
      issues.push({ level: 'error', code: 'E-SHOT-TIME', where, msg: `[Shot ${n}] 缺少切点时间`, hint: '第二镜起写 [Shot N] At MM:SS.mmm, ...' });
    }
    const t = m[2].match(/At\s+(\d{2}):(\d{2})\.(\d{3})/);
    if (t) maxSec = Math.max(maxSec, Number(t[1]) * 60 + Number(t[2]) + Number(t[3]) / 1000);
  });
  if (shots.length === 0 && descText.trim()) {
    issues.push({ level: 'warn', code: 'W-NO-SHOT', where, msg: 'detailed_description 里没有 [Shot N] 标记', hint: '单镜也要写 [Shot 1]' });
  }

  // 5. 时长闸门 4-15s
  const paramDur = block.lines.map((l) => l.match(/#\s*duration\s*:\s*(\d+(?:\.\d+)?)\s*s/i)).find(Boolean);
  const dur = paramDur ? Number(paramDur[1]) : maxSec || 0;
  if (dur === 0) {
    issues.push({ level: 'warn', code: 'W-DURATION-UNK', where, msg: '读不到时长（参数行 # duration 或 Shot 切点）', hint: 'H3 单条 4-15s，必须可判定' });
  } else if (dur < 4 || dur > 15) {
    issues.push({ level: 'error', code: 'E-DURATION', where, msg: `时长 ${dur}s 越界（H3 单条 4-15s）`, hint: '超过 15 秒必须拆成多条分别生成再拼' });
  }

  // 6. Must not 不得进正文
  for (const line of block.lines) {
    if (/^\s*Must\s*not\s*[:：]/i.test(line)) {
      issues.push({
        level: 'error',
        code: 'E-MUSTNOT-INLINE',
        where,
        msg: `正文出现 Must not 行：${line.trim().slice(0, 50)}`,
        hint: 'H3 无 negative 字段。Must not 降级为参数行注释：# Must not（仅供人读，不进 H3 正文）',
      });
    }
  }

  // 7. 否定式频率（只数 [Shot 1] 之后的画面描述；风格锚里的否定补语是官方用法，不计）
  const descBody = shots.length ? descText.slice(descText.indexOf('[Shot 1]')) : descText;
  const neg = (descBody.match(NEG_WORDS) || []).length;
  if (neg > 6) {
    issues.push({ level: 'warn', code: 'W-NEGATION', where, msg: `detailed_description 里否定词 ${neg} 处（阈值 6）`, hint: '命名即种下。改成正面描述，例如不写 no 3D，写 flat hand-painted artwork on paper' });
  }

  // 8. 体量 350-500 英文词
  const words = descText.split(/\s+/).filter(Boolean).length;
  if (descText.trim() && (words < 350 || words > 500)) {
    issues.push({
      level: 'warn',
      code: 'W-WORDCOUNT',
      where,
      msg: `detailed_description ${words} 词（生成任务通常 350-500）`,
      hint: '对白密集时优先保证台词时间轴完整，不凑字数；编辑类任务不受此范围限制',
    });
  }

  // 9. 英文正文混中文
  if (descText.trim()) {
    const cn = (descText.match(/[\u4e00-\u9fff]/g) || []).length;
    const chars = descText.replace(/\s/g, '').length;
    if (chars > 0 && cn / chars > 0.3) {
      issues.push({
        level: 'error',
        code: 'E-CN-IN-EN',
        where,
        msg: `detailed_description 中文占比 ${(cn / chars * 100).toFixed(0)}%（阈值 30%）`,
        hint: '正文必须英文，只有 <d> 对白与画面可见文字保留原语言',
      });
    }
  }

  // 10. retention_analysis 标记
  if (retSec) {
    for (const line of retSec.body) {
      if (!/<(Subject|Picture|Video|Audio)\s*\d+>/.test(line)) continue;
      const ok = [...RETENTION_VISUAL, ...RETENTION_AUDIO].some((k) => line.includes(k));
      if (!ok) {
        issues.push({
          level: 'error',
          code: 'E-RETENTION-MARKER',
          where,
          msg: `retention 行缺关系标记：${line.trim().slice(0, 45)}`,
          hint: `视觉用 ${RETENTION_VISUAL.join(' / ')}，音频用 ${RETENTION_AUDIO.join(' / ')}，不能自造`,
        });
      }
    }
  }

  // 11. 风格锚必须在 [Shot 1] 之前
  if (shots.length) {
    const idx = descText.indexOf('[Shot 1]');
    const head = descText.slice(0, idx).trim();
    if (head.length < 40) {
      issues.push({ level: 'warn', code: 'W-STYLE-ANCHOR', where, msg: '[Shot 1] 之前没有风格锚句（或过短）', hint: '风格锚写 1-2 句英文，全片逐字复用，见 水墨淡彩2D风格锚.md' });
    }
  }

  return {
    title: where,
    shots: shots.length,
    duration: dur || '?',
    words,
    refs: defined.size,
  };
}

// ---------------------------------------------------------------- 主流程

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log('用法: node check_prompt_h3.mjs <file> [--strict] [--all]');
    process.exit(2);
  }
  const file = argv[0];
  const strict = argv.includes('--strict');
  const showAll = argv.includes('--all');
  const MAX_PER_CODE = showAll ? Infinity : 4;

  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`E-INPUT: 无法读取 ${file} —— ${e.message}`);
    process.exit(2);
  }

  const lines = raw.split(/\r?\n/);
  const blocks = splitBlocks(lines);

  // 交付稿里常混有说明段落、风格锚、参数行。只有真正出现 H3 字段名的块才是提示词块，
  // 其余跳过——否则说明段会被当成「缺六个字段」狂报，噪音淹没真问题。
  const isPromptBlock = (b) =>
    /^\s*(subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music)\s*:/m.test(
      b.lines.join('\n')
    );
  const promptBlocks = blocks.filter(isPromptBlock);
  const skipped = blocks.length - promptBlocks.length;

  const issues = [];
  const summary = promptBlocks.map((b) => checkBlock(b, issues));

  console.log(`\n校验（MiniMax H3 面）：${file}`);
  console.log(`提示词条数：${summary.length}${skipped ? `　（跳过 ${skipped} 个非提示词块）` : ''}`);
  if (summary.length === 0) {
    console.log('❌ 没有找到任何含 H3 字段的提示词块。\n');
    if (/\[?【时间轴】|Shot \d+ \(\d/.test(raw)) {
      console.log('   这份文件看起来是 Seedance 面的包（检测到中文【时间轴】或 Seedance 段头）。');
      console.log('   H3 字段才是本脚本的识别依据，拿 Seedance 包跑这里必然查不出东西。');
      console.log('   请改跑：node scripts/check_prompt.mjs <file> [--surface cn|intl]\n');
    } else {
      console.log('   确认文件里有没有 subject_definitions / summary / detailed_description 等 H3 字段。\n');
    }
    process.exit(1);
  }
  console.log('─'.repeat(60));
  for (const s of summary) {
    console.log(`  ${s.title}　Shot ${s.shots}　时长 ${s.duration}s　正文 ${s.words} 词　参考 ${s.refs}`);
  }
  console.log('─'.repeat(60));

  if (issues.length === 0) {
    console.log('\n✅ 全部通过（0 error / 0 warning）\n');
    process.exit(0);
  }

  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');

  const group = {};
  for (const i of issues) (group[i.code] ||= []).push(i);
  for (const [code, list] of Object.entries(group)) {
    console.log(`\n[${list[0].level === 'error' ? 'ERROR' : 'WARN '}] ${code}  ×${list.length}`);
    for (const i of list.slice(0, MAX_PER_CODE)) {
      console.log(`   · ${i.where}`);
      console.log(`     ${i.msg}`);
      if (i.hint) console.log(`     → ${i.hint}`);
    }
    if (list.length > MAX_PER_CODE) console.log(`   … 另有 ${list.length - MAX_PER_CODE} 处`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`结果：${errors.length} error / ${warns.length} warning`);
  if (errors.length === 0 && warns.length > 0) {
    console.log('⚠️  无阻断性错误，warning 建议处理（--strict 可将 warning 视为失败）');
  }
  console.log('提示：本工具只做机械判定。审美、逻辑与跨镜一致性仍按 SKILL.md Step 4 人工复核。');
  console.log('      其他脚本照跑：audit_literal.py（抽象表述）、audit_project.py、audit_risk.py。\n');

  process.exit(errors.length > 0 || (strict && warns.length > 0) ? 1 : 0);
}

main();
