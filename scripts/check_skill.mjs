#!/usr/bin/env node
// -*- coding:utf-8 -*-
/**
 * liqi skill 自检器（v5.16.0 新增 · 维护时跑，不是交付前跑）
 *
 * 治的是「规则文档腐化」：SKILL.md、references、scripts 三处各说各话。
 * 本轮（2026-10-16）实测抓到两处真实漂移促成本脚本——任务模板路由.md 写
 * 「W-COMBAT-* 三码」而 check_prompt.mjs 实际已扩为九码；CAMERA_GROUPS 与
 * MOVE_WORDS 对 pan 的归类不一致（前者 rotation、后者横移）。
 *
 * 查六项，全静态、不执行被测脚本、不联网（第五项只读 JSON；第六项只数文件；第三项的 git 对齐只在有 .git 时跑一次 git log）：
 *   1. 路径存在  —— SKILL.md 里引用的 references/*.md、scripts/* 是否真实存在
 *   2. 码号两向对照 —— 脚本实现的 [EW]- 码 vs 文档登记的 [EW]- 码
 *      （实现有、文档无 = ERROR：用户查不到含义；文档有、脚本无 = WARN：疑似过期口径）
 *   3. 版本同步  —— SKILL.md version 字段 vs CHANGELOG.md 最新条目版本
 *   4. 联动一致性（v5.23.0 新增）—— 治「改了一层，没改它引用的那一层」。
 *      2026-10-17 原创结构排查（8 项发现）里 6 项是同一个病根：改档位只改计数、
 *      立禁令不管示例、立纪律不落到第二张表。故把它做成模式化静态契约：
 *        L1 景别档数    —— §一 标题声明的 N 档 vs 表一实际可复制句行数
 *        L2 镜块小节数  —— SKILL.md Step 3 实编号项数 vs 术语表声明的「N 小节」
 *        L3 配额项数    —— 配额表声明的「N 项区间配额」vs 实际 Q 行数
 *        L4 禁令词残留  —— BAN_WORDS 里的词不许出现在示例/模板/词库（白名单除外）
 *        L5 口径三态    —— 时长表与投放面总表都要有 ①②③ 三态标注
 *        L6 引用可解析  —— references/*.md 里的 references/xxx.md 必须存在（外部 skill 路径除外）
 *        L7 锚点可解析  —— ANCHOR id 唯一，且 L1/L2/L5 依赖的锚点必须存在
 *        L8 样例渲染状态 —— examples/<样例>/包.md 首部必须声明【渲染状态】
 *        L9 画幅值集合  —— 6 处锁②宣告行的取值集合必须等于 ratio_whitelist（v6.19.0；
 *                          查「集合」不查「计数」，因为 README 的漂移是隐式列表，数字正则抓不到）
 *   5. 数值源自洽（v5.44.0）—— model-limits.json 的 refs 分项 / total / total_checked 锁定；
 *      v5.52.0 起另查各模型面 last_verified 新鲜度（超 freshness_days = WARN，缺字段 = 未查不是通过）
 *   6. 计数自检（v5.45.0 新增）—— README 两语种声明的目录计数 vs 机器实数；
 *      锚文件数 ↔ seed 注册表 id 数必须相等（贡献纪律三处同步的数量面）
 *
 * 用法：node scripts/check_skill.mjs [skill根目录，默认当前目录]
 * 退出码：0 = 全过；1 = 有 ERROR；2 = 用法/读取错误
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CODE_RE = /\b([EW]-[A-Z][A-Z0-9-]*)\b/g;
// 「W-COMBAT-*」「W-FACS-*」这类前缀泛称不是具体码号，扫描前先摘掉，
// 否则会把前缀当成一个无名码报「文档有、脚本无」。
const CODE_PREFIX_RE = /\b[EWS]-[A-Z][A-Z0-9-]*-\*/g;
// 《liqi全景梳理》的版本表是有意留档（CHANGELOG 5.15.8 明示「旧口径是有意留档，
// 不在排查范围」），其中的旧码号不参与两向对照。
const ARCHIVE_DOCS = new Set(['liqi全景梳理.md']);
const TARGET_SCRIPTS = [
  'check_prompt.mjs', 'check_prompt_h3.mjs', 'check_style.mjs',
  'audit_project.py', 'audit_literal.py', 'audit_risk.py', 'audit_contract.py', 'audit_all.py',
  // v5.53.0 补登记：渲染域两脚本此前不在对照名单——W-RENDER 六码从 v5.51.0 起全库无人核对（漏网），
  // 码表登记在 工作流_交付三步.md 渲染后机检段
  'audit_render.py', 'render_ledger.py',
  // v6.5.0 补登记：连续性锁六码（E-LOCK-*）——不登记就成了「文档码号无实现」假 WARN，
  // 码表登记在 连载记忆与多集一致性.md §2.4
  'audit_continuity_lock.py',
];

function read(p) { return readFileSync(p, 'utf-8'); }

function collectScriptCodes(root) {
  const found = new Map(); // code -> [files]
  for (const name of TARGET_SCRIPTS) {
    const p = join(root, 'scripts', name);
    if (!existsSync(p)) continue;
    const text = read(p).replace(CODE_PREFIX_RE, '');
    for (const m of text.matchAll(CODE_RE)) {
      const code = m[1];
      if (!found.has(code)) found.set(code, []);
      found.get(code).push(name);
    }
  }
  return found;
}

function collectDocCodes(root) {
  const found = new Map();
  const refDir = join(root, 'references');
  const files = [];
  if (existsSync(refDir)) {
    for (const f of readdirSync(refDir)) {
      if (f.endsWith('.md')) files.push(join(refDir, f));
    }
  }
  const skillMd = join(root, 'SKILL.md');
  if (existsSync(skillMd)) files.push(skillMd);
  for (const p of files) {
    if (ARCHIVE_DOCS.has(basename(p))) continue;
    const text = read(p).replace(CODE_PREFIX_RE, '');
    for (const m of text.matchAll(CODE_RE)) {
      const code = m[1];
      if (!found.has(code)) found.set(code, []);
      found.get(code).push(basename(p));
    }
  }
  return found;
}

