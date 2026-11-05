#!/usr/bin/env node
// 自测：合格样例应通过、不合格与类型异常样例应被拦下。零依赖。
// 用法：node scripts/selftest.mjs
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const run = (script, args) => spawnSync(process.execPath, [path.join(HERE, script), ...args], { encoding: 'utf8' });

const results = [];
const check = (name, cond, extra) => results.push([name, cond, extra || '']);

const goodPath = path.join(ROOT, 'examples', 'cast-good.json');
const badPath = path.join(ROOT, 'examples', 'cast-bad.json');
const good = JSON.parse(fs.readFileSync(goodPath, 'utf8'));
const clone = () => JSON.parse(JSON.stringify(good));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liqi-cast-'));
const writeTmp = (name, obj) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2), 'utf8');
  return p;
};

// 1) 合格样例：应通过且输出含全部硬约束
const ok = run('cast_sheet.mjs', [goodPath, '--check']);
check('合格样例 exit=0', ok.status === 0, 'status=' + ok.status);
check('输出含 4 VIEW 标题', /\[4 VIEW CHARACTER SHEET\]/.test(ok.stdout));
check('右区写明保头无脸', /featureless face/.test(ok.stdout));
check('含排版 88%/12%', /88%/.test(ok.stdout) && /12%/.test(ok.stdout));
check('左区上下双锁', /top of head fully inside frame/.test(ok.stdout) && /two fingers below the collarbone/.test(ok.stdout));
check('性别锚点收尾 LEFT', /22~24岁女性（行走江湖的制伞人）\n/.test(ok.stdout));
check('含身高线数值', /HEIGHT LINE/.test(ok.stdout) && /168 cm/.test(ok.stdout));
check('含色板中文色名', /PALETTE/.test(ok.stdout) && /青灰 #3A4E48/.test(ok.stdout));
check('互锁词在负向段', /NEGATIVE \(per version/.test(ok.stdout) && !/互锁负面词/.test(ok.stdout));
check('interlock_en 生效', /blood stains, bandages, torn hem/.test(ok.stdout));
check('--check 打印九问', /出图前九问/.test(ok.stdout));
check('16 项编号 11–16', /11\. fabric/.test(ok.stdout) && /16\. seam/.test(ok.stdout));

// 2) 不合格样例：两份脚本都应拦下
const badSheet = run('cast_sheet.mjs', [badPath]);
check('不合格样例 cast_sheet 退出非零', badSheet.status !== 0, 'status=' + badSheet.status);
check('cast_sheet 报出 ERROR', /ERROR/.test(badSheet.stderr + badSheet.stdout));

const badCheck = run('check_cast.mjs', [badPath]);
check('不合格样例 check_cast 退出非零', badCheck.status !== 0, 'status=' + badCheck.status);
check('check_cast 抓到色值格式', /#RRGGBB/.test(badCheck.stdout));
check('check_cast 抓到版本重名', /重名/.test(badCheck.stdout));
check('check_cast 抓到身高', /height_cm/.test(badCheck.stdout));
check('五官缺项编号 10 正确', /五官缺 skin（第 10 项）/.test(badCheck.stdout));

// 3) 类型异常：应给中文 ERROR，不抛栈
const typeErr = clone();
typeErr.face = 'not-an-object';
typeErr.palette = 'not-an-array';
typeErr.versions = { a: 1 };
const t1 = run('cast_sheet.mjs', [writeTmp('type-errors.json', typeErr)]);
check('类型异常退出非零', t1.status !== 0, 'status=' + t1.status);
check('类型异常不抛栈', !/TypeError|ReferenceError|at file:/.test(t1.stderr), t1.stderr.slice(0, 120));
check('类型异常给中文 ERROR', /face 必须是对象/.test(t1.stderr) && /palette 必须是数组/.test(t1.stderr) && /versions 必须是数组/.test(t1.stderr));

const t2 = run('check_cast.mjs', [writeTmp('null.json', 'null')]);
check('根节点 null 有中文提示', t2.status !== 0 && /根节点必须是 JSON 对象/.test(t2.stdout + t2.stderr) && !/TypeError/.test(t2.stderr));

// 4) 边界规则：mark 缺省只 WARN；互锁词缺省 / 雷同应 ERROR
const noMark = clone();
delete noMark.face.mark;
const t3 = run('check_cast.mjs', [writeTmp('no-mark.json', noMark)]);
check('mark 未声明给 WARN 且 0 ERROR', t3.status === 0 && /mark 未声明/.test(t3.stdout) && /0 ERROR/.test(t3.stdout), 'status=' + t3.status);

const noInterlock = clone();
delete noInterlock.versions[0].interlock;
const t4 = run('check_cast.mjs', [writeTmp('no-interlock.json', noInterlock)]);
check('缺互锁词报 ERROR', t4.status !== 0 && /缺互锁词/.test(t4.stdout));

const sameInterlock = clone();
sameInterlock.versions[1].interlock = sameInterlock.versions[0].interlock.slice();
const t5 = run('check_cast.mjs', [writeTmp('same-interlock.json', sameInterlock)]);
check('两版互锁词雷同报 ERROR', t5.status !== 0 && /互锁词完全相同/.test(t5.stdout));

// 5) 参数缺失与同步检查
const noArg = run('cast_sheet.mjs', []);
check('无参数时提示用法', noArg.status !== 0 && /用法/.test(noArg.stderr), 'status=' + noArg.status);

const sync = run('check_sync.mjs', [path.join(tmp, 'no-such-core')]);
check('check_sync 未找到主包 = 跳过(2)', sync.status === 2 && /跳过不等于通过/.test(sync.stdout), 'status=' + sync.status);

let pass = 0;
for (const [name, cond, extra] of results) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '  ' + extra));
  if (cond) pass++;
}
console.log('\n---- ' + pass + '/' + results.length + ' 通过 ----');

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(pass === results.length ? 0 : 1);
