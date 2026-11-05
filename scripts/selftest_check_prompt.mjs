#!/usr/bin/env node
/**
 * selftest_check_prompt.mjs —— check_prompt.mjs 的击穿用例自测
 *
 * 设计：进程内黑盒。每个规则码一组「必拦样本」，断言 collectIssues 返回的
 * issues 里出现该码（error 级同时断言存在 error）；干净包控制组断言零 error。
 * 证明每一道门真的会拦——不是文档里写着会拦。
 *
 * 进程内而不是 spawn 子进程：沙箱环境 spawn 会 EBUSY；也更快（<1s 跑完）。
 *
 * ⚠️ 写新用例的三条经验（踩过的坑）：
 *   1. 标题行也算正文——标题里别带「构图/朝向/视线」等检测词，否则目标码被自己满足；
 *   2. 只要写了「场景：…｜人物：」，人物就必须在整体风格小节内联，否则 E-IDENTITY
 *      会盖过你要测的 warn 码（warn 级用例断言「无 error」会假失败）；
 *   3. 带台词的块要给全「时间线分镜」+「声音设计」两节且三写一致（时间线段内 + 镜行尾 + 对白行），否则
 *      E-SECTION-MISSING / E-DIALOGUE-MISSING 会干扰。
 *
 * 用法：node selftest_check_prompt.mjs
 * 退出码：0 = 全过；1 = 有失败（逐条打印）
 * 不调模型、不花额度、不写任何文件。
 */

import {
  collectIssues, parseBeatsFile, isH3Package, splitBlocks, lenDetail,
  detectModel, resolveModel, MODEL_LIMITS, FALLBACK_LIMIT,
} from './check_prompt.mjs';
import { BUILTIN, PROMPT_LENGTH, ratioOk } from './model_limits.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- fixtures

const BEATS = [
  'P01｜场次1｜甲拖着行李箱走进候车厅｜动作',
  'P02｜场次1｜乙（对白）：请出示您的票。｜台词',
  'P03｜场次1｜甲把车票递给乙｜动作',
  'P04｜场次2｜乙低头看票根｜动作',
  '',
].join('\n');
const BEATS_MAP = parseBeatsFile(BEATS);

// v5.43.0 补测：钩子门三态节拍（无 HOOK / 迟到 HOOK / 窗口内 HOOK）
const BEATS_NO_HOOK = parseBeatsFile([
  'P01｜场次1｜甲把行李箱放上长椅｜动作',
  'P02｜场次1｜乙抬头看向甲｜动作',
  'P03｜场次1｜甲侧身从口袋取票｜动作',
  '',
].join('\n'));
const BEATS_HOOK_LATE = parseBeatsFile([
  'P01｜场次1｜甲把行李箱放上长椅｜动作',
  'P02｜场次1｜乙抬头看向甲｜动作',
  'P03｜场次1｜甲侧身从口袋取票｜动作',
  'P04｜场次1｜乙追上甲｜动作',
  'P05｜场次1｜乙掏出两张同款车票｜动作｜HOOK',
  '',
].join('\n'));
const BEATS_HOOK_IN_WINDOW = parseBeatsFile([
  'P01｜场次1｜甲把行李箱放上长椅｜动作',
  'P02｜场次1｜乙抬头看向甲｜动作｜HOOK',
  'P03｜场次1｜甲侧身从口袋取票｜动作',
  '',
].join('\n'));
const EN_LINE = 'A man walks through a dimly lit corridor while the camera follows slowly behind him. ';

// 一个内容完整、零违规的镜块（控制组）
const CLEAN = [
  '镜 1｜开场（10s · 试）',
  '场景：候车厅（冷灰）｜人物：甲、乙',
  '整体风格：写实，甲穿深色大衣，乙穿蓝色制服。',
  '站位：@甲（画面左 · 手搭长椅 · 侧身朝右）；@乙（画面右 · 柜台内 · 正面朝左）',
  '轴线：建立，甲在左三分之一，乙在右三分之一',
  '本镜光色基调：冷青灰；色彩预算：唯一重音色 = 乙的蓝色制服',
  '本镜保真预算：主 = 甲的皮质行李箱；次 = 玻璃反光；省 = 群像',
  '时间线分镜：',
  '【时间轴】0-5s：全景，固定机位。甲把行李箱放上长椅，乙抬头看向甲｜镜头：全景 固定｜音效：轮子声',
  '【时间轴】5-10s：近景，缓推。乙（平稳）：「请出示您的票。」甲侧身从口袋取票｜镜头：近景 缓推｜音效：纸质摩擦',
  '声音设计：',
  '环境层：候车厅广播底噪（极弱、持续）',
  '动作层：行李箱落椅闷响（0-1s）',
  '呼吸层：无',
  '逼近层：无',
  '对白：0:05 乙（平稳）：「请出示您的票。」',
  '刚性约束：',
  '必锁：行李箱 = 棕色皮质黄铜扣，边角磨白（锚「行李箱」图）',
  '可见性：群像 = 仅背景虚化轮廓',
  'Must not：可读文字、字幕、水印',
  '—— 以下不进正文 ——',
  '# duration: 10s | # ratio: 16:9',
  '',
].join('\n');

const H3_SAMPLE = [
  'subject_definitions:',
  '  Subject 1: an old man in a gray coat',
  'summary: A quiet room.',
  'retention_analysis:',
  '  - 0-4s: establish the room',
  'detailed_description: |',
  '  [Shot 1] At 00:00.000 The old man sits still.',
  'overall_soundscape: room tone',
  'non_diegetic_music: none',
  '',
].join('\n');

// v5.37.1：H3 的 base 三字段包（T2VA / I2VA / FL2VA / L2VA）。它没有六段名，
// 旧版 isH3Package 漏判 → 被当成 Seedance 包刷一片 E-SECTION-MISSING（审查报告 MA-3）。
const H3_BASE_SAMPLE = [
  '# model: MiniMax-H3 | # mode: T2VA | # duration: 8s',
  '',
  'integrated_multimodal_description: [Shot 1] Flat artwork on paper, a narrow alley at dusk.',
  'overall_soundscape: Wind through the alley.',
  'non_diegetic_music: N/A',
  '',
].join('\n');

// v5.37.1：本套夹具绝大多数是 2.5 面骨架（国内面【时间轴】），默认显式给 model='2.5'——
// 时长门禁从「写死 30s」改成「按锁①型号取参数」之后，夹具判出什么不该取决于它写没写
// 【模型版本】。型号识别与兜底档另有专项用例（文末「锁①型号」一节），不靠这里顺带覆盖。
const T = (name, opts) => ({ name, expectCodes: [], banCodes: [], expectError: null, model: '2.5', ...opts });

// 参数行替换器（v5.37.2）：CLEAN 的时长 10s 与参数行一一对应，换掉参数行即可单独测参数门
const CLEAN_PARAM = (line) => CLEAN.replace('# duration: 10s | # ratio: 16:9', line);

// 素材上限夹具（v5.37.2 · MA-5）：真实包提到参考图的位置就是出场人物行，按它来造
const REF_MD = (decl, n) => (decl ? `【模型版本】：${decl}\n` : '')
  + '镜 1｜素材（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n'
  + `出场人物：甲——深色便装，右手一支笔（参考 ${Array.from({ length: n }, (_, i) => `@图片${i + 1}`).join('，')}）\n`
  + '【时间轴】0-10s：中景，固定机位。甲坐下｜镜头：中景 固定｜音效：无\n'
  + '—— 以下不进正文 ——\n# duration: 10s | # ratio: 16:9\n';

// 通用最小节结构：带台词的块必须三写一致，否则 E-SECTION/E-DIALOGUE 干扰
const TL = (seg) => `时间线分镜：\n${seg}`;
const SD = (quote) => [
  '声音设计：',
  '环境层：无',
  '动作层：无',
  '呼吸层：无',
  '逼近层：无',
  `对白：0:02 甲（平静）：「${quote}」`,
].join('\n');

// 爽点配方门用的节拍机（v5.20.0）
const SD_BEATS_NONE = parseBeatsFile([
  'P01｜场次1｜甲推门进屋｜动作',
  'P02｜场次1｜甲坐下｜动作',
].join('\n'));
const SD_BEATS_MONO = parseBeatsFile([
  'P01｜场次1｜甲推门反杀（S05）｜动作',
  'P02｜场次1｜甲坐下（S05）｜动作',
].join('\n'));
const SD_BEATS_MIX = parseBeatsFile([
  'P01｜场次1｜反杀（S05）｜动作',
  'P02｜场次1｜温柔（S04）｜动作',
].join('\n'));
const SD_BEATS_SPARSE = parseBeatsFile([
  'P01｜场次1｜反杀（S05）｜动作',
  'P02｜场次1｜甲坐下｜动作',
].join('\n'));

