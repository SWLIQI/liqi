#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
liqi 交付契约核销器（v5.8.3 · 升级方案 P1-4 落地）。

`check_prompt.mjs` 报全绿只代表「单镜投喂块语法合格」，**绝不代表全流程交付完成**。
本脚本查的是另一件事——**阶段产物的完整性**：该做的阶段做没做，做出来的东西
有没有按对应 reference 的模板真正展开（还是几行简笔摘要糊弄）。

  CT1  剧本门控通过记录      → 叙事层_剧本门控与台词.md（五阶门控 + 情节点标注）
  CT2  风格锚声明 + 冻结      → 风格路由表.md（九段锚 + 选定即冻结四项）
  CT3  角色资产板            → 资产层_锁定与一致性.md（4 View + 五官 10 项 + 服装 6 项）
  CT4  场景方位卡 + 时段锚点  → 场景方位卡与固定锚物.md + 场景资产与时间线光照.md
  CT5  道具 / 持物设定        → 持物设定图_模板.md + 道具展示表_模板.md
  CT6  逐镜提示词 + 配额自检  → 分镜配额与机检规范.md
  CT7  投喂稿过机检          → check_prompt.mjs / audit_project.py / check_style.mjs
  CT8  质检结论与改动复验     → 质控层_门禁与过审.md（三层质检 + §七 改动复验）

── 与 audit_project.py 的分工（别把两者当同一套东西）────────────────────────
  · audit_project.py  查**内容一致性**：同一份稿件内部矛不矛盾（C 门版本漂移 /
    C2 场景时段 / G 门台账对账 / N 门剧本量化）。**它默认你上游做了资产层**。
  · audit_contract.py 查**阶段产物完整性**：资产层到底做没做、风格锚到底选的谁、
    机检到底跑没跑。**它不判断内容对不对，只判断东西在不在、指纹全不全**。
  两者串行跑，结论互不覆盖。

── 三态 + N/A（本 skill 的口径，与 Z 门 / G7 / N2 同一条立场）────────────────
  每个契约项产出四态之一：
    PASS  硬产出在场且结构指纹齐
    WARN  硬产出在场但指纹不全（或该项属建议级）
    FAIL  硬产出缺失，或在场但**关键指纹 0 命中**（＝简笔糊弄版）
    N/A   本项不适用（无输入）或已**显式声明跳过**
  ⚠️ **N/A 不计入通过项**。N/A 是「没查」，不是「查过了没问题」——
  「没给输入就是跳过，不是通过」是本 skill 从 Z 门起就立下的口径，
  契约核销沿用，否则一张空白包也能报「全绿」。

── 声明式豁免（照 分镜配额与机检规范.md §六 的声明式例外体例）──────────────
  段首一行显式声明即生效：`【契约豁免】CT3：本包 A1 档，资产可选不建链`
  **可豁免**：CT1 / CT3 / CT4 / CT5 / CT8（依赖项目档位或交付类型）
  **不可豁免**：CT2（风格锚） / CT6（逐镜块） / CT7（机检）——
  这三项任何形态的交付都必须做，豁免声明无效并会额外报一条 WARN。
  🔴 **豁免一个已 FAIL 的硬项不会让它变 PASS，只会让它变 N/A**——
  豁免是「本项不适用」，不是「本项通过」。

用法：
  1. 开工前建表（贴进工作笔记，每完成一项打勾）：
     python audit_contract.py --init [--mode full|board|asset] [--style <style_id>]
  2. 交付前核销（未通过严禁宣布「任务完成」）：
     python audit_contract.py <稿件.md> [--mode auto|full|board|asset]
                              [--style <style_id>] [--script <剧本.txt>]
  3. 自测：
     python audit_contract.py --self-test

  --mode    full = 整片交付包（〇风格锚+转场表+台账+镜块）/ board = 看板或节选 /
            asset = 资产包（无镜块有「资产 X｜」条目）/ auto = 按满配标记自动判（默认）
  --style   锁定的 style_id，用于核对包内声明与本次任务是否同锚（不一致报 WARN）
  --script  剧本纯文本。传了就等于声明「本包有剧本层」，CT1 由 N/A 转为必查

⚠️ **不要在包内复述核销结论**（自我污染）：本脚本读的是全文，你写在包里的
   「本包无场景方位卡」「CT4 缺方位卡」这类注记会被当成**证据**读进去
   （实测踩过：往黄金样例注记里补一句「CT4 无场景方位卡」，CT4 立刻从 FAIL 变 WARN、
   CT1 从 N/A 变 FAIL）。注记里只给计数和理由，不要复述契约项名与指纹词。

