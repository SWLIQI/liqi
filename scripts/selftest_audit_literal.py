#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
selftest_audit_literal.py —— audit_literal.py 的击穿用例自测（v5.37.3 新建）

为什么补这个（此前 **零自测**）：
  490 行、40+ 条正则、13 个类别，一次都没被自测覆盖过。它是「不漏」型门
  （自述：定位是不漏，不是不误报），这类型最怕的是**静默漏判**——报 ✅ 而没查。

补测时抓到两个真缺陷（都是「该松的地方不松」）：
  D1  英文规则区分大小写 —— `so white.` 命中、`So white.` 不命中；
      `nothing moves` 命中、`Nothing moves` 不命中。
      H3 面正文是正常英文句子，句首必然大写 ⇒ 每条英文规则只在句中生效。
      修法：RULES_C 统一 re.IGNORECASE（中文规则无大小写字符，空操作）。
  D2  词形缺第三人称 —— M3 写死 `spread|spreading`，最常见的 `spreads` 不在表里；
      M1 只收 `moves?|moved`，`moving` 不在。修法：改词族 `(widen|spread|expand)(s|ing|ed)?`、
      `(chang\\w*|mov\\w*|shift\\w*)`。
  另有一处与 audit_risk 同款的「码号不进控制台」——假绿路径只把 E-NO-BODY-SCANNED
  写进 .gates.jsonl，用户屏幕上只有中文字，grep 码号找不到东西。已补。

覆盖口径（**不做「每条正则一正一反」**）：
  40+ 条正则逐条正反要 80+ 用例，且大半是同一条分支的重复。改为三个维度：
    维度一 类别覆盖：13 个类别（A B C D E F G H I J K S M）每类至少 1 条正例，
           同时验退出码分档（高危 A/D/F/K/M/S → 2；其余 → 1）。
    维度二 排除机制覆盖：is_body_line() 的每一类排除分支各 1 条反例。
           这是本脚本最独特的地方——它的 is_body_line() 比 audit_risk 更严
           （连台词行、声音层、卷尾纪律、风格串都排），**不能**并进 body_rules.py：
           台词一字不动、声音层里的听觉词是合法的，这是**判据需要**，不是口径分歧。
    维度三 口径边界：误报剔除表、F 豁免行、文末附文止扫、假绿防线三路。

  没覆盖到的：B/C/E/G/I/J/K/S 类里每条正则的**每一个**替选词。这类靠
  「同一条正则内替选词共享同一段上下文判据」，一个正例即可代表分支可达。

走子进程（退出码本身是判据的一部分），包写入临时目录，跑完清理。

用法：python scripts/selftest_audit_literal.py
退出码：0 = 全过；1 = 有败；2 = 找不到脚本
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
P = sys.executable
LIT = os.path.join(HERE, 'audit_literal.py')

CASES = []


def case(name, pkg, rc=None, n=None, cats=None, has=None, lacks=None, args=()):
    """rc=期望退出码；n=期望候选总数（0=必须干净）；cats=期望出现的类别字母集；
    has/lacks=输出里必须有/不能有的串"""
    CASES.append(dict(name=name, pkg=pkg, rc=rc, n=n,
                      cats=set(cats) if cats is not None else None,
                      has=list(has or []), lacks=list(lacks or []),
                      args=list(args)))


# ── 夹具：最小镜块（段头带时长，正文一行）
HEAD = '镜1｜测试（8s）\n场景：客厅（暖白）｜人物：甲\n'


def shot(body, head=HEAD, tail=''):
    return head + body + '\n' + tail


# ══════════════════════════════════════════════════════════════
# 维度一：13 个类别各一条正例（验「该抓的抓」+ 退出码分档）
# ══════════════════════════════════════════════════════════════
case('C1  A 程度评价「白得发光」→ 高危，退出码 2',
     shot('近景。墙面白得发光，整片墙都在冒。'), rc=2, cats={'A'})
case('C2  A 状态词「憔悴」→ 高危，退出码 2',
     shot('近景。女人面容憔悴，站在门边。'), rc=2, cats={'A'})
case('C3  B 孤句判断「院内很暗。」→ 一般，退出码 1',
     shot('院内很暗。'), rc=1, cats={'B'})
case('C4  C 画面比喻「像一块湿布一样」→ 一般，退出码 1',
     shot('近景。雾像一块湿布一样盖下来。'), rc=1, cats={'C'})
case('C5  D 空泛美学词「电影感」→ 高危，退出码 2',
     shot('中景。画面很有电影感。'), rc=2, cats={'D'})
case('C6  E 不可控时长「站了一会儿」→ 一般，退出码 1',
     shot('中景。他站了一会儿，没有说话。'), rc=1, cats={'E'})
case('C7  F 剪辑语「闪回」→ 高危，退出码 2',
     shot('中景。甲闪回三年前那场雨。'), rc=2, cats={'F'})
case('C8  G 模糊指代「某种东西」→ 一般，退出码 1',
     shot('近景。桌上放着某种东西。'), rc=1, cats={'G'})
