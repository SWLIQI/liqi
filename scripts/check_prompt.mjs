#!/usr/bin/env node
/**
 * liqi-prompt 机械校验器
 *
 * 用法：
 *   node check_prompt.mjs <file> [--surface intl|cn|auto] [--strict]
 *                         [--beats <节拍清单>] [--no-log] [--official]
 *
 * 退出码：0 = 无 error（warning 不阻断）；1 = 存在 error；2 = 输入异常
 *
 * 节拍认领（--beats，可选门）：
 *   给一份节拍清单（P01｜场次1｜画面事件｜动作或台词），每个镜块加一行
 *   「认领：场次1 P01-P03」，脚本对账：覆盖完整、无重叠、台词拍逐字进镜、
 *   预估时长不超镜长。规则码 E-BEAT-* / W-BEAT-*。
 *
 * 门失败日志：默认把每次运行的规则码计数追加到「被校验文件同目录」的
 * .gates.jsonl（--no-log 关闭）；跑 gates_stats.mjs 聚合，回答哪道门最常响。
 *
 * 设计原则：只做「模型/正则可以机械判定」的检查，不做审美判断。
 * 审美与逻辑仍由 SKILL.md Step 4 的人工/LLM 环节负责。
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { appendGateLog, logDisabled } from './gates_log.mjs';
// v5.37.1：锁①硬参数（cap / soft / floor）从单一事实源取，与 audit_project.py、check_prompt_h3.mjs 同源。
// 历史缺陷（审查报告 MA-1 / MA-2）：这些数字在本文件里写死 30/20，audit_project.py 里另有
// 一份 MODEL_DURATION —— 同一份「2.0 面 20s」包，check_prompt 判 0 error、audit_project 判
// ERROR，两台机结论相反且都自称权威。
import { MODEL_LIMITS, FALLBACK_LIMIT, MODEL_LIMITS_SRC, PROMPT_LENGTH, ratioOk } from './model_limits.mjs';

// ---------------------------------------------------------------- 锁①型号识别

// 型号识别顺序与 audit_project.py:detect_model_version 同口径（三段，逐段降级）：
//   ① 【模型版本】声明位（单字段，最可信）
//   ② 【三锁】模型=X（组合行，包首常见）
//   ③ 全文型号串（取最早出现的那一个）
// 三段都必须先认 H3 Max 再认 H3（否则「H3 Max」被 H3 吃掉，5s 下限永不生效 —— 审查报告 MA-4）。
// 历史坑（selftest_boundary M1 实测）：①②两段合并成一次全文扫描时，包内两处声明不一致会各认一个
// —— JS 认了【三锁】的 2.5、Python 认了【模型版本】的 2.0，同一份包又回到「两台机结论相反」。
const MODEL_CLASSIFY = [
  ['2.5', /2\.5|seedance\s*2\.5/i],
  ['2.0', /2\.0|seedance\s*2\.0/i],
  ['h3max', /h3\s*max/i],
  ['h3', /h3|minimax/i],
];

function classifyModelToken(s) {
  const t = String(s || '');
  if (!t) return null;
  for (const [key, re] of MODEL_CLASSIFY) if (re.test(t)) return key;
  return null;
}

function detectModel(raw) {
  // ① 包内【模型版本】声明位
  let m = raw.match(/【模型版本】\s*[:：]?\s*([^\n【|｜]+)/);
  let k = classifyModelToken(m && m[1]);
  if (k) return k;
  // ② 【三锁】模型=X
  m = raw.match(/【三锁】[^\n]*?模型\s*[=＝:：]\s*([^\n|｜【]+)/);
  k = classifyModelToken(m && m[1]);
  if (k) return k;
  // ③ 全文型号串：一次匹配取最早出现者（与 audit_project.py 的 re.search 同行为）
  m = raw.match(/seedance\s*2\.5|seedance\s*2\.0|minimax[\s-]*h3\s*max|h3\s*max|minimax[\s-]*h3|\bh3\b/i);
  return m ? classifyModelToken(m[0]) : null;
}

/**
 * 解析本次校验用哪一档硬参数。
 * @param {string} raw 提示词包原文
 * @param {string} modelArg --model 取值：auto（默认）/ 2.5 / 2.0 / h3 / h3max
 * @returns {{key: string|null, limit: object, declared: boolean, via: string}}
 *   declared=false 表示判据来自兜底（15s）—— 报告里必须写出来，否则「15s 上限」成了无主判据。
 */
function resolveModel(raw, modelArg) {
  const arg = String(modelArg || 'auto').trim().toLowerCase();
  if (arg !== 'auto') {
    if (MODEL_LIMITS[arg]) return { key: arg, limit: MODEL_LIMITS[arg], declared: true, via: `--model ${arg}` };
    return { key: null, limit: FALLBACK_LIMIT, declared: false, via: `--model ${arg} 不是已知型号，已忽略` };
  }
  const k = detectModel(raw);
  if (k) return { key: k, limit: MODEL_LIMITS[k], declared: true, via: '包内声明' };
  return { key: null, limit: FALLBACK_LIMIT, declared: false, via: '包内未声明【模型版本】/【三锁】模型=' };
}

// ---------------------------------------------------------------- 配置

// 运镜原语群：不同群混用会导致模型抖动/扭曲
// ⚠️ v5.18.1 修两处假红（茅山道士批 1 实战挖出，两处都把「人物动作」误判成「运镜原语」）：
//   ① handheld 的「手持」会吃进「右手持剑 / 左手托它颁敕」——那句是台词里的人在拿东西，
//      不是摄影机的手持。加后顾断言排除「左右双两单」+持。
//   ② rotation 的 `摇(镜|摄)?` 因「(镜|摄)?」可选，裸「摇」命中「摇头 / 摇晃 / 摇摆」——
//      那是摇头，不是摇镜。加前瞻断言排除「头晃摆动曳」。
//   两处的共同教训与 audit_project.py 的 _MOVE_SWAY_TAIL 同源：**中文里运镜词与日常动词同形**，
//   判据必须看紧邻字，不能只看词本身。
// ⚠️ v5.43.0 再修三处（外部审计复验 + 黄金样例 A2 实测挖出，同一教训的延续）：
//   ③ translation 的「推(进|近|镜)?」后缀可选 → 裸「推」命中「门板被推开 / 推辞 / 推倒」——
//      那是人物动作，不是推镜。改为必须带进/近/镜/轨后缀，另收「快推」；「剧情推进」加后顾断言排除。
//   ④ rotation 的「摇(?!…)(镜|摄)?」与 crane 的「摇臂」双重计数——同一个「摇臂」同时命中
//      rotation（臂不在排除类）与 crane，写摇臂必报 E-MULTI-CAMERA，而 分镜配额与机检规范 Q11
//      明确允许「摇臂 ≤2」。规则允许、门禁罚，属判据自相矛盾。改为摇必须**后跟镜/摄**才算 rotation
//      （摇头/摇晃/摇臂/摇篮自然出局），并显式补「横摇 / 竖摇」防漏。
//   ⑤ handheld 的「手持」「肩扛」零后缀断言 → 「她手持火把 / 肩扛着包」被算成摄影机手持。
//      改为必须后跟摄影机语境字（晃/跟/镜/拍/摄/感/稳/台）。**后瞻断言比排除类可维护：
//      日常动词无穷尽，摄影机语境字有限**——这是 v5.18.1 排除类路线的方向修正。
const CAMERA_GROUPS = {
  translation: /\b(dolly|truck|pedestal)\b|(?<![剧情节事])推(进|近|镜|轨)|快推|后拉|拉远|水平(推进|移动)|横移|缓推|缓拉|向前推|向后拉/gi,
  rotation: /\b(pan|tilt|roll)\b|摇(?=镜|摄)|横摇|竖摇|俯仰|左右摇|水平右摇|水平左摇|上摇|下摇/gi,
  lens: /\b(zoom|rack focus|pull focus)\b|变焦|拉焦|焦点(变换|转移)/gi,
  orbit: /\b(orbit|arc)\b|环绕|弧(形)?移|绕(行|拍)/gi,
  crane: /\b(crane|boom)\b|升降(镜)?|摇臂/gi,
  handheld: /(?<![左右双两单])手持(?=[晃跟镜拍摄感稳台])|肩扛(?=[摄镜拍])|\bhandheld\b|\bsteadicam\b/gi,
};

// 容器参数：不得出现在提示词正文
const PARAM_PATTERNS = [
  { re: /\b4K\b|3840\s*[×x]\s*2160/gi, name: '分辨率 4K' },
  { re: /\b(1080p|720p|2K|8K)\b/gi, name: '分辨率' },
  { re: /\b16:9\b|\b9:16\b|\b2\.39:1\b|\b1:1\b|\b4:3\b/g, name: '画幅比' },
  { re: /\b\d{2,3}\s*fps\b/gi, name: '帧率 fps' },
  { re: /\bf\/\d(\.\d)?\b/g, name: '光圈 f值' },
  { re: /\b\d{2,3}\s*mm\b/gi, name: '焦段 mm' },
  { re: /时长\s*\d+\s*秒/g, name: '时长' },
  { re: /\b\d{4}K\b/gi, name: '色温 K' },
];

// 否定式标记词：只应出现在 Must not 行，不得出现在正文
const NEGATION_PATTERNS = [
  { re: /零[一-龥]{1,6}/g, name: '「零XX」排除式' },
  { re: /禁止|不得|不允许|避免出现|切勿/g, name: '禁止式措辞' },
  { re: /\bno\s+\w+|\bdo\s+not\b|\bwithout\b/gi, name: '英文否定式' },
];

// 限定式（允许出现在正文）：告诉模型"只画什么"，不是"不要画什么"
const LIMITER_OK = /仅[一-龥]{1,10}|只(有|含|露|现|留)[一-龥]{0,8}/;

// slop 词黑名单
const SLOP_WORDS = [
  '电影感', '高级感', '氛围感', '大片感', '质感拉满', '细节丰富', '极其',
  '非常', '十分', '惊心动魄', '引人深思', '深刻揭露', '耐人寻味', '无不体现',
  '震撼', '完美呈现', '精妙绝伦', '美轮美奂', '栩栩如生', '惟妙惟肖',
  '超高', '极致', '顶级', '一流', '卓越', '绝佳',
  'cinematic masterpiece', 'stunning', 'breathtaking', 'hyper-detailed',
  'ultra-realistic', 'award-winning', '8k masterpiece', 'best quality',
];

// 时长 → 段数带宽（硬参数由 limit 给，不再写死 30 / 20）
// 2.5 面单条上限 30s、放行线 20s（sd25-pe 官方口径）；>20s 为放行线（v5.19.0 三条件放行制，
// 权威：references/长段放行与段缝成本对账.md）——不是平铺红线，循环的病根是节拍供给 +
// 停止语义，不是时长数字。
// v5.37.1：cap/soft 从 MODEL_LIMITS 传入 —— 2.0 / H3 面没有「20s 放行线」这回事（上限就是 15s），
// 旧实现按 2.5 的带宽判它们，等于给 2.0 面签发了一张不存在的 30s 通行证。
function beatBand(dur, limit = MODEL_LIMITS['2.5']) {
  const cap = limit.cap;
  const soft = Math.min(limit.soft, cap);   // 上限比放行线还严时（理论上不该有）以 cap 为准
  if (dur <= 4) return { min: 1, max: 1, label: '2-4s：单一动作，不分段', hard: false, softLine: false };
  if (dur <= 9) return { min: 2, max: 3, label: '5-9s：2-3 段', hard: false, softLine: false };
  if (dur <= soft) return { min: 3, max: 5, label: `10-${soft}s：3-5 段`, hard: false, softLine: false };
  if (dur <= cap) {
    return {
      min: 4,
      max: 6,
      label: `${soft + 1}-${cap}s：4-6 段（长段放行线：需【长段声明】+ 末拍收束定格）`,
      hard: false,
      softLine: true,
    };
  }
  return {
    min: -1,
    max: -1,
    label: `${cap}s+：超出${limit.label}单条硬上限，强制滑窗拆分（每窗 ≤${soft}s）`,
    hard: true,
    softLine: false,
  };
}

// ---------------------------------------------------------------- 解析

function parseSegments(lines) {
  const segs = [];
  // 起止时间统一支持三种写法：小数秒（0-3.5s）、秒（0-7s）、分:秒（00:00-00:07）
  // v4.7.3：志怪剧本实战暴露——原正则只吃整数秒，「3.5-7s」整段头不被识别，
  // 直接误报 E-TIMELINE-START/END。H3 面切点是 MM:SS.mmm，Seedance 面同样允许小数秒。
  const T = String.raw`(\d{1,2}(?:\.\d+)?)(?::(\d{2}))?`;
  const patterns = [
    // 国内面：【时间轴】0-7s： / 【时间轴】00:00-00:07：
    { re: new RegExp(`^【时间轴】\\s*${T}\\s*[-–~]\\s*${T}\\s*s?\\s*[：:]`), kind: 'cn' },
    // 国际面：Shot 1 (0-7s): / Shot 1 (00:00-00:07):
    { re: new RegExp(`^Shot\\s*\\d+\\s*\\(\\s*${T}\\s*[-–~]\\s*${T}\\s*s?\\s*\\)`, 'i'), kind: 'intl' },
    // 旧格式（已废弃，仅用于检测旧稿）：0:00-0:07 · 第X段 ·
    { re: /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*·/, kind: 'legacy' },
    // v5.37.1：无前缀裸位时间轴（`时间线分镜：` 段下的 `0-4s 全景 · …`）。
    // 这是 examples/ 里 build_sample.py 实际产出的写法（黄金样例 A2 / 实战_梦中人），
    // 此前三条正则都不认 → 全包「段数 0」→ 时间轴门禁静默跳过。补这一条让它进得来。
    { re: new RegExp(`^\\s*${T}\\s*[-–~]\\s*${T}\\s*s(?![\\d\\.])`), kind: 'cn-bare' },
    // v5.37.1：Seedance 2.0 面镜头编号骨架（`镜头1：全景，固定机位。…`）。
    // 2.0 官方按事件序响应镜头编号、**不响应秒级时间戳**（SKILL.md Step 3「2.0 面的段头结构同步切换」：
    // 字节 2.5 指南 82379/2607689 明列两条线差异——2.0 响应镜头编号，整秒时间戳是新线 2.5 的能力），
    // 所以这类段天生没有时间范围：start/end 记 null，由后续判据改用「编号连续性」，不套用 E-TIMELINE-*。
    // 此前不认 → 2.0 面整包「段数 0」→ 时间轴 / 运镜原语 / 节拍密度三组门禁全部静默跳过（审查报告 MA-2）。
    { re: /^镜头\s*(\d+)\s*[：:｜|]/, kind: 'cn-shot', timed: false },
  ];

  lines.forEach((line, idx) => {
    for (const p of patterns) {
      const m = line.match(p.re);
      if (!m) continue;
      // 无时间戳骨架：只记编号，时间字段保持 null（不是 0 —— 0 会被 GAP/END 判成真空隙）
      if (p.timed === false) {
        segs.push({ line: idx + 1, start: null, end: null, num: Number(m[1]), text: line, kind: p.kind });
        break;
      }
      // 统一按秒解析：(mm):(ss) 或 (ss)
      const toSec = (a, b) => (b !== undefined ? Number(a) * 60 + Number(b) : Number(a)); // Number 天然吃小数
      const start = toSec(m[1], m[2]);
      const end = toSec(m[3], m[4]);
      segs.push({ line: idx + 1, start, end, text: line, kind: p.kind });
      break;
    }
  });
  return segs;
}

/**
 * 提取台词。2.5 面（sd25-pe）台词用 {}，liqi 原格式用「」：
 *   liqi   ：查验员乙开口对白（平稳专业）：「请配合前往人身查验室。」
 *   2.5 面 ：查验员乙（平稳专业，使用普通话）：{请配合前往人身查验室。}
 *   资产名 ：锚「主要角色」图 / 介于「骨簪」的惨白与「瓷盒」的温润之间
 *
 * 判据：台词行必然带「说话人 + 语气/形式括注」或显式对白标记。
 * 只从这类行里取引号内容，资产图名行自然被排除。
 */
// v4.7.3：志怪剧本实战暴露——「低声：」「厉声：」「沉声：」这类「副词+冒号」引台词极常见，
// 原表只认括注与特定词，导致时间轴段内台词不被提取，误报 E-DIALOGUE-MISSING-IN-TIMELINE。
const DIALOGUE_MARK = /(（[^）]{2,}）\s*[：:]?\s*$)|对白|心声|旁白|开口|说出|说道|念白|台词|内心独白|(低声|轻声|厉声|沉声|高声|大声|喊道|喝道|吼|哑声|颤声|喃喃|自语|默念)\s*[：:]/;

function extractQuoted(text) {
  const out = [];
  const re = /[「{]([^」}]*)[」}]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1].trim();
    if (!inner) continue;
    // 前方 60 字符的窗口：兼容「对白标记」与引号被换行隔开的情况
    const before = text.slice(Math.max(0, m.index - 60), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 6);
    // 资产图名排除：后方紧跟 图/之间/的/质感，且前方无对白标记
    if (/^[图之间与的质感]/.test(after) && !DIALOGUE_MARK.test(before)) continue;
    // 归一化空白：同一句台词在两处可能因排版折行不同，比较时忽略所有空白
    if (DIALOGUE_MARK.test(before)) out.push(inner.replace(/\s+/gu, ''));
  }
  return out;
}

