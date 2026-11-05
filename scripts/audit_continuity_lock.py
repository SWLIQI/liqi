#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""liqi 连续性锁对账（v6.5.0 · C28，吸收 zenstory-ai/drama-skills 连续性锁——MIT，机制改写吸收）

为什么需要它：
  跨集复现的物件（道具 / 服饰 / 场景特征物）每集、每段各写一遍，措辞一漂模型就画出
  另一个东西——第 3 集的怀表和第 18 集的怀表对不上。台账（G 门）管「状态怎么变」，
  注册表管「数值与版本」，本门管第三件库内没有的事：**同一物件的外观描述跨段逐字复现**。
  锁面（lock face）= 一句冻结的外观描述；凡声明「在锁」的段，正文必须**逐字**出现这句锁面。

锁表格式（项目级 `连续性锁.md`，与伏笔表同族的 opt-in 记忆文件）：

  | 锁 ID | 对象 | 检索词 | 镜头范围 | 锁面 | 状态 |
  |---|---|---|---|---|---|
  | LOCK-P02 | 旧怀表 | 怀表 | 全集 | 银色旧怀表，表壳背面刻痕已磨平 | 在锁 |
  | LOCK-C01-疤 | 沈照眉疤 | 眉疤 | 1,3 | 左眉尾两厘米旧疤 | 在锁 |
  | LOCK-P06 | 底片 | 底片 | 全集 | — | 解锁 |

  - 状态枚举：在锁 / 解锁（出枚举 = E-LOCK-BADROW）。**解锁行跳过不查**（留档不删）。
  - 镜头范围两种合法写法：`全集`（传入的每个包都查）或 镜号清单（`1,3` / `镜1、镜3`，
    对传入包内的对应段生效）。集级范围由调用方控制——一次只传相关集的包。
  - 锁面写 `—` 仅允许出现在解锁行（在锁行锁面空 = E-LOCK-BADROW）。

码表：
  E-LOCK-BADROW          锁表行格式坏（列数 / 状态出枚举 / 在锁行锁面空 / 范围两种写法都不合）
  E-LOCK-DUPID           锁 ID 重复
  E-LOCK-MISSING         在锁且范围命中本包，锁面在正文（非负面区）一处都没有
  E-LOCK-NEGATIVE-ONLY   锁面只出现在负面区（Must not / 负面提示词行）——防作弊：
                         塞进 Must not 不算「写了」，反而说明写反了
  W-LOCK-MENTION-NO-FACE 范围内某段正文提到了检索词但该段没带锁面——部分覆盖，
                         让人自己确认是漏写还是本段确合法
  W-LOCK-EMPTY-RUN       --locks 指向的文件解析出 0 行（空表不是已登记，G7 同口径）
  W-LOCK-UNREADABLE      --locks 指向的文件读不了——跳过不是通过

正文边界：只扫代码围栏内、`—— 以下不进正文 ——` 之前的部分；负面区 = 围栏内以
`Must not`（大小写不敏感）或 `负面提示词` 开头的行。逐字 = 去除全部空白后子串匹配
（中文无词边界问题，zenstory 原注同此；顺带容忍排版换行差异）。

用法：
  python scripts/audit_continuity_lock.py <包.md> [包2.md ...] --locks 连续性锁.md [--json]
退出码：0 = 正常（含 W-LOCK-* 警告）/ 1 = 有 ERROR / 2 = 用法错误
日志：不写 .gates.jsonl——本门是项目级 opt-in 对账（一次跑一串包），写进单个包的
     门禁日志会把对账结果记歪到包头；同 render_ledger「人工决策域与判据门分列」口径。