退出码：0 = 无 FAIL 无 WARN；1 = 有 FAIL；2 = 只有 WARN
"""
import argparse
import os
import re
import sys

from gates_log import append_gate_log, log_disabled

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

RESET = '\033[0m'
RED = '\033[31m'
YEL = '\033[33m'
GRN = '\033[32m'
DIM = '\033[2m'


def color(s, c):
    return c + s + RESET if sys.stdout.isatty() else s


# ─────────────────────────────────────────────────────────────────────────────
# 契约定义（硬产出 + 唯一权威源 + 必现结构指纹）
# ─────────────────────────────────────────────────────────────────────────────

CONTRACT_ITEMS = [
    ('CT1', '剧本门控通过记录',
     'references/叙事层_剧本门控与台词.md（§一 五阶门控 + §六 分阶段量化门禁）',
     '五阶门控 Gate 1~5 记录 + 情节点显式标注'),
    ('CT2', '风格锚声明 + 冻结',
     'references/风格路由表.md（§六 递进收窄四步 / §七 选定即冻结）',
     '【风格】<style_id> 声明 + 九段锚 ≥7 段 + 冻结四项'),
    ('CT3', '角色资产板（4 View + 五官 10 项 + 服装 6 项）',
     'references/资产层_锁定与一致性.md',
     '4 View 版式 + 左区头部近景 + 右区保头无脸三联 + 文字锁 16 项 + 性别锚'),
    ('CT4', '场景方位卡 + 时段锚点表',
     'references/场景方位卡与固定锚物.md + references/场景资产与时间线光照.md',
     '方位卡四要素（罗盘 / 固定锚物 / 屏幕方向映射 / 禁变）+ 项目级光照锚点表'),
    ('CT5', '道具 / 持物设定',
     'references/持物设定图_模板.md + references/道具展示表_模板.md',
     '关键道具锁定 + 入画方式（手持 / 悬挂 / 置地）+ 持物分左右手'),
    ('CT6', '逐镜提示词 + 配额自检',
     'references/分镜配额与机检规范.md',
     '逐镜块 + 时间线分镜 / 参数行 / 光色基调 / 保真预算 / 站位 / 刚性约束'),
    ('CT7', '投喂稿过机检',
     'scripts/check_prompt.mjs / scripts/audit_project.py / scripts/check_style.mjs',
     '附校验结果：脚本名 + 结果态（0 error / 通过）'),
    ('CT8', '质检结论与改动复验报告',
     'references/质控层_门禁与过审.md（§一 三层质检 + §七 改动复验）',
     'L1~L3 结论 / 过审风险分；修改类交付必附《改动复验报告》'),
]

# 不接受豁免的硬项（任何形态交付都必须做）
SEALED_ITEMS = ('CT2', 'CT6', 'CT7')

# ── 九段锚段名与别名（与 SKILL.md Step 2 逐段同序同构）
SEG_ALIASES = (
    ('画风与材质质感', ('画风与材质质感', '画风材质', '画风与材质')),
    ('配色与色域', ('配色与色域', '配色色域')),
    ('运动签名', ('运动签名',)),
    ('角色锁定', ('角色锁定',)),
    ('场景锁定', ('场景锁定',)),
    ('关键道具锁定', ('关键道具锁定', '道具锁定')),
    ('光色基调', ('光色基调',)),
    ('声音签名', ('声音签名',)),
    ('排除项', ('排除项',)),
)

# ── 机检脚本别名（CT7 认这些字串）
VERIFY_SCRIPTS = ('check_prompt.mjs', 'check_prompt_h3.mjs', 'audit_literal.py',
                  'audit_project.py', 'audit_risk.py', 'check_style.mjs')

SHOT_HEAD_LINE_RE = re.compile(r'^\s*#{0,6}\s*(?:镜|段|U)\s*\d+[A-Za-z]?\s*｜')
ASSET_HEAD_RE = re.compile(r'^\s*#{0,6}\s*资产\s*[A-Za-z0-9]+\s*｜', re.M)
EXEMPT_RE = re.compile(r'【契约豁免】\s*(CT\s*[1-8])\s*[:：]?\s*([^\n【]*)')
GATE_RE = re.compile(r'Gate\s*([1-5])')
STYLE_ID_RE = re.compile(r'【风格】\s*([a-z0-9][a-z0-9-]*)')
STYLE_ID_ALT_RE = re.compile(r'#\s*style_id\s*[:：]\s*([a-z0-9][a-z0-9-]*)')
DURATION_RE = re.compile(r'#\s*duration\s*[:：]')
SHOT_N_RE = re.compile(r'Shot\s*\d+\s*[（(]')
RESULT_WORD_RE = re.compile(r'(0\s*error|error\s*(?:清零|=|为|:|：)\s*0|全部通过|PASS(?:ED)?|无\s*error)')
SKIP_WORD_RE = re.compile(r'(未跑|没跑|待跑|跳过|已跳过|skip)')
WHITE_RE = re.compile(r'[\s\u3000]+')


def _norm(s):
    """去全半角空白——指纹匹配前必须归一化，否则「4 View」/「4View」/「五官 10 项」
    这类空格变体会漏杀或误杀（照上游 audit_contract 的修复记录，2026-10-14）。"""
    return WHITE_RE.sub('', s)


def _norml(s):
    return _norm(s).lower()


def count_shots(text):
    return sum(1 for line in text.splitlines() if SHOT_HEAD_LINE_RE.match(line))


def detect_mode(text, n_shots, n_assets):
    """auto 模式判定。

    ⚠️ 只认「满配标记」才升 full，**不因为出现某个轻量标记就降级**——
    上游踩过一次：见 P2.5 即判 board-lite，静默跳过六项满配契约，
    恰好放走「漏 P1/P3/P5」这类最典型的漏项。故：宁可多查，不可静默漏查。
    """
    full_markers = ('转场注记', '连续性台账', '全局制作纪律')
    if any(m in text for m in full_markers):
        return 'full'
    if n_shots == 0 and n_assets:
        return 'asset'
    return 'board'


# ─────────────────────────────────────────────────────────────────────────────
# 八项契约检查：每项返回 (status, message)
#   status ∈ {'PASS','WARN','FAIL','N/A'}
# ─────────────────────────────────────────────────────────────────────────────

def check_ct1(text, tn, tnl, ctx):
    """CT1 剧本门控通过记录。

    剧本层是 Step -1 **可选**阶段——但「跳过」必须显式，不能默认放行。
    故：无剧本层输入 → N/A；声明有剧本层却拿不出门控记录 → FAIL。
    """
    has_script = ctx['has_script']
    has_script_layer = has_script or ('剧本' in text and ('场次' in text or '台词' in text))
    if not has_script_layer:
        return ('N/A', '无剧本层输入（未提供 --script，包内无剧本段）——'
                       '跳过，**不等于通过**')

    gates = set(GATE_RE.findall(text))
    has_gate_block = ('五阶门控' in tn) or len(gates) >= 4
    has_beat = '情节点' in text
    has_n_gate = ('剧本量化门禁' in tn) or bool(re.search(r'N[123]\b', text))

    if has_gate_block and has_beat:
        extra = '（附 N 门机检）' if has_n_gate else ''
        return ('PASS', '五阶门控记录与情节点标注在位%s' % extra)
    if has_gate_block and not has_beat:
        return ('WARN', '有五阶门控记录但**全文 0 处情节点标注**——'
                        'N2 情节点密度查不了，「查不了」不是通过。'
                        '按 `叙事层_剧本门控与台词.md` §6.2 补显式标注（`情节点：` / `（情节点：…）`）')
    if has_beat and not has_gate_block:
        return ('WARN', '有情节点标注但未见五阶门控通过记录——'
                        'Gate 1~5 的通过结论请落字（Gate 1 Premise / 2 Structure / 3 Beat Sheet / '
                        '4 Worldview & Entity Bounds / 5 Script Page），别只在口头过了一遍')
    return ('FAIL', '声明了剧本层输入，但**五阶门控通过记录与情节点标注双缺**——'
                    '权威源 `references/叙事层_剧本门控与台词.md` §一 / §六，请回读后补齐')


def check_ct2(text, tn, tnl, ctx):
    """CT2 风格锚声明 + 冻结。**不可豁免。**"""
    m = STYLE_ID_RE.search(text) or STYLE_ID_ALT_RE.search(text)
    if not m:
        return ('FAIL', '包内 0 处 `【风格】<style_id>` 或 `# style_id:` 声明——'
                        '风格锚是硬产物，缺它下游所有材质 / 色域 / 负面词方向都无权威源。'
                        '权威源 `references/风格路由表.md`')
    sid = m.group(1)

    segs = [name for name, alts in SEG_ALIASES if any(a in tn for a in alts)]
    n_seg = len(segs)

    is_excerpt = ('节选' in tn) or ('九段见' in tn) or ('完整九段见' in tn)
    freeze = ('选定即冻结' in tn) or ('冻结' in tn) or ('不得中途换锚' in tn) \
             or ('重开任务' in tn) or ('style_id唯一' in tn)

    msgs = []
    if n_seg >= 7:
        msgs.append('九段锚在位 %d/9 段（%s）' % (n_seg, '、'.join(segs)))
        st = 'PASS'
    elif n_seg >= 5:
        st = 'WARN'
        msgs.append('九段锚仅 %d/9 段（缺 %s）——风格锚按 SKILL.md Step 2 九段同序同构，'
                    '缺段等于压句无来源'
                    % (n_seg, '、'.join(n for n, _ in SEG_ALIASES if n not in segs)))
    else:
        msgs.append('九段锚仅 %d/9 段（%s）——**疑似摘要糊弄版**，回读 `references/风格路由表.md` 第二节'
                    % (n_seg, '、'.join(segs) or '无'))
        if is_excerpt:
            st = 'WARN'
            msgs.append('包内已显式声明「节选」（完整九段见 SKILL.md Step 2），据实降级为 WARN——'
                        '节选稿可交付但不得当成完整风格锚复用')
        else:
            st = 'FAIL'

    if not freeze:
        if st == 'PASS':
            st = 'WARN'
        msgs.append('未见「选定即冻结」表述——v5.8.2 起落 id 要走递进四步、落完即冻结；'
                    '冻结四项（一个主 id / 至多一个辅助质感 / 全包只认该锚色域·材质·禁用项·heads_range / 第三方作品名禁入）'
                    '建议在包内落字，见 `references/风格路由表.md` §七')

    if ctx.get('style') and ctx['style'].strip() != sid:
        if st == 'PASS':
            st = 'WARN'
        msgs.append('本次任务 --style=%s，但包内声明为 %s——**不同锚**，'
                    '要么改声明，要么确认这是有意换锚（改风格 = 重开任务）'
                    % (ctx['style'].strip(), sid))

    return (st, 'style_id=%s；%s' % (sid, '；'.join(msgs)))


def check_ct3(text, tn, tnl, ctx):
    """CT3 角色资产板。"""
    view4 = ('4View' in tn) or ('四视图' in tn) or ('角色资产板' in tn) or ('资产板' in tn)
    left = ('头部近景' in tn) or ('面部特写' in tn) or ('facecloseup' in tnl) \
           or ('身份锚' in tn)
    right = ('保头无脸' in tn) or ('保头去五官' in tn) or ('featurelessface' in tnl)
    lock5 = ('五官10项' in tn) or ('五官十项' in tn)
    lock6 = ('服装6项' in tn) or ('服装六项' in tn)
    gender = ('男性' in text) or ('女性' in text)
    a1 = bool(re.search(r'(?:资产依赖分级|【资产分级】|依赖分级)[^\n]{0,12}?A1', text)) \
         or ('A1档' in tn) or ('A1级' in tn)

    if not view4:
        if a1:
            return ('N/A', '包内显式声明 A1 档（单角色单镜，资产可选）——跳过，**不等于通过**。'
                           'A1 若仍建资产链，请把 4 View 板写进包内')
        return ('FAIL', '包内无 4 View 角色资产板 / 四视图 / 资产板标记——'
                        '**疑似简笔摘要**（几行角色描述不能替代资产板）。'
                        '权威源 `references/资产层_锁定与一致性.md` 第二节。'
                        'A1 档请在包内显式声明「资产依赖分级：A1」再跳过')

    msgs = []
    miss_struct = [n for n, v in (('4 View 版式', view4), ('左区头部近景（身份锚）', left),
                                  ('右区保头无脸三联', right)) if not v]
    if miss_struct:
        return ('FAIL', '资产板结构三件套缺 %s——**疑似简笔糊弄版**。'
                        '4 View 板＝左区头部近景（唯一身份锚）+ 右区保头无脸三联（正面 / 90° 侧面 / 背面），'
                        '回读 `references/资产层_锁定与一致性.md` 第二节与 `4View资产板_模板.md`'
                        % '、'.join(miss_struct))

    st = 'PASS'
    msgs.append('4 View 板结构三件套齐（左区身份锚 + 右区保头无脸三联）')
    miss_lock = [n for n, v in (('五官 10 项', lock5), ('服装 6 项', lock6)) if not v]
    if miss_lock:
        st = 'WARN'
        msgs.append('文字锁缺 %s——16 项文字锁（五官 10 + 服装 6）是防脸部漂移与塑料感的硬项，'
                    'A2 以上必写；见 `references/资产层_锁定与一致性.md` 第三节'
                    % '、'.join(miss_lock))
    if not gender:
        st = 'WARN' if st == 'PASS' else st
        msgs.append('未见性别锚点（`X~Y岁男性/女性（身份代称）` 收尾）——只写年龄段或身份代称，'
                    '模型会自行推断性别导致漂移')
    return (st, '；'.join(msgs))


def check_ct4(text, tn, tnl, ctx):
    """CT4 场景方位卡 + 时段锚点表。"""
    has_card = '方位卡' in tn
    a1 = ('A1档' in tn) or ('A1级' in tn) or bool(
        re.search(r'(?:资产依赖分级|【资产分级】)[^\n]{0,12}?A1', text))
    light_table = ('光照锚点表' in tn) or ('光照锚点' in tn) \
                  or ('时段' in text and ('色温' in text or '光照' in text))

    if not has_card:
        if ctx['n_shots'] <= 1 and a1:
            return ('N/A', '单镜包 + A1 档，方位卡不必要——跳过，**不等于通过**')
        if light_table:
            return ('WARN', '有时段 / 光照锚点表但**未见场景方位卡**——方位卡不出图不烧额度，'
                            '但后面每镜的站位与轴线都按它写；没有卡，各镜的「画面左」就是各镜自己解释。'
                            '见 `references/场景方位卡与固定锚物.md`')
        return ('FAIL', '未见场景方位卡——A1 以上必做。权威源 '
                        '`references/场景方位卡与固定锚物.md`（四要素：罗盘方位 / 固定锚物清单 / '
                        '屏幕方向映射 / 禁变约定）')

    four = {
        '罗盘方位': ('罗盘' in tn) or ('方位' in text),
        '固定锚物清单': ('固定锚物' in tn) or ('锚物' in tn),
        '屏幕方向映射': ('屏幕方向' in tn) or ('画面左' in text and '画面右' in text),
        '禁变约定': ('禁变' in tn) or ('锁死' in tn) or ('不得改变' in tn),
    }
    miss = [k for k, v in four.items() if not v]
    if len(miss) >= 3:
        return ('FAIL', '方位卡四要素缺 %s——只有名字没有内容，**疑似占位**。权威源 '
                        '`references/场景方位卡与固定锚物.md` 第二 / 三节'
                        % '、'.join(miss))
    msgs = ['方位卡四要素在位' if not miss else '方位卡四要素缺 %s' % '、'.join(miss)]
    st = 'WARN' if miss else 'PASS'
    if not light_table:
        st = 'WARN' if st == 'PASS' else st
        msgs.append('未见项目级光照锚点表（时段 → 色温 / 入射角 / 影子形态 / 人工光状态）——'
                    '时段四值只从 `lighting_anchors` 取，禁现场编；见 '
                    '`references/场景资产与时间线光照.md` 第三节')
    return (st, '；'.join(msgs))


def check_ct5(text, tn, tnl, ctx):
    """CT5 道具 / 持物设定。"""
    prop_section = ('道具锁定' in tn) or ('关键道具' in tn) or ('【道具】' in tn) \
                   or ('道具：' in text) or ('道具设定图' in tn)
    prop_anchor = bool(re.search(r'锚「', text)) or bool(re.search(r'锚\s*「', text))
    entry_way = ('入画方式' in tn) or ('手持' in text) or ('悬挂' in text) or ('置地' in text)
    hand_lr = ('左手' in text and '右手' in text)

    if not prop_section:
        if prop_anchor:
            return ('FAIL', '包内引用了道具锚（`锚「…」`）但**没有道具 / 关键道具锁定条目**——'
                            '锚点在资产库里落不了地。权威源 `references/持物设定图_模板.md` 与 '
                            '`references/道具展示表_模板.md`')
        return ('N/A', '包内未见道具锚与道具锁定段落（本片无贯穿道具）——跳过，**不等于通过**')

    msgs = []
    st = 'PASS'
    if not entry_way:
        st = 'WARN'
        msgs.append('未见**入画方式**（手持 / 悬挂 / 置地）——漏了道具会飘在半空，'
                    '这是道具锁定必写项')
    if not hand_lr:
        st = 'WARN' if st == 'PASS' else st
        msgs.append('未见持物**分左右手**写法——持物写法分左右手（v4.7.6），'
                    '见 `references/场景方位卡与固定锚物.md` §六之二')
    if not msgs:
        msgs.append('道具锁定 + 入画方式 + 持物分左右手在位')
    return (st, '；'.join(msgs))


def check_ct6(text, tn, tnl, ctx):
    """CT6 逐镜提示词 + 配额自检。**不可豁免。**"""
    n = ctx['n_shots']
    if n == 0:
        if ctx['mode'] == 'asset':
            return ('N/A', '资产包形态（无镜块）——逐镜契约不适用，**不等于通过**')
        return ('FAIL', '**未识别到任何镜 / 段块**——块头需形如「镜 1｜标题（13s）」'
                        '或「段 1｜标题（15s）」，标题里必须带秒数。'
                        '若本包确为资产包，请显式 `--mode asset`')

    facets = {
        '时间线分镜 / 段头骨架': ('时间线分镜' in tn) or ('【时间轴】' in text)
                                 or bool(SHOT_N_RE.search(text)) or ('【镜头' in text),
        '参数行': bool(DURATION_RE.search(text)) or ('#ratio:' in tn) or ('【参数】' in tn),
        '本镜光色基调': '光色基调' in tn,
        '保真预算': '保真预算' in tn,
        '站位': '站位' in tn,
        '刚性约束': ('刚性约束' in tn) or ('必锁' in tn),
    }
    miss = [k for k, v in facets.items() if not v]
    msgs = ['逐镜块 %d 个' % n]

    if not miss:
        st = 'PASS'
        msgs.append('12 小节结构指纹抽查全在位（%s）' % ' / '.join(facets))
    elif len(miss) <= 2:
        st = 'WARN'
        msgs.append('逐镜结构缺 %s——照 SKILL.md Step 3 的镜块小节补齐' % '、'.join(miss))
    else:
        st = 'FAIL'
        msgs.append('逐镜结构缺 %s（≥3 项）——**疑似简笔糊弄版**，'
                    '回读 SKILL.md Step 3 的 12 小节骨架' % '、'.join(miss))

    # 配额自检：不重跑统计（那是 audit_project.py 的 S 门），只核**有没有过这一关**
    if n >= 3 and ('配额' not in tn) and ('audit_project' not in tn):
        st = 'WARN' if st == 'PASS' else st
        msgs.append('全包 %d 镜但**未见任何配额自检痕迹**——逐镜写完要回头查整包构成'
                    '（特写占比 / 常规机位上限 / 焦段与运镜种类 / 连续同运镜），'
                    '见 `references/分镜配额与机检规范.md` §七；跑 `audit_project.py` 的 S 门也可以'
                    % n)
    return (st, '；'.join(msgs))


def check_ct7(text, tn, tnl, ctx):
    """CT7 投喂稿过机检。**不可豁免。**"""
    mentioned = [s for s in VERIFY_SCRIPTS if s in text]
    has_verify_head = any(h in text for h in ('校验结果', '机检', '机械校验', '门禁结果', '质检报告'))

    if not mentioned and not has_verify_head:
        return ('FAIL', '**全文 0 处机检痕迹**——「格式全绿 ≠ 任务完成」的反面同样成立：'
                        '**没跑机检就直接交付，等于交付未经检验的稿**。交付前必跑 '
                        '`check_prompt.mjs`（H3 面改 `check_prompt_h3.mjs`）与 `audit_literal.py`，'
                        '挂了 style_id 加 `check_style.mjs`，有剧本 / 资产库加 `audit_project.py`，'
                        '投国内面加 `audit_risk.py`，并把结果一并给用户')

    has_result = bool(RESULT_WORD_RE.search(text))
    msgs = ['已提及机检脚本：%s' % ' / '.join(mentioned)] if mentioned else []
    st = 'PASS'

    if not mentioned:
        st = 'WARN'
        msgs.append('有「校验结果」区块但**未点名任何脚本**——结论要能追溯到脚本，'
                    '否则无法复核是哪一关过的')
    elif not has_result:
        st = 'WARN'
        msgs.append('点了脚本名但**未见结果态**（`0 error` / `全部通过` / `PASS`）——'
                    '「跑了」和「跑过了」是两件事，把结果写出来')

    # 「跳过」只在**同一句里出现机检脚本名**时才算「本轮跳过了某道机检」——
    # 全文泛泛提一句「某门因为没配置输入所以跳过」不该算（实测黄金样例就踩了这条假报：
    # 它把 C/C2/F/G 四门的跳过理由写得很清楚，却被全文匹配判成「跳过未说明」）。
    # 用「最后一个句读之后到跳过词」这一段做判定，而不是固定字数窗口——
    # 固定窗口会把上一句里的 `check_style.mjs` 也算进来。
    skipped = []
    for m in SKIP_WORD_RE.finditer(text):
        seg = re.split(r'[。\n；;]', text[:m.start()])[-1]
        hit = [s for s in VERIFY_SCRIPTS if s in seg]
        if hit or ('校验结果' in seg):
            skipped.append((text[m.start():m.start() + 12].strip(), hit))
    if skipped:
        st = 'WARN' if st == 'PASS' else st
        detail = '、'.join('%s%s' % (w, ('（%s）' % '/'.join(h)) if h else '') for w, h in skipped[:3])
        msgs.append('机检声明里含跳过字样（%s）——**跳过 ≠ 通过**，'
                    '把跳过的脚本与理由单列，别混进通过项' % detail)

    sid = ctx.get('style_id')
    if sid and ('check_style.mjs' not in text):
        st = 'WARN' if st == 'PASS' else st
        msgs.append('包内挂了 style_id 但未见 `check_style.mjs` 结果——风格层是必跑项（Step 2.5 起）')

    return (st, '；'.join(msgs))


def check_ct8(text, tn, tnl, ctx):
    """CT8 质检结论与改动复验报告。"""
    l3 = ('三层质检' in tn) or ('质检架构' in tn) \
         or (('L1' in text) and ('L2' in text) and ('L3' in text))
    risk = ('过审风险' in tn) or ('风险分' in tn)
    gate = ('三级门禁' in tn) or ('门禁结论' in tn) or \
           (('P0' in text) and ('P1' in text) and ('P2' in text))
    is_modify = bool(re.search(r'(改动清单|修改类交付|修改类|改动复验)', text))
    reverify = ('改动复验报告' in tn) or ('复验报告' in tn)

    if is_modify and not reverify:
        return ('FAIL', '本包自述为**修改类交付**（含「改动清单 / 修改类」），但'
                        '**未附《改动复验报告》**——这是本 skill 唯一强制附件：'
                        '改稿禁止只复验改动处（典型翻车：改一句台词剧透前文伏笔）。'
                        '三步复验闭环＝局部验证 + 七项联动冲突检查 + 全量审核，'
                        '报告须含改动清单 + 联动检查结论 + 全量审核结论。'
                        '**未附报告 ＝ 视为未完成复验，禁止交付**。见 `references/质控层_门禁与过审.md` §七')

    found = [n for n, v in (('三层质检 L1~L3', l3), ('过审风险分', risk),
                            ('P0~P2 三级门禁结论', gate)) if v]
    if is_modify and reverify:
        return ('PASS', '修改类交付已附《改动复验报告》（%s）' % '、'.join(found + ['改动复验报告']))
    if found:
        return ('PASS', '质检结论在位：%s' % '、'.join(found))
    if ctx['n_shots'] == 0:
        return ('N/A', '资产包形态且无镜块——质检结论随稿交付时再补，**不等于通过**')
    return ('WARN', '未见 L1~L3 质检结论 / 过审风险分 / P0~P2 门禁结论——'
                    '**机检结果不等于质检结论**：结果要说「按后果定了什么级、放不放行」，'
                    '不只贴一串 warning。见 `references/质控层_门禁与过审.md` §一 / §五')


CHECKERS = {
    'CT1': check_ct1, 'CT2': check_ct2, 'CT3': check_ct3, 'CT4': check_ct4,
    'CT5': check_ct5, 'CT6': check_ct6, 'CT7': check_ct7, 'CT8': check_ct8,
}


def parse_exemptions(text):
    out = {}
    for m in EXEMPT_RE.finditer(text):
        code = m.group(1).replace(' ', '').upper()
        out[code] = m.group(2).strip() or '（未写理由）'
    return out


def audit_text(text, mode='auto', style=None, has_script=False):
    """返回 (results, ctx)。results = [(code, title, status, msg), ...]"""
    tn = _norm(text)
    tnl = tn.lower()
    n_shots = count_shots(text)
    n_assets = len(ASSET_HEAD_RE.findall(text))
    if mode == 'auto':
        mode = detect_mode(text, n_shots, n_assets)

    sid_m = STYLE_ID_RE.search(text) or STYLE_ID_ALT_RE.search(text)
    ctx = {
        'mode': mode,
        'n_shots': n_shots,
        'n_assets': n_assets,
        'style': style,
        'style_id': sid_m.group(1) if sid_m else None,
        'has_script': has_script,
    }

    exempt = parse_exemptions(text)
    results = []
    for code, title, ref, fp in CONTRACT_ITEMS:
        st, msg = CHECKERS[code](text, tn, tnl, ctx)
        if code in exempt and code in SEALED_ITEMS:
            # 硬项不接受豁免——明确报出来，别让人以为声明一下就过了
            st, msg = (('FAIL' if st == 'FAIL' else st),
                       msg + '　🔴 本项（%s）**不接受豁免**：%s 任何形态的交付都必须做，'
                             '该声明无效。' % (code, title))
        elif code in exempt:
            st = 'N/A'
            msg = '显式豁免：%s —— 跳过，**不等于通过**。（原检查结论：%s）' % (exempt[code], msg)
        results.append((code, title, st, msg))
    return results, ctx


# ─────────────────────────────────────────────────────────────────────────────
# --init 建表
# ─────────────────────────────────────────────────────────────────────────────

STYLE_LADDER_HINT = {
    '递进四步': 'Step 1 影像基底（2D/3D/实拍/平面工艺，**必问不得自动带出**）→ '
                'Step 2 每族 3 个候选锚 → Step 3 收敛 1 个 → Step 4 可选辅助质感（可跳过）',
    '冻结四项': '① 一个主 style_id；② 至多一个辅助质感且不与主锚互斥；'
                '③ 全包只允许该锚的色域 / 材质口径 / 禁用项 / heads_range，改风格 = 重开任务；'
                '④ 第三方作品名禁入最终提示词',
}


def print_init(mode='full', style=None):
    print('# 📋 liqi 交付契约核销表（开工必建 · 交付必核）')
    print('')
    print('> **铁律**：`check_prompt.mjs` 报全绿只代表「单镜投喂块语法合格」，'
          '**绝不代表全流程交付完成**！')
    print('> 开工前先建本表；每写完一项回对照「唯一权威源」与「必现结构指纹」打 `[x]`；')
    print('> 交付前跑 `python scripts/audit_contract.py <稿件.md>` 全绿放行。')
    print('> ⚠️ **N/A ≠ 通过**——本项不适用或显式跳过时，报告里单列，不计入通过项。')
    print('')
    print('| 状态 | 契约码 | 阶段交付物 | 唯一权威源（必须回读，禁凭印象手搓） | 必现结构指纹 |')
    print('| :--- | :--- | :--- | :--- | :--- |')
    for code, title, ref, fp in CONTRACT_ITEMS:
        seal = ' 🔒' if code in SEALED_ITEMS else ''
        print('| `[ ]` | `%s`%s | **%s** | `%s` | %s |' % (code, seal, title, ref, fp))
    print('')
    print('（🔒 = 不接受豁免的硬项；其余可用段首一行 `【契约豁免】CTx：<理由>` 声明跳过）')
    if style:
        print('')
        print('## 🎨 本次风格锚冻结指引（权威源：`references/风格路由表.md`）')
        print('')
        print('- **本次锁定 style_id**：`%s`' % style)
        print('- **递进四步**：%s' % STYLE_LADDER_HINT['递进四步'])
        print('- **选定即冻结**：%s' % STYLE_LADDER_HINT['冻结四项'])
        print('- **包内声明写法**：`【风格】%s`（机器认这个；想给人看另起一行加中文名注释）' % style)
        print('- **必须回查**：`references/风格路由表.md` 第二节 id 总表 + 该 id 的'
              '`references/风格锚_%s.md`' % style)


# ─────────────────────────────────────────────────────────────────────────────
# --self-test
# ─────────────────────────────────────────────────────────────────────────────

_COMPLIANT_FULL = """# 示例剧 E01S02 整片包
【三锁】模型=Seedance 2.5（全能参考模式）｜画幅=16:9 横屏｜投放面=国内面｜交付=markdown
【风格】guoman-cel-2d
资产依赖分级：A3