case('C9  H 画面行听觉词「一片寂静中」→ 一般，退出码 1',
     shot('中景。一片寂静中，他推开门。'), rc=1, cats={'H'})
case('C10 I 神情评价「神情复杂」→ 一般，退出码 1',
     shot('近景。他神情复杂。'), rc=1, cats={'I'})
case('C11 J 文学化微动作「指尖轻颤」→ 一般，退出码 1',
     shot('近景。指尖轻颤。'), rc=1, cats={'J'})
case('C12 K 道具光效「玉佩泛光」→ 高危，退出码 2',
     shot('近景。玉佩在灯下泛光。'), rc=2, cats={'K'})
case('C13 S 伤情本体入画「伤口」→ 高危，退出码 2',
     shot('近景。袖口下露出一道伤口。'), rc=2, cats={'S'})
case('C14 M 否定式静止「都不变」→ 高危，退出码 2（静默失败类）',
     shot('景别不变。主体都不变，光也不变。'), rc=2, cats={'M'})

# C15 同一处被两条规则命中：跨类别各报一次（去重键是 行+类+词，不含类别之外的维度）
case('C15 同一处跨类别各报一次（「眼神空洞」= D + I）',
     shot('近景。他眼神空洞。'), rc=2, n=2, cats={'D', 'I'})

# ══════════════════════════════════════════════════════════════
# 维度二：is_body_line() 的排除分支（验「不该抓的不抓」）
# ══════════════════════════════════════════════════════════════
# 文档层六种行：全部含剪辑语，一行都不该扫
DOC_LAYER = (
    '# 说明：闪回、叠化都不要\n'
    '> 备注：本镜用了闪回\n'
    '| 项 | 值 |\n'
    '| 转场 | 叠化 |\n'
    '—— 以下不进正文 ——\n'
    '【参数】duration: 8s | 转场：慢放\n'
    '注：允许闪回\n'
)
case('X1 文档层六种行（# / > / 表格 / —— / 【参数】/ 注：）全不扫',
     shot(DOC_LAYER), rc=0, n=0, has=['实扫'])

# 声音层与台词行：这些行里的听觉词是合法的（台词一字不动，声音归四层混音）
SOUND = (
    '声音设计：环境层一片寂静，只有远处狗叫。\n'
    '环境层：室内极静，远方犬吠。\n'
    '乙（压低声）：「{你听见什么了，一片寂静里}」\n'
)
case('X2 声音层三行 + 台词行（{}）里的听觉词 → 不算正文',
     shot(SOUND), rc=0, n=0, has=['实扫'])

# 卷尾纪律条目与段间衔接说明：给剪辑看的，不进投喂正文
case('X3 卷尾纪律「3 铁律：不得出现闪回」+ 衔接注记 → 不扫',
     shot('3 铁律：不得出现闪回。\n衔接：上一镜末帧停在门口，用闪回承接。\n'),
     rc=0, n=0, has=['实扫'])

# 风格串行：固定串，不参与抽象判定
case('X4 风格串行（风格串：Where Winds Meet …）→ 不扫',
     shot('风格串：Where Winds Meet 水墨淡彩，无电影感。\n'), rc=0, n=0, has=['实扫'])

# 文末附文：命中即停止扫描，附文之后的镜块也不再扫
case('X5 文末附文止扫（附一后续内容整段不扫）',
     shot('中景。甲闪回三年前。\n'
          '附一、转场注记总表：镜1 闪回 → 镜2 叠化。\n'
          '镜2｜测试（8s）\n场景：门口｜人物：乙\n中景。慢放他回头。\n'),
     rc=2, n=1, cats={'F'})

# ══════════════════════════════════════════════════════════════
# 维度三：口径边界
# ══════════════════════════════════════════════════════════════
# 误报剔除表（FALSE_POSITIVE_PATTERNS）：命中落在合法语境里要放过
case('Y1 误报剔除「数字电影感」→ 不算 D 类 slop',
     shot('中景。画面是数字电影感的调子。'), rc=0, n=0, has=['实扫'])
case('Y2 误报剔除「皮肤松弛」→ 不算 A 类状态评价',
     shot('近景。她皮肤松弛。'), rc=0, n=0, has=['实扫'])

# F 豁免行：必锁 / 可见性 行里的「闪回」是素材复用说明，不算剪辑语进正文
case('Y3 必锁行豁免 F 类（素材复用「闪回」说明）',
     shot('必锁：素材复用「闪回」说明，不得改动。'), rc=0, n=0, has=['实扫'])

# ══════════════════════════════════════════════════════════════
# 假绿防线三路：什么都没查 ≠ 通过
# ══════════════════════════════════════════════════════════════
case('Z1 段头没有时长（认不出段）→ E-NO-BODY-SCANNED / 退出码 2',
     '镜1｜测试\n中景。甲闪回三年前。\n', rc=2, has=['E-NO-BODY-SCANNED'])
