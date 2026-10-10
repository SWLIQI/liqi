#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""h3pkg_to_board_src.py — 把 MiniMax H3 面的提示词包映射成 build_board_lite.py 认的看板源 md

为什么需要这一层：
    H3 面的包结构是「〇 风格锚 → 〇.5 资产层 → 一 转场注记 → 二 连续性台账 → 三 逐镜 U01…」，
    而 build_board_lite.py 的输入契约是「## P0A · 创作基准 / ## P1 · 剧本 / ## P1 · 视听圣经 /
    ## P2 · 资产清单 / ## P2.5 · 资产出图提示词 / ## P4 · 投喂提示词」+ 每段一个 ```text 围栏
    + `[起-止秒]` 逐镜行。直接拿包去编译，57 个单元会全部报「未找到围栏投喂原文」
    「未解析到 [起-止秒] 逐镜时间戳行」，看板出得来但不可用。
    本脚本只做结构映射，**逐镜正文一个字不改**。

用法：
    python scripts/h3pkg_to_board_src.py <提示词包.md> [--script <剧本.txt>]
        [--assets <资产出图提示词.md>] [--out <看板源.md>] [--title <看板标题>]

    --script  源剧本 txt（可选）→ 填 P1 剧本层
    --assets  资产出图提示词条目 md（可选）→ 填 P2.5；格式：
                  ## <编码> · <名字>
                  （表格含「视图组织 / 图号 / 职责」三行，任意列序）
                  ```text
                  <生成 prompt 正文>
                  ```
              缺该文件时 P2.5 留空并给出提示（build_board_lite 会报 K-lite-4 WARN）。
    --out     默认 <包名>_看板源.md

产出后：python scripts/build_board_lite.py <看板源.md> --out <看板.html>

已知口径（照抄即可，不必每次都重推）：
    · 围栏正文 = 从单元标题到「—— 以下不进正文 ——」之间的六段，即真正可复制投喂的那段。
    · 逐镜行 = 从 detailed_description 里的 `[Shot N]` 与 `At MM:SS.mmm` 推；最后一条的
      终点取单元时长。没有时间码的 Shot 一律按 0 秒起算（H3 面通常 Shot 1 无码）。
    · 【画幅】【模型版本】是看板的 A/B 双锁，写在文件头一次即可；写在单元里会被吞进 meta，
      不会显示成卡片标签，所以单元里只用【时长】【场景】【参考素材】【交接】。
    · 文末的「四 全局制作纪律」进 P0A；「附一/附二」是交付记录，不进看板。
