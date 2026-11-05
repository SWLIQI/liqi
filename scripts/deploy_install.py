#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""liqi 安装位部署（v6.19.1 · 补「改了主库但跑的还是旧版」这个洞）

为什么需要它：
  WorkBuddy 加载的是 `~/.workbuddy/skills/<name>/` 这一份，而 `sync_copies.py` 只遍历
  `check_copies.CANDIDATES`（专家团 + 插件市场 crew）——**安装位从来不在任何同步路径上**。
  实测后果：桌面主库做到 6.18.0，跑起来的仍是 6.0.1，落后 18 个版本，全套机检照样 0/0 全绿。

  这跟本包早就学过的两课是同一课：
  ① `sync_copies.py` 的诞生理由——「同步动作必须脚本化，手工 cp 清单每次现写必出事」；
  ② `check_copies.py` 的诞生理由——「漂移不会让任何一处报警，所以要有人专门比对」。
  部署也是同一个道理：能一遍跑完并自证的动作，不要留在人的记忆里。

它做什么：
  把主库内容（排除 .git / __pycache__ / *.pyc）拷到每个同名安装镜像，然后**立刻自证**：
  版本号相同 + 逐文件 md5 相同。验证不过就以非零码退出，不假装成功。

边界：
  - 只碰「SKILL.md 的 name 与主库相同、且不是主库自己」的目录（语义判据，不认目录名）；
  - 镜像里多出来的文件默认**不删**，只报告；确要清理加 `--prune`；
  - 不碰 `CANDIDATES` 里那两个副本（专家团 / crew），那是 `sync_copies.py` 的职责，
    本脚本只管安装位——两种同步语义不同，混在一起会重演 v6.6.1 的覆盖事故。

用法：
  python scripts/deploy_install.py            # 部署 + 自证
  python scripts/deploy_install.py --dry-run  # 只看会动哪些文件
  python scripts/deploy_install.py --prune    # 顺带删掉镜像里主库没有的文件
退出码：0 成功且自证通过；1 无安装镜像 / 自证失败；2 用法错误
"""
from __future__ import print_function

import os
import shutil
import sys
import filecmp

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import check_copies as cc  # noqa: E402  复用同一份镜像定位与比对口径

SKIP_DIRS = {'__pycache__', '.git'}
SKIP_SUFFIX = {'.pyc', '.pyo'}


def iter_files(base):
    """relpath 集合：只排除 .git / __pycache__ / 字节码。

    注意**不排除其它点文件**：`examples/<样例>/.gates.jsonl` 是本包明确要求随包提交的
    （见 .gitignore 注释「examples/ 下的随包提交」），漏掉它会让安装位与主库出现
    「看起来一致、实际少文件」的差异。
    """
    out = set()
    for cur, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            if os.path.splitext(name)[1] in SKIP_SUFFIX:
                continue
            p = os.path.join(cur, name)
            out.add(os.path.relpath(p, base).replace('\\', '/'))
    return out


def deploy_one(mirror, dry_run, prune):
    src_files = iter_files(ROOT)
    dst_files = iter_files(mirror)
    to_copy = sorted(src_files - dst_files) + sorted(src_files & dst_files)
    changed = [r for r in sorted(src_files & dst_files)
               if not filecmp.cmp(os.path.join(ROOT, r), os.path.join(mirror, r), shallow=False)]
    extra = sorted(dst_files - src_files)

    print('  → %s' % mirror)
    print('    待写入 %d 个（新增 %d / 内容变更 %d）；镜像多出 %d 个%s'
          % (len(to_copy), len(src_files - dst_files), len(changed), len(extra),
             '（--prune 会删）' if extra and prune else '（默认保留）'))
    if extra and not prune:
        for r in extra[:8]:
            print('      · 多出：%s' % r)

    if dry_run:
        return 0

    n = 0
    for rel in to_copy:
        src = os.path.join(ROOT, rel)
        dst = os.path.join(mirror, rel)
        d = os.path.dirname(dst)
        if d and not os.path.isdir(d):
            os.makedirs(d)
        shutil.copy2(src, dst)
        n += 1
    if prune:
        for rel in extra:
            try:
                os.remove(os.path.join(mirror, rel))
                n += 1
            except OSError as e:
                print('      ! 删除失败 %s：%s' % (rel, e))
    print('    已写入 %d 个文件' % n)
    return 0


def verify(mirror):
    """自证：版本号相同 + 统计口径下的内容逐文件一致。"""
    a = cc._tree_hash(ROOT)
    b = cc._tree_hash(mirror)
    only_a = sorted(set(a) - set(b))
    only_b = sorted(set(b) - set(a))
    diff = sorted(k for k in (set(a) & set(b)) if a[k] != b[k])
    ver_a = cc._ver_of(ROOT)
    ver_b = cc._ver_of(mirror)
    ok = (not only_a and not only_b and not diff and ver_a == ver_b)
    print('    自证：主库 v%s ／ 镜像 v%s；缺 %d / 多 %d / 不同 %d —— %s'
          % (ver_a, ver_b, len(only_a), len(only_b), len(diff), '通过' if ok else '未通过'))
    if not ok:
        for r in (only_a + only_b + diff)[:8]:
            print('      · %s' % r)
    return ok


def main(argv):
    dry_run = '--dry-run' in argv
    prune = '--prune' in argv
    if any(a in ('-h', '--help') for a in argv):
        print(__doc__)
        return 0

    mirrors = cc.find_install_mirrors()
    if not mirrors:
        print('没有找到同名安装镜像（单副本环境，或当前就跑在安装位里）——不是错误，但也就没得部署。')
        return 1

    print('liqi 安装位部署 —— 主库 v%s' % (cc._ver_of(ROOT) or '?') + ('（dry-run，不落盘）' if dry_run else ''))
    all_ok = True
    for m in mirrors:
        deploy_one(m, dry_run, prune)
        if not dry_run:
            all_ok = verify(m) and all_ok

    if dry_run:
        print('\n干跑结束：未改动任何文件。去掉 --dry-run 才会真的写入。')
        return 0
    print('\n部署%s。' % ('完成且自证通过' if all_ok else '**未通过自证**，别当它成功了'))
    if not all_ok:
        print('排查建议：先 python scripts/check_copies.py 看全量差异；'
              '镜像里若有主库没有的旧脚本，用 --prune 清理或手工确认归属。')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
