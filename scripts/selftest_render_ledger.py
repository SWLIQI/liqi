#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""selftest_render_ledger.py —— 渲染评测台账（render_ledger.py）的自测（v5.53.0 · 10 组）

设计：子进程黑盒（台账 CLI 的价值就在「外部可调用」，进程内测不出 argparse 边界），
每组建独立临时目录，台账互不污染。断言只锚 ASCII 码号与退出码——中文输出在
非 UTF-8 控制台会降级，断言中文等于把编码环境耦合进用例（N7 教训）。

用法：python scripts/selftest_render_ledger.py
退出码：0 = 10 组全过；1 = 有失败
"""
from __future__ import print_function

import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'render_ledger.py')
ENV = dict(os.environ, PYTHONUTF8='1', LIQI_ORIGIN='selftest')

passed, failed = 0, 0


def run(args):
    p = subprocess.run([sys.executable, SCRIPT] + [str(x) for x in args],
                       capture_output=True, env=ENV)
    return p.returncode, (p.stdout + p.stderr).decode('utf-8', 'replace')


def case(name, ok, detail=''):
    global passed, failed
    print(('%s %s%s' % ('✅' if ok else '❌', name, (' —— ' + detail) if detail else ''))
          if ok else ('❌ %s%s' % (name, (' —— ' + detail) if detail else '')))
    if ok:
        passed += 1
    else:
        failed += 1


def led(d):
    return os.path.join(d, 'render_ledger.jsonl')


BASE = ['--segment', '段1', '--model', '2.5', '--prompt-ver', 'v3', '--attempt', 1, '--outcome', 'accepted']

# 1. 正常落盘：全字段写入，回读逐项一致
d = tempfile.mkdtemp()
rc, o = run(['add', '--ledger', led(d)] + BASE + ['--ending', '她立于门内，右手仍搭门闩', '--rule', '末帧回身要写明手位', '--gates', '0E/6W', '--cost', '2.5'])
if rc == 0 and os.path.exists(led(d)):
    e = json.loads(open(led(d), encoding='utf-8').read().strip())
    ok1 = (e['segment'] == '段1' and e['model'] == '2.5' and e['attempt'] == 1
           and e['outcome'] == 'accepted' and e['actual_ending'].startswith('她立于门内')
           and e['learned_rule'].startswith('末帧回身') and e['cost'] == 2.5 and bool(e['date']))
else:
    ok1 = False
case('add 正常落盘且字段回读一致（含实录尾帧与学到规则）', ok1, 'rc=%d' % rc)
shutil.rmtree(d, ignore_errors=True)

# 2. outcome 非法 → E-LEDGER-OUTCOME，且不落盘
d = tempfile.mkdtemp()
rc, o = run(['add', '--ledger', led(d), '--segment', '段1', '--model', '2.5', '--prompt-ver', 'v3',
             '--attempt', 1, '--outcome', 'success'])
case('outcome 非法报 E-LEDGER-OUTCOME 且不落盘',
     rc == 1 and 'E-LEDGER-OUTCOME' in o and not os.path.exists(led(d)), 'rc=%d' % rc)
shutil.rmtree(d, ignore_errors=True)

# 3. attempt=0 → E-LEDGER-SCHEMA（缺字段走 argparse 的 rc2，属用法错，不重复造）
d = tempfile.mkdtemp()
rc, o = run(['add', '--ledger', led(d), '--segment', '段1', '--model', '2.5', '--prompt-ver', 'v3',
             '--attempt', 0, '--outcome', 'retake'])
case('attempt=0 报 E-LEDGER-SCHEMA', rc == 1 and 'E-LEDGER-SCHEMA' in o, 'rc=%d' % rc)
shutil.rmtree(d, ignore_errors=True)

# 4. 同 (segment, prompt_ver, attempt) 重复 → E-LEDGER-DUP
d = tempfile.mkdtemp()
run(['add', '--ledger', led(d)] + BASE + ['--ending', 'x'])
rc, o = run(['add', '--ledger', led(d)] + BASE + ['--ending', 'y'])
n_lines = len([l for l in open(led(d), encoding='utf-8') if l.strip()])
case('同版同轮重复记账报 E-LEDGER-DUP（一条不留）',
     rc == 1 and 'E-LEDGER-DUP' in o and n_lines == 1, 'rc=%d lines=%d' % (rc, n_lines))
shutil.rmtree(d, ignore_errors=True)

# 5. attempt=4 → W-LEDGER-RETRY-OVER3（C16 停对账）
d = tempfile.mkdtemp()
rc, o = run(['add', '--ledger', led(d), '--segment', '段2', '--model', '2.5', '--prompt-ver', 'v2',
             '--attempt', 4, '--outcome', 'retake', '--retake-reason', '末帧手位漂'])
case('第 4 轮报 W-LEDGER-RETRY-OVER3（超 3 停下来对账）',
     rc == 0 and 'W-LEDGER-RETRY-OVER3' in o, 'rc=%d' % rc)
shutil.rmtree(d, ignore_errors=True)

# 6. accepted 无实录 → W-LEDGER-NO-ENDING
d = tempfile.mkdtemp()
rc, o = run(['add', '--ledger', led(d)] + BASE)
case('accepted 缺实录报 W-LEDGER-NO-ENDING（下一段首帧没了依据）',
     rc == 0 and 'W-LEDGER-NO-ENDING' in o, 'rc=%d' % rc)
shutil.rmtree(d, ignore_errors=True)

# 7. harness_error 不要求实录（工具没跑成，谈不上实录）
d = tempfile.mkdtemp()
rc, o = run(['add', '--ledger', led(d), '--segment', '段1', '--model', '2.5', '--prompt-ver', 'v3',
             '--attempt', 1, '--outcome', 'harness_error', '--note', '平台 500'])
case('harness_error 不触发 NO-ENDING（≠ scored，规则不同）',
     rc == 0 and 'W-LEDGER-NO-ENDING' not in o, 'rc=%d' % rc)
shutil.rmtree(d, ignore_errors=True)

# 8. stats：harness_error 单列不进 scored，超3段进清单
d = tempfile.mkdtemp()
run(['add', '--ledger', led(d), '--segment', '段1', '--model', '2.5', '--prompt-ver', 'v1', '--attempt', 1, '--outcome', 'accepted', '--ending', 'a'])
run(['add', '--ledger', led(d), '--segment', '段1', '--model', '2.5', '--prompt-ver', 'v1', '--attempt', 2, '--outcome', 'retake', '--retake-reason', 'r'])
run(['add', '--ledger', led(d), '--segment', '段1', '--model', '2.5', '--prompt-ver', 'v1', '--attempt', 4, '--outcome', 'accepted', '--ending', 'b'])
run(['add', '--ledger', led(d), '--segment', '段2', '--model', '2.5', '--prompt-ver', 'v1', '--attempt', 1, '--outcome', 'harness_error'])
rc, o = run(['stats', '--ledger', led(d)])
case('stats 把 harness_error 单列、scored 三分、超 3 段进清单',
     rc == 0 and 'harness_error' in o and '段1(4)' in o and 'accepted 2' in o, 'rc=%d' % rc)
shutil.rmtree(d, ignore_errors=True)

# 9. stats --json 纯输出可解析（供工具链消费）
d = tempfile.mkdtemp()
run(['add', '--ledger', led(d)] + BASE + ['--ending', 'e'])
rc, o = run(['stats', '--ledger', led(d), '--json'])
try:
    j = json.loads(o)
    ok9 = rc == 0 and j['total'] == 1 and j['scored']['accepted'] == 1 and j['harness_error'] == 0
except ValueError:
    ok9, j = False, {}
case('stats --json 纯输出可解析且计数正确', ok9, 'total=%s' % j.get('total'))
shutil.rmtree(d, ignore_errors=True)

# 10. 日期非法 → E-LEDGER-DATE；stats 对不存在的台账 exit 2（打错路径不得当零条——假绿防线）
d = tempfile.mkdtemp()
rc1, o1 = run(['add', '--ledger', led(d)] + BASE + ['--date', '2026/10/24'])
rc2, o2 = run(['stats', '--ledger', os.path.join(d, 'no_such.jsonl')])
case('日期非法报 E-LEDGER-DATE；台账不存在 stats 拒绝当零条',
     rc1 == 1 and 'E-LEDGER-DATE' in o1 and rc2 == 2, 'rc1=%d rc2=%d' % (rc1, rc2))
shutil.rmtree(d, ignore_errors=True)

print('结果：%d 过 / %d 败' % (passed, failed))
sys.exit(1 if failed else 0)