"""
from __future__ import print_function

import argparse
import io
import json
import os
import re
import sys

STATES = ('在锁', '解锁')
SEAM_MARK = '以下不进正文'


def out_write(s):
    try:
        print(s)
    except UnicodeEncodeError:
        buf = getattr(sys.stdout, 'buffer', None)
        if buf is None:
            raise
        buf.write((s + '\n').encode('utf-8', 'replace'))


def norm(s):
    """逐字匹配的归一化：去掉全部空白（半角/全角空格、制表、换行）。
    中文没有词边界问题；顺带容忍『银色 旧怀表』与『银色旧怀表』的排版差异。"""
    return re.sub(r'[\s\u3000]+', '', s or '')


def parse_locks(path):
    """返回 (locks, errors)。locks 每项：dict(id, obj, term, scope, face, state, line)。"""
    locks, errors = [], []
    if not os.path.exists(path):
        return locks, [('W-LOCK-UNREADABLE', '锁表文件不存在：%s——跳过不是通过' % path)]
    try:
        with io.open(path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except OSError as e:
        return locks, [('W-LOCK-UNREADABLE', '锁表读不了：%s（%s）——跳过不是通过' % (path, e))]
    seen = {}
    for i, raw in enumerate(lines, 1):
        line = raw.strip()
        if not line.startswith('|'):
            continue
        cells = [c.strip() for c in line.strip('|').split('|')]
        if all(set(c) <= set('-: ') for c in cells if c):
            continue  # |---|---| 分隔行
        if cells and cells[0].replace(' ', '') == '锁ID':
            continue  # 表头行
        if len(cells) != 6:
            errors.append(('E-LOCK-BADROW', '第 %d 行：列数 %d ≠ 6（锁ID/对象/检索词/镜头范围/锁面/状态）' % (i, len(cells))))
            continue
        lid, obj, term, scope, face, state = cells
        if not lid or not obj:
            errors.append(('E-LOCK-BADROW', '第 %d 行：锁 ID 或对象为空' % i))
            continue
        if lid in seen:
            errors.append(('E-LOCK-DUPID', '第 %d 行：锁 ID %s 与第 %d 行重复' % (i, lid, seen[lid])))
            continue
        seen[lid] = i
        if state not in STATES:
            errors.append(('E-LOCK-BADROW', '第 %d 行：状态 %r 出枚举（在锁/解锁）' % (i, state)))
            continue
        segs = None
        if state == '在锁':
            if not face or face == '—':
                errors.append(('E-LOCK-BADROW', '第 %d 行：在锁行锁面为空（要解锁就把状态写成解锁）' % i))
                continue
            kind, segs = parse_scope(scope)
            if kind == 'bad':
                errors.append(('E-LOCK-BADROW', '第 %d 行：镜头范围 %r 不合法（全集 / 镜号清单如 1,3）' % (i, scope)))
                continue
        locks.append({'id': lid, 'obj': obj, 'term': norm(term), 'scope': scope,
                      'face': norm(face), 'face_raw': face, 'state': state, 'segs': segs, 'line': i})
    if not locks and not errors:
        errors.append(('W-LOCK-EMPTY-RUN', '锁表解析出 0 行——空表不是已登记（G7 同口径）'))
    return locks, errors


def parse_scope(scope):
    """→ ('all', None)：全集/全包/*；→ ('set', {镜号})：镜号清单；→ ('bad', None)：不合法。"""
    s = (scope or '').strip()
    if s in ('全集', '全包', '*', ''):
        return 'all', None
    nums = re.findall(r'\d+', s)
    if not nums:
        return 'bad', None
    # 剩余字符只允许分隔与「镜/段/集/号」字样，防把别的写法误当镜号清单
    residue = re.sub(r'[\d,，、\s]', '', s)
    if residue and not set(residue) <= set('镜段集号'):
        return 'bad', None
    return 'set', set(int(n) for n in nums)


def split_packages(path):
    """返回 [(seg_id|None, body_lines, negative_lines)]；seg_id 取围栏内首个 镜N/段N 标头。
    正文 = 围栏内、SEAM_MARK 行之前；负面区 = 正文里 Must not / 负面提示词 开头的行。"""
    try:
        with io.open(path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except OSError as e:
        return None, '包文件读不了：%s（%s）' % (path, e)
    segs, in_fence, cur, fenced_any = [], False, None, False
    for raw in lines:
        line = raw.rstrip('\n')
        if line.strip().startswith('```'):
            if in_fence and cur is not None:
                segs.append(cur)
            in_fence = not in_fence
            cur = [] if in_fence else None
            fenced_any = fenced_any or in_fence
            continue
        if in_fence and cur is not None:
            cur.append(line)
    if in_fence and cur is not None:
        segs.append(cur)
    out = []
    for body in segs:
        # 正文截止：遇「以下不进正文」标记行即止（其后是 # 参数行，不算正文）
        cut = len(body)
        for i, l in enumerate(body):
            if SEAM_MARK in l:
                cut = i
                break
        main = body[:cut]
        seg_id = None
        for l in main:
            m = re.match(r'^\s*(?:镜|段)\s*(\d+)', l)
            if m:
                seg_id = int(m.group(1))
                break
        pos, neg = [], []
        for l in main:
            ls = l.strip()
            if re.match(r'^must\s*not', ls, re.I) or ls.startswith('负面提示词') or ls.startswith('负面：'):
                neg.append(ls)
            else:
                pos.append(ls)
        out.append((seg_id, pos, neg))
    return out, (None if fenced_any else '包内没有代码围栏——正文边界找不到（本门只认围栏内正文）')


def audit(pkg_path, locks):
    """返回 (findings, n_seg)。findings 每项 (code, message)。"""
    segs, err = split_packages(pkg_path)
    if err:
        return [('W-LOCK-UNREADABLE', '跳过 %s：%s——跳过不是通过' % (pkg_path, err))], 0
    findings, n = [], len(segs)
    seg_ids = [s for s, _, _ in segs]
    for lk in locks:
        if lk['state'] != '在锁':
            continue
        if lk['segs'] is not None:
            hit = [(sid, pos, neg) for sid, pos, neg in segs if sid in lk['segs']]
            if not hit:
                continue  # 范围镜号与本包段号无交集——合法，锁是给别的包的
        else:
            hit = segs
        pos_all = norm('\n'.join(l for _, pos, _ in hit for l in pos))
        neg_all = norm('\n'.join(l for _, _, neg in hit for l in neg))
        face = lk['face']
        in_pos = face in pos_all
        in_neg = face in neg_all
        if not in_pos and in_neg:
            findings.append(('E-LOCK-NEGATIVE-ONLY',
                             '%s ｜ %s（%s）锁面只出现在负面区——塞进 Must not 不算写了，反而说明写反了'
                             % (os.path.basename(pkg_path), lk['id'], lk['obj'])))
        elif not in_pos:
            findings.append(('E-LOCK-MISSING',
                             '%s ｜ %s（%s）在锁且范围命中，锁面在正文一处都没有：%s'
                             % (os.path.basename(pkg_path), lk['id'], lk['obj'], lk['face_raw'])))
        elif lk['term']:
            for sid, pos, _ in hit:
                seg_text = norm('\n'.join(pos))
                if lk['term'] in seg_text and face not in seg_text:
                    findings.append(('W-LOCK-MENTION-NO-FACE',
                                     '%s ｜ 段 %s 提到 %r 但没带 %s 锁面——漏写还是本段合法，人工确认'
                                     % (os.path.basename(pkg_path), sid, lk['term'], lk['id'])))
    return findings, n


def main(argv=None):
    ap = argparse.ArgumentParser(description='连续性锁对账（C28，opt-in）')
    ap.add_argument('packages', nargs='+', help='一个或多个投喂包 / 分镜包 .md')
    ap.add_argument('--locks', required=True, help='项目级 连续性锁.md（表格式，见文件头）')
    ap.add_argument('--json', action='store_true', help='stdout 只输出 JSON')
    args = ap.parse_args(argv)

    locks, lock_errs = parse_locks(args.locks)
    findings = list(lock_errs)
    n_seg = 0
    unreadable = [c for c, _ in lock_errs if c == 'W-LOCK-UNREADABLE']
    if not unreadable:
        for pkg in args.packages:
            f, n = audit(pkg, locks)
            findings.extend(f)
            n_seg += n
    has_e = any(c.startswith('E-') for c, _ in findings)
    if args.json:
        out_write(json.dumps({'codes': sorted(set(c for c, _ in findings)),
                              'findings': [{'code': c, 'message': m} for c, m in findings],
                              'locks': len(locks), 'packages': len(args.packages),
                              'segments': n_seg, 'error': has_e},
                             ensure_ascii=False, indent=1))
    else:
        for c, m in findings:
            out_write('%s ｜ %s' % (c, m))
        out_write('结果：%d error / %d warning ｜ 锁 %d 条 × 包 %d 个 × 段 %d 个'
                  % (sum(1 for c, _ in findings if c.startswith('E-')),
                     sum(1 for c, _ in findings if c.startswith('W-')),
                     len(locks), len(args.packages), n_seg))
        if not locks and not lock_errs:
            out_write('（锁表空跑——对账没发生，不算通过）')
    return 1 if has_e else 0


if __name__ == '__main__':
    sys.exit(main())
