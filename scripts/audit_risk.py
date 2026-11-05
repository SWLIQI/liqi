#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
国内平台（即梦 / 豆包 / 可灵 / Dreamina）内容审核风险扫描。

作用：在生成之前预判哪些镜会被审核拦截，避免"跑十次全被拒"的浪费。
只扫**可复制正文**（自动排除 `>` 说明行与 `#` 参数行），
因为只有正文会被真正送进模型与审核。

用法：
  python audit_risk.py <提示词包.md> [--shot 1,2,3,5b] [--detail] [--no-log]

  --shot    只扫指定镜号，逗号分隔（如只查引子：--shot 1,2,3,4,5,5b）
  --detail  打印逐词明细
  --no-log  本次不写 .gates.jsonl（默认写，写失败静默跳过，不影响退出码）

风险分 = Σ(词等级 × 出现次数)。等级：3=极高（几乎必拦）2=高（写实下必拦）1=中。
参考阈值：单镜 ≥20 可能被拦；≥50 大概率被拦。词级硬闸另有退出码：
出现等级 3（几乎必拦）词退 1，只有中高危词退 2。

退出码：0 = 无触发；1 = 有 🔴 极高词；2 = 只有 🟠/🟡。
"""
import argparse
import re
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gates_log import append_gate_log, log_disabled

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# (词, 等级, 原因)
RISK = [
    # 极高：几乎必拦
    ('血', 3, '血液/血腥'),
    ('脂肪', 3, '人体组织'),
    ('肌肉纹理', 3, '人体组织特写'),
    ('肌肉', 3, '人体组织'),
    ('声带', 3, '器官暴露'),
    ('内脏', 3, '器官'),
    ('尸体', 3, '死亡内容'),
    ('验尸', 3, '死亡/法医'),
    ('停尸房', 3, '死亡场所'),
    ('剥了皮', 3, '暴力伤害'),
    ('剥皮', 3, '暴力伤害'),
    ('被剥', 3, '暴力伤害'),
    ('碎尸', 3, '暴力'),
    ('肢解', 3, '暴力'),
    ('屠宰', 3, '暴力'),
    # 高：写实 + 该词基本必拦，风格化后可能过
    ('骨骼', 2, '人体残骸'),
    ('骷髅', 2, '恐怖意象'),
    ('腐蚀', 2, '伤害类'),
    ('撕扯', 2, '暴力'),
    ('刀口', 2, '伤害痕迹'),
    ('伤口', 2, '伤害痕迹'),
    ('黏腻', 2, '不适联想'),
    ('黏膜', 2, '人体组织'),
    ('人皮', 2, '核心高危词'),
    ('无皮', 2, '核心高危词'),
    ('眼洞', 2, '恐怖意象'),
    ('胚胎', 2, '生物组织，部分平台敏感'),
    ('怪物', 2, '恐怖'),
    ('腐烂', 2, '不适'),
    # 中：低危，主要看组合
    ('塌瘪', 1, '低危，常用于描述空壳/空衣形态'),
    ('空壳', 1, '低危，常用于描述空壳/空衣形态'),
    ('凝胶', 1, '低危'),
    ('剪刀', 1, '利器，单独出现一般可过'),
    ('咕噜', 1, '低危'),
    # 注：「蜕」不列为风险词——它是替换「剥」的**推荐替代词**（蜕下 / 脱下），
    # 标成风险会与过审指引自相矛盾。同理不列：旧衣、空衣、蝉蜕、皮壳、赤红躯体。
]

LEVEL_NAME = {3: '🔴 极高', 2: '🟠 高', 1: '🟡 中'}


def split_shots(text):
    # 与 check_prompt.mjs / audit_project.py 对齐：
    # 「镜」后允许多个空白；时长括号允许带副标题「（15s · 动作）」。
    # 旧版要求「（\d+s）」括号内只有秒数，带副标题的镜块会整块漏扫（实测报「镜数 0」）。
    # 编号兼容三种面：`镜 N`（分镜面）／`段 N`（liqi 整合段面）／`U01`（MiniMax H3 面）。
    # 标题里常含场景括注（「场 1 · 某处庙宇前殿（日）· 拾香（14s）」），
    # 旧的 `[^\n（]*?` 会卡在第一个「（」上，H3 面 57 单元只认出 6 个（实测），
    # 且残留的「0 触发」会被误读成「过审通过」。故取标题行内**最后一个**秒数括注。
    out = []
    for p in re.split(r'\n(?=#{0,6}\s*(?:镜|段|U)\s*\d+[a-z]?｜)', text):
        head = p.split('\n', 1)[0]
        m = re.match(r'^#{0,6}\s*(?:镜|段|U)\s*(\d+[a-z]?)｜(.*)$', head)
        if not m:
            continue
        durs = list(re.finditer(r'（\s*(\d+(?:\.\d+)?)\s*s[^）]*）', m.group(2)))
        if not durs:
            continue
        last = durs[-1]
        out.append((m.group(1), m.group(2)[:last.start()].strip(), p))
    if out:
        return out
    # 资产提示词包（v4.7.6）：出图提示词同样进平台审核，也要按单元扫。
    # 资产条目的头是「资产 CHAR-01｜某角色（4 View 角色资产板）」，不带时长括注，
    # 上面那条镜号分支一个都匹配不上——不补这条，资产包会整包零命中。
    # 条目头允许带中文序号（「一 资产 CHAR-01｜某角色」）
    PRE = r'#{0,6}\s*(?:[一二三四五六七八九十]+[、.．]?\s*)?'
    for p in re.split(r'\n(?=' + PRE + r'(?:资产|角色|场景|道具)\s*[A-Za-z0-9-]*\s*[｜|])', text):
        head = p.split('\n', 1)[0]
        m = re.match(r'^' + PRE + r'(?:资产|角色|场景|道具)\s*([A-Za-z0-9-]*)\s*[｜|]\s*(.*)$', head)
        if not m:
            continue
        out.append((m.group(1) or '资产', m.group(2).strip()[:24], p))
    return out


# v5.37.3：正文定义收进 scripts/body_rules.py（此前本文件只做截断、不逐行过滤，
# 于是 `>` 说明行被当成正文扫——文档写着「自动排除 `>` 说明行」，代码里一行都没有）。
# 判定口径：只排文档层/容器层；台词、声音层、场景行、时间线一律算正文。
from body_rules import body_of  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description='国内平台内容审核风险扫描')
    ap.add_argument('pkg')
    ap.add_argument('--shot', help='只扫指定镜号，逗号分隔，如 1,2,3,5b')
    ap.add_argument('--detail', action='store_true', help='打印逐词明细')
    ap.add_argument('--no-log', action='store_true',
                    help='本次不写 .gates.jsonl（默认写，写失败静默跳过）')
    args = ap.parse_args()

    try:
        text = open(args.pkg, encoding='utf-8').read()
    except (OSError, UnicodeDecodeError) as e:
        print('E-INPUT: 提示词包读不了：%s' % e)
        sys.exit(2)
    shots = split_shots(text)

    if args.shot:
        want = set(x.strip() for x in args.shot.split(','))
        shots = [s for s in shots if s[0] in want]

    rows = []
    body_chars = 0
    for num, title, block in shots:
        b = body_of(block)
        body_chars += len(b.strip())
        hits = [(w, lv, why, b.count(w)) for w, lv, why in RISK if w in b]
        if hits:
            rows.append((sum(lv * c for _, lv, _, c in hits), num, title, hits))
    rows.sort(reverse=True, key=lambda r: r[0])

    print('=' * 78)
    print('内容审核风险扫描（即梦 / 豆包 / 可灵）：%s' % args.pkg.split('/')[-1])
    print('镜数 %d ｜ 触发 %d 镜' % (len(shots), len(rows)))
    print('=' * 78)

    # ── 假绿防线（v4.7.6）──────────────────────────────────────────────
    # 空文件 / 段头没被认出 / 正文全被 BODY_END_RES 截断 → 抽到 0 字符 → 零命中 →
    # 报「✅ 无可复制正文触发任何高危词」。这是门最危险的状态：什么都没查却说通过。
    if body_chars == 0:
        print('\n❌ 抽不到任何可复制正文（合计 0 字符）—— 本门这一次什么都没查，不能算通过。'
              '\n   ——E-NO-BODY-SCANNED：退出码 2 在本脚本里另有一义（仅中高危词），'
              '靠这行字与门上日志区分')
        print()
        if not shots:
            print('   没识别到镜块。认的是「镜 N｜标题（Ns）」这类段头，标题里要带时长；')
            print('   H3 六段式包（[Shot N]）本门不认，先转成段头式。')
        elif args.shot:
            print('   识别到 %d 个镜，但被 --shot %s 全滤掉了。对照实际镜号重给。'
                  % (len(shots), args.shot))
        else:
            print('   识别到 %d 个镜，但正文抽取结果为空：检查是不是整包都在 ``` 围栏外，'
                  % len(shots))
            print('   或每一行都落在 Must not / # 参数行 /「—— 以下不进正文」之后。')
        print()
        print('   自查：随便挑一个镜，看它的可复制正文是不是真的被包在 ``` 里。')
        if not log_disabled(sys.argv):
            append_gate_log('audit_risk.py', args.pkg, 2,
                            [{'code': 'E-NO-BODY-SCANNED', 'level': 'error',
                              'where': '(包级)', 'msg': '抽不到可复制正文，本门未实际执行'}])
        print('=' * 78)
        return 2

    if not rows:
        print('\n✅ 无可复制正文触发任何高危词。（实扫 %d 字符）' % body_chars)

    for score, num, title, hits in rows:
        words = '、'.join(sorted({w for w, _, _, _ in hits}))
        flag = '⚠️  大概率被拦' if score >= 50 else ('⚠️  可能被拦' if score >= 20 else '')
        print('\n镜%-5s %-22s 风险分 %-5d %s' % (num, title[:20], score, flag))
        print('  %s' % words)
        print('  %s' % ('█' * min(score // 3, 24)))
        if args.detail:
            for w, lv, why, c in sorted(hits, key=lambda x: -x[1]):
                print('    %s %-12s ×%-3d %s' % (LEVEL_NAME[lv], w, c, why))

    total = sum(r[0] for r in rows)
    top = max((lv for _, _, _, hits in rows for _, lv, _, _ in hits), default=0)
    print('\n' + '=' * 78)
    print('合计风险分：%d' % total)
    code = 0
    if top >= 3:
        print('存在 🔴 极高危词 —— 写实风格下几乎必拦，建议换风格或全词替换。')
        code = 1
    elif rows:
        print('仅有 🟠/🟡 词 —— 写实下仍有风险，建议配合降冲击手段（雾 / 暗部 / 前景遮挡）。')
        print()
        print('下一步必做：给每一拍配镜头手法（画外 / 前景遮挡 / 局部特写 / '
              '逆光暗部轮廓 / 空镜承接），换词不算完。')
        print('手法清单见 references/质控层_门禁与过审.md §6.3；'
              '画面表述另跑 scripts/audit_literal.py。')
        code = 2

    # 门失败日志：按风险词计数（词码前缀「词:」，与格式规则码区分）
    if not log_disabled(sys.argv):
        word_issues = []
        for score, num, title, hits in rows:
            for w, lv, why, c in hits:
                word_issues.append({
                    'code': '词:' + w,
                    'level': 'error' if lv >= 3 else 'warn',
                    'where': '镜%s' % num, 'msg': why,
                })
        append_gate_log('audit_risk.py', args.pkg, code, word_issues)
    return code


if __name__ == '__main__':
    sys.exit(main())
