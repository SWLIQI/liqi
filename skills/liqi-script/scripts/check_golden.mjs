#!/usr/bin/env node
// 黄金输出守卫：examples 的 5 个脚本输出 + selftest 输出逐行 diff。零依赖。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CASES = [
  ['check-pass.txt', 'check_script.mjs', ['examples/script-good.json']],
  ['check-fail.txt', 'check_script.mjs', ['examples/script-bad.json']],
  ['script-cards.txt', 'script_card.mjs', ['examples/script-good.json']],
  ['script-table.md', 'script_card.mjs', ['examples/script-good.json', '--md']],
  ['script.normalized.json', 'script_card.mjs', ['examples/script-good.json', '--json']],
  ['selftest-output.txt', 'selftest.mjs', []]
];

let fail = 0;
for (const [rel, script, args] of CASES) {
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], { cwd: ROOT, encoding: 'utf8' });
  const got = (r.stdout || '').replace(/\r\n/g, '\n');
  const want = fs.readFileSync(path.join(ROOT, 'examples', rel), 'utf8').replace(/\r\n/g, '\n');
  if (got === want) { console.log('PASS  ' + rel); continue; }
  fail++;
  console.log('FAIL  ' + rel + '  (exit ' + r.status + ')');
  const a = got.split('\n'), b = want.split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  console.log('  首个差异行 ' + (i + 1));
  console.log('  got : ' + JSON.stringify(a[i] === undefined ? '(EOF)' : a[i]));
  console.log('  want: ' + JSON.stringify(b[i] === undefined ? '(EOF)' : b[i]));
}
console.log('\n---- ' + (CASES.length - fail) + '/' + CASES.length + ' 黄金输出一致 ----');
process.exit(fail ? 1 : 0);