#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 docx 提取纯文本剧本（zipfile + XML，无需 python-docx）。

用途：为 audit_project.py 的台词一致性检查准备剧本原文。
输出为标准剧本格式：角色名独占一行 → 可选（语气）行 → 台词行。

用法：
  python extract_script_docx.py <剧本.docx> [-o 输出.txt]
"""
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


def main():
    ap = argparse.ArgumentParser(description='从 docx 提取剧本纯文本')
    ap.add_argument('docx')
    ap.add_argument('-o', '--out', help='输出路径，默认打印到标准输出')
    args = ap.parse_args()

    text = extract(args.docx)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(text)
        print('已写入：%s（%d 行）' % (args.out, len(text.split('\n'))))
    else:
        print(text)


if __name__ == '__main__':
    main()
