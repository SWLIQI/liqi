#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audit_render.py —— 渲染产物机检（v5.51.0 · C15 空白补齐）

管线此前止于「提示词交付」：包全绿之后，渲出来的片段是黑屏、冻帧、无声、
时长对不上——没有任何一道门管。这门补的就是这最后一公里。

思想来源（W6/C15，外部Skill吸收裁决总表）：calesthio/OpenMontage（AGPLv3）的
「渲染后自审」验证了这条路可行。**本实现零代码零文本拷贝**（AGPL 传染性），
全部基于 ffmpeg 公开内置滤镜 blackdetect / freezedetect / volumedetect 与 ffprobe。

查五件事（全部 WARN 级——渲染判读是人工决策域，机检只供证据）：
  W-RENDER-PLAN      片段时长与包.md 段时长对账（--plan 时启用；±1.5s 容差，
                     容差来源：生成端返回时长常按帧取整；段数对不上也报）
  W-RENDER-AR        画幅与锁②（默认 16:9，--ar 可改）偏差 >2%
  W-RENDER-BLACK     黑帧区间 ≥0.5s（blackdetect；结尾 ≤1.5s 的黑场视为淡出，豁免）
  W-RENDER-FREEZE    冻帧区间 ≥1.0s（freezedetect；**结尾 ≤2.5s 的冻结豁免**——
                     段缝①尾帧锚定法本来就要末 1 秒全体静止定格，那是工序不是事故）
  W-RENDER-SILENT    无音轨或整段平均响度 ≤ -55dB（volumedetect；默片是合法选择，
                     报出来由人判）

假绿防线（与 Z 门 / G7 / E-NO-BODY-SCANNED 同一口径）：
  - 路径不存在 / 目录里一个视频都没有 / ffprobe 不可用 → 退出码 2 + 明确提示，
    绝不「没查说通过」。
  - 找得到工具但一个判据都没跑成 → 报 ERROR 退出 1。

用法：
  python scripts/audit_render.py <视频文件或目录> [--plan 包.md] [--ar 16:9]
                                 [--strict] [--json] [--no-log] [--ffmpeg 目录]
  退出码：0 无警告 / 1 有警告或 ERROR / 2 输入与运行时缺失（同库内口径）
  日志：默认追加 .gates.jsonl 到被检视频同目录（gates_log.py，origin 自动判定）。
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gates_log  # noqa: E402

VIDEO_EXTS = ('.mp4', '.mov', '.webm', '.mkv')
CODES = []          # [(level, code, where, msg, hint)]
WARN = 'warn'


def issue(code, where, msg, hint=''):
    CODES.append({'level': WARN, 'code': code, 'where': where, 'msg': msg, 'hint': hint})


def find_tools(ffmpeg_dir):
    """定位 ffmpeg/ffprobe。--ffmpeg 显式目录是权威（找不到即失败，不回退 PATH——
    显式指路还静默换路，用户会以为查的是他指定的那份）；未给时用 shutil.which 找 PATH。"""
    import shutil
    if ffmpeg_dir:
        ext = '.exe' if os.name == 'nt' else ''
        ff = os.path.join(ffmpeg_dir, 'ffmpeg' + ext)
        fp = os.path.join(ffmpeg_dir, 'ffprobe' + ext)
        if os.path.isfile(ff) and os.path.isfile(fp):
            return ff, fp
        return None, None
    return shutil.which('ffmpeg'), shutil.which('ffprobe')


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return r.returncode, (r.stderr or '') + (r.stdout or '')


def parse_plan_durations(plan_path):
    """从包.md 抽每段时长：# duration: Ns 按出现顺序。"""
    try:
        with open(plan_path, encoding='utf-8') as f:
            text = f.read()
    except OSError:
        return None
    return [float(m) for m in re.findall(r'#\s*duration\s*[:：]\s*(\d+(?:\.\d+)?)s', text)]


def probe(fp, path):
    """返回 (duration_s, w, h, has_audio) 或 None。"""
    rc, out = run([fp, '-v', 'error', '-show_entries',
                   'format=duration:stream=width,height,codec_type',
                   '-of', 'json', path])
    if rc != 0:
        return None
    try:
        d = json.loads(out)
    except ValueError:
        return None
    dur = float(d['format'].get('duration') or 0)
    w = h = 0
    has_audio = False
    for s in d.get('streams', []):
        if s.get('codec_type') == 'video' and not w:
            w, h = int(s.get('width') or 0), int(s.get('height') or 0)
        if s.get('codec_type') == 'audio':
            has_audio = True
    return dur, w, h, has_audio