const fixtures = [
  // ---- E 级：时间轴 ----
  T('E-TIMELINE-START', {
    md: '镜 1｜首段位移（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n【时间轴】2-5s：中景。甲坐下｜镜头：中景 固定｜音效：无\n【时间轴】5-10s：近景。甲抬头｜镜头：近景 固定｜音效：无\n',
    expectCodes: ['E-TIMELINE-START'], expectError: true,
  }),
  T('E-TIMELINE-GAP', {
    md: '镜 1｜断轴（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n【时间轴】0-5s：中景。甲坐下｜镜头：中景 固定｜音效：无\n【时间轴】7-10s：近景。甲抬头｜镜头：近景 固定｜音效：无\n',
    expectCodes: ['E-TIMELINE-GAP'], expectError: true,
  }),
  T('E-TIMELINE-END', {
    md: '镜 1｜尾差（12s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n【时间轴】0-10s：中景。甲坐下再抬头｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['E-TIMELINE-END'], expectError: true,
  }),
  T('E-SKELETON-MIX', {
    md: '镜 1｜混骨架（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n【时间轴】0-5s：中景。甲坐下｜镜头：中景 固定｜音效：无\nShot 2 (5-10s): 近景，固定机位。甲抬头。\n',
    expectCodes: ['E-SKELETON-MIX'], expectError: true,
  }),
  // ---- 2.0 面镜头编号骨架（v5.37.1 · 审查报告 MA-2）：此前 parseSegments 不认，整包「段数 0」，
  // 时间轴 / 运镜 / 节拍三组门禁静默跳过。下面四条钉住「认得出 + 按编号判 + 型号不匹配要出声」。
  T('2.0 面镜头编号骨架可解析（不再 W-EMPTY-TIMELINE）', {
    md: '镜 1｜编号骨架（12s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n'
      + '镜头1：全景，固定机位。甲推门进来，手扶门框｜音效：门轴\n'
      + '镜头2：近景，固定机位。甲抬头看向窗外的雨｜音效：风声\n',
    model: '2.0',
    expectCodes: [], banCodes: ['W-EMPTY-TIMELINE', 'E-TIMELINE', 'E-SKELETON-MIX', 'W-SHOTNUM-SEQUENCE'],
    expectError: false,
  }),
  T('W-SHOTNUM-SEQUENCE（编号跳号）', {
    md: '镜 1｜跳号（12s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n'
      + '镜头1：全景，固定机位。甲推门进来｜音效：门轴\n'
      + '镜头3：近景，固定机位。甲抬头看向窗外｜音效：风声\n',
    model: '2.0',
    expectCodes: ['W-SHOTNUM-SEQUENCE'], expectError: false,
  }),
  T('W-SKELETON-MODEL-MISMATCH：2.0 却用时间轴', {
    md: '镜 1｜逆着官方写（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n'
      + '【时间轴】0-5s：中景。甲坐下｜镜头：中景 固定｜音效：无\n'
      + '【时间轴】5-10s：近景。甲抬头｜镜头：近景 固定｜音效：无\n',
    model: '2.0',
    expectCodes: ['W-SKELETON-MODEL-MISMATCH'], expectError: false,
  }),
  T('W-SKELETON-MODEL-MISMATCH：2.5 却只有镜头编号', {
    md: '镜 1｜缺时间范围（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n'
      + '镜头1：中景，固定机位。甲坐下｜音效：无\n'
      + '镜头2：近景，固定机位。甲抬头｜音效：无\n',
    model: '2.5',
    expectCodes: ['W-SKELETON-MODEL-MISMATCH'],
    banCodes: ['W-SHOTNUM-SEQUENCE', 'W-EMPTY-TIMELINE'], expectError: false,
  }),
  // ---- 参数行取值（v5.37.2 · 审查报告 MA-6）：`duration: -1` 与 `ratio: adaptive` 都是
  // 官方合法写法，旧实现一个被当成「没写」（静默放过），另一个被自己的正则捕出来、紧接着
  // 又被四值校验判成违规——**同一段代码前后打架**。下面五条把三态钉住
  // （v5.45.0 锁②四值扩六值，另加 4:3 / 3:4 两条放行正例，扩容值同守）。
  T('参数行 ratio: adaptive 不报 W-PARAM-RATIO（官方默认值）', {
    md: CLEAN_PARAM('# duration: 10s | # ratio: adaptive'),
    banCodes: ['W-PARAM-RATIO'], expectError: false,
  }),
  T('参数行 ratio: 4:3 不报 W-PARAM-RATIO（v5.45.0 扩容值，官方 ratio 原文，时代媒介档）', {
    md: CLEAN_PARAM('# duration: 10s | # ratio: 4:3'),
    banCodes: ['W-PARAM-RATIO'], expectError: false,
  }),
  T('参数行 ratio: 3:4 不报 W-PARAM-RATIO（v5.45.0 扩容值，竖向传统媒介档）', {
    md: CLEAN_PARAM('# duration: 10s | # ratio: 3:4'),
    banCodes: ['W-PARAM-RATIO'], expectError: false,
  }),
  T('参数行 duration: -1 + 秒级时间轴 → W-PARAM-DUR-AUTO（定时权打架）', {
    md: CLEAN_PARAM('# duration: -1 | # ratio: 16:9'),
    expectCodes: ['W-PARAM-DUR-AUTO'],
    banCodes: ['E-PARAM-DUR-MISMATCH', 'W-PARAM-DUR-RANGE'], expectError: false,
  }),
  T('参数行 duration: -1 + 镜头编号骨架 → 不报（2.0 面的正解）', {
    md: '【模型版本】：2.0\n镜 1｜编号骨架（12s）\n场景：客厅（暖白）｜人物：甲\n'
      + '整体风格：甲穿深色便装。\n'
      + '镜头1：全景，固定机位。甲推门进来｜音效：门轴\n'
      + '镜头2：近景，固定机位。甲抬头看向窗外的雨｜音效：风声\n'
      + '—— 以下不进正文 ——\n# duration: -1 | # ratio: adaptive\n',
    model: '2.0',
    banCodes: ['W-PARAM-DUR-AUTO', 'W-PARAM-RATIO', 'W-PARAM-DUR-RANGE', 'E-PARAM-DUR-MISMATCH'],
    expectError: false,
  }),
  T('参数行 duration 不带 s 也认（10 与标题 10s 一致）', {
    md: CLEAN_PARAM('# duration: 10 | # ratio: 16:9'),
    banCodes: ['E-PARAM-DUR-MISMATCH', 'W-PARAM-DUR-RANGE'], expectError: false,
  }),
  T('参数行 duration: 8s 与标题 10s 不一致（回归守卫）', {
    md: CLEAN_PARAM('# duration: 8s | # ratio: 16:9'),
    expectCodes: ['E-PARAM-DUR-MISMATCH'], expectError: true,
  }),
  // ---- 参考素材上限（v5.37.2 · 审查报告 MA-5）：数字写在 model-limits.json 的 refs 里，
  // 此前没有任何脚本读它。四条钉住「按镜块数去重、按锁①取档、未声明时降级为告警」。
  T('E-REF-OVER-LIMIT：2.5 面 31 张图超上限', {
    md: REF_MD('2.5', 31), model: '2.5',
    expectCodes: ['E-REF-OVER-LIMIT'], expectError: true,
  }),
  T('E-REF-OVER-LIMIT 边界：2.5 面 30 张图不报', {
    md: REF_MD('2.5', 30), model: '2.5',
    banCodes: ['E-REF-OVER-LIMIT', 'W-REF-OVER-LIMIT'], expectError: false,
  }),
  T('E-REF-OVER-LIMIT：2.0 面 10 张图（合计 12 的档位）', {
    md: REF_MD('2.0', 10), model: '2.0',
    expectCodes: ['E-REF-OVER-LIMIT'], expectError: true,
  }),
  T('W-REF-OVER-LIMIT：型号未声明 → 降级为告警（按最严 12 份兜底）', {
    md: REF_MD('', 10), model: 'auto',
    expectCodes: ['W-REF-OVER-LIMIT'], banCodes: ['E-REF-OVER-LIMIT'], expectError: false,
  }),
  T('E-MULTI-CAMERA 免疫：右手持剑引雷（v5.19.1）', {
    md: '镜 1｜引雷（10s）\n场景：殿前（景黄）｜人物：甲、乙\n生成视频：镜1｜引雷\n出场人物：甲——玄袍青年，镶剑；乙——黑衣护卫，刀\n整体风格：写实。\n【时间轴】0-10s：中景，固定机位。甲右手持剑引雷，剑尖天光聚顶｜镜头：中景 固定｜音效：雷鸣\n',
    expectCodes: [], banCodes: ['E-MULTI-CAMERA'], expectError: false,
  }),
  T('E-MULTI-CAMERA 免疫：轻轻摇头（v5.19.1）', {
    md: '镜 1｜摇头（10s）\n场景：客厅（暖白）｜人物：甲\n生成视频：镜1｜摇头\n出场人物：甲——深色便装青年\n整体风格：写实。\n【时间轴】0-10s：中景。甲轻轻摇头，转身走向窗边｜镜头：中景 固定｜音效：无\n',
    expectCodes: [], banCodes: ['E-MULTI-CAMERA'], expectError: false,
  }),
  T('W-DIALOGUE-DENSITY 免疫：三写不双算（v5.19.1）', {
    md: '镜 1｜三写不双算（10s）\n场景：舱内（景黄）｜人物：甲\n生成视频：镜1｜三写\n出场人物：甲——救生衣青年\n整体风格：写实。\n时间线分镜：\n【时间轴】0-10s：中景，固定机位。甲（平静）「今天天气不错适合出船大家早点休息明天还要起早干活这单送完就能回家吃饭了」｜镜头：中景 固定｜音效：无｜台词「今天天气不错适合出船大家早点休息明天还要起早干活这单送完就能回家吃饭了」\n声音设计：\n环境层：无\n动作层：无\n呼吸层：无\n逼近层：无\n对白：0:02 甲（平静）「今天天气不错适合出船大家早点休息明天还要起早干活这单送完就能回家吃饭了」\n',
    expectCodes: [], banCodes: ['W-DIALOGUE-DENSITY'], expectError: false,
  }),
  T('W-ACTION-DENSITY 免疫：末拍全景罗列无标签（v5.19.1）', {
    md: '镜 1｜末拍全景罗列（10s）\n场景：殿前（晨）｜人物：甲、乙、丙\n生成视频：镜1｜末拍\n出场人物：甲——玄袍青年，镶剑；乙——黑衣护卫，刀；丙——灰衣老者，短杖\n整体风格：写实。\n时间线分镜：\n【时间轴】0-6s：中景。甲挥剑；乙格挡；丙后退｜镜头：中景 固定｜音效：无\n【时间轴】6-10s：远景。甲保持战位不动；乙保持姿态静止；丙不再动作；画面完全定格｜镜头：远景 固定｜音效：无\n',
    expectCodes: [], banCodes: ['W-ACTION-DENSITY'], expectError: false,
  }),
  T('E-MULTI-CAMERA', {
    md: '镜 1｜混运镜（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n【时间轴】0-10s：全景。镜头缓推的同时水平右摇，甲坐下｜镜头：全景 缓推｜音效：无\n',
    expectCodes: ['E-MULTI-CAMERA'], expectError: true,
  }),
  T('E-OVER-30S', {
    md: '镜 1｜超长（35s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n【时间轴】0-17s：中景。甲坐下｜镜头：中景 固定｜音效：无\n【时间轴】17-35s：近景。甲抬头望向门口，起身走向窗边，手扶窗台向外看，长叹一口气｜镜头：近景 固定｜音效：无\n',
    expectCodes: ['E-OVER-30S'], expectError: true,
  }),
  T('E-PARAM-IN-BODY', {
    md: '镜 1｜参数污染（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：客厅里立着一台 4K 电视，屏幕熄着。\n【时间轴】0-10s：中景。甲坐到沙发上｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['E-PARAM-IN-BODY'], expectError: true,
  }),
  // v5.44.0：E- 降为 W-（官方支持负向控制，只是不保证生效）。改用 warn 断言，
  // 同时补一条「限定式豁免」正例：只画什么（仅/只）不算否定式，不该报。
  T('W-NEGATION-IN-BODY', {
    md: '镜 1｜否定式（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n站位：甲站在门边，面上零表情，双手垂在身侧\n【时间轴】0-10s：中景。甲从门边走向沙发｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-NEGATION-IN-BODY'], expectError: false,
  }),
  T('W-NEGATION-IN-BODY 限定式豁免正例', {
    md: '镜 1｜限定式（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n站位：甲站在门边，画面仅露出上半身，双手垂在身侧\n【时间轴】0-10s：中景。甲从门边走向沙发｜镜头：中景 固定｜音效：无\n',
    expectCodes: [], expectError: false, banCodes: ['W-NEGATION-IN-BODY', 'E-NEGATION-IN-BODY'],
  }),
  T('E-DIALOGUE-MISSING 双向', {
    md: '镜 1｜三写不一致（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n时间线分镜：\n【时间轴】0-5s：中景。甲（平静）：「你好呀。」｜镜头：中景 固定｜音效：无\n【时间轴】5-10s：近景。甲放下杯子｜镜头：近景 固定｜音效：无\n声音设计：\n环境层：钟摆声（极弱）\n动作层：杯底磕桌（1 处）\n呼吸层：无\n逼近层：无\n对白：0:02 甲（平静）：「你好吗。」\n',
    expectCodes: ['E-DIALOGUE-MISSING-IN-SOUND', 'E-DIALOGUE-MISSING-IN-TIMELINE'], expectError: true,
  }),
  T('E-SECTION-MISSING', {
    md: '镜 1｜缺节（10s）\n场景：门口（暮色）｜人物：甲\n甲开口：「你好。」\n',
    expectCodes: ['E-SECTION-MISSING'], expectError: true,
  }),
  T('E-IDENTITY-NOT-INLINE 缺「出场人物」行（v5.15.3 收紧后）', {
    md: '镜 1｜收摊（30s）\n场景：巷口（冷灰）｜人物：甲、乙\n生成视频：镜1｜收摊\n整体风格：半写实厚涂。\n站位：@甲（摊前 · 画面左 · 面朝右 · 提包）；@乙（摊后 · 画面右 · 面朝左 · 空手）\n位移：@甲 摊前→巷中；@乙 原地，无位移\n轴线：保持，摊—墙根连线\n时间线分镜：\n【时间轴】0-30s：中景，固定机位。甲收摊｜镜头：中景 固定｜音效：布面摩擦\n声音设计（四层混音）：\n环境层：风声（极弱）\n动作层：布面摩擦（0-3s）\n呼吸层：无\n逼近层：无\n对白：无\n刚性约束：\n必锁：摊面 = 粗布，边角磨白\n可见性：巷尾 = 压暗\nMust not：可读文字\n',
    expectCodes: ['E-IDENTITY-NOT-INLINE'], expectError: true,
  }),
  T('E-IDENTITY-NOT-INLINE 原有用例', {
    md: '镜 1｜身份缺锁（10s）\n场景：门口（暮色）｜人物：甲、乙\n整体风格：写实。甲穿深色大衣。\n本镜光色基调：暮色暖橙\n【时间轴】0-10s：中景。甲与乙在门口相对而立｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['E-IDENTITY-NOT-INLINE'], expectError: true,
  }),
  T('E-SLOP-OVERLOAD', {
    md: '镜 1｜slop 爆表（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：画面电影感十足，构图感扎实，细节丰富，人物栩栩如生，整体美轮美奂，光影极致高级。\n【时间轴】0-10s：中景。甲坐在沙发上｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['E-SLOP-OVERLOAD'], expectError: true,
  }),
  // ---- W 级（warn 不阻断，断言 expectError:false）----
  T('W-SLOP-COUNT', {
    md: '镜 1｜slop 少量（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：写实，画面有电影感，光影扎实。\n【时间轴】0-10s：中景。甲坐在沙发上｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-SLOP-COUNT'], expectError: false,
  }),
  T('W-OVER-20S（v5.19.0 起为三条件不齐：25s/2 段/无声明 → 与 W-BEAT-BUDGET 同报）', {
    md: '镜 1｜越线（25s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿灰色夹克。\n【时间轴】0-12s：中景。甲坐下，拿起茶杯喝了一口，抬头看向窗外｜镜头：中景 固定｜音效：无\n【时间轴】12-25s：中景。甲起身走到窗边，手扶窗台望着街道｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-OVER-20S', 'W-BEAT-BUDGET'], expectError: false,
  }),
  T('W-OVER-20S 放行（v5.19.0 三条件齐：声明 + 5 段 + 末拍定格 → 不报）', {
    md: '镜 1｜长段放行（25s）\n【长段声明】25s · 节拍 5 · 收束：末1s定格\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿灰色夹克。\n【时间轴】0-5s：中景。甲推门进客厅，把皮包放在椅背上｜镜头：中景 固定｜音效：无\n【时间轴】5-10s：中景。甲走到茶几前坐下，拿起茶杯吹了吹｜镜头：中景 固定｜音效：无\n【时间轴】10-15s：中景。甲靠在沙发背上，拻头望向窗外｜镜头：中景 固定｜音效：无\n【时间轴】15-21s：中景。甲放下茶杯，双手交叠在膝上｜镜头：中景 固定｜音效：无\n【时间轴】21-25s：中景。镜头运动收束，甲保持坐姿不动，末 1 秒动作完全静止、画面定格｜镜头：中景 固定｜音效：无\n',
    expectCodes: [], banCodes: ['W-OVER-20S', 'W-BEAT-BUDGET'], expectError: false,
  }),
  T('W-OVER-20S 缺收束（v5.19.0：有声明 + 密度够，末拍无定格措辞 → 报）', {
    md: '镜 1｜长段缺收束（25s）\n【长段声明】25s · 节拍 5 · 收束：末1s定格\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿灰色夹克。\n【时间轴】0-5s：中景。甲推门进客厅，把皮包放在椅背上｜镜头：中景 固定｜音效：无\n【时间轴】5-10s：中景。甲走到茶几前坐下，拿起茶杯吹了吹｜镜头：中景 固定｜音效：无\n【时间轴】10-15s：中景。甲靠在沙发背上，拻头望向窗外｜镜头：中景 固定｜音效：无\n【时间轴】15-21s：中景。甲放下茶杯，双手交叠在膝上｜镜头：中景 固定｜音效：无\n【时间轴】21-25s：中景。甲起身走向卧室，推开门，侧身消失在门后｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-OVER-20S'], banCodes: ['W-BEAT-BUDGET'], expectError: false,
  }),
  T('W-OVER-20S', {
    md: '镜 1｜越线（25s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿灰色夹克。\n本镜光色基调：暖白；色彩预算：单一色系\n本镜保真预算：主 = 甲的姿态；次 = 茶杯；省 = 背景\n【时间轴】0-12s：中景。甲坐下，拿起茶杯喝了一口，放下杯子，抬头看向窗外｜镜头：中景 固定｜音效：无\n【时间轴】12-25s：近景。甲起身走到窗边，手扶窗台，望着楼下的街道，一辆车驶过｜镜头：近景 固定｜音效：无\n',
    expectCodes: ['W-OVER-20S'], expectError: false,
  }),
  T('W-BEAT-BUDGET', {
    md: '镜 1｜缺结构（15s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n【时间轴】0-15s：中景，固定机位。甲坐下，端起茶杯，喝了一口，把杯子放回桌面，抬头看向对面的挂钟，眉头皱起，起身走向挂钟，伸手扶住钟框，低头看指针｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-BEAT-BUDGET'], expectError: false,
  }),
  T('W-CONSTRAINT + W-COLOR + W-ALLOC', {
    md: '镜 1｜三缺（10s）\n场景：门口（暮色）｜人物：甲\n整体风格：甲穿深色大衣。\n刚性约束：甲全程站在门口\n【时间轴】0-10s：中景。甲站在门口，手插在口袋里｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-CONSTRAINT-SHAPE', 'W-COLOR-BUDGET', 'W-ALLOCATION-MISSING'], expectError: false,
  }),
  T('W-LENGTH-CAP', {
    md: '镜 1｜超字（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿白色家居服。\n时间线分镜：\n【时间轴】0-10s：中景，固定机位。' + '甲坐在沙发上，双手放在膝盖，视线落在门框，肩线放松，呼吸平稳。'.repeat(40) + '｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-LENGTH-CAP'], expectError: false,
  }),
  // ── 时长因子（v5.43.1 加、v5.44.0 补测）：capOf() 的 cap = base × max(1, 时长/15)。
  // 上面那条老夹具是（10s），走 max(1,10/15)=1 的原值分支，压根没进新分支——
  // 这也是这批夹具存在的理由：改了判据没有覆盖，全绿等于没测。
  // 额度对照：T2V base 1000、I2V base 800；30s → ×2 = 2000 / 1600；15s 及以下取原值。
  T('时长因子 15s T2V 超原值应报（额度 1000）', {
    md: '镜 1｜时长测试（15s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿白色家居服。\n时间线分镜：\n【时间轴】0-15s：中景，固定机位。' + '甲坐在沙发上，双手放在膝盖，视线落在门框，肩线放松，呼吸平稳。'.repeat(40) + '｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-LENGTH-CAP'], expectError: false,
  }),
  T('时长因子 30s T2V 放大后不超（额度 2000）', {
    md: '镜 1｜时长测试（30s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿白色家居服。\n时间线分镜：\n【时间轴】0-30s：中景，固定机位。' + '甲坐在沙发上，双手放在膝盖，视线落在门框，肩线放松，呼吸平稳。'.repeat(40) + '｜镜头：中景 固定｜音效：无\n',
    banCodes: ['W-LENGTH-CAP'], expectError: false,
  }),
  T('时长因子 30s T2V 仍超放大额度应报（额度 2000）', {
    md: '镜 1｜时长测试（30s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿白色家居服。\n时间线分镜：\n【时间轴】0-30s：中景，固定机位。' + '甲坐在沙发上，双手放在膝盖，视线落在门框，肩线放松，呼吸平稳。'.repeat(70) + '｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-LENGTH-CAP'], expectError: false,
  }),
  T('时长因子 15s I2V 超原值应报（额度 800）', {
    md: '镜 1｜时长测试（15s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿白色家居服。\n参考图：@图片 1 角色甲\n时间线分镜：\n【时间轴】0-15s：中景，固定机位。' + '甲坐在沙发上，双手放在膝盖，视线落在门框，肩线放松，呼吸平稳。'.repeat(40) + '｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-LENGTH-CAP'], expectError: false,
  }),
  T('时长因子 30s I2V 放大后不超（额度 1600）', {
    md: '镜 1｜时长测试（30s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿白色家居服。\n参考图：@图片 1 角色甲\n时间线分镜：\n【时间轴】0-30s：中景，固定机位。' + '甲坐在沙发上，双手放在膝盖，视线落在门框，肩线放松，呼吸平稳。'.repeat(40) + '｜镜头：中景 固定｜音效：无\n',
    banCodes: ['W-LENGTH-CAP'], expectError: false,
  }),
  T('时长因子 30s I2V 仍超放大额度应报（额度 1600）', {
    md: '镜 1｜时长测试（30s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿白色家居服。\n参考图：@图片 1 角色甲\n时间线分镜：\n【时间轴】0-30s：中景，固定机位。' + '甲坐在沙发上，双手放在膝盖，视线落在门框，肩线放松，呼吸平稳。'.repeat(60) + '｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-LENGTH-CAP'], expectError: false,
  }),
  T('时长因子 10s 不放松（低于 15s 仍取原值，额度 1000）', {
    md: '镜 1｜时长测试（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿白色家居服。\n时间线分镜：\n【时间轴】0-10s：中景，固定机位。' + '甲坐在沙发上，双手放在膝盖，视线落在门框，肩线放松，呼吸平稳。'.repeat(40) + '｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-LENGTH-CAP'], expectError: false,
  }),
  T('W-OFFICIAL-500', {
    md: '镜 1｜官方超字（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿白色家居服。\n时间线分镜：\n【时间轴】0-10s：中景，固定机位。' + '甲坐在沙发上，双手放在膝盖，视线落在门框，肩线放松，呼吸平稳。'.repeat(40) + '｜镜头：中景 固定｜音效：无\n',
    opts: { official: true },
    expectCodes: ['W-OFFICIAL-500'], expectError: false,
  }),
  T('W-CONTEXT-LEAK', {
    md: '镜 1｜跨镜指代（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n【时间轴】0-10s：中景。甲仍穿着大衣走进屋，走向沙发坐下｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-CONTEXT-LEAK'], expectError: false,
  }),
  T('W-FIRSTFRAME-SHAPE', {
    md: '镜 1｜首帧未锚（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：@图片1作为首帧。甲在客厅中央，落地灯亮着。\n【时间轴】0-10s：中景。甲从沙发起身｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-FIRSTFRAME-SHAPE'], expectError: false,
  }),
  T('W-I2V-GARMENT', {
    md: '镜 1｜服装名词散写（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：@图片1作为首帧。构图：甲居中，镜头正对。\n外观：甲的衬衫起皱，袖口磨毛。\n【时间轴】0-10s：中景。甲抬手抚平袖口｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-I2V-GARMENT'], expectError: false,
  }),
  T('W-BEAT-LENGTH', {
    md: '镜 1｜首拍过短（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n【时间轴】0-2s：中景。甲放下杯子｜镜头：中景 固定｜音效：无\n【时间轴】2-10s：近景。甲抬头看向挂钟，起身走近，手扶钟框｜镜头：近景 固定｜音效：无\n',
    expectCodes: ['W-BEAT-LENGTH'], expectError: false,
  }),
  T('W-DIALOGUE-DENSITY', {
    md: '镜 1｜台词挤爆（10s）\n场景：舱内（昏黄）｜人物：甲、乙\n整体风格：甲穿救生衣，乙穿救生衣。\n' + TL('【时间轴】0-2s：特写。甲（急促）：「快跑别回头桥要塌了我们只有一次机会千万抓紧我的手不要松开啊」｜镜头：特写 固定｜音效：轰鸣\n【时间轴】2-10s：近景。甲拉着乙奔向舱门，回身看了一眼倾斜的甲板，猛拖乙出去，自己抓住扶栏｜镜头：近景 手持｜音效：轰鸣') + '\n' + SD('快跑别回头桥要塌了我们只有一次机会千万抓紧我的手不要松开啊') + '\n',
    expectCodes: ['W-DIALOGUE-DENSITY'], expectError: false,
  }),
  T('W-ACTION-DENSITY', {
    md: '镜 1｜动作挤爆（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n' + TL('【时间轴】0-2s：中景。甲放下杯子；转身；拿起外套；走向门口｜镜头：中景 固定｜音效：无\n【时间轴】2-10s：近景。甲开门离开，门在身后合上，走廊灯亮起｜镜头：近景 固定｜音效：无') + '\n',
    expectCodes: ['W-ACTION-DENSITY'], expectError: false,
  }),
  T('W-SPATIAL-WEAK + W-SHOTSIZE + W-POSITION', {
    md: '镜 1｜弱词（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n【时间轴】0-10s：甲站在附近，手里端着茶杯，看向窗外｜镜头：固定｜音效：无\n',
    expectCodes: ['W-SPATIAL-WEAK', 'W-SHOTSIZE-MISSING', 'W-POSITION-MISSING'], expectError: false,
  }),
  T('W-GAZE-MISSING + W-AXIS-MISSING', {
    md: '镜 1｜缺表演指令（10s）\n场景：客厅（暖白）｜人物：甲、乙\n整体风格：甲穿深色便装，乙穿蓝色制服。\n【时间轴】0-10s：中景。甲与乙隔着茶几对坐，各自端着茶杯｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-GAZE-MISSING', 'W-AXIS-MISSING'], expectError: false,
  }),
  // ---- v4.7.5 空间参照系两码（口径见 references/场景方位卡与固定锚物.md）----
  T('W-STAGING-RELATIVE 站位锚在活人身上', {
    md: '镜 1｜相对锚（10s）\n场景：废弃工地顶层（冷灰水泥）｜人物：甲、乙\n整体风格：甲穿深色便装，乙穿藏青外套。\n站位：@甲（画面左 · 承重柱侧后 · 侧身朝右）；@乙（画面中右 · 距甲三步 · 双手举盘）\n轴线：建立，承重柱—隔断墙连线，甲在画面左（西侧），乙在画面右（东侧）\n【时间轴】0-10s：中景。甲侧身看向乙，乙举起手中的盘｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-STAGING-RELATIVE'], expectError: false,
  }),
  T('W-AXIS-NO-GEO 轴线无地理参照', {
    md: '镜 1｜纯状态词（10s）\n场景：废弃工地顶层（冷灰水泥）｜人物：甲、乙\n整体风格：甲穿深色便装，乙穿藏青外套。\n站位：@甲（画面左 · 承重柱侧后 · 侧身朝右）；@乙（画面右 · 石膏隔断墙前 · 正面朝左）\n轴线：保持，甲画面左，乙画面右\n【时间轴】0-10s：中景。甲侧身看向乙，乙立在隔断墙前｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-AXIS-NO-GEO'], expectError: false,
  }),
  T('E-IDENTITY-NOT-INLINE 保真预算吞名（v5.30.0 第二阶段判据层实测）', {
    md: '镜 1｜保真预算吞名（10s）\n场景：废弃工地顶层（冷灰水泥）｜人物：甲\n轴线：承重柱—石膏隔断墙连线，甲在画面左（西侧）\n站位：@甲（承重柱侧后 · 画面左 · 侧身朝右）\n位移：全员原位，无位移\n整体风格：一幅写实实拍电影画面，低饱和。\n本镜保真预算：主 = 承重柱旁的墙面斑驳；次 = 甲面部纹理；省 = 杂物\n本镜光色基调：冷灰；色彩预算：单一色系\n【时间轴】0-10s：中景。甲侧身看向隔断墙｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['E-IDENTITY-NOT-INLINE'], expectError: true,
  }),
  T('W-AXIS-STATE-IN-BODY 状态词进逐镜正文（v5.27.0）', {
    md: '镜 1｜状态词入正文（10s）\n场景：废弃工地顶层（冷灰水泥）｜人物：甲、乙\n整体风格：甲穿深色便装，乙穿藏青外套。\n站位：@甲（承重柱侧后 · 画面左 · 侧身朝右）；@乙（石膏隔断墙前 · 画面中右 · 双手举盘）\n轴线：建立，承重柱—石膏隔断墙连线，甲在画面左（西侧），乙在画面右（东侧）\n【时间轴】0-10s：中景。甲侧身看向乙｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-AXIS-STATE-IN-BODY'], expectError: false,
  }),
  T('合法站位（锚物 + 地理轴线，两码全避）', {
    md: '镜 1｜挂死物（10s）\n场景：废弃工地顶层（冷灰水泥）｜人物：甲、乙\n整体风格：甲穿深色便装，乙穿藏青外套。\n站位：@甲（承重柱侧后 · 画面左 · 侧身朝右）；@乙（石膏隔断墙前 · 画面中右 · 距甲三步 · 双手举盘）\n位移：@甲 承重柱后→隔断墙西端两步（潜行，终态面向乙）；@乙 原位\n轴线：承重柱—石膏隔断墙连线，甲在画面左（西侧），乙在画面右（东侧）\n【时间轴】0-10s：中景。甲侧身看向乙，乙举起手中的盘｜镜头：中景 固定｜音效：无\n',
    banCodes: ['W-STAGING-RELATIVE', 'W-AXIS-NO-GEO'], expectError: false,
  }),
  // ---- v4.7.6 持物分左右手（口径见 references/场景方位卡与固定锚物.md §持物）----
  T('W-PROP-HAND 持物未分左右手', {
    md: '镜 1｜剑在手（10s）\n场景：废弃工地顶层（冷灰水泥）｜人物：甲\n整体风格：甲穿深色便装。\n站位：@甲（承重柱侧后 · 画面左 · 侧身朝右 · 桃木剑在手）\n【时间轴】0-10s：中景。甲侧身潜行两步｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-PROP-HAND'], expectError: false,
  }),
  T('W-PROP-HAND 免疫：被动接触不算持物', {
    md: '镜 1｜被攥脚踝（8s · 打斗镜）\n【打戏声明】：R1\n场景：废弃工地顶层（冷灰水泥）｜人物：甲、乙\n整体风格：甲穿深色便装，乙穿藏青外套。\n站位：@甲（画面右 · 柱影里 · 右臂前伸抓踝）；@乙（画面中 · 被攥脚踝侧倾 · 双脚离地）\n轴线：建立，承重柱—隔断墙连线，甲在画面右（东侧），乙在画面中\n【时间轴】0-8s：中景。甲攥住乙的脚踝把人抡起，乙受控抛物线撞穿石膏隔断墙｜镜头：中景 固定｜音效：闷响\n',
    banCodes: ['W-PROP-HAND'], expectError: false,
  }),
  T('W-PROP-HAND 免疫：左右手已写死', {
    md: '镜 1｜两只手都写死（10s）\n场景：废弃工地顶层（冷灰水泥）｜人物：甲\n整体风格：甲穿深色便装。\n站位：@甲（承重柱侧后 · 画面左 · 侧身朝右 · 右手桃木剑 · 左手手电）\n【时间轴】0-10s：中景。甲侧身潜行两步｜镜头：中景 固定｜音效：无\n',
    banCodes: ['W-PROP-HAND'], expectError: false,
  }),
  T('W-STAGING-ALONG-TOO-CLOSE 同侧两人 along 差 < 0.12', {
    md: '镜 1｜贴太近（10s）\n场景：废弃工地顶层（冷灰水泥）｜人物：甲、乙\n整体风格：甲穿深色便装，乙穿藏青外套。\n站位：@甲（承重柱沿 · 画面左三分之一 · along 0.25 · 侧身朝右 · 徒手）；@乙（承重柱沿 · 画面左三分之一 · along 0.31 · 正面朝右 · 徒手）\n轴线：承重柱—隔断墙连线，甲在画面左三分之一（西侧），乙在画面左三分之一（西侧）\n【时间轴】0-10s：中景。甲侧身潜行两步｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-STAGING-ALONG-TOO-CLOSE'], expectError: false,
  }),
  T('W-STAGING-ALONG-TOO-CLOSE 免疫：同侧拉开 0.4', {
    md: '镜 1｜拉开了（10s）\n场景：废弃工地顶层（冷灰水泥）｜人物：甲、乙\n整体风格：甲穿深色便装，乙穿藏青外套。\n站位：@甲（承重柱沿 · 画面左三分之一 · along 0.25 · 侧身朝右 · 徒手）；@乙（承重柱沿 · 画面左三分之一 · along 0.65 · 正面朝右 · 徒手）\n轴线：承重柱—隔断墙连线，甲在画面左三分之一（西侧），乙在画面左三分之一（西侧）\n【时间轴】0-10s：中景。甲侧身潜行两步｜镜头：中景 固定｜音效：无\n',
    banCodes: ['W-STAGING-ALONG-TOO-CLOSE'], expectError: false,
  }),
  T('W-STAGING-ALONG-TOO-CLOSE 免疫：不同侧不参与分组', {
    md: '镜 1｜两侧各一人（10s）\n场景：废弃工地顶层（冷灰水泥）｜人物：甲、乙\n整体风格：甲穿深色便装，乙穿藏青外套。\n站位：@甲（承重柱沿 · 画面左三分之一 · along 0.25 · 侧身朝右 · 徒手）；@乙（门框内侧 · 画面右三分之一 · along 0.28 · 正面朝左 · 徒手）\n轴线：承重柱—门框连线，甲在画面左三分之一（西侧），乙在画面右三分之一（东侧）\n【时间轴】0-10s：中景。甲侧身潜行两步｜镜头：中景 固定｜音效：无\n',
    banCodes: ['W-STAGING-ALONG-TOO-CLOSE'], expectError: false,
  }),
  T('W-SURFACE-MISMATCH', {
    md: '镜 1｜错面（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\nShot 1 (0-5s): 中景，固定机位。甲坐下。\nShot 2 (5-10s): 近景，固定机位。甲抬头。\n',
    opts: { surface: 'cn' },
    expectCodes: ['W-SURFACE-MISMATCH'], expectError: false,
  }),
  // ---- H3 自识别 ----
  T('isH3Package 自识别', { kind: 'h3' }),
  // ---- 控制组：干净包 ----
  T('干净包全过', { md: CLEAN, expectError: false, banCodes: ['[ERROR]', 'W-DIRECTOR'] }),
  // ---- 打斗专项（v4.4；口径见 references/专项_打斗编排.md）----
  T('W-COMBAT-CONTACT-MISSING + RAGDOLL', {
    md: [
      '镜 1｜缠斗（10s）',
      '【打戏声明】：R1',
      '场景：演武场（黄土）｜人物：甲、乙',
      '整体风格：甲穿黑色练功服，乙穿灰色练功服，boxing 对峙。',
      '时间线分镜：',
      TL('【时间轴】0-5s：中景，固定机位。甲逼近，乙后退，两人互相挥拳｜镜头：中景 固定｜音效：无\n【时间轴】5-10s：近景，固定机位。乙还击，甲侧身躲开，两人继续缠抱｜镜头：近景 固定｜音效：无'),
      '',
    ].join('\n'),
    expectCodes: ['W-COMBAT-CONTACT-MISSING', 'W-COMBAT-RAGDOLL-GUARD'], expectError: false,
  }),
  T('W-COMBAT-CUTS-TOO-MANY', {
    md: [
      '镜 1｜交手（10s）',
      '【打戏声明】：R1',
      '场景：演武场（黄土）｜人物：甲、乙',
      '整体风格：甲穿黑色练功服，乙穿灰色练功服。',
      TL('【时间轴】0-2s：中景。甲出拳击中乙格挡的小臂｜镜头：中景 固定｜音效：无\n【时间轴】2-4s：近景。乙下潜，架住甲追击的勾拳｜镜头：近景 固定｜音效：无\n【时间轴】4-6s：近景。甲抽身，乙踢中甲小腿｜镜头：近景 固定｜音效：无\n【时间轴】6-8s：中景。乙逼近，甲磕开斩来的一拳｜镜头：中景 固定｜音效：无\n【时间轴】8-10s：全景。双方重整对峙｜镜头：全景 固定｜音效：无'),
      '',
    ].join('\n'),
    expectCodes: ['W-COMBAT-CUTS-TOO-MANY'], expectError: false,
  }),
  T('合法打斗镜（三码全避）', {
    md: [
      '镜 1｜交手（10s）',
      '【打戏声明】：R2',
      '场景：演武场（黄土）｜人物：甲、乙',
      '整体风格：甲穿黑色练功服，乙穿灰色练功服。',
      '站位：@甲（画面左三分之一 · 弓步 · 正面朝右 · 双拳护颌）；@乙（画面右三分之一 · 滑步后撤 · 侧身朝左 · 单臂格挡）',
      '轴线：建立，甲在左三分之一，乙在右三分之一',
      '本镜光色基调：黄土正午；色彩预算：唯一重音色 = 甲腰间红腰带',
      '本镜保真预算：主 = 接触点的肢体交错；次 = 衣料摆动；省 = 观众席',
      TL('【时间轴】0-3s：中景，固定机位。甲沉肩压低重心蓄力，随即蹬地暴起直拳逼近，拳锋擦过乙耳侧｜镜头：中景 固定｜音效：破空声\n【时间轴】3-7s：近景，固定机位。乙格挡甲追击的勾拳，架住小臂向一侧磕开，反击踢中甲小腿，命中瞬间画面顿住两帧｜镜头：近景 固定｜音效：皮肉相击两声\n【时间轴】7-10s：全景，固定机位。甲滑退卸力后撤半步重整，乙保持攻势逼近｜镜头：全景 固定｜音效：脚步声'),
      '声音设计：',
      '环境层：风声（极弱）',
      '动作层：破空声（0-1s）、皮肉相击（4-5s）',
      '呼吸层：双方喘息渐重（6-10s）',
      '逼近层：无',
      '对白：无',
      '刚性约束：',
      '必锁：甲红腰带 = 唯一重音色；双方各一个身体，无分身重影',
      '可见性：观众席 = 仅虚化轮廓',
      'Must not：可读文字、水印；禁 ragdoll、limp、floppy——核心始终发力，每个动作都有肌肉意图',
      '',
    ].join('\n'),
    expectCodes: [], banCodes: ['W-COMBAT'], expectError: false,
  }),
  // ---- 打戏九码（v5.8.0；口径见 references/专项_打斗编排.md 第十一节，豁免表第九节）----
  T('E-COMBAT-TIER-UNDECLARED 未定档（ERROR，且不发洪水）', {
    md: [
      '镜 1｜缠斗（10s）',
      '场景：演武场（黄土）｜人物：甲、乙',
      '整体风格：甲穿黑色练功服，乙穿灰色练功服，boxing 对峙。',
      '站位：@甲（画面左 · 弓步）；@乙（画面右 · 滑步后撤）',
      '轴线：建立，甲在画面左，乙在画面右',
      TL('【时间轴】0-10s：中景，固定机位。甲沉肩蓄力，蹬地暴起直拳击中乙格挡的小臂，命中顿住两帧，随后滑退卸力｜镜头：中景 固定｜音效：皮肉相击'),
      'Must not：可读文字；禁 ragdoll、limp、floppy',
      '',
    ].join('\n'),
    expectCodes: ['E-COMBAT-TIER-UNDECLARED'], expectError: true,
    // 没定档就不知道该按哪档判——其余八码一律不发，不能洪水告警
    banCodes: ['W-COMBAT-IAU-OVER', 'W-COMBAT-BEAT-MISSING', 'W-COMBAT-HITSTOP-EXCESS',
      'W-COMBAT-NO-FORCE-CHAIN', 'W-COMBAT-BEAM-FILL'],
  }),
  T('W-COMBAT-IAU-OVER 3s 塞 5 类动作', {
    md: [
      '镜 1｜交手（3s）',
      '【打戏声明】：R2',
      '场景：演武场（黄土）｜人物：甲、乙',
      '整体风格：甲穿黑色练功服，乙穿灰色练功服。',
      TL('【时间轴】0-3s：中景。甲沉肩蓄力，蹬地暴起劈中乙肩，乙格挡架开，甲扫腿扫中乙小腿并抓住乙腕摔倒，命中顿住两帧，随后卸力滑退｜镜头：中景 固定｜音效：无'),
      'Must not：禁 ragdoll',
      '',
    ].join('\n'),
    expectCodes: ['W-COMBAT-IAU-OVER'], expectError: false,
  }),
  T('豁免表：群战不按单镜 IAU 上限判', {
    md: [
      '镜 1｜交手（3s）',
      '【打戏声明】：R2 · 群战乱斗',
      '场景：演武场（黄土）｜人物：甲、乙',
      '整体风格：甲穿黑色练功服，乙穿灰色练功服。',
      TL('【时间轴】0-3s：中景。甲沉肩蓄力，蹬地暴起劈中乙肩，乙格挡架开，甲扫腿扫中乙小腿并抓住乙腕摔倒，命中顿住两帧，随后卸力滑退｜镜头：中景 固定｜音效：无'),
      'Must not：禁 ragdoll',
      '',
    ].join('\n'),
    banCodes: ['W-COMBAT-IAU-OVER'], expectError: false,
  }),
  T('W-COMBAT-BEAT-MISSING 匀速无四拍', {
    md: [
      '镜 1｜缠斗（10s）',
      '【打戏声明】：R2',
      '场景：演武场（黄土）｜人物：甲、乙',
      '整体风格：甲穿黑色练功服，乙穿灰色练功服。',
      TL('【时间轴】0-10s：中景。甲直拳击中乙格挡的小臂，乙反击踢中甲小腿｜镜头：中景 固定｜音效：无'),
      'Must not：禁 ragdoll',
      '',
    ].join('\n'),
    expectCodes: ['W-COMBAT-BEAT-MISSING'], expectError: false,
  }),
  T('W-COMBAT-HITSTOP-EXCESS 15s 减速器超额', {
    md: [
      '镜 1｜交手（15s）',
      '【打戏声明】：R2',
      '场景：演武场（黄土）｜人物：甲、乙',
      '整体风格：甲穿黑色练功服，乙穿灰色练功服。',
      TL('【时间轴】0-5s：中景。甲沉肩蓄力，蹬地暴起直拳击中乙格挡的小臂，命中顿住两帧，卸力滑退｜镜头：中景 固定｜音效：无\n【时间轴】5-10s：近景。画面闪白一次，乙反击踢中甲小腿，画面又闪白一次｜镜头：近景 固定｜音效：无\n【时间轴】10-15s：全景。画面定格，慢镜升格，甲后撤重整｜镜头：全景 固定｜音效：无'),
      'Must not：禁 ragdoll',
      '',
    ].join('\n'),
    expectCodes: ['W-COMBAT-HITSTOP-EXCESS'], expectError: false,
  }),
  T('W-COMBAT-NO-FORCE-CHAIN 重击无发力链', {
    md: [
      '镜 1｜交手（10s）',
      '【打戏声明】：R2',
      '场景：演武场（黄土）｜人物：甲、乙',
      '整体风格：甲穿黑色练功服，乙穿灰色练功服。',
      TL('【时间轴】0-10s：中景。甲蓄力后暴起劈中乙肩，命中顿住两帧，卸力滑退｜镜头：中景 固定｜音效：无'),
      'Must not：禁 ragdoll',
      '',
    ].join('\n'),
    expectCodes: ['W-COMBAT-NO-FORCE-CHAIN'], expectError: false,
  }),
  T('W-COMBAT-BEAM-FILL 隔空对波充数', {
    md: [
      '镜 1｜对决（10s）',
      '【打戏声明】：R3 · 一对一',
      '场景：山谷（暮色）｜人物：甲、乙',
      '整体风格：甲穿玄色长袍，乙穿白色道袍。',
      TL('【时间轴】0-10s：全景。甲蓄力后暴起，双方各放能量光束在空中相撞，气功波相持不下，画面顿住两帧，随后卸力｜镜头：全景 固定｜音效：无'),
      'Must not：禁 ragdoll',
      '',
    ].join('\n'),
    expectCodes: ['W-COMBAT-BEAM-FILL'], expectError: false,
  }),
  T('豁免表：术法对轰不判对波充数', {
    md: [
      '镜 1｜对决（10s）',
      '【打戏声明】：R3 · 术法对轰',
      '场景：山谷（暮色）｜人物：甲、乙',
      '整体风格：甲穿玄色长袍，乙穿白色道袍。',
      TL('【时间轴】0-10s：全景。甲蓄力后暴起，双方各放能量光束在空中相撞，气功波相持不下，画面顿住两帧，随后卸力｜镜头：全景 固定｜音效：无'),
      'Must not：禁 ragdoll',
      '',
    ].join('\n'),
    banCodes: ['W-COMBAT-BEAM-FILL'], expectError: false,
  }),
  T('R0 声明后九码全免（文戏不该被逼成打戏）', {
    md: [
      '镜 1｜争执（8s · 打斗镜）',
      '【打戏声明】：R0',
      '场景：客厅（暖白）｜人物：甲、乙',
      '整体风格：甲穿深色便装，乙穿灰色外套。',
      TL('【时间轴】0-8s：中景。甲乙互相推搡，甲抓住乙的手腕又松开｜镜头：中景 固定｜音效：无'),
      '',
    ].join('\n'),
    banCodes: ['W-COMBAT'], expectError: false,
  }),
  T('近身擒拿也认接触点（v4.7.3 扩充词表）', {
    md: [
      '镜 1｜擒拿（10s）',
      '【打戏声明】：R1',
      '场景：楼道（夜）｜人物：甲、乙',
      '整体风格：甲穿深色夹克，乙穿灰色卫衣。',
      '站位：@甲（画面左 · 背靠门框 · 正面朝右 · 右臂前伸）；@乙（画面右 · 扑向甲 · 侧身朝左 · 双臂前抓）',
      '轴线：建立，甲在画面左，乙在画面右',
      '本镜光色基调：楼道顶灯惨白；色彩预算：唯一重音色 = 甲腕上银表',
      '本镜保真预算：主 = 擒拿时的手臂交错；次 = 门框木纹；省 = 楼道尽头',
      TL('【时间轴】0-4s：中景，固定机位。乙扑向甲，甲侧身让过来抓，反手攥住乙腕拧到他身后｜镜头：中景 固定｜音效：衣料摩擦\n【时间轴】4-10s：近景，固定机位。甲把乙按在门板上，乙后脑撞上门板，挣扎渐弱｜镜头：近景 固定｜音效：撞门闷响'),
      '声音设计：',
      '环境层：楼道风声（极弱）',
      '动作层：衣料摩擦（0-2s）、撞门闷响（5-6s）',
      '呼吸层：乙喘息粗重（7-10s）',
      '逼近层：无',
      '对白：无',
      '刚性约束：',
      '必锁：银表 = 唯一重音色；两人各一个身体',
      '可见性：楼道尽头 = 全黑不可见',
      'Must not：可读文字；禁 ragdoll、limp——被制服是受控的，不是软体下垂',
      '',
    ].join('\n'),
    expectCodes: [], banCodes: ['W-COMBAT-CONTACT-MISSING'], expectError: false,
  }),
  // ---- 调度几何三码（v5.13.0；口径见 references/空间层_调度与轴线.md 第十四节）----
  // 三条限定：全是 WARN（几何是护栏不是铁律）/ 只查写没写（角度与退距量不出来）/
  // 未触发 = 本镜不适用，不是通过。
  T('W-STAGING-OTS-DISTANCE 过肩无退距', {
    md: '镜 1｜质问（8s）\n场景：审讯室（冷白）｜人物：甲、乙\n整体风格：甲穿深色西装，乙穿制服。\n站位：@甲（桌前 · 画面左 · 正面朝右）；@乙（桌后 · 画面右 · 正面朝左）\n轴线：建立\n【时间轴】0-8s：过肩反打，乙看向甲｜镜头：近景 固定｜音效：无\n',
    expectCodes: ['W-STAGING-OTS-DISTANCE'], expectError: false,
  }),
  T('W-STAGING-CROSS-NO-TRANSITION 越轴无过渡', {
    md: '镜 1｜换位（8s）\n场景：审讯室（冷白）｜人物：甲、乙\n整体风格：甲穿深色西装，乙穿制服。\n站位：@甲（桌前 · 画面左）；@乙（桌后 · 画面右）\n轴线：跨越\n【时间轴】0-8s：中景。两人越轴换位，镜头稍退后｜镜头：中景 固定｜音效：无\n',
    expectCodes: ['W-STAGING-CROSS-NO-TRANSITION'], expectError: false,
  }),
  T('W-STAGING-NO-EVIDENCE S3 无决策证据', {
    md: '镜 1｜围堵（8s）\n场景：巷口（冷灰）｜人物：甲、乙、丙\n整体风格：甲穿深色西装，乙与丙穿便装。\n空间分级：S3\n站位：@甲（巷中 · 画面左）；@乙（巷口 · 画面右）；@丙（墙根 · 画面中）\n轴线：建立\n【时间轴】0-8s：全景。三人向甲逼近｜镜头：全景 缓推｜音效：无\n',
    expectCodes: ['W-STAGING-NO-EVIDENCE'], expectError: false,
  }),
  T('几何合规包不误报（写了距离 / 写了过渡 / S3 有决策证据）', {
    md: [
      '镜 1｜围堵（8s）',
      '场景：巷口（冷灰）｜人物：甲、乙',
      '整体风格：甲穿深色西装，乙穿便装。',
      '空间分级：S3',
      '决策证据：乙背光而立使其面部不可读，压迫感来自轮廓而非表情',
      '被否决方案：对坐平视——两人等高，读不出审讯关系',
      '站位：@甲（桌前 · 画面左 · 正面朝右）；@乙（桌后 · 画面右 · 正面朝左）',
      '轴线：跨越，采用中立镜头过渡',
      '【时间轴】0-8s：过肩反打，机位自对话轴线后退 1.8 米，乙看向甲｜镜头：近景 固定｜音效：无',
      '',
    ].join('\n'),
    expectCodes: [], banCodes: ['W-STAGING-OTS-DISTANCE', 'W-STAGING-CROSS-NO-TRANSITION', 'W-STAGING-NO-EVIDENCE'], expectError: false,
  }),
  // ---- 表演位 FACS 两码（v5.12.0；口径见 references/表演层_FACS微表情.md 第十二节）----
  // 三条设计限定：只查「写没写」不查「写对不对」；不查 AU 编号（AU 属内部 cue 表，
  // 进正文违反分层铁律）；两条都是 WARN。豁免走段头「【表演声明】：本段无表情表演（理由）」。
  T('W-FACS-VAGUE-EMOTION 空泛情绪结果词', {
    md: '镜 1｜质问（8s）\n场景：审讯室（冷白）｜人物：甲\n整体风格：甲穿深色西装。\n站位：@甲（画面中 · 正面）\n【时间轴】0-8s：特写。甲愤怒地盯着镜头，眼神凶狠｜镜头：特写 固定｜音效：无\n',
    expectCodes: ['W-FACS-VAGUE-EMOTION'], expectError: false,
  }),
  T('W-FACS-NO-MUSCLE-ACTION 特写无肌肉动作', {
    md: '镜 1｜静默（8s）\n场景：审讯室（冷白）｜人物：甲\n整体风格：甲穿深色西装。\n站位：@甲（画面中 · 正面）\n【时间轴】0-8s：特写。甲坐在椅子上，一动不动｜镜头：特写 固定｜音效：无\n',
    expectCodes: ['W-FACS-NO-MUSCLE-ACTION'], expectError: false,
  }),
  T('FACS 声明式豁免（旁白 / 面具型角色不误报）', {
    md: '镜 1｜静默（8s）\n场景：审讯室（冷白）｜人物：甲\n整体风格：甲穿深色西装。\n【表演声明】：本段无表情表演（面具型角色）\n站位：@甲（画面中 · 正面）\n【时间轴】0-8s：特写。甲坐在椅子上，一动不动｜镜头：特写 固定｜音效：无\n',
    expectCodes: [], banCodes: ['W-FACS-NO-MUSCLE-ACTION', 'W-FACS-VAGUE-EMOTION'], expectError: false,
  }),
  // ---- 局部入画归属（v5.40.0；口径见 references/专项_局部入画归属.md 第五节）----
  // 三条设计限定：只查「带没带归属」不查写得对不对；两条都是 WARN；
  // 判据是「量词是否停在小句开头」——**「陈砚那只垂着的袖口」不能判成无归属**
  // （v5.40.0 第一轮判据写坏过：只认「的」，把写了人名的正例判成违规）。
  T('W-BODY-PART-NO-OWNER 局部入画无归属', {
    md: '镜 1｜碾下（8s）\n场景：巷口（冷灰）｜人物：甲\n整体风格：甲穿深色短褐。\n站位：@甲（画面中 · 正面）\n【时间轴】0-8s：中景，固定机位。一只靴抬起、停住、踏下，地上的木牌从中段崩开｜镜头：中景 固定｜音效：木屑\n',
    expectCodes: ['W-BODY-PART-NO-OWNER'], expectError: false,
  }),
  T('W-BODY-PART-NO-OWNER 隔一个小句也算没接住', {
    md: '镜 1｜拾牌（8s）\n场景：巷口（冷灰）｜人物：甲\n整体风格：甲穿深色短褐。\n站位：@甲（画面中 · 正面）\n【时间轴】0-8s：中景，固定机位。甲弯腰，两只手分别拾起地上的两半木牌｜镜头：中景 固定｜音效：衣料\n',
    expectCodes: ['W-BODY-PART-NO-OWNER'], expectError: false,
  }),
  T('W-ANON-FIGURE-NO-OWNER 无名无身份的人', {
    md: '镜 1｜跪者（8s）\n场景：巷口（冷灰）｜人物：甲\n整体风格：甲穿深色短褐。\n站位：@甲（画面中 · 正面）\n【时间轴】0-8s：中景，固定机位。镜头顺势下移，落在一个跪着的人身上｜镜头：中景 固定｜音效：风声\n',
    expectCodes: ['W-ANON-FIGURE-NO-OWNER'], expectError: false,
  }),
  T('归属已给（人名紧贴量词）不误报', {
    md: '镜 1｜碾下（8s）\n场景：巷口（冷灰）｜人物：甲\n整体风格：甲穿深色短褐。\n站位：@甲（画面中 · 正面）\n【时间轴】0-8s：中景，固定机位。甲那只深褐短打的靴抬起、停住、踏下；甲那只垂着的袖口不动｜镜头：中景 固定｜音效：木屑\n',
    expectCodes: [], banCodes: ['W-BODY-PART-NO-OWNER'], expectError: false,
  }),
  T('误报源：纸人 / 雪人不是人，ANON 码不响', {
    md: '镜 1｜出炭（8s）\n场景：柴房门口（冷灰）｜人物：甲\n整体风格：甲穿深色短褐。\n站位：@甲（画面中 · 正面）\n【时间轴】0-8s：中景，固定机位。第一个纸人侧身出来、怀里抱着四块黑炭，第二个纸人跟上｜镜头：中景 固定｜音效：纸响\n',
    expectCodes: [], banCodes: ['W-ANON-FIGURE-NO-OWNER'], expectError: false,
  }),
  T('局部入画声明式豁免（无人空镜）', {
    md: '镜 1｜空巷（8s）\n场景：巷口（冷灰）｜人物：甲\n整体风格：甲穿深色短褐。\n【局部入画豁免】：本段为无人物空镜\n站位：@甲（画面中 · 正面）\n【时间轴】0-8s：中景，固定机位。一只靴的印子留在雪面上，雪继续落｜镜头：中景 固定｜音效：落雪\n',
    expectCodes: [], banCodes: ['W-BODY-PART-NO-OWNER', 'W-ANON-FIGURE-NO-OWNER'], expectError: false,
  }),
  // ---- 空间方位参照系（v5.41.0；口径见 references/专项_空间方位参照系.md 第五节）----
  // 三条设计限定：只查「挂没挂画面参照系」不查方位对不对；WARN 级；身体部位不查。
  // 判据是「方位词所在**整个小句**里有没有『画面』」——注意不是只看方位词之前：
  // 「继续向左走出画面左缘」里「画面」在方位词之后，只看前半截会误判（v5.41.0 第一轮踩的）。
  T('W-SPATIAL-NO-FRAME-REF 人物自身左右（他的右前方）', {
    md: '镜 1｜碾下（8s）\n场景：巷口（冷灰）｜人物：甲、乙\n整体风格：甲穿深色短褐，乙穿灰布短打。\n站位：@甲（画面中 · 正面）；@乙（画面右 · 面朝左 · 空手）\n【时间轴】0-8s：中景，固定机位。乙自画面右缘踱入，停在他右前方一步｜镜头：中景 固定｜音效：雪泥\n',
    expectCodes: ['W-SPATIAL-NO-FRAME-REF'], expectError: false,
  }),
  T('W-SPATIAL-NO-FRAME-REF 机位用人物左右（他的左后方）', {
    md: '镜 1｜点眼（8s）\n场景：铺内（暖黄）｜人物：甲\n整体风格：甲穿深色短褐。\n站位：@甲（画面左 · 背对镜头）\n【时间轴】0-8s：中景，固定机位。甲提笔落点｜镜头：越肩中景，机位在他的左后方、略低于肩，全程不动｜音效：笔毫\n',
    expectCodes: ['W-SPATIAL-NO-FRAME-REF'], expectError: false,
  }),
  T('W-SPATIAL-NO-FRAME-REF 参照词被删光（停在右前方一步）', {
    md: '镜 1｜碾下（8s）\n场景：巷口（冷灰）｜人物：甲、乙\n整体风格：甲穿深色短褐，乙穿灰布短打。\n站位：@甲（画面中 · 正面）；@乙（画面右 · 面朝左 · 空手）\n【时间轴】0-8s：中景，固定机位。乙自画面右缘踱入，停在右前方一步｜镜头：中景 固定｜音效：雪泥\n',
    expectCodes: ['W-SPATIAL-NO-FRAME-REF'], expectError: false,
  }),
  T('误报源：画面参照系写全，不响', {
    md: '镜 1｜碾下（8s）\n场景：巷口（冷灰）｜人物：甲、乙\n整体风格：甲穿深色短褐，乙穿灰布短打。\n站位：@甲（画面中 · 正面）；@乙（画面右 · 面朝左 · 空手）\n【时间轴】0-8s：中景，固定机位。乙自画面右缘踱入，停在画面右三分之一、距他一步｜镜头：中景 固定｜音效：雪泥\n',
    expectCodes: [], banCodes: ['W-SPATIAL-NO-FRAME-REF'], expectError: false,
  }),
  T('误报源：方位词在后半截被接住（向左走出画面左缘）', {
    md: '镜 1｜出画（8s）\n场景：柴房门口（冷灰）｜人物：甲\n整体风格：甲穿深色短褐。\n站位：@甲（画面中 · 正面）\n【时间轴】0-8s：中景，固定机位。三个纸人的纸脚继续向左走出画面左缘｜镜头：中景 固定｜音效：纸响\n',
    expectCodes: [], banCodes: ['W-SPATIAL-NO-FRAME-REF'], expectError: false,
  }),
  T('误报源：左右分开是双向词，不是方位', {
    md: '镜 1｜灯阵（8s）\n场景：巷子（夜）｜人物：甲\n整体风格：甲穿深色短褐。\n站位：@甲（画面中 · 正面）\n【时间轴】0-8s：中景，固定机位。两点左右分开、变成两列，向画面上方延伸｜镜头：中景 固定｜音效：无\n',
    expectCodes: [], banCodes: ['W-SPATIAL-NO-FRAME-REF'], expectError: false,
  }),
  T('误报源：身体部位保持人物参照系（右眉／左手／右颊）', {
    md: '镜 1｜对峙（8s）\n场景：巷口（冷灰）｜人物：甲\n整体风格：甲穿深色短褐。\n站位：@甲（画面中 · 正面）\n【时间轴】0-8s：近景，固定机位。甲的右眉尾缺一截，左耳下一道旧疤，他用左手按住案面，右颊一颗带毛的痣｜镜头：近景 固定｜音效：无\n',
    expectCodes: [], banCodes: ['W-SPATIAL-NO-FRAME-REF'], expectError: false,
  }),
  T('误报源：画左 / 画右 简写也算有参照', {
    md: '镜 1｜穿行（8s）\n场景：巷口（冷灰）｜人物：甲\n整体风格：甲穿深色短褐。\n站位：@甲（画面中 · 正面）\n【时间轴】0-8s：中景，固定机位。人从画右走到画左穿过前景｜镜头：中景 固定｜音效：脚步\n',
    expectCodes: [], banCodes: ['W-SPATIAL-NO-FRAME-REF'], expectError: false,
  }),
  T('空间方位声明式豁免（主观 POV）', {
    md: '镜 1｜视点（8s）\n场景：巷口（冷灰）｜人物：甲\n整体风格：甲穿深色短褐。\n【空间方位豁免】：本段为角色主观 POV，必须用角色自身左右\n站位：@甲（画面中 · 正面）\n【时间轴】0-8s：中景，固定机位。他右手边那扇门推开了一条缝｜镜头：中景 固定｜音效：门轴\n',
    expectCodes: [], banCodes: ['W-SPATIAL-NO-FRAME-REF'], expectError: false,
  }),

  // ---- 导演名 / IP 符号去名化（v4.6；口径见 references/导演风格预设层.md）----
  T('W-META-IN-BODY 制作注记进了正文', {
    md: '镜 1｜收摊（30s）\n场景：巷口（冷灰）｜人物：甲、乙\n整体风格：甲穿深色西装，乙穿便装。\n站位：@甲（摊前 · 画面左 · 面朝右 · 提包）；@乙（摊后 · 画面右 · 面朝左 · 空手）\n位移：@甲 摊前→巷中；@乙 原地，无位移\n轴线：保持，摊—墙根连线\n时间线分镜：\n【时间轴】0-11s：中景，固定机位。甲俯身收拾摊面｜镜头：中景 固定｜音效：布面摩擦\n【时间轴】11-22s：中景，固定机位。乙退到摊后站着看｜镜头：中景 固定｜音效：无\n【时间轴】22-29s：中景，固定机位。甲提包退到巷中｜镜头：中景 固定｜音效：脚步\n【时间轴】29-30s：全景，固定机位。段末接戏全景：甲画面左、乙画面右；剪辑时剪掉，仅作下一段首帧与站位参考｜镜头：全景 固定｜音效：环境底噪延续\n',
    expectCodes: ['W-META-IN-BODY'], expectError: false,
  }),
  T('W-DIRECTOR-NAME-IN-BODY', {
    md: '镜 1｜冷峻（10s）\n场景：广场（冷灰）｜人物：甲\n整体风格：诺兰式冷峻写实，去饱和冷色调，高对比自然光。\n【时间轴】0-10s：全景。甲缓步穿过广场，镜头极缓推近｜镜头：全景 缓推｜音效：无\n',
    expectCodes: ['W-DIRECTOR-NAME-IN-BODY'], expectError: false,
  }),
  T('IP 符号也不放过', {
    md: '镜 1｜天空（10s）\n场景：天台（暮色）｜人物：甲\n整体风格：参考《你的名字》的数码光彩，极高饱和天空。\n【时间轴】0-10s：全景。甲立于天台边，天空占画面六成｜镜头：全景 固定｜音效：无\n',
    expectCodes: ['W-DIRECTOR-NAME-IN-BODY'], expectError: false,
  }),
  // ---- 小数秒段头（v4.7.3；志怪剧本实战暴露的解析缺陷修复）----
  T('小数秒段头不再误报', {
    md: [
      '镜 1｜小数秒（10s）',
      '场景：客厅（暖白）｜人物：甲',
      '整体风格：甲穿深色便装。',
      TL('【时间轴】0-2.5s：中景，固定机位。甲端起杯子喝了一口｜镜头：中景 固定｜音效：杯底磕桌\n【时间轴】2.5-7.5s：近景，固定机位。甲放下杯子，抬眼看向窗外的街道，一辆车驶过｜镜头：近景 固定｜音效：衣料摩擦\n【时间轴】7.5-10s：特写，固定机位。甲的目光停在玻璃上的雨痕｜镜头：特写 固定｜音效：雨声'),
      '',
    ].join('\n'),
    expectCodes: [], banCodes: ['E-TIMELINE'], expectError: false,
  }),
  // ---- 参数行合法性（v4.7；口径见 SKILL.md 投放面参数总表）----
  T('E-PARAM-DUR-MISMATCH', {
    md: '镜 1｜不一致（12s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n【时间轴】0-12s：中景。甲坐到沙发上，端起茶杯喝了一口｜镜头：中景 固定｜音效：无\n—— 以下不进正文 ——\n# duration: 10s | # ratio: 16:9\n',
    expectCodes: ['E-PARAM-DUR-MISMATCH'], expectError: true,
  }),
  T('W-PARAM-RATIO', {
    // v5.45.0：4:3 / 3:4 已入锁②白名单（官方 ratio 原文），坏例改用 5:4；扩容值的放行正例见参数行三态组。
    md: '镜 1｜坏比例（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n【时间轴】0-10s：中景。甲坐到沙发上｜镜头：中景 固定｜音效：无\n—— 以下不进正文 ——\n# duration: 10s | # ratio: 5:4\n',
    expectCodes: ['W-PARAM-RATIO'], expectError: false,
  }),
  T('W-PARAM-DUR-RANGE（标题参数行一起越界）', {
    md: '镜 1｜超长（45s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n【时间轴】0-22s：中景。甲坐到沙发上，端起茶杯喝了一口，放下杯子，抬头看向窗外的街道｜镜头：中景 固定｜音效：无\n【时间轴】22-45s：近景。甲起身走向窗边，手扶窗台，望着楼下驶过的车辆，长叹一口气｜镜头：近景 固定｜音效：无\n—— 以下不进正文 ——\n# duration: 45s | # ratio: 16:9\n',
    expectCodes: ['E-OVER-30S', 'W-PARAM-DUR-RANGE'], expectError: true,
  }),
  // ---- 节拍认领（--beats）----
  T('BEAT-happy（全对账通过）', {
    md: [
      '镜 1｜进厅（10s）',
      '场景：候车厅（冷灰）｜人物：甲、乙',
      '认领：场次1 P01-P03',
      '整体风格：写实，甲穿深色大衣，乙穿蓝色制服。',
      TL('【时间轴】0-5s：全景，固定机位。甲拖着行李箱走进候车厅，乙在柜台后抬头｜镜头：全景 固定｜音效：轮子声\n【时间轴】5-10s：近景，缓推。乙（平稳）：「请出示您的票。」甲把车票递给乙｜镜头：近景 缓推｜音效：纸质摩擦'),
      SD('请出示您的票。'),
      '',
      '镜 2｜看票（5s）',
      '场景：候车厅（夜）｜人物：乙',
      '认领：场次2 P04',
      '整体风格：写实，乙穿蓝色制服。',
      TL('【时间轴】0-5s：特写，固定机位。乙低头看票根，指尖蹭过票面｜镜头：特写 固定｜音效：无'),
      '',
    ].join('\n'),
    opts: { beats: BEATS_MAP },
    expectCodes: [], banCodes: ['E-BEAT'], expectError: false,
  }),
  T('W-SHUANGDIAN-NONE（声明了但 0 个 S 编号）', {
    md: [
      '【爽点门】查',
      '镜 1｜测（20s）',
      '场景：室内（暖）｜人物：甲',
      '整体风格：写实，甲穿深色便装。',
      '认领：场次1 P01-P02',
      '时间线分镜：',
      '【时间轴】0-10s：中景。甲动作｜镜头：中景 固定｜音效：无',
      '【时间轴】10-20s：中景。甲再动｜镜头：中景 固定｜音效：无',
      '',
    ].join('\n'),
    opts: { beats: SD_BEATS_NONE },
    expectCodes: ['W-SHUANGDIAN-NONE'], banCodes: ['E-BEAT'], expectError: false,
  }),
  T('W-SHUANGDIAN-SPARSE（2 个拍只 1 个爽点）', {
    md: [
      '【爽点门】查',
      '镜 1｜测（20s）',
      '场景：室内（暖）｜人物：甲',
      '整体风格：写实，甲穿深色便装。',
      '认领：场次1 P01-P02',
      '时间线分镜：',
      '【时间轴】0-10s：中景。甲动作｜镜头：中景 固定｜音效：无',
      '【时间轴】10-20s：中景。甲再动｜镜头：中景 固定｜音效：无',
      '',
    ].join('\n'),
    opts: { beats: SD_BEATS_SPARSE },
    expectCodes: ['W-SHUANGDIAN-SPARSE', 'W-SHUANGDIAN-MONOTYPE'], banCodes: ['E-BEAT'], expectError: false,
  }),
  T('W-SHUANGDIAN-MONOTYPE（全是 S05 一种配方）', {
    md: [
      '【爽点门】查',
      '镜 1｜测（20s）',
      '场景：室内（暖）｜人物：甲',
      '整体风格：写实，甲穿深色便装。',
      '认领：场次1 P01-P02',
      '时间线分镜：',
      '【时间轴】0-10s：中景。甲动作｜镜头：中景 固定｜音效：无',
      '【时间轴】10-20s：中景。甲再动｜镜头：中景 固定｜音效：无',
      '',
    ].join('\n'),
    opts: { beats: SD_BEATS_MONO },
    expectCodes: ['W-SHUANGDIAN-MONOTYPE'], banCodes: ['E-BEAT', 'W-SHUANGDIAN-SPARSE'], expectError: false,
  }),
  T('爽点门干净组（两型 · 密度趾线）', {
    md: [
      '【爽点门】查',
      '镜 1｜测（20s）',
      '场景：室内（暖）｜人物：甲',
      '整体风格：写实，甲穿深色便装。',
      '认领：场次1 P01-P02',
      '时间线分镜：',
      '【时间轴】0-10s：中景。甲动作｜镜头：中景 固定｜音效：无',
      '【时间轴】10-20s：中景。甲再动｜镜头：中景 固定｜音效：无',
      '',
    ].join('\n'),
    opts: { beats: SD_BEATS_MIX },
    expectCodes: [], banCodes: ['W-SHUANGDIAN', 'E-BEAT'], expectError: false,
  }),
  T('爽点门未声明不报（opt-in 验证）', {
    md: [
      '镜 1｜测（20s）',
      '场景：室内（暖）｜人物：甲',
      '整体风格：写实，甲穿深色便装。',
      '认领：场次1 P01-P02',
      '时间线分镜：',
      '【时间轴】0-10s：中景。甲动作｜镜头：中景 固定｜音效：无',
      '【时间轴】10-20s：中景。甲再动｜镜头：中景 固定｜音效：无',
      '',
    ].join('\n'),
    opts: { beats: SD_BEATS_MIX },
    expectCodes: [], banCodes: ['W-SHUANGDIAN', 'E-BEAT'], expectError: false,
  }),
  T('E-BEAT-CLAIM-OVERLAP + GAP', {
    md: [
      '镜 1｜重复认领（10s）',
      '场景：候车厅（冷灰）｜人物：甲、乙',
      '认领：场次1 P01-P02',
      '整体风格：甲穿深色大衣，乙穿蓝色制服。',
      TL('【时间轴】0-10s：全景。甲拖着行李箱走进候车厅，乙抬头看向他｜镜头：全景 固定｜音效：无'),
      '',
      '镜 2｜也认领（5s）',
      '场景：候车厅（冷灰）｜人物：甲',
      '认领：场次1 P01-P02',
      '整体风格：甲穿深色大衣。',
      TL('【时间轴】0-5s：中景。甲站在厅内｜镜头：中景 固定｜音效：无'),
      '',
    ].join('\n'),
    opts: { beats: BEATS_MAP },
    expectCodes: ['E-BEAT-CLAIM-OVERLAP', 'E-BEAT-CLAIM-GAP'], expectError: true,
  }),
  T('E-BEAT-LINE-MISSING', {
    md: [
      '镜 1｜台词没进镜（10s）',
      '场景：候车厅（冷灰）｜人物：甲、乙',
      '认领：场次1 P01-P03',
      '整体风格：甲穿深色大衣，乙穿蓝色制服。',
      TL('【时间轴】0-5s：全景。甲拖着行李箱走进候车厅｜镜头：全景 固定｜音效：轮子声\n【时间轴】5-10s：近景。乙（平稳）：「请把票拿出来。」甲把车票递给乙｜镜头：近景 固定｜音效：纸质摩擦'),
      '',
      '镜 2｜看票（5s）',
      '场景：候车厅（夜）｜人物：乙',
      '认领：场次2 P04',
      '整体风格：乙穿蓝色制服。',
      TL('【时间轴】0-5s：特写。乙低头看票根｜镜头：特写 固定｜音效：无'),
      '',
    ].join('\n'),
    opts: { beats: BEATS_MAP },
    expectCodes: ['E-BEAT-LINE-MISSING'], expectError: true,
  }),
  T('E-BEAT-SCENE-MISMATCH', {
    md: [
      '镜 1｜错场次（10s）',
      '场景：候车厅（冷灰）｜人物：甲',
      '认领：场次2 P01',
      '整体风格：甲穿深色大衣。',
      TL('【时间轴】0-10s：全景。甲拖着行李箱走进候车厅｜镜头：全景 固定｜音效：无'),
      '',
      '镜 2｜看票（5s）',
      '场景：候车厅（夜）｜人物：乙',
      '认领：场次2 P04',
      '整体风格：乙穿蓝色制服。',
      TL('【时间轴】0-5s：特写。乙低头看票根｜镜头：特写 固定｜音效：无'),
      '',
    ].join('\n'),
    opts: { beats: BEATS_MAP },
    expectCodes: ['E-BEAT-SCENE-MISMATCH'], expectError: true,
  }),
  T('E-BEAT-CLAIM-UNKNOWN', {
    md: [
      '镜 1｜认领不存在（10s）',
      '场景：候车厅（冷灰）｜人物：甲',
      '认领：场次1 P01, P09',
      '整体风格：甲穿深色大衣。',
      TL('【时间轴】0-10s：全景。甲拖着行李箱走进候车厅｜镜头：全景 固定｜音效：无'),
      '',
      '镜 2｜看票（5s）',
      '场景：候车厅（夜）｜人物：乙',
      '认领：场次2 P04',
      '整体风格：乙穿蓝色制服。',
      TL('【时间轴】0-5s：特写。乙低头看票根｜镜头：特写 固定｜音效：无'),
      '',
    ].join('\n'),
    opts: { beats: BEATS_MAP },
    expectCodes: ['E-BEAT-CLAIM-UNKNOWN'], expectError: true,
  }),
  T('W-BEAT-TIME-OVERRUN', {
    md: [
      '镜 1｜装不下（5s）',
      '场景：候车厅（冷灰）｜人物：甲、乙',
      '认领：场次1 P01-P03',
      '整体风格：甲穿深色大衣，乙穿蓝色制服。',
      TL('【时间轴】0-5s：全景，固定机位。乙（平稳）：「请出示您的票。」甲拖着行李箱进厅，把车票递给乙｜镜头：全景 固定｜音效：轮子声'),
      SD('请出示您的票。'),
      '',
      '镜 2｜看票（5s）',
      '场景：候车厅（夜）｜人物：乙',
      '认领：场次2 P04',
      '整体风格：乙穿蓝色制服。',
      TL('【时间轴】0-5s：特写。乙低头看票根｜镜头：特写 固定｜音效：无'),
      '',
    ].join('\n'),
    opts: { beats: BEATS_MAP },
    expectCodes: ['W-BEAT-TIME-OVERRUN'], expectError: false,
  }),
  T('W-BEAT-CLAIM-MISSING', {
    md: [
      '镜 1｜进厅（10s）',
      '场景：候车厅（冷灰）｜人物：甲、乙',
      '认领：场次1 P01-P03',
      '整体风格：甲穿深色大衣，乙穿蓝色制服。',
      TL('【时间轴】0-10s：全景。甲拖着行李箱进厅，乙抬头，甲递票，乙（平稳）：「请出示您的票。」｜镜头：全景 固定｜音效：无'),
      SD('请出示您的票。'),
      '',
      '镜 2｜看票（5s）',
      '场景：候车厅（夜）｜人物：乙',
      '认领：场次2 P04',
      '整体风格：乙穿蓝色制服。',
      TL('【时间轴】0-5s：特写。乙低头看票根｜镜头：特写 固定｜音效：无'),
      '',
      '镜 3｜出门（5s）',
      '场景：站台（夜）｜人物：乙',
      '整体风格：乙穿蓝色制服。',
      TL('【时间轴】0-5s：全景。乙快步走向站台尽头｜镜头：全景 固定｜音效：脚步声'),
      '',
    ].join('\n'),
    opts: { beats: BEATS_MAP },
    expectCodes: ['W-BEAT-CLAIM-MISSING'], expectError: false,
  }),
  // ---- v5.43.0 外部审计补测：四条零覆盖码转正（W-SHOT-MULTI-SCALE / E-HOOK-UNDECLARED /
  // E-HOOK-OUT-OF-WINDOW / W-OFFICIAL-1000W）+ W-EMPTY-TIMELINE 正向 + W-BEAT-LENGTH 反例。
  // 此前这四条码的判据分支从未被任何用例执行过（其中两条是 ERROR）。
  T('W-SHOT-MULTI-SCALE 正例（一镜三档景别）', {
    md: [
      '镜 1｜开场（10s · 试）',
      '场景：候车厅（冷灰）｜人物：甲、乙',
      '整体风格：写实，甲穿深色大衣，乙穿蓝色制服。',
      '站位：@甲（画面左 · 手搭长椅 · 侧身朝右）；@乙（画面右 · 柜台内 · 正面朝左）',
      '轴线：建立，甲在左三分之一，乙在右三分之一',
      '本镜光色基调：冷青灰；色彩预算：唯一重音色 = 乙的蓝色制服',
      '时间线分镜：',
            TL('【时间轴】0-4s：大远景，固定机位。甲把行李箱放上长椅，乙抬头看向甲｜镜头：大远景 固定｜音效：轮子声'),,
            TL('【时间轴】4-7s：中景，固定机位。甲穿过人群走向检票口｜镜头：中景 固定｜音效：脚步声'),,
            TL('【时间轴】7-10s：特写，固定机位。甲停下看表，秒针走动｜镜头：特写 固定｜音效：秒针'),,
      '声音设计：',
      '环境层：候车厅广播底噪（极弱、持续）',
      '对白：无',
      '—— 以下不进正文 ——',
      '# duration: 10s | # ratio: 16:9',
      '',
    ].join('\n'),
    expectCodes: ['W-SHOT-MULTI-SCALE'], expectError: false,
  }),
  T('节奏档位声明在枚举内 → 静默（W-PACE-TIER 不响）', {
    md: [
      '【节奏档位】短视频中高密度',
      '镜 1｜开场（10s · 试）',
      '场景：候车厅（冷灰）｜人物：甲、乙',
      '整体风格：写实，甲穿深色大衣，乙穿蓝色制服。',
      '站位：@甲（画面左 · 手搭长椅 · 侧身朝右）；@乙（画面右 · 柜台内 · 正面朝左）',
      '轴线：建立，甲在左三分之一，乙在右三分之一',
      '本镜光色基调：冷青灰；色彩预算：唯一重音色 = 乙的蓝色制服',
      '时间线分镜：',
            TL('【时间轴】0-4s：大远景，固定机位。甲把行李箱放上长椅，乙抬头看向甲｜镜头：大远景 固定｜音效：轮子声'),,
            TL('【时间轴】4-7s：中景，固定机位。甲穿过人群走向检票口｜镜头：中景 固定｜音效：脚步声'),,
            TL('【时间轴】7-10s：特写，固定机位。甲停下看表，秒针走动｜镜头：特写 固定｜音效：秒针'),,
      '声音设计：',
      '环境层：候车厅广播底噪（极弱、持续）',
      '对白：无',
      '—— 以下不进正文 ——',
      '# duration: 10s | # ratio: 16:9',
      '',
    ].join('\n'),
    banCodes: ['W-PACE-TIER'], expectError: false,
  }),
  T('节奏档位出枚举 → W-PACE-TIER', {
    md: [
      '【节奏档位】超快爆闪流',
      '镜 1｜开场（10s · 试）',
      '场景：候车厅（冷灰）｜人物：甲',
      '整体风格：写实，甲穿深色大衣。',
      '轴线：建立',
      '本镜光色基调：冷青灰；色彩预算：单一色系',
      '时间线分镜：',
            TL('【时间轴】0-10s：全景，固定机位。甲把行李箱放上长椅｜镜头：全景 固定｜音效：轮子声'),,
      '声音设计：',
      '环境层：候车厅广播底噪（极弱、持续）',
      '对白：无',
      '—— 以下不进正文 ——',
      '# duration: 10s | # ratio: 16:9',
      '',
    ].join('\n'),
    expectCodes: ['W-PACE-TIER'], expectError: false,
  }),
  T('高密度档声明下三档景别 → 照报 W-SHOT-MULTI-SCALE（档位不豁免）', {
    md: [
      '【节奏档位】高密度动作或强钩子',
      '镜 1｜开场（10s · 试）',
      '场景：候车厅（冷灰）｜人物：甲、乙',
      '整体风格：写实，甲穿深色大衣，乙穿蓝色制服。',
      '站位：@甲（画面左 · 手搭长椅 · 侧身朝右）；@乙（画面右 · 柜台内 · 正面朝左）',
      '轴线：建立，甲在左三分之一，乙在右三分之一',
      '本镜光色基调：冷青灰；色彩预算：唯一重音色 = 乙的蓝色制服',
      '时间线分镜：',
            TL('【时间轴】0-4s：大远景，固定机位。甲把行李箱放上长椅，乙抬头看向甲｜镜头：大远景 固定｜音效：轮子声'),,
            TL('【时间轴】4-7s：中景，固定机位。甲穿过人群走向检票口｜镜头：中景 固定｜音效：脚步声'),,
            TL('【时间轴】7-10s：特写，固定机位。甲停下看表，秒针走动｜镜头：特写 固定｜音效：秒针'),,
      '声音设计：',
      '环境层：候车厅广播底噪（极弱、持续）',
      '对白：无',
      '—— 以下不进正文 ——',
      '# duration: 10s | # ratio: 16:9',
      '',
    ].join('\n'),
    expectCodes: ['W-SHOT-MULTI-SCALE'], expectError: false,
  }),
  T('N20 表格行「同上」不报（附表区排除）', {
    md: [
      '镜 1｜开场（10s · 试）',
      '场景：候车厅（冷灰）｜人物：甲',
      '整体风格：写实，甲穿深色大衣。',
      '站位：@甲（画面左 · 手搭长椅 · 侧身朝右）',
      '轴线：建立',
      '本镜光色基调：冷青灰；色彩预算：单一色系',
      '时间线分镜：',
            TL('【时间轴】0-10s：全景，固定机位。甲把行李箱放上长椅｜镜头：全景 固定｜音效：轮子声'),,
      '声音设计：',
      '环境层：候车厅底噪',
      '对白：无',
      '—— 以下不进正文 ——',
      '# duration: 10s | # ratio: 16:9',
      '',
      '## 转场注记总表',
      '| 镜1 | 同上 | 同上 | — |',
      '',
    ].join('\n'),
    banCodes: ['W-CONTEXT-LEAK'], expectError: false,
  }),
  T('W-SHOT-MULTI-SCALE 反例（两档景别不报）', {
    md: [
      '镜 1｜开场（10s · 试）',
      '场景：候车厅（冷灰）｜人物：甲、乙',
      '整体风格：写实，甲穿深色大衣，乙穿蓝色制服。',
      '站位：@甲（画面左 · 手搭长椅 · 侧身朝右）；@乙（画面右 · 柜台内 · 正面朝左）',
      '轴线：建立，甲在左三分之一，乙在右三分之一',
      '本镜光色基调：冷青灰；色彩预算：唯一重音色 = 乙的蓝色制服',
      '时间线分镜：',
            TL('【时间轴】0-5s：大远景，固定机位。甲把行李箱放上长椅，乙抬头看向甲｜镜头：大远景 固定｜音效：轮子声'),,
            TL('【时间轴】5-10s：中景，固定机位。甲穿过人群走向检票口｜镜头：中景 固定｜音效：脚步声'),,
      '声音设计：',
      '环境层：候车厅广播底噪（极弱、持续）',
      '对白：无',
      '—— 以下不进正文 ——',
      '# duration: 10s | # ratio: 16:9',
      '',
    ].join('\n'),
    banCodes: ['W-SHOT-MULTI-SCALE'], expectError: false,
  }),
  T('E-HOOK-UNDECLARED（声明查但节拍无 HOOK）', {
    md: [
      '【钩子门】：查',
      '镜 1｜开场（10s · 试）',
      '场景：候车厅（冷灰）｜人物：甲、乙',
      '认领：场次1 P01-P03',
      '整体风格：写实，甲穿深色大衣，乙穿蓝色制服。',
      '时间线分镜：',
            TL('【时间轴】0-5s：全景，固定机位。甲把行李箱放上长椅，乙抬头看向甲｜镜头：全景 固定｜音效：轮子声'),,
            TL('【时间轴】5-10s：近景，缓推。乙（平稳）：「请出示您的票。」甲侧身从口袋取票｜镜头：近景 缓推｜音效：纸质摩擦'),,
      '—— 以下不进正文 ——',
      '# duration: 10s | # ratio: 16:9',
      '',
    ].join('\n'),
    opts: { beats: BEATS_NO_HOOK },
    expectCodes: ['E-HOOK-UNDECLARED'], expectError: true,
  }),
  T('E-HOOK-OUT-OF-WINDOW（钩子在第 5 拍，窗口 3）', {
    md: [
      '【钩子门】：查',
      '镜 1｜开场（10s · 试）',
      '场景：候车厅（冷灰）｜人物：甲、乙',
      '认领：场次1 P01-P05',
      '整体风格：写实，甲穿深色大衣，乙穿蓝色制服。',
      '时间线分镜：',
            TL('【时间轴】0-5s：全景，固定机位。甲把行李箱放上长椅，乙抬头看向甲｜镜头：全景 固定｜音效：轮子声'),,
            TL('【时间轴】5-10s：近景，缓推。乙（平稳）：「请出示您的票。」甲侧身从口袋取票｜镜头：近景 缓推｜音效：纸质摩擦'),,
      '—— 以下不进正文 ——',
      '# duration: 10s | # ratio: 16:9',
      '',
    ].join('\n'),
    opts: { beats: BEATS_HOOK_LATE },
    expectCodes: ['E-HOOK-OUT-OF-WINDOW'], expectError: true,
  }),
  T('钩子窗口内不报（HOOK 在第 2 拍）', {
    md: '【钩子门】：查\n' + CLEAN,
    opts: { beats: BEATS_HOOK_IN_WINDOW },
    banCodes: ['E-HOOK-'], expectError: false,
  }),
  T('W-EMPTY-TIMELINE 正例（有段头样无可用段）', {
    md: [
      '镜 1｜开场（10s · 试）',
      '场景：候车厅（冷灰）｜人物：甲、乙',
      '整体风格：写实，甲穿深色大衣，乙穿蓝色制服。',
      '时间线分镜：',
      '【时间轴】一镜到底，全段不切分。',
      '声音设计：',
      '环境层：候车厅广播底噪',
      '—— 以下不进正文 ——',
      '# duration: 10s | # ratio: 16:9',
      '',
    ].join('\n'),
    expectCodes: ['W-EMPTY-TIMELINE'], expectError: false,
  }),
  T('W-OFFICIAL-1000W 正例（--official 英文正文超 1000 词）', {
    md: CLEAN + '\n整体风格补充：' + EN_LINE.repeat(70),
    opts: { official: true },
    expectCodes: ['W-OFFICIAL-1000W'], expectError: false,
  }),
  T('W-BEAT-LENGTH 正例（首拍 2s 短于 3s）', {
    md: [
      '镜 1｜开场（10s · 试）',
      '场景：候车厅（冷灰）｜人物：甲、乙',
      '整体风格：写实，甲穿深色大衣，乙穿蓝色制服。',
      '站位：@甲（画面左 · 手搭长椅 · 侧身朝右）；@乙（画面右 · 柜台内 · 正面朝左）',
      '轴线：建立，甲在左三分之一，乙在右三分之一',
      '本镜光色基调：冷青灰；色彩预算：唯一重音色 = 乙的蓝色制服',
      '本镜保真预算：主 = 甲的皮质行李箱；次 = 玻璃反光；省 = 群像',
      '时间线分镜：',
      '【时间轴】0-2s：全景，固定机位。甲把行李箱放上长椅，乙抬头看向甲｜镜头：全景 固定｜音效：轮子声',
      '【时间轴】2-10s：近景，缓推。乙（平稳）：「请出示您的票。」甲侧身从口袋取票｜镜头：近景 缓推｜音效：纸质摩擦',
      '声音设计：',
      '环境层：候车厅广播底噪（极弱、持续）',
      '动作层：行李箱落椅闷响（0-1s）',
      '呼吸层：无',
      '逼近层：无',
      '对白：0:05 乙（平稳）：「请出示您的票。」',
      '刚性约束：',
      '必锁：行李箱 = 棕色皮质黄铜扣，边角磨白（锚「行李箱」图）',
      '可见性：群像 = 仅背景虚化轮廓',
      'Must not：可读文字、字幕、水印',
      '—— 以下不进正文 ——',
      '# duration: 10s | # ratio: 16:9',
      '',
    ].join('\n'),
    expectCodes: ['W-BEAT-LENGTH'], expectError: false,
  }),
  T('W-BEAT-LENGTH 反例（首 5s / 末 5s 达标）', {
    md: CLEAN,
    banCodes: ['W-BEAT-LENGTH'], expectError: false,
  }),
  T('跨段全景按需：未声明继承不报缺全景', {
    md: '镜 1｜收束（8s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n【时间轴】0-8s：近景，固定机位。甲放下茶杯｜镜头：近景 固定｜音效：轻响\n',
    expectCodes: [], expectError: false,
  }),
  T('W-FIRST-FRAME-NOT-BOUND 正文首帧未硬绑定', {
    md: '镜 1｜接续（8s）\n场景：客厅（暖白）｜人物：甲\n整体风格：@图片1作为首帧。甲在沙发旁，镜头正对。\n首拍保持首帧状态，再抬手。\n【时间轴】0-8s：中景，固定机位。甲抬手｜镜头：中景 固定｜音效：无\n# 首帧来源：段0实际尾帧（验收通过）\n',
    expectCodes: ['W-FIRST-FRAME-NOT-BOUND'], expectError: false,
  }),
  T('W-FIRST-FRAME-UNVERIFIED 上段尾帧未验收', {
    md: '镜 1｜接续（8s）\n场景：客厅（暖白）｜人物：甲\n整体风格：@图片1作为首帧。以上一段尾帧为准，首拍保持首帧状态。\n【时间轴】0-8s：中景，固定机位。甲抬手｜镜头：中景 固定｜音效：无\n# 首帧绑定：first_frame\n',
    expectCodes: ['W-FIRST-FRAME-UNVERIFIED'], expectError: false,
  }),
  T('W-FIRST-FRAME-NO-HOLD 跨段首拍未保持', {
    md: '镜 1｜接续（8s）\n场景：客厅（暖白）｜人物：甲\n整体风格：@图片1作为首帧。甲在沙发旁，镜头正对。\n【时间轴】0-8s：中景，环绕。甲转身走向窗边｜镜头：中景 环绕｜音效：无\n# 首帧来源：段0实际尾帧（验收通过）\n# 首帧绑定：first_frame\n',
    expectCodes: ['W-FIRST-FRAME-NO-HOLD'], expectError: false,
  }),
  T('跨段首帧完整留痕不报三码', {
    md: '镜 1｜接续（8s）\n场景：客厅（暖白）｜人物：甲\n整体风格：@图片1作为首帧。甲在沙发旁，镜头正对。\n首拍保持首帧状态，再抬手。\n【时间轴】0-8s：中景，固定机位。甲抬手｜镜头：中景 固定｜音效：无\n# 首帧来源：段0实际尾帧（验收通过）\n# 首帧绑定：first_frame\n',
    expectCodes: [], banCodes: ['W-FIRST-FRAME-'], expectError: false,
  }),
  T('官方 500 字建议默认关闭（v6.4.2 实测裁决：建议级非硬限制且不适用 30s 长段）', {
    md: '镜 1｜长文（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n【时间轴】0-10s：中景。' + '甲安静坐在窗边。'.repeat(70) + '｜镜头：中景 固定｜音效：无\n',
    expectCodes: [], banCodes: ['W-OFFICIAL-500'], expectError: false,
  }),
  T('official=false 只关闭官方建议', {
    md: '镜 1｜长文（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n【时间轴】0-10s：中景。' + '甲安静坐在窗边。'.repeat(70) + '｜镜头：中景 固定｜音效：无\n',
    opts: { official: false },
    expectCodes: [], banCodes: ['W-OFFICIAL-500'], expectError: false,
  }),
];

