#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""lessons_aggregate.py 回归（v6.2.0 · 第十七套）

覆盖（subprocess 黑盒；输出首行带 ASCII 标记，断言只看 ASCII，避开控制台编码差异）：
  T1  双台账罗列：2 个项目台账 / 4 条 / 3 条教训 / 高频 reason 2x
  T2  --top 截断：TOP=1 标记
  T3  坏行跳过：SKIPPED=1，rc 仍 0（罗列器不许因一条脏行拒绝全部数据）
  T4  空树 rc 0（LEDGERS=0）；缺 --root 目录 rc 2

用法：python scripts/selftest_lessons_aggregate.py
退出码：0 = 全过；1 = 有败
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
SCRIPT = os.path.join(HERE, 'lessons_aggregate.py')

ROWS = []


def case(name, fn):
    try:
        ok, why = fn()
    except Exception as e:  # noqa: BLE001
        ok, why = False, '抛异常：%s' % e
    ROWS.append((name, ok, why))


def entry(date, seg, outcome, rule='', reason=''):
    e = {'date': date, 'segment': seg, 'model': '2.5', 'prompt_ver': 'v1',
         'attempt': 1, 'outcome': outcome, 'gates': ''}
    if rule:
        e['learned_rule'] = rule
    if reason:
        e['retake_reason'] = reason
    return json.dumps(e, ensure_ascii=False)


def make_project(root, name, lines):
    d = os.path.join(root, name)
    os.makedirs(d)
    io.open(os.path.join(d, 'render_ledger.jsonl'), 'w', encoding='utf-8',
            newline='').write('\n'.join(lines) + ('\n' if lines else ''))
    return d


def run(args):
    p = subprocess.Popen([PY, SCRIPT] + args, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT)
    out = p.communicate()[0].decode('utf-8', 'replace')
    return p.returncode, out


def t1():
    root = tempfile.mkdtemp(prefix='liqi_lag_')
    try:
        make_project(root, 'projA', [
            entry('2026-10-29', 'seg1', 'accepted', rule='雨天主光比写 1:4，模型才压得住反光'),
            entry('2026-10-29', 'seg2', 'retake', reason='手部细节崩'),
        ])
        make_project(root, 'projB', [
            entry('2026-10-28', 'seg1', 'retake', reason='手部细节崩'),
            entry('2026-10-28', 'seg2', 'abandon'),
        ])
        rc, out = run(['scan', '--root', root])
        ok = (rc == 0 and 'LEDGERS=2' in out and 'ENTRIES=4' in out
              and 'LESSONS=3' in out and '2x' in out)
        return ok, 'rc=%d 输出首段=%s' % (rc, out.splitlines()[:2])
    finally:
        shutil.rmtree(root, ignore_errors=True)


def t2():
    root = tempfile.mkdtemp(prefix='liqi_lag_')
    try:
        make_project(root, 'projA', [
            entry('2026-10-29', 'seg1', 'accepted', rule='规则甲'),
            entry('2026-10-28', 'seg2', 'accepted', rule='规则乙'),
        ])
        rc, out = run(['scan', '--root', root, '--top', '1'])
        return rc == 0 and 'TOP=1' in out, 'rc=%d' % rc
    finally:
        shutil.rmtree(root, ignore_errors=True)


def t3():
    root = tempfile.mkdtemp(prefix='liqi_lag_')
    try:
        d = make_project(root, 'projA', [
            entry('2026-10-29', 'seg1', 'accepted', rule='规则甲'),
            '{not-json',
        ])
        rc, out = run(['scan', '--root', d])
        return rc == 0 and 'SKIPPED=1' in out and 'LESSONS=1' in out, 'rc=%d out=%s' % (rc, out.splitlines()[:2])
    finally:
        shutil.rmtree(root, ignore_errors=True)


def t4():
    root = tempfile.mkdtemp(prefix='liqi_lag_')
    try:
        rc, out = run(['scan', '--root', root])
        ok1 = rc == 0 and 'LEDGERS=0' in out
        rc2, _ = run(['scan', '--root', os.path.join(root, 'no-such-dir')])
        return ok1 and rc2 == 2, '空树 rc=%d；缺目录 rc=%d（应 2）' % (rc, rc2)
    finally:
        shutil.rmtree(root, ignore_errors=True)


case('T1 双台账罗列与高频分组', t1)
case('T2 --top 截断标记', t2)
case('T3 坏行跳过不致命', t3)
case('T4 空树 rc0 / 缺目录 rc2', t4)


def main():
    passed = 0
    failed = []
    for name, ok, why in ROWS:
        print('%s %s' % ('✅' if ok else '❌', name))
        if ok:
            passed += 1
        else:
            failed.append('%s：%s' % (name, why))
    print('\n结果：%d 过 / %d 败' % (passed, len(failed)))
    for f in failed:
        print('  ✗ ' + f)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