def detect_black(ff, path):
    """blackdetect：返回 [(start, end)]。结尾 ≤1.5s 的黑场视为淡出，剔除。"""
    rc, out = run([ff, '-v', 'info', '-i', path, '-vf', 'blackdetect=d=0.5:pix_th=0.05',
                   '-an', '-f', 'null', '-'])
    hits = []
    total = 0.0
    for m in re.finditer(r'black_start:([\d.]+)\s+black_end:([\d.]+)', out):
        s, e = float(m.group(1)), float(m.group(2))
        total = max(total, e)
        hits.append((s, e))
    if not hits:
        return []
    # 剔除片尾淡出（黑场起点落在总长 -1.5s 之后）
    return [(s, e) for s, e in hits if s < total - 1.5]


def detect_freeze(ff, path, dur):
    """freezedetect：返回 [(start, end)]；结尾 ≤2.5s 冻结豁免（段缝①定格是工序）。
    注意：冻到片尾时 ffmpeg 只打 freeze_start、永远不打 freeze_end——
    有 start 无 end 的区间按「冻到 EOF（end=dur）」处理，否则冻尾漏检。"""
    rc, out = run([ff, '-v', 'info', '-i', path, '-vf', 'freezedetect=n=0.001:d=1.0',
                   '-an', '-f', 'null', '-'])
    # 注意：freezedetect 日志冒号后带空格（freeze_start: 0），blackdetect 不带——\s* 两者通吃
    starts = [float(m.group(1)) for m in re.finditer(r'freeze_start:\s*([\d.]+)', out)]
    ends = iter(float(m.group(1)) for m in re.finditer(r'freeze_end:\s*([\d.]+)', out))
    hits = []
    nxt_end = next(ends, None)
    for s in starts:
        if nxt_end is not None and nxt_end >= s:
            e = nxt_end
            nxt_end = next(ends, None)
        else:
            e = dur
        hits.append((s, e))
    return [(s, e) for s, e in hits if s < dur - 2.5]


