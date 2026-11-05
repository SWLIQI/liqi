#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""liqi 边界回归（v5.32.0 · 夯实工程第三阶段产物 · 常驻资产）

第二阶段（判据层）抓到两枚真 bug：
  ① `audit_project` 长段收束判据 `findall` 只拿段前缀 → C 条件永不成立 → 从未放行过长段（跨机不一致·静默）
  ② `E-IDENTITY-NOT-INLINE` 假过复发：CAST_STOP 漏「本镜保真预算」，保真预算行的人名漏进身份文本
第三阶段（可执行层）实测异常输入：文件不存在 / 空文件 / >2MB / 拿错脚本 → 退出码 2（曾有一处裸抛 Traceback）

本脚本把五组**卡在边界上**的用例固化成常驻回归：以后改 `check_prompt.mjs` / `audit_project.py`
的判据，跑一遍就知道有没有把放行路径改坏、有没有让假过复发。

覆盖：
  L1  22s 三条件齐        → 双机都放行（无 W-OVER-20S）        ← Bug ① 回归锁
  L2  22s 缺【长段声明】   → 双机都报 W-OVER-20S
  B1  10s 镜台词 35 字     → 无 W-BEAT-TIME-OVERRUN（15% 容差内）
  B2  10s 镜台词 36 字     → 报 W-BEAT-TIME-OVERRUN
  I2  出场人物行整行删掉   → 报 E-IDENTITY-NOT-INLINE           ← Bug ② 回归锁
  G3-ok 持物变更行带字段   → G 门无 G3
  G3-bad 变更行缺字段     → 报 G3
  M1  2.0 面 20s          → 双机都判 E-OVER-30S（锁①硬上限）  ← MA-1/MA-2 回归锁（v5.37.1）
  M2  duration: -1        → JS 报 W-PARAM-DUR-AUTO、Python 不报「缺 duration」← MA-6 回归锁（v5.37.2）
  M3  2.0 面单镜 10 张图  → 双机都判 E-REF-OVER-LIMIT            ← MA-5 回归锁（v5.37.2）
  M4  2.5 面单镜 10 张图  → 双机都不报（素材档位没写死）          ← MA-5 反向锁（v5.37.2）
  N1  单镜短包            → 配额门报「未查」且不挂 S10~S13/S17/S18 ← 最小样本量正向锁（v5.37.3）
  N2  8 镜包              → 配额门照常跑（种数不够就报）           ← 最小样本量反向锁（v5.37.3）
  N3  全静态包（固定×3）  → 不报 S22「没有真正查过」、不报 S19     ← MOVE_WORDS 补「固定」（v5.37.3）

用法：python scripts/selftest_boundary.py
退出码：0 = 全过；1 = 有败
注意：需要 node（跑 check_prompt.mjs）；包与台账写入临时目录，跑完清理。
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
N = None  # 延迟解析
P = sys.executable

HEADER = '''# 边界回归包
【赛道】1 国内剧
【三锁】模型=2.5 ｜ 画幅=16:9 ｜ 投放面=国内面
【模型版本】：2.5
【风格】urban-folk-filmstill
【资产依赖分级】A2
素材形态：M1（编号占位 · 图号见文末接线单）
'''

BASE_SHOT = '''镜1｜楼道灯灭（8s）
场景：老旧居民楼三楼楼道（都市冷灰）｜人物：陈默
轴线：配电箱—消防栓连线，陈默在画面左三分之一，楼梯口在画面右
站位：@陈默（配电箱下方 · 画面左 · 侧身45°朝右 · 右手铁皮手电 · 左手垂在身侧）
位移：@陈默 配电箱下方→楼梯口前三步（起身上前，终态面向楼梯口）
出场人物：陈默（@图片1）——二十七八岁男性，短寸头，深蓝保安制服外套，右手一支铁皮手电
整体风格：一幅当代中国城市的写实实拍电影画面，取的是老胶片志怪剧照那一路。低饱和配色：都市冷灰为底，旧木暗褐压住暗部，唯一暖色重音只由画面里唯一的实用光源承担。
本镜保真预算：主 = 手电光柱里的墙面斑驳；次 = 楼道杂物
本镜光色基调：冷灰，主光为手电冷白窄束自右下斜上；色彩预算：单一色系
时间线分镜：
0-4s 全景 · 平视 · 固定 · 广角。陈默迈出两步，右手手电扫过墙面，声控灯座黑着｜声音：鞋底两声｜台词：无。
4-8s 全景 · 平视 · 固定 · 广角。他走到楼梯口前三步停住，光斑压在台阶边缘｜声音：脚步停｜台词：无。
声音设计（四层混音）：
环境层：通风管嗡鸣
动作层：鞋底两声
呼吸层：鼻息平稳
逼近层：无
对白：无
刚性约束：
必锁：铁皮手电 = 铁皮外壳，灯罩有划痕，光斑边缘发毛（锚「铁皮手电」图，@图片4）
Must not：可读文字、字幕、水印、logo
—— 以下不进正文 ——
# title: 镜1｜楼道灯灭 | # duration: 8s | # ratio: 16:9
'''

