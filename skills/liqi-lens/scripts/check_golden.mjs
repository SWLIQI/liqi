#!/usr/bin/env node
// 黄金输出守卫：examples 的 5 个脚本输出 + selftest 输出逐行 diff。零依赖。
// 用法：node scripts/check_golden.mjs（npm test 会先跑 selftest 再跑这里）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const CASES = [
  ['check-pass.txt', 'check_lens.mjs', ['examples/shot-list-good.json']],
  ['check-fail.txt', 'check_lens.mjs', ['examples/shot-list-bad.json']],
  ['shot-cards.txt', 'shot_list.mjs', ['examples/shot-list-good.json']],
  ['shot-table.md', 'shot_list.mjs', ['examples/shot-list-good.json', '--md']],
  ['shot-list.normalized.json', 'shot_list.mjs', ['examples/shot-list-good.json', '--json']],
  ['selftest-output.txt', 'selftest.mjs', []]
];

let fail = 0;
for (const [rel, script, args] of CASES) {
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], { cwd: ROOT, encoding: 'utf8' });
  const got = (r.stdout || '').replace(/\r\n/g, '\n');
  const want = fs.readFileSync(path.join(ROOT, 'examples', rel), 'utf8').replace(/\r\n/g, '\n');
  if (got === want) {
    console.log('PASS  ' + rel);
    continue;
  }
  fail++;
  console.log('FAIL  ' + rel + '  (exit ' + r.status + ')');
  const a = got.split('\n');
  const b = want.split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  console.log('  首个差异行 ' + (i + 1));
  console.log('  got : ' + JSON.stringify(a[i] === undefined ? '(EOF)' : a[i]));
  console.log('  want: ' + JSON.stringify(b[i] === undefined ? '(EOF)' : b[i]));
}
console.log('\n---- ' + (CASES.length - fail) + '/' + CASES.length + ' 黄金输出一致 ----');
process.exit(fail ? 1 : 0);