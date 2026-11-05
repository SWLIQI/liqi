#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""lessons 聚合器（v6.2.0 · C24）：跨项目 render_ledger.jsonl 的 learned_rule / retake_reason 罗列。

治的病：台账记了 learned_rule，但它们躺在各项目的 jsonl 里——下一个项目开工时
没人读，同一学费交两遍。本脚本把散落的台账**罗列**出来，按日期倒序 + 高频返工原因
分组；**不自动去重**——两条近似教训的差异恰在措辞里（「雨天光比写 1:4」和
「雨夜别信 1:2 光比」是不是一回事，机器判不了），精选进《实战教训库.md》Top ≤20
由人工策展。

用法：
  python scripts/lessons_aggregate.py scan --root DIR [--top N] [--json]
  python scripts/lessons_aggregate.py scan                     # root 默认当前目录

输出（文本）首行带 ASCII 标记 LEDGERS= / ENTRIES= / LESSONS= / TOP=，供自测与脚本消费；
--json 输出同构 JSON。检索深度 ≤6 层，跳过 .git / node_modules。
退出码：0 正常（0 个台账也是正常）；2 用法/路径错误。
"""
from __future__ import print_function

import io
import json
import os
import sys

LEDGER_NAME = 'render_ledger.jsonl'
PRUNE = {'.git', 'node_modules', '.zcode', '__pycache__'}
MAX_DEPTH = 6
LESSON_FIELDS = ('learned_rule', 'retake_reason')


def out_write(s):
    try:
        print(s)
    except UnicodeEncodeError:
        sys.stdout.buffer.write((s + '\n').encode('utf-8'))


def find_ledgers(root):
    hits = []
    base_depth = root.rstrip(os.sep).count(os.sep)
    for dirpath, dirnames, filenames in os.walk(root):
        depth = dirpath.rstrip(os.sep).count(os.sep) - base_depth
        if depth >= MAX_DEPTH:
            dirnames[:] = []
        dirnames[:] = [d for d in dirnames if d not in PRUNE]
        if LEDGER_NAME in filenames:
            hits.append(os.path.join(dirpath, LEDGER_NAME))
    return sorted(hits)


def read_entries(path):
    entries, skipped = [], 0
    with io.open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except ValueError:
                skipped += 1
                continue
            if isinstance(e, dict):
                entries.append(e)
            else:
                skipped += 1
    return entries, skipped


def collect(root):
    ledgers = find_ledgers(root)
    all_entries = []  # (entry, source)
    skipped = 0
    for p in ledgers:
        es, sk = read_entries(p)
        skipped += sk
        for e in es:
            all_entries.append((e, p))
    lessons = [(e, src) for e, src in all_entries
               if any(str(e.get(f) or '').strip() for f in LESSON_FIELDS)]
    lessons.sort(key=lambda t: str(t[0].get('date') or ''), reverse=True)
    freq = {}
    for e, _ in all_entries:
        r = str(e.get('retake_reason') or '').strip()
        if r:
            freq[r] = freq.get(r, 0) + 1
    return {'ledgers': ledgers, 'entries': all_entries, 'lessons': lessons,
            'freq': freq, 'skipped': skipped}


def brief(e, src):
    date = str(e.get('date') or '----')
    seg = str(e.get('segment') or '-')
    outcome = str(e.get('outcome') or '-')
    rule = str(e.get('learned_rule') or '').strip()
    reason = str(e.get('retake_reason') or '').strip()
    parts = ['[%s] %s %s' % (date, seg, outcome)]
    if rule:
        parts.append('rule: ' + rule)
    if reason:
        parts.append('reason: ' + reason)
    parts.append('(ledger: %s)' % src)
    return '  '.join(parts)


def main():
    args = sys.argv[1:]
    if not args or args[0] != 'scan':
        print(__doc__)
        return 2
    root = None
    top = 20
    as_json = False
    i = 1
    while i < len(args):
        if args[i] == '--root' and i + 1 < len(args):
            root = args[i + 1]
            i += 2
        elif args[i] == '--top' and i + 1 < len(args):
            try:
                top = int(args[i + 1])
            except ValueError:
                print('--top 需要整数')
                return 2
            i += 2
        elif args[i] == '--json':
            as_json = True
            i += 1
        else:
            print('未知参数：%s' % args[i])
            return 2
    if not root:
        root = os.getcwd()
    if not os.path.isdir(root):
        print('--root 不是目录：%s' % root)
        return 2

    r = collect(root)
    if as_json:
        payload = {
            'root': root,
            'ledgers': [p.replace('\\', '/') for p in r['ledgers']],
            'entries': len(r['entries']),
            'lessons': [
                {'date': str(e.get('date') or ''), 'segment': str(e.get('segment') or ''),
                 'outcome': str(e.get('outcome') or ''),
                 'learned_rule': str(e.get('learned_rule') or ''),
                 'retake_reason': str(e.get('retake_reason') or ''),
                 'source': src.replace('\\', '/')}
                for e, src in r['lessons']],
            'retake_freq': r['freq'],
            'malformed_lines_skipped': r['skipped'],
        }
        text = json.dumps(payload, ensure_ascii=False, indent=2)
        try:
            print(text)
        except UnicodeEncodeError:
            sys.stdout.buffer.write((text + '\n').encode('utf-8'))
        return 0

    out_write('lessons 聚合 —— root=%s' % root)
    out_write('LEDGERS=%d  ENTRIES=%d  LESSONS=%d  SKIPPED=%d  TOP=%d'
              % (len(r['ledgers']), len(r['entries']), len(r['lessons']), r['skipped'], min(top, len(r['lessons']))))
    out_write('')
    out_write('罗列（按日期倒序；**不自动去重**，精选进《实战教训库.md》由人工策展）：')
    if not r['lessons']:
        out_write('  （无教训条目——台账为空或还没写过 learned_rule/retake_reason）')
    for n, (e, src) in enumerate(r['lessons'][:top], 1):
        out_write('%d. %s' % (n, brief(e, src)))
    if len(r['lessons']) > top:
        out_write('… 其余 %d 条不展示（--top 可调；全量以 --json 输出为准）' % (len(r['lessons']) - top))
    hot = [(c, reason) for reason, c in r['freq'].items() if c >= 2]
    if hot:
        out_write('')
        out_write('高频 retake_reason（出现 ≥2 次）：')
        for c, reason in sorted(hot, reverse=True):
            out_write('%dx %s' % (c, reason))
    return 0


if __name__ == '__main__':
    sys.exit(main())
