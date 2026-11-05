#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""liqi 渲染评测台账（v5.53.0 · C18，吸收 Emily2040 eval-run-ledger 四纪律与续写七步的
「记录实际发生」——机制参考，零拷贝）

为什么需要它：
  门禁日志（.gates.jsonl）记的是「判据说了什么」；渲染之后发生的事——成了没成、
  重 roll 几次、实际结尾长什么样、这一段学到什么——之前没有任何地方记。
  段缝①尾帧锚定用的是**计划**尾帧：模型实际渲出什么结尾没人记录，下一段的
  I2V 首帧却还当它按计划走了。台账补的就是这一环：**渲染验收后回填实录（actual_ending），
  下一段首帧用实录帧，不用计划帧。**

四条纪律（对应 Emily eval-run-ledger 的机制，口径与库内假绿家族一致）：
  1. harness_error ≠ scored —— 工具没跑成 / 平台没出片与真实渲染结果分列，
     stats 里绝不把 harness_error 混进 scored 分布；
  2. 不完整批次不进正式台账 —— 渲了一半的批次等收齐再记结论行；
  3. 聚焦试验只进暂存台账 —— 单段试提示词用 --ledger 指向 scratch 文件，
     正式台账（项目根 render_ledger.jsonl）只收定稿投喂批次；
  4. 重 roll 超限要停 —— attempt ≥4 报 W-LEDGER-RETRY-OVER3
     （C16 口径：单段重 roll 超 3 次停下来对账——超限是决策不是违规）。

字段扩展预留（v6.5.0 · C29，来源 LearnPrompt/awesome-seedance 证据链 ③ MIT——机制参考零拷贝）：
  外部同类的证据字段是 Retest（复测模型+日期+结论+分数+输出链接）+ Stability（稳定分，
  含降分记录）。首条真实渲染数据进来后，按需扩 `--retest-ref` / `--retest-score`
  两个可选字段（跨模型复测对账），**现在不实现**——没有渲染数据的字段是死字段
  （132/157 死码的直接教训）。落法届时过加门三问再动。

码表：
  E-LEDGER-SCHEMA        必填字段缺失 / 类型不对（attempt 必须 ≥1）
  E-LEDGER-OUTCOME       outcome 不在枚举 {accepted, retake, abandon, harness_error}
  E-LEDGER-DUP           同 (segment, prompt_ver, attempt) 已存在——同版提示词同轮次只能记一次
  E-LEDGER-DATE          --date 不是 YYYY-MM-DD
  W-LEDGER-RETRY-OVER3   attempt ≥4——C16：停下来对账再继续
  W-LEDGER-NO-ENDING     outcome=accepted 但没填 --ending——实录续写缺料，
                          下一段 I2V 首帧没有实录依据（harness_error 不要求）

用法：
  python scripts/render_ledger.py add --ledger render_ledger.jsonl --segment 段1 \
      --model 2.5 --prompt-ver v3 --attempt 2 --outcome retake \
      [--gates "0E/6W"] [--retake-reason 末帧人物未回身] [--cost 2.5] \
      [--ending 实际尾帧描述] [--rule 学到的规则] [--date 2026-10-24] [--note 备注]
  python scripts/render_ledger.py stats --ledger render_ledger.jsonl [--json]
退出码：0 正常（含 W-LEDGER-* 警告）/ 1 有 ERROR / 2 用法与输入缺失
日志：不写 .gates.jsonl——台账是人工决策域的记录，不是判据门，两者分列
     （同 Z 门「未查 ≠ 通过」的口径：台账没记，不代表渲染没发生）。
