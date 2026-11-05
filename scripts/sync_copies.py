#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""liqi 三副本同步（v6.9.1 · N 项「同步脚本化」落地）

为什么需要它：
  三副本同步此前靠一次性手工脚本（cp 清单每次现写），同一天里三次把主库 SKILL.md
  误复制进 liqi专家团（owned 文件），靠 check_copies 身份守卫兜住——**同步动作本身
  必须脚本化且 owned 文件永不进清单**，这就是本脚本。

同步内容（整目录全量，不再逐文件挑——逐文件挑是三次事故的温床）：
  scripts/ 全量（.pyc 除外）
  references/ 全量（liqi专家团 的 7 份 TEAM_REFS 为副本自有，跳过）
  examples/ 全量
  根目录：CHANGELOG.md / README.md / README.en.md
  SKILL.md：**只同步到 liqi-crew(插件)**（frontmatter version 跟随主库）；
            liqi专家团 的 SKILL.md 是自有文件（团队自版本号），只追加维护横幅。

用法：
  python scripts/sync_copies.py "横幅备注"     # 备注 写进专家团维护横幅（如「C32 批 2」）
退出码：0 同步完成；1 无副本可同步（单副本环境）；2 参数错误
同步后必跑：python scripts/check_copies.py（本脚本不做一致性断言，验证归验证）
"""
from __future__ import print_function

import glob
import io
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import check_copies as cc  # noqa: E402  复用同一份副本定位与 owned 口径

TEAM_REFS = cc._TEAM_REFS  # 专家团自有 references（主库没有，天然不会被覆盖）

ROOT_FILES = ['CHANGELOG.md', 'README.md', 'README.en.md']


def sync_one(root, is_expert, note):
    n = 0
    for f in glob.glob(os.path.join(HERE, '*')):
        if os.path.isfile(f) and not f.endswith('.pyc'):
            shutil.copy2(f, os.path.join(root, 'scripts', os.path.basename(f)))
            n += 1
    for f in glob.glob(os.path.join(ROOT, 'references', '*.md')) + \
             glob.glob(os.path.join(ROOT, 'references', '*.json')):
        base = os.path.basename(f)
        if is_expert and base in TEAM_REFS:
            continue
        shutil.copy2(f, os.path.join(root, 'references', base))
        n += 1
    for f in ROOT_FILES:
        src = os.path.join(ROOT, f)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(root, f))
            n += 1
    ex_root = os.path.join(ROOT, 'examples')
    if os.path.isdir(ex_root):
        for d in glob.glob(os.path.join(ex_root, '*')):
            if os.path.isdir(d):
                dst = os.path.join(root, 'examples', os.path.basename(d))
                os.makedirs(dst, exist_ok=True)
                for g in glob.glob(os.path.join(d, '*')):
                    if os.path.isfile(g):
                        shutil.copy2(g, os.path.join(dst, os.path.basename(g)))
                        n += 1
    skill = os.path.join(root, 'SKILL.md')
    if is_expert:
        # 🔴 owned 文件：永不复制主库 SKILL.md（v6.6.1/v6.7.0/v6.9.1 三次事故铁律）
        t = io.open(skill, encoding='utf-8').read()
        marker = '同步到主库'
        main_ver = io.open(os.path.join(ROOT, 'SKILL.md'), encoding='utf-8').read()
        import re
        mv = re.search(r'^version:\s*["\']?([\d.]+)', main_ver, re.M)
        want = '同步到主库 v%s' % (mv.group(1) if mv else '?')
        if want not in t:
            with io.open(skill, 'a', encoding='utf-8', newline='') as f:
                f.write('\n> 维护横幅：%s%s\n' % (want, ('（%s）' % note) if note else ''))
            n += 1
    else:
        shutil.copy2(os.path.join(ROOT, 'SKILL.md'), skill)
        n += 1
    return n


def main(argv):
    note = ''
    args = [a for a in argv if not a.startswith('-')]
    if len(args) > 1:
        note = args[1]
    elif len(argv) > 0 and any(a in ('-h', '--help') for a in argv):
        print(__doc__)
        return 0
    if not os.path.isfile(os.path.join(ROOT, 'SKILL.md')):
        print('E-INPUT：主库路径找不到 SKILL.md —— %s' % ROOT)
        return 2
    total = 0
    synced = 0
    for name, roots in cc.CANDIDATES:
        root = roots[0]
        if not os.path.isdir(root):
            print('%s：副本不存在，跳过' % name)
            continue
        n = sync_one(root, name == 'liqi专家团', note)
        print('%s：%d 个文件 -> %s' % (name, n, root))
        total += n
        synced += 1
    if synced == 0:
        print('单副本环境：无可同步副本（不是错误）')
        return 1
    print('同步完成：%d 个文件；必跑 python scripts/check_copies.py 验证（同步 ≠ 验证）' % total)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