function checkPaths(root) {
  const errors = [], warns = [];
  const skillMd = join(root, 'SKILL.md');
  if (!existsSync(skillMd)) {
    errors.push('SKILL.md 不存在——本脚本应放在 skill 根目录运行');
    return { errors, warns };
  }
  const text = read(skillMd);
  // SKILL.md 里的 `references/xxx.md` 与 `scripts/xxx(.py|.mjs)` 引用
  const refRe = /`?(references\/[A-Za-z0-9_\-\u4e00-\u9fff.]+\.md)`?/g;
  const scrRe = /`?(scripts\/[A-Za-z0-9_\-.]+)`?/g;
  const missing = new Set();
  for (const m of text.matchAll(refRe)) {
    if (!existsSync(join(root, m[1]))) missing.add(m[1]);
  }
  for (const m of text.matchAll(scrRe)) {
    if (!existsSync(join(root, m[1]))) missing.add(m[1]);
  }
  for (const p of [...missing].sort()) {
    errors.push(`路径不存在：SKILL.md 引用了 ${p}，但文件不在——引用漂移`);
  }
  return { errors, warns };
}

function checkVersion(root) {
  const errors = [], warns = [];
  const skillMd = join(root, 'SKILL.md');
  const changelog = join(root, 'CHANGELOG.md');
  if (!existsSync(skillMd) || !existsSync(changelog)) {
    warns.push('SKILL.md 或 CHANGELOG.md 缺席，版本同步检查跳过（跳过不是通过）');
    return { errors, warns };
  }
  const skillText = read(skillMd);
  const vm = skillText.match(/^\s*version:\s*["']([^"']+)["']/m);
  if (!vm) {
    warns.push('SKILL.md  front matter 找不到 version 字段');
    return { errors, warns };
  }
  const clText = read(changelog);
  const cm = clText.match(/^##\s*([0-9]+\.[0-9]+\.[0-9]+)\s*—/m);
  if (!cm) {
    warns.push('CHANGELOG.md 找不到「## x.y.z —」格式的最新条目');
    return { errors, warns };
  }
  if (vm[1] !== cm[1]) {
    errors.push(`版本不同步：SKILL.md = ${vm[1]}，CHANGELOG 最新条目 = ${cm[1]}——按 SKILL.md 当前版本补一条 CHANGELOG，或把 front matter 升位`);
  }
  // v5.45.0：仓库里有 .git 时，最新提交主题里的 vX.Y.Z 与 CHANGELOG 头条对齐。
  // 只在「提交版本**超前**于 CHANGELOG 头条」时报 WARN——那是「提交带版本号、CHANGELOG
  // 却没条目」的真漂移（v5.44.2 / v5.44.3 实际发生过）；工作区领先于旧提交（提交版本
  // 落后于头条）是开发中的正常状态，不出声。无 .git（安装副本）自然跳过（跳过不是通过）。
  if (existsSync(join(root, '.git'))) {
    try {
      const subj = execSync('git log -1 --format=%s', { cwd: root, encoding: 'utf-8' }).trim();
      const gm = subj.match(/^v?([0-9]+\.[0-9]+\.[0-9]+)\b/);
      const newer = (a, b) => {
        const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
        return false;
      };
      if (gm && newer(gm[1], cm[1])) {
        warns.push(`最新提交「${subj.slice(0, 48)}」的版本号 ${gm[1]} 超前于 CHANGELOG 头条 ${cm[1]}——按该版本补条目，收尾提交不许漏记`);
      }
    } catch { /* git 不可用即跳过 */ }
  }
  return { errors, warns };
}

function checkCodes(root) {
  const errors = [], warns = [];
  const scriptCodes = collectScriptCodes(root);
  const docCodes = collectDocCodes(root);
  for (const [code, files] of [...scriptCodes].sort()) {
    if (!docCodes.has(code)) {
      errors.push(`码号无文档登记：${code}（实现在 ${[...new Set(files)].join('、')}）——用户在 references/ 里查不到含义，补进质控层_门禁与过审.md 的码表`);
    }
  }
  for (const [code, files] of [...docCodes].sort()) {
    if (!scriptCodes.has(code)) {
      warns.push(`文档码号无实现：${code}（出现在 ${[...new Set(files)].join('、')}）——疑似过期口径或计划码，核对后修文档`);
    }
  }
  return { errors, warns };
}

// ───────────────────────── 四、联动一致性（v5.23.0） ─────────────────────────
// 设计原则与上面三项一致：**只查可机械判定的事实**，不做语义判断。
// 每条契约独立、失败只报不抛——单个文件缺失降级为 WARN（「跳过不是通过」）。

// 禁令词表：新立一条禁令（判某个词为喻体/病根）后，在这里加一条。
// allow 列的是「本身就要引用这些词来做说明」的文件——只放规则正文与索引，不放示例与模板。
const BAN_WORDS = [
  {
    word: '蜡质',
    why: 'v5.21.0 判为喻体（用蜡比皮肤），皮肤/道具/面料一律不用；面料改「蜡光布面」',
    allow: ['抽象表述判定口径.md', 'README-索引.md', 'liqi全景梳理.md', '质感与可见性预算清单.md'],
  },
];

const STRUCT_CONTRACTS = [
  {
    id: 'L1',
    desc: '景别档数：光学语言块 §一 声明档数 vs 表一实际可复制句行数',
    run(root) {
      const p = join(root, 'references', '光学与空间语言块.md');
      if (!existsSync(p)) return { warn: '光学与空间语言块.md 缺席，L1 跳过（跳过不是通过）' };
      const text = read(p);
      const lines = text.split('\n');
      // v5.44.0：优先按锚点定位，锚点缺失才回退文本匹配（并在 L7 报「未埋锚点」）。
      // 文本匹配是历史行为，保留它只为迁移期不炸；长期应以锚点为准。
      let start = anchorPos(text, 'OPTICS-SHOTSIZE-DECL');
      let m = null;
      if (start >= 0) {
        // 锚点之后的 200 字符内找「（N 档」声明——数字不写进锚点，
        // 否则改一次档数就得改锚点名，那跟拿数字当锚没区别。
        const win = text.slice(start, start + 200);
        m = win.match(/（\s*(\d+)\s*档/);
      }
      if (m) {
        // 把匹配位置换算回全文，供下面 slice 用
        var declPos = start + m.index;
      }
      if (!m) m = text.match(/##\s*一、景别视觉结果句（\s*(\d+)\s*档/);
      if (!m) return { warn: 'L1：§一 标题里找不到「景别视觉结果句（N 档）」，无法核对' };
      const declared = Number(m[1]);
      // 从声明处切片（锚点命中时用它换算出的全文位置，避免 indexOf 找错到别处的同款数字）
      const sec = text.slice(typeof declPos === 'number' ? declPos : text.indexOf(m[0])).split('\n---')[0];
      const rows = sec.split('\n').filter((l) => /^\|\s*[^|\-\s][^|]*\|/.test(l));
      const actual = Math.max(0, rows.length - 1); // 去掉表头
      if (declared !== actual) {
        return { err: `L1 景别档数不一致：标题写 ${declared} 档，表一实际只给了 ${actual} 条可复制句——扩档时只改了计数没改内容（v5.7.0→v5.22.0 真实踩过）` };
      }
      return {};
    },
  },
  {
    id: 'L2',
    desc: '镜块小节数：SKILL.md Step 3 实编号项数 vs 术语表声明的「N 小节」',
    run(root) {
      const sPath = join(root, 'SKILL.md');
      const gPath = join(root, 'references', '术语对照表_glossary.md');
      if (!existsSync(sPath) || !existsSync(gPath)) return { warn: 'L2 输入缺席，跳过（跳过不是通过）' };
      const s = read(sPath);
      // v5.44.0：优先锚点（SKILL-STEP3-SECTIONS-START / -END），回退文本。
      // ⚠️ 必须用 anchorPos（字符偏移）不是 anchorLine（行号）——下面 slice 要的是偏移。
      let a = anchorPos(s, 'SKILL-STEP3-SECTIONS-START');
      let b = anchorPos(s, 'SKILL-STEP3-SECTIONS-END');
      if (a < 0 || b < 0) {
        a = s.indexOf('每镜固定输出以下小节');
        b = s.indexOf('#### 表演位写法', a > -1 ? a : 0);
      }
      if (a < 0 || b < 0) {
        // v5.44.0：先判这份 SKILL.md 是否承载「核心工作流」。
        // 团队编排协议形态（如 liqi-crew 总控文档）不承载逐镜骨架，这段区间对它不存在，
        // 属**不适用**；但主库若真丢了这段，那是要修的真缺陷。两者不能混为一谈。
        if (!/^#{1,3}\s*核心工作流/m.test(s)) {
          return { info: 'L2：本 SKILL.md 未以章节承载「核心工作流」（团队编排协议形态），逐镜小节清单不适用——不适用 ≠ 通过，逐镜骨架仍以主库为准' };
        }
        return { warn: 'L2：SKILL.md 找不到「每镜固定输出以下小节」到「#### 表演位写法」区间' };
      }
      const actual = s.slice(a, b).split('\n').filter((l) => /^\d+\.\s+\*\*/.test(l)).length;
      const gm = read(gPath).match(/\|\s*(\d+)\s*小节\s*\|/);
      if (!gm) return { warn: 'L2：术语表里找不到「N 小节」声明' };
      const declared = Number(gm[1]);
      if (declared !== actual) {
        return { err: `L2 镜块小节数不一致：术语表写 ${declared} 小节，SKILL.md Step 3 实际编号 ${actual} 项——加小节时漏改计数或漏改正文` };
      }
      return {};
    },
  },
  {
    id: 'L3',
    desc: '配额项数：配额表声明的「N 项区间配额」vs 实际 Q 行数',
    run(root) {
      const p = join(root, 'references', '分镜配额与机检规范.md');
      if (!existsSync(p)) return { warn: '分镜配额与机检规范.md 缺席，L3 跳过（跳过不是通过）' };
      const text = read(p);
      const m = text.match(/(\d+)\s*项区间配额/);
      if (!m) return { warn: 'L3：配额表里找不到「N 项区间配额」声明' };
      const declared = Number(m[1]);
      const actual = text.split('\n').filter((l) => /^\|\s*Q\d+\s*\|/.test(l)).length;
      if (declared !== actual) {
        return { warn: `L3 配额项数不一致：正文写 ${declared} 项，表里实际 ${actual} 行 Q ——调配额时同步核对` };
      }
      return {};
    },
  },
  {
    id: 'L4',
    desc: '禁令词残留：BAN_WORDS 不许出现在示例/模板/词库（白名单除外）',
    run(root) {
      const hits = [];
      const files = [];
      const refDir = join(root, 'references');
      if (existsSync(refDir)) {
        for (const f of readdirSync(refDir)) if (f.endsWith('.md')) files.push(join(refDir, f));
      }
      const sPath = join(root, 'SKILL.md');
      if (existsSync(sPath)) files.push(sPath);
      for (const p of files) {
        const name = basename(p);
        if (ARCHIVE_DOCS.has(name)) continue;
        const lines = read(p).split('\n');
        for (let i = 0; i < lines.length; i++) {
          for (const ban of BAN_WORDS) {
            if (ban.allow.includes(name)) continue;
            if (lines[i].includes(ban.word)) {
              hits.push(`${name}:${i + 1} 含禁令词「${ban.word}」——${ban.why}｜${lines[i].trim().slice(0, 46)}`);
            }
          }
        }
      }
      if (hits.length) {
        return { err: `L4 禁令词残留 ${hits.length} 处（示例/模板会被照抄，等于把禁令废掉）：\n      ` + hits.slice(0, 8).join('\n      ') + (hits.length > 8 ? `\n      …另有 ${hits.length - 8} 处` : '') };
      }
      return {};
    },
  },
  {
    id: 'L5',
    desc: '口径三态标注：SKILL.md 时长表 + references/投放面参数总表.md（v6.0.0 迁出单表成册）都要有 ①②③ 标注',
    run(root) {
      const sPath = join(root, 'SKILL.md');
      if (!existsSync(sPath)) return { warn: 'SKILL.md 缺席，L5 跳过（跳过不是通过）' };
      const text = read(sPath);
      // v6.0.0（N13）：投放面参数总表自 SKILL.md 迁出单表成册，主文档不再以章节承载它——
      // 协议形态的判定从「有没有参数总表章节」改为与 L2/L7 同款「有没有核心工作流」；
      // 参数总表本身的检查改锚 references/投放面参数总表.md（锚点 PARAM-TABLE）。
      if (!/^#{1,3}\s*核心工作流/m.test(text)) {
        return { info: 'L5：本 SKILL.md 未承载「核心工作流」（团队编排协议形态），时长表三态标注不适用——不适用 ≠ 通过；参数总表在共享 references/ 里，仍以主库为准' };
      }
      const warns = [];
      // 时长表：仍在 SKILL.md（路由层核心），锚点不变，判据不变
      const p1 = anchorPos(text, 'SKILL-STEP1-DURATION-TRISTATE');
      const w1 = p1 >= 0 ? text.slice(p1, p1 + 120) : '';
      if (!(p1 >= 0 && /三态/.test(w1)) && !/本表口径三态/.test(text)) {
        warns.push('L5：Step 1 时长表缺「口径三态」标注——总表立了「每个数值必须归入三态之一」，第二张表不标就是执行缺口');
      }
      // 投放面参数总表：v6.0.0 起在 references/投放面参数总表.md。整表丢失 = ERROR（不是措辞问题）；
      // 锚点失锚或窗口内无「① 官方」= WARN。旧锚 SKILL-PARAM-TABLE-OFFICIAL 随内容同批退役。
      const tPath = join(root, 'references', '投放面参数总表.md');
      if (!existsSync(tPath)) {
        return { errors: ['L5：references/投放面参数总表.md 不存在——参数总表既不在 SKILL.md 也不在 references，整表丢失（v6.0.0 N13 迁移落点被删或改名）'], warns };
      }
      const t = read(tPath);
      const p2 = anchorPos(t, 'PARAM-TABLE');
      const w2 = p2 >= 0 ? t.slice(p2, p2 + 160) : '';
      if (p2 < 0) warns.push('L5：投放面参数总表未埋 PARAM-TABLE 锚点——三态检查失锚（v6.0.0 起锚点随内容迁至本文件）');
      else if (!/①\s*官方/.test(w2)) warns.push('L5：投放面参数总表缺「① 官方」三态标注');
      return warns.length ? { warn: warns.join('\n      ') } : {};
    },
  },
  {
    id: 'L6',
    desc: '引用可解析：references/*.md 与 SKILL.md 里的 references/xxx.md 必须真实存在（外部路径不参与）',
    run(root) {
      const files = [];
      const refDir = join(root, 'references');
      if (existsSync(refDir)) {
        for (const f of readdirSync(refDir)) if (f.endsWith('.md')) files.push(join(refDir, f));
      }
      const sPath = join(root, 'SKILL.md');
      if (existsSync(sPath)) files.push(sPath);
      const bad = [];
      for (const p of files) {
        const name = basename(p);
        if (ARCHIVE_DOCS.has(name)) continue;
        const lines = read(p).split('\n');
        for (let i = 0; i < lines.length; i++) {
          // 前置字符边界：`short-drama-director/references/x.md` 这类指外部 skill，
          // 前面紧贴 `/` 或字母数字，不参与本库解析；只有行首或空白/标点后的 references/ 才算内部引用。
          // 文件名必须含 CJK——本库引用几乎全是中文名，只认 ASCII 会整条失效（实测踩过）
          for (const m of lines[i].matchAll(/(?:^|[^\w/-])references\/([A-Za-z0-9_\u4e00-\u9fff-]+\.md)/g)) {
            if (!existsSync(join(root, 'references', m[1]))) bad.push(`${name}:${i + 1} → references/${m[1]}`);
          }
        }
      }
      if (bad.length) {
        return { err: `L6 引用不可解析 ${bad.length} 处（改名/删档后没同步；外部 skill 的路径请写成 xxx/references/… 以免误判）：\n      ` + bad.slice(0, 8).join('\n      ') + (bad.length > 8 ? `\n      …另有 ${bad.length - 8} 处` : '') };
      }
      return {};
    },
  },
  {
    id: 'L7',
    desc: '锚点可解析（v5.44.0）：ANCHOR id 必须唯一，且 L1/L2/L5 依赖的锚点必须存在',
    run(root) {
      const errors = [], warns = [], infos = [];
      const targets = [];
      const sPath = join(root, 'SKILL.md');
      if (existsSync(sPath)) targets.push(['SKILL.md', read(sPath)]);
      const refDir = join(root, 'references');
      if (existsSync(refDir)) {
        for (const f of readdirSync(refDir)) {
          if (!f.endsWith('.md')) continue;
          targets.push([`references/${f}`, read(join(refDir, f))]);
        }
      }
      if (!targets.length) return { warn: 'L7：找不到任何待扫文件，跳过（跳过不是通过）' };

      const seen = new Map();   // id -> 首次出现的文件
      const dup = [];
      for (const [name, text] of targets) {
        for (const m of text.matchAll(ANCHOR_RE)) {
          if (seen.has(m[1])) dup.push(`${m[1]}（${seen.get(m[1])} 与 ${name}）`);
          else seen.set(m[1], name);
        }
      }
      if (dup.length) {
        // 必须报错：两个同名锚点会让定位结果取决于扫描顺序，检查就不可信了
        errors.push(`L7 锚点 id 重复 ${dup.length} 处：${dup.slice(0, 5).join('；')}——同名锚点会让定位结果取决于扫描顺序`);
      }

      // 与 L2/L5 同一判据：团队编排协议形态的 SKILL.md 不承载「核心工作流」，
      // 于是逐镜骨架与参数总表的锚点对它根本不存在——那不是"漏埋"，是"不适用"。
      // 不加这个分支，crew 这类副本会永远挂着"锚点未埋"，把真警告淹掉（L2/L5 已踩过一次）。
      const sPath2 = join(root, 'SKILL.md');
      const isProtocolForm = existsSync(sPath2) && !/^#{1,3}\s*核心工作流/m.test(read(sPath2));
      const SKIP_IF_PROTOCOL = new Set(['L2', 'L5']);

      const missing = [];
      for (const [checkId, ids] of Object.entries(REQUIRED_ANCHORS)) {
        if (isProtocolForm && SKIP_IF_PROTOCOL.has(checkId)) continue;
        for (const id of ids) if (!seen.has(id)) missing.push(`${checkId} 需要 ${id}`);
      }
      if (missing.length) {
        // 未埋锚点会回退到文本匹配，不是致命错，但必须出声——
        // 静默回退等于解锚没做完，下次改措辞照样失锚。
        warns.push(`L7 锚点未埋 ${missing.length} 处：${missing.join('；')}——当前回退到文本匹配，解锚未完成`);
      } else {
        const n = Object.entries(REQUIRED_ANCHORS)
          .filter(([c]) => !(isProtocolForm && SKIP_IF_PROTOCOL.has(c)))
          .flatMap(([, ids]) => ids).length;
        infos.push(`L7：${n} 个必需锚点全部就位（共登记 ${seen.size} 个）` +
          (isProtocolForm ? '；L2/L5 的锚点本形态不适用' : '') +
          '——改写这几处措辞不再失锚');
      }
      return { errors, warns, infos };
    },
  },
  {
    id: 'L8',
    desc: '样例渲染状态板（v5.52.0 · C21）：examples/*/包.md 必须声明【渲染状态】——没渲染就必须说没渲染',
    run(root) {
      const exDir = join(root, 'examples');
      if (!existsSync(exDir)) return { info: 'L8：examples/ 目录不存在，样例渲染状态板不适用（不适用 ≠ 通过）' };
      const pkgs = readdirSync(exDir).filter((f) => existsSync(join(exDir, f, '包.md')));
      if (!pkgs.length) return { warn: 'L8：examples/ 下没有任何 包.md，无从核验（跳过不是通过）' };
      const SLATE_RE = /【渲染状态】(未渲染|已渲染[｜|])/;
      const bad = pkgs.filter((f) => {
        const head = read(join(exDir, f, '包.md')).split('\n').slice(0, 20).join('\n');
        return !SLATE_RE.test(head);
      });
      if (bad.length) {
        return { warn: `L8 样例缺渲染状态声明 ${bad.length} 处：${bad.join('、')}——门禁日志再绿也只是提示词层的绿；成片有没有、什么日期、哪个平台，包首必须说清（kangarooking 发布标准第 5 条：不伪造生成结果；Emily slate 规则：要么证明、要么明说未渲染）` };
      }
      return { info: `L8：${pkgs.length} 个样例均已声明渲染状态（已渲染须带日期与平台，未渲染明说）` };
    },
  },
  {
    id: 'L9',
    desc: '画幅值集合一致（v6.19.1）：6 处锁②宣告行必须等于 ratio_whitelist；另扫「一行列 ≥4 个白名单比例值」的全量列举，未登记且不符即报 WARN',
    // 立这条的起因：v6.0.1→v6.18.0 共 18 个版本里，README / README.en / 术语表 / 质控层码表 /
    // 全景梳理流程全景 五处对锁②的取值各说各话（三值 / 四值 / 六值），而 K3 只认
    // 「N 小节 / 景别 N 档 / N 个内容码」三个量词、K6 只有三条登记断言——概念词漂移结构上不可见。
    //
    // 两条「不做」都有实测依据：
    //  · 不做「任意提及画幅的行都查」——10 个命中里 3 个是合法局部列举（小节标题只列条件三值 /
    //    待办只列新增三值 / 质控层用「锁 16:9 却写 9:16」举反例），泛扫噪声比问题更费人。
    //  · 不做「按措辞认宣告行」——六份文档六种写法（标题式 / 列表式 / 表格式 / 中英混排 / 流程图内），
    //    实测按 `画幅[：:]` 认只能命中 3/6；正则认措辞，注定既漏又误。
    //  · 也不做跨行合并容错——合并没有可靠边界，会把无关段落拼进来；宁可让人看一眼误报。
    //
    // 两段判据：
    //   ① 登记表（6 处入口宣告）：逐处比集合；**缺行 = ERROR**（入口没写画幅，用户不知有几条合法通道）。
    //   ② 发现扫描：一行出现 ≥4 个**白名单内**比例值 = 它在做全量列举。未登记但集合正确的记 info，
    //      集合不对的发 WARN。用白名单过滤是因为裸 `\d:\d` 会误抓「光比 1:2 / 1:4 / 1:8 / 1:16」。
    //
    // 已知上限（写清，不假装覆盖）：②抓不到「新文档只写了 3 个值」——3 个值不像全量列举。
    // 补法只能是纪律：新增适配/宣告类文档必须登记进 TARGETS（见 references/README-索引.md 贡献段）。
    run(root) {
      const mlp = join(root, 'references', 'model-limits.json');
      if (!existsSync(mlp)) return { warn: 'L9：model-limits.json 缺席，跳过（跳过不是通过）' };
      let ml;
      try {
        ml = JSON.parse(read(mlp));
      } catch (e) {
        return { errors: [`L9：model-limits.json 解析失败：${e.message}——白名单读不了，等于没有判据`] };
      }
      const rw = ml.ratio_whitelist || {};
      const full = (rw.values || []).slice();
      const h3 = (rw.h3_values || []).slice();
      if (!full.length) return { warn: 'L9：ratio_whitelist.values 为空，跳过（跳过不是通过）' };
      const TARGETS = [
        // SKILL.md 的锁②宣告被拆成两行：标题行写「六值」、下一行才是枚举，
        // 所以锚点同时认「锁② 画幅」与枚举行开头的「16:9 横屏」，靠「含值最多」选中枚举行。
        ['SKILL.md', /锁②\s*画幅|16:9\s*横屏/, '锁② 画幅段'],
        ['README.md', /画幅[*\s]*[：:]/, '三锁 ②'],
        ['README.en.md', /aspect\s*ratio/i, 'Lock 2'],
        ['references/术语对照表_glossary.md', /锁②\s*画幅/, '术语表 锁②'],
        ['references/质控层_门禁与过审.md', /W-PARAM-RATIO/, 'W-PARAM-RATIO 码表'],
        ['references/liqi全景梳理.md', /②\s*画幅/, '流程全景 ②'],
      ];
      const TOKEN = /(?<![\d:])(\d{1,2}:\d{1,2})(?![\d:])/g;
      const errors = [], warns = [], infos = [];
      let checked = 0;
      const consumed = new Set();

      for (const [rel, re, label] of TARGETS) {
        const p = join(root, rel);
        if (!existsSync(p)) {
          errors.push(`L9 ${rel}「${label}」文件不存在——入口文档缺位比写错更难发现`);
          continue;
        }
        const lines = read(p).split('\n');
        let best = null;
        lines.forEach((line, idx) => {
          if (!re.test(line)) return;
          const toks = [...new Set(line.match(TOKEN) || [])];
          if (!best || toks.length > best.toks.length) best = { line, toks, idx };
        });
        if (!best || !best.toks.length) {
          // 由 WARN 升 ERROR：入口文档不写画幅，读者无从知道有几条合法通道。
          errors.push(`L9 ${rel}「${label}」找不到锁②宣告行——入口没写画幅，等于把「有几条合法通道」这件事藏起来了`);
          continue;
        }
        checked++;
        consumed.add(`${rel}:${best.idx}`);
        // H3 面维持四值是有据可依的例外（官方清单取自 Seedance 系文档，H3 是否支持 4:3/3:4 未核实），
        // 但必须在该行显式点名 H3，否则一律按六值判——这正是「整行copy过来忘了改」的病型。
        const isH3Only = /H3/i.test(best.line) && best.toks.every((v) => h3.includes(v));
        const expect = isH3Only ? h3 : full;
        const missing = expect.filter((v) => !best.toks.includes(v));
        const extra = best.toks.filter((v) => !expect.includes(v));
        if (missing.length || extra.length) {
          errors.push(`L9 ${rel}「${label}」画幅值集合不符：缺 ${missing.join(' / ') || '—'}；多 ${extra.join(' / ') || '—'}（应等于 ${expect.join(' / ')}）——锁②是执行入口，这里少一个值，用户就少一条合法通道`);
        }
      }

      // ② 发现扫描：未登记的全量列举。
      const fullSet = new Set(full), h3Set = new Set(h3);
      const files = ['SKILL.md', 'README.md', 'README.en.md'].filter((f) => existsSync(join(root, f)));
      const refDir = join(root, 'references');
      if (existsSync(refDir)) {
        for (const f of readdirSync(refDir)) {
          if (f.endsWith('.md') && f !== 'CHANGELOG.md') files.push(`references/${f}`);
        }
      }
      let discovered = 0;
      for (const rel of files) {
        const lines = read(join(root, rel)).split('\n');
        lines.forEach((line, idx) => {
          if (consumed.has(`${rel}:${idx}`)) return;
          if (/^\|\s*[4-6]\.\d+\s*\|/.test(line.trim())) return; // 历史版本账行不算宣告
          const toks = [...new Set(line.match(TOKEN) || [])];
          const inWl = toks.filter((v) => fullSet.has(v));
          if (inWl.length < 4) return; // 不足 4 个白名单值 = 局部列举，不判
          discovered++;
          const isH3Only = /H3/i.test(line) && toks.every((v) => h3Set.has(v));
          const expect = isH3Only ? h3 : full;
          const missing = expect.filter((v) => !toks.includes(v));
          const extra = toks.filter((v) => !expect.includes(v) && !/adaptive/i.test(v));
          if (missing.length || extra.length) {
            warns.push(`L9 未登记的全量画幅列举与白名单不符 ${rel}:${idx + 1}：缺 ${missing.join(' / ') || '—'}；多 ${extra.join(' / ') || '—'}（应等于 ${expect.join(' / ')}）——要么改对，要么把该行加进 TARGETS`);
          }
        });
      }

      if (errors.length) return { errors, warns, infos };
      infos.push(`L9：${checked} 处锁②宣告行的取值集合均等于 ratio_whitelist（${full.join(' / ')}）；另扫出 ${discovered} 处未登记的全量列举，集合均正确`);
      return { warns, infos };
    },
  },
];

// ───────────────────── 五、数值源自洽（v5.44.0） ─────────────────────
// 立这条的起因：有审查意见把 model-limits.json 的 refs「分项 9+3+3=15 与 total=12 不相等」
// 判为自相矛盾，并提议把 total 改成分项和。核官方原文后确认那是语义误读——
// 官方口径（MiniMax H3）：up to 9 images / 3 videos / 3 audio, **no more than 12 files in total**，
// 即分类上限与总量上限并存取交集，total ≤ 分项和 是恒成立的正常关系。
// 真正会出事的是反向：把 total 改成 15（分项和），等于把「总量上限」放松，且 2.5 档会一起错。
// 所以这里断言的是恒成立的性质，不是「相等」。语义注记见该 JSON 顶层的 refs_semantics。
function checkNumericSource(root) {
  const errors = [], warns = [];
  const p = join(root, 'references', 'model-limits.json');
  if (!existsSync(p)) return { errors, warns: ['model-limits.json 缺席，数值源自洽检查跳过（跳过不是通过）'] };
  let d;
  try {
    d = JSON.parse(read(p));
  } catch (e) {
    return { errors: [`model-limits.json 解析失败：${e.message}——数值唯一事实源读不了，后面所有时长/素材判定都不可信`], warns };
  }
  const slots = [];
  for (const [k, v] of Object.entries(d.models || {})) slots.push([`models/${k}`, v.refs, v.refs_note]);
  if (d.fallback && d.fallback.refs) slots.push(['fallback', d.fallback.refs, d.fallback.refs_source || d.fallback.note]);
  if (!slots.length) return { errors, warns: ['model-limits.json 里找不到任何 refs 分档，跳过（跳过不是通过）'] };
  for (const [name, r, note] of slots) {
    if (!r || typeof r !== 'object') { errors.push(`${name}.refs 缺失或不是对象`); continue; }
    const sum = (r.image || 0) + (r.video || 0) + (r.audio || 0);
    const tot = r.total;
    if (typeof tot !== 'number') { errors.push(`${name}.refs.total 不是数字（当前 ${JSON.stringify(tot)}）——总量上限缺失会让素材门静默放行`); continue; }
    // 性质一：总量上限必须小于等于分类上限之和（否则分类上限形同虚设，或被误改成「分项和」放松了约束）
    if (tot > sum) {
      errors.push(`${name}：refs.total=${tot} > 分项和=${sum} —— 总量上限不该超过分类上限之和。常见成因：把 total 误改成「分项和」（那会把总量上限从 12 放松到 15）。语义见 JSON 顶层 refs_semantics`);
    }
    // 性质二：总量上限必须是正数
    if (tot <= 0) errors.push(`${name}：refs.total=${tot} 不是正数——总量上限为 0 会让素材门恒红`);
    // 性质三：分项不得为负
    for (const k of ['image', 'video', 'audio']) {
      if (typeof r[k] === 'number' && r[k] < 0) errors.push(`${name}：refs.${k}=${r[k]} 为负数`);
    }
    // 性质四（最关键）：已核实档位的 total 必须等于官方原文值 total_checked。
    // 只靠「total ≤ 分项和」挡不住把 total 从 12 改成 15（15 ≤ 15 成立，但总量上限被放松了）——
    // 这条就是补那个洞：改动必须显式改 total_checked 并写明新来源，不能悄悄改 total。
    if ('total_checked' in r && r.total_checked !== null && r.total_checked !== undefined) {
      if (tot !== r.total_checked) {
        errors.push(`${name}：refs.total=${tot} ≠ total_checked=${r.total_checked}（已核实的官方值）。改总量上限必须同步改 total_checked 并在 refs_source 写明新官方来源——否则等于绕过已核实结论悄悄放宽约束`);
      }
    } else {
      // 四态口径：未核实 = 未查，不是通过。
      warns.push(`${name}：refs.total_checked 为空——本档总量上限**未经官方核实**（当前值 ${tot} 属沿用/待核）。补齐官方来源后回填该字段。未查 ≠ 通过`);
    }
    // 提示（非阻断）：total 严格小于分项和时，说明「分类不能同时取满」，应有文字说明，否则后人易误判为矛盾
    if (tot < sum && !(note || '').trim()) {
      warns.push(`${name}：refs.total=${tot} < 分项和=${sum}（分类不能同时取满）但该档没有 refs_note/refs_source 说明——缺一句话就会被后人误判成「自己跟自己打架」，已发生过一次`);
    }
  }
  // 性质五（v5.52.0 · C20，吸收 Emily2040 api-status 思想）：每模型面 last_verified 新鲜度。
  // 缺字段 = 未查（WARN，四态口径）；超 freshness_days = 过期（WARN）。日期只认「串首即日期」——
  // 「2026-10-23（沿用注记）」合法，注解跟在日期后；纯日期也合法。重盖戳前必须真的重读
  // refs_source 官方源（见 JSON 顶层 freshness_note）——只改日期不改来源 = 记录一次从未发生的核实。
  const fd = Number(d.freshness_days) > 0 ? Number(d.freshness_days) : 90;
  for (const [k, v] of Object.entries(d.models || {})) {
    const lv = v && typeof v.last_verified === 'string' ? v.last_verified : null;
    const m = lv && lv.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) {
      warns.push(`models/${k}：last_verified 缺失或不是日期开头（当前 ${JSON.stringify(lv)}）——数值面未经时效核验，未查 ≠ 通过`);
      continue;
    }
    const days = (Date.now() - Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) / 86400000;
    if (days > fd) {
      warns.push(`models/${k}：last_verified=${m[0]} 距今 ${Math.floor(days)} 天，超 freshness_days=${fd}——模型官方参数会静默过期；重读 refs_source 官方源后再盖新戳`);
    }
  }
  return { errors, warns };
}

// ───────────────── 锚点工具（v5.44.0 · P3 解锚） ─────────────────
// 起因：L1/L2/L5 原本是拿人类可读文本当锚（indexOf('每镜固定输出以下小节')、
// /##\s*一、景别视觉结果句（N 档/、/本表口径三态/）。一旦改标题措辞或把内容下沉到
// references，这三项立刻失锚——而它们恰恰是防「改了一层没改它引用的那一层」的。
// 解法：在文档里埋机器锚点 ID，检查只认 ID 不认措辞；措辞随便改，锚点跟着内容走即可。
const ANCHOR_RE = /<!--\s*ANCHOR:([A-Z0-9_-]+)\s*-->/g;

// 检查项真正依赖的锚点。L7 会逐一核对存在性——漏埋了要出声，不能静默回退。
const REQUIRED_ANCHORS = {
  L1: ['OPTICS-SHOTSIZE-DECL'],
  L2: ['SKILL-STEP3-SECTIONS-START', 'SKILL-STEP3-SECTIONS-END', 'GLOSSARY-STEP3-SECTION-COUNT'],
  // v6.0.0（N13）：SKILL-PARAM-TABLE-OFFICIAL 随参数总表迁出退役，改指 references/投放面参数总表.md 里的 PARAM-TABLE
  L5: ['SKILL-STEP1-DURATION-TRISTATE', 'PARAM-TABLE'],
};

function anchorsOf(text) {
  /** 返回 { id: 行号 } —— 出现两次以上只记首次，重复由 L7 单独报 */
  const out = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(ANCHOR_RE)) {
      if (!(m[1] in out)) out[m[1]] = i;
    }
  }
  return out;
}