def detect_audio(ff, path):
    """volumedetect：返回 (有音轨判断留给 probe，这里返回 mean_volume dB 或 None)。"""
    rc, out = run([ff, '-v', 'info', '-i', path, '-af', 'volumedetect',
                   '-vn', '-f', 'null', '-'])
    m = re.search(r'mean_volume:\s*(-?[\d.]+)\s*dB', out)
    return float(m.group(1)) if m else None


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument('target', help='视频文件或目录')
    ap.add_argument('--plan', help='包.md：按 # duration 行做时长对账')
    ap.add_argument('--ar', default='16:9', help='期望画幅（默认 16:9，按锁②）')
    ap.add_argument('--ffmpeg', help='ffmpeg/ffprobe 所在目录（默认 PATH）')
    ap.add_argument('--strict', action='store_true', help='警告也算失败（exit 1 语义不变，报告措辞变化）')
    ap.add_argument('--json', action='store_true', help='stdout 只有 JSON')
    ap.add_argument('--no-log', action='store_true')
    args = ap.parse_args()

    target = args.target
    if not os.path.exists(target):
        print('[ERROR] E-INPUT：路径不存在——%s' % target)
        return 2
    clips = []
    if os.path.isdir(target):
        for f in sorted(os.listdir(target)):
            if f.lower().endswith(VIDEO_EXTS):
                clips.append(os.path.join(target, f))
    else:
        clips = [target]
    if not clips:
        print('[ERROR] E-INPUT：目标里没有视频文件（%s）——空目录不是通过' % target)
        return 2

    ff, fp = find_tools(args.ffmpeg)
    if not (ff and fp):
        print('[ERROR] 运行时缺失：找不到 ffmpeg/ffprobe——本门查的是渲染产物，没有它一个判据都跑不了。')
        print('        补法：装 ffmpeg 后重跑，或用 --ffmpeg <目录> 指定位置（本门跳过 ≠ 通过）。')
        return 2

    plan_durs = parse_plan_durations(args.plan) if args.plan else None
    if args.plan and plan_durs is None:
        print('[ERROR] E-INPUT：--plan 文件读不出任何「# duration: Ns」——对账无从做起。')
        return 2

    try:
        aw, ah = [float(x) for x in args.ar.split(':')]
        want_ratio = aw / ah
    except (ValueError, ZeroDivisionError):
        print('[ERROR] E-INPUT：--ar 格式应为 W:H（如 16:9）')
        return 2

    checked = 0
    for i, clip in enumerate(clips):
        name = os.path.basename(clip)
        info = probe(fp, clip)
        if info is None:
            issue('W-RENDER-UNREADABLE', name, 'ffprobe 读不出流信息（文件损坏或非视频）')
            continue
        dur, w, h, has_audio = info
        checked += 1
        # 画幅
        if w and h:
            ratio = w / h
            if abs(ratio - want_ratio) / want_ratio > 0.02:
                issue('W-RENDER-AR', name,
                      '画幅 %d:%d（%.3f）偏离锁② %s（%.3f）超过 2%%' % (w, h, ratio, args.ar, want_ratio),
                      '先查是否用错模板/错平台档；正片与预演档分辨率可能不同')
        # 时长对账
        if plan_durs is not None:
            if i < len(plan_durs):
                if abs(dur - plan_durs[i]) > 1.5:
                    issue('W-RENDER-PLAN', name,
                          '时长 %.1fs 与包内第 %d 段声明的 %.0fs 对不上（容差 ±1.5s）'
                          % (dur, i + 1, plan_durs[i]),
                          '生成端按帧取整属正常；差 1 秒以上先查是否截断或串段')
            elif len(clips) != len(plan_durs) and i == len(plan_durs):
                issue('W-RENDER-PLAN', name,
                      '片段数（%d）多于包内段数（%d）——多渲了还是包漏写段？' % (len(clips), len(plan_durs)))
        # 黑帧
        for s, e in detect_black(ff, clip):
            issue('W-RENDER-BLACK', name, '黑帧区间 %.1fs→%.1fs（长 %.1fs）' % (s, e, e - s),
                  '片头片尾 ≤1.5s 黑场已按淡出豁免；区间在中段多半是渲染失败')
        # 冻帧（结尾定格是段缝①工序，已豁免）
        for s, e in detect_freeze(ff, clip, dur):
            issue('W-RENDER-FREEZE', name, '冻帧区间 %.1fs→%.1fs（长 %.1fs）' % (s, e, e - s),
                  '结尾 ≤2.5s 定格已按段缝①豁免；中段冻结查循环播放/节拍供给不足')
        # 音频
        if not has_audio:
            issue('W-RENDER-SILENT', name, '无音轨',
                  '默片是合法选择——四层混音包报这句属预期则忽略')
        else:
            mv = detect_audio(ff, clip)
            if mv is None or mv <= -55:
                issue('W-RENDER-SILENT', name,
                      '平均响度测不出或 ≤ -55 dB（近无声）' if mv is None
                      else '平均响度 %.0f dB（近无声）' % mv,
                      '查音轨是否生成失败或整段被静音')

    if checked == 0 and not CODES:
        print('[ERROR] 一段都没查成——工具在、文件在，但 probe 全部失败，这不该发生。')
        return 1
    if len(clips) != len(plan_durs or []) and plan_durs is not None and len(clips) < len(plan_durs):
        issue('W-RENDER-PLAN', '(对账)', '片段数（%d）少于包内段数（%d）——有段没渲出来'
              % (len(clips), len(plan_durs)))

    if args.json:
        print(json.dumps({'clips': len(clips), 'checked': checked,
                          'codes': {c['code']: sum(1 for x in CODES if x['code'] == c['code'])
                                    for c in CODES},
                          'issues': CODES}, ensure_ascii=False, indent=2))
    else:
        for c in CODES:
            print('[%s] %s  %s\n      · %s' % (c['level'].upper(), c['code'], c['where'], c['msg']))
            if c['hint']:
                print('        %s' % c['hint'])
        print('-' * 60)
        if plan_durs is None:
            note = '（未给 --plan：时长对账本门未查，不是通过）'
        else:
            note = ''
        print('结果：%d 段检查 / %d 条警告 %s' % (checked, len(CODES), note))
        print('提示：本门只供证据，渲染判读（画质/表演/一致性）仍按 Step 4 人工复核。')

    if not args.no_log:
        gates_log.append_gate_log('audit_render.py', clips[0],
                                  1 if CODES else 0,
                                  [{'level': WARN, 'code': c['code']} for c in CODES])
    return 1 if CODES else 0


if __name__ == '__main__':
    sys.exit(main())
