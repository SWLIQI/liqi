#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""selftest_audit_continuity_lock.py —— 连续性锁对账（audit_continuity_lock.py）的自测（v6.5.0 · C28 · 13 组）

设计：子进程黑盒，每组建独立临时目录。断言只锚 ASCII 码号与退出码——中文输出在
非 UTF-8 控制台会降级，断言中文等于把编码环境耦合进用例（N7 教训）。

用法：python scripts/selftest_audit_continuity_lock.py
退出码：0 = 13 组全过；1 = 有失败
"""
from __future__ import print_function

import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'audit_continuity_lock.py')
ENV = dict(os.environ, PYTHONUTF8='1', LIQI_ORIGIN='selftest')

passed, failed = 0, 0


def run(args):
    p = subprocess.run([sys.executable, SCRIPT] + [str(x) for x in args],
                       capture_output=True, env=ENV)
    return p.returncode, (p.stdout + p.stderr).decode('utf-8', 'replace')


def case(name, ok, detail=''):
    global passed, failed
    print(('%s %s%s' % ('✅' if ok else '❌', name, (' —— ' + detail) if detail else ''))
          if ok else ('❌ %s%s' % (name, (' —— ' + detail) if detail else '')))
    if ok:
        passed += 1
    else:
        failed += 1


PKG = """# 分镜包 · 测试

``` 镜块
镜 1｜开场（30s）
【长段声明】30s · 节拍 3
场景：客厅｜人物：甲
【时间轴】0-30s：中景。甲拿起旧怀表看了一眼，银色旧怀表，表壳背面刻痕已磨平，随后放下｜镜头：中景｜台词：无
Must not：卡通、水印
—— 以下不进正文 ——
# duration: 30s
```

```
镜 2｜转场（30s）
【长段声明】30s · 节拍 3
场景：客厅｜人物：甲
【时间轴】0-30s：中景。甲把那只表收进抽屉，锁好｜镜头：中景｜台词：无
—— 以下不进正文 ——
# duration: 30s
```
"""

LOCKS = """# 连续性锁（测试）

