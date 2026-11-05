#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""liqi 冲突模式扫描器（v5.26.0 · 维护时跑，不参与交付门禁）

治的病：**规则库的病不是"某条写错了"，是"上一版的判据还活在没改到的句子里"。**
v5.15.8 靠人现写 20 类正则扫了一遍；2026-10-17 的原创结构排查又临时写了 5 类。
本脚本把这些临时模式固化下来，让下一次改规则时可以一条命令重跑。

**九个模式（全部可机械判定，零语义猜测）：**

  K1 代码块围栏奇数      —— ``` 未闭合，后面整段被当代码
  K2 表格列数异常        —— 同行块内列数不一致（剔除行内代码后再数）
  K3 绝对数字互相打架    —— 同一量词（小节/档/内容码）在 live 文档里出现 ≥2 个不同数
  K4 同一概念多名        —— ALIASES 里列的旧名仍出现在 live 文档（改名遗漏）
  K5 「跳过」缺口径      —— 提到跳过某门，但同句没写「不是通过 / 不等于通过」
  K6 声明与实现反向      —— 文档声称"已补齐/已同步"的条目，目标文件里找不到对应行
  K7 自测组数对不上      —— 文档写「N 组击穿用例」，而 selftest 源码里的用例数不是 N
  K8 跳过的类别没声明    —— 条件不是「参数给没给」的 `_skip_section` / `_skip_msg`，必须显式 kind=
  K9 ③口径无溯源        —— 行含「③ 社区实测」却无 来源/出处/未存档/待复访/口径图例 标记（裁决/待办/glossary 豁免，v6.1.0 C22）

排除范围：CHANGELOG.md（历史留档）· references/liqi全景梳理.md（版本表有意保留）。

用法：python scripts/scan_conflicts.py [skill根目录]
退出码：0 = 无 ERROR；1 = 有 ERROR；2 = 路径错误
"""
from __future__ import print_function

import ast
import io
import os
import re
import sys

ARCHIVE = {'CHANGELOG.md', 'liqi全景梳理.md'}

# K3：只收「全库只能有一个值」的**具体断言**。
# ⚠️ 第一版按裸量词（N 小节 / N 档）抓，结果把「3 档」「1 小节」这类通用表述全扫进来，
#    一条 K3 报了 9 个值——**扫描器噪声比它要查的问题更费人**。改为按短语锚点抓。
K3_CLAIMS = [
    # ≥2 位避开「1 小节」泛指；「第N小节」「第 N 小节」是指针（速查第 10 小节）不是计数声明——
    # v5.53.0 加负向后顾：此前待办/裁决里的速查指针被当成多值打架（K3 自己的第一课：
    # 扫描器噪声比它要查的问题更费人）。
    (r'(?<!\d)(?<!第)(?<!第 )(\d{2})\s*小节', '镜块小节数'),
    # 只认「景别（视觉结果句）N 档」这种**档数声明**；「景别跨度 ≥3 档」是跨度不是档数，
    # 裸锚 `景别…N 档` 会把它一起抓进来（v5.29.0 实测误报）。
    (r'景别(?:视觉结果句)?\s*[（(]?\s*(\d)\s*档', '景别档数'),
    (r'(\d{2})\s*个内容码', '内容码数'),
]

# K4：旧名 → 现名。改名时在这里加一条，扫描器就会替你找漏网。
ALIASES = [
    ('生成视频起始行', '标题参数行'),   # v5.28.0：元指令并入参数行（# title）
    ('各版本多视图', '不同时段的多视角图'),
    ('其他版本多视图', '不同时段的多视角图'),
    ('三阶多视图', '多视角图'),
]

# K5：跳过口径必须同句出现其中之一
SKIP_OK = ('不是通过', '不等于通过', '不等于已通过', '不等于没问题', '不是「通过」')

# K6：声明式断言与其落点
K6_CLAIMS = [
    # (在哪个文件里找声明, 断言正则, 必须落到哪个文件, 落点正则, 说明)
    (r'SKILL\.md', r'景别\s*9\s*档', r'references/光学与空间语言块\.md',
     r'景别视觉结果句（\s*9\s*档', 'SKILL/索引声称景别 9 档，光学语言块必须也是 9 档'),
    (r'SKILL\.md', r'12\s*小节', r'references/术语对照表_glossary\.md',
     r'\|\s*12\s*小节\s*\|', 'SKILL 声称 12 小节，术语表必须登记 12'),
    (r'CHANGELOG\.md', r'11\s*项区间配额', r'references/分镜配额与机检规范\.md',
     r'11\s*项区间配额', '配额项数声明必须落到配额规范正文'),
]


def read(p):
    return io.open(p, encoding='utf-8').read()


def live_files(root):
    out = []
    for name in ('SKILL.md', 'README.md', 'README.en.md'):
        p = os.path.join(root, name)
        if os.path.exists(p):
            out.append(p)
    ref = os.path.join(root, 'references')
    if os.path.isdir(ref):
        for f in sorted(os.listdir(ref)):
            if f.endswith('.md') and f not in ARCHIVE:
                out.append(os.path.join(ref, f))
    return out


def k1_fences(files):
    errs = []
    for p in files:
        n = len(re.findall(r'^\s*```', read(p), re.M))
        if n % 2:
            errs.append('K1 %s：``` 围栏 %d 个（奇数，有未闭合代码块）' % (os.path.basename(p), n))
    return errs