LEDGER = '''# 连续性台账

## 镜 1｜楼道 · 深夜

人物账：
- @陈默 站位：配电箱下方 ｜ 服装：深蓝制服 ｜ 持物：右手·铁皮手电 ｜ 姿态：站立

场景账：
- 时段：深夜
- 方位卡版本：lou-dao v1
- 尺度参照：无

时间轴账：
- 入口：E1 00:00
- 出口：E1 00:08
- 推进：连续

变更：
- 段内 ｜ @陈默 位置：配电箱下方 → 楼梯口前三步

## 镜 2｜楼道 · 深夜

人物账：
- @陈默 站位：门槛外 ｜ 服装：深蓝制服 ｜ 持物：右手·空（手电收袋） ｜ 姿态：俯身

场景账：
- 时段：深夜
- 方位卡版本：lou-dao v1
- 尺度参照：无

时间轴账：
- 入口：E1 00:08
- 出口：E1 00:15
- 推进：连续

变更：
- 段初 ｜ 持物：铁皮手电 @陈默右手 → 右袋（镜1 末已收）
'''


def two_shot(extra2, change_line):
    """双镜包：镜1 = BASE_SHOT；镜2 = 标题改放牌 + extra2 注入镜2 头部。"""
    shot2 = BASE_SHOT.replace('镜1｜楼道灯灭（8s）', '镜2｜放牌（7s）')
    shot2 = shot2.replace('# title: 镜1｜楼道灯灭 | # duration: 8s', '# title: 镜2｜放牌 | # duration: 7s')
    shot2 = shot2.replace('镜2｜放牌（7s）\n', '镜2｜放牌（7s）\n' + extra2)
    ledger = LEDGER.replace('- 段初 ｜ 持物：铁皮手电 @陈默右手 → 右袋（镜1 末已收）', change_line)
    return HEADER + BASE_SHOT + '\n' + shot2, ledger


CASES = []


def case(name, pkg, ledger=None, beats=None,
         cp_expect=(), cp_ban=(), ap_expect=(), ap_ban=(),
         ap_has=(), ap_absent=(), drop=None, cp_rc=None, cp_has=()):
    """ap_expect / ap_ban 认码号（E-xxx / W-xxx）；ap_has / ap_absent 认原文子串。

    v5.37.3 为什么要原文断言：「未查」按设计**不带码号**（它不是规则命中，是门没跑），
    但「跑没跑」恰恰是最要锁的东西。硬给它编一个 W- 码会把刚划清的 warn/skip 边界又糊掉，
    所以这类断言直接比对报告原文。
    """
    CASES.append(dict(name=name, pkg=pkg, ledger=ledger, beats=beats,
                      cp_expect=set(cp_expect), cp_ban=set(cp_ban),
                      ap_expect=set(ap_expect), ap_ban=set(ap_ban),
                      ap_has=list(ap_has), ap_absent=list(ap_absent), drop=drop or {},
                      # v5.37.8：`beats='__auto__'` = 传 `--beats auto`，让脚本自己到包旁边找。
                      # cp_rc / cp_has 是为了断言「找不到时必须退 2」这类**行为**，
                      # 而不只是「输出里有没有某个码」。
                      cp_rc=cp_rc, cp_has=list(cp_has)))


