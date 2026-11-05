#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""`audit_all.py` 回归（v5.37.11 · 第十一套）

治的病：**链路最末端、最被依赖的那个脚本，测试覆盖为零。**
`run_all_checks.sh` 覆盖了九套自测 + 三个样例，唯独没有 `audit_all`——
而文档里写的是「交付前**首选一条命令**，跑 `audit_all.py`」。
它坏了没人知道，因为它自己就是那个「跑完就交差」的东西。

覆盖（全部只看行为与数字一致性，不写死绝对值）：
  A1 行内未查必须出现在末段                ← v5.37.10 修的那行，不许悄悄消失
  A2 行内未查的数字 = audit_project 行里的「N 未查」  ← 两处不许各说一个数
  A3 默认退出码不受行内未查影响（阻断 0 就是 0）      ← 契约是「0 = 无阻断」
  A4 `--strict` 把行内未查算失败                      ← 有开关才谈得上 CI 卡它
  A5 门级未查按**门**数（两个 --skip 就是 2）
  A6 「门级 vs 行内」不可比的提示在                ← 两个不同单位的数同屏必须解释
  A7 `--skip project` 后末段不该出现「行内未查 0 条」  ← 反向锁：零不该被念出来
  A8 选项写在包路径前 → 退 2 且指对方向
  A9 包不存在 → 退 2 且带 E-INPUT
  A10 `--config auto` 全量输入 → 行内未查归零       ← 配置必须真的补齐所有门
  A11 配置路径不存在 → 退 2，不降级继续跑          ← 错的配置不能被当成没配

用法：python scripts/selftest_audit_all.py
退出码：0 = 全过；1 = 有败
注意：需要 node（check_style 判据在 JS 侧）。包写在临时目录，跑完清理。
A10 复用官方实战样例的全输入组合（当前唯一已知 18/18 的夹具），并把输入
移进 `项目资料/`——`_search_dirs` 只扫包目录/父目录和 assets/docs/data/script，
扫不到它。于是「未查归零」只可能由 liqi.json 造成，差分锁得住。
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

# 夹具直接复用 selftest_config 的「最小合法包」：它已经被那条线验证过
# 「audit_project 跑出 0 error」——两份各自维护的夹具迟早会漂移，
# 而这条线关心的不是包长什么样，是 audit_all 怎么把结果汇总成人话。
from selftest_config import PKG  # noqa: E402

P = sys.executable


