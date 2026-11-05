#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
selftest_audit_render.py —— 渲染产物机检自测（v5.51.0）

覆盖：
  R1 路径不存在 → rc=2 + E-INPUT（假绿防线）
  R2 目录无视频 → rc=2（空目录不是通过）
  R3 --ffmpeg 指向不存在目录 → rc=2（显式指路不静默回退 PATH）
  R4 正常片段（testsrc2 + 正弦音，16:9，有声，无冻结）→ 0 警告
  R5 全黑片段 → W-RENDER-BLACK（片尾 ≤1.5s 淡出豁免的边界在 R5 里天然覆盖）
  R6 静止纯色片段 → W-RENDER-FREEZE（中段冻结；结尾 ≤2.5s 定格豁免另见 hint 文本）
  R7 无声片段 → W-RENDER-SILENT
  R8 4:3 片段按默认 16:9 检 → W-RENDER-AR
  R9 --plan 时长对账：8s 片段对 4s 声明 → W-RENDER-PLAN

R4~R9 需要 ffmpeg（合成测试片段）；无 ffmpeg 的机器只跑 R1~R3，
R4~R9 记「跳过（未查）」——与库内「跳过不是通过」口径一致。

用法：python scripts/selftest_audit_render.py
退出码：0 全过；1 有败
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
AR = os.path.join(HERE, 'audit_render.py')
P = sys.executable

rows = []


def run(args):
    r = subprocess.run([P, AR] + args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    return r.returncode, (r.stdout or '') + (r.stderr or '')


def check(name, ok, why=''):
    rows.append((name, ok, why))
    print('%s %s' % ('✅' if ok else '❌', name))


def make_clip(ff, path, video, audio, dur, size='320x180'):
    # lavfi 以第一个 '=' 分隔滤镜名与参数：裸源名（testsrc2）用 '=' 续接，
    # 带参源（color=c=black）已含 '='，续接用 ':'
    sep = ':' if '=' in video else '='
    r = subprocess.run([ff, '-v', 'error', '-y',
                        '-f', 'lavfi', '-i', '%s%ssize=%s:duration=%s:rate=10' % (video, sep, size, dur),
                        '-f', 'lavfi', '-i', audio, '-t', str(dur),
                        '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                        '-c:a', 'aac', path], capture_output=True, text=True)
    return r.returncode == 0 and os.path.isfile(path)


def has_ffmpeg():
    return shutil.which('ffmpeg') is not None


def main():
    tmp = tempfile.mkdtemp(prefix='liqi_ar_')
    try:
        # ---- 假绿防线（任何机器必测）----
        rc, out = run([os.path.join(tmp, '不存在.mp4'), '--no-log'])
        check('R1 路径不存在 → rc=2 + E-INPUT', rc == 2 and 'E-INPUT' in out,
              'rc=%d' % rc)

        empty = os.path.join(tmp, '空目录')
        os.makedirs(empty, exist_ok=True)
        rc, out = run([empty, '--no-log'])
        check('R2 目录无视频 → rc=2', rc == 2 and '没有视频' in out, 'rc=%d' % rc)

        # R3 靶子先得是个存在的文件（否则先撞「没有视频」的 E-INPUT，测不到工具缺失分支）
        fake = os.path.join(tmp, '假片段.mp4')
        open(fake, 'w').close()
        rc, out = run([fake, '--ffmpeg', os.path.join(tmp, '不存在的工具目录'), '--no-log'])
        check('R3 --ffmpeg 指向不存在目录 → rc=2（显式指路不回退 PATH）',
              rc == 2 and '运行时缺失' in out, 'rc=%d out=%s' % (rc, out.strip()[:80]))

        if not has_ffmpeg():
            print('⏭  R4~R9 跳过（无 ffmpeg）——跳过不是通过；本机装 ffmpeg 后这套才有意义。')
            return 0 if all(ok for _, ok, _ in rows) else 1

        ff = shutil.which('ffmpeg')
        clips = {}

        def make(key, video, audio, dur, size='320x180'):
            clips[key] = os.path.join(tmp, key + '.mp4')
            return make_clip(ff, clips[key], video, audio, dur, size)

        assert make('normal', 'testsrc2', 'sine=frequency=440', 5)
        assert make('black', 'color=c=black', 'sine=frequency=440', 5)
        assert make('freeze', 'color=c=red', 'sine=frequency=440', 5)
        assert make('silent', 'testsrc2', 'anullsrc=channel_layout=mono:sample_rate=44100', 5)
        assert make('ar43', 'testsrc2', 'sine=frequency=440', 4, '320x240')
        assert make('long8', 'testsrc2', 'sine=frequency=440', 8)

        rc, out = run([clips['normal'], '--no-log'])
        check('R4 正常片段 → 0 警告 rc=0', rc == 0 and '0 条警告' in out,
              'rc=%d out=%s' % (rc, out.strip().splitlines()[-1] if out.strip() else ''))

        rc, out = run([clips['black'], '--no-log'])
        check('R5 全黑片段 → W-RENDER-BLACK', 'W-RENDER-BLACK' in out, out[-200:])

        rc, out = run([clips['freeze'], '--no-log'])
        check('R6 静止纯色 → W-RENDER-FREEZE', 'W-RENDER-FREEZE' in out, out[-200:])

        rc, out = run([clips['silent'], '--no-log'])
        check('R7 无声片段 → W-RENDER-SILENT', 'W-RENDER-SILENT' in out, out[-200:])

        rc, out = run([clips['ar43'], '--no-log'])
        check('R8 4:3 按 16:9 检 → W-RENDER-AR', 'W-RENDER-AR' in out, out[-200:])

        plan = os.path.join(tmp, '包.md')
        with open(plan, 'w', encoding='utf-8') as f:
            f.write('# 段 1｜测试（4s）\n—— 以下不进正文 ——\n# duration: 4s | # ratio: 16:9\n')
        rc, out = run([clips['long8'], '--plan', plan, '--no-log'])
        check('R9 8s 片段对 4s 声明 → W-RENDER-PLAN', 'W-RENDER-PLAN' in out, out[-200:])

        # --json 纯度（stdout 可直接 json.loads）
        rc, out = run([clips['normal'], '--json', '--no-log'])
        try:
            d = json.loads(out)
            ok = d['checked'] == 1
        except ValueError:
            ok = False
        check('R10 --json stdout 纯 JSON', ok, out[:120])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print('\n结果：%d 过 / %d 败' % (sum(1 for _, ok, _ in rows if ok),
                                    sum(1 for _, ok, _ in rows if not ok)))
    for name, ok, why in rows:
        if not ok:
            print('  ✗ %s：%s' % (name, why))
    return 0 if all(ok for _, ok, _ in rows) else 1


if __name__ == '__main__':
    sys.exit(main())
