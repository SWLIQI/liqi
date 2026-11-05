#!/usr/bin/env node
/**
 * selftest_check_style.mjs —— check_style.mjs 的击穿用例自测
 *
 * 进程内黑盒，不 spawn 子进程：**沙箱里 spawn 会 EBUSY**（实测 2026-10-13，
 * `spawnSync ... EBUSY`），子进程方案跑不起来。为此把 check_style.mjs 的判定核心
 * 抽成导出函数 `collectStyleIssues(src, opts)`，与 check_prompt.mjs 的结构对齐。
 *
 * 为什么需要本文件：v4.7.6 给 check_style 加了四项「判定边界」能力——
 * 假绿防线 S0、S7 逐单元落点、出图面 seedream、资产包单元识别。
 * 没有自测就没有回归守护：下一次改动把资产单元头正则删掉，不会有人发现。
 *
 * 用法：node selftest_check_style.mjs
 * 退出码：0 = 全过；1 = 有失败
 * 不调模型、不花额度、不写任何文件。
 */

import { collectStyleIssues } from './check_style.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- 样本

const PRESS_FIRST = '一幅当代中国城市的写实实拍电影画面，取的是老胶片志怪剧照那一路。';
const PRESS_FULL = PRESS_FIRST
  + '整体低饱和、低对比，暗部压深但保留细节，绝不死黑。皮肤可见毛孔、细纹与眼袋，不做磨皮，也不取网红面孔。'
  + '布料起毛、水泥返碱、旧木开裂在近距离都清晰可辨。每一镜只有一个有依据的实用光源，方向写得到，衰减自然，留下大面积真实阴影。'
  + '中式民俗元素只允许作为写实画面之上的一层薄薄叠加：肩头一缕淡灰烟气、身后一层半透明巨兽轮廓。'
  + '画面本体始终是实拍的街道、楼道与写字楼，任何一处都不许变成绘制出来的平面绘画。';
const PALETTE = '低饱和配色：都市冷灰为底，旧木暗褐压住暗部，唯一暖色重音只由画面里唯一的实用光源承担。';

const HEAD = [
  '【三锁】投放面=国内面（【时间轴】骨架）',
  '【风格】urban-folk-filmstill',
];

const VIDEO_OK = [
  ...HEAD,
  '镜 1｜开场（10s）',
  `整体风格：${PRESS_FIRST}甲穿深灰短褂。`,
  '【时间轴】0-10s：中景，固定。甲走入廊下｜镜头：中景 固定｜音效：无',
  '',
].join('\n');

// 本次修掉的真实事故：压句只在卷首，镜块里只写 id 引用
const VIDEO_PREAMBLE_ONLY = [
  ...HEAD,
  '〇 风格锚',
  '统一风格压句（逐字复用）：',
  PRESS_FULL,
  `配色补充句：${PALETTE}`,
  '镜 1｜开场（10s）',
  '整体风格：承接风格锚 urban-folk-filmstill。甲穿深灰短褂。',
  '【时间轴】0-10s：中景，固定。甲走入廊下｜镜头：中景 固定｜音效：无',
  '',
].join('\n');

const ASSET_OK = [
  '【三锁】投放面=出图资产面（中文直出）',
  '【风格】urban-folk-filmstill',
  '〇 风格锚',
  PRESS_FULL,
  `配色补充句：${PALETTE}`,
  '一 资产 CHAR-01｜甲（4 View 角色资产板）',
  '(A) 结构层',
  '1. 环境与气候：影棚底。',
  '(B) 生成 prompt',
  `生成图片：${PRESS_FIRST}专业角色设定表，16:9 画幅。`,
  '二 资产 CHAR-02｜乙（4 View 角色资产板）',
  `生成图片：${PRESS_FIRST}专业角色设定表，16:9 画幅。`,
  '',
].join('\n');

const ASSET_NO_PRESS = [
  '【三锁】投放面=出图资产面（中文直出）',
  '【风格】urban-folk-filmstill',
  `配色补充句：${PALETTE}`,
  '一 资产 CHAR-01｜甲（4 View 角色资产板）',
  '(B) 生成 prompt',
  '生成图片：专业角色设定表，16:9 画幅。甲穿深灰短褂。',
  '',
].join('\n');

