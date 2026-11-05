#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
副本 SKILL.md 的「头部保留式」同步（v5.44.0）

为什么需要这个脚本
------------------
v5.44.0 同步时，我图省事用主库 SKILL.md **整体覆盖**了 liqi专家团 的 SKILL.md，
结果丢了两样东西：front matter 的 `name: liqi专家团` / `version: "7.3.0"`，
以及开头那段维护横幅（写着"本目录是主库的多 agent 独立安装形态…"）。

根因：副本的 SKILL.md 不是主库的纯副本，而是**「主库内容 + 副本自有头部」**。
整体覆盖会把"自有头部"一起抹掉。这类事故靠"下次记得"防不住，所以做成脚本。

做什么
------
1. 从副本当前文件里抽出两块自有内容：
   - front matter 中的 name / version（副本可有独立版本线，如专家团的 7.3.0）
   - 标题之后、第一个二级标题之前的维护横幅
2. 以主库 SKILL.md 为底，把上面两块装回去
3. 写回副本，并在改动前后各留一份备份

用法
----
    python scripts/sync_copy_skill.py <主库SKILL.md> <副本SKILL.md> [--dry-run]
"""
import argparse
import os
import re
import shutil
import sys
from datetime import datetime


def split_front_matter(text):
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n", text, re.S)
    if not m:
        return None, text, ""
    return m.group(1), text[m.end():], m.group(0)


def get_fm_field(fm, key):
    m = re.search(r"^%s:\s*(.+)$" % re.escape(key), fm, re.M)
    return m.group(1).strip() if m else None


def set_fm_field(fm, key, value):
    if re.search(r"^%s:\s*.+$" % re.escape(key), fm, re.M):
        return re.sub(r"^%s:\s*.+$" % re.escape(key), "%s: %s" % (key, value), fm, count=1, flags=re.M)
    return fm.rstrip() + "\n%s: %s\n" % (key, value)


def extract_banner(body):
    """标题之后、第一个 `## ` 之前的内容，视为副本自有的维护横幅。"""
    lines = body.split("\n")
    h1 = next((i for i, l in enumerate(lines) if l.startswith("# ")), None)
    if h1 is None:
        return [], lines
    h2 = next((i for i, l in enumerate(lines[h1 + 1:], h1 + 1) if re.match(r"^#{1,2} ", l)), len(lines))
    return lines[h1 + 1:h2], lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("main_skill")
    ap.add_argument("copy_skill")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    for p in (args.main_skill, args.copy_skill):
        if not os.path.exists(p):
            print("E-INPUT：找不到 %s" % p)
            return 2

    main_txt = open(args.main_skill, encoding="utf-8").read()
    copy_txt = open(args.copy_skill, encoding="utf-8").read()

    main_fm, main_body, main_fm_raw = split_front_matter(main_txt)
    copy_fm, copy_body, _ = split_front_matter(copy_txt)
    if main_fm is None or copy_fm is None:
        print("E-INPUT：两份文件都必须有 front matter（--- 包裹）")
        return 2

    banner, _ = extract_banner(copy_body)

    # 1) front matter：以主库为准，但保留副本的 name / version（副本可有独立版本线）
    new_fm = main_fm
    for key in ("name", "version"):
        v = get_fm_field(copy_fm, key)
        if v:
            new_fm = set_fm_field(new_fm, key, v)

    # 2) 正文：主库正文；若有横幅，插回标题之后
    body_lines = main_body.split("\n")
    if banner:
        h1 = next((i for i, l in enumerate(body_lines) if l.startswith("# ")), None)
        if h1 is not None:
            body_lines = body_lines[:h1 + 1] + banner + body_lines[h1 + 1:]

    out = "---\n%s\n---\n%s" % (new_fm.strip(), "\n".join(body_lines))

    print("主库 %s → 副本 %s" % (args.main_skill, args.copy_skill))
    print("  保留 name=%s version=%s" % (get_fm_field(copy_fm, "name"), get_fm_field(copy_fm, "version")))
    print("  保留横幅 %d 行" % len(banner))
    print("  合成后 %d 字符（副本原 %d / 主库 %d）" % (len(out), len(copy_txt), len(main_txt)))

    if args.dry_run:
        print("  --dry-run：未写入")
        return 0

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = args.copy_skill + ".bak_" + stamp
    shutil.copy(args.copy_skill, bak)
    open(args.copy_skill, "w", encoding="utf-8", newline="").write(out)
    print("  已写入；改动前备份：%s" % bak)
    return 0


if __name__ == "__main__":
    sys.exit(main())