def k2_tables(files):
    warns = []
    for p in files:
        lines = read(p).split('\n')
        i = 0
        while i < len(lines):
            if lines[i].lstrip().startswith('|'):
                j = i
                while j < len(lines) and lines[j].lstrip().startswith('|'):
                    j += 1
                cols = {}
                for k in range(i, j):
                    l = re.sub(r'`[^`]*`', '', lines[k])
                    if re.match(r'^\s*\|[\s:\-|]+\|\s*$', l) or not l.strip():
                        continue
                    cols.setdefault(l.count('|'), []).append(k + 1)
                if len(cols) > 1:
                    base = max(cols, key=lambda c: len(cols[c]))
                    for c, lns in cols.items():
                        if c != base and len(lns) <= 2:
                            warns.append('K2 %s:%s 表格列数 %d，块内主流 %d'
                                         % (os.path.basename(p), lns, c - 1, base - 1))
                i = j
            else:
                i += 1
    return warns


def k3_numbers(files):
    warns = []
    for pat, label in K3_CLAIMS:
        found = {}
        for p in files:
            for m in re.finditer(pat, read(p)):
                found.setdefault(m.group(1), set()).add(os.path.basename(p))
        if len(found) > 1:
            detail = ' / '.join('%s（%s）' % (k, '、'.join(sorted(v))[:46]) for k, v in sorted(found.items()))
            warns.append('K3 %s 出现多个值：%s —— 全库只能有一个数' % (label, detail))
    return warns


# K4 豁免：**解释改名本身**的那些行不算残留（否则「v5.28.0 前叫 X」会被自己抓）。
K4_EXEMPT_RE = re.compile(r'前叫|旧名|改名|原叫|现已改')


def k4_aliases(files):
    warns = []
    for old, new in ALIASES:
        hits = []
        for p in files:
            for ln, line in enumerate(read(p).split('\n'), 1):
                if old in line and not K4_EXEMPT_RE.search(line):
                    hits.append('%s:%d' % (os.path.basename(p), ln))
        if hits:
            warns.append('K4 旧名「%s」仍出现（现名「%s」）：%s' % (old, new, '、'.join(hits[:6])))
    return warns