// ---------------------------------------------------------------- harness

let pass = 0, fail = 0;

function check(name, cond, detail) {
  if (cond) return true;
  fail++;  console.log(`  ✗ ${name}`);
  console.log(detail);
  return false;
}

console.log(`check_prompt.mjs 击穿用例自测：${fixtures.length} 组`);

for (const f of fixtures) {
  const codes = [];

  if (f.kind === 'h3') {
    // H3 自识别正反向：Ref2VA 六段样本与 base 三字段样本都必须识别为 H3，干净包必须不误判。
    // v5.37.1：补 base 样本 —— 「T2VA 包漏过哨兵」是审查报告 MA-3 的另一半。
    const a = isH3Package(H3_SAMPLE);
    const base = isH3Package(H3_BASE_SAMPLE);
    const b = isH3Package(CLEAN);
    const ok = check(f.name, a === true && base === true && b === false,
      `  Ref2VA 样本=${a}（应 true），base 三字段样本=${base}（应 true），干净包=${b}（应 false）`);
    if (ok) { pass++; console.log(`  ✓ ${f.name}`); }
    continue;
  }

  const { issues } = collectIssues(f.md, { ...(f.opts || {}), model: f.model });
  const hit = new Set(issues.map((i) => i.code));
  const hasError = issues.some((i) => i.level === 'error');
  codes.push(...issues.map((i) => i.code));

  let ok = true;
  for (const c of f.expectCodes) {
    if (!hit.has(c)) ok = check(f.name, false, `  应命中 ${c} —— 未出现。实际命中：${codes.join(', ') || '（无）'}`);
  }
  for (const c of f.banCodes) {
    if (codes.some((x) => x.startsWith(c))) ok = check(f.name, false, `  应避开 ${c} —— 出现了：${codes.filter((x) => x.startsWith(c)).join(', ')}`);
  }
  if (f.expectError !== null && hasError !== f.expectError) {
    ok = check(f.name, false, `  error 级问题应为 ${f.expectError}，实际 ${hasError}。命中：${codes.join(', ') || '（无）'}`);
  }
  if (ok && f.expectCodes.every((c) => hit.has(c))) {
    pass++;
    console.log(`  ✓ ${f.name}`);
  }
}

