#!/usr/bin/env node
/**
 * check_style.mjs —— 风格一致性门禁（P0）
 *
 * 用法
 *   node check_style.mjs <包.md> [--surface auto|h3|seedance|cn|seedream] [--registry <path>] [--no-log]
 *
 * 它查的是 SKILL.md 锁③ 里那五条 P0 门禁，外加一道假绿防线与三项附加核对：
 *   S0 零镜块（有 id 无镜块 = 输入格式不对）                 -> ERROR
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
 * 门禁 3（头身比）为什么只报 WARN：SKILL.md 锁③ 第 3 条明文允许成人与孩童并存，而 S6 是
 * 全包级计数（正文出现 >1 个头身档数字即报），做不到逐角色判定——升 ERROR 会误拦合法包。
 *
 * style_id 的声明方式（三选一，写在包顶部或参数行）
 *   【风格】celshade-guoman-2d
 *   # style_id: celshade-guoman-2d
 *   style_id: celshade-guoman-2d
 *
 * 注册表查找顺序：--registry > 当前目录 style-registry.json > 包同目录 > skill 种子文件
 *
 * 退出码：有 ERROR 为 1，否则 0；用法/输入错误（文件不存在、注册表找不到、
 * 解析抛错）为 2。不带参数跑只打印用法并退 0——那不是错误，是查询。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendGateLog, logDisabled } from './gates_log.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_SEED = path.join(__dirname, '..', 'references', 'style-registry.seed.json');

// ---------------------------------------------------------------- 投放面别名归一
// 两个脚本的 --surface 不是同一套枚举（v5.6.5 澄清）：
//   本脚本是「面别」：h3 / seedance / cn / seedream（决定压句取风格锚 §2.1 英文还是 §2.2/2.3 中文）
//   check_prompt.mjs 是「骨架族」：intl / cn / auto
// 用户照 SKILL.md 里的投放面名（国内面 / 国际面 / 2.5 面 / H3 面…）传参时两边会互相不认，
// 这里做跨脚本容错；主值保持不变，只补别名。
// 国际面归 seedance：它的压句取中文分支，与 Seedance 面同语言档，差别只在段头骨架（那是 check_prompt 的事）。
export function normalizeSurface(v) {
  // 剥掉空格/_/-/. ：让「2.5 面」「Seedance-2.5」「2.5面」都归一到 25，版本号写法差异不进判定
  const s = String(v || '').toLowerCase().replace(/[\s_.\-]/g, '');
  if (!s || s === 'auto' || s === '默认') return 'auto';
  if (/^(h3|h3面|minimax|minimaxh3|h3max)$/.test(s)) return 'h3';
  if (/^(cn|国内|国内面|domestic)$/.test(s)) return 'cn';
  if (/^(intl|国际|国际面|seedance|seedance面|seedance25|25|25面|seedance20|20|20面)$/.test(s)) return 'seedance';
  if (/^(seedream|出图|出图面|资产面|image)$/.test(s)) return 'seedream';
  return s;  // 未知值原样传，让下游 unknown 分支接住并给出可用值提示
}

// ---------------------------------------------------------------- 判定核心
// 可导入：selftest_check_style.mjs 进程内调用（沙箱禁 spawn，子进程黑盒跑不了）。
// opts: { surface, registryPath, seedPath, filePath }
export function collectStyleIssues(src, opts = {}) {
  const SEED = opts.seedPath || DEFAULT_SEED;
  const surfaceArg = normalizeSurface(opts.surface || 'auto');
  const regArg = opts.registryPath || null;
  // ---------- 注册表 ----------
  const cands = [regArg,
    path.join(process.cwd(), 'style-registry.json'),
    path.join(path.dirname(path.resolve(opts.filePath || '.')), 'style-registry.json'),
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

  // ---------- S0 假绿防线（v4.7.6） ----------
  // 门最危险的状态不是报错，是「输入格式不对却报通过」。只写一行【风格】xxx 的文件里
  // 没有任何镜块可比，S5/S6/S7/S8/S9 会全部静默跳过，结论却是「✅ 通过」。
  // 这跟台词门抽到 0 条却报 OK 是同一类事故，防线必须建在进门处。
  const SHOT_MARKERS = [
    /(?:^|\n)\s*(?:镜|段)\s*\d+[A-Za-z]?\s*[｜|]/g,
    /【时间轴】/g,
    /\[Shot\s*\d/gi,
    /(?:^|\n)\s*Shot\s*\d+\s*\(/g,
  ];
  const shotCount = SHOT_MARKERS.reduce((n, re) => n + (src.match(re) || []).length, 0);

  /**
   * 镜块切分（v4.7.6）：S7 必须逐镜查落点，不能查全文。
   *
   * 为什么：Step 6 定死「逐镜部分（镜号标题 → 参数行）整块可复制进生成工具」，
   * 也就是卷首的「〇 风格锚」段落**不在复制范围内**。卷首放着完整压句、S7 按全文
   * 命中就报「逐字命中 ✅」，结果是门说通过、模型一个字的画风都没收到——假绿。
   */
  function splitShotBlocks(text) {
    const lines = text.split(/\r?\n/);
    const headRe = /^\s*(?:#{0,6}\s*)?(?:(?:镜|段)\s*\d+[A-Za-z]?\s*[｜|]|\[?Shot\s*\d+|U\s*\d+[｜|])/i;
    const idxs = [];
    lines.forEach((l, i) => { if (headRe.test(l)) idxs.push(i); });
    if (idxs.length === 0) return [];
    return idxs.map((s, k) => ({
      head: lines[s].trim().slice(0, 40),
      text: lines.slice(s, k + 1 < idxs.length ? idxs[k + 1] : lines.length).join('\n'),
    }));
  }
  const shotBlocks = splitShotBlocks(src);

  /**
   * 处理单元（v4.7.6）：镜块优先；没有镜块时按资产条目切（`(A) 结构层` / `资产 X｜`）。
   *
   * 为什么要认资产包：资产图（4 View 角色板 / 场景表 / 道具表）与成片必须同一风格，
   * 压句落点检查对它们一样成立。只认镜块会把资产包判成 S0-NO-SHOT 挡在门外——
   * 那是把「不适用」误判成「不合格」。
   */
  function splitUnits(text) {
    if (shotBlocks.length > 0) return shotBlocks;
    const lines = text.split(/\r?\n/);
    // 业务头（资产 X｜ / 角色 X｜）优先；一个都没有才退回「(A) 结构层」当单元头。
    // 两者同时当单元头会把一个资产条目切成两半——后半段（结构层）里没有 (B) 生成 prompt，
    // 于是压句落在另一半，S7 会对半个条目误报缺压句。
    const pick = (re) => {
      const out = [];
      lines.forEach((l, i) => { if (re.test(l)) out.push(i); });
      return out;
    };
    // 允许行首带中文序号（「一 资产 CHAR-01｜…」是资产包的自然写法）
    const PRE = /^\s*(?:#{0,6}\s*)?(?:[一二三四五六七八九十]+[、.．]?\s*)?/;
    let idxs = pick(new RegExp(PRE.source + /(?:角色|场景|道具|资产)\s*[A-Za-z0-9-]*\s*[｜|]/.source));
    if (idxs.length === 0) idxs = pick(new RegExp(PRE.source + /(?:\(A\)\s*结构层|[A-Z]{3,}-\d+\s*[｜|])/.source));
    if (idxs.length === 0) return [];
    return idxs.map((s, k) => ({
      head: lines[s].trim().slice(0, 40),
      text: lines.slice(s, k + 1 < idxs.length ? idxs[k + 1] : lines.length).join('\n'),
    }));
  }
  const units = splitUnits(src);
  const isAssetPack = shotBlocks.length === 0 && units.length > 0;

  const issues = [];
  const E = (code, msg) => issues.push({ lv: 'ERROR', code, msg });
  const W = (code, msg) => issues.push({ lv: 'WARN', code, msg });
  const I = (code, msg) => issues.push({ lv: 'INFO', code, msg });

  // ---------- S1..S4 ----------
  if (units.length === 0) {
    E('S0-NO-SHOT',
      '没识别到任何镜块或资产条目，风格门禁无从比对——这是空文件、闲聊文本、或还没成形的草稿。'
      + '要求：至少一个「镜 N｜…」段头、或【时间轴】行、或 [Shot N]（H3 面）；'
      + '资产包则要有「(A) 结构层」或「资产 X｜」条目头。'
      + '本门是包级门，对单张零散设定图不生效——那种文件别跑它');
  } else if (isAssetPack) {
    I('S0-ASSET-PACK', '识别为资产提示词包（' + units.length + ' 个资产条目，无镜块），按资产口径查风格一致性');
  }
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
    // 三锁行是权威声明，优先听它；猜不到才退回格式特征。
    // v4.7.6 补出图面（seedream）：资产提示词包投的是文生图，不属于 h3/seedance/cn 三面，
    // 旧口径一律判 unknown → S7 整段跳过 → 报 ERROR。那是把「第四种面」当成「没写面」。
    const lockM = src.match(/投放面\s*[=:]\s*([^\s｜|，,）)]+)/);
    if (lockM) {
      const v = lockM[1];
      if (/H3/i.test(v)) surface = 'h3';
      else if (/国内/i.test(v)) surface = 'cn';
      else if (/出图|资产面|Seedream/i.test(v)) surface = 'seedream';
      else if (/国际|Seedance/i.test(v)) surface = 'seedance';
    }
    if (!lockM) {
      if (/【生成目标】|【参考素材职责】/.test(src)) surface = 'seedance';
      else if (/detailed_description\s*:|\[Shot\s*\d/i.test(src)) surface = 'h3';
      else if (/【时间轴】/.test(src)) surface = 'cn';
      else if (/生成图片：|资产板|环境设定表|道具展示表/.test(src)) surface = 'seedream';
    }
    if (!['h3', 'cn', 'seedance', 'seedream'].includes(surface)) surface = 'unknown';
  }
  const lang = surface === 'h3' ? 'en'
    : (surface === 'seedance' || surface === 'cn' || surface === 'seedream') ? 'cn' : null;

  const norm = s => s.replace(/\s+/g, ' ').trim();
  const nsrc = norm(src);
  // 逐文本的计数（v4.7.6）：S7 要逐镜查落点，不能只能查全文
  const countInText = (haystack, needle) => {
    if (!needle) return 0;
    const h = norm(haystack);
    const n = norm(needle);
    if (!n) return 0;
    let c = 0, i = 0;
    for (;;) { const k = h.indexOf(n, i); if (k < 0) break; c++; i = k + n.length; }
    return c;
  };
  const countIn = needle => countInText(src, needle);
  // 定位第一个改动点：报「前缀对到第几字」，比只报「整句缺失」有用得多。
  // v4.7.6 改为按字比对（旧版按空格分词，中文压句无空格 → 整段当一个词 → 提示里
  // 把 150 字压句原样打一遍，等于没定位）。兼容中英，英文下退化为词粒度但信息无损。
  const firstDiffIn = (haystack, needle) => {
    const h = norm(haystack);
    const n = norm(needle);
    let i = 0;
    while (i < n.length && h.includes(n.slice(0, i + 1))) i++;
    if (i >= n.length) return null;
    return '最长只逐字对上前 ' + i + ' 字，该处应为「' + n.slice(i, i + 12) + '…」';
  };
  const firstDiff = needle => firstDiffIn(src, needle);
  /**
   * 压句首句（v4.7.6）：第一个句末标点（含）之前的部分。
   * 完整压句 150+ 字，逐镜内联会撑爆单镜额度；首句通常 30–40 字，而写压句时就把
   * 最可辨识的画风特征放在第一句（「写实实拍电影画面，老胶片志怪剧照那一路」），
   * 单独成立。它是「每镜内联」与「完整存档」之间的自然单位。
   *
   * ⚠️ 不能用 `^.+?[。](?=\s|$)`——压句是一整段没有换行，第一个「。」后面紧跟着
   * 下一个字而非空白，后视永远不成立，非贪婪会一路吃到最后一个句号，取回整段。
   */
  const firstSentenceOf = s => {
    const t = norm(s);
    const m = t.match(/^[^。．.!！？?]*[。．.!！？?]/);
    return m ? m[0] : t.slice(0, 40);
  };

  // ---------- S5 串轨 ----------
  // 否定上下文里的对方风格名是合法用法（负面词里必须点名禁什么），不能算串轨。
  const NEG_CTX = /(禁|不要|不得|不许|排除|避免|去除|负面|不是|而非|区别于|Negative|Must\s*not|avoid|\bno\b|free\s+of|without)/i;
  // 负面词表的**整行豁免**（v4.7.6）：liqi 把负面词集中写在「禁止内容：…」或
  // 「Must not：…」一行，一行能长到 150 字。旧口径只看命中词前后各 40 字，
  // 够不到行首的「禁止内容：」，于是列表后半段的互斥风格词被反判成串轨——
  // 哥特资产包实测踩到：「黏土 / 微缩布景 / 毛孔」明明写在禁止内容行里，仍报 S5。
  // 负面词集中成行是既成写法，判定就得按行给豁免，而不是按字符窗口。
  const NEG_LINE_RE = /禁止内容|Must\s*not|Negative\s*prompt|负面|排除项|不出现|禁写|禁用|不要出现/i;
  const lineOf = idx => {
    const a = src.lastIndexOf('\n', idx) + 1;
    const b = src.indexOf('\n', idx);
    return src.slice(a, b < 0 ? src.length : b);
  };
  // base 参数（v5.8.2）：S11 要在「剥掉压句/配色句之后」的底本上扫，
  // 默认仍是全文 src（S5 沿用旧口径不变）。
  const markerHits = (words, base) => {
    const hay = base || src;
    const hits = new Set();
    for (const w of words) {
      if (!w) continue;
      let i = 0;
      for (;;) {
        const k = hay.indexOf(w, i);
        if (k < 0) break;
        const line = lineOf(k);
        const ctx = hay.slice(Math.max(0, k - 40), k + w.length + 40);
        // 参数行、Must not 行、负面词行里的点名是合法用法，不算串轨
        const isNegLine = /^\s*#/.test(line) || NEG_LINE_RE.test(line);
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
      // v4.7.6：有镜块却判不出投放面 = 压句比对整段没跑，这是本门最核心的一条。
      // 把它算成 WARN 等于「没查就说通过」，与假绿同罪——升级为 ERROR。
      //（零镜块的空文件已由 S0 拦下，这里只针对「有内容但面写丢了」的包。）
      const msg = '判不出投放面，压句比对（S7）整段跳过。用 --surface h3|seedance|cn 指定，'
        + '或在【三锁】行写清「投放面=国内面 / Seedance 面 / H3 面」。';
      if (units.length > 0) E('S7-SURFACE-UNKNOWN', msg + '有内容却判不出面 = 本门没真正查过，不算通过。');
      else W('S7-SURFACE-UNKNOWN', msg);
    } else {
      // ---------- S7 逐单元查落点（v4.7.6 重写）----------
      // 旧口径：全文 countIn(press) > 0 即过。于是把完整压句放在卷首「〇 风格锚」就报 ✅——
      // 而 Step 6 定死「逐镜部分（镜号标题 → 参数行）整块可复制进生成工具」，卷首不在复制范围内。
      // 结论：门说通过，模型收到的提示词里一个字的画风都没有。写「承接风格锚 <id>」更糟——
      // id 是给人看的索引，模型不认识它，等于没写。
      const pressFirst = firstSentenceOf(press);
      const secRef = '（投放面 ' + surface + '，风格锚 §' + (lang === 'en' ? '2.1 英文' : '2.2/2.3 中文') + '）';
      if (units.length === 0) {
        // 无单元（S0 已拦）：退回全文口径，至少把「压句被改动」这件事说清楚
        if (countIn(press) === 0) {
          E('S7-PRESS-NOT-VERBATIM',
            '风格压句未逐字出现' + secRef + '。压句被改动或临场翻译了。' + (firstDiff(press) || '整句缺失'));
        } else {
          I('S7-PRESS', '（无镜块/资产单元，仅全文核对）风格压句命中 ' + countIn(press) + ' 次');
        }
      } else {
        const none = [];
        const onlyFirst = [];
        for (const u of units) {
          if (countInText(u.text, press) > 0) continue;
          if (countInText(u.text, pressFirst) > 0) { onlyFirst.push(u.head); continue; }
          none.push(u);
        }
        if (none.length > 0) {
          const u = none[0];
          const d = firstDiffIn(u.text, pressFirst);
          E('S7-PRESS-NOT-IN-SHOT',
            none.length + '/' + units.length + ' 个单元里没有风格压句：' + none.map((x) => x.head).join(' / ')
            + '。逐单元是单独投喂的，卷首的风格锚段落不在复制范围内——'
            + '只写「承接风格锚 <id>」模型认不出画风（id 是给人看的索引，模型不认识）。'
            + '修法：正文内联压句首句，逐字：「' + pressFirst + '」'
            + (d ? '；' + d : '；整句缺失'));
        }
        if (onlyFirst.length > 0) {
          I('S7-PRESS-FIRST-ONLY',
            onlyFirst.length + '/' + units.length + ' 个单元内联了压句首句、未内联全文，**可接受**'
            + '（压句全文 ' + norm(press).length + ' 字，逐单元全量内联会撑爆单镜额度）');
        }
        if (none.length === 0 && onlyFirst.length === 0) {
          I('S7-PRESS', units.length + ' 个单元全部内联完整压句');
        }
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

  // ---------- S10 / S11 冻结后的一致性（v5.8.2 · 「选定即冻结」的两条机检）----------
  // 冻结的含义：全包只允许该锚的**色域、材质口径、禁用项、heads_range**。
  //   S10 正文用色越出该锚色域 → WARN（要换色就改项目级 style-registry.json，
  //       不要只在提示词里换——改了不回写，下一轮又按旧色域判）
  //   S11 正文出现该锚明列禁用项（negative_direction）→ ERROR
  //
  // ⚠️ 两条都必须在**剥掉压句与配色句之后**扫：压句里常带「无噪点颗粒」「无渐变」
  //    这类否定式写法，不剥就会把锚自己的压句判成串轨（实测会假错）。
  //    剥法是等长替换（\u0000 填充），保证行号与字符下标仍对得上原文。
  if (st) {
    const ts0 = st.tech_spec || {};
    let scan = src;
    for (const anchor of [ts0.render_cn, ts0.render_en, ts0.palette_cn, ts0.palette_en]) {
      if (anchor && src.includes(anchor)) {
        scan = scan.split(anchor).join('\u0000'.repeat(anchor.length));
      }
    }

    // S10 色域
    const pal = st.palette || {};
    const allowed = new Set();
    for (const k of ['primary', 'secondary', 'accent']) {
      if (pal[k]) allowed.add(String(pal[k]).trim().toLowerCase());
    }
    for (const e of (pal.extended || [])) {
      if (e && e.hex) allowed.add(String(e.hex).trim().toLowerCase());
    }
    if (allowed.size === 0) {
      I('S10-PALETTE-EMPTY',
        '注册表里该风格没有 palette 色域数据，色域比对跳过——**这不是通过**。'
        + '补 style-registry.json 的 palette（primary/secondary/accent + extended）后再跑');
    } else {
      const out = new Map();
      for (const m of scan.matchAll(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g)) {
        const h = m[0].toLowerCase();
        if (allowed.has(h)) continue;
        const line = lineOf(m.index);
        if (/^\s*#/.test(line) || /技术规格|输出规格/.test(line)) continue;   // 参数行/规格行不算正文用色
        out.set(h, (out.get(h) || 0) + 1);
      }
      if (out.size) {
        W('S10-STYLE-GAMUT-OUT',
          '正文用色越出「' + sid + '」的色域：' + [...out.keys()].slice(0, 4).join(' / ')
          + (out.size > 4 ? ' 等 ' + out.size + ' 个' : '')
          + '。**选定即冻结**——全包只能用该锚色域内的色值；要换色就改项目级 '
          + 'style-registry.json 的 palette（改完回写，别只在提示词里换），'
          + '或确认这是项目级重音色并补进 extended');
      } else {
        I('S10-GAMUT', '正文用色全部落在「' + sid + '」色域内（' + allowed.size + ' 个色值）');
      }
    }

    // S11 禁用项
    const banned = st.negative_direction || [];
    if (banned.length === 0) {
      I('S11-BANNED-EMPTY', '注册表里该风格没有 negative_direction 禁用项，本条跳过——**这不是通过**');
    } else {
      // ⚠️ 不复用 markerHits：它用命中词前后各 40 字的窗口判否定语境，对 S11 太宽——
      //    实测「…画面带噪点颗粒｜镜头：中景 固定」下一行就是 Must not，
      //    40 字窗口直接把这次命中豁免掉（漏报）。S11 只往前看 20 字且限定同一行。
      const hits = new Set();
      for (const w of banned) {
        if (!w) continue;
        let i = 0;
        for (;;) {
          const k = scan.indexOf(w, i);
          if (k < 0) break;
          const line = lineOf(k);
          if (/^\s*#/.test(line) || NEG_LINE_RE.test(line)) { i = k + w.length; continue; }
          const ls = scan.lastIndexOf('\n', k) + 1;
          const before = scan.slice(Math.max(ls, k - 20), k);
          const negated = NEG_CTX.test(before)
            || /(?:禁|不要|不得|不许|无|去除|避免|排除|非)$/.test(before.trimEnd());
          if (!negated) hits.add(w);
          i = k + w.length;
        }
      }
      // ⚠️ hits 是 Set —— 用 .size，不是 .length（Set 没有 length，写了就是永假分支）
      if (hits.size) {
        E('S11-STYLE-BANNED-HIT',
          '正文出现「' + sid + '」明列的禁用项：' + [...hits].join(' / ')
          + '。**选定即冻结**——negative_direction 是轨道反向词，出现在正文＝串轨'
          + '（已排除压句 / 配色句 / Must not 行 / 否定上下文）');
      }
    }
  }

  return { issues, surface, sid, st, regPath, shotCount, shotBlocks, units, isAssetPack };
}

// ---------------------------------------------------------------- CLI
function main() {
  const argv = process.argv.slice(2);
  const file = argv.find(a => !a.startsWith('--'));
  const getOpt = n => {
    const i = argv.indexOf(n);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const surfaceArg = normalizeSurface(getOpt('--surface') || 'auto');
  const regArg = getOpt('--registry');
  if (!file) {
    console.log('用法: node check_style.mjs <包.md> [--surface auto|h3|seedance|cn|seedream] [--registry <path>]');
    console.log('      （别名也认：国内/国内面、国际/国际面、2.5面、2.0面、H3面、出图面）');
    process.exit(0);
  }
  if (!fs.existsSync(file)) { console.log('文件不存在: ' + file); process.exit(2); }

  const src = fs.readFileSync(file, 'utf8');
  let R;
  try {
    R = collectStyleIssues(src, { surface: surfaceArg, registryPath: regArg, filePath: file });
  } catch (e) {
    console.log(String(e.message || e));
    process.exit(2);
  }
  const { issues, surface, sid, st, regPath } = R;
  // ---------- 输出 ----------
  const noLog = logDisabled(argv);
  if (!noLog) {
    appendGateLog({
      tool: 'check_style.mjs', file,
      exit: issues.some(i => i.lv === 'ERROR') ? 1 : 0,
      issues: issues.filter(i => i.lv !== 'INFO'),
      target: surface,
    });
  }
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
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) main();