// 负面词行豁免：互斥风格名写在「禁止内容：」一行里不算串轨
const NEG_LINE_OK = [
  '【三锁】投放面=国内面（【时间轴】骨架）',
  '【风格】photoreal-pbr',
  '镜 1｜开场（10s）',
  `整体风格：${PRESS_FIRST}`,
  '【时间轴】0-10s：中景，固定。甲走入廊下｜镜头：中景 固定｜音效：无',
  'Must not：卡通感、平涂、描边、Q 版比例、赛璐璐、黏土、微缩布景、定格木偶',
  '',
].join('\n');

// v5.8.2 冻结后一致性：「选定即冻结」= 全包只能用该锚的色域与禁用项
const GAMUT_OUT = [
  ...HEAD,
  '镜 1｜开场（10s）',
  `整体风格：${PRESS_FIRST}甲穿深灰短褂。`,
  '本镜光色基调：主色 #FF00FF，辅色 #123456',
  '【时间轴】0-10s：中景，固定。甲走入廊下｜镜头：中景 固定｜音效：无',
  '',
].join('\n');

// 「霓虹赛博」是 urban-folk-filmstill 的 negative_direction，出现在正文 = 串轨
const BANNED_HIT = [
  ...HEAD,
  '镜 1｜开场（10s）',
  `整体风格：${PRESS_FIRST}甲穿深灰短褂。`,
  '【时间轴】0-10s：中景，固定。甲走入廊下，霓虹赛博的灯牌在身后亮起｜镜头：中景 固定｜音效：无',
  '',
].join('\n');

const CASES = [
  {
    name: 'S10-STYLE-GAMUT-OUT 正文用色越出该锚色域',
    md: GAMUT_OUT,
    expect: ['S10-STYLE-GAMUT-OUT'], ban: [], level: null,
  },
  {
    name: 'S11-STYLE-BANNED-HIT 正文出现该锚明列禁用项',
    md: BANNED_HIT,
    expect: ['S11-STYLE-BANNED-HIT'], ban: [], level: 'ERROR',
  },
  {
    name: '空文件 → S0-NO-SHOT（假绿防线）',
    md: '',
    expect: ['S0-NO-SHOT'], ban: [], level: 'ERROR',
  },
  {
    name: '视频包：镜块内联压句首句 → 通过',
    md: VIDEO_OK,
    expect: ['S7-PRESS-FIRST-ONLY'], ban: ['S7-PRESS-NOT-IN-SHOT', 'S0-NO-SHOT'], level: null,
  },
  {
    name: '视频包：压句只在卷首 → S7-PRESS-NOT-IN-SHOT',
    md: VIDEO_PREAMBLE_ONLY,
    expect: ['S7-PRESS-NOT-IN-SHOT'], ban: [], level: 'ERROR',
  },
  {
    name: '资产包：识别 + 逐条落点 → 通过',
    md: ASSET_OK,
    expect: ['S0-ASSET-PACK'], ban: ['S7-PRESS-NOT-IN-SHOT', 'S0-NO-SHOT'], level: null,
  },
  {
    name: '资产包：条目缺压句 → S7-PRESS-NOT-IN-SHOT',
    md: ASSET_NO_PRESS,
    expect: ['S7-PRESS-NOT-IN-SHOT'], ban: [], level: 'ERROR',
  },
  {
    name: '负面词行里的互斥风格名 → 不算串轨',
    md: NEG_LINE_OK,
    expect: [], ban: ['S5-CROSS-STYLE'], level: null,
  },
];

// ---------------------------------------------------------------- 跑

let pass = 0;
let fail = 0;

console.log(`check_style.mjs 击穿用例自测：${CASES.length + 2} 组（数组内 ${CASES.length} 组 + 数组外 2 组：投放面识别 / 负面词自洽）`);

