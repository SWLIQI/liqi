#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""`scan_conflicts.py` 回归（v5.37.13 · 第十二套）

治的病：**它是全库的「一致性宪法」，自己却没人对账。**
K7 数自测组数、K8 盯 skip 类别、K1~K6 盯文档写法——所有东西都靠它裁决，
而它此前零测试。上一批（v5.37.12）我是靠「手工删一处 `kind=` 看它报不报」验的，
一次性的，下次改了不会有人重跑。

覆盖（每个用例一棵独立最小树，互不污染）：
  S1  K1 围栏奇数 → ERROR
  S2  K5 「跳过某门」同句没写「不是通过」→ WARN
  S3  K5 同句写了「不是通过」→ 不报（反向）
  S4  K7 文档声称 4 组、源码实际 3 组 → WARN
  S5  K7 声称 3 组、源码 3 组 → 不报（反向）
  S6  K8 内容条件 + 无 kind（`_skip_section`）→ WARN
  S7  K8 args 条件 + 无 kind → 豁免（反向：缺参数类默认「缺输入」本来就对）
  S8  K8 内容条件 + 有 kind → 不报（反向）
  S9  K8 也覆盖门函数内的 `_skip_msg`（v5.37.12）
  S10 CLI 端到端：干净树 → 「八个模式全部干净」
  S11 K8 嵌套 if 去重 → 同一次调用只报 1 条（报两遍比漏报更快失去信任）
  S12 K9 ③ 行无来源标记 → WARN（v6.1.0）
  S13 K9 有来源标记 → 不报（反向）

