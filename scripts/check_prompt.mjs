#!/usr/bin/env node
/**
 * liqi-prompt 机械校验器
 *
 * 用法：
 *   node check_prompt.mjs <file> [--surface intl|cn|auto] [--strict]
 *
 * 退出码：0 = 无 error（warning 不阻断）；1 = 存在 error；2 = 输入异常
 *
 * 设计原则：只做「模型/正则可以机械判定」的检查，不做审美判断。
 * 审美与逻辑仍由 SKILL.md Step 4 的人工/LLM 环节负责。
 */

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------- 配置

// 运镜原语群：不同群混用会导致模型抖动/扭曲
const CAMERA_GROUPS = {
  translation: /\b(dolly|truck|pedestal)\b|推(进|近|镜)?|后拉|拉远|水平(推进|移动)|横移|缓推|缓拉|向前推|向后拉/gi,
  rotation: /\b(pan|tilt|roll)\b|摇(镜|摄)?|俯仰|左右摇|水平右摇|水平左摇|上摇|下摇/gi,
  lens: /\b(zoom|rack focus|pull focus)\b|变焦|拉焦|焦点(变换|转移)/gi,
  orbit: /\b(orbit|arc)\b|环绕|弧(形)?移|绕(行|拍)/gi,
  crane: /\b(crane|boom)\b|升降(镜)?|摇臂/gi,
  handheld: /手持|肩扛|\bhandheld\b|\bsteadicam\b/gi,
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

// 时长 → 段数带宽
// Seedance 2.5 面单条上限 30s（sd25-pe 官方口径）；旧面仍建议 20s 内
function beatBand(dur) {
  if (dur <= 4) return { min: 1, max: 1, label: '2-4s：单一动作，不分段', hard: false, soft20: false };
  if (dur <= 9) return { min: 2, max: 3, label: '5-9s：2-3 段', hard: false, soft20: false };
  if (dur <= 20) return { min: 3, max: 5, label: '10-20s：3-5 段', hard: false, soft20: false };
  if (dur <= 30) return { min: 4, max: 6, label: '21-30s：4-6 段（已越过 20s 滑窗红线，建议拆分）', hard: false, soft20: true };
  return { min: -1, max: -1, label: '30s+：超出 Seedance 2.5 单条硬上限，强制滑窗拆分（每窗 ≤20s）', hard: true, soft20: false };
}

// ---------------------------------------------------------------- 解析

function parseSegments(lines, surface) {
  const segs = [];
  // 起止时间统一支持两种写法：秒（0-7s）或 分:秒（00:00-00:07）
  const T = String.raw`(\d{1,2})(?::(\d{2}))?`;
  const patterns = [
    // 国内面：【时间轴】0-7s： / 【时间轴】00:00-00:07：
    { re: new RegExp(`^【时间轴】\\s*${T}\\s*[-–~]\\s*${T}\\s*s?\\s*[：:]`), kind: 'cn' },
    // 国际面：Shot 1 (0-7s): / Shot 1 (00:00-00:07):
    { re: new RegExp(`^Shot\\s*\\d+\\s*\\(\\s*${T}\\s*[-–~]\\s*${T}\\s*s?\\s*\\)`, 'i'), kind: 'intl' },
    // 旧格式（已废弃，仅用于检测旧稿）：0:00-0:07 · 第X段 ·
    { re: /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*·/, kind: 'legacy' },
  ];

  lines.forEach((line, idx) => {
    for (const p of patterns) {
      const m = line.match(p.re);
      if (!m) continue;
      // 统一按秒解析：(mm):(ss) 或 (ss)
      const toSec = (a, b) => (b !== undefined ? Number(a) * 60 + Number(b) : Number(a));
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
const DIALOGUE_MARK = /(（[^）]{2,}）\s*[：:]?\s*$)|对白|心声|旁白|开口|说出|说道|念白|台词|内心独白/;

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

// ---------------------------------------------------------------- 检查

function checkBlock(block, surface, issues) {
  const lines = block.lines;
  const text = lines.join('\n');
  const title = lines[0] || '(无标题)';

  const durMatch = title.match(/（\s*([\d]+)\s*s/);
  const duration = durMatch ? Number(durMatch[1]) : null;

  // 正文边界：到 Must not / 参数行 / 分隔线 为止
  const bodyEndRes = [
    /^Must\s*not/i,
    /^(?:#|【参数】)\s*(duration|ratio|输出规格|后期)/i,
    /^——\s*以下不进正文/,
    /^技术规格[：:]/,
  ];
  let bodyEnd = lines.length;
  for (let i = 1; i < lines.length; i++) {
    if (bodyEndRes.some((r) => r.test(lines[i]))) { bodyEnd = i; break; }
  }
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
  const segs = parseSegments(lines, surface);
  if (segs.length > 0) {
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
    // 骨架混用检测
    const kinds = new Set(segs.map((s) => s.kind));
    if (kinds.size > 1) {
      add('E-SKELETON-MIX', `段头骨架混用：${[...kinds].join(' + ')}`,
        '同一提示词内只能用一套骨架（国内面【时间轴】或国际面 Shot N）');
    }
    if (surface === 'cn' && segs[0].kind !== 'cn') {
      warn('W-SURFACE-MISMATCH', '指定国内面但段头非【时间轴】骨架', '国内面应改用【时间轴】0-7s：画面｜镜头｜音效');
    }
    if (surface === 'intl' && segs[0].kind !== 'intl') {
      warn('W-SURFACE-MISMATCH', '指定国际面但段头非 Shot N 骨架', '国际面应改用 Shot 1 (0-7s): 形式');
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
  }

  // --- 2. 段数带宽
  if (duration !== null) {
    const band = beatBand(duration);
    if (band.hard) {
      add('E-OVER-30S', `单提示词 ${duration}s 超出 Seedance 2.5 单条硬上限 30s`,
        '强制滑窗拆分，每窗 ≤20s（30s→2 窗，45s→3 窗）');
    } else {
      if (band.soft20) {
        warn('W-OVER-20S', `${duration}s 已越过 20s 滑窗红线，20s 之后模型易循环或丢动作`,
          '建议滑窗拆分；确需单条时把每段动作压到最简，并重点复核后半段是否重复');
      }
      if (segs.length > band.max) {
        warn('W-BEAT-BUDGET', `${duration}s 分了 ${segs.length} 段，超出上限（推荐 ${band.label}）`,
          '段数过多会导致动作被压缩或跳过');
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
        add('E-NEGATION-IN-BODY', `正文出现${p.name}：「${m[0]}」`,
          'Naming a flaw plants it —— 改为正向锁定，否定式只留在 Must not 行');
      }
    }
  }

  // --- 5. 台词双写一致性
  // 2.5 面（sd25-pe）的时间线在【事件脚本】段内，与 liqi 原格式的「时间线分镜」等价
  const tlSec = sliceSection(lines, /时间线分镜|^时间线[：:]|多镜时间线|^【事件脚本】/, [/^声音设计/, /^刚性约束/, /^Must\s*not/i, /^(?:#|【参数】)\s*(duration|ratio)/i, /^——\s*以下不进正文/, /^【保持一致】/]);
  const sdSec = sliceSection(lines, /^声音设计/, [/^刚性约束/, /^Must\s*not/i, /^(?:#|【参数】)\s*(duration|ratio)/i, /^——\s*以下不进正文/]);
  if (tlSec && sdSec) {
    const a = extractQuoted(tlSec.text);
    const b = extractQuoted(sdSec.text);
    for (const line of a) if (!b.includes(line)) {
      add('E-DIALOGUE-MISSING-IN-SOUND', `台词只见于时间线，声音设计缺失：「${line}」`, '台词必须双写且逐字一致');
    }
    for (const line of b) if (!a.includes(line)) {
      add('E-DIALOGUE-MISSING-IN-TIMELINE', `台词只见于声音设计，时间线缺失：「${line}」`, '台词必须双写且逐字一致');
    }
  } else if (extractQuoted(text).length > 0) {
    if (!tlSec) add('E-SECTION-MISSING', '存在台词但缺少「时间线分镜」小节', '台词须在时间线对应段内出现一次');
    if (!sdSec) add('E-SECTION-MISSING', '存在台词但缺少「声音设计」小节', '台词须在声音设计中出现一次');
  }

  // --- 6. 角色内联锁定
  // 整体风格为多行小节，需整段捕获（只读首行会误报）
  // 2.5 面的【主体与关系】段承担等价的内联锁定职责，一并计入
  const styleSec = sliceSection(lines, /^整体风格[：:]/, [/^本镜光色基调/, /^光色基调/, /^时间线/, /^声音设计/, /^刚性约束/, /^【事件脚本】/]);
  const relationSec = sliceSection(lines, /^【主体与关系】/, [/^【事件脚本】/, /^声音设计/, /^刚性约束/, /^【保持一致】/]);
  const styleText = (styleSec ? styleSec.text : '') + '\n' + (relationSec ? relationSec.text : '');
  const castLine = lines.find((l) => /^场景[：:]/.test(l) && l.includes('人物'));
  if (castLine) {
    const cast = (castLine.split('人物：')[1] || '')
      .split(/[、,，]/)
      .map((s) => s.replace(/（[^）]*）/g, '').trim())   // 去掉「野狗（局部）」的括注
      .filter(Boolean);
    for (const c of cast) {
      if (c && !styleText.includes(c)) {
        add('E-IDENTITY-NOT-INLINE', `人物「${c}」未在整体风格小节内联锁定`, '逐镜会被单独复制，角色外观必须内联');
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
  const isMerged = /整合/.test(title);
  // 分场景给额（v2.0 封测修正）：T2V 无参考图时必须全量内联出场对象外观，
  // 比 I2V 多出约 100 字是模板要求的必然结果，不是写作者的冗余。
  // 实测：严格按模板写、零冗余的 T2V 单镜为 899 字符，按旧的统一 800 卡会误报且删无可删。
  const hasRefImg = /@图片\s*\d+|参考图|锚「/.test(body);
  const CAP = isMerged ? 4800 : (hasRefImg ? 800 : 1000);
  const capLabel = isMerged ? '整合镜' : (hasRefImg ? '单镜·I2V（有参考图）' : '单镜·T2V（无参考图）');
  const bodyLen = body.trim().length;
  if (bodyLen > CAP) {
    warn('W-LENGTH-CAP', `可复制正文 ${bodyLen} 字符，超出上限 ${CAP}（${capLabel}）`,
      '必须删到达标。顺序：重复风格形容词 → 通用质量词 → 参考图里已有的背景 → 次要运镜 → 次要动作 → 推测性情绪标签。'
      + (hasRefImg ? '' : ' 无参考图时优先压缩内联外观：只留可辨识特征，删掉与动作无关的静态描述。'));
  }

  // --- 12. 上下文污染词（v2.0 新增）
  // 逐镜会被单独投喂，模型看不到上一镜。跨镜指代写进正文等于无效指令。
  // 合法例外：整合段的「接上段（机制）」是同一次生成内部的段间接口，先整行排除再扫。
  const leakText = bodyNoDialogue
    .split('\n')
    .filter((l) => !/接上(一)?段/.test(l))
    .join('\n');
  const LEAK_RE = /仍穿着|与之前相同|如前所述|如上所述|同上|前一镜|上一镜|参考上一镜|接上/;
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
    if (lastLen > 0 && (lastLen < 3 || lastLen > 8)) {
      warn('W-BEAT-LENGTH', `末拍 ${lastLen}s，不在 3-8s 区间`,
        '<3s 转场来不及成立；>8s 末拍塞了太多动作，模型会丢后半段');
    }
  }

  // --- 15. 台词密度（v2.0 补）：段内台词字数 ÷ 段长
  // 旁白 / 慢板 ≤4.0 字每秒，对白 ≤5.0；>6.5 物理不可实现
  segs.forEach((sg, i) => {
    const q = extractQuoted(sg.text);
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
    ? (castLine.split('人物：')[1] || '')
        .split(/[、,，]/)
        .map((x) => x.replace(/（[^）]*）/gu, '').trim())
        .filter(Boolean)
    : [];
  if (castList2.length >= 2) {
    const GAZE = /朝向|视线|看向|锁定|躯干|面对|背对|侧身|目视/;
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

  return { title: title.trim(), segs: segs.length, duration };
}

// ---------------------------------------------------------------- 主流程

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log('用法: node check_prompt.mjs <file> [--surface intl|cn|auto] [--strict] [--all] [--official]');
    console.log('说明: 本脚本只校 Seedance 面。投 MiniMax H3 面的包请改跑 check_prompt_h3.mjs。');
    console.log('      --surface 为历史参数名（语言面），新脚本建议用 --lang；--target 为投放面占位参数。');
    process.exit(2);
  }
  const file = argv[0];
  const surfaceArg = (argv.includes('--surface') ? argv[argv.indexOf('--surface') + 1]
    : (argv.includes('--lang') ? argv[argv.indexOf('--lang') + 1] : 'auto'));
  const targetArg = (argv.includes('--target') ? argv[argv.indexOf('--target') + 1] : 'seedance');
  const official = argv.includes('--official');
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
  if (raw.length > 2 * 1024 * 1024) {
    console.error('E-INPUT: 文件超过 2MB');
    process.exit(2);
  }

  // 投放面自识别：H3 六段式包喂进来会整包误报 E-SECTION-MISSING，必须在开跑前拦掉。
  // 这是历史坑——拿错脚本得到一堆红，用户会以为包写错了。
  const looksH3 = /^\s*(subject_definitions|retention_analysis|detailed_description)\s*:/m.test(raw)
    && /\[Shot\s+\d+\]/.test(raw);
  if (looksH3 && targetArg !== 'seedance-off') {
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

  const lines = raw.split(/\r?\n/);
  const blocks = splitBlocks(lines);
  const issues = [];
  const summary = [];

  for (const b of blocks) {
    summary.push(checkBlock(b, surfaceArg, issues));
  }

  // 官方 API 附加门禁（opt-in）：中文 <=500 字 / 英文 <=1000 词。
  // SKILL.md 里写了这条规则但历史上没有机械兜底，只靠自觉，这里补上。
  if (official) {
    for (const b of blocks) {
      const body = b.lines.filter((l) => !/^\s*(#|>|-{2,}\s*$)/.test(l)).join('\n');
      const cjk = (body.match(/[\u4e00-\u9fff]/g) || []).length;
      const words = (body.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
      if (cjk > 500) {
        issues.push({
          level: 'warn',
          code: 'W-OFFICIAL-500',
          where: b.title || '未命名块',
          msg: `可复制正文含 ${cjk} 个汉字，超过官方 API 的 500 字上限`,
          hint: '删减顺序：重复风格形容词 → 通用质量词 → 参考图里已有的背景 → 次要运镜 → 次要动作',
        });
      }
      if (words > 1000) {
        issues.push({
          level: 'warn',
          code: 'W-OFFICIAL-1000W',
          where: b.title || '未命名块',
          msg: `英文正文约 ${words} 词，超过官方 API 的 1000 词上限`,
          hint: '同上，按非必锁项从后往前删',
        });
      }
    }
  }

  console.log(`\n校验：${file}`);
  console.log(`镜块：${summary.length}　投放面：${surfaceArg}`);
  console.log('─'.repeat(60));
  for (const s of summary) {
    console.log(`  ${s.title}　段数 ${s.segs}　时长 ${s.duration ?? '?' }s`);
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
  console.log('提示：本工具只做机械判定，审美与逻辑仍按 SKILL.md Step 4 人工复核。\n');

  process.exit(errors.length > 0 || (strict && warns.length > 0) ? 1 : 0);
}

main();
