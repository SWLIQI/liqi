#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gates_log.py —— 门失败累积的共享日志（Python 侧）

供 audit_literal.py / audit_risk.py 在每次运行后把结果追加到
「被校验文件同目录」的 .gates.jsonl，与 gates_log.mjs（node 侧）同一格式，
gates_stats.mjs 统一聚合。

写不进去（只读目录 / 磁盘满）静默跳过，绝不影响校验本身的退出码。

记录格式（schema `v`，v5.37.10 起）：
  v1（无 `v` 字段，老记录）：ts / tool / file / exit / errors / warns / codes
   v1 后期补了 `skips`，但它是同一个版本里加的字段，没有区分必要
  v2（当前）：v1 + `skips`；另**可选** `skip_input` / `skip_missing` / `skip_thresh` /
   `skip_untagged` / `nas`——这几个只有能分类的脚本（audit_project）才写，
   node 侧脚本只写 `skips`，所以 v2 不等于「一定有分类字段」
  为什么要记版本：`gates_stats` 看到「未分类的未查」时，得能分清两种情况——
  ① 这是 v1 老记录，采集时还没有分类字段（**不是谁漏标了**，重跑一次就有）；
  ② 这是 v2 记录，说明有新写的未查消息忘了带类别（**是代码的问题**）。
  没有 `v` 字段时这两件事长得一模一样，提示语只能含糊地写「或者是老记录」。
"""
import json
import os
from datetime import datetime, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
_SKILL_ROOT = os.path.dirname(_HERE)


def _detect_origin(file):
    """P0-3（v5.50.0）：记录来源标记，与 gates_log.mjs 的 detectOrigin 同口径。

    优先级：① 环境变量 LIQI_ORIGIN（selftest / golden / real，自测入口显式声明，
    run_all_checks.sh 全程导出 selftest）；② 被校验文件在本库 examples/ 下 → golden；
    ③ 其余 → real（真实项目，死码治理唯一认的来源）。老记录无此字段 → 消费方按 unknown，
    **「未标」不是 real**。
    """
    env = os.environ.get('LIQI_ORIGIN')
    if env in ('selftest', 'golden', 'real'):
        return env
    try:
        d = os.path.dirname(os.path.abspath(file))
        ex = os.path.join(_SKILL_ROOT, 'examples')
        if d == ex or d.startswith(ex + os.sep):
            return 'golden'
    except Exception:
        pass
    return 'real'


def append_gate_log(tool, file, exit_code, issues, target=None):
    """issues 元素需含 code；level 可选（'error'/'warn'/'ERROR'/'WARN'）。"""
    try:
        log_path = os.path.join(os.path.dirname(os.path.abspath(file)), '.gates.jsonl')
        codes = {}
        for it in issues or []:
            c = it.get('code', 'UNKNOWN')
            codes[c] = codes.get(c, 0) + 1
        lv = lambda it: str(it.get('level') or it.get('lv') or '').lower()
        # v4.8.3 D4：旧版硬编码 '.000Z' 毫秒——与 gates_log.mjs 的 toISOString()
        # （真实毫秒）混写同一 .gates.jsonl 时，gates_stats 按字符串比 ts 找「最近一次」，
        # py 侧记录永远排在同秒 mjs 记录之前，「最近」归属错乱。此处补真实毫秒，格式对齐 mjs。
        now = datetime.now(timezone.utc)
        rec = {
            # schema 版本（v5.37.10）：让消费方能分开「老格式没采集」和「新格式漏了」。
            'v': 2,
            'ts': now.strftime('%Y-%m-%dT%H:%M:%S.') + '%03dZ' % (now.microsecond // 1000),
            'tool': tool,
            'file': os.path.basename(file),
            # P0-3（v5.50.0）：来源标记——沿 v2 内加可选字段的先例（skips / skip_*），不升版本号。
            'origin': _detect_origin(file),
            'exit': exit_code,
            'errors': sum(1 for it in (issues or []) if lv(it).startswith('err')),
            'warns': sum(1 for it in (issues or []) if lv(it).startswith('warn')),
            # 「未查」单列（v5.37.3）：与 gates_log.mjs 同口径。三者加起来才是
            # 「这门这次到底干了什么」，光看 warns 会把 10 条「没传参数」读成 10 条问题。
            'skips': sum(1 for it in (issues or []) if lv(it).startswith('skip')),
            # 不适用（v5.37.8）：既不是「响了」也不是「没跑」，是「本包没这个场景」。
            # 与 skips 并列单列，否则 stats 会把「不该跑」算成「该跑没跑」。
            'nas': sum(1 for it in (issues or []) if lv(it).startswith('na')),
            'codes': codes,
        }
        # v5.37.6：未查再分类。**只在真有未查时写这三个字段**——绝大多数记录是
        # 「有 error / 有 warn」，给它们补三个 0 只是把日志撑胖。缺字段 = 0，
        # gates_stats 侧按 0 读，不用 `if 'skip_input' in r` 到处判。
        _sk = [it for it in (issues or []) if lv(it).startswith('skip')]
        if _sk:
            rec['skip_input'] = sum(1 for it in _sk if it.get('kind') == '缺输入')
            rec['skip_missing'] = sum(1 for it in _sk if it.get('kind') == '缺产物')
            rec['skip_thresh'] = sum(1 for it in _sk if it.get('kind') == '门槛')
            # 未分类单独记，不并进上面两类：一条没带类别的未查消息，若被算成
            # 「缺输入」，用户会按「补个参数就行」去处理一条其实补参数没用的判据。
            rec['skip_untagged'] = (len(_sk) - rec['skip_input']
                                    - rec['skip_missing'] - rec['skip_thresh'])
        if target:
            rec['target'] = target
        with open(log_path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
    except Exception:
        pass  # 静默：日志失败不阻断校验


def log_disabled(argv):
    return '--no-log' in argv
