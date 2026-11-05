#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
body_rules.py —— 「可复制正文」的统一定义（v5.37.3）

为什么单独抽一份：
  这套体系里最基础的概念是「哪些字会被送进模型」。它有**三个**消费者，此前是三套写法：

  | 脚本 | 原做法 | 后果 |
  |---|---|---|
  | `audit_risk.py` | 只按 `Must not` / 参数行 / `——` 截断，**逐行过滤一个都没有** | 文档层的 `>` 说明行被当成正文扫，风险分虚高；而且「算不算」取决于该行落在围栏前还是围栏后 |
  | `audit_literal.py` | `is_body_line()` 严过滤，连台词行/声音层都排除 | 对「抽象表述」是对的（台词与声音层里出现听觉词是合法的），但它不能直接给 audit_risk 用——台词里的高危词是真会送的 |
  | `audit_project.py` | 只按围栏与 `BODY_END_RES` 截断 | 同 audit_risk 的第一条毛病 |

  本模块只提供**两个脚本都要的那一半**：文档层 / 容器层行不算正文，其余（台词、声音层、场景行、
  时间线）都算。`audit_literal.py` 的额外排除（台词、声音层、风格串、卷尾纪律）是**它自己的判据需要**，
  留在它自己文件里，不并进来——并进来就等于让 audit_risk 漏掉台词里的高危词。

围栏语义（本模块与 `audit_project.py` 的差异，也是有意的）：
  包里有 ``` 围栏时，**只把第一个围栏内的内容当正文**；围栏外的施工注记（站位、台账、对照表）
  不进风险扫描。没有围栏时（liqi 现行标准格式，见 examples/ 三个样例）退化为
  「到 `Must not` / 参数行 / `—— 以下不进正文` 为止」。
  旧实现两种情形混着走——围栏前的说明行照算、围栏后的不算，**同一句话换个位置结论就变**。
"""
import re

# 正文到此为止：这些行本身不是正文，且其后都不是正文
BODY_END_RES = [
    re.compile(r'^Must\s*not', re.I),
    re.compile(r'^(?:#|【参数】)\s*(duration|ratio|输出规格|后期)'),
    re.compile(r'^——\s*以下不进正文'),
    re.compile(r'^技术规格[：:]'),
]

# 文档层 / 容器层：整行不算正文（但**不中断**扫描，因为后面的行可能还是正文）
DOC_LINE_RES = [
    re.compile(r'^#'),                       # Markdown 标题 / 参数行
    re.compile(r'^>'),                       # 引用块 = 写给维护者看的说明
    re.compile(r'^[—─]{2,}'),                # 容器分隔线
    re.compile(r'^\|'),                      # 表格行（对照表、台账）
    re.compile(r'^```'),                     # 围栏标记本身
    re.compile(r'^【参数】|^参数：'),          # 参数块（去 Markdown 符号后的写法）
    re.compile(r'^(注|说明|提示|示例)[：:]'),   # 说明性小标题
]


def is_doc_line(line):
    """整行是否属于文档层 / 容器层（不算正文）。"""
    s = line.strip()
    if not s:
        return True
    return any(r.match(s) for r in DOC_LINE_RES)


def has_fence(block):
    return any(l.strip() == '```' for l in block.split('\n'))


def body_of(block, skip_head=1):
    """取一个镜/段块（或资产单元）里真正会被送进模型的那部分文本。

    skip_head：跳过块首的 N 行元数据（`镜1｜标题（8s）` / `资产 CHAR-01｜…`）。
      必须跳：段头不是投喂内容，且它会掩盖假绿——正文整段落在参数行之后时，
      段头那一行会让「抽到字符数」不为 0，于是一门什么都没查的扫描照样报 ✅。
      （v5.37.3 由 selftest_audit_risk.py 的 C13 抓出来。）
    """
    lines = block.split('\n')
    head, rest = lines[:skip_head], lines[skip_head:]

    if has_fence(block):
        out, inside = [], False
        for l in lines:
            if l.strip() == '```':
                if inside:
                    break          # 第一个围栏闭合 → 正文结束
                inside = True
                continue
            if inside and not is_doc_line(l):
                out.append(l)
        # 围栏存在时段头本来就在围栏外，不用重复跳
        return '\n'.join(out)

    out = []
    for l in rest:
        if any(r.match(l) for r in BODY_END_RES):
            break
        if is_doc_line(l):
            continue
        out.append(l)
    return '\n'.join(out)
