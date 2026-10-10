#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""情绪张力曲线绘图与法则自检。

对应超级 liqi提示词 的 Step -1 第 4 项：量化全片节拍点（0~10 分），画出曲线。

本脚本只实现「可移植的两条法则」（见 references/叙事层_剧本门控与台词.md）：
  法则一  全片波峰（>=9.0）不少于 2 次
  法则二  高潮之间必须有回落（相邻波峰之间至少一个点比前波峰低 >=1.0）
  法则三  严禁持续平庸（极差 < 2.0 视为平铺）

刻意不内置老李面向抖音短剧的 12 节拍命名与分值（起势/硬刚/反杀那一套）——
那套结构对文艺短片、毕设、公益片会反向伤害，已在冲突裁决 C15 中判定不吸收。
默认示例改用题材无关的五幕结构。

用法：
  python generate_emotion_curve.py                                  # 五幕示例 + 自检
  python generate_emotion_curve.py --beats "3.0,5.5,9.2,4.2,9.0"    # 只给分值
  python generate_emotion_curve.py --beats "引子:3,冲突:5.5,转折:9.2,回落:4.2,收束:9"
  python generate_emotion_curve.py --beats-file beats.csv --out curve.png
  python generate_emotion_curve.py --beats "..." --out curve.png --no-plot   # 只自检

