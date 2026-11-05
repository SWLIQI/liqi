#!/usr/bin/env node
// -*- coding:utf-8 -*-
/**
 * selftest_check_env.mjs —— 环境医生（check_env.mjs）的自测（v5.52.0 · 5 组）
 *
 * 设计：进程内黑盒（import runChecks，不 spawn 主脚本本体——沙箱环境 spawn 会 EBUSY），
 * 「环境缺失」场景用**候选名单注入不可能存在的解释器名**来构造，不剥 PATH——
 * Windows CreateProcess 对裸名有系统目录兜底搜索，剥 PATH 拦不住 C:\Windows\py.exe，
 * 靠剥 PATH 造出来的「红」在这台机器上过了、在别的机器上照样假绿。
 * CLI 面（--json 纯度 / 文本标题）单独 spawn 一次主脚本——只跑 node 自己，无外部依赖。
 *
 * 用法：node scripts/selftest_check_env.mjs
 * 退出码：0 = 全过；1 = 有失败
 */
import { runChecks, toWinPath } from './check_env.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` —— ${detail}` : ''}`);
  if (ok) pass++; else fail++;
}

// 分级正确性（不断言「python 必在」——本自测可能在任何机器上跑，机器没装 python 不是判据的错，
// run_all_checks 预检会拦；这里锁的是**分级逻辑**：node 达标 / 目录可写 / 找到的必 ok / 红只来自 python 缺席）
const r = runChecks(ROOT);
const pyOkLevel = !r.data.python.found || r.items.find((i) => i.key === 'python').level === 'ok';
check('分级正确：node 达标、目录可写、找到即 ok；红项只可能来自 python 缺席（黄不算红）',
  r.data.writable === true && r.data.node_ok === true
    && r.red === (r.data.python.found ? 0 : 1) && pyOkLevel,
  `red=${r.red}｜python=${r.data.python.found ? r.data.python.cmd + ' ' + (r.data.python.version || '') : '缺席（本机 PATH 无——run_all_checks 预检会拦，不是判据的错）'}｜黄=${r.yellow}`);

// 假设计注入：解释器与 ffmpeg 全部指向不可能存在的名字 → python 必红、ffmpeg 必黄
const r2 = runChecks(ROOT, { pythonCandidates: ['liqi_no_such_interp_x9'], ffmpegCandidates: ['liqi_no_such_ffmpeg_x9'] });
const pyItem = r2.items.find((i) => i.key === 'python');
const ffItem = r2.items.find((i) => i.key === 'ffmpeg');
check('解释器集体失踪时 python 报红并给安装指引（假名注入，不依赖真机 PATH）',
  r2.data.python.found === false && pyItem.level === 'red' && /Python/.test(pyItem.hint),
  `python level=${pyItem.level}｜hint 含安装指引=${/Python\.Python\.3|winget|PY=/.test(pyItem.hint)}`);

check('ffmpeg 缺席降黄不拦自测（只影响渲染后机检门）',
  r2.data.ffmpeg.found === false && ffItem.level === 'yellow' && /audit_render|--ffmpeg/.test(ffItem.hint),
  `ffmpeg level=${ffItem.level}｜red 合计=${r2.red}（应 ≥1，来自 python）`);

// CLI 面：--json 纯输出（供预检与工具链消费），文本模式人读面齐全
const jr = spawnSync(process.execPath, [join(HERE, 'check_env.mjs'), ROOT, '--json'], { encoding: 'utf8', windowsHide: true });
let parsed = null;
try { parsed = JSON.parse(jr.stdout); } catch { /* parsed 保持 null，下面断言会红 */ }
check('CLI --json 纯输出可解析且结构齐（red/yellow/items/data）',
  jr.status === (parsed && parsed.red ? 1 : 0) && parsed !== null && Array.isArray(parsed.items)
    && 'red' in parsed && 'yellow' in parsed && 'data' in parsed && 'python' in parsed.data,
  `exit=${jr.status}｜items=${parsed ? parsed.items.length : '解析失败'}`);

const tr = spawnSync(process.execPath, [join(HERE, 'check_env.mjs'), ROOT], { encoding: 'utf8', windowsHide: true });
check('CLI 文本模式含医生标题与红黄合计行',
  tr.stdout.includes('环境医生') && tr.stdout.includes('合计：') && tr.stdout.includes('红') && tr.stdout.includes('黄'),
  `首行=${(tr.stdout.split('\n').find((l) => l.includes('环境医生')) || '（无）').trim()}`);

check('PY= 的 MSYS 风格路径可转换（Git Bash 的 command -v 输出 /c/... 时 spawnSync 也能吃下）',
  toWinPath('/c/Users/张/x.exe') === 'C:/Users/张/x.exe'
    && toWinPath('C:/plain/python.exe') === 'C:/plain/python.exe'
    && toWinPath('/usr/bin/python3') === '/usr/bin/python3',
  `转换示例=${toWinPath('/c/Users/张/x.exe')}（非盘符开头不转，留给非 Windows 语义）`);

console.log(`结果：${pass} 过 / ${fail} 败`);
process.exit(fail > 0 ? 1 : 0);