"""
import argparse
import io
import os
import re
import sys

# Windows 下 stdout 重定向到管道/文件时默认 cp936，本脚本会 print ⚠/❌，
# 不显式设 utf-8 会 UnicodeEncodeError。与其余 6 个脚本保持一致。
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

HEAD = re.compile(r'^#{0,6}\s*U(\d+)｜(.*?)(?:（(\d+)s）)?\s*$')
TC = re.compile(r'At (\d{2}):(\d{2})\.(\d{3})')


def parse_units(text):
    units, cur = [], None
    for l in text.splitlines():
        m = HEAD.match(l)
        if m:
            cur = {'num': m.group(1), 'title': m.group(2).strip(),
                   'dur': int(m.group(3)) if m.group(3) else None, 'lines': []}
            units.append(cur)
        elif cur is not None:
            cur['lines'].append(l)
    for u in units:
        body, i = [], 0
        while i < len(u['lines']):
            if u['lines'][i].strip().startswith('——'):
                break
            body.append(u['lines'][i])
            i += 1
        u['body'] = '\n'.join(body).strip('\n')
        u['params'] = [l.strip() for l in u['lines'][i:] if l.strip().startswith('#')]
    return units


def shots_of(u):
    """→ [{no,start,end,text}]；text 剥掉时间码前缀与 `the shot cuts to`，取首句、截 115 字。"""
    desc, grab = '', False
    for l in u['body'].splitlines():
        if l.startswith('detailed_description'):
            grab = True
            continue
        if grab:
            if re.match(r'^(overall_soundscape|non_diegetic_music)\s*:', l):
                break
            desc += l + '\n'
    marks = []
    for para in desc.split('[Shot '):
        n = para.split(']')[0].strip()
        if not n.isdigit():
            continue
        rest = para.split(']', 1)[1] if ']' in para else ''
        m = TC.search(rest)
        t = (int(m.group(1)) * 60 + int(m.group(2)) + int(m.group(3)) / 1000.0) if m else 0.0
        marks.append((int(n), t, rest))
    marks.sort()
    res = []
    for k, (n, t, rest) in enumerate(marks):
        end = marks[k + 1][1] if k + 1 < len(marks) else float(u['dur'] or 0)
        txt = re.sub(r'^\s*At \d{2}:\d{2}\.\d{3},\s*', '', rest).strip()
        txt = re.sub(r'^the shot cuts to\s*', '', txt).strip()
        txt = txt.split('. ')[0].strip().rstrip('.')
        if len(txt) > 115:
            txt = txt[:112].rstrip() + '…'
        res.append({'no': n, 'start': t, 'end': end, 'text': txt})
    return res


def grab(text, start_pat, stop_pat=r'^## '):
    """取区间，**不含**起始行；丢掉单独成行的 `---`（会渲染成多余分隔线）。"""
    out, on = [], False
    for l in text.splitlines():
        if not on:
            if re.search(start_pat, l):
                on = True
            continue
        if re.search(stop_pat, l):
            break
        out.append(l)
    while out and not out[-1].strip():
        out.pop()
    return '\n'.join(x for x in out if x.strip() != '---').strip('\n')


def grab_para(text, start_pat, stop_pat=r'^\s*$'):
    """取单段，**含**起始行；用于一行成段的条目（照起始行不取会得到空串）。"""
    out, on = [], False
    for l in text.splitlines():
        if not on:
            if re.search(start_pat, l):
                on = True
                out.append(l)
            continue
        if re.search(stop_pat, l):
            break
        out.append(l)
    return '\n'.join(out).strip('\n')


def parse_assets(path):
    """资产条目 md → [(code, name, view, img, duty, prompt)]"""
    if not path:
        return []
    text = io.open(path, encoding='utf-8').read()
    out, cur, in_fence = [], None, False
    for l in text.splitlines():
        if l.strip().startswith('```'):
            in_fence = not in_fence
            continue
        if in_fence:
            if cur is not None:
                cur['body'].append(l)
            continue
        m = re.match(r'^##\s+(.+)$', l)
        if m:
            head = m.group(1).strip()
            parts = [p.strip() for p in head.split('·')]
            cur = {'code': parts[0], 'name': parts[1] if len(parts) > 1 else '',
                   'view': '', 'img': '', 'duty': '', 'body': []}
            out.append(cur)
            continue
        if cur is not None and l.startswith('|') and '---' not in l:
            cells = [c.strip() for c in l.strip('|').split('|')]
            if len(cells) >= 2:
                k, v = cells[0], cells[1]
                if k == '视图组织':
                    cur['view'] = v
                elif k == '图号':
                    cur['img'] = v
                elif k == '职责':
                    cur['duty'] = v
    return [(a['code'], a['name'], a['view'] or '—', a['img'] or '—', a['duty'] or '—',
             '\n'.join(a['body']).strip()) for a in out if a['body']]


def main():
    ap = argparse.ArgumentParser(description='H3 提示词包 → 离线看板源 md')
    ap.add_argument('pkg')
    ap.add_argument('--script', default=None, help='源剧本 txt')
    ap.add_argument('--assets', default=None, help='资产出图提示词条目 md')
    ap.add_argument('--out', default=None)
    ap.add_argument('--title', default=None)
    args = ap.parse_args()

    pkg = io.open(args.pkg, encoding='utf-8').read()
    units = parse_units(pkg)
    if not units:
        print('❌ 没解析到任何单元——确认标题形如 `### U01｜场 1 · 某处（日）· 标题（14s）`。')
        return 1
    assets = parse_assets(args.assets)
    base = os.path.splitext(os.path.basename(args.pkg))[0]
    out_path = args.out or ('%s_看板源.md' % base)
    title = args.title or '%s · 分镜看板' % base

    P = ['# %s' % title, '', '【画幅】：16:9']
    mv = re.search(r'^#\s*model:\s*([^\n|]+)', pkg, re.M)
    P += ['【模型版本】：%s' % ((mv.group(1).strip() if mv else '未声明').replace('MiniMax-', 'MiniMax ')), '',
          '> 本看板由 `%s` 编译，md 是唯一真相；改稿请改 md 后重编译。' % os.path.basename(args.pkg)]
    if assets:
        P += ['> 资产出图提示词来自 `%s`。' % os.path.basename(args.assets)]
    P += ['']

    # P0A：文件头（第一个 ## 之前）的 【XXX】行整段收进来（三锁 / 全片规格 / 台词铁律 / …），
    # 再补两条本脚本算得出的（单元数与总时长）。
    P += ['## P0A · 创作基准', '', '| 项 | 内容 |', '|---|---|']
    head_meta = []
    for l in pkg.splitlines():
        if re.match(r'^##\s', l):
            break
        m = re.match(r'^【([^】]{1,12})】\s*(.*)$', l.strip())
        if m and m.group(2).strip():
            head_meta.append((m.group(1), m.group(2).strip()))
    for k, v in head_meta:
        P += ['| %s | %s |' % (k, v)]
    P += ['| 生成单元 | %d 条（U%s–U%s） |'
          % (len(units), units[0]['num'], units[-1]['num']),
          '| 全片时长 | %d 秒 |' % sum(u['dur'] or 0 for u in units),
          '| 参考素材上限 | 12 个 / 单元 |']
    disc = grab(pkg, r'^##\s*[一二三四五六七八九十]*[、.．]?\s*全局制作纪律')
    if disc:
        P += ['', disc]
    P += ['']

    # P1 剧本
    if args.script and os.path.isfile(args.script):
        P += ['## P1 · 剧本', '', io.open(args.script, encoding='utf-8').read().strip(), '']

    # P1 视听圣经
    bible = grab(pkg, r'^##\s*[〇零0][、.．]?\s*风格锚')
    layout = grab(pkg, r'^###\s*1[.．、]\s*4\s*View', r'^###\s*5[.．、]')
    if bible or layout:
        P += ['## P1 · 视听圣经', '', bible, '', layout, '']

    # P2 资产清单
    if assets:
        P += ['## P2 · 资产清单', '',
              '| 编码 | 名字 | 视图 | @图片N | 职责 |', '|---|---|---|---|---|']
        for code, name, view, img, duty, _ in assets:
            P += ['| %s | %s | %s | %s | %s |' % (code, name, view, img, duty)]
        P += ['']

    # 附：编号表与光照锚点（标题故意不落进 assets 区，否则会混表头）
    P += ['## 附一 · Subject 编号表与光照锚点', '',
          '| Subject 编号 | 主体 | 职责 |', '|---|---|---|']
    for line in grab(pkg, r'^###\s*5[.．、]\s*Subject', r'^#{2,3} ').splitlines():
        if re.match(r'^\|\s*Subject\s*\d+', line):
            P += [line]
    spk = grab_para(pkg, r'^说话人编号')
    if spk:
        P += ['', spk]
    P += ['', '| 锚点 | 时段 | 色温与光源 | 入射角 | 影子形态 | 人工光状态 |',
          '|---|---|---|---|---|---|']
    for line in grab(pkg, r'^\*\*光照锚点表', r'^#{2,3} ').splitlines():
        if re.match(r'^\|\s*LA-\d+', line):
            P += [line]
    for pat in (r'^同一场景跨时间必须可区分', r'^\*\*投喂铁律\*\*'):
        g = grab_para(pkg, pat)
        if g:
            P += ['', g]
    P += ['']

    # P2.5
    P += ['## P2.5 · 资产出图提示词', '']
    if assets:
        for code, name, view, img, duty, body in assets:
            P += ['### %s · %s · %s' % (code, name, view), '', '```text', body, '```', '']
    else:
        P += ['未提供资产出图提示词条目（--assets）。', '']

    # P4
    P += ['## P4 · 投喂提示词', '']
    n_shots = 0
    for u in units:
        P += ['### U%s · %s' % (u['num'], u['title']), '']
        P += ['【时长】：%ss' % u['dur']]
        sc = re.match(r'(场[^·]*·[^·]*)', u['title'])
        if sc:
            P += ['【场景】：%s' % sc.group(1).strip()]
        rf = next((p for p in u['params'] if re.match(r'#\s*refs', p)), '')
        if rf:
            m = re.search(r'refs:\s*(\d+)', rf)
            d = re.search(r'（(.+?)）', rf)
            if m:
                P += ['【参考素材】：%s 个%s' % (m.group(1), '（' + d.group(1) + '）' if d else '')]
        hd = next((p for p in u['params'] if '交接' in p), '')
        if hd:
            P += ['【交接】：%s' % re.sub(r'^#\s*交接[:：]\s*', '', hd)]
        # 包内单元正文可能已自带 ```text 围栏（写包时按可复制要求加过）：先剥掉，
        # 否则这里再包一层会出现连续两行 ```text，build_board_lite 配对失败，
        # 报「未找到围栏投喂原文」，看板镜头卡变空。
        body = u['body'].strip()
        if body.startswith('```text'):
            body = body[len('```text'):].lstrip('\n')
        if body.endswith('```'):
            body = body[:-3].rstrip()
        P += ['', '```text', body, '```', '']
        sh = shots_of(u)
        n_shots += len(sh)
        for s in sh:
            P += ['[%g-%g秒] Shot %d · %s' % (s['start'], s['end'], s['no'], s['text'])]
        P += ['']

    for pat, head in ((r'^##\s*[一二三四五六七八九十]*[、.．]?\s*转场注记', '## 一、转场注记总表'),
                      (r'^##\s*[一二三四五六七八九十]*[、.．]?\s*连续性台账', '## 二、连续性台账')):
        g = grab(pkg, pat)
        if g:
            P += [head, '', g, '']

    io.open(out_path, 'w', encoding='utf-8').write('\n'.join(P) + '\n')
    print('看板源写出：%s' % out_path)
    print('  单元 %d ｜ 分镜行 %d ｜ 出图提示词 %d ｜ 总时长 %ds'
          % (len(units), n_shots, len(assets), sum(u['dur'] or 0 for u in units)))
    if not assets:
        print('  ⚠ 未传 --assets，P2.5 为空（build_board_lite 会报 K-lite-4 WARN）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
