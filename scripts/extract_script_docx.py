#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 docx 提取纯文本剧本（zipfile + XML，无需 python-docx）。

用途：为 audit_project.py 的台词一致性检查准备剧本原文。

两种模式：
  默认（纯文本）：逐段落直出，一行一段。适合人读、也适合 `--script` 的全文子串比对。
  --std（标准格式）：角色名独占一行 → 可选（语气）行 → 台词行。audit_project.py 的
    extract_script_dialogues 只认这一种；给它喂纯文本会抽出 0 条台词，
    台词门报「OK」却是假绿（实战踩到：某志怪剧本 docx 直出后一句台词都认不出）。

⚠️ 中文剧本大量台词写作「动作描写…：「台词」」，冒号前没有角色名。
   --std 因此按「引号前最近出现的角色名」归属说话人，跨段沿用上一个说话人；
   角色名可用 --cast 指定，不给则从 `某人（可选语气）：「` 的写法里自动收集。

⚠️ --std 的两条已知行为（v4.8.3 A12 补记，都实测过）：
  1. 跨段引号会丢：引号匹配按段进行——左引号在一个段落、右引号在下一个段落的
     长台词（Word 里被拆段的），整对引号不被识别，该台词不进标准格式。
     长台词被拆段时，先把 docx 里对应段落合并再跑。
  2. 只留引号内内容：--std 输出只有「角色名 / （语气）/ 台词」，动作描写段落
     全部丢弃（audit_project 的台词门只需要台词）；要全文比对请用默认纯文本模式。

用法：
  python extract_script_docx.py <剧本.docx> [-o 输出.txt]
  python extract_script_docx.py <剧本.docx> --std -o 剧本_标准.txt [--cast 道士甲,道士乙]

退出码：0 成功；2 = --std 模式下未能识别任何角色名（用 --cast 名字1,名字2 指定）。
"""
import re
import sys, zipfile, argparse
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')


def para_text(p):
    parts = []
    for node in p.iter():
        if node.tag == W + 't':
            parts.append(node.text or '')
        elif node.tag == W + 'tab':
            parts.append('\t')
        elif node.tag == W + 'br':
            parts.append('\n')
    return ''.join(parts)


def extract(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read('word/document.xml')
    root = ET.fromstring(xml)
    body = root.find(W + 'body')
    out = []
    for el in body.iter():
        if el.tag == W + 'p':
            t = para_text(el)
            if t.strip():
                out.append(t)
        elif el.tag == W + 'tbl':
            out.append('[表格]')
    return '\n'.join(out)


QUOTE_RE = re.compile('「([^」]+)」')
# 「角色名（+可选语气）：「台词」」——用于自动收集角色名。
# 只收 2-3 字：4 字候选实测全是把台词头误当人名（「王某一字一顿：「…」」→ 王某一）。
SPEAKER_RE = re.compile('([一-龥]{2,3})[^：:「]{0,8}[：:]\\s*「')


def derive_cast(lines, limit=40, min_hits=2):
    """从全文里按「某人：「」」的写法收集角色名，按出现次数降序取前 limit 个。
    至少出现 min_hits 次才算角色——只出现一次的通常是误收。"""
    cnt = {}
    for ln in lines:
        for m in SPEAKER_RE.finditer(ln):
            cnt[m.group(1)] = cnt.get(m.group(1), 0) + 1
    return [w for w, c in sorted(cnt.items(), key=lambda kv: -kv[1]) if c >= min_hits][:limit]


def to_standard(lines, cast):
    """段落直出 → 标准格式（角色名 / （语气）/ 台词，台词之间空一行）。"""
    if not cast:
        cast = derive_cast(lines)
    if not cast:
        return None, '未能自动识别角色名，请用 --cast 名字1,名字2 指定'
    cast_re = re.compile('(' + '|'.join(sorted(set(cast), key=len, reverse=True)) + ')')
    out, last, n = [], cast[0], 0
    for t in lines:
        for m in QUOTE_RE.finditer(t):
            pre = t[:m.start()]
            who = None
            for cm in cast_re.finditer(pre):
                who = cm.group(1)
            sp = who or last
            last = sp
            tail = pre[pre.rfind(sp) + len(sp):] if who else ''
            tone = tail.strip('：:，,。 \u3000')
            tone = tone if (tone and len(tone) <= 10) else ''
            out.append(sp)
            if tone:
                out.append('（%s）' % tone)
            out.append(m.group(1))
            out.append('')
            n += 1
    return '\n'.join(out), '台词 %d 条｜角色 %s' % (n, '、'.join(cast[:8]))


def main():
    ap = argparse.ArgumentParser(description='从 docx 提取剧本纯文本')
    ap.add_argument('docx')
    ap.add_argument('-o', '--out', help='输出路径，默认打印到标准输出')
    ap.add_argument('--std', action='store_true',
                    help='输出标准剧本格式（角色名/语气/台词各占一行），供 audit_project.py --script 使用')
    ap.add_argument('--cast', help='角色名，逗号分隔；不给则自动识别')
    args = ap.parse_args()

    try:
        text = extract(args.docx)
    except (OSError, UnicodeDecodeError, zipfile.BadZipFile) as e:
        print('[-] 剧本 docx 读不了：%s' % e, file=sys.stderr)
        sys.exit(1)
    if args.std:
        std, note = to_standard(text.split('\n'),
                                [c.strip() for c in args.cast.split(',') if c.strip()] if args.cast else None)
        if std is None:
            print('⚠️  %s' % note)
            sys.exit(2)
        text = std
        print('%s' % note)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(text)
        print('已写入：%s（%d 行）' % (args.out, len(text.split('\n'))))
    else:
        print(text)


if __name__ == '__main__':
    main()