console.log('─'.repeat(56));
console.log(`结果：${pass} 过 / ${fail} 败`);


// ---------------------------------------------------------------- 长度尺（v4.7.6）
// --len 明细是新加的第二把尺。两把尺必须报同一个数，否则「门说超了、明细说没超」。
// 这里不测排版，只测三件事：额度同源、节名归对、超字时点名到行。

{
  const failBefore = fail;
  const LONG = '镜 1｜超字（10s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿白色家居服。\n时间线分镜：\n【时间轴】0-10s：中景，固定机位。'
    + '甲坐在沙发上，双手放在膝盖，视线落在门框，肩线放松，呼吸平稳。'.repeat(40)
    + '｜镜头：中景 固定｜音效：无\n';

  const one = (md) => lenDetail(splitBlocks(md.split('\n'))[0]);

  const dClean = one(CLEAN);
  const dLong = one(LONG);
  const secNames = dClean.sections.map((s) => s[0]);

  // 1. 额度同源：明细说没超 → 门就不许报超字；明细说超了 → 门必须报
  const cleanIssues = collectIssues(CLEAN, {}).issues.map((i) => i.code);
  const longIssues = collectIssues(LONG, {}).issues;
  check('长度尺：控制组不报 W-LENGTH-CAP 且明细未超额',
    dClean.over <= 0 && !cleanIssues.includes('W-LENGTH-CAP'),
    `  明细 total=${dClean.total} cap=${dClean.cap} over=${dClean.over}；门禁命中：${cleanIssues.join(', ') || '（无）'}`);
  check('长度尺：超字段本同时满足 over>0 与 W-LENGTH-CAP',
    dLong.over > 0 && longIssues.some((i) => i.code === 'W-LENGTH-CAP'),
    `  明细 over=${dLong.over}；门禁命中：${longIssues.map((i) => i.code).join(', ') || '（无）'}`);

  // 2. 节名归对：站位 / 时间线分镜 必须各自成节，不能被并进上一节
  check('长度尺：节名识别（站位 / 时间线分镜 各自成节）',
    secNames.includes('站位') && secNames.includes('时间线分镜'),
    `  实际节：${secNames.join('、')}`);

  // 3. 超字点名到行：hint 里带最长行，且行长降序
  const capWarn = longIssues.find((i) => i.code === 'W-LENGTH-CAP');
  check('长度尺：W-LENGTH-CAP 的 hint 点名最长行',
    !!capWarn && /最长 3 行/.test(capWarn.hint || '') && /L\d+\(\d+字\)/.test(capWarn.hint || ''),
    `  hint：${capWarn ? capWarn.hint : '（未报）'}`);
  check('长度尺：明细行按长度降序',
    dLong.rows.every((r, i) => i === 0 || dLong.rows[i - 1].len >= r.len),
    `  前 5 行长度：${dLong.rows.slice(0, 5).map((r) => r.len).join(', ')}`);

  console.log(`长度尺自测：${fail === failBefore ? '通过（5 项）' : `${fail - failBefore} 项失败`}`
    + `（控制组 ${dClean.total}/${dClean.cap} · 超字段本 ${dLong.total}/${dLong.cap}）`);
}