# ── L1 / L2：长段三条件（双机）
L1_SHOT = BASE_SHOT.replace('镜1｜楼道灯灭（8s）', '镜1｜长段三条件齐（22s）').replace(
    '# duration: 8s', '# duration: 22s').replace(
    '0-4s 全景 · 平视 · 固定 · 广角。陈默迈出两步，右手手电扫过墙面，声控灯座黑着｜声音：鞋底两声｜台词：无。\n'
    '4-8s 全景 · 平视 · 固定 · 广角。他走到楼梯口前三步停住，光斑压在台阶边缘｜声音：脚步停｜台词：无。',
    '【时间轴】0-5s：陈默迈出两步，右手手电扫过墙面｜镜头：全景 平视 固定 广角｜音效：鞋底两声\n'
    '【时间轴】5-10s：他走到楼梯口前三步停住，光斑压在台阶边缘｜镜头：全景 平视 固定 广角｜音效：脚步停\n'
    '【时间轴】10-16s：他抬手把光柱压向走廊深处，砖缝在暗部里保留｜镜头：全景 平视 固定 广角｜音效：呼吸放缓\n'
    '【时间轴】16-22s：动作完全静止，画面定格，光斑钉在台阶边缘不动｜镜头：全景 平视 固定 广角｜音效：归于静')
L1_SHOT = L1_SHOT.replace('镜1｜长段三条件齐（22s）\n',
                          '镜1｜长段三条件齐（22s）\n【长段声明】22s · 节拍 4 · 收束：末1s定格\n')
L2_PKG = HEADER + L1_SHOT.replace('【长段声明】22s · 节拍 4 · 收束：末1s定格\n', '')
L1_PKG = HEADER + L1_SHOT
case('L1 22s 三条件齐 → 双机放行', L1_PKG,
     cp_ban=['W-OVER-20S'], ap_ban=['W-OVER-20S'])
case('L2 22s 缺声明 → 双机都报', L2_PKG,
     cp_expect=['W-OVER-20S'], ap_expect=['W-OVER-20S'])

# ── B1 / B2：节拍 15% 边界（est = 字数/3.2 + 0.4；10s 镜阈值 11.51；35 字 11.34 内 / 36 字 11.65 外）
def beat_pkg(n):
    dlg = '测' * n
    pkg = HEADER + BASE_SHOT.replace('镜1｜楼道灯灭（8s）', '镜1｜报幕（10s）').replace(
        '# duration: 8s', '# duration: 10s').replace(
        '0-4s 全景 · 平视 · 固定 · 广角。陈默迈出两步，右手手电扫过墙面，声控灯座黑着｜声音：鞋底两声｜台词：无。\n'
        '4-8s 全景 · 平视 · 固定 · 广角。他走到楼梯口前三步停住，光斑压在台阶边缘｜声音：脚步停｜台词：无。',
        '0-5s 全景 · 平视 · 固定 · 广角。陈默迈出两步，手电扫墙，陈默（气声压低）：「{d}」｜声音：鞋底两声｜台词：{d}\n'
        '5-10s 全景 · 平视 · 固定 · 广角。他停住，光斑压在台阶边缘｜声音：脚步停｜台词：无'.format(d=dlg)).replace(
        '对白：无', '对白：0:02 陈默（气声压低）：「{d}」'.format(d=dlg)) + \
        '\n认领：场次S01 P01\n'
    beats = '# 节拍清单\nP01｜场次S01｜%s｜台词\n' % dlg
    return pkg, beats

b1pkg, b1beats = beat_pkg(35)
b2pkg, b2beats = beat_pkg(36)
case('B1 10s 台词 35 字 → 15% 内不报', b1pkg, beats=b1beats, cp_ban=['W-BEAT-TIME-OVERRUN'])
case('B2 10s 台词 36 字 → 15% 外报', b2pkg, beats=b2beats, cp_expect=['W-BEAT-TIME-OVERRUN'])

# ── B3 / B4：`--beats auto` 就近发现（v5.37.8）
# 为什么要它：`audit_project --auto` 会在提示里叫你「另跑 check_prompt --beats <路径>」，
# 而那个路径常常得手抄。抄错、抄漏、或者干脆不跑，节拍认领门就静默缺席——
# 而「没跑」和「跑了没问题」在屏幕上长得一样。
# B3 正向：清单就在包旁边 → 门照常跑（用 36 字那个必然超 15% 的包来证明「真跑了」）。
# B4 反向：包旁边没有清单 → 必须退 2，**不许静默降级成「没给 --beats」**。
case('B3 --beats auto 就近找到清单 → 节拍门照常跑', b2pkg,
     drop={'beats.txt': b2beats}, beats='__auto__',
     cp_expect=['W-BEAT-TIME-OVERRUN'])