function anchorLine(text, id) {
  const a = anchorsOf(text);
  return id in a ? a[id] : -1;
}

/** 锚点在整段文本里的字符偏移（L1/L2 的 slice 要的是偏移，不是行号） */
function anchorPos(text, id) {
  const m = text.match(new RegExp('<!--\\s*ANCHOR:' + id + '\\s*-->'));
  return m ? m.index : -1;
}

function checkConsistency(root) {
  const errors = [], warns = [], infos = [];
  for (const c of STRUCT_CONTRACTS) {
    let r = {};
    try {
      r = c.run(root) || {};
    } catch (e) {
      warns.push(`${c.id} 执行异常，已跳过：${e.message}（跳过不是通过）`);
      continue;
    }
    // 两种返回形态都收：
    //  · 老形态 { err / warn / info } 单条
    //  · 新形态 { errors / warns / infos } 数组（L7 用这种）
    // ⚠️ 只收单数会静默吞掉数组形态——L7 的「锚点未埋」「锚点重名」就是这样被吞过一次，
    //    反向回归才把它抓出来。新增检查项时留意这里。
    if (r.err) errors.push(r.err);
    if (r.warn) warns.push(r.warn);
    if (r.info) infos.push(r.info);
    if (Array.isArray(r.errors)) errors.push(...r.errors);
    if (Array.isArray(r.warns)) warns.push(...r.warns);
    if (Array.isArray(r.infos)) infos.push(...r.infos);
  }
  return { errors, warns, infos };
}