function splitBlocks(lines) {
  // 镜块标题：行首「镜 N｜」，必须有全角竖线分隔符才算标题。
  // 注：早期正则只要求 ^镜\s*\d，会把「镜 5 收前半段…」这类说明行误判成镜块——
  //     该说明行原本以 > 引用开头所以没暴露，生成文件去掉 Markdown 符号后就出事了。
  //     加 ｜ 要求后可区分。文档层标题不再依赖 # 前缀（生成文件已去 Markdown 符号）。
  const idxs = [];
  lines.forEach((l, i) => {
    if (l.includes('→')) return;                 // 转场注记：镜X（场景）→ 镜X+1
    // 镜块（镜 N｜）与 2.5 面整合段（段 N｜）均按块标题切分
    // 段号可带子编号（段 20A｜/段 20b｜）：30 秒整合段再拆成 10 秒片段后仍按块独立校验
    if (/^(?:镜|段)\s*\d+[A-Za-z]?\s*｜/.test(l)) idxs.push(i);
  });
  if (idxs.length === 0) return [{ start: 0, end: lines.length, lines }];
  // 分隔线与代码块围栏是块的自然边界，避免文末的对照示例被并入最后一个镜块
  const isDocHeading = (l) => /^-{3,}\s*$/.test(l) || /^```/.test(l);
  const blocks = [];
  idxs.forEach((s, k) => {
    let e = k + 1 < idxs.length ? idxs[k + 1] : lines.length;
    for (let i = s + 1; i < e; i++) {
      if (isDocHeading(lines[i])) { e = i; break; }
    }
    blocks.push({ start: s, end: e, lines: lines.slice(s, e) });
  });
  return blocks;
}

function sliceSection(blockLines, startRe, endRes) {
  let s = -1;
  for (let i = 0; i < blockLines.length; i++) {
    if (startRe.test(blockLines[i])) { s = i; break; }
  }
  if (s === -1) return null;
  let e = blockLines.length;
  for (let i = s + 1; i < blockLines.length; i++) {
    if (endRes.some((r) => r.test(blockLines[i]))) { e = i; break; }
  }
  return { text: blockLines.slice(s, e).join('\n'), startLine: s, endLine: e };
}

// ---------------------------------------------------------------- 长度尺（v4.7.6）

// 正文边界与字数额度抽成共用函数：门禁（W-LENGTH-CAP）与 --len 明细必须同一把尺，
// 否则会出现「门说超了 8 字、明细说没超」这种两把尺子的经典事故。
const BODY_END_RES = [
  /^Must\s*not/i,
  /^(?:#|【参数】)\s*(duration|ratio|输出规格|后期)/i,
  /^——\s*以下不进正文/,
  /^技术规格[：:]/,
];

function bodyEndOf(lines) {
  for (let i = 1; i < lines.length; i++) {
    if (BODY_END_RES.some((r) => r.test(lines[i]))) return i;
  }
  return lines.length;
}

function capOf(lines, bodyEnd) {
  const isMerged = /整合/.test(lines[0] || '');
  const hasRefImg = /@图片\s*\d+|参考图|锚「/.test(lines.slice(0, bodyEnd).join('\n'));
  // 🔴 时长因子（v5.41.1 新增）。800/1000 是「单镜」额度，按 15 秒定的**社区实测经验值**，
  //   不是平台硬限制（另一端是官方 API 的中文 ≤500 字，量级不同，交付前另核）。
  //   ⚠️ v5.44.0：该 500 字**未获官方原文证实**——核过火山方舟两页均未提字数限制。
  //   本脚本按 warn 级 opt-in 处理（默认关闭），与文档「硬门禁」的措辞不一致，以本注释为准：别当阻断依据。
  //   25–30s 长段（2.5 面三条件放行档）信息量约为 15 秒段的两倍，沿用单镜额度必报
  //   W-LENGTH-CAP 且删无可删——额度表里原本就没有这个时长档。
  //   处理：按时长线性放大，**15 秒及以下仍取原值**（不放松既有标准）。
  const header = lines[0] || '';
  let dur = 15;
  const mHead = /[（(]\s*(\d+(?:\.\d+)?)\s*s\s*[)）]/.exec(header);
  if (mHead) dur = parseFloat(mHead[1]);
  else {
    const mDur = /duration\s*[：:]\s*(\d+(?:\.\d+)?)\s*s/i.exec(lines.slice(0, bodyEnd).join('\n'));
    if (mDur) dur = parseFloat(mDur[1]);
  }
  const durFactor = Math.max(1, dur / 15);
  const base = hasRefImg ? 800 : 1000;
  const cap = isMerged ? 4800 : Math.round(base * durFactor);
  const suffix = durFactor > 1 ? ' × ' + String(dur) + 's/15s' : '';
  const capLabel = (isMerged ? '整合镜'
    : (hasRefImg ? '单镜·I2V（有参考图）' : '单镜·T2V（无参考图）')) + suffix;
  return { isMerged, hasRefImg, cap, capLabel, dur };
}

// 节名识别：行首 2–12 个汉字/字母 + 冒号，如「站位：」「时间线分镜：」「声音设计：」。
// 台词行「甲（低声）：…」冒号前是「）」，落不进这个类，不会误判成新节。
const SEC_RE = /^\s*([一-龥A-Za-z]{2,12})\s*[：:]/;

const CJK_RE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u3000-\u303F]/;
const dispW = (s) => [...s].reduce((n, c) => n + (CJK_RE.test(c) ? 2 : 1), 0);
const padTo = (s, n) => s + ' '.repeat(Math.max(0, n - dispW(s)));
const clipTo = (s, n) => {
  let w = 0; let out = '';
  for (const c of s) { w += dispW(c); if (w > n) return out + '…'; out += c; }
  return out;
};

/**
 * 单镜长度明细：把「总数超了」落到「哪几节、哪几行超了」。
 * 删字不再靠猜——这是封测里连踩三次的坑，每次都要临时写量尺脚本。
 */
function lenDetail(block) {
  const lines = block.lines;
  const bodyEnd = bodyEndOf(lines);
  const { cap, capLabel } = capOf(lines, bodyEnd);
  const total = lines.slice(0, bodyEnd).join('\n').trim().length;

  const rows = [];
  let sec = '(段头)';
  for (let i = 0; i < bodyEnd; i++) {
    const t = lines[i];
    const m = t.match(SEC_RE);
    if (m) sec = m[1];
    const len = t.trim().length;
    if (len > 0) rows.push({ line: block.start + i + 1, sec, len, text: t.trim() });
  }
  const secSum = new Map();
  for (const r of rows) secSum.set(r.sec, (secSum.get(r.sec) || 0) + r.len);

  return {
    title: (lines[0] || '(无标题)').trim(),
    cap, capLabel, total,
    over: total - cap,
    sections: [...secSum.entries()].sort((a, b) => b[1] - a[1]),
    rows: rows.slice().sort((a, b) => b.len - a.len),
  };
}

// ---------------------------------------------------------------- 检查

// v5.37.1 新增：包级【段缝声明】取值（由 collectIssues 在遍历镜块前填入）。
// null = 包内未声明段缝方式；否则为 ①/②/③/④（兼容 1~4 数字写法）。
let PKG_SEAM_MODE = null;

// v6.14.0：包级【节奏档位】声明（opt-in，来源 script-writing-studio-v2 节奏档位——机制参考零拷贝）。
// 档位**不改任何阈值**（21e 的三档景别判据有生成物理依据，不因档位放宽）；它做三件事：
// ① 写镜时的节拍密度预算锚（四档各配预算，见写镜细则节奏档位节）；
// ② W-SHOT-MULTI-SCALE 命中时的文案语境（高密度档的正解是多拆镜号，不是并进一镜）；
// ③ 复盘归因与门效统计的分组维度（N20）。
const PACE_TIERS = ['电影感中速', '短视频中高密度', '高密度动作或强钩子', '慢节奏但高信息'];
let PKG_PACE_TIER = null;

function checkBlock(block, surface, issues, model = { key: '2.5', limit: MODEL_LIMITS['2.5'], declared: true }) {
  const lines = block.lines;
  const text = lines.join('\n');
  const title = lines[0] || '(无标题)';

  const durMatch = title.match(/（\s*([\d]+)\s*s/);
  const duration = durMatch ? Number(durMatch[1]) : null;

  // 正文边界：到 Must not / 参数行 / 分隔线 为止（与 lenDetail 共用 BODY_END_RES）
  const bodyEnd = bodyEndOf(lines);
  const body = lines.slice(0, bodyEnd).join('\n');
  // 台词是角色说的话，不是给模型的指令：否定式与 slop 检测都要跳过引号内容
  // （「」= liqi 原格式，{} = 2.5 面台词），否则会误报剧本原文里的正常措辞
  const bodyNoDialogue = body.replace(/[「{][^」}]*[」}]/g, '「」');
  const bodyLineOffset = block.start;

  const add = (code, msg, hint) =>
    issues.push({ level: 'error', code, msg, where: title.trim(), hint });
  const warn = (code, msg, hint) =>
    issues.push({ level: 'warn', code, msg, where: title.trim(), hint });

  // --- 1. 时间轴连续性
  const segs = parseSegments(lines);
  if (segs.length > 0) {
    // v5.37.1：段分两类 —— 有秒级时间范围（cn / cn-bare / intl / legacy）与只有镜头编号（cn-shot）。
    // E-TIMELINE-START/END/GAP 的判据是「秒」，对编号段不成立（null 参与比较会造出假缺口），
    // 所以整组只在**全部段都有时间**时跑；编号段改跑编号连续性。
    const timedCount = segs.filter((s) => s.start !== null && s.end !== null).length;
    const allTimed = timedCount === segs.length;
    const anyTimed = timedCount > 0;

    if (allTimed) {
      if (duration !== null) {
        if (segs[0].start !== 0) {
          add('E-TIMELINE-START', `首段起始为 ${segs[0].start}s，应为 0s`, '第 ' + (bodyLineOffset + segs[0].line) + ' 行');
        }
        if (segs[segs.length - 1].end !== duration) {
          add('E-TIMELINE-END', `末段结束于 ${segs[segs.length - 1].end}s，镜长为 ${duration}s（不吻合）`,
            '第 ' + (bodyLineOffset + segs[segs.length - 1].line) + ' 行');
        }
      }
      for (let i = 1; i < segs.length; i++) {
        if (segs[i].start !== segs[i - 1].end) {
          add('E-TIMELINE-GAP', `第 ${i} 段与第 ${i + 1} 段之间时间轴断裂：${segs[i - 1].end}s → ${segs[i].start}s`,
            '段间不得有空隙或重叠');
        }
      }
    }
    // 编号段（2.0 面）：编号必须 1..N 递增。模型按事件序响应镜头编号，跳号/重号会让它数错事件。
    // 这里只报 WARN —— 编号是序号不是契约，写错不至于生成失败，但会让「第 N 个事件」指代模糊。
    if (!anyTimed) {
      const nums = segs.map((s) => s.num).filter((n) => Number.isFinite(n));
      const bad = [];
      for (let i = 0; i < nums.length; i++) if (nums[i] !== i + 1) bad.push(`${i + 1}→${nums[i]}`);
      if (bad.length > 0) {
        warn('W-SHOTNUM-SEQUENCE', `镜头编号不是 1..N 递增：${bad.slice(0, 4).join('，')}${bad.length > 4 ? ' 等' : ''}`,
          '重排为 镜头1 / 镜头2 / 镜头3…；2.0 面按事件序响应编号，跳号会让「第几个事件」指代不清');
      }
    }
    // 骨架混用检测
    const kinds = new Set(segs.map((s) => s.kind));
    if (kinds.size > 1) {
      add('E-SKELETON-MIX', `段头骨架混用：${[...kinds].join(' + ')}`,
        '同一提示词内只能用一套骨架：国内面【时间轴】0-7s： / 无前缀裸位 0-7s / Seedance 2.0 面 镜头1： / 国际面 Shot 1 (0-7s):');
    }
    // v5.37.1：cn-bare（无前缀裸位）与 cn-shot（2.0 面镜头编号）同属国内投放写法，
    // 不该判成「与国内面不符」——前者是 2.5 面的裸位变体，后者是 2.0 面的唯一写法。
    if (surface === 'cn' && !['cn', 'cn-bare', 'cn-shot'].includes(segs[0].kind)) {
      warn('W-SURFACE-MISMATCH', '指定国内面但段头非【时间轴】骨架', '国内面应改用【时间轴】0-7s：画面｜镜头｜音效');
    }
    if (surface === 'intl' && segs[0].kind !== 'intl') {
      warn('W-SURFACE-MISMATCH', '指定国际面但段头非 Shot N 骨架', '国际面应改用 Shot 1 (0-7s): 形式');
    }

    // 骨架 ↔ 锁①型号 的匹配（v5.37.1 · 此前完全没有机检，SKILL.md 只是「写着」）：
    //   2.0 面不响应秒级时间戳 → 用【时间轴】骨架是逆着官方行为写，强制时长可能产生异常输出；
    //   2.5 面的时长预算与节拍密度都建立在秒级段头上 → 用镜头编号骨架等于放弃了这套核算。
    const modelKey = model.key;
    if (modelKey === '2.0' && anyTimed) {
      warn('W-SKELETON-MODEL-MISMATCH', '锁①=Seedance 2.0，但段头用了秒级时间轴骨架',
        '2.0 官方按事件序响应镜头编号、不响应秒级时间戳 → 改用「镜头1：全景，固定机位。…」骨架；'
        + '秒只作内部预算，写进行为描述（如「停一拍的工夫」），不写 0-3s');
    } else if (modelKey === '2.5' && !anyTimed) {
      warn('W-SKELETON-MODEL-MISMATCH', '锁①=Seedance 2.5，但段头只有镜头编号、没有时间范围',
        '2.5 面用【时间轴】0-7s：骨架才能核算时长预算与节拍密度；若本包确为 2.0 面，改【模型版本】：2.0 或加 --model 2.0');
    }

    // 每段运镜原语混用
    for (const s of segs) {
      const groups = [];
      for (const [g, re] of Object.entries(CAMERA_GROUPS)) {
        const hits = s.text.match(re);
        if (hits && hits.length > 0) groups.push(`${g}(${hits.length})`);
      }
      if (groups.length > 1) {
        add('E-MULTI-CAMERA', `单段出现多个运镜原语群：${groups.join(' + ')}`,
          `第 ${bodyLineOffset + s.line} 行 —— 一段只留一个主运镜，其余拆段`);
      }
    }
  } else {
    // v5.37.1 假绿防线（对应「段数 0」）：本块明明写了像段头的东西，却一个段都没解析出来 →
    // 上面这一整组时间轴门禁是**静默跳过**的，包会显示全绿。这不是通过，必须出声。
    // 只对「疑似有分段意图」的块报警，避免对无时间轴的资产块造成噪声。
    const looksLikeSegment = lines.some((l) =>
      /^\s*#{0,6}\s*(?:镜头|Shot|Scene)\s*\d+\s*[：:｜|(（]/.test(l) ||
      /【时间轴】/.test(l) ||
      /^\s*\d{1,2}(?:\.\d+)?\s*[-–~]\s*\d{1,2}(?:\.\d+)?\s*s\s*[：:]/.test(l));
    if (looksLikeSegment) {
      warn(
        'W-EMPTY-TIMELINE',
        '本块有疑似段头但解析不出任何时间轴段：时间轴连续性 / 运镜原语 / 节拍密度等门禁本次跳过——这不是通过',
        '核对段头骨架与投放面是否匹配：【时间轴】0-7s：（国内面·2.5）/ Shot 1 (0-7s):（国际面）/ 镜头1：（Seedance 2.0 面）；'
        + '若骨架写成了本机不认的形式，上述门禁等于没查，请人工复核一遍时间轴');
    }
  }

  // --- 2. 段数带宽
  if (duration !== null) {
    const lim = model.limit || MODEL_LIMITS['2.5'];
    const band = beatBand(duration, lim);
    // 判据出处必须写在消息里：数字来自哪一台机器、哪一份声明，出红时才知道该改哪里。
    // 兜底档（包内未声明模型）尤其要说清楚，否则「15s 上限」看起来像凭空冒出来的。
    const lockTag = model.key
      ? `锁①=${model.key}`
      : `锁①未声明，按最严 ${lim.cap}s 兜底`;
    const passLine = Math.min(lim.soft, lim.cap);
    if (band.hard) {
      add('E-OVER-30S', `单提示词 ${duration}s 超出${lim.label}单条硬上限 ${lim.cap}s（${lockTag}）`,
        `强制滑窗拆分，每窗 ≤${passLine}s（本镜 ${duration}s → 约 ${Math.ceil(duration / passLine)} 窗）；`
        + '若型号声明写错了，补【模型版本】：X 或加 --model 重跑');
    } else {
      // v5.19.0 三条件放行制（权威：references/长段放行与段缝成本对账.md）：
      // >放行线不再是一刀切。三条件齐（A 声明 / B 密度 / C 收束）→ 零输出
      // （liqi 无 info 级文化）；缺任一 → W-OVER-20S 点名缺哪条。
      if (band.softLine) {
        const declared = /【长段声明】/.test(text);
        const dense = segs.length >= band.min;
        const lastSeg = segs.length ? segs[segs.length - 1].text : '';
        const tailOk = /定格|完全静止|保持该姿态/.test(lastSeg);
        if (!(declared && dense && tailOk)) {
          const missing = [];
          if (!declared) missing.push('段头未写【长段声明】Ns · 节拍 N · 收束：末1s定格');
          if (!dense) missing.push(`时间轴只有 ${segs.length} 段（${passLine + 1}-${lim.cap}s 需 ≥${band.min} 段独立节拍）`);
          if (!tailOk) missing.push('末拍无收束结构（收束窗 + 「动作完全静止、画面定格」措辞）');
          warn('W-OVER-20S', `${duration}s 越过 ${passLine}s 放行线（${lockTag}）：${missing.join('；')}`,
            `补齐三条件放行（密度不足先补节拍、末拍补可见终态收束），或走滑窗拆分每窗 ≤${passLine}s——不要为「保险」把长段拆成碎段`);
        }
      }
      if (segs.length > band.max) {
        warn('W-BEAT-BUDGET', `${duration}s 分了 ${segs.length} 段，超出上限（推荐 ${band.label}）`,
          '段数过多会导致动作被压缩或跳过');
      } else if (band.softLine && segs.length < band.min) {
        // v5.19.0 补下限分支（旧逻辑只查上限与「只有 1 段」两档）：长段段数 <4 =
        // 长段节拍供给不足——「后半段循环凑」的第一病根。与 W-OVER-20S 各报各的：
        // 那个点名缺哪条放行条件，这个点名密度本身不够。
        warn('W-BEAT-BUDGET', `${duration}s 只有 ${segs.length} 段，长段节拍供给不足（${passLine + 1}-${lim.cap}s 需 ${band.min}-${band.max} 段）`,
          '每段一个独立主动作；补不齐就拆段，拆完按段缝对账表选拆法');
      } else if (duration >= 10 && segs.length === 1) {
        // 注：≤9s 的单段是合法的——单一连续动作应在一个段落里按顺序叙述，
        // 强行标号反而会给连续镜头制造切点。10s 以上才要求内部结构。
        warn('W-BEAT-BUDGET', `${duration}s 只有 1 段，缺少内部结构（推荐 ${band.label}）`,
          '10s 以上应有多个节拍；若本镜确为单一连续动作，可忽略');
      }
    }
  }

  // --- 3. 容器参数污染
  for (const p of PARAM_PATTERNS) {
    const m = body.match(p.re);
    if (m) {
      add('E-PARAM-IN-BODY', `正文出现容器参数「${m[0]}」（${p.name}）`, '容器参数移出正文，写入 # 参数行');
    }
  }

  // --- 4. 否定式表述污染正文（跳过台词）
  for (const p of NEGATION_PATTERNS) {
    const m = bodyNoDialogue.match(p.re);
    if (m) {
      // 若该行同时是限定式表达（"仅…"），视为可接受
      const src = bodyNoDialogue;
      const linesHit = src.split('\n').filter((l) => p.re.test(l) && l.includes(m[0]));
      const allLimiter = linesHit.length > 0 && linesHit.every((l) => LIMITER_OK.test(l));
      if (!allLimiter) {
        // v5.44.0 降级：E- → W-。核官方原文后，原判据的前提不成立——
        // ① 火山方舟《Doubao Seedance 2.5 提示词指南》82379/2607689 设「负向控制」专章，
        //    负向写法是官方推荐的提示词手段之一，不是模型读不懂的东西；
        // ② 但同页「字幕约束不生效」案例写明：提示词写了「不要字幕」仍可能出现字幕，
        //    「目前无法完全避免」——即负向控制**支持但不保证生效**。
        // 所以纪律保留（集中到 Must not 行便于定位与复检、避免排除式稀释正向描述），
        // 但理由从「模型对否定不敏感」改为「不保证生效 + 可维护性」，级别从阻断降为建议。
        // 注意：这里必须是 warn() 不是 add()——add() 是 error 级。码名前缀与 level 必须一致，
        // 否则 check_skill 的码号对照与自测的 expectError 都会失准（本库踩过同型坑）。
        warn('W-NEGATION-IN-BODY', `正文出现${p.name}：「${m[0]}」`,
          '官方支持负向控制但不保证生效（官方字幕案例：写了「不要字幕」仍可能出现）。仍建议正向锁定为主、否定式只留 Must not 行——便于定位与复检，但不阻断交付（v5.44.0 由 E- 降为 W-）');
      }
    }
  }

  // --- 5. 台词三写一致性（机械只校时间线 + 声音设计两处；镜行尾行内 `台词：` 无机械兜底，人工核）
  // 2.5 面（sd25-pe）的时间线在【事件脚本】段内，与 liqi 原格式的「时间线分镜」等价
  const tlSec = sliceSection(lines, /时间线分镜|^时间线[：:]|多镜时间线|^【事件脚本】/, [/^声音设计/, /^刚性约束/, /^Must\s*not/i, /^(?:#|【参数】)\s*(duration|ratio)/i, /^——\s*以下不进正文/, /^【保持一致】/]);
  const sdSec = sliceSection(lines, /^声音设计/, [/^刚性约束/, /^Must\s*not/i, /^(?:#|【参数】)\s*(duration|ratio)/i, /^——\s*以下不进正文/]);
  if (tlSec && sdSec) {
    const a = extractQuoted(tlSec.text);
    const b = extractQuoted(sdSec.text);
    for (const line of a) if (!b.includes(line)) {
      add('E-DIALOGUE-MISSING-IN-SOUND', `台词只见于时间线，声音设计缺失：「${line}」`, '台词必须三写且逐字一致（时间线段内 + 镜行尾 + 声音设计对白行）');
    }
    for (const line of b) if (!a.includes(line)) {
      add('E-DIALOGUE-MISSING-IN-TIMELINE', `台词只见于声音设计，时间线缺失：「${line}」`, '台词必须三写且逐字一致（时间线段内 + 镜行尾 + 声音设计对白行）');
    }
  } else if (extractQuoted(text).length > 0) {
    if (!tlSec) add('E-SECTION-MISSING', '存在台词但缺少「时间线分镜」小节', '台词须在时间线对应段内出现一次');
    if (!sdSec) add('E-SECTION-MISSING', '存在台词但缺少「声音设计」小节', '台词须在声音设计中出现一次');
  }

  // --- 6. 角色内联锁定（v5.15.3：取数范围从「整体风格段」收紧到「出场人物行」）
  // 旧实现的 sliceSection 从 整体风格 一直吃到 本镜光色基调，**中间把站位行也吞进去了**——
  // 于是只要站位里出现 `@祝翁（…）`，检查就算过（实测：角色描述全删了也不报）。
  // 那是**假过**。v5.15.3 起身份独立成行，取数就取该行；H3 面的【主体与关系】承担等价职责，一并计入。
  // ⚠️ v5.15.3 修掉一处**假过**：旧切片的边界是「本镜光色基调」，而它排在 站位 / 位移 / 轴线 之后——
  // 于是「整体风格段」把**站位行一起吞了**，只要站位里有 `@祝翁（…）`，检查就算过
  // （实测：把角色描述全删光也不报）。现把边界提到 站位，身份只能来自 出场人物行 / 整体风格 / 【主体与关系】。
  // v5.30.0：CAST_STOP 补「本镜保真预算」——第二阶段判据层实测抓到一次**复发**：
  // 保真预算排在 整体风格 与 光色基调 之间，行里常写「次 = 陈默面部」这类人物名，
  // 旧边界截不住它，身份文本把名字漏进来 → 出场人物行整个删掉也不报（v5.15.3 修的
  // 正是同一类「站位行被吞」的假过，换个相邻小节又复发）。
  // 教训：**切片边界要按小节全列表维护，不能只堵当时出事的那一个**。
  const CAST_STOP = [/^出场人物[：:]/, /^站位[：:]/, /^位移[：:]/, /^轴线[：:]/, /^本镜保真预算/,
    /^本镜光色基调/, /^光色基调/, /^时间线/, /^声音设计/, /^刚性约束/, /^【事件脚本】/];
  const castSec = sliceSection(lines, /^出场人物[：:]/, CAST_STOP);
  const styleSec = sliceSection(lines, /^整体风格[：:]/, CAST_STOP);
  const relationSec = sliceSection(lines, /^【主体与关系】/, [/^【事件脚本】/, /^声音设计/, /^刚性约束/, /^【保持一致】/]);
  const identityText = (castSec ? castSec.text : '') + '\n'
    + (styleSec ? styleSec.text : '') + '\n' + (relationSec ? relationSec.text : '');
  const castLine = lines.find((l) => /^场景[：:]/.test(l) && l.includes('人物'));
  if (castLine) {
    const cast = (castLine.split(/人物[：:]/)[1] || '')   // v5.43.0：半角「人物:」不再静默绕过身份门（外部审计实测 x1→x0）
      .split(/[、,，]/)
      .map((s) => s.replace(/（[^）]*）/g, '').trim())   // 去掉「野狗（局部）」的括注
      .filter(Boolean);
    for (const c of cast) {
      if (c && !identityText.includes(c)) {
        add('E-IDENTITY-NOT-INLINE', `人物「${c}」未在「出场人物」行 / 整体风格小节内联锁定`,
          '逐镜会被单独复制，角色外观必须内联。**本项目的正字是单起一行**：'
          + '`出场人物：甲——<外形地标 + 服装主色形制 + 一件随身物>；乙——…`，'
          + '位置在 `生成视频：` 之后、`整体风格：` 之前（见 SKILL.md Step 3 第 5 小节）');
      }
    }
  }

  // --- 7. 刚性约束三段式
  const hasConstraint = lines.some((l) => /^刚性约束|^约束[：:]/.test(l));
  if (hasConstraint) {
    const cText = sliceSection(lines, /^刚性约束|^约束[：:]/, [/^Must\s*not/i, /^(?:#|【参数】)\s*(duration|ratio)/i, /^——\s*以下不进正文/]);
    const t = cText ? cText.text : '';
    if (!/必锁/.test(t)) warn('W-CONSTRAINT-SHAPE', '刚性约束缺少「必锁」栏', '三段式：必锁 / 可见性 / 禁现');
    if (!/可见性/.test(t)) warn('W-CONSTRAINT-SHAPE', '刚性约束缺少「可见性」栏', '出镜对象必须分配可见范围');
  }

  // --- 8. 色彩预算（正向表述：唯一重音色 / 单一色系）
  if (!/重音色|唯一跳色|唯一暖[色晕光]|单一色系/.test(text)) {
    warn('W-COLOR-BUDGET', '未声明色彩预算（唯一重音色 / 单一色系）',
      '不声明色彩预算，模型会自发补饱和度，全片色调会散');
  }

  // --- 9. 保真预算
  if (!/保真预算/.test(text)) {
    warn('W-ALLOCATION-MISSING', '未声明本镜保真预算（主/次/省）', '预算不声明 = 处处平庸');
  }

  // --- 10. slop 计数
  let slopCount = 0;
  const slopHits = new Set();
  for (const w of SLOP_WORDS) {
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const m = body.match(re);
    if (m) { slopCount += m.length; slopHits.add(w); }
  }
  if (slopCount > 0) {
    const level = slopCount >= 5 ? 'error' : 'warn';
    const action = slopCount >= 5 ? '推倒重写（从主体重新往下写）'
      : slopCount >= 3 ? '重写本段'
      : slopCount >= 1 ? '删除并收紧' : '';
    issues.push({
      level, code: slopCount >= 5 ? 'E-SLOP-OVERLOAD' : 'W-SLOP-COUNT',
      msg: `slop 词 ${slopCount} 处：${[...slopHits].join('、')}`,
      where: title.trim(), hint: `处置：${action}`,
    });
  }

  // --- 11. 正文字数上限（v2.0 新增；先 warning，v2.1 转 error）
  // 整合镜（标题含「整合」）按 4800 字符，其余按 800 字。
  // 计数：去首尾空白，标点/空格/换行全部计入，与 SKILL.md Step 3 口径一致。
  // 分场景给额（v2.0 封测修正）：T2V 无参考图时必须全量内联出场对象外观，
  // 比 I2V 多出约 100 字是模板要求的必然结果，不是写作者的冗余。
  // 实测：严格按模板写、零冗余的 T2V 单镜为 899 字符，按旧的统一 800 卡会误报且删无可删。
  const { isMerged, hasRefImg, cap: CAP, capLabel } = capOf(lines, bodyEnd);
  const bodyLen = body.trim().length;
  if (bodyLen > CAP) {
    // 超了就顺手把最长几行点出来（v4.7.6）：以前只报总数，删字全靠猜，封测连踩三次。
    const d = lenDetail(block);
    const top3 = d.rows.slice(0, 3)
      .map((r) => `L${r.line}(${r.len}字)${clipTo(r.text, 18)}`)
      .join('　');
    warn('W-LENGTH-CAP', `可复制正文 ${bodyLen} 字符，超出上限 ${CAP}（${capLabel}）`,
      `最长 3 行 → ${top3}　（--len 看全量明细）。删字顺序：重复风格形容词 → 通用质量词 → 参考图里已有的背景 → 次要运镜 → 次要动作 → 推测性情绪标签。`
      + (hasRefImg ? '' : ' 无参考图时优先压缩内联外观：只留可辨识特征，删掉与动作无关的静态描述。'));
  }

  // --- 12. 上下文污染词（v2.0 新增 · v5.16.0 扩充）
  // 逐镜会被单独投喂，模型看不到上一镜。跨镜指代写进正文等于无效指令。
  // 合法例外：整合段的「接上段（机制）」是同一次生成内部的段间接口，先整行排除再扫。
  // v5.16.0 扩充：吸收 UncleWang CINEDANCE D1「移除清单」的同类词
  // （继续自 / 上一场 / 前一场 / 同前 / 照前——都是把上一镜的信息当已知传给模型）。
  const leakText = bodyNoDialogue
    .split('\n')
    .filter((l) => !/接上(一)?段/.test(l))
    // v6.16.0 · N20：跳过表格行——文末转场注记总表等附表区不进投喂正文，
    // 表格里的「同上/同前」是给人看的状态沿用，不是给模型的跨镜指代。
    // 16x9_30s+2x0 实测 166 行命中中 27% 是附表区假阳性（N20 分类数据）。
    .filter((l) => !l.trim().startsWith('|'))
    .join('\n');
  const LEAK_RE = /仍穿着|与之前相同|如前所述|如上所述|同上|前一镜|上一镜|参考上一镜|接上|继续自|上一场|前一场|同前|照前|照旧|沿用前|沿用镜|见镜\s*\d+|镜\s*\d+\s*的/;
  const leakHit = leakText.match(LEAK_RE);
  if (leakHit) {
    warn('W-CONTEXT-LEAK', `正文出现跨镜指代或继承表述：「${leakHit[0]}」`,
      '改用本镜可见的初始状态描述；滑窗拆分出的窗口之间禁止写接上/继续/仍穿着');
  }

  // --- 13. 内联模式与首帧声明匹配（v2.0 新增）
  // 有首帧图时模型看得到，重复写外观是噪音；没有时看不到，不写就是放任自由发挥。
  const firstFrameDecl = /@图片\s*\d+\s*作为首帧|以参考图\s*\S*\s*为首帧/.test(body);
  if (firstFrameDecl) {
    // 13a 首帧必须补构图 / 主体位置 / 镜头方向
    if (!/构图|主体位置|镜头方向/.test(body)) {
      warn('W-FIRSTFRAME-SHAPE', '声明了首帧，但正文未补该帧的构图 / 主体位置 / 镜头方向',
        '首帧声明后必须另起一句写清这三项，只写「以参考图 X 为首帧参考」视为未锁定');
    }
    // 13b I2V 服装名词：已声明首帧时，服装名词必须与 @图片 / 参考图 / 锚 关联出现
    const GARMENT = /衬衫|外套|夹克|大衣|长袍|西装|裙子|裤子|毛衣|卫衣|风衣|制服|连衣裙/;
    const badGarment = body.split('\n').filter((l) => GARMENT.test(l) && !/@图片|参考图|锚/.test(l));
    if (badGarment.length > 0) {
      warn('W-I2V-GARMENT', '已声明首帧，正文仍出现未与参考图关联的服装名词',
        'I2V 下重复服装名词会让模型用通用服装替换参考图里的实际服装；改为颜色 + 轮廓 + 可辨识特征');
    }
  }

  // --- 14. 拍长纪律（v2.0 补）：首拍 ≥3s，末拍 3-8s
  if (segs.length >= 2) {
    const firstLen = segs[0].end - segs[0].start;
    const lastLen = segs[segs.length - 1].end - segs[segs.length - 1].start;
    if (firstLen > 0 && firstLen < 3) {
      warn('W-BEAT-LENGTH', `首拍仅 ${firstLen}s，短于 3s`, '首拍不短于 3s，否则场景来不及成立');
    }
    // v5.14.0：末拍若是段末接戏全景（档 1~3 全景且 ≤3s），3s 下限豁免——
    // 接戏全景的法定长度是 1 秒（v5.15.0 定，旧 1.5~2s 已废），豁免按 ≤3s 卡
    //（覆盖 1 秒法定值并容忍轻微超写），反过来把前一拍的动作挤没了。
    // 上限 8s 仍有效（>8s 说明末拍塞了别的东西）。
    const lastIsAnchorWide = /大远景|远景|全景/.test(segs[segs.length - 1].text) && lastLen <= 3;
    if (lastLen > 0 && ((!lastIsAnchorWide && lastLen < 3) || lastLen > 8)) {
      warn('W-BEAT-LENGTH', `末拍 ${lastLen}s，不在 3-8s 区间`,
        '<3s 转场来不及成立；>8s 末拍塞了太多动作，模型会丢后半段');
    }
  }

  // --- 15. 台词密度（v2.0 补）：段内台词字数 ÷ 段长
  // 旁白 / 慢板 ≤4.0 字每秒，对白 ≤5.0；>6.5 物理不可实现
  segs.forEach((sg, i) => {
    // v5.18.1 去重：台词三写铁律要求同一句在该段内出现两次（段内 {} + 镜行尾 `台词：{}`），
    // 而两写都落在同一条【时间轴】行上。旧实现直接 join 全部引号内容 → 同一句被数两遍，
    // 密度翻倍，合规排期被判成「物理不可实现」（茅山道士批 1 实测 30 处假红）。
    // 一句台词在一秒内只可能被说一次，去重后才是真实密度。
    const q = [...new Set(extractQuoted(sg.text))];
    if (q.length === 0) return;
    const len = sg.end - sg.start;
    if (len <= 0) return;
    const chars = q.join('').replace(/\s/gu, '').length;
    const d = chars / len;
    if (d > 6.5) {
      warn('W-DIALOGUE-DENSITY', `第 ${i + 1} 段台词密度 ${d.toFixed(1)} 字/秒，物理不可实现`,
        '精简台词或拆段；画面已经演出来的内容，台词就不必再说一遍');
    } else if (d > 5.0) {
      warn('W-DIALOGUE-DENSITY', `第 ${i + 1} 段台词密度 ${d.toFixed(1)} 字/秒，超出对白 5.0 红线`,
        '旁白 / 慢板应 ≤4.0 字/秒，对白 ≤5.0');
    }
  });

  // --- 16. 动作密度（v2.0 补）：分句数（按「；」切）÷ 拍秒数
  segs.forEach((sg, i) => {
    const len = sg.end - sg.start;
    if (len <= 0) return;
    // v5.14.2：段末接戏全景是**静止的站位清单**，不是动作拍——§十三明文「不要求表情与动作」。
    // 它的「四人四件事」按「；」罗列（甲视角；乙视角；剪辑剪掉），会被误算成多动作拍，故整拍豁免。
    // v5.18.1 放宽判据：旧判据只认「接戏全景」四个字，而这条豁免与 W-META-IN-BODY
    //（「正文只放投喂内容，制作注记一律进施工行」）**互相打架**——为满足这一门就得往正文里
    // 塞一个元术语，正是另一门要罚的事。改按**画面特征**判：档 1~3 + 明写静止/保持站位/不再动作，
    // 即接戏全景的本体，不需要靠标签认。
    if (/接戏全景/.test(sg.text)) return;
    if (/大远景|远景|全景/.test(sg.text)
        && /(动作)?(完全)?静止|保持(上一拍的)?(姿态与)?站位|不再动作|不动/.test(sg.text)) return;
    const desc = sg.text
      .replace(/[「{][^」}]*[」}]/gu, '')      // 去台词
      .replace(/｜?\s*镜头[：:].*$/u, '')      // 去镜头栏
      .replace(/｜?\s*音效[：:].*$/u, '');     // 去音效栏
    const clauses = desc.split(/[；;]/u).map((x) => x.trim()).filter(Boolean).length;
    const d = clauses / len;
    if (d > 0.8) {
      warn('W-ACTION-DENSITY', `第 ${i + 1} 段动作密度 ${d.toFixed(2)}，物理不可执行`,
        '一拍只留一个主动作，其余拆拍');
    } else if (d > 0.5) {
      warn('W-ACTION-DENSITY', `第 ${i + 1} 段动作密度 ${d.toFixed(2)}，一镜多动作`,
        '>0.5 即多动作，模型会丢后半段');
    }
  });

  // --- 17. 站位弱词（v2.0 补）
  // 与 references/光学与空间语言块.md 表四保持一致
  // 「一侧」排除 两侧 / 另一侧 / 每一侧 等合法方位词
  const WEAK_SPATIAL = /附近|周围|旁边|某处|不远处|在该区域内|差不多在|大概在|(?<![两另每各哪这同对])一侧|靠着/;
  const weakHit = bodyNoDialogue.split('\n').map((l) => l.match(WEAK_SPATIAL)).find(Boolean);
  if (weakHit) {
    warn('W-SPATIAL-WEAK', `正文出现站位弱词「${weakHit[0]}」`,
      '改用物理锚定：距 X 一米以内 / 紧贴 / 背靠 / 手搭在 X 上 / 位于画面左三分之一');
  }

  // --- 18. 段头景别（v2.0 补）
  const SHOTSIZE = /大远景|远景|全景|中景|近景|特写|大特写|中近景|过肩|俯拍|仰拍/;
  for (let i = 0; i < segs.length; i++) {
    if (!SHOTSIZE.test(segs[i].text)) {
      warn('W-SHOTSIZE-MISSING', `第 ${i + 1} 段未写景别（仅报首处）`,
        '段头必须给出景别与机位关系，否则模型自行决定取景；其余段同查');
      break;
    }
  }

  // --- 19. 多人物镜的朝向与视线（v2.0 补）
  const castList2 = castLine
    ? (castLine.split(/人物[：:]/)[1] || '')
        .split(/[、,，]/)
        .map((x) => x.replace(/（[^）]*）/gu, '').trim())
        .filter(Boolean)
    : [];
  if (castList2.length >= 2) {
    // v4.7.3：GAZE 表补 朝[左右前后上下]（站位行的「侧身朝左」是朝向的合规写法）与 目光/眼神
    const GAZE = /朝向|视线|看向|锁定|躯干|面对|背对|侧身|目视|目光|眼神|朝[左右前后上下]/;
    if (!GAZE.test(body)) {
      warn('W-GAZE-MISSING', `${castList2.length} 个出场对象，正文未写朝向或视线`,
        '躯干朝向与视线目标是两件事，要分别写；否则反打必然不匹配');
    }
  }

  // --- 20. 站位锚定（v2.0 补）：画面位置 与 物理接触/距离 至少占一样
  // 两项全缺 = 完全没写站位，模型自行安排人物关系，反打必然不匹配
  {
    const FRAME_POS = /画面左|画面右|居中|画面中央|中央|左三分之一|右三分之一|左边缘|右边缘|边缘|前景|后景|画角|角落/;
    const PHYSICAL = /贴近|紧贴|背靠|手搭|扶着|距[^，。；]{0,6}[一二三两半0-9]\s*米|正下方|正上方|齐平|高出|低于|踩在|坐在|挂在/;
    if (!FRAME_POS.test(body) && !PHYSICAL.test(body)) {
      warn('W-POSITION-MISSING', '正文既无画面位置也无物理接触/距离锚定',
        '站位至少占一样：画面位置（左三分之一 / 居中 / 右侧边缘）或物理锚定（背靠 X / 距 X 一米 / 手搭在 X 上）');
    }
  }

  // --- 21. 轴线声明（v2.0 补）：多人物镜必须写明建立 / 保持 / 跨越与左右归属
  // 脚本只能抓「有没有声明」，抓不到「声明得对不对」——后者靠台账逐镜比对
  if (castList2.length >= 2 && !/轴线\s*[：:]/.test(body)) {
    warn('W-AXIS-MISSING', `${castList2.length} 个出场对象，正文未声明轴线`,
      '不写轴线等于把左右交给模型随机决定，第一次反打就会崩。格式：轴线：建立/保持/跨越，谁在左谁在右');
  }

  // --- 21b 站位锚物优先（v4.7.5 新增；口径见 references/场景方位卡与固定锚物.md）
  // 外部站位图调研结论：liqi 的空间参照系是**相对的**——「距某角色三步」的基准是人，
  // 人一动基准就没了；drama-skills 用 fixed_anchors（柜台/卷帘门/出餐口）把基准钉在死物上。
  // 只管「用了相对人锚定、且本段没有固定锚物」，不管「压根没写站位」——后者归 W-POSITION-MISSING。
  // 按 @角色（…）逐段判，不按整行：一行里 A 挂了柱、B 挂在人身上，只该报 B。
  {
    const REL = /距[^，。；]{0,6}(?:[一二三两半]|\d+(?:\.\d+)?)\s*(?:步|米)/;
    const ANCHOR = /柱|台|门|墙|窗|柜|桌|架|框|阶|梯|栏|梁|沿|隔断|供台|柜台|地面|地板|墙角|门口|洞口|入口|石|树|桥/;
    const bad = [];
    for (const l of body.split('\n')) {
      if (!/^(站位|位移)\s*[：:]/.test(l)) continue;
      for (const m of l.matchAll(/@[^@（）()]{1,12}[（(]([^）)]*)[）)]/g)) {
        if (REL.test(m[1]) && !ANCHOR.test(m[1])) bad.push(m[1].slice(0, 26));
      }
    }
    if (bad.length > 0) {
      warn('W-STAGING-RELATIVE', `站位锚在活人身上：${bad[0]}`,
        '站位要挂死物不挂活人：先写固定锚物（承重柱侧后 / 隔断墙前 / 楼梯口），人物间距只作补充——'
        + '人的位置会变，物的位置不会');
    }
  }

  // --- 21c 轴线的地理参照（v4.7.5 新增；v5.27.0 改为只认地理事实）
  // 原轴线行只认三态状态机（建立/保持/跨越），多镜同场时每镜各自解释「保持什么」，第 3 镜开始漂。
  // v5.27.0 起：正文只留「锚物连线 + 谁在左谁在右」；状态词归连续性台账场景账。
  // 理由：逐镜单独投喂，模型看不到上一镜——「保持」对它没有指向；而旧写法为解释"保持什么"
  // 极易滑成「沿用镜 N 的…」，那是跨镜引用（撞 W-CONTEXT-LEAK）。
  {
    const axisLine = body.split('\n').find((l) => /^轴线\s*[：:]/.test(l));
    if (axisLine) {
      const GEO = /[东南西北]|柱|台|门|墙|窗|柜|桌|架|框|阶|梯|栏|梁|隔断|供台|柜台|楼梯|门口|洞口|入口|方位卡|连线/;
      if (!GEO.test(axisLine)) {
        warn('W-AXIS-NO-GEO', '轴线行没有地理参照（缺方位词或锚物连线）',
          '补锚物连线：轴线：承重柱—石膏隔断墙连线，谁在画面左谁在画面右；'
          + '左右按场景方位卡的屏幕方向映射写（画面左 = 西侧）');
      }
      const ST = /(建立|保持|跨越)/.exec(axisLine);
      if (ST) {
        warn('W-AXIS-STATE-IN-BODY', `轴线行出现状态词「${ST[1]}」——状态词是台账层，正文不写`,
          '正文只写「锚物连线 + 谁在左谁在右」（如「轴线：柱—墙连线，甲在画面左，乙在画面右」）；'
          + '建立/保持/跨越 记进连续性台账的场景账。逐镜单独投喂，模型看不到上一镜，'
          + '「保持」对它没有指向；写「沿用镜 N」还会撞 W-CONTEXT-LEAK');
      }
    }
  }

  // --- 21d 持物分左右手（v4.7.6 新增）
  // 跨镜最贱的一类穿帮：道具从第 2 镜起自己换了一只手。模型不看上一镜，
  // 「桃木剑在手」在它眼里等于「随便挑一只手」。站位行是唯一写死持物状态的字段，
  // 这里不写死，后面每一镜都得靠运气。
  // 只查站位移：`背手/插兜/抱臂` 这类是手态不是持物，单独放行（HOLD 也匹配不上）。
  {
    const HOLD = /(?:持|握|举|拿|拎|端|托|扛|攥|捏|夹|抱|提|拄|拖|抄|拨|捻)[一-龥A-Za-z0-9]{1,10}|在手|手中|手里|手上|手持|单手|两手|拎着|端着|托着/;
    const HANDED = /左手|右手|双手|两手|左右手|两手空|徒手|空手|背手|负手|垂手|插兜|抱臂|揣在|夹在腋|袖中|腰间|背上|肩[上扛]/;
    // 被动式先剥：「被攥脚踝」是接触点不是持物，报表等于把打斗接触点误判成漏写左右手
    const PASSIVE = /被(?:持|握|举|拿|拎|端|托|扛|攥|捏|夹|抱|提|拄|拖|抄|拨|捻)[一-龥A-Za-z0-9]{0,10}/g;
    const bad = [];
    for (const l of body.split('\n')) {
      if (!/^(站位|位移)\s*[：:]/.test(l)) continue;
      for (const m of l.matchAll(/@[^@（）()]{1,12}[（(]([^）)]*)[）)]/g)) {
        const c = m[1].replace(PASSIVE, '');
        if (HOLD.test(c) && !HANDED.test(c)) bad.push(m[1].slice(0, 26));
      }
    }
    if (bad.length > 0) {
      warn('W-PROP-HAND', `持物未分左右手：${bad[0]}`,
        '写成「左手 X · 右手 Y」，空手就明写「徒手」。不写死左右手，模型每镜重掷一次骰子，'
        + '第 2 镜换手就是穿帮');
    }
  }

  // --- 21e 原子镜头：主导景别唯一（v5.35.0 新增 · W-SHOT-MULTI-SCALE）
  // 上游来源：zyz254009-crypto/script-to-shootable-storyboard 的原子镜头契约
  // （一个镜号只装一个主导景别）+ 拆镜触发器「主导景别明显跨级」。
  // 治的病灶：一个镜号里三段各写一个景别（全景→近景→特写），模型按平均运动收敛、两头都演不出；
  // 而字数可能完全合规——W-LENGTH-CAP 查的是「写太多」，这条查的是「装太杂」，互补不重复。
  // 阈值取 ≥3 而非 ≥2：两档（如两极对冲 ECU↔EWS、或全景起特写落）在单镜内仍可由一次运镜完成，
  // 三档以上则必然要求镜头内部换构图，与「一个镜号一次构图」冲突。
  {
    // 长的放前面，避免「中景」抢掉「中全景」、「近景」抢掉「中近景」
    const SCALE_RE = /大特写|大远景|中近景|中全景|中景|远景|全景|近景|特写/g;
    const found = new Set();
    for (const l of body.split('\n')) {
      // 台词/人声/音效行不进景别统计：台词一字不动（liqi 铁律），且台词里出现景别词
      // 不代表镜头真的要换景别
      if (/^(台词|人声|音效)\s*[：:]/.test(l)) continue;
      SCALE_RE.lastIndex = 0;
      let m;
      while ((m = SCALE_RE.exec(l)) !== null) found.add(m[0]);
    }
    if (found.size >= 3) {
      warn('W-SHOT-MULTI-SCALE',
        `一个镜号里出现 ${found.size} 个景别档位：${[...found].join(' / ')}`,
        '拆镜，或把景别统一到一个主导档。原子镜头契约：一个镜号只装一个主导景别——'
        + '同镜写全景＋近景＋特写，模型按平均运动收敛、两头都演不出'
        + (PKG_PACE_TIER
            ? `（本包节奏档位：${PKG_PACE_TIER}——高密度的正解是多拆镜号、每镜一景别，档位不豁免本条）`
            : ''));
    }
  }

  // --- 21g along 坐标：同侧多人至少拉开 0.12（v5.37.0 新增 · W-STAGING-ALONG-TOO-CLOSE）
  // 上游来源：shuohao novel-staging 的 along 量化（Apache-2.0，已收编，见 references/冲突裁决总表_吸收shuohao.md）。
  // 治的病根：两个人贴在同一个点上，模型会把他们**合成一个人**（或一个双头身影）——
  // 这是「分身」的另一种成因，不是生成两个一样的，是该两个的挤成一个。
  // 只在同侧多人（≥2 人挂同一锚物 + 同一画面侧）时判；单侧一人或两侧各一人天然满足，不报。
  {
    const ALONG = /along\s*(\d+(?:\.\d+)?)/;
    const ANCHOR_K = /柱|台|门|墙|窗|柜|桌|架|框|阶|梯|栏|梁|沿|隔断|供台|柜台|地面|地板|墙角|门口|洞口|入口|石|树|桥/;
    const groups = new Map();   // key = 锚物 | 画面侧 → [{name, along}]
    for (const l of body.split('\n')) {
      if (!/^站位\s*[：:]/.test(l)) continue;
      for (const m of l.matchAll(/@([^@（）()]{1,12})[（(]([^）)]*)[）)]/g)) {
        const name = m[1].trim();
        const a = ALONG.exec(m[2]);
        if (!a) continue;
        const s = /画面(左|右|中)/.exec(m[2]);
        const side = s ? s[1] : '?';
        const anchor = (ANCHOR_K.exec(m[2]) || ['?'])[0];
        const key = anchor + '|' + side;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ name, along: parseFloat(a[1]) });
      }
    }
    for (const [, arr] of groups) {
      if (arr.length < 2) continue;
      arr.sort((x, y) => x.along - y.along);
      for (let i = 1; i < arr.length; i++) {
        const gap = +(arr[i].along - arr[i - 1].along).toFixed(3);
        if (gap < 0.12) {
          warn('W-STAGING-ALONG-TOO-CLOSE',
            `${arr[i - 1].name} 与 ${arr[i].name} 的 along 只差 ${gap}（< 0.12）`,
            '同侧多人沿锚物至少拉开 0.12 个身位；两个人贴在同一个点上，'
            + '模型会把它们合成一个人（或双头身影）。改法：把其中一个的 along 挪开 ≥0.12');
          break;   // 同组报一次就够，报完全部反而刷屏
        }
      }
    }
  }

  // --- 22. 打斗专项校验（v4.4 立三码；v5.8.0 扩为九码 + 声明式豁免）
  // 口径见 references/专项_打斗编排.md 第十一节（豁免表在第九节）。
  // 上游来源：漫剧老李 V7.4.20 sd-combat-engine（分档 / IAU 渲染负载 / 镜内速度四拍 /
  // 冲击帧三级 / 减速器配额）。liqi 侧两条特有改动：
  //   ① **R0 档（文戏 / 无打戏）**——让「没打戏」成为显式声明，而不是靠检测不到打戏词来默认；
  //   ② **默认档按项目类型定，不默认 R2**——liqi 用户也做文艺片 / 毕设 / 公益片，
  //      默认商业高燃是反向伤害（这是本次的倒车防护核心）。
  {
    const COMBAT_TITLE = /打斗|交手|缠斗|对决|混战|厮杀|格斗|大战|激战/;
    const COMBAT_GENRE = /taekwondo|boxing|karate|judo|wrestling|muay\s*thai|\bmma\b|kung\s*fu|fencing|swordplay|拳击|跆拳道|剑道|剑戟|武术|格斗|摔跤|柔道|散打|搏击|对打|交锋/gi;
    const isCombat = COMBAT_TITLE.test(title) || COMBAT_GENRE.test(body);
    if (isCombat) {
      // 22-0 定档声明 + 豁免表。段头形如「【打戏声明】：R2 · 群战乱斗」（档位必写，戏型可选）
      const declM = text.match(/【打戏声明】\s*[：:]?\s*R([0-3])\s*(?:[·•・\-—|｜,，、]\s*([^\n【]*))?/);
      const tier = declM ? declM[1] : null;
      const xing = (declM && declM[2]) ? declM[2] : '';

      if (tier === null) {
        // 没定档就不知道该按哪档判，其余八码的适用性无从判断——**只报这一条，不洪水告警**。
        // 这是唯一一条 ERROR：档位不是「可优化项」，是「能不能开始写」的前提。
        add('E-COMBAT-TIER-UNDECLARED', '打斗镜未声明档位（R0~R3）',
          '段头补「【打戏声明】：R2 · 群战乱斗」。**不允许默认档**——'
          + '默认档按项目类型定：文艺/纪录/公益/毕设→R0 或 R1，商业短剧/漫剧→R2，'
          + '玄幻仙侠→R3。定档前不写打戏，定完档才知道哪些配额适用');
      } else if (tier !== '0') {
        // 豁免表（★ 一开始就建，不要等撞了再补）：
        // 九码的量化口径原型全部取自「一对一贴身互殴」，外推到群战/枪战/法术对轰/大场面
        // 会反向压制——把本该连排的近景对招拉开成远景、把连招拆成单招 → 观众读到的是「呆板」。
        const XTYPE = [
          { re: /群战|混战|围杀|对军|乱斗/, off: ['iau', 'fullbody'] },
          { re: /枪战|狙击|暗杀|追车|儿童/, off: ['contact', 'fullbody'] },
          { re: /术法对轰|远程法术|法阵|对波|万剑归宗|法术/, off: ['contact', 'fullbody', 'beam'] },
          { re: /大场面|法相|法天象地|巨兽|清场/, off: ['iau', 'fullbody', 'beat', 'beam'] },
          { re: /机枪对招|连招/, off: ['iau', 'beat'] },
        ];
        const off = new Set();
        for (const x of XTYPE) {
          if (x.re.test(xing)) for (const c of x.off) off.add(c);
        }

        // 22a 接触点：不写就是两个人在彼此附近挥舞，永远打不到
        // 接触点词表（v4.7.3 扩充）：原表只覆盖「击中」类打击技，漏了近身擒拿与冲击技——
        // 某志怪剧本 M1 实战暴露：黑毛邪物「攥住脚踝、拍飞、撞穿墙」全都不命中，误报 CONTACT-MISSING。
        // 现补擒拿（攥/掐/擒/拖/制）、抛掷（拍飞/甩出/震飞/摔倒）、撞击（撞穿/撞上/轰中）三族。
        const CONTACT = /击中|架住|磕开|格挡|挡下|劈中|刺中|扫中|命中|砸中|踢中|捶中|捅中|砍中|撞中|撞穿|撞上|轰中|拍中|拍飞|攥住|掐住|擒住|拖住|制住|甩出|掷中|震飞|摔倒|撂倒|strikes|hits|blocks|parries|connects|slams|slaps|grabs/gi;
        if (!off.has('contact') && !CONTACT.test(bodyNoDialogue)) {
          warn('W-COMBAT-CONTACT-MISSING', '打斗镜未写接触点（谁哪个部位击中对方哪个部位）',
            '不写接触点 = 两个人在彼此附近挥舞，永远打不到');
        }
        // 22b 布娃娃禁令：不写 NEVER ragdoll，被击退方会变软体布偶
        const mustNotText = lines.filter((l) => /^Must\s*not/i.test(l)).join('\n');
        const RAGDOLL = /ragdoll|limp|floppy|布娃娃|软绵绵|软倒/i;
        if (!RAGDOLL.test(mustNotText)) {
          warn('W-COMBAT-RAGDOLL-GUARD', '打斗镜的 Must not 无布娃娃禁令',
            '负向补：禁 ragdoll / limp / floppy——核心始终发力，每个动作都有肌肉意图');
        }
        // 22c 切碎上限：7-10s 打斗超过四段，动作就读不出来
        if (duration && segs.length > Math.ceil(duration / 2.5)) {
          warn('W-COMBAT-CUTS-TOO-MANY', `${duration}s 打斗分了 ${segs.length} 段，超过 ${Math.ceil(duration / 2.5)} 段上限`,
            '一次接触一个主动作，其余并段；切太碎模型读不出动作');
        }

        // 22d IAU 渲染负载上限（v5.8.0）：一镜塞 4 个动作 → 模型只渲染第一个，其余丢失。
        // 按**族**去重计数——「格挡 + 硬接」是同一次架住，按词频算会多算一个。
        const IAU_FAM = [
          ['斩击', /撩斩|斩中|劈中|劈碎|劈开|竖劈|剪斩|砍中/g],
          ['突刺', /刺中|捅入|挑刺|扎入/g],
          ['横扫', /横扫|扫腿|扫堂|扫中/g],
          ['踢击', /踢中|踹中|顶中|膝顶|点中/g],
          ['砸击', /砸中|砸在|砸下|轰中|捶中|肘击/g],
          ['撞击', /撞中|撞碎|撞在|撞穿|撞上|撞击/g],
          ['擒拿', /抓住|揪住|扼住|勒住|擒住|攥住|掐住|制住/g],
          ['格挡', /格挡|架住|架开|格开|磕开|硬接|硬扛|对撞|交击|兵器相击/g],
          ['投掷', /扑击|震飞|甩出|摔倒|撂倒|掷中|拍飞/g],
        ];
        let iauCap = null;
        if (duration !== null) {
          if (duration <= 3) iauCap = 2;              // 3s 也只能 2 个：实测塞 5 个只渲染第一个
          else if (duration <= 5) iauCap = 3;
          else iauCap = 4 + Math.floor((duration - 6) / 3);
        }
        if (!off.has('iau') && iauCap !== null) {
          const fams = IAU_FAM.filter(([, re]) => re.test(bodyNoDialogue)).map(([n]) => n);
          if (fams.length > iauCap) {
            warn('W-COMBAT-IAU-OVER', `${duration}s 打斗镜有 ${fams.length} 类独立动作单元（${fams.join('/')}），超过上限 ${iauCap}`,
              '拆镜或删动作——模型 3 秒内可靠渲染约 2~3 个 IAU，超出部分会被直接丢弃'
              + '（出片症状：贴脸互殴 + 后半段动作消失）');
          }
        }

        // 22e 镜内速度四拍（v5.8.0）：旧版只有「镜与镜之间」的节奏维度，
        // 全片四镜都写匀速位移它也查不出。顿拍最不能缺——没有命中顿帧，观感必然糊。
        // ⚠️ 先剥 ≤6 字的纯结构标签（「（起手拍，慢）」），否则护栏被自己的标注喂饱。
        const beatBody = bodyNoDialogue.replace(/[（(][^）()]{1,6}[）)]/g, '（）');
        const BEAT = {
          '起': /沉肩|压低重心|绷紧|屏息|蓄力|蓄势|预备|屈膝|后仰|重心下压|拧腰|压腰/,
          '爆': /暴起|骤然|猛地|瞬间|陡然|疾掠|扑上|冲出|甩出|弹射|蹬地|爆发/,
          '顿': /顿住|时停|顿帧|定格|凝固|戛然|定住|顿了一/,
          '收': /卸力|稳住|侧滑|滑退|收势|滑步|落地缓冲|后撤|站定|单膝/,
        };
        const missBeat = Object.keys(BEAT).filter((k) => !BEAT[k].test(beatBody));
        if (!off.has('beat') && missBeat.length > 0) {
          warn('W-COMBAT-BEAT-MISSING', `打斗镜缺镜内速度拍：${missBeat.join('、')}（应为 起→爆→顿→收）`,
            missBeat.includes('顿')
              ? '**顿拍最关键**：命中瞬间画面定住 2~3 帧，是「打到了」的唯一视觉证据；缺顿拍 = 再多动作也读作在乱动'
              : '逐镜补齐四拍（起 15~30% / 爆 极短 / 顿 2~3 帧 / 收 20~35%），不要只靠镜与镜之间做节奏');
        }

        // 22f 减速器配额（v5.8.0）：黑白闪 / 定格帧 / 慢镜都是「减速器」，用一处就从快拍时间里扣一处
        const SLOWMO = [
          ['黑白闪', /黑白闪|闪白|白闪/g],
          ['定格帧', /定格|顿帧|时停/g],
          ['慢镜', /慢镜|升格|慢动作|slow\s*motion/gi],
        ];
        let slowQ = 1;
        if (duration !== null && duration > 15) slowQ = duration <= 30 ? 2 : 2 + Math.floor((duration - 30) / 15);
        if (!off.has('hitstop')) {
          const over = SLOWMO
            .map(([n, re]) => [n, (bodyNoDialogue.match(re) || []).length])
            .filter(([, c]) => c > slowQ);
          if (over.length > 0) {
            warn('W-COMBAT-HITSTOP-EXCESS',
              `${duration ? duration + 's' : ''}打斗镜减速器超额：${over.map(([n, c]) => `${n} ${c} 处（上限 ${slowQ}）`).join('、')}`,
              '黑白闪 / 定格 / 慢镜都是减速器，用一处扣一处快拍时间。黑白闪必须写成自然画面句，'
              + '严禁「★插入黑白闪 #1」这类术语标签');
          }
        }

        // 22g 动力链（v5.8.0）：有重击却没写发力链 → 力量凭空产生，观感是「在比划」
        const HEAVY = /劈中|劈碎|砸中|砸在|轰中|撞穿|撞碎|震飞|踢中|踹中|贯穿|撂倒/;
        const CHAIN = /蹬地|转胯|拧腰|沉肩|髋部|重心|发力链|腰马|转体|送肩|马步|借力/;
        if (HEAVY.test(bodyNoDialogue) && !CHAIN.test(bodyNoDialogue)) {
          warn('W-COMBAT-NO-FORCE-CHAIN', '打斗镜写了重击却无动力链推导',
            '补发力链：力量从哪来（蹬地 / 转胯 / 拧腰）、经哪传导、落在哪。'
            + '打戏的说服力来自身体力学，不是从接触点凭空产生');
        }

        // 22h 隔空对波充数（v5.8.0）：对波看着燃，实则零接触零位移——用特效冒充激烈
        const BEAM = /能量光束|对波|气功波|冲击波对撞|隔空|能量波|灵力对轰|术法对轰/;
        const CLOSE = /贴身|近身|缠斗|擒拿|抓住|揪住|抱摔|扑上|撞上|兵器相击|拳掌相交|近距|肉搏/;
        if (!off.has('beam') && BEAM.test(bodyNoDialogue) && !CLOSE.test(bodyNoDialogue)) {
          warn('W-COMBAT-BEAM-FILL', '打斗镜用隔空对波填充，且全程无贴身接触',
            '隔空对波只允许两处：㈠ 高潮大招释放 1~2s（作收束点）；'
            + '㈡ 短暂反制 ≤0.5s 且紧接着必须贴身。其余时间必须给贴身对招');
        }
      }
      // tier === '0'：显式声明无打戏 → 九码全免。
      // 这正是 R0 存在的意义：不写 R0 而正文出现打斗词，由 TIER-UNDECLARED 逼出「你到底要不要打」。
    }
  }

  // --- 22B. 表演位：空泛情绪结果词 + 特写景别缺肌肉动作（v5.12.0 新增）
  // 口径见 references/表演层_FACS微表情.md 第十二节。上游来源：漫剧老李 V7.4.20 FACS 体系
  // （AU 字典 / 情绪配方 / 强度三档）。liqi 侧三条限定：
  //   ① **只查「写没写」，不查「写对不对」**——表演是否到位是语义判断，做成判据就是假绿门
  //      （与 v5.8.0「完播自评只作自评」、v5.9.0「方言不设门禁」同一取舍）；
  //   ② **不查 AU 编号**——AU 是内部 cue 表的东西，进正文违反分层铁律，本码不得倒逼它进正文；
  //   ③ 两条都是 WARN——表演是审美判断，脚本只拦「明显没写」的。
  {
    // 声明式豁免（一开始就建，不要等撞了再补）：
    // 解说 / 旁白赛道、纯客观描写、面具型角色可能整段没有表情表演。
    // 段头写「【表演声明】：本段无表情表演（理由）」即整段豁免两条。
    const perfDecl = text.match(/【表演声明】\s*[：:]?\s*([^\n【]*)/);
    const perfOff = perfDecl && /无表情|不表演|旁白|解说|客观|面具|无面部/.test(perfDecl[1]);

    if (!perfOff) {
      // 22B-1 空泛情绪结果词（§〇 铁律：默认档与全量档都禁「开心 / 难过 / 邪魅」）
      // 台词已由 bodyNoDialogue 剥掉「」与 {}，旁白与解说词走上面的声明式豁免。
      const VAGUE = /开心|难过|伤心|悲伤|愤怒|生气|高兴|喜悦|痛苦|恐惧|害怕|惊讶|得意|邪魅|阴险|冷笑|苦笑|不悦|忧郁|焦虑|紧张|失落|绝望|欣喜|恼火|害羞|委屈|心疼|心动|震惊|惶恐|不安|茫然|呆滞|冷漠|温柔|慈祥/;
      const vagueHit = bodyNoDialogue.match(VAGUE);
      if (vagueHit) {
        warn('W-FACS-VAGUE-EMOTION', `正文出现空泛情绪结果词：「${vagueHit[0]}」`,
          '换成肌肉动作的画面语言：哪块肌肉 + 做什么可见动作 + 幅度 + 持续秒数。'
          + '查 `表演层_FACS微表情.md` §四 AU 字典与 §五 26 条情绪配方（如：隐忍 = AU24 抿唇 + AU20 嘴角横拉，〔痕〕档）。'
          + '若本段确无表情表演（旁白 / 解说 / 面具型角色），段头写「【表演声明】：本段无表情表演（理由）」豁免');
      }

      // 22B-2 特写景别却没有任何面部肌肉动作 —— 特写是 FACS 的「全量档」触发条件之一，
      // 一张占满画幅的脸不写肌肉动作，模型只能自由发挥，崩脸率最高。
      const CU = /大特写|特写/;
      const HAS_CHAR = /@[^\s（(]+|人物[:：]|角色[:：]/;
      const MUSCLE = /眉|眼|嘴角|唇|下颌|下巴|颧|颊|咬|抿|眯|皱|挑|瞪|眨|龇|咧|嘟|撇|绷紧|上提|下压|隆起|收紧|泛红|喉结|吞咽|呼吸|鼻翼|泪|笑意|表情|神情|面露|一脸/;
      if (CU.test(bodyNoDialogue) && HAS_CHAR.test(bodyNoDialogue) && !MUSCLE.test(bodyNoDialogue)) {
        warn('W-FACS-NO-MUSCLE-ACTION', '特写景别但正文无任何面部肌肉动作描述',
          '特写触发 FACS 全量档：按「眉区 → 眼区 → 颧颊 → 嘴/下颌」四区写全，'
          + '每区给可见动作 + 幅度 + 起落秒数。缺区会导致表情发空或模型自由发挥崩脸。'
          + '本码只查「写没写」——不查 AU 编号（AU 属内部 cue 表，进正文违反分层铁律）');
      }
    }
  }

  // --- 22C. 调度几何三码（v5.13.0 新增）
  // 口径见 references/空间层_调度与轴线.md 第十五节（机检四码；§十四是自检十二问，v5.43.0 更正指错节）。上游来源：漫剧老李 V7.4.20
  // blocking-direction.md（过肩退距 / 越轴过渡 / 决策证据）与 spatial-topview-camera（30° 规则）。
  // liqi 侧三条限定：
  //   ① **三条全是 WARN**——几何是护栏不是铁律；群戏 / 打戏里越界常常是有意为之，
  //      做成 ERROR 会逼出「为过门而改摆法」的假合规；
  //   ② **只查「写没写」，不查「写对不对」**——机位角差到底多少度、退距是不是真的 1.8 米，
  //      脚本量不出来，量不出来的东西做成判据就是假绿门；
  //   ③ **未触发 = 本镜不适用，不是通过**——三码都只在触发词（过肩 / 越轴 / S3·S4 声明）
  //      出现时才判断。没出现过肩镜的段不会收到 OTS 警告，那不代表它的过肩镜合格了。
  {
    // 22C-1 过肩机位退距（CAM3）：写了过肩却不给距离数值 → 模型默认拍成「贴背特写」，
    // 后脑勺占掉画面三四成，主体表情被挤掉。详见 空间层 §三「过肩机位退距 1.5~2 米」。
    const OTS = /过肩/;
    // 距离数值：米 / 厘米 / 步 / 退距 / 后退 N 步。⚠️ 「稍退后」「保持距离」这类弱指令不算。
    const DIST = /\d+(?:\.\d+)?\s*(?:米|m\b|cm|厘米|步)|退距|退至|后退\s*\d/;
    if (OTS.test(bodyNoDialogue) && !DIST.test(bodyNoDialogue)) {
      warn('W-STAGING-OTS-DISTANCE', '过肩镜未写机位退距数值',
        'CAM3 过肩反打须写「机位自对话轴线后退 1.5~2 米」并给具体数值。'
        + '不写距离模型默认拍成贴背特写——前景后脑勺占画面三四成，主体表情被挤到边角，'
        + '而过肩镜的用途恰恰是同时看到对手的压迫与主体的反应。**「稍退后 / 保持距离」不算写了距离**');
    }

    // 22C-2 越轴却没写用哪种过渡：四种合法手段（镜头内过轴 / 中立镜头过渡 /
    // 插入特写 / 重新建轴）见 空间层 §一。「跨越」状态必须写明用哪一种。
    const CROSS = /越轴|跨轴|过轴线|跳过轴线/;
    const TRANSITION = /中立|中性|过渡|插入|重新建轴|重建轴|运动镜|骑轴|镜头内过轴/;
    if (CROSS.test(bodyNoDialogue) && !TRANSITION.test(bodyNoDialogue)) {
      warn('W-STAGING-CROSS-NO-TRANSITION', '写了越轴但未声明用哪种过渡手段',
        '轴线行补四种合法手段之一：镜头内过轴 / 中立镜头过渡 / 插入特写 / 重新建轴。'
        + '相邻镜机位角差 ≤30°（超过必须过渡）——**跨轴是角差的极端值，一定要过渡镜**。'
        + '⚠️ 口径防混：「30°~60° 斜角」管单镜取景角，「相邻镜角差 ≤30°」管机位变化量，两回事');
    }

    // 22C-3 S3 / S4 级调度缺决策证据：改稿时无法判断「这么改会不会破坏原意图」，
    // 返修会在两三种摆法之间来回横跳。只查写没写。
    const GRADE = /空间分级\s*[：:]?\s*[S S]*S([34])|分级\s*[：:]?\s*S([34])|S([34])\s*级调度/;
    if (GRADE.test(text) && !/决策证据|决策依据/.test(text)) {
      warn('W-STAGING-NO-EVIDENCE', '声明 S3 / S4 级调度但无「决策证据」行',
        'S3 / S4 补两行：「决策证据：为什么这么摆」+「被否决方案：考虑过但不用（及否决原因）」。'
        + '没有这两行，改稿时只能凭感觉重摆——v5.6.4 全库矛盾排查里最费时的就是这类改了又改回去');
    }

    // 22C-4 段末接戏全景 —— v6.4.0 废止移除（2026-10-29《无人出席的圆桌》实测撤销）：
    // 末拍前补 1 秒接戏全景的强制设定量产效果不佳（机检催报 197 次无一采纳，全景本身不保证一致）。
    // 跨段衔接由【跨段继承】＋实际尾帧验收＋first_frame 硬绑定＋锁行复述承担；
    // 机制原文留档于 references/空间层_调度与轴线.md §十三。
  }

  // --- 22D. 正文边界（v5.15.2 新增）：制作注记不得进正文 ---
  // 为什么单开一条：「剪辑时剪掉，仅作下一段首帧与站位参考」「不重新设计」「【接戏全景豁免】」
  // 这类话**机器用不上、模型读不懂**，写在正文里只有两个后果——白占 800 字额度、让模型分心。
  // 它们该待在 Must not 之后的施工行（正文之外）。人工纪律守不住，故做成码。
  // 口径：正文 = 段头 → Must not 之前；施工行在其后，不算正文。
  {
    const META_IN_BODY = /剪辑时剪掉|仅作下一段|不重新设计|见接戏全景|台账「|施工：/;
    for (const sg of segs) {
      const mm = sg.text.match(META_IN_BODY);
      if (mm) {
        warn('W-META-IN-BODY', `正文出现制作注记「${mm[0]}」——它不参与投喂`,
          '**正文只放投喂内容，制作注记一律进施工行**（`Must not` 之后）。'
          + '「剪辑时剪掉…」「不重新设计…」「【接戏全景豁免】…」写在正文里是**白占 800 字额度**，'
          + '模型也读不懂——它只会把这些当画面描述去渲。移到施工行即可，语义不减。');
      }
    }
  }

  // --- 22E. 局部入画归属（v5.40.0 新增 · W-BODY-PART-NO-OWNER / W-ANON-FIGURE-NO-OWNER）
  // 口径见 references/专项_局部入画归属.md 第五节。
  // 治什么病：正文写「一只靴抬起」「一只手伸过来」「一个跪着的人」——**模型不知道这部件是谁的**，
  //   于是自己造一只：靴的款式与人物对不上、手从画面边缘凭空长出来、跪着的人换了一张脸。
  //   出片症状是接戏断在同一帧——前后两镜里的「那只手」根本不是同一只。
  //   2026-10-22《我扎的纸人》EP01–EP04 实战暴露：四包 47 处全是这一类，且改完还要补漏两轮
  //   （第一轮只扫了「画面（事件序）」行，场景行 / 硬性约束 / Must not / 接戏表全漏）。
  // liqi 侧三条限定（与 v5.8.0「完播自评只作自评」、v5.12.0「只查写没写」同一取舍）：
  //   ① **只查「带没带归属」，不查归属写得对不对**（谁叫陈砚、马六穿什么，脚本量不出来）；
  //   ② **两条都是 WARN**——空镜 / 群像远景 / 故意不露脸的 POV 里匿名局部是有意为之，
  //      做成 ERROR 会逼出「为过门硬塞人名」的假合规；声明式豁免见下；
  //   ③ **未触发 = 本段不适用，不是通过**——本段没有局部入画就不会收到警告。
  {
    // 声明式豁免（★ 一开始就建，不要等撞了再补）：段头写「【局部入画豁免】：<理由>」整段豁免。
    if (!/【局部入画豁免】/.test(text)) {
      // 22E-1 部件词四族：肢端 / 鞋履 / 躯干与头颈 / 衣饰局部
      const PART = '手|脚|靴|履|鞋|掌|指|拳|臂|肘|腿|膝|肩|背|颈|下颌|下巴|额头|辫|发髻|袖口|衣摆|下摆|裙摆|帽檐|头巾';
      // 裸挂的量词 / 指示词
      const DET = '一只|另一只|两只|三只|这只|那只|某只|一双|两双|三双|这双|那双|这副|那副';
      // 🔴 判据是「量词是不是停在小句开头」——量词前是标点 / 行首 = 这半句里没有任何人接过它；
      //    量词前紧贴着字（多半是人名或名词，如「马六那只靴」「陈砚那只垂着的袖口」）= 归属已给。
      //    这一条是 v5.40.0 第一轮写坏之后改的：原判据只认前 8 字有没有「的」，
      //    结果「陈砚那只垂着的袖口」被判无归属（它明明写了陈砚）——**把「没用『的』」当成「没归属」，
      //    是把写法偏好当成了语义缺陷**。
      const BOUNDARY = /[\s，。；、：:（）()「」“”【】—\-—]/;
      const atClauseHead = (s, i) => i === 0 || BOUNDARY.test(s[i - 1]);
      // 22E-2 用的仍是「前 8 字有没有的 / 代词」——匿名整体人常落在「落在／看见 + 一个X人」，
      // 量词前是「在」「见」这类字，不能用小句开头判据。
      const hasOwner = (s, i) => {
        const pre = s.slice(Math.max(0, i - 8), i);
        return /的/.test(pre) || /[他她它其此该][^，。；、]{0,2}$/.test(pre);
      };
      const rePart = new RegExp(`(${DET})([^，。；、\\n]{0,3})(?:${PART})`, 'g');
      let pm;
      while ((pm = rePart.exec(bodyNoDialogue)) !== null) {
        if (atClauseHead(bodyNoDialogue, pm.index)) {
          warn('W-BODY-PART-NO-OWNER', `正文出现无归属的身体部件：「${pm[0]}」`,
            '写成「人物名＋部位」：「马六那只深褐短打的靴」「陈砚的手」「门房的手」。'
            + '**模型不知道部件是谁的，就会自己造一只**——款式、肤色、衣料全对不上，接戏断在同一帧。'
            + '⚠️ 别只改「画面（事件序）」行：**场景行 / 硬性约束 / Must not / 接戏表**同样会漏'
            + '（实战里最后补的 7 处全在这四行）。'
            + '本段确无人物局部入画（空镜 / 群像远景 / 不露脸 POV），段头写「【局部入画豁免】：<理由>」');
          break;   // 同段报一次就够，报完全部反而刷屏
        }
      }

      // 22E-2 匿名整体人：「一个跪着的人」「一个人」「第一个人」——无名无身份的整体人进画面，
      // 模型同样会造一张脸，下一次再出现就不是同一个人了。改法是给临时角色定名（打手甲 / 门房 / 路人一）。
      // 误报源已排除：纸人 / 泥人 / 木人 / 铜人 / 雪人 / 冰雕 / 画中人 里的「人」不是人。
      // ⚠️ 「人」前的那个字是纸 / 泥 / 木 / 铜 / 石 / 雪 / 冰 / 画 → 不是人（纸人、雪人、画中人）。
      //    lookbehind 必须挂在「人」上，不能挂在量词上——「第一个纸人」里量词前是「第」，挂那儿等于没挂。
      const reAnon = new RegExp(
        '(一个|一名|一位|有个|第一个|第二个|第三个|第四个|第五个)'
        + '([^，。；、\\n]{0,8}?)(?<![纸泥木铜石雪冰画])(人|男人|女人|汉子|身影|身形)', 'g');
      let am;
      while ((am = reAnon.exec(bodyNoDialogue)) !== null) {
        if (!hasOwner(bodyNoDialogue, am.index)) {
          warn('W-ANON-FIGURE-NO-OWNER', `正文出现无名无身份的人：「${am[0]}」`,
            '给临时角色定名再写进去：「一名打手」「门房」「路人一」「跪着的陈砚」。'
            + '**没名字的人进画面，模型会给他造一张脸**——下一段再出现就不是同一个了，'
            + '而群演 / 打手 / 门房这类人往往跨段复现，是接戏断点的重灾区。'
            + '本段确为无人物空镜，段头写「【局部入画豁免】：<理由>」');
          break;
        }
      }
    }
  }

  // --- 22F. 空间方位参照系（v5.41.0 新增 · W-SPATIAL-NO-FRAME-REF）
  // 口径见 references/专项_空间方位参照系.md 第五节。
  // 治什么病：正文混用两套坐标——
  //   A 画面参照系（观众视角）：「画面左三分之一」「画面右缘」
  //   B 人物参照系（角色自身左右）：「他的右前方」「机位在他的左后方」「两列灯在他右后方」
  // 人物背对或侧对镜头时 B 会**整体左右翻转**，读者按 A 理解、模型按 B 摆位，跨段接戏必断。
  //   2026-10-22《我扎的纸人》EP01 实战：段 1 写「马六自画面右缘踱入，停在他右前方一步」——
  //   陈砚跪着、朝向未定义，马六绕半圈后落到画面左；段 2 却写「马六在画面右三分之一」。
  //   同一个人两段之间横跨半个画面，是压字数时删掉「他」字之后参照系彻底丢失造成的。
  // liqi 侧三条限定（与 §22E 同一取舍）：
  //   ① **只查「挂没挂画面参照系」，不查方位写得对不对**（左三分之一到底站谁，脚本量不出来）；
  //   ② **WARN 级**——POV / 主观镜头里用角色自身左右是有意为之；
  //   ③ **身体部位不查**：右眉 / 左手 / 右颊是资产特征，本来就该用人物参照系。
  {
    if (!/【空间方位豁免】/.test(text)) {
      const CLAUSE_BREAK = /[，。；：\n]/;
      const BODY_PART = '眉|耳|手|指|拳|臂|肘|腿|膝|脚|靴|肩|颊|颧|嘴角|下颌|眼|鬓|拇指|掌|腰|胸|背|颈';
      // 已知漏网（WARN 级，不追求零漏）：「左手边」「右手侧」这类「部位+方位」会被当成部位放行。
      const reLR = /[左右]/g;
      let m;
      while ((m = reLR.exec(bodyNoDialogue)) !== null) {
        const i = m.index;
        // 身体部位：右眉 / 左手 / 右颧颊 / 右掌 —— 人物自身左右，是资产特征，不查
        if (new RegExp('[左右](?:' + BODY_PART + ')').test(bodyNoDialogue.slice(i, i + 4))) continue;
        // 「画左」「画右」= 画面参照系的简写（「人从画右走到画左」）
        if (bodyNoDialogue[i - 1] === '画') continue;
        // 「左右分开」「左右两边」是双向词，不是方位歧义，不查
        if (bodyNoDialogue[i] === '左' && bodyNoDialogue[i + 1] === '右') continue;
        if (bodyNoDialogue[i] === '右' && bodyNoDialogue[i - 1] === '左') continue;
        // 🔴 判据：该方位词所在的**整个小句**里有没有出现「画面」。
        //    ① 用「，。；：」切小句而不是用「、」——同一小句里先说了「画面右缘」，
        //       后面「出左缘」就已经被接住了（实战里这类承接写法非常多，用顿号切会刷屏）；
        //    ② 看**整句而不是只看前半截**——「继续向左走出画面左缘」里「画面」在方位词**之后**，
        //       只看前向窗口会把这种已经写清楚的写法误判成没挂参照系（v5.41.0 第一轮踩的）。
        let cs = i;
        while (cs > 0 && !CLAUSE_BREAK.test(bodyNoDialogue[cs - 1])) cs--;
        let ce = i;
        while (ce < bodyNoDialogue.length && !CLAUSE_BREAK.test(bodyNoDialogue[ce])) ce++;
        if (/画面/.test(bodyNoDialogue.slice(cs, ce))) continue;
        const clause = bodyNoDialogue.slice(cs, Math.min(bodyNoDialogue.length, i + 8));
        warn('W-SPATIAL-NO-FRAME-REF', `方位词没有挂画面参照系：「${clause}…」`,
          '空间方位一律用**观众视角**写成「画面左三分之一」「画面右缘」「画面右后方」；'
          + '**禁用人物自身左右**（「他的右前方」「他的左后方」「他右后方」）——人物背对或侧对镜头时，'
          + '两套坐标会整体翻转，跨段接戏必断。'
          + '⚠️ 压字数时**别把「他」「画面」这类参照词一起删掉**：'
          + '「停在他右前方一步」删成「停在右前方一步」，归属与参照系同时丢失。'
          + '身体部位（右眉 / 左手 / 右颊）保持人物参照系，那是资产特征。'
          + '本段确为主观 POV（必须用角色自身左右），段头写「【空间方位豁免】：<理由>」');
        break;   // 同段报一次就够
      }
    }
  }

  // --- 23. 导演名 / IP 符号去名化（v4.6 新增；口径见 references/导演风格预设层.md 第三节）
  // 用户常带着「诺兰风」来，降解后人名与作品符号禁进正文——模型会把 IP 名当风格渲染，
  // 且与「禁可读文字」铁律潜在冲突（logo/字幕）。台词引号内已剥，Must not 行不在 body 内。
  {
    const IP_NAMES = /诺兰|维伦纽瓦|韦斯?安德森|王家卫|宫崎骏|新海诚|芬奇|迪金斯|黑泽明|张艺谋|Nolan|Villeneuve|Wes Anderson|Miyazaki|Ghibli|吉卜力|皮克斯|迪士尼|Pixar|Disney|漫威|Marvel|龙猫|千与千寻|千寻|你的名字|天气之子|沙丘|七武士|银翼杀手/gi;
    const ipHit = bodyNoDialogue.match(IP_NAMES);
    if (ipHit) {
      warn('W-DIRECTOR-NAME-IN-BODY', `正文出现导演名或 IP 符号：「${ipHit[0]}」`,
        '去名化三铁律：降解为四轴物理参数（色彩/灯光/美术/机位），禁用人名与作品符号');
    }
  }

  // --- 24. 参数行合法性（v4.7 新增；口径见 SKILL.md 投放面参数总表）
  // 抄自 higgsfield 的「结构预检」思路：参数行与标题不一致、比例越锁、时长越界，
  // 都是复制粘贴事故，烧一次生成才发现的错误。参数行本身合法（不进正文），查的是它与总表的一致性。
  {
    // duration 取值三态：具体秒数 / 智能时长（`-1` 或 `auto`）/ 缺失。
    // v5.37.2 修：旧正则只认 `数字+s`，于是照官方文档写 `# duration: -1` 的包被当成「没写」，
    // 而 check_prompt 与 audit_project 各错一半（前者静默放过、后者报「缺 duration 参数行」）。
    // 外部依据：火山方舟《创建视频生成任务》的「duration = -1 适配规则」——Seedance 2.0 系列
    // 与 2.5（非视频编辑任务）在有效取值范围内由模型自主选整数秒；视频编辑任务跟随待编辑
    // 视频时长、不支持另行设置。https://console.volcengine.com/ark/region:cn-beijing/docs/ark/create-video-generation-task-api?lang=zh
    const pDurRaw = (text.match(/#\s*duration\s*[：:]\s*([^\s|｜]+)/i) || [])[1];
    const pDurNorm = pDurRaw ? pDurRaw.replace(/[－−–—]/g, '-').replace(/s$/i, '') : '';
    const pDurAuto = /^(-1|auto|自动)$/i.test(pDurNorm);
    const pDur = pDurRaw !== undefined && /^\d+(?:\.\d+)?$/.test(pDurNorm) ? Number(pDurNorm) : null;
    // ratio：锁②四值 + adaptive（2.5 与 2.0 系列的官方默认值；视频编辑任务必须 adaptive）。
    // v5.37.2 修：旧实现的正则特意把 adaptive 捕出来，紧接着又用四值把它判成 WARN——自己跟自己打架。
    // ratio：锁②白名单 + adaptive（v5.49.0 起白名单唯一事实源 = references/model-limits.json
    // 的 ratio_whitelist，不再活在正则常量里；2.5 与 2.0 系列官方默认值 adaptive，视频编辑任务必须用它）。
    const pRatio = (text.match(/#\s*ratio\s*[：:]\s*([\d.]+:\d+|adaptive)/i) || [])[1];
    if (pDur !== null && duration !== null && pDur !== duration) {
      add('E-PARAM-DUR-MISMATCH', `参数行 duration=${pDur}s 与标题时长 ${duration}s 不一致`,
        '复制粘贴改标题忘改参数行是常见事故，两处必须一致');
    }
    if (pRatio && !ratioOk(pRatio)) {
      warn('W-PARAM-RATIO', `参数行 ratio=${pRatio} 不在锁②六值（16:9 / 9:16 / 21:9 / 4:3 / 3:4 / 1:1）或 adaptive`,
        '画幅锁只认六值 + adaptive（v5.45.0 扩：官方 ratio 原文含 4:3 / 3:4，见锁②）；其余比例需明确指定（见 references/导演风格预设层.md 第五节）');
    }
    // v5.37.1：上界从锁①取（旧写法写死 30，2.0 面 20s 的参数行在这里也是「不越界」的假绿）
    const capNum = (model.limit || MODEL_LIMITS['2.5']).cap;
    if (pDur !== null && (pDur <= 0 || pDur > capNum)) {
      warn('W-PARAM-DUR-RANGE', `参数行 duration=${pDur}s 越界（锁①上限 ${capNum}s）`,
        `Seedance 面单条 ≤${capNum}s；H3 面 4-15s 走 check_prompt_h3.mjs`);
    }
    // 智能时长 × 秒级时间轴 = 定时权打架：正文按 N 秒排了段，参数行却让模型自己定秒数，
    // 平台返回的时长与时间轴必然对不上（返回时长还会被 24 帧取整）。两者只能一个说了算。
    if (pDurAuto && segs.some((s) => s.start !== null && s.end !== null)) {
      warn('W-PARAM-DUR-AUTO', `参数行 duration=${pDurRaw}（智能时长），但正文是秒级时间轴`,
        '要么写死秒数与标题一致，要么改用镜头编号骨架（2.0 面写法）再交给智能时长');
    }
  }

  // --- 25. 参考素材上限（v5.37.2 · 审查报告 MA-5）
  // 病根：2.5 的「图 ≤30 / 视频 ≤10 / 音频 ≤10 / 合计 ≤50」与 2.0·H3 的「≤9/3/3/合计 ≤12」
  // 只写在文档里，references/model-limits.json 的 refs 字段也从没被任何脚本读过——**上限写着，机器不查**。
  // 口径：按「单镜块」数，不按整包数。上限是「一次 API 调用能塞多少份素材」，
  // 而一个提示词包可能覆盖十几镜（整包 @图片1~20 是正常的分镜引用，不是超限）。
  // 只数去重后的编号：@图片3 出现三次仍是 1 张。
  {
    const rl = (model.limit || MODEL_LIMITS['2.5']).refs;
    if (rl) {
      const uniq = {
        image: new Set(), video: new Set(), audio: new Set(),
      };
      // 官方 2.5 示例用的是 `@图像1`（role=reference_image），liqi 旧写法是 `@图片1`，两种都数
      for (const m of body.matchAll(/@\s*(图片|图像|Image|image|IMAGE)\s*[_#－-]?\s*(\d+)/g)) uniq.image.add(m[2]);
      for (const m of body.matchAll(/@\s*(视频|Video|video|VIDEO)\s*[_#－-]?\s*(\d+)/g)) uniq.video.add(m[2]);
      for (const m of body.matchAll(/@\s*(音频|Audio|audio|AUDIO)\s*[_#－-]?\s*(\d+)/g)) uniq.audio.add(m[2]);
      const got = { image: uniq.image.size, video: uniq.video.size, audio: uniq.audio.size };
      const total = got.image + got.video + got.audio;
      const over = [];
      if (got.image > rl.image) over.push(`图 ${got.image} 张 > ${rl.image}`);
      if (got.video > rl.video) over.push(`视频 ${got.video} 段 > ${rl.video}`);
      if (got.audio > rl.audio) over.push(`音频 ${got.audio} 条 > ${rl.audio}`);
      if (total > rl.total) over.push(`合计 ${total} 份 > ${rl.total}`);
      if (over.length) {
        const lim = model.limit || MODEL_LIMITS['2.5'];
        // 型号是包内声明的 → 超限就是硬错（平台直接拒）；走兜底档 → 只告警（也许是 2.5 忘了写型号）
        const code = model.declared === false ? 'W-REF-OVER-LIMIT' : 'E-REF-OVER-LIMIT';
        const tag = model.declared === false ? '锁①未声明，按最严 12 份兜底' : `锁①=${model.key}`;
        const msg = `参考素材超${lim.label}单镜上限：${over.join('；')}（${tag}）`;
        const hint = model.declared === false
          ? `若确为 Seedance 2.5（图 30 / 视频 10 / 音频 10 / 合计 50），补【模型版本】：2.5；否则必须砍到 ${rl.image}/${rl.video}/${rl.audio}（合计 ${rl.total}）`
          : `平台会直接拒绝该请求。先砍素材再改 Prompt——2.5 的推荐区间是图 1-8、素材总量 4-5 份，别按上限塞满`;
        if (model.declared === false) warn(code, msg, hint); else add(code, msg, hint);
      }
    }
  }

  return { title: title.trim(), segs: segs.length, duration };
}

// ---------------------------------------------------------------- 节拍认领（--beats 可选门）

/**
 * 解析节拍清单。每行一拍：
 *   P01｜场次1｜甲拖着行李箱走进候车厅｜动作
 *   P02｜场次1｜乙（对白）：请出示您的票。｜台词
 *   P01｜场次1｜门在身后关上｜动作｜HOOK      ← v5.18.0：可选第 5 段标钩子（钩子门用）
 * 返回 Map<P01, {scene, content, type, dialogue, hook, pos}>
 *   hook = 该拍是否标了 HOOK；pos = 清单行序（钩子门判「前 N 拍」用）
 */
function parseBeatsFile(raw) {
  const beats = new Map();
  let pos = 0;
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(P\d+)[｜|]\s*([^｜|]+?)[｜|]\s*(.+?)[｜|]\s*(动作|台词)(?:\s*[｜|]\s*(HOOK|钩子))?\s*$/);
    if (!m) continue;
    const [, id, scene, content, type, hookTag] = m;
    let dialogue = null;
    if (type === '台词') {
      const dm = content.match(/[（(]?(?:对白|心声|旁白|内心独白|口播)[）)]?\s*[：:]\s*(.+)$/);
      dialogue = (dm ? dm[1] : content).trim();
    }
    pos += 1;
    beats.set(id, { scene: scene.trim(), content: content.trim(), type, dialogue,
                    hook: Boolean(hookTag), pos });
  }
  return beats;
}

/**
 * 解析镜块里的认领行。支持三种写法：
 *   认领：场次1 P01-P03
 *   认领：场次1 P03
 *   认领：场次1 P01-P02, P05
 * 返回 [{ scene, ids: [P..], raw }]
 */
function parseClaimLines(lines) {
  const out = [];
  for (const l of lines) {
    const m = l.match(/^\s*认领\s*[：:]\s*(.+)$/);
    if (!m) continue;
    const scene = ((m[1].match(/^场次\s*([^\sP,，]+)/) || [])[1] || '').trim();
    const ids = [];
    const re = /(P\d+)\s*(?:[-–~]\s*(P\d+))?/g;
    let mm;
    while ((mm = re.exec(m[1])) !== null) {
      const nFrom = Number(mm[1].slice(1));
      const nTo = mm[2] ? Number(mm[2].slice(1)) : nFrom;
      const width = mm[1].length - 1;
      if (nTo < nFrom) continue;
      for (let i = nFrom; i <= nTo; i++) ids.push('P' + String(i).padStart(width, '0'));
    }
    if (ids.length > 0) out.push({ scene, ids, raw: m[1].trim() });
  }
  return out;
}

/** 认领拍预估秒数：台词按实测校准上限 3.2 字/秒 + 0.4s 发酵；动作拍 2.5s。 */
function estimateClaimSeconds(ids, beats) {
  let s = 0;
  for (const id of ids) {
    const b = beats.get(id);
    if (!b) continue;
    if (b.type === '台词') {
      const chars = (b.dialogue || '').replace(/\s/gu, '').length;
      s += chars / 3.2 + 0.4;
    } else {
      s += 2.5;
    }
  }
  return s;
}

const norm2 = (s) => s.replace(/\s+/gu, '');

/**
 * 钩子具象门（v5.18.0 · --beats 时随带执行）。来源：船长套件 hook-open。
 *
 * 🔴 声明式 opt-in，不是无条件门：包首写 `【钩子门】查（窗口 N）` 才启用。
 * 理由（与 `叙事层_剧本门控与台词.md` 的既有裁决一致）：「黄金 3 秒」是**信息流平台适配**，
 * 文艺短片可以慢开场——把钩子落点做成无条件硬门，等于把信息流适配强加给文艺片。
 * 所以：① 国内剧/海外剧（信息流短剧）**默认应声明并查**；② 解说叙事类与「其他」（文艺片/毕设/
 * 公益/纪录）不声明即不查——**报告不出声不代表通过，是「本门不适用」**（文档纪律，不加噪声码）。
 *
 * 启用后查两条：
 *   E-HOOK-UNDECLARED     清单里没有任何 HOOK 标记（钩子只写了类型标签，没落到具体拍位）
 *   E-HOOK-OUT-OF-WINDOW  HOOK 所在拍位超出窗口（默认 3 拍，声明可覆盖）
 * 多枚 HOOK 取最早一枚判定；窗口按「清单行序」算（pos），与 captain 的 [场,拍] 等价。
 */
function auditHookGate(pkgText, beats, issues) {
  const decl = pkgText.match(/【钩子门】\s*[：:]?\s*查\s*(?:[（(]\s*窗口\s*(\d+)\s*[）)])?/);
  if (!decl) return;                       // 未声明：不适用，不出声（基线零影响）
  const window = decl[1] ? Number(decl[1]) : 3;
  const hooks = [...beats.entries()].filter(([, b]) => b.hook);
  if (hooks.length === 0) {
    issues.push({ level: 'error', code: 'E-HOOK-UNDECLARED',
      msg: `包首声明了【钩子门】查，但节拍清单里没有任何 HOOK 标记`,
      hint: '在兑现钩子具象的那一拍加第 5 段标记：P01｜场次1｜画面事件｜动作｜HOOK' });
    return;
  }
  const first = hooks[0];
  if (first[1].pos > window) {
    issues.push({ level: 'error', code: 'E-HOOK-OUT-OF-WINDOW',
      msg: `钩子拍「${first[0]}」落在第 ${first[1].pos} 拍，超出前 ${window} 拍窗口`,
      hint: '冷开场先给钩子的具象；或按项目类型评估后把窗口调宽（【钩子门】查（窗口 N））' });
  }
}

/**
 * 爽点配方门（v5.20.0 · --beats 时随带执行）。来源：《单王》爆款管线爽点配方 S01~S07
 * （2026-10-17 检索吸收）。
 *
 * 🔴 声明式 opt-in + 三条枷锁（与 叙事层 §九的既有裁决一致）：
 *    liqi 明确拒绝过信息流爽点铁律（「第 9 节拍必须 9.5+ 反杀」——对文艺片/毕设/公益是反向伤害）。
 *    本门是**带枷锁的吸收**：① 只对赛道①国内剧（信息流短剧）适用；② 包首写
 *    `【爽点门】查` 才启用，不声明 = 本门不适用（不是通过）；③ **全 WARN 不起 ERROR**——密度与多样性是语义参量，
 *    阻断会把爽点逼成注水（同 N2 情节点密度的严重度品级）。
 * 启用后查三条（都要 --beats，因为 S 编号标在拍行）：
 *   W-SHUANGDIAN-NONE      声明了但拍行里 0 个 S 编号（没标 = 无法统计，不是通过）
 *   W-SHUANGDIAN-SPARSE    爽点密度 <1 个/15s（一个 15s 段里没有任何爽点，出片就是空镜）
 *   W-SHUANGDIAN-MONOTYPE  只用了一种爽点配方（多样性不足，第三集起观众疲劳）
 */
function auditShuangdianGate(raw, beats, blocks, issues) {
  if (!/【爽点门】/.test(raw)) return;   // 未声明：不适用，不出声（基线零影响）
  const SD_RE = /\bS0[1-7]\b/g;
  const codes = new Set();
  let hits = 0;
  for (const [, b] of beats.entries()) {
    const m = (b.content || '').match(SD_RE);
    if (m) {
      hits += m.length;
      for (const c of m) codes.add(c);
    }
  }
  if (hits === 0) {
    issues.push({ level: 'warn', code: 'W-SHUANGDIAN-NONE',
      msg: '包首声明了【爽点门】查，但节拍清单里 0 个 S 编号',
      hint: '在兑现爽点的那一拍描述里标配方编号（S01~S07，见 叙事层 §九）；'
          + '或找清本片实际不适用本门（不声明即不查）' });
    return;
  }
  // 密度口径与 N2 情节点密度同源：个数 / (总秒/15s)——不自造数值。
  let total = 0;
  for (const b of blocks) {
    const dm = (b.lines[0] || '').match(/（\s*(\d+)\s*s/);
    if (dm) total += Number(dm[1]);
  }
  if (total > 0) {
    const per15 = hits / (total / 15);
    if (per15 < 1) {
      issues.push({ level: 'warn', code: 'W-SHUANGDIAN-SPARSE',
        msg: `爽点密度 ${per15.toFixed(2)} 个/15s，低于 1（全片 ${total}s · ${hits} 个爽点）`,
        hint: '一个 15s 段里没有任何爽点，出片就是一段好看的空镜；补法只走四条正路'
            + '（补兑现/补反转/补代价/补关系变化），禁拉长文采凒字' });
    }
  }
  if (codes.size < 2) {
    issues.push({ level: 'warn', code: 'W-SHUANGDIAN-MONOTYPE',
        msg: `只用了 ${codes.size} 种爽点配方（${[...codes].join('、') || '无'}）`,
        hint: '爽点类型多样性不足——同一配方用三集，观众第三集起疲劳；配方表见 叙事层 §九' });
  }
}

/**
 * 包级节拍对账（--beats 给出时执行）。规则码：
 *   E-BEAT-CLAIM-UNKNOWN   认领了清单里不存在的 P
 *   E-BEAT-CLAIM-OVERLAP   同一拍被多个镜认领
 *   E-BEAT-CLAIM-GAP       清单里的拍有遗漏
 *   E-BEAT-SCENE-MISMATCH  认领行场次与拍场次对不上
 *   E-BEAT-LINE-MISSING    台词拍的台词原文没有逐字进镜
 *   W-BEAT-TIME-OVERRUN    认领拍预估时长超镜长 15%
 *   W-BEAT-CLAIM-MISSING   部分镜有认领行、部分没有（老包迁移期提醒）
 *   E-HOOK-UNDECLARED / E-HOOK-OUT-OF-WINDOW  钩子具象门（v5.18.0，声明式 opt-in）
 */
function auditBeatClaims(blocks, beats, issues) {
  const claimed = new Map(); // P -> 镜块标题
  const blocksWithClaim = [];
  const blockDurs = new Map();

  for (const b of blocks) {
    const title = (b.lines[0] || '(无标题)').trim();
    const claims = parseClaimLines(b.lines);
    if (claims.length > 0) blocksWithClaim.push(title);
    const durM = title.match(/（\s*([\d]+)\s*s/);
    blockDurs.set(title, durM ? Number(durM[1]) : null);
    const blockText = norm2(b.lines.join('\n'));

    for (const c of claims) {
      for (const id of c.ids) {
        if (!beats.has(id)) {
          issues.push({ level: 'error', code: 'E-BEAT-CLAIM-UNKNOWN', msg: `认领了清单里不存在的拍「${id}」`, where: title, hint: '检查节拍清单编号与认领行是否一致' });
          continue;
        }
        if (claimed.has(id)) {
          issues.push({ level: 'error', code: 'E-BEAT-CLAIM-OVERLAP', msg: `拍「${id}」被重复认领：「${claimed.get(id)}」与「${title}」`, where: title, hint: '每个节拍被恰好一个镜头认领' });
        } else {
          claimed.set(id, title);
        }
        const beat = beats.get(id);
        // 场次对账（换景必换镜）
        const stripS = (s) => String(s).replace(/^场次/, '').trim();
        if (c.scene && stripS(beat.scene) !== stripS(c.scene)) {
          issues.push({ level: 'error', code: 'E-BEAT-SCENE-MISMATCH', msg: `拍「${id}」属于场次${stripS(beat.scene)}，认领行写的是场次${stripS(c.scene)}`, where: title, hint: '镜头不许跨场次——换景必换镜' });
        }
        // 台词拍逐字进镜
        if (beat.type === '台词' && beat.dialogue) {
          const d = norm2(beat.dialogue);
          if (d && !blockText.includes(d)) {
            issues.push({ level: 'error', code: 'E-BEAT-LINE-MISSING', msg: `拍「${id}」的台词未逐字进镜：「${beat.dialogue}」`, where: title, hint: '台词铁律一字不差；进镜后按投放面三写（时间线段内 + 镜行尾 + 声音设计）' });
          }
        }
      }
      // 时长预估
      const dur = blockDurs.get(title);
      const est = estimateClaimSeconds(c.ids, beats);
      if (dur && est > dur * 1.15 + 0.01) {
        issues.push({ level: 'warn', code: 'W-BEAT-TIME-OVERRUN', msg: `认领 ${c.raw} 预估 ${est.toFixed(1)}s，超出镜长 ${dur}s 的 15% 容差`, where: title, hint: '台词按 3.2 字/秒、动作按 2.5s/拍折算；超了先砍动作拍再压台词' });
      }
    }
  }

  // 遗漏检查：只对「已经在用认领」的包生效（全部镜都无认领行 = 老包，静默跳过）
  if (blocksWithClaim.length > 0) {
    const missing = [...beats.keys()].filter((id) => !claimed.has(id));
    if (missing.length > 0) {
      issues.push({ level: 'error', code: 'E-BEAT-CLAIM-GAP', msg: `${missing.length} 个节拍未被任何镜头认领：${missing.join('、')}`, where: '(包级)', hint: '剧本改了镜头没跟上；补镜或在认领行里补区间' });
    }
    const noClaim = blocks.filter((b) => parseClaimLines(b.lines).length === 0);
    if (noClaim.length > 0) {
      issues.push({ level: 'warn', code: 'W-BEAT-CLAIM-MISSING', msg: `${noClaim.length} 个镜块没有认领行：${noClaim.map((b) => (b.lines[0] || '').trim()).join('；')}`, where: '(包级)', hint: '同一包内认领要么全用要么全不用，部分认领对不了全账' });
    }
  }
}

// ---------------------------------------------------------------- 跨段首帧生产链
// 文本只能核对施工留痕，不能证明图片已实际上传或渲染结果正确；未留痕 = 未核验，不等于通过。
function auditFirstFrameChain(blocks, issues) {
  const FIRST_DECL = /@图片\s*\d+\s*作为首帧|以参考图\s*\S*\s*为首帧/;
  const BIND = /^\s*#\s*首帧绑定\s*[：:]\s*first_frame\s*$/m;
  const VERIFIED = /^\s*#\s*首帧来源\s*[：:].*实际尾帧[（(]\s*验收通过\s*[)）]/m;
  const HOLD = /首拍保持|保持首帧|维持首帧|首帧状态.*再|先保持.*首帧/;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const text = b.lines.join('\n');
    const title = b.lines[0] || '(无标题)';
    const hasFirst = FIRST_DECL.test(text);
    const hasVerified = VERIFIED.test(text);
    const prevHadAnchor = i > 0 && /接戏全景/.test(blocks[i - 1].lines.join('\n'));
    const refersTail = hasVerified || /上一段.*尾帧|上段.*尾帧|实际尾帧/.test(text) || prevHadAnchor;
    if (hasFirst && !BIND.test(text)) {
      issues.push({ level: 'warn', code: 'W-FIRST-FRAME-NOT-BOUND', where: title,
        msg: '正文声明了首帧，但参数区没有 # 首帧绑定：first_frame',
        hint: '在界面 / API 把该图上传角色设为 first_frame，并在正文外留痕；普通参考图不等于首帧锁定' });
    }
    if (refersTail && !hasVerified) {
      issues.push({ level: 'warn', code: 'W-FIRST-FRAME-UNVERIFIED', where: title,
        msg: '跨段首帧缺少“实际尾帧（验收通过）”来源记录',
        hint: '验收实际尾帧的全员数量、位置、朝向、关键持物与固定锚物；计划尾帧或未验收截图不得冒充合格接戏帧' });
    }
    if (refersTail && hasFirst && !HOLD.test(text)) {
      issues.push({ level: 'warn', code: 'W-FIRST-FRAME-NO-HOLD', where: title,
        msg: '跨段首帧没有首拍保持声明',
        hint: '首拍先维持首帧人物姿态、锚物关系和机位，再进入新动作；不要起点同时换机位、拉镜和多人位移' });
    }
  }
}

// ---------------------------------------------------------------- 主流程

/**
 * 纯函数核心：给原始文本 + 选项，返回 issues 与摘要。供 CLI 与 selftest 共用。
 * opts: { surface, beats(Map), official }
 */
function collectIssues(raw, opts = {}) {
  const surfaceArg = opts.surface || 'auto';
  const lines = raw.split(/\r?\n/);
  const blocks = splitBlocks(lines);
  // v5.37.1：段缝方式是**包级**声明（写在包首），而每条判定发生在镜块内。
  // 此前 checkBlock 看不到它 → 声明了 ②/③/④（硬切 / 空镜 / 技巧转场）的包仍被要求补「段末接戏全景」，误报一片。
  // 这里把包级取值提到模块变量，供镜块内的豁免判定读取；未声明则为 null（行为与改动前一致）。
  PKG_SEAM_MODE = (raw.match(/【段缝声明】\s*[①②③④1-4]/) || [''])[0]
    .replace(/[^\u2460-\u2463\d]/g, '') || null;
  const issues = [];
  const summary = [];
  // v5.37.1：锁①模型档位一次性解析好，逐块传下去 —— 时长门禁的数字来源必须全包一致。
  const model = resolveModel(raw, opts.model);

  // v6.14.0：节奏档位包级解析（opt-in——不声明不判，静默成功；出枚举报 W-PACE-TIER）
  PKG_PACE_TIER = null;
  const _paceM = raw.match(/【节奏档位】\s*[:：]?\s*([^\n｜|【】]{2,20})/);
  if (_paceM) {
    const _tier = _paceM[1].trim();
    if (PACE_TIERS.includes(_tier)) {
      PKG_PACE_TIER = _tier;
    } else {
      issues.push({ level: 'warn', code: 'W-PACE-TIER', where: '包首',
        msg: `节奏档位「${_tier}」不在四档枚举内`,
        hint: '四档：电影感中速 / 短视频中高密度 / 高密度动作或强钩子 / 慢节奏但高信息——'
            + '出枚举的档位无法对密度预算与复盘归因（写镜细则节奏档位节）' });
    }
  }

  for (const b of blocks) {
    summary.push(checkBlock(b, surfaceArg, issues, model));
  }
  auditFirstFrameChain(blocks, issues);

  // 节拍认领对账（--beats 可选门）
  if (opts.beats) {
    auditBeatClaims(blocks, opts.beats, issues);
    auditHookGate(raw, opts.beats, issues);   // v5.18.0 钩子具象门（声明式 opt-in）
    auditShuangdianGate(raw, opts.beats, blocks, issues);   // v5.20.0 爽点配方门（声明式 opt-in · 全 WARN）
  }

  // 官方 API 质量建议：中文 ≤500 字 / 英文 ≤1000 词——**opt-in（v6.4.2 实测裁决改回）**。
  // v6.0.2 曾改默认开，但 500 字是通用建议口径，不适用 30s 长段六段式（实测超出可正常生成），
  // 默认开导致每个 30s 段恒响 1 条（项目日志 1872 次、零修复动作=纯噪声）。
  // 内部额度是防爆硬上限，不是推荐写满；要跑官方建议时显式 opts.official=true / --official。
  if (opts.official === true) {
    for (const b of blocks) {
      const body = b.lines.filter((l) => !/^\s*(#|>|-{2,}\s*$)/.test(l)).join('\n');
      const cjk = (body.match(/[\u4e00-\u9fff]/g) || []).length;
      const words = (body.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
      if (cjk > PROMPT_LENGTH.cjkMax) {
        issues.push({
          level: 'warn',
          code: 'W-OFFICIAL-500',
          where: b.lines[0] || '未命名块',
          msg: `可复制正文含 ${cjk} 个汉字，超过官方 API 的 ${PROMPT_LENGTH.cjkMax} 字建议（官方措辞为「建议」，非硬限制；v5.45.0 已核原文）`,
          hint: '删减顺序：重复风格形容词 → 通用质量词 → 参考图里已有的背景 → 次要运镜 → 次要动作',
        });
      }
      if (words > PROMPT_LENGTH.enMax) {
        issues.push({
          level: 'warn',
          code: 'W-OFFICIAL-1000W',
          where: b.lines[0] || '未命名块',
          msg: `英文正文约 ${words} 词，超过官方 API 的 ${PROMPT_LENGTH.enMax} 词建议（官方措辞为「建议」，非硬限制）`,
          hint: '同上，按非必锁项从后往前删',
        });
      }
    }
  }

  return { issues, summary, model };
}

/**
 * --len 明细输出（v4.7.6）：按镜给出「节小计 + 最长行」，超标的点名到行。
 * 口径与门禁完全一致（同一套 bodyEndOf / capOf），不另起一把尺。
 */
function printLenReport(raw, topN) {
  const blocks = splitBlocks(raw.split(/\r?\n/));
  console.log('\n长度明细（--len）　口径：段头 → Must not/参数行之前，标点·空格·换行全计');
  console.log('─'.repeat(60));
  for (const b of blocks) {
    const d = lenDetail(b);
    const flag = d.over > 0 ? `超 ${d.over} 字` : `余 ${-d.over} 字`;
    console.log(`\n${d.title}　${d.capLabel}　${d.total}/${d.cap}　${flag}`);
    console.log('  节小计（降序）：');
    for (const [k, v] of d.sections) {
      console.log(`    ${padTo(k, 12)}${String(v).padStart(5)}`);
    }
    console.log(`  最长 ${Math.min(topN, d.rows.length)} 行（降序）：`);
    for (const r of d.rows.slice(0, topN)) {
      console.log(`    L${String(r.line).padStart(4)}  ${String(r.len).padStart(5)}  ${clipTo(r.text, 44)}`);
    }
  }
  console.log('\n  删字顺序：重复风格形容词 → 通用质量词 → 参考图已有的背景 → 次要运镜 → 次要动作 → 推测性情绪标签');
  console.log(`  （--len <N> 可调最长行条数，默认 8）`);
}

/** 投放面自识别：H3 六段式包喂给 Seedance 校验器会整包误报，必须先拦下。
 *  v5.37.1：补 base 三字段识别 —— `integrated_multimodal_description` 只存在于 H3，
 *  旧实现只认六段名，T2VA/I2VA 包会漏过哨兵、被当成 Seedance 包刷一片 E-SECTION-MISSING。 */
function isH3Package(raw) {
  if (/^\s*integrated_multimodal_description\s*:/m.test(raw)) return true;
  if (/^\s*(subject_definitions|retention_analysis|detailed_description)\s*:/m.test(raw)
      && /\[Shot\s+\d+\]/.test(raw)) return true;
  return false;
}

// 两个脚本的 --surface 不是同一套枚举（v5.6.5 澄清：投放面是段头骨架族，脚本侧取值另有分工）：
//   本脚本是「骨架族」：intl（国际面 Shot N）/ cn（国内面【时间轴】）/ auto（自识别）
//   check_style.mjs 是「面别」：h3 / seedance / cn / seedream
// 用户照 SKILL.md 的投放面名传参时，两边会互相不认——这里做跨脚本容错，主值不变。
// 2.5 面 / 2.0 面不能映射到 intl 或 cn：2.5 面两种骨架都能用，猜了就是替用户做决定，一律落 auto。
function normalizeSurface(v) {
  // 剥掉空格/_/-/. ：让「2.5 面」「Seedance-2.5」都归一，版本号写法差异不进判定
  const s = String(v || '').toLowerCase().replace(/[\s_.\-]/g, '');
  if (!s || s === 'auto' || s === '默认') return 'auto';
  if (/^(intl|国际|国际面)$/.test(s)) return 'intl';
  if (/^(cn|国内|国内面|domestic)$/.test(s)) return 'cn';
  // 2.5 面 / 2.0 面 → auto：两种骨架它都能用，猜一个就是替用户做决定，交给自识别
  if (/^(seedance|seedance面|seedance25|25|25面|seedance20|20|20面)$/.test(s)) return 'auto';
  if (/^(h3|h3面|minimax|minimaxh3|h3max)$/.test(s)) return 'h3';
  return s;  // 未知值原样传下去，让下游自己报错，别在这里吞掉
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log('用法: node check_prompt.mjs <file> [--surface intl|cn|auto] [--model auto|2.5|2.0|h3|h3max]');
    console.log('      [--strict] [--all] [--no-official] [--beats <节拍清单>] [--len [N]] [--no-log]');
    console.log('      [--lang <intl|cn>] [--target <seedance|h3|seedance-off>]');
    console.log('说明: 本脚本只校 Seedance 面。投 MiniMax H3 面的包请改跑 check_prompt_h3.mjs。');
    console.log(`      --model 指定锁①模型版本，决定单条时长硬上限（默认 auto：从包内【模型版本】/`);
    console.log(`      【三锁】模型= 识别；识别不到按最严 ${FALLBACK_LIMIT.cap}s 兜底，并在消息里注明「锁①未声明」）。`);
    console.log(`      硬参数取自 ${MODEL_LIMITS_SRC}，与 audit_project.py 同源；可用档位：`
      + Object.keys(MODEL_LIMITS).join(' / '));
    console.log('      --lang 是 --surface 的旧别名（同值）；--target h3 会触发 E-WRONG-SCRIPT 早退，');
    console.log('      --target seedance-off 强行按 Seedance 面校验；');
    console.log('      --strict 把 warning 也视为失败；--all 展开每码全量明细（默认每码最多 4 条）；');
    console.log('      --beats 对账节拍认领（E-BEAT-*，可选门，格式见 SKILL.md Step 3）；');
    console.log('      --len 出长度明细（每镜字数/额度、节小计、最长行，超字时直接点名到行）；');
    console.log('      官方中文 500 字 / 英文 1000 词质量建议默认关闭（--official 显式开启；建议级非硬限制，500 字口径不适用 30s 长段）；--no-official 为兼容 no-op。');
    console.log('      默认把运行结果追加到被校验文件同目录的 .gates.jsonl（--no-log 关闭），');
    console.log('      node gates_stats.mjs 聚合统计。');
    process.exit(2);
  }
  const file = argv[0];
  // --lang 是 --surface 的旧别名（同值）
  let surfaceArg = normalizeSurface(argv.includes('--surface') ? argv[argv.indexOf('--surface') + 1]
    : (argv.includes('--lang') ? argv[argv.indexOf('--lang') + 1] : 'auto'));
  let targetArg = (argv.includes('--target') ? argv[argv.indexOf('--target') + 1] : 'seedance');
  // 传了 H3 面名等同于 --target h3：本脚本校不了 H3 包，直接早退而不是硬跑出误报。
  if (surfaceArg === 'h3') { targetArg = 'h3'; surfaceArg = 'auto'; }
  // v6.4.2：默认关（opt-in）。--no-official 保留为兼容 no-op。
  const official = argv.includes('--official') && !argv.includes('--no-official');
  const strict = argv.includes('--strict');
  const showAll = argv.includes('--all');
  const noLog = logDisabled(argv);
  const beatsArg = (argv.includes('--beats') ? argv[argv.indexOf('--beats') + 1] : null);
  // v5.37.1：--model 决定锁①硬参数。取值非法时不静默回落（静默回落 = 判据来源变成黑箱），
  // 而是落最严兜底并在报告头写明「--model 不是已知型号，已忽略」。
  const modelArgRaw = argv.includes('--model') ? argv[argv.indexOf('--model') + 1] : 'auto';
  const modelArg = (modelArgRaw && !modelArgRaw.startsWith('-')) ? modelArgRaw : 'auto';
  // --len 可选带条数：--len / --len=15 / --len 15
  const lenIdx = argv.findIndex((a) => a === '--len' || a.startsWith('--len='));
  const wantLen = lenIdx !== -1;
  let lenTop = 8;
  if (wantLen) {
    const inline = argv[lenIdx].startsWith('--len=') ? argv[lenIdx].slice(6) : null;
    const next = inline ?? (argv[lenIdx + 1] && /^\d+$/.test(argv[lenIdx + 1]) ? argv[lenIdx + 1] : null);
    if (next) lenTop = Math.max(1, Math.min(100, Number(next)));
  }
  const MAX_PER_CODE = showAll ? Infinity : 4;

  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`E-INPUT: 无法读取 ${file} —— ${e.message}`);
    process.exit(2);
  }
  // v5.32.0：2MB 防护改按**字节**算——旧写法 raw.length 是 UTF-16 码元数（≈字符数），
  // 中文 3 字节/字符，2M 字符 ≈ 6MB 字节才触发，防护被放宽三倍（第三阶段可执行层实测抓到）。
  if (Buffer.byteLength(raw, 'utf8') > 2 * 1024 * 1024) {
    console.error('E-INPUT: 文件超过 2MB');
    process.exit(2);
  }
  // v5.32.0：空文件假绿——零块时切分函数会把整个文件当一块（有意设计，服务文档型示例），
  // 但空文件因此「全部通过」（可执行层实测：rc=0 零输出）。空包不是通过，与 Z 门同口径。
  if (!raw.trim()) {
    console.error('E-INPUT: 文件是空的——空包不是通过（Z 门同口径）。');
    console.error('  镜块头需形如「镜 1｜标题 5s」或「段 1｜标题 15s」。');
    process.exit(2);
  }

  // 节拍清单（可选门）
  let beats = null;
  // v5.37.8：`--beats auto` = 就近找 beats.txt / 节拍清单.txt。
  // 为什么要有这个值：`audit_project --auto` 会在提示里叫你「另跑 check_prompt --beats <路径>」，
  // 可那个路径常常得手抄一遍（`examples/实战_梦中人_场1/beats.txt` 这种）。抄错、抄漏、
  // 或者干脆不跑，都会让节拍认领门静默缺席——而「没跑」和「跑了没问题」在屏幕上长得一样。
  // 只就近找，不猜位置：找不到就报错退出，**不静默降级成「没给 --beats」**。
  let beatsPath = beatsArg;
  if (beatsArg === 'auto') {
    const dir = path.dirname(path.resolve(file));
    beatsPath = null;
    for (const n of ['beats.txt', '节拍清单.txt']) {
      const p2 = path.join(dir, n);
      if (existsSync(p2)) { beatsPath = p2; break; }
    }
    if (!beatsPath) {
      console.error(`E-BEATS-AUTO-NOT-FOUND: --beats auto 在 ${dir} 里没找到 beats.txt / 节拍清单.txt。`);
      console.error('  就近只找包所在目录（与 audit_project 的自动发现同一约定，不递归、不猜）。');
      console.error('  要么把清单放到包旁边，要么显式给路径：--beats <节拍清单.txt>；');
      console.error('  确实不查节拍认领时，去掉 --beats 即可（去掉等于「本门没跑」，不是「本门通过」）。');
      process.exit(2);
    }
    console.log(`[beats] auto → ${beatsPath}`);
  }
  if (beatsPath) {
    try {
      beats = parseBeatsFile(readFileSync(beatsPath, 'utf8'));
    } catch (e) {
      console.error(`E-INPUT: 无法读取节拍清单 ${beatsPath} —— ${e.message}`);
      process.exit(2);
    }
    if (beats.size === 0) {
      console.error('E-INPUT: 节拍清单里没有解析出任何 P 编号行。');
      console.error('  每行格式：P01｜场次1｜画面事件｜动作 或 P02｜场次1｜甲（对白）：台词原文｜台词');
      process.exit(2);
    }
  }

  // 投放面自识别：H3 六段式包喂进来会整包误报 E-SECTION-MISSING，必须在开跑前拦掉。
  // 这是历史坑——拿错脚本得到一堆红，用户会以为包写错了。
  if (isH3Package(raw) && targetArg !== 'seedance-off') {
    console.error('E-WRONG-SCRIPT: 这份文件看起来是 MiniMax H3 六段式包（检测到 H3 字段与 [Shot N] 段头）。');
    console.error('  check_prompt.mjs 只校 Seedance 面，跑 H3 包会整包误报 E-SECTION-MISSING。');
    console.error('  请改跑：node scripts/check_prompt_h3.mjs <file> [--strict] [--all]');
    console.error('  确认要强行按 Seedance 面校验时，追加 --target seedance-off。');
    process.exit(2);
  }
  if (targetArg === 'h3') {
    console.error('E-WRONG-SCRIPT: 指定了 --target h3，本机不能用 check_prompt.mjs 校 H3 包。');
    console.error('  请改跑：node scripts/check_prompt_h3.mjs <file>');
    process.exit(2);
  }

  const { issues, summary, model } = collectIssues(raw, { surface: surfaceArg, beats, official, model: modelArg });

  console.log(`\n校验：${file}`);
  console.log(`镜块：${summary.length}　投放面：${surfaceArg}`);
  // 判据出处单独一行：出红时第一个要核的就是「拿哪一档参数判的」。
  console.log(`锁①：${model.key || '未声明'}`
    + `（${model.limit.label}｜硬上限 ${model.limit.cap}s｜放行线 ${Math.min(model.limit.soft, model.limit.cap)}s`
    + `${model.limit.floor ? `｜下限 ${model.limit.floor}s` : ''}）　来源：${model.via}`);
  console.log('─'.repeat(60));
  for (const s of summary) {
    console.log(`  ${s.title}　段数 ${s.segs}　时长 ${s.duration ?? '?' }s`);
  }
  console.log('─'.repeat(60));

  if (wantLen) printLenReport(raw, lenTop);

  if (issues.length === 0) {
    console.log('\n✅ 全部通过（0 error / 0 warning）\n');
    if (!noLog) appendGateLog({ tool: 'check_prompt.mjs', file, exit: 0, issues: [], target: surfaceArg });
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
  console.log('提示：本工具只做机械判定，审美与逻辑仍按 SKILL.md Step 4 人工复核。\n');

  const exitCode = errors.length > 0 || (strict && warns.length > 0) ? 1 : 0;
  if (!noLog) appendGateLog({ tool: 'check_prompt.mjs', file, exit: exitCode, issues, target: surfaceArg });
  process.exit(exitCode);
}

// ---------------------------------------------------------------- 导出与入口
// 可导入：selftest_check_prompt.mjs 进程内调用 collectIssues / isH3Package，
// 免 spawn（沙箱里 spawn 子进程会 EBUSY）。直接运行时才进 CLI。

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) main();

export {
  collectIssues, checkBlock, splitBlocks, parseSegments,
  parseBeatsFile, parseClaimLines, auditBeatClaims, auditHookGate, auditShuangdianGate, isH3Package,
  bodyEndOf, capOf, lenDetail,
  // v5.37.1：锁①单一事实源的对外口子（selftest 用它守护「两台机同口径」）
  MODEL_LIMITS, FALLBACK_LIMIT, detectModel, resolveModel, beatBand,
};
