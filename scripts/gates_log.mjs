/**
 * gates_log.mjs —— 门失败累积的共享日志模块
 *
 * 七个写入方脚本（check_prompt / check_prompt_h3 / check_style / audit_literal / audit_risk /
 * audit_project / audit_contract）
 * 在每次运行后把结果追加到「被校验文件同目录」的 .gates.jsonl，一行一条 JSON。
 * 之后跑 gates_stats.mjs 就能回答三件事：
 *   1. 哪道门最常响 —— 那条规则模型最常无视，该改的是措辞；
 *   2. 哪道门从没响过 —— 可能是死门，也可能规则已被内化；
 *   3. 失败详情长什么样 —— 反复出现却没有门的那类问题，只能靠人看。
 *
 * 设计约定（与 novel-storyboard 的 .gates.jsonl 口径一致）：
 *   - 写不进去（只读目录 / 磁盘满）静默跳过，绝不影响校验本身的退出码；
 *   - 默认记录，--no-log 关闭；退出码 2（输入异常）不记录——没有解析就没有门。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// P0-3（v5.50.0）：记录来源标记——治「门效数据自证」（此前报表里 562 条记录 556 条来自
// 黄金样例自测，real 占比却只活在注释里）。判定优先级：
//   ① 环境变量 LIQI_ORIGIN（selftest / golden / real 三值）——自测入口显式声明
//      （run_all_checks.sh 全程导出 selftest）；
//   ② 路径判据——被校验文件在本库 examples/ 下 → golden（黄金样例的任何直接运行）；
//   ③ 其余 → real（真实项目，死码治理唯一认的来源）。
// 老记录无此字段，消费方按 unknown 分组——**「未标」不是 real**。
function detectOrigin(file) {
  const env = process.env.LIQI_ORIGIN;
  if (env === 'selftest' || env === 'golden' || env === 'real') return env;
  try {
    const f = path.resolve(file);
    const ex = path.join(SKILL_ROOT, 'examples');
    if (f === ex || f.startsWith(ex + path.sep)) return 'golden';
  } catch { /* 路径解析失败按 real */ }
  return 'real';
}

const lvOf = (it) => String(it.level || it.lv || '').toLowerCase();

/**
 * 追加一条运行记录。
 * @param {object} r
 * @param {string} r.tool    脚本名，如 'check_prompt.mjs'
 * @param {string} r.file    被校验文件路径（日志写到它同目录的 .gates.jsonl）
 * @param {number} r.exit    本次运行的退出码
 * @param {Array}  r.issues  issues 数组（兼容 {level,code} 与 {lv,code} 两种结构）
 * @param {string} [r.target] 可选：投放面 / 参数快照
 */
export function appendGateLog({ tool, file, exit, issues = [], target }) {
  try {
    const dir = path.dirname(path.resolve(file));
    const logPath = path.join(dir, '.gates.jsonl');
    const codes = {};
    for (const it of issues) {
      const c = it.code || 'UNKNOWN';
      codes[c] = (codes[c] || 0) + 1;
    }
    const rec = {
      // schema 版本（v5.37.10）：与 gates_log.py 同口径。node 侧不产出分类字段
      // （`skip_input` 那套只有 audit_project 会算），但版本号要一致，
      // 否则 gates_stats 会把 node 记录全当成「v1 老格式」去解释。
      // v5.50.0 起加可选 `origin`（selftest/golden/real，见 detectOrigin）——
      // 沿用 v2 内加可选字段的先例（skips / skip_*），不升版本号；老记录读作 unknown。
      v: 2,
      ts: new Date().toISOString(),
      tool,
      file: path.basename(file),
      origin: detectOrigin(file),
      exit,
      errors: issues.filter((i) => lvOf(i).startsWith('err')).length,
      warns: issues.filter((i) => lvOf(i).startsWith('warn')).length,
      // 「未查」单列（v5.37.3）：它与 warn 共用过一条通道，导致 warns 数不能当质量信号读。
      // 写进记录里，历史趋势才能回答「这道门最近是查出来的，还是压根没跑」。
      skips: issues.filter((i) => lvOf(i).startsWith('skip')).length,
      codes,
    };
    if (target) rec.target = target;
    fs.appendFileSync(logPath, JSON.stringify(rec) + '\n', 'utf8');
  } catch {
    /* 静默：日志失败不阻断校验 */
  }
}

/** argv 里是否显式关闭日志 */
export const logDisabled = (argv) => argv.includes('--no-log');