// ───────────────────────── 六、计数自检（v5.45.0） ─────────────────────────
// 起因：README 三处计数全部过时（references 75→实 84、已落值锚 20→实 26、scripts 35→实 38），
// 而前五项全绿——它们各管 SKILL.md↔码表/版本/锚点/数值，没有一个管 README。
// 本项只断言「机器可数的事实」：目录里数出来的数 vs README 声明的数，不符 = WARN；
// README 改写措辞导致正则取不到数 = WARN「未声明」——绝不静默通过（与 Z 门同口径）。
// 锚文件数 ≠ seed 注册表 id 数是 ERROR：贡献纪律要求三处同步，数量不等必是漏了一处。
function checkCounts(root) {
  const errors = [], warns = [], infos = [];
  const refsDir = join(root, 'references');
  if (!existsSync(refsDir)) return { errors, warns };
  const refMd = readdirSync(refsDir).filter((f) => f.endsWith('.md'));
  const anchors = refMd.filter((f) => /^风格锚_.+\.md$/.test(f) && f !== '风格锚_模板.md');
  let seedIds = null;
  try {
    seedIds = Object.keys(JSON.parse(read(join(refsDir, 'style-registry.seed.json'))).styles || {}).length;
  } catch { warns.push('style-registry.seed.json 解析失败，锚↔注册表数量对账跳过（跳过不是通过）'); }
  if (seedIds !== null && seedIds !== anchors.length) {
    errors.push(`已落值锚文件 ${anchors.length} 个 ≠ seed 注册表 ${seedIds} 个 id——贡献纪律三处同步漏了一处`);
  }
  const scriptDir = join(root, 'scripts');
  const sAll = existsSync(scriptDir) ? readdirSync(scriptDir).filter((f) => /\.(mjs|py|sh)$/.test(f)) : [];
  const nMjs = sAll.filter((f) => f.endsWith('.mjs')).length;
  const nPy = sAll.filter((f) => f.endsWith('.py')).length;
  const refsTotal = refMd.length + 2; // 顶层 md 数 + seed.json + model-limits.json
  const DECL = [
    ['README.md', join(root, 'README.md'), [
      ['references 文件数', /references\/\s*(\d+)\s*份文件/, refsTotal],
      ['顶层 md 数', /顶层\s*(\d+)\s*md/, refMd.length],
      ['已落值锚', /(\d+)\s*个已落值/, anchors.length],
      ['锚份数（树状行）', /├\s*(\d+)\s*份已落值风格锚/, anchors.length],
      ['scripts 总数', /(\d+)\s*个机械校验与工具脚本/, sAll.length],
      ['Node 脚本', /(\d+)\s*个\s*Node/, nMjs],
      ['Python 脚本', /(\d+)\s*个\s*Python/, nPy],
    ]],
    ['README.en.md', join(root, 'README.en.md'), [
      ['references files', /references\/\s*(\d+)\s*files?/i, refsTotal],
      ['top-level md', /(\d+)\s*md at top level/i, refMd.length],
      ['ready anchors', /(\d+)\s*with a ready style anchor/i, anchors.length],
      ['anchor count (tree)', /├\s*(\d+)\s*ready style anchors?/i, anchors.length],
      ['scripts total', /(\d+)\s*checkers and tools/i, sAll.length],
      ['Node scripts', /(\d+)\s*Node\s*\+/, nMjs],
      ['Python scripts', /(\d+)\s*Python\s*\+/, nPy],
    ]],
  ];
  for (const [name, path, rows] of DECL) {
    // v6.0.1：本包根本不提供该语种 README（插件协议形态常见）→ 不适用，不是缺陷。
    // 与 L2/L5/L7/L8 的协议形态同口径：不适用 ≠ 通过，照样打印，不静默。
    // 若文件存在但读不出来（权限/编码），仍按 WARN 处理——那是异常，不是设计。
    if (!existsSync(path)) {
      infos.push(`${name} 不存在——本包不提供该语种说明，计数自检对该语种不适用（不适用 ≠ 通过）`);
      continue;
    }
    let text = null;
    try { text = read(path); } catch { warns.push(`${name} 读取失败，跳过（跳过不是通过）`); }
    if (text === null) continue;
    for (const [label, re, actual] of rows) {
      const m = text.match(re);
      if (!m) { warns.push(`${name} 的「${label}」声明未找到（措辞改了？请同步本检查的正则）`); continue; }
      if (Number(m[1]) !== actual) warns.push(`${name} 声明 ${label} = ${m[1]}，机器实数 = ${actual}——README 计数漂移`);
    }
  }
  return { errors, warns, infos };
}

