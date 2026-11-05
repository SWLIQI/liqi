#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""liqi 门禁总控（v5.24.0 · 门禁默认化）

治的病：**门禁名义存在、实际不跑**。
liqi 有六个校验器，但 opt-in 参数一大堆（--registry / --ledger / --beats /
--foreshadow / --epstruct / --adapttable / --script / --decisions）。
真实项目里没人愿意手打八个路径，于是一路跳过，最后「全绿」——
**绿是因为大部分门根本没跑，不是因为都过了。**

本脚本做三件事：
  1. 就近自动发现输入（复用 audit_project.auto_fill，同一份发现逻辑）
  2. 依次跑全部门禁（含跨语言：node 侧 check_prompt / check_style）
  3. 打印《门禁总账》：每门跑没跑、结果、为什么没跑——**「未查」逐条明写**

用法：
  python scripts/audit_all.py <提示词包.md> [--surface cn|intl|h3] [--strict] [--full]
                              [--skip prompt,style]
                              [--model 2.5] [--official] [--config liqi.json|auto]

  --config（v5.37.5）：一份 liqi.json 把 surface / model / skip / official 与全部输入路径
  收进版本库。传 auto = 取包同目录的 liqi.json（找不到报错，不静默跳过）。
  优先级：显式 CLI > liqi.json > --auto 自动发现。

退出码：0 = 无阻断；1 = 有阻断项（--strict 下 warning 与行内未查也算）；
        2 = 用法/读取/配置错误