// ---------------------------------------------------------------- 风格注册表三方一致性
// 2026-10-12 诊断修复的固化：urban-folk-filmstill 曾有完整锚文件+路由表登记，唯 L0 漏条目，
// 用户一用就报 S2-STYLE-UNREGISTERED。此用例守护「路由表已落值集合 == L0 已落值集合 == 锚文件存在」。
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const skillRoot = path.resolve(here, '..');
  const seed = JSON.parse(fs.readFileSync(path.join(skillRoot, 'references', 'style-registry.seed.json'), 'utf8'));
  const routeText = fs.readFileSync(path.join(skillRoot, 'references', '风格路由表.md'), 'utf8');

  const l0Done = new Set(Object.entries(seed.styles).filter(([, s]) => s.status === '已落值').map(([id]) => id));
  const routeDone = new Set();
  // 路由表列序在 v5.4.6 调整过（中文名前置），两种列序都要认，否则一致性检查假红：
  //   新（v5.4.6 起）| 中文名 | `id` | 轨道 | 维度 | 稳定性 | 已落值 | 锚文件 |
  //   旧（v5.4.6 前）| id | 轨道 | 维度 | 稳定性 | 中文名 | 已落值 | 锚文件 |
  // 2026-10-14 修：旧正则按「第一列即 id」写，v5.4.6 调序后全部失配，路由表已落值恒为 0
  // → 该一致性检查长期假红而未被察觉（它排在 52 项自测之后，报告只看「52 过 / 0 败」就会漏掉）。
  for (const m of routeText.matchAll(/^\|[^|]*\|\s*`([a-z0-9][a-z0-9-]*)`\s*\|[^|]*\|[^|]*\|[^|]*\|\s*已落值\s*\|/gm)) routeDone.add(m[1]);
  for (const m of routeText.matchAll(/^\|\s*([a-z0-9][a-z0-9-]*)\s*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*已落值\s*\|/gm)) routeDone.add(m[1]);

  console.log(`\n风格注册表一致性：L0 已落值 ${l0Done.size} 条 ｜ 路由表已落值 ${routeDone.size} 条`);

  // 1. 两集合相等
  const onlyL0 = [...l0Done].filter((id) => !routeDone.has(id));
  const onlyRoute = [...routeDone].filter((id) => !l0Done.has(id));
  check('注册表一致性：L0 与路由表已落值集合相等',
    onlyL0.length === 0 && onlyRoute.length === 0,
    `  仅 L0 有：${onlyL0.join(', ') || '无'}；仅路由表有：${onlyRoute.join(', ') || '无'}`);

  // 2. 每个已落值 id 的 ref_file 必须存在
  const missingRefs = [];
  for (const [id, s] of Object.entries(seed.styles)) {
    if (s.status !== '已落值' || !s.ref_file) continue;
    if (!fs.existsSync(path.join(skillRoot, s.ref_file))) missingRefs.push(`${id} → ${s.ref_file}`);
  }
  check('注册表一致性：已落值风格的锚文件全部存在',
    missingRefs.length === 0, `  缺失：${missingRefs.join('；') || '无'}`);

  // 3. 每个已落值 id 必须有三面压句（H3/Seedance/国内面对得上）
  const noPress = [];
  for (const [id, s] of Object.entries(seed.styles)) {
    if (s.status !== '已落值') continue;
    const ts = s.tech_spec || {};
    if (!ts.render_cn || !ts.render_en) noPress.push(id);
  }
  check('注册表一致性：已落值风格均有中英压句',
    noPress.length === 0, `  缺压句：${noPress.join(', ') || '无'}`);

  // 4. 锚文件命名统一（v4.7.6）：两个文件曾叫「水墨淡彩2D风格锚.md」「哥特定格木偶风格锚.md」，
  //    靠 L0 逐条校验存在性能过，但按前缀批量处理（打包/检索/迁移）会静默漏掉它们。
  const refDir = path.join(skillRoot, 'references');
  const badNames = fs.readdirSync(refDir).filter(
    (f) => f.includes('风格锚') && f.endsWith('.md') && !f.startsWith('风格锚_'));
  check('注册表一致性：锚文件统一「风格锚_」前缀',
    badNames.length === 0, `  不合前缀：${badNames.join('；') || '无'}`);

  // 5. excludes 双向性（A 的 excludes 含 B，则 B 的 excludes 应含 A——单向会让串轨检测漏一半）
  const oneWay = [];
  for (const [id, s] of Object.entries(seed.styles)) {
    for (const ex of s.excludes || []) {
      const other = seed.styles[ex];
      if (other && !(other.excludes || []).includes(id)) oneWay.push(`${id}→${ex}`);
    }
  }
  check('注册表一致性：excludes 双向登记',
    oneWay.length === 0, `  单向：${oneWay.join(', ') || '无'}`);
}