〇 风格锚（九段）
① 画风与材质质感：2D 赛璐璐，粗黑轮廓线，平涂色块。
② 配色与色域：主色 #2B3A55，辅色 #6B7C93，重音色 #C9A961，禁霓虹。
③ 运动签名：硬切节奏，禁丝滑。
④ 角色锁定：沈知微——二十岁上下女性，靛蓝布衫，三头身。
⑤ 场景锁定：河岸栈桥，青灰晨雾，光从画面右后方来。
⑥ 关键道具锁定：旧皮箱，暗棕牛皮黄铜扣，全片唯一重音色。
⑦ 光色基调：主光为雾中漫射，入射角低，影子虚。
⑧ 声音签名：环境＝雾中水声；动作＝踏水声；呼吸＝奔跑喘息；配乐＝梆子。
⑨ 排除项：禁写实照片感、3D 渲染、真人化。
选定即冻结（四条）：一个主 style_id；至多一个辅助质感；不得中途换锚；第三方作品名禁入。

〇.5 资产层
角色资产板（4 View 版式）：左区头部近景（身份锚），右区保头无脸正面 / 90° 侧面 / 背面。
文字锁 16 项：五官 10 项（脸型骨相 / 眉形 / …）；服装 6 项（面料类别 / …）。
性别锚点：22~26岁女性（赶路人）。
场景方位卡：罗盘方位北窗；固定锚物＝栈桥立柱、船头；屏幕方向映射：栈桥在画面左、船头在画面右；禁变约定：立柱位置锁死。
项目级光照锚点表：清晨＝色温 5600K、入射角 15°、影子虚化、无人工光。
关键道具锁定：旧皮箱。入画方式＝手持；持物分左右手：左手托箱底、右手箍箱身。
持物设定图：参考角色 4 View 板的左区头部近景 face_hd 裁片。