def k5_skip(root):
    warns = []
    # 只盯「跳过某道门 / 跳过机检」这类**门禁口径**的跳过；
    # 「A0 轻量路径跳过资产层」是设计分流，不是门禁跳过，不在此列。
    gate_re = re.compile(r'(check_prompt|audit_\w+|check_style|check_skill)')
    p = os.path.join(root, 'SKILL.md')
    if not os.path.exists(p):
        return warns
    for ln, line in enumerate(read(p).split('\n'), 1):
        if '跳过' not in line or not gate_re.search(line):
            continue
        if '轻量' in line or '豁免' in line:
            continue
        if not re.search(r'跳过[^。；\n]{0,12}(门|机检)', line):
            continue
        if not any(w in line for w in SKIP_OK):
            warns.append('K5 SKILL.md:%d 提到跳过门禁但同句没写「不是通过」：%s'
                         % (ln, line.strip()[:60]))
    return warns


def k6_claims(root):
    errs = []
    for src, claim, dst, need, why in K6_CLAIMS:
        sp = os.path.join(root, src) if not src.startswith('references/') else os.path.join(root, src)
        dp = os.path.join(root, dst)
        if not (os.path.exists(sp) and os.path.exists(dp)):
            continue
        if re.search(claim, read(sp)) and not re.search(need, read(dp)):
            errs.append('K6 %s 声称「%s」，但 %s 里找不到落点 —— %s'
                        % (src, claim, dst, why))
    return errs