def run(cmd):
    p = subprocess.Popen(cmd, cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out = p.communicate()[0].decode('utf-8', 'replace')
    return p.returncode, out


def main():
    if not (shutil.which('node') or shutil.which('node.exe')):
        print('需要 node（check_style 判据在 JS 侧）')
        return 2

    # v5.47.1：深一层，父目录=夹具私有而非 %TEMP%（auto 探针扫父目录，%TEMP% 的同名遗留文件
    # 会让 audit_project 捡到别人的剧本 → A 门抽 0 条报 E → A3/A4 的「阻断 0」前提崩）
    root = tempfile.mkdtemp(prefix='liqi_aa_')
    tmp = os.path.join(root, 'proj')
    os.makedirs(tmp)
    pkg = os.path.join(tmp, '包.md')
    io.open(pkg, 'w', encoding='utf-8', newline='').write(PKG)
    AA = os.path.join(HERE, 'audit_all.py')

    def aa(*extra):
        return run([P, AA, pkg] + list(extra))

    # ── A10 夹具：把官方实战样例复制成「全输入项目」，输入藏进 项目资料/ ──
    # 不另造「18 门全开且 0 未查」的合成包：要证明的是配置补齐输入，
    # 不是再维护一套门禁夹具。示例里 liqi.json 已是当前唯一的全输入组合；
    # 把它复制、把每个路径改到 项目资料/，自动发现就完全够不着。
    proj_root = tempfile.mkdtemp(prefix='liqi_aa_cfg_')
    proj = os.path.join(proj_root, 'proj')  # v5.47.1：深一层，同 tmp——A10 的差分前提靠它守住
    os.makedirs(proj)
    src = os.path.join(ROOT, 'examples', '实战_梦中人_场1')
    pkg_cfg = os.path.join(proj, '包.md')
    shutil.copyfile(os.path.join(src, '包.md'), pkg_cfg)
    hidden = os.path.join(proj, '项目资料')
    os.makedirs(hidden)
    with io.open(os.path.join(src, 'liqi.json'), encoding='utf-8') as f:
        cfg = json.load(f)
    for _k, _v in list(cfg.items()):
        if not isinstance(_v, str):
            continue
        _src = os.path.join(src, _v)
        if os.path.isfile(_src):
            _name = os.path.basename(_src)
            shutil.copyfile(_src, os.path.join(hidden, _name))
            cfg[_k] = '项目资料/' + _name
    with io.open(os.path.join(proj, 'liqi.json'), 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    rc_cfg_off, out_cfg_off = run([P, AA, pkg_cfg])
    rc_cfg_on, out_cfg_on = run([P, AA, pkg_cfg, '--config', 'auto'])

    rows = []

    def case(name, fn):
        try:
            ok, why = fn()
        except Exception as e:  # noqa: BLE001
            ok, why = False, '抛异常：%s' % e
        rows.append((name, ok, why))

    # 主线：跳过两个会阻断的门，剩下「阻断 0 但有 11 条行内未查」——
    # 正是 v5.37.10 修的那个场景。用 --skip 造它，比造一个能过契约的包便宜得多，
    # 而且顺带把 `--skip` 路径也测了。
    rc0, out0 = aa('--skip', 'prompt,contract')

    def a1():
        if '行内未查' not in out0:
            return False, '末段没有「行内未查」这一行 —— 那 11 条没跑的门被吞了'
        return True, ''

    def a2():
        m1 = re.search(r'(\d+)\s*未查（', out0)
        m2 = re.search(r'行内未查\s*(\d+)\s*条', out0)
        if not (m1 and m2):
            return False, '取不到两个数：行内=%s 末段=%s' % (m1 and m1.group(1), m2 and m2.group(1))
        return (m1.group(1) == m2.group(1),
                '两处不一致：行内 %s vs 末段 %s' % (m1.group(1), m2.group(1)))

    def a3():
        if rc0 != 0:
            return False, '默认退出码应为 0（阻断 0），实为 %d' % rc0
        if '阻断 0' not in out0:
            return False, '输出里没有「阻断 0」，夹具假设不成立'
        return True, ''

    def a4():
        rc, out = aa('--skip', 'prompt,contract', '--strict')
        if rc != 1:
            return False, '--strict 应退 1（有行内未查），实为 %d' % rc
        if '条行内未查' not in out:
            return False, '--strict 的结论没点明「条行内未查」'
        return True, ''

    def a5():
        # 两个 --skip 门 → 门级未查 2。按门数，不是按判据条数。
        return ('门级未查 2' in out0, '输出里没有「门级未查 2」')

    def a6():
        return ('两者不可比' in out0, '同屏放了两个不同单位的数，却没解释它们不可比')

    def a7():
        rc, out = aa('--skip', 'prompt,contract,project')
        if '行内未查' in out:
            return False, '没有 audit_project 却还念了「行内未查」——零不该被念出来'
        return (rc == 0, '退出码应为 0，实为 %d' % rc)

    def a8():
        rc, out = run([P, AA, '--strict', pkg])
        if rc != 2:
            return False, '选项写在包路径前应退 2，实为 %d' % rc
        return ('第一个参数必须是提示词包路径' in out,
                '报错没指出是「参数顺序」问题（用户会去查文件是否存在）')

    def a9():
        rc, out = run([P, AA, os.path.join(tmp, '不存在.md')])
        if rc != 2:
            return False, '包不存在应退 2，实为 %d' % rc
        return ('E-INPUT' in out, '缺 E-INPUT 码号')

    def a10():
        # 先锁夹具前提：不配 config 必须真的有行内未查。否则输入早被自动发现
        # 捞走，这里的「归零」就是一句空话（绿了也证明不了配置）。
        m_off = re.search(r'行内未查\s*(\d+)\s*条', out_cfg_off)
        if not m_off or int(m_off.group(1)) < 1:
            return False, ('夹具前提不成立：不配 config 时应至少有 1 条行内未查，实际 %s'
                           % (m_off.group(1) if m_off else '没有「行内未查」这一行'))
        if '[config] 生效' not in out_cfg_on:
            return False, 'audit_all 没读到 liqi.json'
        if '门覆盖 18/18' not in out_cfg_on:
            return False, '配置没补齐全部输入（输出无「门覆盖 18/18」）'
        if '✅ audit_project（项目级 · --auto）' not in out_cfg_on:
            return False, 'audit_project 没变成全绿——配置可能只在本层生效，没转发给下游'
        if '行内未查' in out_cfg_on:
            return False, '全量配置后仍打出「行内未查」——未查没有归零'
        if '门级未查 0' not in out_cfg_on:
            return False, '全量配置后门级未查不是 0'
        if '[config] --beats =' not in out_cfg_on or 'check_prompt（含 --beats）' not in out_cfg_on:
            return False, '配置里的 beats 没交给 check_prompt（--config 的清单转发不完整）'
        return True, ''

    def a11():
        rc, out = aa('--config', os.path.join(tmp, '不存在.json'))
        if rc != 2:
            return False, '配置不存在应退 2，实为 %d' % rc
        if 'E-CONFIG' not in out:
            return False, '缺 E-CONFIG 码号——用户不知道是配置问题'
        return ('已中止' in out, '报错没明说「已中止」，容易被读成降级继续跑')

    # 逐条登记（不用循环）：`scan_conflicts.py` 的 K7 按 `^case(` 数用例，
    # 循环写法会让「文档写 N 组」失去对账依据。写法与 boundary / audit_literal 一致。
    case('A1 行内未查出现在末段', a1)
    case('A2 末段数字 = 行里的「N 未查」', a2)
    case('A3 默认退出码不受行内未查影响', a3)
    case('A4 --strict 把行内未查算失败', a4)
    case('A5 门级未查按门数（--skip 两个 → 2）', a5)
    case('A6 「门级 vs 行内」不可比的提示在', a6)
    case('A7 --skip project 后不念「行内未查」', a7)
    case('A8 选项在包路径前 → 退 2 且指对方向', a8)
    case('A9 包不存在 → 退 2 且带 E-INPUT', a9)
    case('A10 --config auto 全量输入 → 行内未查归零', a10)
    case('A11 配置路径不存在 → 退 2，不降级', a11)

    shutil.rmtree(proj_root, ignore_errors=True)
    shutil.rmtree(root, ignore_errors=True)

    passed = 0
    failed = []
    for name, ok, why in rows:
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