case('Z2 `--seg 镜9` 把正文全滤掉 → E-NO-BODY-SCANNED + 明确说是被 --seg 滤的',
     shot('中景。甲闪回三年前。'), rc=2,
     has=['E-NO-BODY-SCANNED', '被 --seg 全滤掉'], args=['--seg', '镜9'])
case('Z3 只有文档层（无段头）→ E-NO-BODY-SCANNED / 退出码 2',
     '# 参数行闪回\n> 说明叠化\n| a | b |\n', rc=2, has=['E-NO-BODY-SCANNED'])

# ══════════════════════════════════════════════════════════════
# 回归锁：D1 大小写 / D2 词形（改前全漏）
# ══════════════════════════════════════════════════════════════
case('R1 英文首字母大写照样命中（D1：So white. 与 so white. 同判）',
     shot('So white.\nso white.\n'), rc=2, n=2, cats={'A'})
case('R2 英文第三人称词形照样命中（D2：Nothing moves / spreads）',
     shot('Nothing moves in the room.\nThe shadow spreads across the floor.\n'),
     rc=2, n=2, cats={'M'})
case('R3 资产包（资产 CHAR-01｜…，无时长括注）能识别单元并计分',
     '资产 CHAR-01｜老陈（4 View 角色资产板）\n近景。他眼神空洞。\n',
     rc=2, n=2, cats={'D', 'I'})
case('R4 `--seg 镜2` 只扫指定镜（镜1 的词不进结果）',
     shot('中景。甲闪回三年前。')
     + '镜2｜测试（8s）\n场景：门口｜人物：乙\n中景。乙推门进来。\n',
     rc=0, n=0, has=['实扫'], args=['--seg', '镜2'])

# ══════════════════════════════════════════════════════════════
# 回归锁：D3 收束窗「定格」豁免（2026-10-29《无人出席的圆桌》实战暴露）
# 三条件放行**强制**「收束：末1s定格」，F 扫描器却把每段必写的定格全抓——
# 72 段包 ~200 条 F 候选九成是这一族。修法：只豁免「定格」这个词、且只在
# ±6 字语境命中收束/终态标记（收束/末1s/末拍/画面定格/静止）时——
# 「定格转场」「定格蒙太奇」类真剪辑语照抓。
# ══════════════════════════════════════════════════════════════
case('R5 收束窗定格豁免（长段声明 + 画面定格 + 全黑定格三形态不再报，定格转场仍报）',
     shot('【长段声明】30s · 节拍 5 · 收束：末1s定格（目光钉在水槽）\n'
          '末 1s 动作完全静止、画面定格在这张底片上。\n'
          '末 1s 全黑定格｜镜头：黑场\n'
          '定格转场进下一幕。\n'),
     rc=2, n=2, cats={'F'}, has=['定格转场'], args=['--detail'])
case('R6 同行第二个定格不在收束语境仍抓（画面定格豁免不外溢）',
     shot('人物站定，画面定格，随后进入定格蒙太奇回顾。\n'),
     rc=2, n=2, cats={'F'}, has=['蒙太奇'], args=['--detail'])


def main():
    if not os.path.exists(LIT):
        print('找不到 audit_literal.py：%s' % LIT)
        return 2

    tmp = tempfile.mkdtemp(prefix='liqi_lit_')
    passed, failed = 0, []
    try:
        for c in CASES:
            pkgp = os.path.join(tmp, re.sub(r'[^\w]', '_', c['name']) + '.md')
            io.open(pkgp, 'w', encoding='utf-8', newline='').write(c['pkg'])
            p = subprocess.Popen([P, LIT, pkgp, '--no-log'] + c['args'],
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            out = p.communicate()[0].decode('utf-8', 'replace')
            rc = p.returncode

            m = re.search(r'候选总数：(\d+)', out)
            n = int(m.group(1)) if m else 0
            cats = set(re.findall(r'[🔴🟡] ([A-Z])', out))

            ok, why = True, []
            if c['rc'] is not None and rc != c['rc']:
                ok = False
                why.append('退出码 %s（应 %s）' % (rc, c['rc']))
            if c['n'] is not None and n != c['n']:
                ok = False
                why.append('候选总数 %s（应 %s）' % (n, c['n']))
            if c['cats'] is not None and cats != c['cats']:
                ok = False
                why.append('类别 %s（应 %s）' % (sorted(cats) or '无', sorted(c['cats'])))
            for s in c['has']:
                if s not in out:
                    ok = False
                    why.append('输出缺「%s」' % s)
            for s in c['lacks']:
                if s in out:
                    ok = False
                    why.append('输出不该有「%s」' % s)

            if ok:
                passed += 1
                print('✅ %s' % c['name'])
            else:
                failed.append('%s：%s' % (c['name'], '；'.join(why)))
                print('❌ %s' % c['name'])
                print('   %s' % '；'.join(why))
                print('   ── 实际输出 ──')
                for l in out.strip().split('\n'):
                    print('   ' + l)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print('\n结果：%d 过 / %d 败' % (passed, len(failed)))
    for f in failed:
        print('  ✗ ' + f)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