用法：python scripts/selftest_scan_conflicts.py
退出码：0 = 全过；1 = 有败
"""
import io
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import scan_conflicts as SC  # noqa: E402

CLEAN_SKILL = '# 测试技能\n\n一个最简 SKILL.md，不写任何会被 K3/K4/K6 抓的东西。\n'

# K9 夹具：references/ 下的最简参考文件（默认干净，S12/S13 会覆写成脏/净两版）。
REF_MD = '质感纪律：最简参考文件，不带任何会被扫描的标记。\n'

# 合成一个 audit_project.py：四种跳过的写法各一处，供 K8 逐条判定。
#   ① 内容条件 + 无 kind   → 应报（正是 v5.37.8 那个坑的写法）
#   ② args 条件 + 无 kind   → 豁免（缺参数类，默认「缺输入」本来就对）
#   ③ 内容条件 + 有 kind   → 不报（已显式声明）
#   ④ 门函数内 _skip_msg 内容条件 + 无 kind → 应报（v5.37.12 补的那一层）
AP_PY = '''def gate_a(pkg_text):
    if 'TABLE' in pkg_text:
        pass
    else:
        _skip_section('no table')


def gate_b(args):
    if args.ledger:
        pass
    else:
        _skip_section('no ledger')


def gate_c(pkg_text):
    if 'NA_TABLE' in pkg_text:
        pass
    else:
        _skip_section('not applicable', kind='不适用')


def gate_d(rules):
    if rules:
        pass
    else:
        warns.append(_skip_msg('no rules'))
'''

# 嵌套条件夹具（S11）：`if adapt:` 包着 `if hits:`，两者都不是 args 条件 ⇒
# 同一次 `_skip_msg` 调用会被外层和内层各命中一次。**必须按行号去重**——
# 扫描器报重复项，比漏报更快失去信任（一条问题报两遍，人就开始整段跳过）。
AP_NESTED = '''def gate_e(adapt, hits):
    if adapt:
        if hits:
            pass
        else:
            warns.append(_skip_msg('no hit'))
'''

# 供 K7 数的临时夹具：3 条用例。
# **不能写成行首的字面 `case(`**——本文件自己也要被 K7 数，
# 写在字符串里的行首 `case(` 会被一起算进去（K7 按行首正则数，不区分是否在字符串里）。
# 所以用 join 拼出来：源码里没有一行以 `case(` 开头。
DEMO_SELFTEST = ''.join("case('%s', pkg)\n" % n for n in ('x1', 'x2', 'x3'))


def make_tree(skill_md=CLEAN_SKILL, ap_py=AP_PY, demo=DEMO_SELFTEST, ref_md=REF_MD):
    root = tempfile.mkdtemp(prefix='liqi_sc_')
    io.open(os.path.join(root, 'SKILL.md'), 'w', encoding='utf-8', newline='').write(skill_md)
    sd = os.path.join(root, 'scripts')
    os.makedirs(sd)
    if ap_py is not None:
        io.open(os.path.join(sd, 'audit_project.py'), 'w',
                encoding='utf-8', newline='').write(ap_py)
    if demo is not None:
        io.open(os.path.join(sd, 'selftest_boundary.py'), 'w',
                encoding='utf-8', newline='').write(demo)
    if ref_md is not None:
        rd = os.path.join(root, 'references')
        os.makedirs(rd)
        io.open(os.path.join(rd, '质感纪律.md'), 'w',
                encoding='utf-8', newline='').write(ref_md)
    return root


ROWS = []


def case(name, fn):
    try:
        ok, why = fn()
    except Exception as e:  # noqa: BLE001
        ok, why = False, '抛异常：%s' % e
    ROWS.append((name, ok, why))


def with_tree(fn, **kw):
    root = make_tree(**kw)
    try:
        return fn(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)


def main():
    def s1():
        def f(root):
            p = os.path.join(root, 'SKILL.md')
            io.open(p, 'w', encoding='utf-8', newline='').write(CLEAN_SKILL + '\n```bash\necho 1\n')
            errs = SC.k1_fences([p])
            return (len(errs) == 1, '应报 1 条围栏奇数，实为 %d' % len(errs))
        return with_tree(f)

    def s2():
        md = CLEAN_SKILL + '\n没有 node 时跳过 audit_risk 门。\n'

        def f(root):
            w = SC.k5_skip(root)
            return len(w) == 1, '应报 1 条，实为 %d 条：%s' % (len(w), w)
        return with_tree(f, skill_md=md)

    def s3():
        md = CLEAN_SKILL + '\n没有 node 时跳过 audit_risk 门，跳过不是通过。\n'

        def f(root):
            w = SC.k5_skip(root)
            return len(w) == 0, '不该报，实为 %d 条：%s' % (len(w), w)
        return with_tree(f, skill_md=md)

    def s4():
        md = CLEAN_SKILL + '\n| `python scripts/selftest_boundary.py` | **4 组** | 演示 |\n'

        def f(root):
            w = SC.k7_selftest_count(root)
            return len(w) == 1, '应报组数不符，实为 %d 条：%s' % (len(w), w)
        return with_tree(f, skill_md=md)

    def s5():
        md = CLEAN_SKILL + '\n| `python scripts/selftest_boundary.py` | **3 组** | 演示 |\n'

        def f(root):
            w = SC.k7_selftest_count(root)
            return len(w) == 0, '不该报，实为 %d 条：%s' % (len(w), w)
        return with_tree(f, skill_md=md)

    def s6():
        def f(root):
            w = SC.k8_skip_kind(root)
            # 消息里带的是**条件原文**和行号，不带调用参数——所以按函数名筛：
            # AP 夹具里只有 gate_a 那个 `_skip_section` 没写 kind。
            hit = [x for x in w if '`_skip_section`' in x]
            return len(hit) == 1, '内容条件无 kind 的 `_skip_section` 应报 1 条，实得 %d 条：%s' % (len(hit), w)
        return with_tree(f)

    def s7():
        def f(root):
            w = SC.k8_skip_kind(root)
            # 按**条件原文**筛：K8 的消息里带的是条件（`args.ledger`），
            # 不是调用参数（`no ledger`）——按参数筛会永远匹配不到，测试就成了摆设。
            return (not any('args.ledger' in x for x in w),
                    'args 条件（`if args.ledger`）被误报：%s' % w)
        return with_tree(f)

    def s8():
        def f(root):
            w = SC.k8_skip_kind(root)
            # 同上：按条件原文筛（`'NA_TABLE' in pkg_text`）。
            return (not any("'NA_TABLE'" in x for x in w),
                    '已显式 kind= 的调用被误报：%s' % w)
        return with_tree(f)

    def s9():
        def f(root):
            w = SC.k8_skip_kind(root)
            return (any('_skip_msg' in x for x in w),
                    '`_skip_msg` 那一层没被覆盖（v5.37.12 补的就是它）：%s' % w)
        return with_tree(f)

    def s10():
        # 端到端：干净树（AP_PY 里那两处该报的还在，所以先把它们改成带 kind 的版本）
        clean_ap = AP_PY.replace("_skip_section('no table')", "_skip_section('no table', kind='缺输入')") \
                        .replace("_skip_msg('no rules')", "_skip_msg('no rules', kind='缺输入')")
        root = make_tree(ap_py=clean_ap)
        try:
            import subprocess
            p = subprocess.Popen([sys.executable, os.path.join(HERE, 'scan_conflicts.py'), root],
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            out = p.communicate()[0].decode('utf-8', 'replace')
            ok = '九个模式全部干净' in out
            return (ok, '干净树上没报「九个模式全部干净」，实际输出：%s' % out.strip().splitlines()[-3:])
        finally:
            shutil.rmtree(root, ignore_errors=True)

    case('S1 K1 围栏奇数 → ERROR', s1)
    case('S2 K5 跳过门禁没写「不是通过」→ WARN', s2)
    case('S3 K5 写了「不是通过」→ 不报', s3)
    case('S4 K7 组数不符 → WARN', s4)
    case('S5 K7 组数相符 → 不报', s5)
    case('S6 K8 内容条件 + 无 kind → WARN', s6)
    case('S7 K8 args 条件 + 无 kind → 豁免', s7)
    case('S8 K8 内容条件 + 有 kind → 不报', s8)
    case('S9 K8 覆盖门函数内 `_skip_msg`', s9)
    case('S10 CLI 端到端：干净树全绿', s10)

    def s11():
        def f(root):
            w = SC.k8_skip_kind(root)
            hit = [x for x in w if '`_skip_msg`' in x]
            return len(hit) == 1, '嵌套 if 下同一次调用应只报 1 条，实得 %d 条：%s' % (len(hit), w)
        return with_tree(f, ap_py=AP_NESTED, demo=None)

    case('S11 K8 嵌套 if 去重（同一调用不报两遍）', s11)

    def s12():
        def f(root):
            p = os.path.join(root, 'references', '质感纪律.md')
            io.open(p, 'w', encoding='utf-8', newline='').write(
                '阈值口径：**③ 社区实测**（经验值，非官方）。\n')
            w = SC.k9_tier3_source([p])
            return len(w) == 1, '③ 行无来源应报 1 条，实为 %d：%s' % (len(w), w)
        return with_tree(f)

    def s13():
        def f(root):
            p = os.path.join(root, 'references', '质感纪律.md')
            io.open(p, 'w', encoding='utf-8', newline='').write(
                '阈值口径：**③ 社区实测**（经验值；来源：本库实测记录 §二）。\n')
            w = SC.k9_tier3_source([p])
            return w == [], '③ 行有来源不应报，实得：%s' % w
        return with_tree(f)

    case('S12 K9 ③ 行无来源 → WARN', s12)
    case('S13 K9 有来源标记 → 不报', s13)

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