「未查」不计入通过——与 Z 门 / G7 / N2 / CT / --auto 同一条口径。
注意：默认（不加 --strict）下「行内未查」不改退出码，但会在结论前单列一行
「行内未查 N 条 —— 未查 ≠ 通过，别当全绿交付」，因为那几门根本没跑。
"""
from __future__ import print_function

import io
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import audit_project as AP  # noqa: E402  （复用 --auto 的发现逻辑，单一事实源）
import liqi_config  # noqa: E402  （v5.37.5：liqi.json 项目配置）


# ── 终端色 ───────────────────────────────────────────────────────────────────
def _c(s, code):
    if not sys.stdout.isatty() or os.environ.get('NO_COLOR'):
        return s
    return '\033[%sm%s\033[0m' % (code, s)


RED, YEL, GRN, DIM = '31', '33', '32', '90'


def _dw(s):
    import unicodedata
    return sum(2 if unicodedata.east_asian_width(c) in 'WF' else 1 for c in s)


def _pad(s, w):
    return s + ' ' * max(0, w - _dw(s))


def run(cmd):
    """跑一条命令，返回 (rc, out)。不抛异常，读不了也当失败项。"""
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        out = p.communicate()[0].decode('utf-8', 'replace')
        return p.returncode, out
    except Exception as e:  # noqa: BLE001
        return 127, '启动失败：%s' % e


# ── 结果解析：每门一个提取器，返回 (state, summary) ──────────────────────────
# state: ok / warn / fail / skip  —— 「skip」永不折算成 ok
def parse_check_prompt(rc, out):
    m = re.search(r'结果：(\d+)\s*error\s*/\s*(\d+)\s*warning', out)
    if m:
        e, w = int(m.group(1)), int(m.group(2))
        return ('fail' if e else ('warn' if w else 'ok')), '%d error / %d warning' % (e, w)
    if '全部通过' in out:
        return 'ok', '0 error / 0 warning'
    if 'E-WRONG-SCRIPT' in out:
        return 'wrong-script', '包被判为 H3 面，应改跑 check_prompt_h3'
    return ('fail' if rc else 'ok'), '未解析到结果行（rc=%d）' % rc


def parse_literal(rc, out):
    if '未检出' in out:
        return 'ok', '0 候选'
    m = re.search(r'候选总数：(\d+)', out)
    if m:
        n = int(m.group(1))
        return ('warn' if n else 'ok'), '%d 候选（脚本只报候选，须人工判）' % n
    return ('fail' if rc else 'ok'), '未解析到结果行（rc=%d）' % rc


def parse_risk(rc, out):
    m = re.search(r'合计风险分：(\d+)', out)
    if m:
        n = int(m.group(1))
        return ('warn' if n else 'ok'), '风险分 %d' % n
    return ('fail' if rc else 'ok'), '未解析到结果行（rc=%d）' % rc


def parse_project(rc, out):
    # v5.37.3：汇总行拆成三段「N error / M warning / K 未查」。
    # 必须把 K 读出来并单列成 skip 态：否则「0 error / 0 warning / 10 未查」
    # 会落到下面的「无 error 无 warning ⇒ ok」分支——**两道门从没跑过却报全绿**，
    # 正是这个文件开头那行注释「skip 永不折算成 ok」要防的事。
    # v5.37.6：第四段是括号里的分类明细 `缺输入 11 / 门槛 1`。
    # 只从**汇总行**取（`out` 里还有一堆 [SKIP] 消息，那些括号里的原因又长又像），
    # 所以整条正则锚在「结果：」这一行上、明细里不许出现「，」。
    m = re.search(
        r'结果：(\d+)\s*error\s*/\s*(\d+)\s*warning'
        r'(?:\s*/\s*(\d+)\s*未查(?:（([^）]*)）)?)?'
        # v5.37.8：不适用是第四档，跟在未查后面，不进未查计数。
        r'(?:\s*/\s*(\d+)\s*不适用)?', out)
    cov = re.search(r'覆盖 (\d+) / (\d+)', out)
    tail = '｜门覆盖 %s/%s' % (cov.group(1), cov.group(2)) if cov else ''
    if m:
        e, w = int(m.group(1)), int(m.group(2))
        k = int(m.group(3)) if m.group(3) else 0
        state = 'fail' if e else ('warn' if w else ('skip' if k else 'ok'))
        s = '%d error / %d warning' % (e, w)
        if k:
            # 括号里是「缺输入 11 / 门槛 1，未查 ≠ 通过」——取逗号前那一段，
            # 「未查 ≠ 通过」是口径提醒，不是明细。
            detail = (m.group(4) or '').split('，')[0].strip()
            s += ' / %d 未查' % k + ('（%s）' % detail if detail else '')
        if m.group(5):
            # 不适用不进退出码，但总账上必须看得见：它和「这一门查过了」长得一样。
            s += ' · %s 不适用' % m.group(5)
        return state, s + tail
    if '全部通过' in out:
        return 'ok', '0 error / 0 warning' + tail
    return ('fail' if rc else 'ok'), '未解析到结果行（rc=%d）%s' % (rc, tail)


def parse_style(rc, out):
    if '未声明 style_id' in out or '未声明 style' in out:
        return 'skip', '包内未声明 style_id —— 未查，不是通过'
    m = re.search(r'ERROR\s*(\d+)[　\s]+WARN\s*(\d+)', out)
    if m:
        e, w = int(m.group(1)), int(m.group(2))
        return ('fail' if e else ('warn' if w else 'ok')), '%d ERROR / %d WARN' % (e, w)
    return ('ok' if rc == 0 else 'fail'), '未解析到结果行（rc=%d）' % rc


def parse_contract(rc, out):
    m = re.search(r'契约统计：PASS\s*(\d+)\s*｜\s*WARN\s*(\d+)\s*｜\s*FAIL\s*(\d+)\s*｜\s*N/A\s*(\d+)', out)
    if m:
        a, w, f, n = (int(x) for x in m.groups())
        return ('fail' if f else ('warn' if w else 'ok')), \
            'PASS %d / WARN %d / FAIL %d / N/A %d（N/A 不计入通过）' % (a, w, f, n)
    return ('fail' if rc else 'ok'), '未解析到结果行（rc=%d）' % rc


def main():
    argv = sys.argv[1:]
    if not argv or argv[0] in ('-h', '--help'):
        print(__doc__)
        return 0 if argv else 2
    pkg = argv[0]
    if pkg.startswith('-'):
        # 包路径必须在第一位；否则下面整段 argv 解析会把这个选项当成文件名去 stat，
        # 报出来的「找不到提示词包」会把人引到错的方向（其实是参数顺序问题）。
        print('E-INPUT：第一个参数必须是提示词包路径，收到的是选项 %s —— '
              '请写成 audit_all.py <包.md> %s …' % (pkg, pkg))
        return 2
    if not os.path.isfile(pkg):
        print('E-INPUT：找不到提示词包 %s' % pkg)
        return 2

    surface = None          # None = 命令行没给；不能预置 'cn'，否则会挡住 liqi.json
    strict = ('--strict' in argv)
    full = ('--full' in argv)
    skip = set()
    model = None
    cfg_arg = None
    for i, a in enumerate(argv):
        # 兼容 `--k v` 与 `--k=v`：liqi_config.given_flags() 两种都认，
        # 这里若只认一种，就会出现「配置以为你传了、脚本其实没读到」。
        if a == '--surface' and i + 1 < len(argv):
            surface = argv[i + 1]
        elif a.startswith('--surface='):
            surface = a.split('=', 1)[1]
        if a == '--skip' and i + 1 < len(argv):
            skip = set(x.strip() for x in argv[i + 1].split(',') if x.strip())
        elif a.startswith('--skip='):
            skip = set(x.strip() for x in a.split('=', 1)[1].split(',') if x.strip())
        if a == '--model' and i + 1 < len(argv):
            model = argv[i + 1]
        elif a.startswith('--model='):
            model = a.split('=', 1)[1]
        if a == '--config' and i + 1 < len(argv):
            cfg_arg = argv[i + 1]
        elif a.startswith('--config='):
            cfg_arg = a.split('=', 1)[1]

    official = ('--official' in argv)

    # ── 0. liqi.json 项目配置（v5.37.5）──────────────────────────────────────
    # 优先级：显式 CLI > liqi.json > --auto 自动发现。三档顺序只写在这一段，
    # 不散到各处 —— 散落的优先级等于没有优先级。
    cfg, cfg_errs, cfg_path = liqi_config.resolve(cfg_arg, pkg, liqi_config.ALL_KEYS)
    if cfg_errs:
        for e in cfg_errs:
            print(e)
        print('E-CONFIG：配置不可用，已中止——降级继续跑等于假装配过了。')
        return 2
    cfg_notes, beats = [], None
    if cfg_path:
        # 借用 apply() 只为复用「只填空值 / 显式命令行优先」这一处实现；
        # 在这里另写一套优先级判断，两套迟早分叉（分叉时没人知道哪套对）。
        class _C(object):
            pass

        cargs = _C()
        cargs.surface = surface
        cargs.official = official
        cargs.model = model
        cargs.beats = None
        cargs.skip = sorted(skip)
        cfg_notes = liqi_config.apply(cargs, cfg, liqi_config.given_flags(argv))
        surface, model = cargs.surface, cargs.model
        beats, official = cargs.beats, cargs.official
        skip = set(cargs.skip or ())
        cfg_notes.insert(0, '[config] 生效：%s' % cfg_path)
    surface = surface or 'cn'
    if surface not in ('cn', 'intl', 'h3'):
        print('E-INPUT：--surface 只认 cn / intl / h3，收到 %s' % surface)
        return 2

    node = shutil.which('node') or shutil.which('node.exe')
    py = sys.executable

    # ── 1. 自动发现输入（与 audit_project --auto 共用一份逻辑） ──────────────
    class _A(object):
        pass

    auto = _A()
    for name, _names, _gate in AP.AUTO_INPUTS:
        setattr(auto, name, None)
    notes = AP.auto_fill(auto, pkg)

    print('\n' + '=' * 78)
    print('liqi 门禁总账 —— %s　·　surface=%s' % (os.path.basename(pkg), surface))
    print('=' * 78)
    for n in cfg_notes:
        print('  ' + n)
    for n in notes:
        print('  ' + n)

    # beats 交给 check_prompt；配置优先，其次就近自动发现
    if beats is None:
        for d in AP._search_dirs(pkg):
            for n in ('beats.txt', '节拍清单.txt'):
                p = os.path.join(d, n)
                if os.path.isfile(p):
                    beats = p
                    break
            if beats:
                break

    results = []  # (名称, state, summary, out)

    def add(name, rc, out, parser):
        st, sm = parser(rc, out)
        results.append((name, st, sm, out))

    def show(name, st, out):
        icon = {'ok': _c('✅', GRN), 'warn': _c('⚠️ ', YEL),
                'fail': _c('❌', RED), 'skip': _c('⏭ ', DIM),
                'wrong-script': _c('↪', YEL)}.get(st, '?')
        print('\n%s %s' % (icon, name))
        body = out.strip().split('\n')
        if not full:
            body = body[-6:]
        for l in body:
            print('   ' + l)
        print('')

    # ── 2. check_prompt（H3 面自动切换） ──────────────────────────────────
    if 'prompt' not in skip:
        if not node:
            add('check_prompt', 127, '未找到 node，check_prompt 未跑——**跳过不是通过**', parse_check_prompt)
        else:
            cp = os.path.join(HERE, 'check_prompt.mjs')
            cmd = [node, cp, pkg, '--surface', 'intl' if surface == 'intl' else 'cn']
            if beats:
                cmd += ['--beats', beats]
            # v5.37.5：official 可以来自 liqi.json（"official": true）。
            # 它决定「中文 ≤500 字 / 英文 ≤1000 词」这道官方口径门跑不跑——
            # 没跑就是「未查」，所以必须显式透传，不能让总账以为查过了。
            if official:
                cmd += ['--official']
            if model:
                cmd += ['--model', model]
            rc, out = run(cmd)
            st, _ = parse_check_prompt(rc, out)
            if st == 'wrong-script':
                rc, out = run([node, os.path.join(HERE, 'check_prompt_h3.mjs'), pkg])
                add('check_prompt_h3（自动切换）', rc, out, parse_check_prompt)
            else:
                add('check_prompt' + ('（含 --beats）' if beats else ''), rc, out, parse_check_prompt)

    # ── 3. audit_literal / audit_risk ─────────────────────────────────────
    if 'literal' not in skip:
        rc, out = run([py, os.path.join(HERE, 'audit_literal.py'), pkg])
        add('audit_literal（画面表述）', rc, out, parse_literal)
    if 'risk' not in skip and surface in ('cn', 'intl'):
        rc, out = run([py, os.path.join(HERE, 'audit_risk.py'), pkg])
        add('audit_risk（过审预检）', rc, out, parse_risk)
    elif 'risk' not in skip:
        # h3 面不跑 risk，但必须留痕——不写就等于这门「不存在」，总账看不出少跑一门
        results.append(('audit_risk（过审预检）', 'skip',
                        'h3 面不跑本门（只对国内面 / 国际面成立）', ''))

    # ── 4. audit_project --auto（把已发现的输入原样传下去，不重复发现） ────
    if 'project' not in skip:
        # 用 --auto 而不是逐个透传参数：让「怎么发现」只有一处实现，
        # 也能顺带拿到《门禁覆盖矩阵》（总账里的「门覆盖 n/m」就来自它）。
        cmd = [py, os.path.join(HERE, 'audit_project.py'), pkg, '--auto']
        if model:
            cmd += ['--model', model]
        # 同一份 liqi.json 传给下游：两个脚本各读自己要的键，不各写一份配置。
        # audit_project 侧仍是「显式 CLI > 配置 > --auto」，不会覆盖它自己的发现结果。
        if cfg_path:
            cmd += ['--config', cfg_path]
        rc, out = run(cmd)
        add('audit_project（项目级 · --auto）', rc, out, parse_project)

    # ── 5. check_style（只有声明了 style_id 才有意义） ─────────────────────
    if 'style' not in skip and node:
        scmd = [node, os.path.join(HERE, 'check_style.mjs'), pkg]
        if cfg.get('style_registry'):
            scmd += ['--registry', cfg['style_registry']]
            cfg_notes.append('[config] check_style --registry = %s（项目自建风格，v6.4.1）' % cfg['style_registry'])
        rc, out = run(scmd)
        add('check_style（风格门禁）', rc, out, parse_style)
        add('check_style（风格门禁）', rc, out, parse_style)

    # ── 6. audit_contract（阶段产物完整性） ───────────────────────────────
    if 'contract' not in skip:
        rc, out = run([py, os.path.join(HERE, 'audit_contract.py'), pkg])
        add('audit_contract（交付契约 CT1~CT8）', rc, out, parse_contract)

    # ── 明细 ──────────────────────────────────────────────────────────────
    for name, st, _sm, out in results:
        show(name, st, out)

    # ── 总账 ──────────────────────────────────────────────────────────────
    print('=' * 78)
    print('门禁总账')
    print('=' * 78)
    order = {'fail': 0, 'wrong-script': 1, 'warn': 2, 'skip': 3, 'ok': 4}
    icon = {'ok': '✅', 'warn': '⚠️ ', 'fail': '❌', 'skip': '⏭ ', 'wrong-script': '↪'}
    n_bad = n_warn = n_skip = 0
    for name, st, sm, _out in sorted(results, key=lambda r: order.get(r[1], 9)):
        print('  %s %s %s' % (icon[st], _pad(name, 34), sm))
        if st == 'fail':
            n_bad += 1
        elif st == 'warn':
            n_warn += 1
        elif st == 'skip':
            n_skip += 1
    user_skip = sorted(x for x in skip if x in
                       ('prompt', 'literal', 'risk', 'project', 'style', 'contract'))
    if user_skip:
        # 用户主动跳过也必须进「未查」——「我选择不查」和「查过了」是两件事
        print('  %s %s %s' % (icon['skip'], _pad('（--skip 指定）', 34),
                              '、'.join(user_skip) + ' —— 未查，跳过不是通过'))
        n_skip += len(user_skip)
    print('-' * 78)
    # v5.37.7：这个数说的是「**门**没跑」（--skip / 未声明 style_id），
    # 与 audit_project 那一行里的「12 未查」**不是一个单位**——那 12 是门内部的判据条数。
    # 不区分的话用户会拿 1 和 12 对比，然后以为总账算错了。
    print('  跑过 %d 门｜阻断 %d｜待人工 %d｜门级未查 %d'
          % (len(results), n_bad, n_warn, n_skip))
    # v5.37.10：把「行内未查」搬进总账末段。
    # 结论行是交付前最后一句人话，只写「无阻断项」会被读成「可以交付」——
    # 而 audit_project 那一行可能还挂着 11 条没跑的门：它在**自己的退出码**里算未通过，
    # 到总账这里却不影响结论。**两层口径不一致时，用户只会信最后一层。**
    n_inner, inner_detail = 0, []
    for _n, _st, sm, _o in results:
        m = re.search(r'(\d+) 未查(?:（([^）]*)）)?', sm or '')
        if m:
            n_inner += int(m.group(1))
            if m.group(2):
                inner_detail.append(m.group(2).split('，')[0])
    if n_skip or n_inner or any('未查' in r[2] for r in results):
        print('  %s「未查」不计入通过——跳过不是通过，N/A 不是通过（与 Z / G7 / N2 / CT 同口径）；'
              '门级未查按**门**数，行内「N 未查」按**判据条数**，两者不可比'
              % _c('注意：', YEL))
    if n_inner:
        print('  %s' % _c('  行内未查 %d 条（%s）—— 未查 ≠ 通过，别当全绿交付'
                          % (n_inner, '；'.join(inner_detail) or '明细见上表'), YEL))
    if n_bad:
        print(_c('  结论：有 %d 项阻断，修完再交付' % n_bad, RED))
        return 1
    if strict and (n_warn or n_inner):
        # --strict 的含义是「任何不确定都算失败」。行内未查就是最大的不确定：
        # 那几门根本没跑，凭什么说它过了。
        _why = []
        if n_warn:
            _why.append('%d 项 warning' % n_warn)
        if n_inner:
            _why.append('%d 条行内未查' % n_inner)
        print(_c('  结论：--strict 下 %s 均视为失败' % ' + '.join(_why), RED))
        return 1
    print(_c('  结论：无阻断项', GRN) + ('（仍有 %d 项待人工确认）' % n_warn if n_warn else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