for (const c of CASES) {
  let r;
  try {
    r = collectStyleIssues(c.md, { surface: 'auto', filePath: 'selftest.md' });
  } catch (e) {
    fail++;
    console.log(`  ✗ ${c.name}`);
    console.log(`      抛异常：${e.message}`);
    continue;
  }
  const codes = r.issues.map((i) => i.code);
  const problems = [];
  for (const s of c.expect) {
    if (!codes.includes(s)) problems.push(`应命中 ${s} —— 未出现。实际：${codes.join(', ') || '（无）'}`);
  }
  for (const s of c.ban) {
    if (codes.includes(s)) problems.push(`应避开 ${s} —— 出现了`);
  }
  if (c.level) {
    const hit = r.issues.find((i) => i.code === c.expect[0]);
    if (hit && hit.lv !== c.level) problems.push(`${c.expect[0]} 应为 ${c.level}，实际 ${hit.lv}`);
  }
  if (problems.length === 0) {
    pass++;
    console.log(`  ✓ ${c.name}`);
  } else {
    fail++;
    console.log(`  ✗ ${c.name}`);
    for (const p of problems) console.log(`      ${p}`);
  }
}

// 投放面识别：资产包必须判成 seedream，否则 S7 会整段跳过
{
  const r = collectStyleIssues(ASSET_OK, { surface: 'auto', filePath: 'selftest.md' });
  if (r.surface === 'seedream') {
    pass++;
    console.log('  ✓ 投放面识别：出图资产面 → seedream');
  } else {
    fail++;
    console.log(`  ✗ 投放面识别：出图资产面 → seedream（实际 ${r.surface}）`);
  }
}

// ---------------------------------------------------------------- 负面词自洽（v5.2.0）
// 规则：**同风格**的 negative_direction 不得禁掉本风格自己的本体词（seed dedupe_pairs 的
// 替换目标）——那会把风格禁掉（dedupe_style.py 注释的四轨教训：水墨词表套赛璐璐删掉
// shadow 与 highlight、定格木偶放过丝滑、写实被去立体，全是自己禁自己本体）。
// 跨风格负面写别家特征（webtoon 禁厚涂、水墨禁赛璐璐描边）是**合法的风格互斥**，
// 归 excludes 与 S5 串轨检测管，本用例不查——查了就是误报。
// 匹配：中文前 4 字关键词（含更短的整段）+ 英文整词（3+ 字母），含即命中。
{
  const seedPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'references', 'style-registry.seed.json');
  let seed = null;
  try {
    seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  } catch (e) {
    fail++;
    console.log(`  ✗ 负面词自洽：读不到 seed（${seedPath}）：${e.message}`);
  }
  if (seed) {
    const styles = seed.styles || {};
    const landed = Object.keys(styles).filter((k) => styles[k].status === '已落值');
    const hits = [];
    let wordCount = 0;
    for (const sid of landed) {
      const bodyWords = [];
      for (const pair of (styles[sid].dedupe_pairs || [])) {
        const target = String((pair && pair[1]) || '').trim();
        if (!target) continue;
        const cn = target.match(/[\u4e00-\u9fff]{2,}/);
        if (cn) bodyWords.push({ w: cn[0].slice(0, 4), full: target });
        for (const w of target.split(/\s+/)) {
          if (/^[A-Za-z]{3,}$/.test(w)) bodyWords.push({ w: w.toLowerCase(), full: target });
        }
      }
      wordCount += bodyWords.length;
      for (const neg of (styles[sid].negative_direction || [])) {
        const negL = String(neg).toLowerCase();
        for (const b of bodyWords) {
          if (negL.includes(b.w)) {
            hits.push(`${sid} 负面词「${neg}」禁掉了自己的本体「${b.full}」（自打脸）`);
          }
        }
      }
    }
    if (hits.length === 0) {
      pass++;
      console.log(`  ✓ 负面词自洽：${landed.length} 个已落值风格、${wordCount} 个本体词关键词，0 自打脸`);
    } else {
      fail++;
      console.log(`  ✗ 负面词自洽：${hits.length} 处自打脸`);
      for (const h of hits.slice(0, 10)) console.log(`      ${h}`);
    }
  }
}

console.log('─'.repeat(56));
console.log(`结果：${pass} 过 / ${fail} 败`);
process.exit(fail > 0 ? 1 : 0);