function main() {
  const root = process.argv[2] || dirname(dirname(fileURLToPath(import.meta.url)));
  if (!existsSync(join(root, 'SKILL.md'))) {
    console.error(`用法：node scripts/check_skill.mjs [skill根目录]（找不到 ${join(root, 'SKILL.md')}）`);
    process.exit(2);
  }
  const sections = [
    ['一、路径存在', checkPaths(root)],
    ['二、码号两向对照', checkCodes(root)],
    ['三、版本同步', checkVersion(root)],
    ['四、联动一致性（L1~L9）', checkConsistency(root)],
    ['五、数值源自洽（v5.44.0）', checkNumericSource(root)],
    ['六、计数自检（v5.45.0）', checkCounts(root)],
  ];
  let nErr = 0, nWarn = 0, nInfo = 0;
  console.log(`\nliqi skill 自检 —— ${root}\n`);
  for (const [title, res] of sections) {
    const { errors = [], warns = [], infos = [] } = res;
    console.log(`## ${title}`);
    if (!errors.length && !warns.length && !infos.length) {
      console.log('  ✅ 通过\n');
      continue;
    }
    for (const e of errors) { console.log(`  ❌ ${e}`); nErr++; }
    for (const w of warns) { console.log(`  ⚠️  ${w}`); nWarn++; }
    // 不适用单独一档（v5.44.0）：要出声，但不进 ERROR/WARN——
    // 把「不适用」混进警告会让永远不可能满足的项淹没真警告（crew 的 L5 就是例子）。
    // 不加「（不适用）」后缀——info 档里既有「不适用」也有「锚点就位」这类确认性说明，
    // 统一加后缀会让好消息读起来像缺陷。文案自己说清性质。
    for (const i of infos) { console.log(`  ○ ${i}`); nInfo++; }
    console.log('');
  }
  // 结尾判断给结论。v6.19.1：只有 0 ERROR **且** 0 WARN 才算干净——
  // 此前 0 ERROR / N WARN 也打印「无 ERROR」，与 check_copies「1 WARN 仍说三副本一致」是同一类
  // 「有警告却给平安结论」。警告不是噪声，是待看的差异。
  const verdict = nErr ? '有 ERROR，必须修完再交付'
    : (nWarn ? `无 ERROR，但有 ${nWarn} 条 WARN 待看（WARN ≠ 通过）` : '无 ERROR');
  console.log(`合计：${nErr} ERROR / ${nWarn} WARN${nInfo ? ` ／ 另有 ${nInfo} 项不适用（不适用 ≠ 通过）` : ''} —— ${verdict}\n`);
  process.exit(nErr ? 1 : 0);
}

main();
