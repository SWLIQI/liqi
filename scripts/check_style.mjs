#!/usr/bin/env node
/**
 * check_style.mjs —— 风格一致性门禁（P0）
 *
 * 用法
 *   node check_style.mjs <包.md> [--surface auto|h3|seedance|cn] [--registry <path>]
 *
 * 它查的是 SKILL.md 锁③ 里那五条 P0 门禁，外加三项一致性核对：
 *   S1 没声明 style_id                                    -> ERROR
 *   S2 style_id 未注册                                    -> ERROR
 *   S3 引用了 status=待建 的风格                            -> ERROR
 *   S4 同包出现多个不同 style_id                            -> ERROR
 *   S5 出现互斥风格的 marker 词（串轨）                     -> ERROR
 *   S6 头身比跨档                                          -> WARN（成人+孩童可并存，交人工判）
 *   S7 风格压句未逐字复用（含被改动/被翻译）                 -> ERROR
 *   S8 配色句未出现                                        -> WARN
 *   S9 压句语言与投放面不符（错面）                          -> ERROR
 *
 * style_id 的声明方式（三选一，写在包顶部或参数行）
 *   【风格】celshade-guoman-2d
 *   # style_id: celshade-guoman-2d
 *   style_id: celshade-guoman-2d
 *
 * 注册表查找顺序：--registry > 当前目录 style-registry.json > 包同目录 > skill 种子文件
 *
 * 退出码：有 ERROR 为 1，否则 0。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const file = argv.find(a => !a.startsWith('--'));
const getOpt = n => {
  const i = argv.indexOf(n);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const surfaceArg = (getOpt('--surface') || 'auto').toLowerCase();
const regArg = getOpt('--registry');
const SEED = path.join(__dirname, '..', 'references', 'style-registry.seed.json');

if (!file) {
  console.log('用法: node check_style.mjs <包.md> [--surface auto|h3|seedance|cn] [--registry <path>]');
  process.exit(0);
}
if (!fs.existsSync(file)) { console.log('文件不存在: ' + file); process.exit(2); }

const src = fs.readFileSync(file, 'utf8');

// ---------- 注册表 ----------
const cands = [regArg,
  path.join(process.cwd(), 'style-registry.json'),
  path.join(path.dirname(path.resolve(file)), 'style-registry.json'),
  SEED].filter(Boolean);
const regPath = cands.find(p => fs.existsSync(p));
if (!regPath) { console.log('找不到 style-registry.json，用 --registry 指定。'); process.exit(2); }
const REG = JSON.parse(fs.readFileSync(regPath, 'utf8'));
const STYLES = REG.styles || {};

// ---------- style_id ----------
const declPats = [
  /【风格】\s*([a-z0-9][a-z0-9-]*)/g,
  /#\s*style_id\s*[:：]\s*([a-z0-9][a-z0-9-]*)/gi,
  /(?:^|\s)style_id\s*[:=]\s*["']?([a-z0-9][a-z0-9-]*)/gi,
];
const found = new Map();
for (const re of declPats) {
  let m;
  while ((m = re.exec(src))) found.set(m[1], (found.get(m[1]) || 0) + 1);
}
const ids = [...found.keys()];

const issues = [];
const E = (code, msg) => issues.push({ lv: 'ERROR', code, msg });
const W = (code, msg) => issues.push({ lv: 'WARN', code, msg });
const I = (code, msg) => issues.push({ lv: 'INFO', code, msg });

// ---------- S1..S4 ----------
if (ids.length === 0) {
  E('S1-STYLE-UNDECLARED',
    '未声明 style_id。包顶部写【风格】<id> 或参数行 # style_id: <id>。可用 id: ' + Object.keys(STYLES).join(', '));
} else if (ids.length > 1) {
  E('S4-MULTI-STYLE', '同包出现多个 style_id：' + ids.join(' / ') + '。一个包只能有一个。');
}
const sid = ids[0];
const st = sid ? STYLES[sid] : null;
if (sid && !st) {
  E('S2-STYLE-UNREGISTERED', 'style_id「' + sid + '」不在注册表 ' + regPath + '。可用: ' + Object.keys(STYLES).join(', '));
}
if (st && st.status !== '已落值') {
  E('S3-STYLE-PENDING', '风格「' + sid + '」status=' + (st.status || '未知') +
    '。先按 references/风格锚_模板.md 落值并改 status，落值前引用是 P0。');
}

// ---------- 投放面 ----------
let surface = surfaceArg;
if (surface === 'auto') {
  if (/【生成目标】|【参考素材职责】/.test(src)) surface = 'seedance';
  else if (/detailed_description\s*:|\[Shot\s*\d/i.test(src)) surface = 'h3';
  else if (/【时间轴】/.test(src)) surface = 'cn';
  else surface = 'unknown';
}
const lang = surface === 'h3' ? 'en' : (surface === 'seedance' || surface === 'cn') ? 'cn' : null;

const norm = s => s.replace(/\s+/g, ' ').trim();
const nsrc = norm(src);
const countIn = needle => {
  if (!needle) return 0;
  const n = norm(needle);
  if (!n) return 0;
  let c = 0, i = 0;
  for (;;) { const k = nsrc.indexOf(n, i); if (k < 0) break; c++; i = k + n.length; }
  return c;
};
// 逐词定位第一个改动点：比只报「整句缺失」有用得多
const firstDiff = needle => {
  const words = norm(needle).split(' ');
  for (let i = 1; i <= words.length; i++) {
    if (!nsrc.includes(words.slice(0, i).join(' '))) {
      return '第 ' + i + ' 词起对不上，压句是「…' +
        words.slice(Math.max(0, i - 3), i + 2).join(' ') + '…」';
    }
  }
  return null;
};

// ---------- S5 串轨 ----------
// 否定上下文里的对方风格名是合法用法（负面词里必须点名禁什么），不能算串轨。
const NEG_CTX = /(禁|不要|不得|不许|排除|避免|去除|负面|不是|而非|区别于|Negative|Must\s*not|avoid|\bno\b|free\s+of|without)/i;
const lineOf = idx => {
  const a = src.lastIndexOf('\n', idx) + 1;
  const b = src.indexOf('\n', idx);
  return src.slice(a, b < 0 ? src.length : b);
};
const markerHits = words => {
  const hits = new Set();
  for (const w of words) {
    if (!w) continue;
    let i = 0;
    for (;;) {
      const k = src.indexOf(w, i);
      if (k < 0) break;
      const line = lineOf(k);
      const ctx = src.slice(Math.max(0, k - 40), k + w.length + 40);
      // 参数行、Must not 行、负面词行里的点名是合法用法，不算串轨
      const isNegLine = /^\s*#|Must\s*not|负面|排除|Negative/i.test(line);
      if (!isNegLine && !NEG_CTX.test(ctx)) hits.add(w);
      i = k + w.length;
    }
  }
  return [...hits];
};
if (st) {
  for (const [other, ost] of Object.entries(STYLES)) {
    if (other === sid) continue;
    const excl = (st.excludes || []).includes(other) || (ost.excludes || []).includes(sid);
    if (!excl) continue;
    const hits = markerHits(ost.marker_words || []);
    if (hits.length) {
      E('S5-CROSS-STYLE',
        '串轨：本包是 ' + sid + '，但出现互斥风格 ' + other + '（' + (ost.display_name || '') +
        '）的特征词：' + hits.join(' / ') + '（已排除负面词上下文中的点名）');
    }
  }
}

// ---------- S6 头身档 ----------
if (st) {
  const nums = new Set();
  for (const m of src.matchAll(/头身[比]?\s*[约]?\s*(\d+(?:\.\d+)?)\s*(?:[-–~至]\s*(\d+(?:\.\d+)?))?/g)) {
    nums.add(m[1] + (m[2] ? '-' + m[2] : ''));
  }
  for (const m of src.matchAll(/(\d+(?:\.\d+)?)\s*[-–~]\s*(\d+(?:\.\d+)?)\s*头身/g)) {
    nums.add(m[1] + '-' + m[2]);
  }
  const arr = [...nums];
  if (arr.length > 1) {
    W('S6-HEAD-MIX', '正文出现多个头身档：' + arr.join(' / ') + '。成人与孩童可并存，同一角色跨档不可接受，请人工确认。');
  } else if (arr.length === 1) {
    I('S6-HEAD', '头身档：' + arr[0] + '（注册表 heads_range=' + (st.heads_range || '-') + '）');
  }
}

// ---------- S7/S8 压句与配色句 ----------
if (st && st.tech_spec) {
  const ts = st.tech_spec;
  const press = lang === 'en' ? ts.render_en : ts.render_cn;
  const pal = lang === 'en' ? ts.palette_en : ts.palette_cn;
  if (lang === null) {
    W('S7-SURFACE-UNKNOWN', '判不出投放面，跳过压句比对。用 --surface h3|seedance|cn 指定。');
  } else {
    const cp = countIn(press);
    if (cp === 0) {
      const d = firstDiff(press);
      E('S7-PRESS-NOT-VERBATIM',
        '风格压句未逐字出现（投放面 ' + surface + '，应取风格锚 §' + (lang === 'en' ? '2.1 英文' : '2.2/2.3 中文') +
        '）。压句被改动或临场翻译了。' + (d ? d : '整句缺失'));
    } else {
      I('S7-PRESS', '风格压句逐字命中 ' + cp + ' 次（单元数应与之相等）');
    }
    const cq = countIn(pal);
    if (cq === 0) {
      const d = firstDiff(pal);
      W('S8-PALETTE-MISSING', '配色句未出现。压句与配色句必须同时出现，只写一句会色域漂移。' +
        (d ? d : '整句缺失，对照风格锚 §2.1/2.2 的配色补充句'));
    } else {
      I('S8-PALETTE', '配色句命中 ' + cq + ' 次');
    }

    // ---------- S9 错面 ----------
    if (lang === 'en') {
      const cnHit = ts.render_cn && src.includes(ts.render_cn.slice(0, 24));
      if (cnHit) E('S9-WRONG-SURFACE', 'H3/国际面（英文正文）里出现中文压句 —— 串面了。英文面取 §2.1。');
    } else {
      const enHit = ts.render_en && src.includes(ts.render_en.slice(0, 24));
      if (enHit) E('S9-WRONG-SURFACE', '中文面里出现英文压句 —— 串面了。Seedance 取 §2.2，国内面取 §2.3。');
    }
  }
}

// ---------- 输出 ----------
console.log('风格一致性门禁：' + file);
console.log('投放面：' + surface + '　注册表：' + regPath);
if (st) console.log('风格：' + sid + '（' + (st.display_name || '') + '）　轨道：' + (st.track || '-') +
  '　稳定性：' + (st.stability || '-') + '　status：' + (st.status || '-'));
console.log('─'.repeat(72));

if (issues.length === 0) {
  console.log('（无检查项输出）');
} else {
  for (const it of issues) {
    console.log(`[${it.lv}] ${it.code}\n      ${it.msg}`);
  }
}
const errs = issues.filter(i => i.lv === 'ERROR');
const warns = issues.filter(i => i.lv === 'WARN');
console.log('─'.repeat(72));
console.log(`ERROR ${errs.length}　WARN ${warns.length}　INFO ${issues.length - errs.length - warns.length}`);
if (errs.length) {
  console.log('❌ 未通过。ERROR 是 P0，修完再交付。');
  process.exit(1);
}
console.log(warns.length ? '⚠️  通过（有 WARN，确认无碍后可交付）' : '✅ 通过（0 error / 0 warning）');
process.exit(0);
