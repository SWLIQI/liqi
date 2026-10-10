#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
slice_reference.py —— 把角色设定卡裁成可直接投喂视频模型的单张参考图

为什么需要这一步
----------------
所有角色资产卡都是"拼版图"。整张丢给视频模型有三个问题：

  1. 一张图里出现多个人，模型分不清哪个是主体，身份锚模糊
  2. 全身格里那张脸只有三百 px 上下，模型读不出五官，会自己编一张
  3. 蓝图网格、引线注释、色板、身高刻度线全是噪声

所以必须裁开单喂，并在提示词里用 @Image1 / @Image2 声明每张图的用途。

版式对应（本 skill 的资产层规范见 references/资产层_锁定与一致性.md）
--------------------------------------------------------------------
  **4view（默认版式）**  左区头部近景（身份锚）+ 右区无头三联（正面 / 90° 侧面 / 背面）
  dualview               左脸特写 + 右全身正面          —— 按需补出的单卡
  sideback               左纯侧头 + 右纯背头            —— 按需补出的单卡
  9view                  左 2/3 全身三视图 + 右 1/3 六表情 —— 本 skill 默认不出，兼容保留

用法
----
  python slice_reference.py 角色A_4view.png --layout 4view          （默认版式）
  python slice_reference.py 角色A_侧背补锚.png --layout sideback
  python slice_reference.py 角色A_九视图.png --layout 9view --expr 平静,担忧,疲惫,释然,焦急,含笑
  python slice_reference.py 卡片.png --layout 4view --ratio 0.25 --margin 12 --gap 4
  python slice_reference.py 卡片.png --layout 4view --full front,side,back --heads 6.5
  （--expr 只是给裁出文件起名，不影响画面；表情名从剧本场记提取可点击率更高）

输出
----
  默认在图片同目录建 <图片名>_slices/，内含裁好的子图 + manifest.txt（投喂清单）

依赖
----
  Pillow  （pip install pillow）
