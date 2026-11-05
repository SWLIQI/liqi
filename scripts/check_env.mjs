#!/usr/bin/env node
// -*- coding:utf-8 -*-
/**
 * liqi 环境医生（v5.52.0 · C17，吸收 Emily2040/seedance-2.0 的 install doctor 思想——机制参考，零拷贝）
 *
 * 治的病：环境不对时，十四套自测的失败全是噪音。本会话实测三起：
 *   ① Python 不在 PATH（藏在 AppData），run_all_checks 直接拒跑，用户只看到「运行时缺失」；
 *   ② Windows 控制台默认 GBK，缺 PYTHONUTF8=1 时中文断言两例假败（boundary N4）；
 *   ③ ffmpeg 不在 PATH，audit_render 全部用例假绿成「跳过」。
 * 三起的共同点：**都不是判据的错，是环境的错，但没有一个工具负责把「环境的错」说清楚**。
 * 本脚本只读体检、每项失败直接给修复命令；红项 = 拦自测（python 缺席 / 目录不可写 / node 过旧），
 * 黄项 = 只影响对应门（ffmpeg/ffprobe 缺席 → 渲染后机检；UTF-8 异常 → 含中文断言的自测）。
 *
 * 检六项：① node 版本（≥18）② python 可达性与大版本（PY= 覆盖优先）③ python UTF-8 行为
 *        ④ ffmpeg ⑤ ffprobe ⑥ 目录可写（.gates.jsonl 可追加的前提）
 * 用法：node scripts/check_env.mjs [目录=当前目录] [--json]
 * 退出码：0 = 无红项；1 = 有红项；2 = 用法错误
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_FLOOR = 18;

/** Git Bash 的 command -v 输出 MSYS 风格路径（/c/...），Windows spawnSync 不认识——转成 C:/... */
export function toWinPath(p) {
  return process.platform === 'win32' ? p.replace(/^\/([a-zA-Z])\//, (_m, d) => d.toUpperCase() + ':/') : p;
}

/** 单项体检结果。level: 'ok' | 'yellow' | 'red'——红拦自测，黄只影响对应门。 */
function item(key, level, label, detail, hint) {
  return { key, level, label, detail, hint: hint || '' };
}

/**
 * 体检主函数（导出给 selftest_check_env.mjs 进程内调用，避免沙箱 spawn EBUSY）。
 * opts.env                —— 环境变量覆盖（合并到 process.env 之上）
 * opts.pythonCandidates   —— 候选解释器名单覆盖（自测注入「不可能存在的名字」用，
 *                            不剥 PATH——Windows CreateProcess 会兜底搜系统目录，剥 PATH 拦不住 py.exe）
 * opts.ffmpegCandidates   —— 同上（ffmpeg/ffprobe）
 */
export function runChecks(dir, opts = {}) {
  const env = { ...process.env, ...(opts.env || {}) };
  const items = [];
  const data = { node: process.versions.node };

  // ① node（本脚本能跑说明 node 在；只查版本下限）
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  data.node_ok = nodeMajor >= NODE_FLOOR;
  items.push(data.node_ok
    ? item('node', 'ok', 'node', `v${process.versions.node}（要求 ≥${NODE_FLOOR}）`)
    : item('node', 'red', 'node', `v${process.versions.node} 低于 ${NODE_FLOOR}`,
      `升级 Node ≥${NODE_FLOOR} LTS：winget install OpenJS.NodeJS.LTS ｜ macOS: brew install node`));

  // ② python：PY= 显式指定优先（与 run_all_checks.sh 同口径），否则 python3 → python → py
  const pyCands = opts.pythonCandidates
    || (env.PY ? [toWinPath(env.PY), 'python3', 'python', 'py'] : ['python3', 'python', 'py']);
  let py = null;
  for (const c of pyCands) {
    const r = spawnSync(c, ['--version'], { env, encoding: 'utf8', windowsHide: true });
    if (r.status === 0) { py = { cmd: c, version: ((r.stdout || '') + (r.stderr || '')).trim() }; break; }
  }
  data.python = py ? { found: true, cmd: py.cmd, version: py.version } : { found: false };
  if (!py) {
    items.push(item('python', 'red', 'python', '三个候选（python3 / python / py）都不可达',
      '装 Python 3：winget install Python.Python.3（或 Microsoft Store 搜 Python；装完即有 python 与 py）——六个 Python 审计门依赖它；也可 PY=<路径> 显式指定'));
  } else {
    const vm = py.version.match(/Python\s+(\d+)\.(\d+[\d.]*)/);
    const major = vm ? Number(vm[1]) : null;
    data.python.major = major;
    if (major !== null && major < 3) {
      items.push(item('python', 'red', 'python', `${py.version}（${py.cmd}）是 Python 2`,
        '本库审计门需 Python ≥3.6：winget install Python.Python.3，或 PY= 指向 Python 3 的路径'));
    } else {
      items.push(item('python', 'ok', 'python', `${py.version || '（版本读不出，但可执行）'}（${py.cmd}）`));
      // ③ python UTF-8 行为：真跑一句含中文的 print，不查环境变量查**实际行为**——
      //    有的机器 PYTHONUTF8 没设但控制台本来是 UTF-8，那就不该报。
      const u = spawnSync(py.cmd, ['-c', 'print("语速实测锚")'], { env, encoding: 'utf8', windowsHide: true });
      const utf8Ok = u.status === 0 && (u.stdout || '').includes('语速实测锚');
      data.python_utf8 = { ok: utf8Ok };
      items.push(utf8Ok
        ? item('python_utf8', 'ok', 'python UTF-8', '中文输出正常（含中文断言的自测可跑）')
        : item('python_utf8', 'yellow', 'python UTF-8', 'print 中文返回乱码或报错——Windows 控制台默认 GBK',
          'export PYTHONUTF8=1（run_all_checks.sh 已内置）；要持久生效：setx PYTHONUTF8 1 后重开终端'));
    }
  }

  // ④⑤ ffmpeg / ffprobe：缺席是黄不是红——只影响 audit_render 渲染后机检，其余门照跑
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const cands = opts.ffmpegCandidates || [tool];
    let found = null;
    for (const c of cands) {
      const r = spawnSync(c, ['-version'], { env, encoding: 'utf8', windowsHide: true });
      if (r.status === 0) { found = ((r.stdout || '') + (r.stderr || '')).split('\n')[0].trim(); break; }
    }
    data[tool] = { found: !!found, version: found || null };
    items.push(found
      ? item(tool, 'ok', tool, found)
      : item(tool, 'yellow', tool, '不在 PATH',
        `渲染后机检（audit_render）需要 ${tool}：winget install Gyan.FFmpeg ｜ macOS: brew install ffmpeg 后重开终端；或渲染时 --ffmpeg <bin目录> 显式指定（不回退 PATH）`));
  }

  // ⑥ 目录可写（.gates.jsonl 追加的前提）：探针文件写了就删
  const probe = join(dir, '.check_env_probe');
  let writable = true, wErr = '';
  try { writeFileSync(probe, 'ok', 'utf-8'); unlinkSync(probe); }
  catch (e) { writable = false; wErr = e.message; }
  data.writable = writable;
  const hasLedger = existsSync(join(dir, '.gates.jsonl'));
  items.push(writable
    ? item('writable', 'ok', '目录可写', hasLedger ? '（.gates.jsonl 已存在，可追加）' : '（首条门禁日志将新建 .gates.jsonl）')
    : item('writable', 'red', '目录可写', `探针文件写不进：${wErr}`,
      '门禁日志 .gates.jsonl 无法落盘——检查目录权限 / 磁盘满 / 杀毒软件拦截'));

  const red = items.filter((i) => i.level === 'red').length;
  const yellow = items.filter((i) => i.level === 'yellow').length;
  return { dir, items, red, yellow, data };
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const pos = args.filter((a) => !a.startsWith('--'));
  if (pos.length > 1) {
    console.error('用法：node scripts/check_env.mjs [目录=当前目录] [--json]');
    process.exit(2);
  }
  const dir = pos[0] || '.';
  const r = runChecks(dir);
  if (json) {
    console.log(JSON.stringify(r));
    process.exit(r.red ? 1 : 0);
  }
  console.log(`\nliqi 环境医生 —— ${dir}\n`);
  for (const it of r.items) {
    const mark = it.level === 'ok' ? '✅' : it.level === 'yellow' ? '⚠️ ' : '❌';
    console.log(`  ${mark} ${it.label}：${it.detail}`);
    if (it.hint) console.log(`     → ${it.hint}`);
  }
  console.log(`\n合计：${r.red} 红 / ${r.yellow} 黄 —— 红项拦自测；黄项只影响对应门（ffmpeg/ffprobe → 渲染后机检，UTF-8 → 含中文断言的自测）\n`);
  process.exit(r.red ? 1 : 0);
}

// 直接运行才走 CLI；被 import 时只暴露 runChecks（selftest 进程内调用，不 spawn 主脚本本体）
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