case('B4 --beats auto 找不到清单 → 退 2，不静默降级', b2pkg,
     beats='__auto__', cp_rc=2,
     cp_has=['E-BEATS-AUTO-NOT-FOUND'],
     # 不许「假装没给 --beats」继续跑：那正是这一版要防的静默降级。
     cp_ban=['W-BEAT-TIME-OVERRUN'])

# ── I2：出场人物行整行删掉 → 必须报（Bug ② 回归锁）
I2_PKG = HEADER + re.sub(r'(?m)^出场人物：[^\n]*\n', '', BASE_SHOT)
case('I2 出场人物行删 → 必报假过', I2_PKG, cp_expect=['E-IDENTITY-NOT-INLINE'])

# ── G3：持物变更行（audit_project + ledger）
g_ok_pkg, g_ok_ledger = two_shot('', '- 段初 ｜ 持物：铁皮手电 @陈默右手 → 右袋（镜1 末已收）')
g_bad_pkg, g_bad_ledger = two_shot('', '- 段初 ｜ 手电已收袋（镜1 末）')
case('G3-ok 变更行带「持物」字段', g_ok_pkg, ledger=g_ok_ledger, ap_ban=['G3'])
case('G3-bad 变更行缺字段', g_bad_pkg, ledger=g_bad_ledger, ap_expect=['G3'])

# ── M1：同一份 2.0 面 20s 包，双机必须同判（v5.37.1 · 审查报告 MA-1 / MA-2 回归锁）
# 病根：check_prompt.mjs 把硬上限写死 30s、audit_project.py 按锁①型号判 15s ——
# 同一份包一台 0 error、一台 ERROR。现在两边都读 references/model-limits.json。
M1_SHOT = BASE_SHOT.replace('镜1｜楼道灯灭（8s）', '镜1｜超长（20s）').replace(
    '# duration: 8s', '# duration: 20s')
M1_PKG = HEADER.replace('模型=2.5', '模型=2.0').replace('【模型版本】：2.5', '【模型版本】：2.0') + M1_SHOT
case('M1 2.0 面 20s → 双机都判超硬上限', M1_PKG,
     cp_expect=['E-OVER-30S'], ap_expect=['E-OVER-30S'])

# ── M2：参数行 `duration: -1`（智能时长）双机同判（v5.37.2 · 审查报告 MA-6 回归锁）
# 病根：官方允许 `-1` = 由模型在区间内自选整数秒，而两个脚本各错一半——
# check_prompt.mjs 的正则只认「数字+s」，读到 `-1` 等于没读到（静默放过）；
# audit_project.py 的正则同样只认数字，直接报「块1 缺 duration 参数行」（假 ERROR）。
# 同一份包：一台说没事、一台说参数行缺失，而且两边都看不出是同一个根因。
M2_SHOT = BASE_SHOT.replace('# duration: 8s', '# duration: -1')
case('M2 duration: -1 → JS 报 W-PARAM-DUR-AUTO、Python 不报缺失',
     HEADER + M2_SHOT,
     cp_expect=['W-PARAM-DUR-AUTO'], ap_ban=['E-PARAM-DUR-MISSING'])

# ── M3 / M4：素材上限按锁①取档（v5.37.2 · 审查报告 MA-5 回归锁）
# 病根：30/10/10/50 与 9/3/3/12 只写在文档和 model-limits.json 里，没有任何脚本读 refs。
# 同一份「单镜 10 张图」的包：2.0 面必须双机都判超限，2.5 面必须双机都不报——
# 只要哪台机把 9 写死，M4 立刻红。
M3_SHOT = BASE_SHOT.replace(
    '（@图片1）',
    '（@图片1 / @图片2 / @图片3 / @图片4 / @图片5 / @图片6 / @图片7 / @图片8 / @图片9 / @图片10）')
case('M3 2.0 面单镜 10 张图 → 双机都判超素材上限',
     HEADER.replace('模型=2.5', '模型=2.0').replace('【模型版本】：2.5', '【模型版本】：2.0') + M3_SHOT,
     cp_expect=['E-REF-OVER-LIMIT'], ap_expect=['E-REF-OVER-LIMIT'])