"""

import argparse
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("缺少 Pillow。先装：pip install pillow")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# 表情名只是文件名占位；正式项目用 --expr 传入从剧本场记提取的表情名
DEFAULT_EXPR = ["温柔", "惊讶", "坚定", "悲伤", "冷傲", "微笑"]
DEFAULT_FULL = ["front", "side", "back"]
FULL_CN = {"front": "正面", "side": "侧面", "back": "背面"}
# 4 View 版的右区三联是无头的，标签要带"无头"以免被误当身份锚
FULL_CN_HEADLESS = {"front": "无头正面", "side": "无头90°侧面", "back": "无头背面"}

LAYOUT_CN = {
    "4view": "4 View 资产板（左头部近景 + 右无头三联）——本 skill 默认版式",
    "dualview": "双视图人设卡（左脸 + 右全身）——按需补出的单卡",
    "sideback": "侧背头部特写卡（左侧头 + 右背头）——按需补出的单卡",
    "9view": "九视图人设卡（左全身三视图 + 右六表情）——本 skill 默认不出，兼容保留",
}


def slice_4view(img, ratio, full_names, margin, gap):
    """本 skill 的默认版式：左区头部近景（身份锚）+ 右区无头三联。

    右区三联（正面 / 90° 侧面 / 背面）都是**无头**的，只承担服装廓形、
    侧背结构与机位体型参考，不参与锁脸。左区头部近景是唯一像素够当
    身份锚的一格（3840x2160 下裁开脸约 1920 px，右区全身格里的脸仅约 320 px）。
    """
    W, H = img.size
    left_w = W * ratio
    right_w = W - left_w
    out = [((0, 0, left_w, H), "face_hd", "face_hd", "头部近景（身份锚）")]

    col_w = right_w / 3
    for col in range(3):
        box = (left_w + col * col_w, 0, left_w + (col + 1) * col_w, H)
        key = full_names[col] if col < len(full_names) else "v%d" % (col + 1)
        cn = FULL_CN_HEADLESS.get(key, FULL_CN.get(key, key))
        out.append((box, "full", safe_name(key), cn))
    return out


def safe_name(s):
    """文件名安全化：去掉 Windows 非法字符"""
    bad = '<>:"/\\|?*'
    for c in bad:
        s = s.replace(c, "")
    return s.strip() or "x"


def dispw(s):
    """显示宽度：中日韩全角字符按 2 计，其余按 1 计"""
    return sum(2 if ord(c) > 0x2E80 else 1 for c in s)


def pad(s, width):
    """按显示宽度右填充空格，保证终端里中文也能对齐"""
    return s + " " * max(0, width - dispw(s))


def crop_box(box, img_w, img_h, margin=0, gap=0):
    """
    按格子坐标裁一块，可选整体边距与格子间隙。

    box = (col, row, cols, rows, x0, y0, w, h)  —— 简化为传入绝对像素矩形后处理
    这里 box 直接是 (left, top, right, bottom)
    margin: 整体安全边距（避开蓝图网格与边缘）
    gap:    格子之间再内缩，避免裁到分隔线
    """
    l, t, r, b = box
    l += gap
    t += gap
    r -= gap
    b -= gap
    # 夹到图像范围内，并考虑整体 margin
    l = max(margin, l)
    t = max(margin, t)
    r = min(img_w - margin, r)
    b = min(img_h - margin, b)
    return (int(l), int(t), int(r), int(b))


def slice_9view(img, wratio, expr_names, full_names, margin, gap):
    """2026-09-06 新版式：左 2/3 三个全身视图 + 右 1/3 3行x2列 表情头部特写

    旧版（上 2x3 表情 + 下 1x3 全身）把全身格压到 159 px 头高，侧背锚不可用。
    新版全身三视图占比提到三分之二（头部约 350 px），表情格竖排 3 行 2 列
    （头部约 600 px）。左区最左侧预留身高参照线带宽（约占左区宽度 6%），
    避免身高线被裁进正面格。
    """
    W, H = img.size
    left_w = W * wratio
    right_w = W - left_w
    out = []

    # 左区：身高线带宽 + 1 行 x 3 列 全身（正、侧、背 从左到右）
    hline_w = left_w * 0.06
    col_w = (left_w - hline_w) / 3
    for col in range(3):
        box = (
            hline_w + col * col_w,
            0,
            hline_w + (col + 1) * col_w,
            H,
        )
        key = full_names[col] if col < len(full_names) else "v%d" % (col + 1)
        cn = FULL_CN.get(key, key)
        out.append((box, "full", safe_name(key), cn))

    # 右区：3 行 x 2 列 表情
    for row in range(3):
        for col in range(2):
            idx = row * 2 + col
            box = (
                left_w + col * right_w / 2,
                row * H / 3,
                left_w + (col + 1) * right_w / 2,
                (row + 1) * H / 3,
            )
            name = expr_names[idx] if idx < len(expr_names) else "expr%d" % (idx + 1)
            out.append((box, "face", safe_name(name), name))

    return out


def slice_sideback(img, ratio, margin, gap):
    """左 50% 纯侧面头部特写 + 右 50% 纯背面头部特写（侧背补锚卡）"""
    W, H = img.size
    return [
        ((0, 0, W * ratio, H), "face_hd", "side", "纯侧面头部特写"),
        ((W * ratio, 0, W, H), "face_hd", "back", "纯背面头部特写"),
    ]


def slice_dualview(img, ratio, full_names, margin, gap):
    """左 60% 脸部特写 + 右 40% 全身正面"""
    W, H = img.size
    out = [
        # 双视图左侧按排版段"头部占左侧区域高度的90%"，所以单独用 face_hd 类目
        ((0, 0, W * ratio, H), "face_hd", "face_hd", "脸部高清特写"),
        ((W * ratio, 0, W, H), "full", safe_name(full_names[0]), FULL_CN.get(full_names[0], "全身")),
    ]
    return out


def estimate_face_px(kind, box, heads):
    """
    估算裁出图里"头部高度约多少像素"。
    这是判断能不能当参考图的核心指标。
    """
    _, t, _, b = box
    h = b - t
    if kind == "face_hd":
        # 双视图左侧：排版段写死"头部占左侧区域高度的90%"
        return int(h * 0.90)
    if kind == "face":
        # 九视图表情格（新版式 3行x2列，格子接近方形）：头部约占格高 85%
        return int(h * 0.85)
    return int(h * 0.90 / heads)  # 全身格里，人占 90% 格高，头 = 身高/头身比


def verdict(px):
    """给个够不够用的判断"""
    if px == 0:
        return "无头格，不参与锁脸（服装廓形 / 侧背结构参考）"
    if px >= 900:
        return "优秀，可直接当主身份锚"
    if px >= 500:
        return "够用，可用作身份锚"
    if px >= 250:
        return "勉强，建议配合脸部特写一起喂"
    return "偏小，模型读不出五官，会自己编脸——不要用这张当身份锚"


def write_manifest(path, src, slices, files, heads, layout):
    """纯文本投喂清单（不用 Markdown 符号，方便直接看）"""
    L = []
    A = L.append
    A("=" * 72)
    A("参考图投喂清单")
    A("=" * 72)
    A("")
    A("源文件：%s" % os.path.basename(src))
    A("布局  ：%s" % LAYOUT_CN.get(layout, layout))
    A("头身比：%s（用于估算头部像素）" % heads)
    A("")
    A("裁出 %d 张。下表按推荐用途排序，@ 编号即为视频模型的引用标签。" % len(files))
    A("")
    A("-" * 86)
    A("%s %s %s %s" % (pad("文件名", 32), pad("用途", 12), pad("头部px", 8), "评估"))
    A("-" * 86)
    for fname, kind, label, px in files:
        A("%s %s %s %s" % (pad(fname, 32), pad(label, 12), pad(str(px), 8), verdict(px)))
    A("-" * 86)
    A("")
    A("怎么用")
    A("-" * 72)
    A("1. 别把整张设定卡丢给视频模型。一张图里多个人，模型分不清主体。")
    A("2. 每个镜头选 2-4 张就够，不是越多越好。")
    A("3. 提示词里必须写 @ 标签声明每张图的用途，例如：")
    A("")
    A("   @Image1 is the main character (identity reference).")
    A("   @Image2 is the same character, full body, front view.")
    A("   The character walks toward camera. Camera holds static.")
    A("")
    A("   不写 @ 标签，模型就得猜每张图是什么，命中率会明显下降。")
    A("")
    A("分工（谁有资格当锚，看头部像素说话）")
    A("-" * 72)
    if layout == "4view":
        A("  正面身份锚（五官）        左区头部近景裁出的 face_hd，头部约 1900 px")
        A("  服装廓形（正面）          右区 full_front，无头，脸不参与锁脸")
        A("  侧面结构                  右区 full_side，无头，仅廓形与厚度")
        A("  背面结构                  右区 full_back，无头，仅廓形与衣背纹样")
        A("")
        A("  ⚠️ 右区三联是无头的。片中有侧脸 / 背身【特写】时，另出侧背头部特写卡")
        A("     （--layout sideback），否则转过去的镜没有侧背头部的锚。")
    else:
        A("  正面身份锚（五官）        双视图裁出的 face_hd，头部约 1900 px")
        A("  侧面锚（鼻梁下颌轮廓）    侧背补锚卡裁出的 face_side，约 1900 px")
        A("  背面锚（后脑发型发髻）    侧背补锚卡裁出的 face_back，约 1900 px")
        A("  表情参考                  九视图 face_* 表情格，约 600 px，锁不住五官")
        A("  机位 / 体型 / 服装        九视图 full_* 全身格，脸约 320 px，别指望锁脸")
        A("")
        A("  注：九视图卡不是本 skill 的默认版式，仅在有明确表情库需求时使用。")
    A("")
    A("推荐组合（每个镜头 2-3 张，不是越多越好）")
    A("-" * 72)
    if layout == "4view":
        A("  近景 / 情绪镜头      face_hd（+ 表情参考卡，若有）")
        A("  全身 / 走位镜头      full_front + face_hd")
        A("  侧面 / 侧脸特写      face_hd + full_side（+ 侧背头部特写卡）")
        A("  背面 / 背身镜头      full_back + face_hd（+ 侧背头部特写卡）")
        A("  过肩镜头             face_hd + full_back（肩前景）")
        A("  转身镜头             首帧 full_back -> 尾帧 face_hd（首尾帧法）")
    else:
        A("  近景 / 情绪镜头      face_hd + 对应的九视图表情格")
        A("  全身 / 走位镜头      full_front + face_hd")
        A("  侧面 / 侧脸特写      face_side + face_hd")
        A("  背面 / 背身镜头      face_back + full_back + face_hd")
        A("  过肩镜头             face_hd + full_back（肩前景）")
        A("  转身镜头             首帧 full_back -> 尾帧 face_hd（首尾帧法）")
    A("")
    A("铁律一：任何镜头都要带一张 face_hd。")
    A("        全身图单独喂脸一定会漂——图里那张脸只有三百多像素，")
    A("        模型读不出五官，就会按自己的先验编一张脸给你。")
    A("铁律二：侧面和背面镜头必须额外带 face_side / face_back。")
    A("        只给正面脸，模型不知道这人侧脸什么样、后脑勺什么样，")
    A("        转过去就换了张脸。")
    A("转身技巧：用首尾帧，首帧给背身、尾帧给正脸，让模型在两个锚之间")
    A("          生成转身动作——用动作本身强制身份一致，比单喂背面图稳。")
    A("")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L))


def guess_layout(path):
    """按文件名猜布局，猜不出就用 4view（本 skill 的默认版式）"""
    n = os.path.basename(path)
    # 侧背要最先判断：文件名里可能同时含"转面""双视"之类
    for kw in ("sideback", "侧背", "转面补", "补锚"):
        if kw in n:
            return "sideback"
    for kw in ("4view", "四视图", "资产板"):
        if kw in n:
            return "4view"
    for kw in ("dual", "双视图", "双视", "dualview"):
        if kw in n:
            return "dualview"
    for kw in ("9view", "九视图", "九视", "人设卡"):
        if kw in n:
            return "9view"
    return "4view"


def main():
    ap = argparse.ArgumentParser(
        description="把角色设定卡裁成可直接投喂视频模型的单张参考图",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("image", help="设定卡图片路径")
    ap.add_argument("-o", "--out", default=None, help="输出目录（默认：图片同目录/<图片名>_slices）")
    ap.add_argument("-l", "--layout", default=None,
                    choices=["4view", "9view", "dualview", "sideback"],
                    help="布局：4view=左头部近景+右无头三联（本 skill 默认版式）/ "
                         "dualview=左脸+右全身 / sideback=左侧脸特写+右背头特写 / "
                         "9view=左2/3全身三视图+右1/3六表情（兼容保留，默认不出）"
                         "（默认按文件名自动判断，判不出用 4view）")
    ap.add_argument("--expr", default=None,
                    help="表情名，逗号分隔（9view 用，从剧本场记提取；默认占位：%s）"
                         % ",".join(DEFAULT_EXPR))
    ap.add_argument("--full", default=None,
                    help="全身视图名，逗号分隔（默认：%s）" % ",".join(DEFAULT_FULL))
    ap.add_argument("--ratio", type=float, default=None,
                    help="左右分界比例（4view 默认 0.25，9view 默认 0.667，"
                         "dualview 默认 0.6，sideback 默认 0.5）")
    ap.add_argument("--margin", type=int, default=0,
                    help="整体安全边距（像素），用于避开蓝图网格与边缘，建议 8-16")
    ap.add_argument("--gap", type=int, default=0,
                    help="格子间隙（像素），用于避开分隔线，建议 2-6")
    ap.add_argument("--heads", type=float, default=6.0,
                    help="头身比，用于估算头部像素（默认 6）")
    ap.add_argument("--no-manifest", action="store_true", help="不生成投喂清单")

    args = ap.parse_args()

    src = args.image
    if not os.path.isfile(src):
        sys.exit("找不到图片：%s" % src)

    layout = args.layout or guess_layout(src)
    expr_names = [s.strip() for s in args.expr.split(",")] if args.expr else DEFAULT_EXPR
    full_names = [s.strip() for s in args.full.split(",")] if args.full else DEFAULT_FULL

    img = Image.open(src)
    W, H = img.size
    prefix = os.path.splitext(os.path.basename(src))[0]

    outdir = args.out or os.path.join(os.path.dirname(os.path.abspath(src)), prefix + "_slices")
    os.makedirs(outdir, exist_ok=True)

    print("源文件：%s" % src)
    print("尺寸  ：%d x %d" % (W, H))
    print("布局  ：%s" % LAYOUT_CN.get(layout, layout))
    print("输出  ：%s" % outdir)
    print()

    ratio = args.ratio if args.ratio is not None else \
        {"4view": 0.25, "dualview": 0.6, "sideback": 0.5, "9view": 0.667}[layout]

    if layout == "4view":
        slices = slice_4view(img, ratio, full_names, args.margin, args.gap)
    elif layout == "9view":
        slices = slice_9view(img, ratio, expr_names, full_names, args.margin, args.gap)
    elif layout == "sideback":
        slices = slice_sideback(img, ratio, args.margin, args.gap)
    else:
        slices = slice_dualview(img, ratio, full_names, args.margin, args.gap)

    files = []
    for box, kind, slug, label in slices:
        cb = crop_box(box, W, H, args.margin, args.gap)
        if cb[2] <= cb[0] or cb[3] <= cb[1]:
            print("  跳过（裁切后为空）：%s" % label)
            continue
        px = estimate_face_px(kind, cb, args.heads)
        if layout == "4view" and kind == "full":
            px = 0  # 4 View 右区三联是无头的，估"脸像素"没有意义
        if kind == "face_hd":
            # sideback 卡两格都是 face_hd，用 slug 区分（side / back）
            fname = ("%s_face_hd.png" % prefix) if slug == "face_hd" \
                else ("%s_face_%s.png" % (prefix, slug))
        elif kind == "face":
            fname = "%s_face_%s.png" % (prefix, slug)
        else:
            fname = "%s_full_%s.png" % (prefix, slug)
        fp = os.path.join(outdir, fname)
        img.crop(cb).save(fp)
        files.append((fname, kind, label, px))
        print("  %-34s %5dx%-5d  头部约 %4d px  %s"
              % (fname, cb[2] - cb[0], cb[3] - cb[1], px, verdict(px)))

    if not args.no_manifest:
        mp = os.path.join(outdir, "manifest.txt")
        write_manifest(mp, src, slices, files, args.heads, layout)
        print()
        print("投喂清单：%s" % mp)

    print()
    print("完成，共 %d 张。" % len(files))


if __name__ == "__main__":
    main()