def k7_selftest_count(root):
    """自测组数：文档声称 vs 源码 T( 实际数量。

    只查这一项，因为它**能精确复算**（`T(` 的数量 = 运行结果末行的「N 过」）。
    码数那类手维护的分项拆解在 v5.30.0 已改成不写数——口径太脆，34+29 都不等于 66。

    ⚠️ 必须**按脚本区分**：README 的回归清单里三行挨着写
    （`selftest_check_prompt` 85 / `selftest_check_style` 10 / `audit_contract` 8），
    不按脚本归属就会拿 85 去比"10 组"，报一堆假错（v5.30.0 实测踩过）。
    """
    warns = []
    counts = {}
    # 两个自测的用例写法不同：prompt 用 T(...) 调用；style 用 `const CASES = [...]`
    # 且总数 = 数组元素 + 数组外 2 组（源码自己的输出行就是这么算的）。
    sp = os.path.join(root, 'scripts', 'selftest_check_prompt.mjs')
    if os.path.exists(sp):
        counts['selftest_check_prompt.mjs'] = len(re.findall(r'(?m)^\s*T\(', read(sp)))
    ss = os.path.join(root, 'scripts', 'selftest_check_style.mjs')
    if os.path.exists(ss):
        t = read(ss)
        m = re.search(r'const CASES = \[(.*?)\n\];', t, re.S)
        if m:
            counts['selftest_check_style.mjs'] = len(re.findall(r'(?m)^\s{2}\{\s*$', m.group(1))) + 2
    # v5.37.1 补两个此前 K7 完全不认识的自测。为什么必须补：这两个自测刚各自长过用例
    # （boundary 7→8、check_prompt_h3 从 0 做到 10），而 K7 只认 prompt/style 两个文件，
    # 于是文档写多少都没人管——**「对账器只认一部分对象」就是另一种静默放行**。
    # 写法：h3 自测每例一个顶层 `check(`；boundary 每例一次 `case(`（`def case(` 不匹配）。
    sh3 = os.path.join(root, 'scripts', 'selftest_check_prompt_h3.mjs')
    if os.path.exists(sh3):
        counts['selftest_check_prompt_h3.mjs'] = len(re.findall(r'(?m)^\s*check\(', read(sh3)))
    sb = os.path.join(root, 'scripts', 'selftest_boundary.py')
    if os.path.exists(sb):
        counts['selftest_boundary.py'] = len(re.findall(r'(?m)^case\(', read(sb)))
    # v5.37.3：audit_risk 从零自测补到 17 组。新加自测必须同时登记到这里，
    # 否则「文档写 17 组、源码实际 9 组」照样没人报——上一批刚踩过这个坑（K7 只认两个文件）。
    sr = os.path.join(root, 'scripts', 'selftest_audit_risk.py')
    if os.path.exists(sr):
        counts['selftest_audit_risk.py'] = len(re.findall(r'(?m)^case\(', read(sr)))
    # v5.37.3 同批：audit_literal 从零自测补到 30 组。登记规则同上——新增自测不登记，
    # 文档里的组数就成了没人校验的自述数字。
    sl = os.path.join(root, 'scripts', 'selftest_audit_literal.py')
    if os.path.exists(sl):
        counts['selftest_audit_literal.py'] = len(re.findall(r'(?m)^case\(', read(sl)))
    # v5.37.5 同批：`--config` 的项目配置自测。它不复用 `case()` 夹具（配置错误要走
    # 「跑一遍子进程看 rc」这条路，不是拼包），用例一律以 `rows.append(` 起头，按此行计数。
    sc = os.path.join(root, 'scripts', 'selftest_config.py')
    if os.path.exists(sc):
        counts['selftest_config.py'] = len(re.findall(r'(?m)^\s*rows\.append\(', read(sc)))
    # v5.37.6：gate 统计的判读自测。它断言的是**结论字符串**（停滞 / 收敛 / 恶化），
    # 不是数字——结论错比数字错更危险，所以这份也得登记进对账。
    sg = os.path.join(root, 'scripts', 'selftest_gates_stats.mjs')
    if os.path.exists(sg):
        counts['selftest_gates_stats.mjs'] = len(re.findall(r'(?m)^check\(', read(sg)))
    # v5.37.11：audit_all 回归。它是文档里的「交付前首选一条命令」，
    # 之前一份测试都没有——最被依赖的脚本反而是唯一没上锁的。
    sa = os.path.join(root, 'scripts', 'selftest_audit_all.py')
    if os.path.exists(sa):
        counts['selftest_audit_all.py'] = len(re.findall(r'(?m)^\s*case\(', read(sa)))
    # v5.37.13：扫描器自己也要被数。**它的夹具字符串里不能出现行首 `case(`**，
    # 否则会把临时树的用例也算进自己的组数（正则按行首数，不区分是否在字符串里）。
    ss = os.path.join(root, 'scripts', 'selftest_scan_conflicts.py')
    if os.path.exists(ss):
        counts['selftest_scan_conflicts.py'] = len(re.findall(r'(?m)^\s*case\(', read(ss)))
    # v5.52.0：环境医生自测（`^check(` 计数，与 gates_stats 同款——新增自测不登记，
    # 文档里的组数就成了没人校验的自述数字）。
    sce = os.path.join(root, 'scripts', 'selftest_check_env.mjs')
    if os.path.exists(sce):
        counts['selftest_check_env.mjs'] = len(re.findall(r'(?m)^check\(', read(sce)))
    # v5.53.0：渲染台账自测（`^case(` 计数，与 audit_risk 同款）。
    srl = os.path.join(root, 'scripts', 'selftest_render_ledger.py')
    if os.path.exists(srl):
        counts['selftest_render_ledger.py'] = len(re.findall(r'(?m)^case\(', read(srl)))
    # v6.2.0：教训库聚合自测（case( 行计数，同 boundary/audit_risk/render_ledger 法）。
    # 新自测不登记，「文档写 N 组」就成了没人校验的自述数字。
    sla = os.path.join(root, 'scripts', 'selftest_lessons_aggregate.py')
    if os.path.exists(sla):
        counts['selftest_lessons_aggregate.py'] = len(re.findall(r'(?m)^case\(', read(sla)))
    # v6.5.0：连续性锁对账自测（^\s*case( 行计数——用例在 try/finally 内是缩进的，
    # 与 audit_all/scan_conflicts 同款宽匹配）。
    slk = os.path.join(root, 'scripts', 'selftest_audit_continuity_lock.py')
    if os.path.exists(slk):
        counts['selftest_audit_continuity_lock.py'] = len(re.findall(r'(?m)^\s*case\(', read(slk)))
    if not counts:
        return ['K7 selftest 源码缺席，跳过（跳过不是通过）']

    files = []
    for n in ('SKILL.md', 'README.md'):
        p = os.path.join(root, n)
        if os.path.exists(p):
            files.append(p)
    ref = os.path.join(root, 'references', 'README-索引.md')
    if os.path.exists(ref):
        files.append(ref)

    for p in files:
        for ln, line in enumerate(read(p).split('\n'), 1):
            # ⚠️ 文档里别写「K7 组数」这种字样：`(\d+)\s*组` 会把「7 组」当成声称值，
            #    和脚本名只隔几个字，于是报一条假错（v5.37.13 实测踩过，写的是
            #    「K7 组数（正反两向）」）。要提这个模式就写「K7 用例数」。
            # 数字必须**紧邻**它的脚本名，否则不判——
            # 一句话里串着写三个「脚本 + 数字」时，按行归属必然张冠李戴（v5.30.0 实测踩过）。
            # v5.37.1 修正：窗口从固定 20 字改成「按行内出现的自测名个数」定宽。
            # 原因：索引里写「`selftest_check_prompt.mjs`：check_prompt.mjs 的 **86 组**…」，
            # 名字与数字隔了 25 字，固定 20 字窗口直接漏判——**对账器的窗口太窄，
            # 等于挑着对账**。行内只出现一个自测名时放宽到 60 字（不存在张冠李戴的可能），
            # 出现多个时仍用 20 字。
            names_on_line = [n for n in counts if n in line]
            width = 60 if len(names_on_line) == 1 else 20
            for name, cnt in counts.items():
                for hit in re.finditer(re.escape(name), line):
                    s0 = max(0, hit.start() - width)
                    s1 = min(len(line), hit.end() + width)
                    for m in re.finditer(r'(\d+)\s*组', line[s0:s1]):
                        claimed = int(m.group(1))
                        if claimed != cnt:
                            warns.append('K7 %s:%d 声称「%s」是 %d 组，源码实际 %d 组 —— '
                                         '改自测后同步文档，或确认文档是不是旧值'
                                         % (os.path.basename(p), ln, name, claimed, cnt))
    return warns