case('M4 2.5 面单镜 10 张图 → 双机都不报（档位没写死）',
     HEADER + M3_SHOT,
     cp_ban=['E-REF-OVER-LIMIT', 'W-REF-OVER-LIMIT'],
     ap_ban=['E-REF-OVER-LIMIT', 'W-REF-OVER-LIMIT'])

# ── N1 / N2：配额类判据的最小样本量（v5.37.3 回归锁）
# 病根：S10/S11/S12/S13 是「每集占比」判据（25%~40% / ≤30%），S17/S18 是种数判据
# （焦段 ≥4 种、运镜 ≥8 种）。原实现不分样本量直接套，1~2 个镜块时**数学上不可满足**：
#   占比只有 0/50/100 三档，25%~40% 要命中 0.5~0.8 个镜；焦段凑不出 4 种、运镜凑不出 8 种。
# 后果：任何短包必挂 4~6 条永远修不掉的黄字 → 用户学会一律滑过 → 真判据（S16/S19/S22）一起失效。
# 现口径：够不上门槛报「本门未查（配额类 …）」并且**不报那几条**；够门槛照常跑。
# v5.37.6：这条消息带上类别标签 `（门槛：…）` —— 断言跟着改，顺带把「门槛类必须标注」
# 这件事也锁住：将来谁把标签删了，N1 会红。
QUOTA_MIN_SHOT = BASE_SHOT
case('N1 单镜短包 → 配额门报「未查」且不挂 S10~S13/S17/S18',
     HEADER + QUOTA_MIN_SHOT,
     ap_has=['本门未查（门槛：配额类'],
     ap_absent=['S10 人物特写占比', 'S12 侧 45° 机位占比',
                'S17 焦段种数', 'S18 运镜种数'])


def quota_pkg(n):
    """n 个最小镜块。S 门只看：段头景别 + 正文机位/运镜 + 每块 duration 参数行。"""
    parts = []
    for i in range(1, n + 1):
        parts.append(BASE_SHOT.replace('镜1｜楼道灯灭（8s）', '镜%d｜配额测试%d（8s）' % (i, i)))
    return HEADER + '\n'.join(parts)


case('N2 8 镜包 → 配额门照常跑（种数不够就报，不再报「未查」）',
     quota_pkg(8),
     ap_has=['S18 运镜种数'],
     ap_absent=['本门未查（门槛：'])


# ── N3：全静态包不是「解析失败」（v5.37.3 回归锁）
# 病根：MOVE_WORDS 只收位移/变焦类动作，「固定机位」不在表里。于是一个**正确写满
# 固定机位**的静态包解析出的运镜集合为空，撞上 S22 的判据「一个运镜词都没有 ⇒
# 本门没有真正查过」→ 报 ERROR，让用户去「修格式」。可它格式完全正确。
# 修法：词表补「固定」；同时把「固定」排除出 S19（三镜固定机位是正常手法，不是
# 「同一个机位拍了三遍」）。两条一起改才不会按下葫芦浮起瓢。
def static_pkg(n=3):
    hdr = ('【赛道】1 国内剧\n【三锁】模型=2.5 ｜ 画幅=16:9 ｜ 投放面=国内面\n'
           '【模型版本】：2.5\n')
    parts = []
    for i in range(1, n + 1):
        parts.append(
            '镜%d｜静物%d（8s）\n场景：书房（暖白）｜人物：无\n整体风格：写实。\n'
            '【时间轴】0-4s：全景 · 平视 · 固定机位 · 广角。桌上的茶杯不动｜音效：无\n'
            '【时间轴】4-8s：全景 · 平视 · 固定机位 · 广角。光斑钉在杯沿｜音效：无\n'
            '# duration: 8s | # ratio: 16:9\n' % (i, i))
    return hdr + '\n'.join(parts)


case('N3 全静态包（固定机位 ×3）→ 不报 S22 统计失效、也不报 S19',
     static_pkg(3),
     ap_absent=['S22 配额统计失效', 'S19 连续第 3 镜同运镜'])


# ── N4 / N5：「缺输入」与「缺产物」不能混成一句（v5.37.7 回归锁）
# 病根：两者原来都叫「缺输入」，尾巴都是「补齐输入后重跑」。但项目里根本没有那份文件时，
# 补参数永远补不上——用户会按提示反复加参数，一条都不会少。
# 判定靠 AUTO_INPUTS 的自动发现（探针），不靠猜措辞。
case('N4 项目里没有任何输入 → 判「缺产物」',
     HEADER + QUOTA_MIN_SHOT,
     ap_has=['（缺产物：未给 --registry'],
     ap_absent=['（缺输入：未给 --registry'])