〇.6 剧本门控
五阶门控：Gate 1 Premise 通过 / Gate 2 Structure 通过 / Gate 3 Beat Sheet 通过 / Gate 4 Worldview & Entity Bounds 通过 / Gate 5 Script Page 通过。
情节点：P01 沈知微得知雾要变天（信息翻转）。

一转场注记总表
镜1（雾岸）→镜2（赶船）：换场硬切 + 状态交接。

二 连续性台账
镜1：@沈知微 靛蓝布衫，抱旧皮箱。

三 镜块
镜 1｜雾岸（13s · S02 前段）
站位：@沈知微（画面左三分之一）｜@老周（画面右三分之一）
时间线分镜：
【时间轴】0-5s：全景，手持跟随。沈知微抱旧皮箱沿土路奔跑。
本镜光色基调：青灰晨雾。
本镜保真预算：主=皮箱皮质与抱箱手势；次=雾的层次；省=河面。
刚性约束：
必锁：旧皮箱=暗棕牛皮黄铜扣。
—— 以下不进正文 ——
# duration: 13s | # ratio: 16:9 | # 输出规格: 4K/30fps

四 全局制作纪律
1. 风格铁律：全部镜头保持 2D 赛璐璐。2. 参数卫生铁律……

附 《改动清单》与《改动复验报告》
附 校验结果：check_prompt.mjs 0 error / audit_literal.py 0；audit_project.py 0 error / 2 warning；check_style.mjs 0 error；audit_risk.py 风险分 0。
质检结论：三层质检 L1~L3 全过；过审风险分 0；P0~P2 三级门禁无 P0/P1。
"""

_SKETCHY = """# 某剧分镜看板
【三锁】模型=Seedance 2.5｜画幅=16:9｜投放面=国内面
# style_id: guoman-cel-2d
〇 风格锚：2D 赛璐璐，冷色调。
〇.5 资产层
- 沈知微：22岁，穿靛蓝布衫。
锚「旧皮箱」
镜 1｜雾岸（13s）
时间线分镜：
【时间轴】0-5s：沈知微抱箱子跑。
"""


def _self_test():
    # 1. --init 建表
    from io import StringIO
    old = sys.stdout
    buf = StringIO()
    sys.stdout = buf
    try:
        print_init('full', 'guoman-cel-2d')
    finally:
        sys.stdout = old
    out = buf.getvalue()
    assert 'CT3' in out and '资产层_锁定与一致性' in out, 'init 建表缺 CT3/权威源'
    assert '🔒' in out, 'init 建表未标出不可豁免硬项'
    assert 'guoman-cel-2d' in out, 'init 未输出风格冻结指引'

    # 2. 合规整片包：零 FAIL
    res, ctx = audit_text(_COMPLIANT_FULL, mode='auto', style='guoman-cel-2d')
    fails = [(c, m) for c, t, s, m in res if s == 'FAIL']
    assert not fails, '合规整片包不应有 FAIL：%s' % fails
    assert ctx['mode'] == 'full', '满配标记应判 full，实得 %s' % ctx['mode']
    passes = [c for c, t, s, m in res if s == 'PASS']
    assert len(passes) >= 7, '合规包 PASS 数应 ≥7，实得 %s' % passes

    # 3. 简笔包：CT2 / CT3 / CT4 / CT6 / CT7 全中
    res2, ctx2 = audit_text(_SKETCHY, mode='board')
    fails2 = {c: m for c, t, s, m in res2 if s == 'FAIL'}
    for need in ('CT3', 'CT4', 'CT7'):
        assert need in fails2, '简笔包应触发 %s，实得 %s' % (need, list(fails2))
    # CT3 必须给出「简笔糊弄」判词
    assert '简笔' in fails2['CT3'] or '缺' in fails2['CT3'], 'CT3 判词未指出简笔'

    # 4. 资产包：CT6 应判 N/A 而不是 FAIL
    asset_pkg = ('〇 资产包\n【风格】guoman-cel-2d\n〇 风格锚（九段）\n'
                 '① 画风与材质质感：2D。② 配色与色域：x。③ 运动签名：x。\n'
                 '④ 角色锁定：x。⑤ 场景锁定：x。⑥ 关键道具锁定：x。\n'
                 '⑦ 光色基调：x。⑧ 声音签名：x。⑨ 排除项：x。\n'
                 '选定即冻结。\n资产 A1｜沈知微\n资产 B1｜旧皮箱\n')
    res4, ctx4 = audit_text(asset_pkg, mode='auto')
    assert ctx4['mode'] == 'asset', '无镜块 + 资产条目应判 asset，实得 %s' % ctx4['mode']
    st6 = dict((c, s) for c, t, s, m in res4)['CT6']
    assert st6 == 'N/A', '资产包 CT6 应为 N/A，实得 %s' % st6

    # 5. 豁免：CT3 可豁（变 N/A）；CT2 不可豁（仍 FAIL 并附声明无效）
    ex_text = _SKETCHY + '\n【契约豁免】CT3：本包 A1 档\n【契约豁免】CT2：懒得选\n'
    res5, _ = audit_text(ex_text, mode='board')
    d5 = dict((c, (s, m)) for c, t, s, m in res5)
    assert d5['CT3'][0] == 'N/A' and '不等于通过' in d5['CT3'][1], 'CT3 豁免未生效'
    assert d5['CT2'][0] == 'FAIL' and '不接受豁免' in d5['CT2'][1], 'CT2 硬项被豁免了（不应发生）'

    # 6. 修改类交付缺《改动复验报告》→ CT8 FAIL
    mod_text = _COMPLIANT_FULL.replace('附 《改动清单》与《改动复验报告》\n', '附 《改动清单》\n')
    res6, _ = audit_text(mod_text, mode='full')
    d6 = dict((c, s) for c, t, s, m in res6)
    assert d6['CT8'] == 'FAIL', '修改类缺复验报告应 CT8 FAIL，实得 %s' % d6['CT8']

    # 7. 未给剧本 → CT1 必须 N/A（跳过不是通过）
    res7, _ = audit_text(_COMPLIANT_FULL, mode='full')
    d7 = dict((c, s) for c, t, s, m in res7)
    assert d7['CT1'] in ('PASS', 'N/A'), 'CT1 实得 %s' % d7['CT1']
    res7b, _ = audit_text('# 空包\n镜 1｜x（13s）\n# duration: 13s\n', mode='board')
    d7b = dict((c, s) for c, t, s, m in res7b)
    assert d7b['CT1'] == 'N/A', '无剧本层时 CT1 应 N/A，实得 %s' % d7b['CT1']

    # 8. 跳过检测要**贴着脚本名**才算：紧邻脚本名的「未跑」→ WARN；
    #    泛泛提「某门因没配置输入所以跳过」不该误报（黄金样例踩过的假报）
    near = _COMPLIANT_FULL + '\n（check_style.mjs 未跑，待补）\n'
    r_near = dict((c, s) for c, t, s, m in audit_text(near, mode='full')[0])
    assert r_near['CT7'] == 'WARN', '紧邻脚本名的「未跑」应 WARN，实得 %s' % r_near['CT7']
    far = _COMPLIANT_FULL + '\n补充：C / C2 / F / G 四门因未配置输入所以跳过，理由见质控层第三节。\n'
    r_far = dict((c, s) for c, t, s, m in audit_text(far, mode='full')[0])
    assert r_far['CT7'] == 'PASS', '泛泛的「跳过」不应误报，实得 %s' % r_far['CT7']

    print('[+] audit_contract.py self-test PASSED（8 组）')
    return 0


# ─────────────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description='liqi 交付契约核销器（阶段产物完整性）')
    ap.add_argument('file', nargs='?', help='待核销的 Markdown 稿件')
    ap.add_argument('--init', action='store_true', help='开工前输出《交付契约核销表》')
    ap.add_argument('--mode', default='auto', choices=['auto', 'full', 'board', 'asset'])
    ap.add_argument('--style', default=None, help='本次锁定的 style_id（核包内声明是否同锚）')
    ap.add_argument('--script', default=None, help='剧本纯文本（传了＝声明本包有剧本层，CT1 转必查）')
    ap.add_argument('--self-test', action='store_true')
    # v5.37.1：默认写 .gates.jsonl（与另外五个脚本汇流），--no-log 关闭。
    ap.add_argument('--no-log', action='store_true',
                    help='不把本次结果追加到被校验文件同目录的 .gates.jsonl')
    args = ap.parse_args()

    if args.self_test:
        sys.exit(_self_test())

    if args.init or not args.file:
        print_init('full' if args.mode == 'auto' else args.mode, style=args.style)
        sys.exit(0)

    if not os.path.isfile(args.file):
        print('[-] 文件不存在: %s' % args.file, file=sys.stderr)
        sys.exit(2)

    try:
        with open(args.file, encoding='utf-8') as f:
            text = f.read()
    except (OSError, UnicodeDecodeError) as e:
        print('E-INPUT: 文件读不了：%s' % e)
        sys.exit(2)

    has_script = bool(args.script)
    if args.script and not os.path.isfile(args.script):
        print('[!] --script 指向的文件不存在，按「无剧本层」处理: %s' % args.script,
              file=sys.stderr)
        has_script = False

    results, ctx = audit_text(text, mode=args.mode, style=args.style, has_script=has_script)

    print('=' * 78)
    print('liqi 交付契约核销报告：%s' % os.path.basename(args.file))
    print('模式 %s ｜ 镜块 %d ｜ 资产条目 %d ｜ 契约 %d 项'
          % (ctx['mode'], ctx['n_shots'], ctx['n_assets'], len(results)))
    print('=' * 78)

    tally = {'PASS': 0, 'WARN': 0, 'FAIL': 0, 'N/A': 0}
    tag = {'PASS': color('[PASS]', GRN), 'WARN': color('[WARN]', YEL),
           'FAIL': color('[FAIL]', RED), 'N/A': color('[N/A ]', DIM)}
    for code, title, st, msg in results:
        tally[st] += 1
        print('\n%s %s %s' % (tag[st], code, title))
        print('        %s' % msg)

    print('\n' + '-' * 78)
    print('契约统计：PASS %d ｜ WARN %d ｜ FAIL %d ｜ N/A %d'
          % (tally['PASS'], tally['WARN'], tally['FAIL'], tally['N/A']))
    graded = tally['PASS'] + tally['WARN'] + tally['FAIL']
    if graded:
        print('核销率（PASS / 适用项）：%d / %d'
              % (tally['PASS'], graded))
    if tally['N/A']:
        na = [c for c, t, s, m in results if s == 'N/A']
        print(color('⚠️ N/A（%s）＝ 不适用或显式跳过，**不计入通过项**——「没查」不是「没问题」。'
                    % ' / '.join(na), YEL))
    print('-' * 78)

    if tally['FAIL']:
        print(color('[-] 交付契约未通过：%d 项缺失。**严禁把 check_prompt 全绿当任务完成**。'
                    % tally['FAIL'], RED))
        exit_code = 1
    elif tally['WARN']:
        print(color('[!] 契约全项在位，但有 %d 项指纹不全，请人工复核后交付。'
                    % tally['WARN'], YEL))
        exit_code = 2
    else:
        print(color('[+] 交付契约全项核销通过（N/A 项已在报告单列）。', GRN))
        exit_code = 0

    # v5.37.1（审查报告 AR-1）：交付契约也进 .gates.jsonl —— 此前它只在终端里存在，
    # gates_stats 完全看不到「CT7 最常缺」这类信息，闸门迭代只能靠感觉。
    # 分桶口径：FAIL→error、WARN→warn、N/A→na（**不计入通过也不能计入失败**，
    # 但要在码表里留痕，否则「未查」会被读成「没响过」）。PASS 不记。
    if not log_disabled(sys.argv[1:]):
        issues = []
        for code, _title, st, msg in results:
            if st == 'FAIL':
                issues.append({'code': code, 'level': 'error', 'msg': msg[:200]})
            elif st == 'WARN':
                issues.append({'code': code, 'level': 'warn', 'msg': msg[:200]})
            elif st == 'N/A':
                issues.append({'code': code + ':N/A', 'level': 'na', 'msg': msg[:200]})
        append_gate_log('audit_contract.py', args.file, exit_code, issues)
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