// ---------------------------------------------------------------- 锁①型号与时长上限（v5.37.1）
// 病根（审查报告 MA-1 / MA-2 / MA-4）：cap 在 check_prompt.mjs 里写死 30 / 20，在
// audit_project.py 里另有一份 MODEL_DURATION —— 同一份「2.0 面 20s」包，一台判过、一台判
// ERROR，两边都自称权威。这组用例把「按锁①型号取参数」钉住：谁把 30 写回去，这里立刻红。
{
  const failBefore = fail;
  const mk20 = (decl) => (decl ? `【模型版本】：${decl}\n` : '')
    + '镜 1｜超长（20s）\n场景：客厅（暖白）｜人物：甲\n整体风格：甲穿深色便装。\n'
    + '【时间轴】0-10s：中景。甲坐下，端起茶杯喝了一口｜镜头：中景 固定｜音效：无\n'
    + '【时间轴】10-20s：近景。甲起身走到窗边，手扶窗台望向街道｜镜头：近景 固定｜音效：无\n';

  // 1. 型号识别：H3 Max 必须先于 H3 认出来（否则它的 5s 下限永不生效）；
  //    且【模型版本】的优先级高于【三锁】模型= —— 两处声明打架时，两台机要认同一处。
  const probes = ['【模型版本】：2.5', '【三锁】模型=Seedance 2.0', '锁定 model: MiniMax H3',
    '锁定 model: MiniMax H3 Max', '【模型版本】：2.0\n【三锁】模型=2.5 ｜ 画幅=16:9'];
  const got = probes.map((s) => detectModel(s));
  check('锁①：型号识别（2.5 / 2.0 / H3 / H3 Max 优先于 H3 / ①声明优先于②三锁）',
    got[0] === '2.5' && got[1] === '2.0' && got[2] === 'h3' && got[3] === 'h3max' && got[4] === '2.0',
    `  实际：${probes.map((s, i) => `${JSON.stringify(s)}→${got[i]}`).join('；')}`);

  // 2. 同一份 20s 包：2.5 面放行、2.0 面报硬上限 —— 判据真的跟着型号走
  const hit25 = collectIssues(mk20(''), { model: '2.5' }).issues.some((i) => i.code === 'E-OVER-30S');
  const hit20 = collectIssues(mk20(''), { model: '2.0' }).issues.find((i) => i.code === 'E-OVER-30S');
  check('锁①：20s 包在 2.5 面不报、在 2.0 面报硬上限',
    !hit25 && !!hit20,
    `  2.5 命中 E-OVER-30S=${hit25}（应 false）；2.0 命中=${!!hit20}（应 true）`);
  check('锁①：报错消息注明判据出处（锁①=2.0）',
    !!hit20 && /锁①=2\.0/.test(hit20.msg),
    `  消息：${hit20 ? hit20.msg : '（未报）'}`);

  // 3. auto：包内声明优先；未声明落最严兜底（与 audit_project.py 同口径，绝不静默放宽到 30s）
  const auto20 = resolveModel(mk20('2.0'), 'auto');
  const autoNone = resolveModel(mk20(''), 'auto');
  check('锁①：auto 认包内声明；未声明落兜底档',
    auto20.key === '2.0' && auto20.declared === true
    && autoNone.key === null && autoNone.declared === false
    && autoNone.limit.cap === FALLBACK_LIMIT.cap,
    `  声明 2.0 → key=${auto20.key} declared=${auto20.declared}；`
    + `无声明 → key=${autoNone.key} cap=${autoNone.limit.cap}（兜底 ${FALLBACK_LIMIT.cap}）`);

  // 4. 兜底档必须自报家门：消息里要出现「锁①未声明」，不能让人以为 15s 是官方默认
  const noneHit = collectIssues(mk20(''), { model: 'auto' }).issues.find((i) => i.code === 'E-OVER-30S');
  check('锁①：兜底判据在消息里点名「锁①未声明」',
    !!noneHit && /锁①未声明/.test(noneHit.msg),
    `  消息：${noneHit ? noneHit.msg : '（未报）'}`);

  // 5. 档位表自身：4 档齐全、H3 Max 下限 5s（旧实现把 4 写死在判据里，Max 永不命中）
  check('锁①：档位表 4 档齐全且 H3 Max 下限 5s',
    ['2.5', '2.0', 'h3', 'h3max'].every((k) => !!MODEL_LIMITS[k])
    && MODEL_LIMITS.h3max.floor === 5 && MODEL_LIMITS.h3.floor === 4 && MODEL_LIMITS['2.5'].floor === null,
    `  档位：${Object.keys(MODEL_LIMITS).join('/')}；floor：`
    + `${Object.entries(MODEL_LIMITS).map(([k, v]) => `${k}=${v.floor}`).join(' ')}`);

  // 6. 内置副本 ↔ JSON 逐档一致（model_limits.mjs:15 注释承诺的对拍，此前不存在——
  //    BUILTIN 未导出、四个 selftest 零引用，JSON 改数忘同步时静默用旧数）
  //    v5.49.0 扩：prompt_length 与 ratio_whitelist 一并入对拍（check_prompt 判它们时不再有代码常量可兜）。
  const _plOk = PROMPT_LENGTH.cjkMax === 500 && PROMPT_LENGTH.enMax === 1000;
  const _ratioOk2 = ['16:9', '4:3', '3:4', 'adaptive', 'bogus']
    .every((v) => ratioOk(v) === (v !== 'bogus'));
  const _same = ['2.5', '2.0', 'h3', 'h3max'].every((k) => {
    const a = MODEL_LIMITS[k], b = BUILTIN[k];
    return a && b && a.cap === b.cap && a.soft === b.soft && a.floor === b.floor
      && a.refs && b.refs && a.refs.total === b.refs.total;
  }) && _plOk && _ratioOk2;
  check('锁①：内置副本与 model-limits.json 逐档一致（cap/soft/floor/refs.total + prompt_length + ratio 白名单）',
    _same,
    `  档位：${['2.5', '2.0', 'h3', 'h3max'].map((k) => {
      const a = MODEL_LIMITS[k] || {}, b = BUILTIN[k] || {};
      return `${k} cap ${a.cap}/${b.cap} soft ${a.soft}/${b.soft} floor ${a.floor}/${b.floor}`;
    }).join('；')}；prompt_length ${PROMPT_LENGTH.cjkMax}字/${PROMPT_LENGTH.enMax}词；ratioOk=${_ratioOk2}`);

  // 7. H3 档 refs.total 可读：check_prompt_h3 的 E-REF-LIMIT 从 limit 取值，不再写死 12
  check('锁①：H3 档 refs.total 可读（供 check_prompt_h3 的 E-REF-LIMIT 用）',
    !!(MODEL_LIMITS.h3 && Number.isFinite(MODEL_LIMITS.h3.refs.total)),
    `  h3.refs.total = ${MODEL_LIMITS.h3 ? MODEL_LIMITS.h3.refs.total : '（缺失）'}`);

  console.log(`锁①型号自测：${fail === failBefore ? '通过（7 项）' : `${fail - failBefore} 项失败`}`);
}

process.exit(fail > 0 ? 1 : 0);
