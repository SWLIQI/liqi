#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
国内平台（即梦 / 豆包 / 可灵 / Dreamina）内容审核风险扫描。

作用：在生成之前预判哪些镜会被审核拦截，避免"跑十次全被拒"的浪费。
只扫**可复制正文**（自动排除 `>` 说明行与 `#` 参数行），
因为只有正文会被真正送进模型与审核。

用法：
  python audit_risk.py <提示词包.md> [--shot 1,2,3,5b] [--detail]

  --shot   只扫指定镜号，逗号分隔（如只查引子：--shot 1,2,3,4,5,5b）
  --detail 打印逐词明细

风险分 = Σ(词等级 × 出现次数)。等级：3=极高（几乎必拦）2=高（写实下必拦）1=中。
参考阈值：单镜 ≥20 大概率被拦；≥50 几乎必拦。

退出码：0 = 无触发；1 = 有 🔴 极高词；2 = 只有 🟠/🟡。
"""
import argparse
import re
import sys

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
    # 编号兼容三种面：`镜 N`（老李分镜面）／`段 N`（liqi 整合段面）／`U01`（MiniMax H3 面）。
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
    return out


BODY_END_RES = [
    re.compile(r'^Must\s*not', re.I),
    re.compile(r'^(?:#|【参数】)\s*(duration|ratio|输出规格|后期)'),
    re.compile(r'^——\s*以下不进正文'),
    re.compile(r'^技术规格[：:]'),
]


def body_of(block):
    """
    只取可复制正文 = 第一个代码块围栏内的内容。

    提示词正文都在 ``` 里，第一个围栏闭合即正文结束。之后的内容（跨镜说明、
    对照表、文档注释）不算正文，不该参与风险扫描与台词比对。

    兼容无围栏的写法：没有围栏时退化为「到 Must not / 参数行为止」。
    """
    out, in_code, seen_fence = [], False, False
    for l in block.split('\n'):
        if l.strip() == '```':
            seen_fence = True
            if in_code:
                break          # 第一个代码块闭合 → 正文结束
            in_code = True
            continue
        if any(r.match(l) for r in BODY_END_RES):
            break
        out.append(l)
    # 无围栏时上面的循环已按 BODY_END_RES 截断；有围栏但一直没闭合也按截断处理
    return '\n'.join(out)


def main():
    ap = argparse.ArgumentParser(description='国内平台内容审核风险扫描')
    ap.add_argument('pkg')
    ap.add_argument('--shot', help='只扫指定镜号，逗号分隔，如 1,2,3,5b')
    ap.add_argument('--detail', action='store_true', help='打印逐词明细')
    args = ap.parse_args()

    text = open(args.pkg, encoding='utf-8').read()
    shots = split_shots(text)

    if args.shot:
        want = set(x.strip() for x in args.shot.split(','))
        shots = [s for s in shots if s[0] in want]

    rows = []
    for num, title, block in shots:
        b = body_of(block)
        hits = [(w, lv, why, b.count(w)) for w, lv, why in RISK if w in b]
        if hits:
            rows.append((sum(lv * c for _, lv, _, c in hits), num, title, hits))
    rows.sort(reverse=True, key=lambda r: r[0])

    print('=' * 78)
    print('内容审核风险扫描（即梦 / 豆包 / 可灵）：%s' % args.pkg.split('/')[-1])
    print('镜数 %d ｜ 触发 %d 镜' % (len(shots), len(rows)))
    print('=' * 78)

    if not rows:
        print('\n✅ 无可复制正文触发任何高危词。')

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
    if top >= 3:
        print('存在 🔴 极高危词 —— 写实风格下几乎必拦，建议换风格或全词替换。')
        return 1
    if rows:
        print('仅有 🟠/🟡 词 —— 写实下仍有风险，建议配合降冲击手段（雾 / 暗部 / 前景遮挡）。')
        print()
        print('下一步必做：给每一拍配镜头手法（画外 / 前景遮挡 / 局部特写 / '
              '逆光暗部轮廓 / 空镜承接），换词不算完。')
        print('手法清单见 references/质控层_门禁与过审.md §6.3；'
              '画面表述另跑 scripts/audit_literal.py。')
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
