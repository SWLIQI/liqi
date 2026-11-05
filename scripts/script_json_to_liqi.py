#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
script_json_to_liqi.py —— shuohao → liqi 桥接转换器

把 novel-script 产出的 script.json（场次 + 节拍流）转成 liqi 体系的两个输入：
  1. 节拍清单（beats.txt）—— 供 check_prompt.mjs --beats 做节拍认领对账
  2. 剧本平文（script.txt）—— 供 audit_project.py --script 做台词一致性审计

设计立场：shuohao 管结构与对账（它的强项），liqi 管终稿锻造与质检（它的强项）。
本脚本只做格式搬运，不创作、不改词；台词原文逐字搬运，两边对账口径一致。

用法：
  python script_json_to_liqi.py <script.json> [--cast <cast.json>] [--ep 1] [--out <目录>]

  --cast  novel-characters 的 cast.json：把 C01/C03 角色码换成角色名（按数组序号+1 映射）；
          不给就保留角色码
  --ep    只转指定集（1 起）；缺省全部集，每集独立编号 P01…
  --out   输出目录；缺省与输入文件同目录

产出（每集两份）：
  <剧名>-E<ep>-beats.txt    P01｜场次S02｜画面事件｜动作  /  P02｜场次S02｜老周（对白）：原文｜台词
  <剧名>-E<ep>-script.txt   动作行 + 「角色名（语气）：台词」行

节拍清单里的台词原文与 script.json 逐字一致——下游 liqi 提示词包里的台词若被改动，
check_prompt.mjs --beats 的 E-BEAT-LINE-MISSING 会当场点名。

退出码：0 成功；2 输入异常（文件不存在 / JSON 解析失败 / 没有 episodes /
没有任何集被转换——--ep 编号越界也会走到这条）。
"""
import argparse
import json
import os
import re
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')


def load_json(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print('E-INPUT: 找不到文件 %s' % path)
        sys.exit(2)
    except (OSError, UnicodeDecodeError) as e:
        print('E-INPUT: 文件读不了 %s —— %s' % (path, e))
        sys.exit(2)
    except json.JSONDecodeError as e:
        print('E-INPUT: %s 不是合法 JSON —— %s' % (path, e))
        sys.exit(2)


def safe_cell(s):
    """清单用「｜」做列分隔，内容里的竖线换成斜线，防止破坏四段解析。"""
    return str(s).replace('｜', '/').replace('|', '/').strip()


def build_speaker_map(cast):
    """C03 → cast.characters[2].name。cast 缺位或结构不符时返回空映射（保留角色码）。"""
    m = {}
    if not cast:
        return m
    for i, c in enumerate(cast.get('characters') or []):
        name = c.get('name')
        if name:
            m['C%02d' % (i + 1)] = name
    return m


def convert_episode(ep, ep_no, speakers):
    """一集 → (beats_lines, script_lines)。P 编号每集从 P01 重编。"""
    beats = ['# %s 第 %d 集 ｜ 目标 %ss ｜ 钩子：%s ｜ 结尾悬念：%s' % (
        ep.get('_source', ''), ep_no, ep.get('targetSeconds', '?'),
        safe_cell(ep.get('hook', '（无）')), safe_cell(ep.get('cliff', '（无）')))]
    script = ['# %s 第 %d 集（目标 %ss）' % (ep.get('_source', ''), ep_no, ep.get('targetSeconds', '?'))]
    n = 0
    for sc in ep.get('scenes') or []:
        sid = sc.get('sceneId', 'S?')
        lighting = sc.get('lighting', '')
        cast_ids = '、'.join(sc.get('characters') or [])
        beats.append('# 场次%s ｜ 光照：%s ｜ 出场：%s' % (sid, safe_cell(lighting), cast_ids))
        script.append('【场次%s · %s】出场：%s' % (sid, lighting, cast_ids))
        for beat in sc.get('flow') or []:
            if 'line' in beat:
                n += 1
                pid = 'P%02d' % n
                spk = speakers.get(str(beat.get('speaker', '')), str(beat.get('speaker', '?')))
                line = str(beat.get('line', '')).strip()
                delivery = str(beat.get('delivery', '')).strip()
                beats.append('%s｜场次%s｜%s（对白）：%s｜台词' % (pid, sid, spk, safe_cell(line)))
                script.append('%s（%s）：%s' % (spk, delivery or '对白', line))
            else:
                n += 1
                pid = 'P%02d' % n
                action = str(beat.get('action', '')).strip()
                beats.append('%s｜场次%s｜%s｜动作' % (pid, sid, safe_cell(action)))
                script.append('△ %s' % action)
        script.append('')
    return beats, script


def main():
    ap = argparse.ArgumentParser(description='script.json → liqi 节拍清单 + 剧本平文')
    ap.add_argument('script_json')
    ap.add_argument('--cast', help='cast.json（把 C01 角色码换成角色名）')
    ap.add_argument('--ep', help='只转指定集，如 1 或 1,3（缺省全部）')
    ap.add_argument('--out', help='输出目录（缺省与输入同目录）')
    args = ap.parse_args()

    data = load_json(args.script_json)
    eps = data.get('episodes')
    if not eps:
        print('E-INPUT: script.json 里没有 episodes 字段——确认这是 novel-script 的产出。')
        sys.exit(2)

    source = data.get('source') or os.path.splitext(os.path.basename(args.script_json))[0].replace('-script', '')
    out_dir = args.out or os.path.dirname(os.path.abspath(args.script_json))
    os.makedirs(out_dir, exist_ok=True)

    speakers = build_speaker_map(load_json(args.cast) if args.cast else None)

    want = None
    if args.ep:
        want = {int(x) for x in re.split(r'[,\s]+', args.ep.strip()) if x}

    made = []
    for ep in eps:
        ep_no = int(ep.get('ep', 0))
        if want and ep_no not in want:
            continue
        ep['_source'] = source
        beats, script = convert_episode(ep, ep_no, speakers)
        if len(beats) <= 1:
            print('⚠ E%02d 没有可转换的节拍（scenes/flow 为空），跳过' % ep_no)
            continue
        base = os.path.join(out_dir, '%s-E%02d' % (source, ep_no))
        with open(base + '-beats.txt', 'w', encoding='utf-8') as f:
            f.write('\n'.join(beats) + '\n')
        with open(base + '-script.txt', 'w', encoding='utf-8') as f:
            f.write('\n'.join(script) + '\n')
        made.append((ep_no, base))

    if not made:
        print('E-INPUT: 没有任何集被转换（--ep 编号越界？）')
        sys.exit(2)

    for ep_no, base in made:
        print('OK E%02d → %s-beats.txt（check_prompt.mjs --beats 用）' % (ep_no, base))
        print('         → %s-script.txt（audit_project.py --script 用）' % base)


if __name__ == '__main__':
    sys.exit(main())