beats.csv 每行 `名称,分值`（无表头），或单行逗号分隔分值。
"""
import argparse
import os
import sys

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except ImportError:
    sys.exit("缺少 matplotlib。先装：pip install -r requirements.txt")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# 峰 / 谷阈值
PEAK = 9.0
MIN_PEAKS = 2
FALLBACK = 1.0      # 相邻波峰之间要求的回落幅度
FLAT_SPAN = 2.0     # 低于此极差视为平铺

# 题材无关的五幕示例：两个波峰（9.2 / 9.0），中间有一次明显回落（4.2）
DEFAULT_BEATS = [
    ("第一幕 起", 3.0),
    ("第二幕 承", 5.5),
    ("第三幕 转", 9.2),
    ("第四幕 合", 4.2),
    ("第五幕 收", 9.0),
]


def setup_cjk_font():
    """配置可用的中文字体。Windows / macOS / Linux 三平台路径都要带。

    旧版只列了 macOS 与 Linux 路径，在 Windows 上中文标签全变方块
    （实测 UserWarning: Glyph 3341 缺失）。这里补上 Windows 的 msyh / simhei。
    """
    candidates = [
        r"C:\Windows\Fonts\msyh.ttc",            # Windows 微软雅黑
        r"C:\Windows\Fonts\msyhbd.ttc",
        r"C:\Windows\Fonts\simhei.ttf",          # Windows 黑体
        r"C:\Windows\Fonts\simsun.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",   # macOS
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",   # Linux
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    ]
    from matplotlib import font_manager
    for path in candidates:
        if not os.path.exists(path):
            continue
        try:
            font_manager.fontManager.addfont(path)
            name = font_manager.FontProperties(fname=path).get_name()
            matplotlib.rcParams["font.family"] = name
            matplotlib.rcParams["axes.unicode_minus"] = False
            return name
        except Exception:
            continue
    # 系统字体库里按名字捞一次（某些发行版字体装在别处）
    for name in ("Microsoft YaHei", "SimHei", "Noto Sans CJK SC",
                 "Source Han Sans SC", "WenQuanYi Micro Hei", "PingFang SC"):
        try:
            if any(f.name == name for f in font_manager.fontManager.ttflist):
                matplotlib.rcParams["font.family"] = name
                matplotlib.rcParams["axes.unicode_minus"] = False
                return name
        except Exception:
            continue
    print("[!] 未找到中文字体，图中中文可能显示为方块", file=sys.stderr)
    return None


def parse_beats(spec):
    """`名称:分值` 或纯分值，逗号分隔。返回 [(名称, 分值), ...]。"""
    out = []
    for i, seg in enumerate([s.strip() for s in spec.split(",") if s.strip()], 1):
        if ":" in seg or "：" in seg:
            k, v = seg.replace("：", ":").split(":", 1)
            out.append((k.strip(), float(v)))
        else:
            out.append(("第 %d 拍" % i, float(seg)))
    return out


def load_beats_file(path):
    beats = []
    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            s = s.replace("，", ",").replace("：", ":")
            parts = s.split(",")
            if len(parts) >= 2:
                beats.append((parts[0].strip(), float(parts[1])))
            else:
                beats.append((parts[0].strip(), float(parts[1])))
    return beats


def check_laws(beats):
    """返回 (通过与否, 结论行列表)。"""
    names = [b[0] for b in beats]
    scores = [b[1] for b in beats]
    lines, ok = [], True

    peaks = [i for i, s in enumerate(scores) if s >= PEAK]
    lines.append("波峰（>=%.1f）：%d 个%s" % (
        PEAK, len(peaks),
        "　→ " + "、".join("%s(%.1f)" % (names[i], scores[i]) for i in peaks) if peaks else ""))
    if len(peaks) < MIN_PEAKS:
        ok = False
        lines.append("  [FAIL] 法则一：全片波峰不少于 %d 次，实为 %d 次" % (MIN_PEAKS, len(peaks)))
    else:
        lines.append("  [PASS] 法则一：波峰不少于 %d 次" % MIN_PEAKS)

    if len(peaks) >= 2:
        bad = []
        for a, b in zip(peaks, peaks[1:]):
            lo = min(scores[a:b + 1])
            if scores[a] - lo < FALLBACK:
                bad.append("%s → %s 之间最低仅 %.1f" % (names[a], names[b], lo))
        if bad:
            ok = False
            lines.append("  [FAIL] 法则二：高潮之间必须回落 %.1f 分以上 —— %s" % (FALLBACK, "；".join(bad)))
        else:
            lines.append("  [PASS] 法则二：相邻波峰之间均有 %.1f 分以上回落" % FALLBACK)
    else:
        lines.append("  [SKIP] 法则二：波峰不足 2 个，无法判定回落")

    span = max(scores) - min(scores)
    if span < FLAT_SPAN:
        ok = False
        lines.append("  [FAIL] 法则三：极差仅 %.1f，全片平铺（阈值 %.1f）" % (span, FLAT_SPAN))
    else:
        lines.append("  [PASS] 法则三：极差 %.1f，非平铺" % span)
    return ok, lines


def plot_curve(beats, out_png):
    names = [b[0] for b in beats]
    scores = [b[1] for b in beats]
    n = len(beats)
    xs = list(range(1, n + 1))

    fig, ax = plt.subplots(figsize=(max(9.0, 1.1 * n + 3.0), 5.4), dpi=170)
    ax.plot(xs, scores, marker="o", color="#C23B22", linewidth=2.5, markersize=8, zorder=4)
    for x, (name, val) in zip(xs, beats):
        ax.text(x, val + 0.28, "%.1f\n%s" % (val, name), ha="center", va="bottom",
                fontsize=9, color="#1F2A37", fontweight="bold")
    ax.axhspan(PEAK, 10.6, color="#C23B22", alpha=0.15, label="波峰区（>=%.1f）" % PEAK)
    ax.axhspan(6.5, PEAK, color="#E67E22", alpha=0.10, label="对峙区")
    ax.axhspan(0, 6.5, color="#3498DB", alpha=0.08, label="发展 / 蓄势区")

    ax.set_title("全片情绪张力曲线（节拍点 0~10 分）", fontsize=14,
                 color="#1F2A37", fontweight="bold", pad=16)
    ax.set_xlabel("节拍序号", fontsize=11, color="#1F2A37")
    ax.set_ylabel("戏剧张力 / 情绪值（0~10）", fontsize=11, color="#1F2A37")
    ax.set_ylim(0, 11.2)
    ax.set_xticks(xs)
    ax.set_xticklabels([str(x) for x in xs], fontsize=9)
    ax.grid(True, linestyle="--", alpha=0.55, zorder=0)
    ax.legend(loc="lower right", fontsize=9.5, frameon=False)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    fig.tight_layout()
    fig.savefig(out_png, facecolor="white")
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser(
        description="情绪张力曲线绘图 + 三条法则自检（波峰数 / 回落 / 防平铺）")
    ap.add_argument("--beats", help='逗号分隔，如 "3.0,5.5,9.2,4.2,9.0" 或 "引子:3,转折:9.2,收束:9"')
    ap.add_argument("--beats-file", help="CSV：每行 名称,分值（无表头）")
    ap.add_argument("--out", default="emotion_beat_curve.png", help="输出 PNG 路径")
    ap.add_argument("--no-plot", action="store_true", help="只跑法则自检，不出图")
    a = ap.parse_args()

    if a.beats:
        beats = parse_beats(a.beats)
    elif a.beats_file:
        beats = load_beats_file(a.beats_file)
    else:
        beats = DEFAULT_BEATS
        print("[i] 未提供节拍点，使用题材无关的五幕示例")

    if not beats:
        print("[X] 节拍点为空", file=sys.stderr)
        sys.exit(1)

    ok, lines = check_laws(beats)
    print("情绪张力曲线法则自检：%d 个节拍点" % len(beats))
    for l in lines:
        print(l)
    print("结论：%s" % ("通过" if ok else "未通过，回 Step -1 调整节拍"))

    if not a.no_plot:
        setup_cjk_font()
        plot_curve(beats, a.out)
        print("[+] 曲线已保存：%s" % a.out)

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