case('N5 registry 就在包目录里、只是没传参 → 判「缺输入」',
     HEADER + QUOTA_MIN_SHOT,
     drop={'asset-registry.json': '{"characters": {}, "props": {}}'},
     ap_has=['（缺输入：未给 --registry'],
     ap_absent=['（缺产物：未给 --registry'])


# ── N6：「不适用」是第四档，不是未查（v5.37.8 回归锁）
# 病根：没写「镜头裁定」表的包，R 门永远报一条「未查」，于是**这类包永远拿不到全绿**
# ——「全部通过」对它们不可达。不可达的信号没人追，最后连真问题一起被忽略。
# N6 同时锁两件事：① 报的是「不适用」而不是「未查」；② 它**不进未查计数**（否则等于没拆）。
case('N6 包内无「镜头裁定」表 → 报「不适用」，不算进未查',
     HEADER + QUOTA_MIN_SHOT,
     ap_has=['本门不适用（包内无「镜头裁定」表', '1 不适用（不适用 ≠ 通过）'],
     ap_absent=['（缺输入：包内无「镜头裁定」表'])

# ── F7b：编号族别混用（v6.13.0 · C33-A1，audit_project 素材定义行）
_F7B_HDR = HEADER.replace('素材形态：M1（编号占位 · 图号见文末接线单）',
                          '素材形态：M2（已入库 · 图序见各段参数行）')
_F7B_OK = _F7B_HDR + BASE_SHOT.replace(
    '# title: 镜1｜楼道灯灭 | # duration: 8s | # ratio: 16:9',
    '# title: 镜1｜楼道灯灭 | # duration: 8s | # ratio: 16:9\n'
    '# 投喂图序（按顺序挂 2 张）：图1=场景\\S01_楼道.png（楼道结构与窗位）'
    '｜图2=角色\\C01_陈默_4View.png（陈默五官与制服）')
case('F7b-ok 投喂图序族别一致 → 不报混用', _F7B_OK,
     ap_ban=['族别混用', '编号前缀'])

_F7B_MIX = _F7B_HDR + BASE_SHOT.replace(
    '# title: 镜1｜楼道灯灭 | # duration: 8s | # ratio: 16:9',
    '# title: 镜1｜楼道灯灭 | # duration: 8s | # ratio: 16:9\n'
    '# 投喂图序（按顺序挂 2 张）：图1=场景\\S01_楼道.png（楼道结构）'
    '｜图1=角色\\C01_陈默.png（五官）')
case('F7b-mix 同一图N 绑定两个族别 → 报混用', _F7B_MIX,
     ap_has=['图1 在全包绑定多个资产族别'])

_F7B_DIR = _F7B_HDR + BASE_SHOT.replace(
    '# title: 镜1｜楼道灯灭 | # duration: 8s | # ratio: 16:9',
    '# title: 镜1｜楼道灯灭 | # duration: 8s | # ratio: 16:9\n'
    '# 投喂图序（按顺序挂 1 张）：图2=角色\\S03_楼道.png（楼道结构与窗位）')
case('F7b-dir 目录词与前缀冲突 → 报混用', _F7B_DIR,
     ap_has=['路径目录「角色」与编号前缀 S'])

# ── 跑
def run(cmd):
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out = p.communicate()[0].decode('utf-8', 'replace')
    # v5.37.5：原来写成 `return p.returncode, p.communicate()…` —— 元组从左往右求值，
    # returncode 在子进程收尾前被读走，恒为 None。本文件恰好丢掉了 rc 才没出事，
    # 但下一个想按退出码断言的用例会静默拿到 None。两行拆开，代价为零。
    return p.returncode, out


def codes(out):
    return set(re.findall(r'\b([EW]-[A-Z][A-Z0-9-]*)\b', out)) | \
           set(re.findall(r'\b(G\d)\b', out))