def k8_skip_kind(root):
    """K8：按**包内容**条件装配的门，跳过时必须显式给 `kind=`（v5.37.9）。

    来源是一次真实事故（v5.37.8 修的）：`R. 镜头裁定` 在「包内没有镜头裁定表」时
    报「未查 · 缺输入」，于是**没写那张表的包永远拿不到「全部通过」**（退出码恒 2）。
    不可达的信号没人追，最后连真问题一起被忽略。

    这类错误不是「某条消息写错」，而是「新增一道按内容决定跑不跑的门时，忘了回答
    『这算不算没查』」——**默认值会替他回答，答案还是错的**。所以这里用语法把它拦住。

    判定法（只认语法，不猜语义）：
      找 `if <cond>: … else: _skip_section(…)`，若 `<cond>` 里**没有** `args.<attr>`，
      说明这个条件不是「用户给没给参数」，而是「包 / 文件内容满不满足」——
      这种跳过有可能是不适用，必须显式 `kind=`。
      条件里带 `args.*` 的是缺参数类，默认「缺输入」本来就对，豁免。

    只查 `_skip_section`（门级装配），不查门函数内部的 `_skip_msg`：
    后者那些「未配置版本互斥词表」之类确实是缺输入（registry 在、只是没配规则），
    一并查会变成噪声——**扫描器的噪声比它要查的问题更费人**（K3 当年的教训）。
    """
    p = os.path.join(root, 'scripts', 'audit_project.py')
    if not os.path.exists(p):
        return ['K8 audit_project.py 缺席，跳过（跳过不是通过）']
    try:
        tree = ast.parse(io.open(p, encoding='utf-8').read())
    except SyntaxError as e:  # noqa: BLE001
        return ['K8 无法解析 audit_project.py：%s' % e]

    unparse = getattr(ast, 'unparse', lambda n: '<条件>')
    out = []
    seen = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.If):
            continue
        # 条件里出现过 args.xxx ⇒ 这是「用户给没给参数」，不是按内容装配
        if any(isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name)
               and n.value.id == 'args' for n in ast.walk(node.test)):
            continue
        for branch in (node.body, node.orelse):
            for stmt in branch:
                for c in ast.walk(stmt):
                    # v5.37.12：`_skip_msg` 也纳入——门函数内部那一层同样会「替人回答」。
                    # 外层 if 与内层 if 会各命中一次同一个调用，按行号去重。
                    if not (isinstance(c, ast.Call) and isinstance(c.func, ast.Name)
                            and c.func.id in ('_skip_section', '_skip_msg')):
                        continue
                    if any(k.arg == 'kind' for k in c.keywords):
                        continue
                    if c.lineno in seen:
                        continue
                    seen.add(c.lineno)
                    out.append(
                        'K8 audit_project.py:%d `%s` 的条件不是「参数给没给」'
                        '（`%s`），必须显式 kind= 声明这是「缺输入」「缺产物」还是「不适用」——'
                        '默认值会替你答，答案是「缺输入」；答错了会让部分包永远拿不到'
                        '「全部通过」（v5.37.8 的教训）'
                        % (c.lineno, c.func.id, unparse(node.test)[:48]))
    return out