| 锁 ID | 对象 | 检索词 | 镜头范围 | 锁面 | 状态 |
|---|---|---|---|---|---|
| LOCK-P02 | 旧怀表 | 怀表 | 全集 | 银色旧怀表，表壳背面刻痕已磨平 | 在锁 |
"""


def write(root, name, content):
    p = os.path.join(root, name)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(content)
    return p


def main():
    root = tempfile.mkdtemp(prefix='locktest_')
    try:
        pkg = write(root, '包.md', PKG)
        locks = write(root, '连续性锁.md', LOCKS)

        # 1 全集锁面在正文：绿
        rc, out = run([pkg, '--locks', locks])
        case('L1 全集在锁且锁面在正文 → 0E/0W', rc == 0 and 'E-LOCK' not in out and '结果：0 error / 0 warning' in out, out[-120:])

        # 2 在锁缺失：把包里的锁面删掉
        pkg2 = write(root, '包2.md', PKG.replace('银色旧怀表，表壳背面刻痕已磨平，随后放下', '随手把怀表揣进兜里，随后放下'))
        rc, out = run([pkg2, '--locks', locks])
        case('L2 在锁且范围命中但锁面缺失 → E-LOCK-MISSING rc1',
             rc == 1 and 'E-LOCK-MISSING' in out, out[-120:])

        # 3 锁面只出现在 Must not 负面区 → E-LOCK-NEGATIVE-ONLY
        pkg3 = write(root, '包3.md', PKG.replace('【时间轴】0-30s：中景。甲拿起旧怀表看了一眼，银色旧怀表，表壳背面刻痕已磨平，随后放下',
                                                 '【时间轴】0-30s：中景。甲拿起旧怀表看了一眼，随后放下').replace(
            'Must not：卡通、水印', 'Must not：卡通、水印、银色旧怀表，表壳背面刻痕已磨平'))
        rc, out = run([pkg3, '--locks', locks])
        case('L3 锁面只进负面区 → E-LOCK-NEGATIVE-ONLY rc1',
             rc == 1 and 'E-LOCK-NEGATIVE-ONLY' in out and 'E-LOCK-MISSING' not in out, out[-120:])

        # 4 部分覆盖：段 2 提到检索词但没带锁面 → W-LOCK-MENTION-NO-FACE（rc0）
        pkg4 = write(root, '包4.md', PKG.replace('那只表', '怀表'))
        rc, out = run([pkg4, '--locks', locks])
        case('L4 段提到检索词但段内无锁面 → W-LOCK-MENTION-NO-FACE rc0',
             rc == 0 and 'W-LOCK-MENTION-NO-FACE' in out, out[-120:])

        # 5 解锁行跳过：缺失不报
        locks5 = write(root, '锁5.md', LOCKS.replace('| 在锁 |', '| 解锁 |'))
        rc, out = run([pkg2, '--locks', locks5])
        case('L5 状态=解锁 行跳过不查 → 0E', rc == 0 and 'E-LOCK-MISSING' not in out, out[-120:])

        # 6 --locks 文件不存在 → W-LOCK-UNREADABLE，跳过不是通过，rc0
        rc, out = run([pkg, '--locks', os.path.join(root, '不存在.md')])
        case('L6 锁表文件不存在 → W-LOCK-UNREADABLE rc0（跳过不是通过）',
             rc == 0 and 'W-LOCK-UNREADABLE' in out and '跳过不是通过' in out, out[-120:])

        # 7 空表（只有表头）→ W-LOCK-EMPTY-RUN
        empty = write(root, '锁空.md', '# 连续性锁\n\n| 锁 ID | 对象 | 检索词 | 镜头范围 | 锁面 | 状态 |\n|---|---|---|---|---|---|\n')
        rc, out = run([pkg, '--locks', empty])
        case('L7 锁表空跑 → W-LOCK-EMPTY-RUN', rc == 0 and 'W-LOCK-EMPTY-RUN' in out, out[-120:])

        # 8 坏行（列数不对）→ E-LOCK-BADROW rc1
        bad = write(root, '锁坏.md', '| 锁 ID | 对象 | 检索词 | 镜头范围 | 锁面 | 状态 |\n|---|---|---|---|---|---|\n| LOCK-X | 缺列行 | 怀表 | 全集 | 在锁 |\n')
        rc, out = run([pkg, '--locks', bad])
        case('L8 列数坏行 → E-LOCK-BADROW rc1', rc == 1 and 'E-LOCK-BADROW' in out, out[-120:])

        # 9 重复 ID + 状态出枚举 → 两个 E-LOCK-BADROW / E-LOCK-DUPID
        dup = write(root, '锁dup.md', LOCKS + '| LOCK-P02 | 二次登记 | 怀表 | 全集 | 另一句锁面 | 在锁 |\n| LOCK-P03 | 出枚举 | 怀表 | 全集 | 某锁面 | 锁死 |\n')
        rc, out = run([pkg, '--locks', dup])
        case('L9 重复 ID 与状态出枚举 → E-LOCK-DUPID + E-LOCK-BADROW',
             rc == 1 and 'E-LOCK-DUPID' in out and 'E-LOCK-BADROW' in out, out[-160:])

        # 10 正文边界：锁面写在「以下不进正文」之后（参数行）不算 → E-LOCK-MISSING
        pkg10 = write(root, '包10.md', PKG.replace('【时间轴】0-30s：中景。甲拿起旧怀表看了一眼，银色旧怀表，表壳背面刻痕已磨平，随后放下',
                                                   '【时间轴】0-30s：中景。甲拿起旧怀表看了一眼，随后放下').replace(
            '# duration: 30s\n```\n\n```\n镜 2', '# duration: 30s\n# 锁面备注：银色旧怀表，表壳背面刻痕已磨平\n```\n\n```\n镜 2'))
        rc, out = run([pkg10, '--locks', locks])
        case('L10 锁面写进参数行（围栏尾）不算正文 → E-LOCK-MISSING',
             rc == 1 and 'E-LOCK-MISSING' in out, out[-120:])

        # 11 镜号范围 2：包段 2 无锁面 → E-LOCK-MISSING 只因段 2；范围 9（无交集）→ 不报
        locks11 = write(root, '锁11.md', LOCKS.replace('| 全集 |', '| 2 |'))
        rc, out = run([pkg, '--locks', locks11])
        case('L11 范围=镜2 且段2无锁面 → E-LOCK-MISSING（段1不背锅）',
             rc == 1 and 'E-LOCK-MISSING' in out, out[-120:])
        locks12 = write(root, '锁12.md', LOCKS.replace('| 全集 |', '| 9 |'))
        rc, out = run([pkg, '--locks', locks12])
        case('L12 范围镜号与本包无交集 → 不报（锁是给别的包的）',
             rc == 0 and 'E-LOCK' not in out, out[-120:])

        # 13 --json 纯度
        rc, out = run([pkg, '--locks', locks, '--json'])
        try:
            j = json.loads(out)
            ok13 = rc == 0 and isinstance(j.get('codes'), list) and j.get('locks') == 1 and j.get('segments') == 2
        except ValueError:
            ok13 = False
        case('L13 --json 纯度（stdout 只有 JSON，锁 1 条 × 段 2 个）', ok13, out[-120:])
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print('结果：%d 过 / %d 败' % (passed, failed))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
