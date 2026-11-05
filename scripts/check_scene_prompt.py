#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""场景/资产图提示词校验（v6.19.6 · 建议书 P0-1 + P0-3 的生图层入口）

为什么需要这个入口：
  `check_prompt.mjs` 只认「镜 N｜」镜块，场景图提示词是另一套形态（`## ① S01-C … 三阶多视角`
  + 四要素 + 四面板 + 复制块），塞进去解析不了。于是这类提示词一直**没有任何机检**——
  2026-11-04 那次「四格不同空间 / 俯视丢床 / 整组边塞风」的返工，根因就是散文体写法
  缺了「硬性不变量」这一块，而没有任何门会提醒。

判据分两档（按节标题判定，避免对单视图误伤）：
  所有卡片节：复制块包裹 / 挂图行 / 输出行 / 场景·光源·氛围 三要素 / Negative Prompt
  多视角·四视图节：额外要求 画面排布 + 硬性不变量 + 核心强制约束 + 禁止内容

用法：
  python scripts/check_scene_prompt.py <场景提示词包.md>
退出码：0 无 ERROR；1 有 ERROR
"""
from __future__ import print_function

import io
import re
import sys

MULTI_RE = re.compile(r'多视角|四视图|2\s*[×x]\s*2|三阶')
COMMON = [
    ('复制开始', r'─+\s*复制开始\s*─+'),
    ('复制结束', r'─+\s*复制结束\s*─+'),
    ('挂图行', r'^\s*挂图[：:]'),
    ('输出行', r'^\s*输出[：:]'),
    ('场景', r'^\s*场景[：:]'),
    ('光源', r'^\s*光源[：:]'),
    ('氛围', r'^\s*氛围[：:]'),
    ('Negative Prompt', r'^\s*Negative\s*Prompt\s*[：:]'),
]
MULTI = [
    ('画面排布', r'^\s*(画面排布|面板排布)'),
    ('硬性不变量', r'^\s*硬性不变量'),
    ('核心强制约束', r'^\s*核心强制约束[：:]'),
    ('禁止内容', r'^\s*禁止内容[：:]'),
]


def split_cards(text):
    """按 `## ` 切卡片；只收带「· xxx」或含 S 编号的节，避免把说明章当卡片。"""
    out, cur = [], None
    for line in text.split('\n'):
        if line.startswith('## '):
            if cur:
                out.append(cur)
            cur = [line[3:].strip(), []]
        elif cur is not None:
            cur[1].append(line)
    if cur:
        out.append(cur)
    return [(t, '\n'.join(b)) for t, b in out if re.search(r'\bS\d{2}\b|资产|场景', t)]


def check(text):
    errors, warns, infos = [], [], []
    cards = split_cards(text)
    if not cards:
        return ['找不到任何卡片节（`## <编号> <资产名> · <类型>`）——本文件不像场景提示词包'], warns, infos

    multi_n = 0
    for title, body in cards:
        is_multi = bool(MULTI_RE.search(title))
        if is_multi:
            multi_n += 1
        need = COMMON + (MULTI if is_multi else [])
        miss = [name for name, pat in need if not re.search(pat, body, re.M)]
        if miss:
            errors.append('「%s」缺 %d 项：%s%s'
                          % (title[:40], len(miss), '、'.join(miss),
                             '（多视角卡片必须逐段齐全，散文体会跨格漂移）' if is_multi else ''))
        # 引用式写法：交付物里不许「见统一/同上」
        if re.search(r'见(统一|上文|前述)|同上|同前', body):
            errors.append('「%s」出现引用式写法（见统一/同上/同前）——投喂块必须自包含' % title[:40])
    infos.append('共 %d 张卡片，其中多视角/四视图 %d 张' % (len(cards), multi_n))
    return errors, warns, infos


def main(argv):
    args = [a for a in argv if not a.startswith('-')]
    if not args:
        print(__doc__)
        return 2
    p = args[0]
    try:
        text = io.open(p, encoding='utf-8').read()
    except OSError as e:
        print('读取失败：%s' % e)
        return 2

    errors, warns, infos = check(text)
    print('\n场景/资产图提示词校验 —— %s\n' % p)
    for i in infos:
        print('  ○ %s' % i)
    for w in warns:
        print('  ⚠️  %s' % w)
    for e in errors:
        print('  ❌ %s' % e)
    print('\n合计：%d ERROR / %d WARN —— %s\n'
          % (len(errors), len(warns), '有 ERROR，改完再投' if errors else '无 ERROR'))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