K9_SKIP = {'外部Skill吸收裁决总表.md', '待办路线图.md', '术语对照表_glossary.md'}
K9_TIER3 = re.compile(r'③\s*社区实测')
K9_PASS = re.compile(r'来源|出处|未存档|待复访|口径图例|口径三态（v5')


def k9_tier3_source(files):
    """③ 社区实测行必须有可回访来源（v6.1.0 · C22）。

    只查行级标记，不做语义判断：行内含「来源/出处/未存档/待复访/口径图例」任一即放行；
    「口径三态（v5.x」版本标注式图例行是定义不是数值声明，同样放行。
    裁决总表（裁决记录本身就是溯源）、待办路线图（变更叙事）、glossary（词条定义）整文件豁免。
    """
    warns = []
    for p in files:
        if os.path.basename(p) in K9_SKIP:
            continue
        for i, line in enumerate(read(p).split('\n'), 1):
            if K9_TIER3.search(line) and not K9_PASS.search(line):
                warns.append('K9 %s:%d 「③ 社区实测」无来源标记（需 来源/出处/未存档/待复访/口径图例）'
                             % (os.path.basename(p), i))
    return warns


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if not os.path.exists(os.path.join(root, 'SKILL.md')):
        print('用法：python scripts/scan_conflicts.py [skill根目录]')
        return 2

    files = live_files(root)
    errs = []
    warns = []
    errs += k1_fences(files)
    errs += k6_claims(root)
    warns += k2_tables(files)
    warns += k3_numbers(files)
    warns += k4_aliases(files)
    warns += k5_skip(root)
    warns += k7_selftest_count(root)
    warns += k8_skip_kind(root)
    warns += k9_tier3_source(files)

    print('\nliqi 冲突模式扫描 —— %s' % root)
    print('扫描文件 %d 份（已排除 CHANGELOG 与全景梳理：历史留档）\n' % len(files))
    for e in errs:
        print('  ❌ ' + e)
    for w in warns:
        print('  ⚠️  ' + w)
    if not errs and not warns:
        print('  ✅ 九个模式全部干净\n')
    print('\n合计：%d ERROR / %d WARN\n' % (len(errs), len(warns)))
    return 1 if errs else 0


if __name__ == '__main__':
    sys.exit(main())