def main():
    global N
    import shutil
    N = shutil.which('node') or shutil.which('node.exe')
    if not N:
        print('需要 node 跑 check_prompt.mjs')
        return 2

    # v5.47.1：夹具再深一层（root/proj/包.md）——_search_dirs 会扫「包目录的父目录」；
    # 包直接放 mkdtemp 根时父目录就是 %TEMP%，里面若有同名输入文件（本机实测：历史遗留的
    # asset-registry.json / 剧本_标准.txt 会让 auto 探针串台，N4 的「缺产物」被误判成「缺输入」）。
    root = tempfile.mkdtemp(prefix='liqi_boundary_')
    tmp = os.path.join(root, 'proj')
    os.makedirs(tmp)
    passed, failed = 0, []
    try:
        beats_written = {}
        for c in CASES:
            # v5.37.7：drop 非空时给这个用例开独立子目录——要测「文件在项目里、只是没传参」，
            # 就得让探针在包所在目录里看到它；放公共 tmp 会污染所有用例的判定。
            base = tmp
            if c['drop']:
                base = os.path.join(tmp, re.sub(r'[^\w]', '_', c['name']))
                os.makedirs(base, exist_ok=True)
                for _fn, _body in c['drop'].items():
                    io.open(os.path.join(base, _fn), 'w', encoding='utf-8',
                            newline='').write(_body)
            pkgp = os.path.join(base, re.sub(r'[^\w]', '_', c['name']) + '.md')
            io.open(pkgp, 'w', encoding='utf-8', newline='').write(c['pkg'])
            cp_codes, ap_codes = set(), set()
            ap_text = ''
            cp_rc = None
            cp_text = ''
            if c['cp_expect'] or c['cp_ban'] or c['cp_has'] or c['cp_rc'] is not None:
                cmd = [N, os.path.join(HERE, 'check_prompt.mjs'), pkgp, '--surface', 'cn']
                if c['beats'] == '__auto__':
                    # 清单已经由 drop 写进包所在目录，这里只让脚本自己去找
                    cmd += ['--beats', 'auto']
                elif c['beats']:
                    bp = os.path.join(base, re.sub(r'[^\w]', '_', c['name']) + '.txt')
                    io.open(bp, 'w', encoding='utf-8', newline='').write(c['beats'])
                    cmd += ['--beats', bp]
                cp_rc, out = run(cmd)
                cp_codes = codes(out)
                cp_text = out
            if c['ap_expect'] or c['ap_ban'] or c['ap_has'] or c['ap_absent']:
                cmd = [P, os.path.join(HERE, 'audit_project.py'), pkgp]
                if c['ledger']:
                    lp = os.path.join(tmp, re.sub(r'[^\w]', '_', c['name']) + '_ledger.md')
                    io.open(lp, 'w', encoding='utf-8', newline='').write(c['ledger'])
                    cmd += ['--ledger', lp]
                _, out = run(cmd)
                ap_codes = codes(out)
                ap_text = out

            ok = True
            if c['cp_rc'] is not None and cp_rc != c['cp_rc']:
                ok = False
                failed.append('%s：check_prompt 退出码应为 %d，实为 %s'
                              % (c['name'], c['cp_rc'], cp_rc))
            for hit in c['cp_has']:
                if hit not in cp_text:
                    ok = False
                    failed.append('%s：check_prompt 输出缺「%s」' % (c['name'], hit))
            for miss in c['cp_expect'] - cp_codes:
                ok = False
                failed.append('%s：check_prompt 应报 %s 未报' % (c['name'], miss))
            for hit in c['cp_ban'] & cp_codes:
                ok = False
                failed.append('%s：check_prompt 不该报 %s 却报了' % (c['name'], hit))
            for miss in c['ap_expect'] - ap_codes:
                ok = False
                failed.append('%s：audit_project 应报 %s 未报' % (c['name'], miss))
            for hit in c['ap_ban'] & ap_codes:
                ok = False
                failed.append('%s：audit_project 不该报 %s 却报了' % (c['name'], hit))
            for miss in c['ap_has']:
                if miss not in ap_text:
                    ok = False
                    failed.append('%s：audit_project 输出缺「%s」' % (c['name'], miss))
            for hit in c['ap_absent']:
                if hit in ap_text:
                    ok = False
                    failed.append('%s：audit_project 输出不该有「%s」' % (c['name'], hit))
            if ok:
                passed += 1
            print('%s %s' % ('✅' if ok else '❌', c['name']))
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print('\n结果：%d 过 / %d 败' % (passed, len(failed)))
    for f in failed:
        print('  ✗ ' + f)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
