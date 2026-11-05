#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
selftest_audit_risk.py —— audit_risk.py 的击穿用例自测（v5.37.3 新建）

为什么补这个（此前 **零自测**）：
  这是唯一一个会直接改判「这个包能不能投」的脚本（退出码 1 = 几乎必拦），
  却一次都没被自测覆盖过。它上一版还有个真缺陷：

    `>` 说明行没被排除 —— 文档写着「自动排除 `>` 说明行与 `#` 参数行」，
    代码里一行过滤都没有。更麻烦的是「算不算」取决于位置：
    说明行在 ``` 围栏**前**会被算进正文（风险分虚高、退出码 1），
    同一句话在围栏**后**就不算。**同一份注释换个位置，结论就变。**

  C2 / C3 就是这个缺陷的回归锁：同一句「跟血有关」的说明行，放围栏前后都必须 0 分。

跟 selftest_boundary.py 一样走子进程（退出码本身是判据的一部分），
包写入临时目录，跑完清理。

用法：python scripts/selftest_audit_risk.py
退出码：0 = 全过；1 = 有败；2 = 找不到 python / 脚本
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
RISK = os.path.join(HERE, 'audit_risk.py')

CASES = []


def case(name, pkg, rc=None, score=None, has=None, lacks=None, args=()):
    """rc=期望退出码；score=期望合计风险分；has/lacks=输出里必须有/不能有的串"""
    CASES.append(dict(name=name, pkg=pkg, rc=rc, score=score,
                      has=list(has or []), lacks=list(lacks or []), args=list(args)))


# ── 夹具：一个最小镜块（无围栏 = liqi 现行标准格式）
def shot(num=1, dur=8, body='中景，固定机位。甲坐在沙发上抬头看向窗外。', tail=''):
    return ('镜%d｜测试（%ds）\n场景：客厅（暖白）｜人物：甲\n'
            '整体风格：甲穿深色便装。\n%s\n%s' % (num, dur, body, tail))


# C1 控制组：干净正文 → 0 分、退出码 0
case('C1 干净包 → 0 分 / 退出码 0', shot())

# C2 / C3 同一句说明行，换位置结论必须一样（D1 回归锁）
QUOTE = '> 说明：这一镜的隐喻跟血有关，正文里不要写这个字。'
case('C2 `>` 说明行在围栏前 → 不算正文（0 分）',
     shot(body='```\n中景，固定机位。甲坐在沙发上抬头。\n```', tail=QUOTE),
     rc=0, score=0)
case('C3 `>` 说明行在围栏后 → 不算正文（0 分）',
     shot(body='```\n中景，固定机位。甲坐在沙发上抬头。\n```\n' + QUOTE),
     rc=0, score=0)

# C4 / C5 真高危词：围栏内、无围栏两种格式都要拦住（退出码 1）
case('C4 围栏内正文含「血」→ 3 分 / 退出码 1',
     shot(body='```\n近景。墙面上一道血迹顺砖缝往下淌。\n```'), rc=1, score=3)
case('C5 无围栏正文含「血」→ 3 分 / 退出码 1',
     shot(body='近景。墙面上一道血迹顺砖缝往下淌。'), rc=1, score=3)

# C6 文档层：# 标题行、参数行、表格行、Must not 都不是正文
case('C6 `#` 说明行含高危词 → 不算正文',
     shot(tail='# 说明：血、内脏、尸体都别写\n# duration: 8s | # ratio: 16:9'), rc=0, score=0)
case('C7 表格行含高危词 → 不算正文',
     shot(tail='| 禁忌词 | 血 / 内脏 |\n| duration | 8s |'), rc=0, score=0)
case('C8 `Must not：血、内脏` → 禁令不算内容',
     shot(body='中景。甲坐下。\nMust not：可读文字、血、内脏'), rc=0, score=0)

# C9 / C10 / C11 风险分公式（等级 × 次数）与档位
case('C9 L2 词（伤口）→ 2 分 / 退出码 2',
     shot(body='近景。袖口下露出一道伤口。'), rc=2, score=2)
case('C10 L1 词（剪刀）→ 1 分 / 退出码 2',
     shot(body='近景。桌上一把剪刀反着光。'), rc=2, score=1)
case('C11 同一词两次 → 等级 × 次数',
     shot(body='中景。先是一道血迹，接着血迹蔓延到门框。'), rc=1, score=6)

# C12 台词算正文：台词里的高危词是真会送进模型的（与 audit_literal 的差异点）
case('C12 台词行含「血」→ 算正文（2.5 面 `{}` 写法）',
     shot(body='近景。甲盯着门缝。乙（压低声）：「你手上是血。」'), rc=1, score=3)

# C13~C15 假绿防线：什么都没查 ≠ 通过
case('C13 正文全在参数行之后 → 报 E-NO-BODY-SCANNED / 退出码 2',
     '镜1｜测试（8s）\n—— 以下不进正文 ——\n中景。血迹顺着墙淌。\n# duration: 8s\n',
     rc=2, has=['E-NO-BODY-SCANNED'])
case('C14 段头没有时长（认不出）→ 报 E-NO-BODY-SCANNED / 退出码 2',
     '镜1｜测试\n中景。血迹顺着墙淌。\n', rc=2, has=['E-NO-BODY-SCANNED'])
case('C15 `--shot 9` 把镜全滤掉 → 报 E-NO-BODY-SCANNED / 退出码 2',
     shot(), rc=2, has=['E-NO-BODY-SCANNED'], args=['--shot', '9'])

# C16 资产包：条目头不带时长，走「资产 CHAR-01｜…」分支；风险词同样要拦
case('C16 资产包（资产 CHAR-01｜…）能识别单元并计分',
     '资产 CHAR-01｜老陈（4 View 角色资产板）\n```\n全身四视图。右臂有一道结痂的伤口。\n```\n'
     '资产 PROP-02｜铁皮手电（道具卡）\n```\n金属外壳，灯罩有划痕。\n```\n',
     rc=2, score=2)

# C17 多镜：分高的镜排前面（总控读的是「哪个镜最该改」）
case('C17 多镜按风险分排序（高在前）',
     shot(num=1, body='中景。桌上一把剪刀。')
     + '\n' + shot(num=2, body='近景。墙上血迹未干。'),
     rc=1, score=4)


def codes(out):
    return set(re.findall(r'\b(E-[A-Z][A-Z0-9-]*)\b', out))


def main():
    if not os.path.exists(RISK):
        print('找不到 audit_risk.py：%s' % RISK)
        return 2

    tmp = tempfile.mkdtemp(prefix='liqi_risk_')
    passed, failed = 0, []
    try:
        for c in CASES:
            pkgp = os.path.join(tmp, re.sub(r'[^\w]', '_', c['name']) + '.md')
            io.open(pkgp, 'w', encoding='utf-8', newline='').write(c['pkg'])
            p = subprocess.Popen([P, RISK, pkgp, '--no-log'] + c['args'],
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            out = p.communicate()[0].decode('utf-8', 'replace')
            rc = p.returncode

            m = re.search(r'合计风险分：(\d+)', out)
            score = int(m.group(1)) if m else None

            ok, why = True, []
            if c['rc'] is not None and rc != c['rc']:
                ok = False
                why.append('退出码 %s（应 %s）' % (rc, c['rc']))
            if c['score'] is not None and score != c['score']:
                ok = False
                why.append('合计风险分 %s（应 %s）' % (score, c['score']))
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
