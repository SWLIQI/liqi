#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
副本 CHANGELOG 的「头部保留式」同步（v5.44.1）

背景
----
v5.44.1 同步时我先用主库 SKILL.md 整体覆盖了专家团的 SKILL.md（丢 name/version/横幅），
修复后又在同步 CHANGELOG 时**犯了同一个错**：用主库 CHANGELOG 覆盖了专家团的，
把它自己的 7.3.0 版本线抹掉了。同一类错犯两次，说明问题不在记性，在缺工具。

副本 CHANGELOG 的结构
---------------------
「副本自有版本线条目」+「主库条目（跟随底座）」。
以专家团为例：最前面是 `## 7.3.0（本目录自有版本线）`，后面是 5.44.x / 5.43.x 等主库条目。

这个脚本做什么
--------------
1. 从副本 CHANGELOG 抽出**自有版本线条目**（以 `## <副本version>` 开头的那个区块）；
2. 以主库 CHANGELOG 为底；
3. 把副本自有条目插回最前（在主库第一条之前）；
4. 写回并留 .bak_<时间戳>。

用法
----
    python scripts/sync_copy_changelog.py <主库CHANGELOG.md> <副本CHANGELOG.md> <副本version> [--dry-run]
"""
import argparse
import os
import re
import shutil
import sys
from datetime import datetime


def split_entries(text):
    """切成 (前导, [条目...])。条目 = 从 `## ` 到下一个 `## ` 之前。"""
    m = re.search(r"\n(?=## )", text)
    head = text[: m.start()] if m else ""
    body = text[m.start():] if m else text
    parts = re.split(r"\n(?=## )", body)
    return head, [p for p in parts if p.strip()]


def entry_version(entry):
    m = re.match(r"##\s*([0-9]+\.[0-9]+\.[0-9]+)\s*—", entry)
    return m.group(1) if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("main_changelog")
    ap.add_argument("copy_changelog")
    ap.add_argument("copy_version", help="副本自有版本号，如 7.3.0")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    for p in (args.main_changelog, args.copy_changelog):
        if not os.path.exists(p):
            print("E-INPUT：找不到 %s" % p)
            return 2

    main_head, main_entries = split_entries(open(args.main_changelog, encoding="utf-8").read())
    _, copy_entries = split_entries(open(args.copy_changelog, encoding="utf-8").read())

    # 抽副本自有条目（按版本号精确匹配；可能有多个同版本条目，全抽）
    owned = [e for e in copy_entries if entry_version(e) == args.copy_version]
    if not owned:
        print("W-INPUT：副本 CHANGELOG 里找不到「## %s」条目——若确实没有自有版本线，无需本脚本" % args.copy_version)
        return 0

    # 主库条目里去掉与副本自有同版本的（不应发生，防御）
    main_entries = [e for e in main_entries if entry_version(e) != args.copy_version]

    out = main_head + "\n" + "\n".join(owned + main_entries)
    # 规范：确保条目之间恰好一个换行间隔由各条目自带；头部与第一条之间补空行
    if not out.endswith("\n"):
        out += "\n"

    print("主库 %s → 副本 %s" % (args.main_changelog, args.copy_changelog))
    print("  保留副本自有条目：%s（%d 条）" % (args.copy_version, len(owned)))
    print("  主库条目 %d 条 ／ 合成后 %d 字符" % (len(main_entries), len(out)))

    if args.dry_run:
        print("  --dry-run：未写入")
        return 0

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = args.copy_changelog + ".bak_" + stamp
    shutil.copy(args.copy_changelog, bak)
    open(args.copy_changelog, "w", encoding="utf-8", newline="").write(out)
    print("  已写入；改动前备份：%s" % bak)
    return 0


if __name__ == "__main__":
    sys.exit(main())