"""
from __future__ import print_function

import argparse
import datetime
import io
import json
import os
import sys

OUTCOMES = ('accepted', 'retake', 'abandon', 'harness_error')
SCORED = ('accepted', 'retake', 'abandon')
DATE_RE = r'^\d{4}-\d{2}-\d{2}$'


def out_write(s):
    try:
        print(s)
    except UnicodeEncodeError:
        # 控制台不是 UTF-8（Windows GBK）：降级写 bytes，别让记账被编码打断
        io = getattr(sys.stdout, 'buffer', None)
        if io is None:
            raise
        io.write((s + '\n').encode('utf-8', 'replace'))


def read_entries(path):
    """读整本台账。文件不存在 → (None, 提示)；某行不是 JSON → (坏行号, 提示) 走 exit 2 口径。"""
    if not os.path.exists(path):
        return None, '台账文件不存在：%s（还没记过账？先 add；路径打错也是这个提示——两者都该停下来看清）' % path
    entries, bad = [], []
    with io.open(path, 'r', encoding='utf-8') as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except ValueError:
                bad.append(i)
    if bad:
        return None, '台账第 %s 行不是 JSON——先人工修好再继续（坏了的台账算出来的统计比没有统计更糟）' % '、'.join(str(b) for b in bad)
    return entries, ''


def cmd_add(a):
    errors, warns = [], []
    if a.outcome not in OUTCOMES:
        errors.append(('E-LEDGER-OUTCOME', 'outcome「%s」不在枚举 %s——渲染结果是四种之一，别的值进不了统计' % (a.outcome, '/'.join(OUTCOMES))))
    if a.attempt < 1:
        errors.append(('E-LEDGER-SCHEMA', 'attempt=%d 不合法（必须 ≥1：第几轮就是几）' % a.attempt))
    date = a.date or datetime.date.today().isoformat()
    if not isinstance(date, str) or not __import__('re').match(DATE_RE, date):
        errors.append(('E-LEDGER-DATE', 'date「%s」不是 YYYY-MM-DD' % date))
        date = None

    entries, why = read_entries(a.ledger)
    if entries is None and why.startswith('台账文件不存在'):
        entries = []            # add 允许新建台账
    elif entries is None:
        print('❌ %s' % why)
        return 2
    if not errors:
        for e in entries:
            if (e.get('segment'), e.get('prompt_ver'), e.get('attempt')) == (a.segment, a.prompt_ver, a.attempt):
                errors.append(('E-LEDGER-DUP', '(%s, %s, attempt=%d) 已存在——同一版提示词同一轮次只能记一次；确是新一轮就升 attempt' % (a.segment, a.prompt_ver, a.attempt)))
                break

    if errors:
        for code, msg in errors:
            out_write('  ❌ %s  %s' % (code, msg))
        out_write('结果：0 条写入 / %d ERROR' % len(errors))
        return 1

    entry = {
        'date': date, 'segment': a.segment, 'model': a.model, 'prompt_ver': a.prompt_ver,
        'attempt': a.attempt, 'outcome': a.outcome,
        'gates': a.gates or None, 'retake_reason': a.retake_reason or None,
        'cost': a.cost, 'actual_ending': a.ending or None,
        'learned_rule': a.rule or None, 'note': a.note or None,
    }
    with io.open(a.ledger, 'a', encoding='utf-8') as f:
        f.write(json.dumps(entry, ensure_ascii=False) + '\n')

    out_write('✅ 已记账：%s · %s · %s · attempt %d · %s' % (date, a.segment, a.model, a.attempt, a.outcome))
    if a.attempt >= 4:
        warns.append(('W-LEDGER-RETRY-OVER3', '本段已 roll 到第 %d 次——C16：单段超 3 次停下来对账（换措辞？换段缝？还是放弃这段），对完再继续' % a.attempt))
    if a.outcome == 'accepted' and not a.ending:
        warns.append(('W-LEDGER-NO-ENDING', 'accepted 却没填 --ending——实录续写缺料：下一段的 I2V 首帧将没有实录依据，只能退回计划帧（模型实际结尾 ≠ 计划结尾时必然穿帮）'))
    for code, msg in warns:
        out_write('  ⚠️  %s  %s' % (code, msg))
    out_write('结果：1 条写入 / 0 ERROR / %d WARN' % len(warns))
    return 0


def cmd_stats(a):
    entries, why = read_entries(a.ledger)
    if entries is None:
        print('❌ %s' % why)
        return 2
    scored = {k: 0 for k in SCORED}
    harn = 0
    seg_max = {}
    over3, rules, no_ending = [], 0, 0
    for e in entries:
        o = e.get('outcome')
        if o in scored:
            scored[o] += 1
            if o == 'accepted' and not e.get('actual_ending'):
                no_ending += 1
        elif o == 'harness_error':
            harn += 1
        seg = e.get('segment')
        att = e.get('attempt') or 0
        if seg is not None and att > seg_max.get(seg, 0):
            seg_max[seg] = att
        if seg is not None and seg_max.get(seg, 0) >= 4 and seg not in over3:
            over3.append(seg)
        if e.get('learned_rule'):
            rules += 1
    avg = (sum(seg_max.values()) / float(len(seg_max))) if seg_max else 0.0
    if a.json:
        print(json.dumps({
            'total': len(entries), 'scored': scored, 'harness_error': harn,
            'avg_attempt': round(avg, 2), 'over3': over3,
            'rules': rules, 'no_ending': no_ending,
        }, ensure_ascii=False))
        return 0
    out_write('渲染台账 —— %s（%d 条）' % (a.ledger, len(entries)))
    out_write('  scored：accepted %d ｜ retake %d ｜ abandon %d' % (scored['accepted'], scored['retake'], scored['abandon']))
    out_write('  harness_error：%d（工具/平台没跑成，不计入 scored——不是提示词的错，但也不是没发生）' % harn)
    out_write('  段均 attempt：%.2f（%d 段，按段最大轮次）' % (avg, len(seg_max)))
    if over3:
        out_write('  ⚠️  重 roll 超 3 的段：%s（C16：停下来对账）' % '、'.join('%s(%d)' % (s, seg_max[s]) for s in over3))
    if rules:
        out_write('  学到的规则：%d 条（喂 model-limits 修订与门禁措辞的实证来源）' % rules)
    if no_ending:
        out_write('  ⚠️  accepted 无实录（W-LEDGER-NO-ENDING）：%d 条' % no_ending)
    out_write('结果：统计完成 / 0 ERROR')
    return 0


def main():
    ap = argparse.ArgumentParser(add_help=False, description='liqi 渲染评测台账（C18）')
    sub = ap.add_subparsers(dest='cmd')
    p_add = sub.add_parser('add', add_help=False)
    for flag, req, h in [
        ('--ledger', True, '台账路径（正式台账 = 项目根 render_ledger.jsonl；聚焦试验另指 scratch 文件）'),
        ('--segment', True, '段号（与包内段标题一致）'),
        ('--model', True, '模型面：2.5 / 2.0 / h3 / h3max'),
        ('--prompt-ver', True, '本段提示词版本号（如 v3——与重拍预算对账用）'),
        ('--attempt', True, '第几轮（int，≥1）'),
        ('--outcome', True, 'accepted / retake / abandon / harness_error'),
        ('--gates', False, '本条对应的门禁摘要，如 0E/6W'),
        ('--retake-reason', False, 'retake 的单变量原因（一次只改一个变量）'),
        ('--cost', False, '本条花费（float）'),
        ('--ending', False, '实际尾帧实录（人物位置/朝向/道具/光——下一段 I2V 首帧的依据）'),
        ('--rule', False, '本条学到的规则（反哺 model-limits 与门禁措辞）'),
        ('--date', False, '日期，默认今天'),
        ('--note', False, '备注'),
    ]:
        p_add.add_argument(flag, required=req, help=h)
    p_st = sub.add_parser('stats', add_help=False)
    p_st.add_argument('--ledger', required=True)
    p_st.add_argument('--json', action='store_true')
    a = ap.parse_args()
    if a.cmd == 'add':
        try:
            a.attempt = int(a.attempt)
        except ValueError:
            out_write('  ❌ E-LEDGER-SCHEMA  attempt「%s」不是整数' % a.attempt)
            sys.exit(1)
        if a.cost is not None:
            try:
                a.cost = float(a.cost)
            except ValueError:
                a.cost = None
        sys.exit(cmd_add(a))
    elif a.cmd == 'stats':
        sys.exit(cmd_stats(a))
    else:
        ap.print_usage()
        sys.exit(2)


if __name__ == '__main__':
    main()
