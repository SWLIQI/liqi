#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
liqi_config.py —— 项目配置文件 `liqi.json` 的加载与应用（v5.37.5）

为什么要有这一层：
  liqi 的 opt-in 参数已经长到「一次跑不全」的地步 —— `audit_all.py` 自己的用法说明里就写着
  「opt-in 参数一大堆」。少传一个 `--ledger`，G 门就报「未查」；报「未查」不算错，所以
  没人会当场发现，直到某天想起来「我那次 G 门到底查没查」。v5.37.4 把「未查」单列出来之后，
  这件事第一次可以被量化：三个官方样例裸跑，每包 10~12 条「未查」。

  配置文件的真正价值不是省打字，是**把「这次到底查了哪几门」固定成可提交、可 review 的文件**。
  参数在命令行里是一次性的（关掉终端就没了），`liqi.json` 进版本库之后，下一轮谁跑都一样。

设计口径（四条，都是为了「不静默」）：
  1. **未知键直接报错**，不忽略。写错一个键名而没人告诉你，等于配了却没用 —— 比没配更坏。
  2. **类型不对直接报错**（`limit` 必须是整数、`adapt` 必须是 true/false），不做隐式转换。
  3. **相对路径按配置文件所在目录解析**，不按 cwd。否则 `cd` 到别处跑就整片找不到，
     报出来的还是一串「未查」。
  4. **只填空值，不覆盖显式 CLI**。和 `--auto` 同一条规矩：显式 > 配置 > 自动发现。

用法（被脚本 import，不单独跑）：
    import liqi_config
    cfg, errs, path = liqi_config.resolve(args.config, args.pkg)   # 'auto' = 找包同目录
    if errs: ...报错退出 2...
    notes = liqi_config.apply(args, cfg, given_flags)
"""
import json
import os

# 键 → (类型, 说明)。类型决定解析方式；说明只在报错时打给人看。
# 键名与 CLI 长参数同名（下划线 ↔ 连字符），刻意不做别名表 —— 一张表两套名字，
# 迟早出现「文档写 a、代码认 b」。
KEYS = {
    # —— 输入路径（相对路径按配置文件所在目录解析）
    'script':      ('path', '剧本纯文本 .txt'),
    'assets':      ('path', '资产库参考图目录'),
    'registry':    ('path', 'asset-registry.json'),
    'style_registry': ('path', '项目级 style-registry.json（check_style --registry 用；项目自建风格必配，v6.4.1）'),
    'versions':    ('path', 'C 门版本互斥词表 .json'),
    'ledger':      ('path', 'continuity-ledger.md'),
    'decisions':   ('path', 'decisions.jsonl'),
    'foreshadow':  ('path', '伏笔表 .md'),
    'epstruct':    ('path', '分集结构表 .md'),
    'adapttable':  ('path', '改编转换表 .md'),
    'beats':       ('path', '节拍清单 beats.txt（只给 check_prompt 用）'),
    # —— 标量
    'cast':        ('str',  '剧本角色名，逗号分隔'),
    'model':       ('str',  '锁①模型版本：2.5 / 2.0 / h3 / h3max'),
    'surface':     ('str',  '投放面：cn / intl / h3（audit_all 用）'),
    'limit':       ('int',  '单镜时长硬上限（临时核对用，正式跑别写）'),
    # —— 列表
    'skip':        ('list', '等同 --skip：本项目永久跳过的门，如 ["style", "contract"]'),
    # —— 开关
    'adapt':       ('bool', '本项目是改编，N3 查事实权威链五级标注'),
    'coverage':    ('bool', '统计剧本台词采用率（仅供参考）'),
    'official':    ('bool', 'check_prompt 官方 API 字数门禁：中文 ≤500 字 / 英文 ≤1000 词'),
    'auto':        ('bool', '等同 --auto：就近自动挂载剩余输入'),
}

# 各脚本认识的键。分表是为了「给 audit_project 传 surface」这种错配也能当场报出来，
# 而不是安静地收进 namespace 谁也不用。
PROJECT_KEYS = ('script', 'assets', 'cast', 'registry', 'versions', 'ledger', 'decisions',
                'foreshadow', 'epstruct', 'adapttable', 'model', 'limit',
                'adapt', 'coverage', 'auto')
ALL_KEYS = tuple(KEYS)


class ConfigError(Exception):
    pass


def discover(pkg_path):
    """包同目录的 liqi.json（`--config auto` 用）。找不到返回 None。"""
    d = os.path.dirname(os.path.abspath(pkg_path))
    for name in ('liqi.json', 'liqi.config.json'):
        p = os.path.join(d, name)
        if os.path.isfile(p):
            return p
    return None


def load(path, allowed=ALL_KEYS):
    """读并校验。返回 (cfg, errs)。errs 非空即不可用 —— 调用方必须退出 2，不许降级继续。

    返回的 cfg 只含 `allowed` 里的键，路径已按配置文件目录解析成绝对路径。
    """
    errs = []
    if not os.path.isfile(path):
        return {}, ['E-CONFIG：找不到配置文件 %s' % path]
    try:
        with open(path, encoding='utf-8') as f:
            raw = json.load(f)
    except Exception as e:  # noqa: BLE001
        return {}, ['E-CONFIG：%s 不是合法 JSON —— %s' % (os.path.basename(path), e)]
    if not isinstance(raw, dict):
        return {}, ['E-CONFIG：%s 顶层必须是对象 {…}，实际是 %s'
                    % (os.path.basename(path), type(raw).__name__)]

    base = os.path.dirname(os.path.abspath(path))
    cfg = {}
    # `_` 开头的键＝注释（JSON 没有注释语法，这是通用约定）。除此之外的未知键必须报错：
    # 一个拼错的 `ledgerr` 如果被静默忽略，用户会以为 G 门查过了，实际报「未查」。
    unknown = [k for k in raw if not k.startswith('_') and k not in KEYS]
    if unknown:
        errs.append('E-CONFIG：未知键 %s。认识的键见 scripts/liqi_config.py 的 KEYS；'
                    '**未知键不忽略**——配了却没生效比没配更坏。'
                    '（写说明请用 `_note` / `_comment` 这类下划线开头的键）'
                    % '、'.join(sorted(unknown)))
    # 认识的键但本脚本不消费（如 audit_project 拿到 surface）→ 静默跳过，不报错。
    # 一份 liqi.json 要能同时喂 audit_all / audit_project / check_prompt，
    # 各脚本只取自己要的那几个键；若这里报错，就得为每个脚本各写一份配置。

    for k, v in raw.items():
        if k not in KEYS or k not in allowed:
            continue
        kind = KEYS[k][0]
        if kind == 'path':
            if not isinstance(v, str) or not v.strip():
                errs.append('E-CONFIG：%s 必须是非空字符串路径' % k)
                continue
            p = v if os.path.isabs(v) else os.path.join(base, v)
            cfg[k] = os.path.normpath(p)
            if not os.path.exists(p):
                errs.append('E-CONFIG：%s 指向的路径不存在：%s（相对路径按 %s 解析）'
                            % (k, p, os.path.basename(path)))
        elif kind == 'str':
            if not isinstance(v, str):
                errs.append('E-CONFIG：%s 必须是字符串' % k)
                continue
            cfg[k] = v.strip()
        elif kind == 'int':
            if isinstance(v, bool) or not isinstance(v, int):
                errs.append('E-CONFIG：%s 必须是整数（布尔和字符串都不收）' % k)
                continue
            cfg[k] = v
        elif kind == 'bool':
            if not isinstance(v, bool):
                errs.append('E-CONFIG：%s 必须是 true 或 false（不收 "true" / 1）' % k)
                continue
            cfg[k] = v
        elif kind == 'list':
            # 只收字符串数组。`"skip": "style"` 这种单值写法是最常见的错，
            # 静默当成长度 1 的列表会让「写错也没事」变成习惯，所以直接报错。
            if not isinstance(v, list) or any(not isinstance(x, str) for x in v):
                errs.append('E-CONFIG：%s 必须是字符串数组，如 ["style", "contract"]' % k)
                continue
            cfg[k] = [x.strip() for x in v if x.strip()]
    return cfg, errs


def resolve(config_arg, pkg_path, allowed=ALL_KEYS):
    """把 `--config` 的值落成 (cfg, errs, path)。

    config_arg 为空 → 不加载（返回空 dict，不报错：配置文件是可选的）。
    config_arg == 'auto' → 找包同目录的 liqi.json；找不到**报错不静默**：
    用户写了 `--config auto` 就是明确要求用配置，结果没找到却继续跑，等于骗他。
    """
    if not config_arg:
        return {}, [], None
    if config_arg == 'auto':
        p = discover(pkg_path)
        if not p:
            return {}, ['E-CONFIG：--config auto 找不到 %s 同目录的 liqi.json'
                        % os.path.basename(pkg_path)], None
        cfg, errs = load(p, allowed)
        return cfg, errs, p
    cfg, errs = load(config_arg, allowed)
    return cfg, errs, config_arg


def apply(args, cfg, given_flags):
    """把 cfg 填进 args，**只填空值**，并返回落盘说明（供报告打印）。

    given_flags：用户显式传过的长参数集合（如 {'--ledger', '--model'}）。
    显式 CLI > 配置文件 > --auto 自动发现 —— 这条优先级写进文档，不靠记忆。
    """
    notes = []
    for k, v in cfg.items():
        flag = '--' + k.replace('_', '-')
        if flag in given_flags:
            notes.append('[config] 跳过 %s（命令行已显式指定）' % flag)
            continue
        cur = getattr(args, k, None)
        if isinstance(v, list):
            # 列表取并集（命令行 --skip a 与配置 ["b"] 都要生效），去重后仍按配置顺序补尾。
            have = list(cur or [])
            merged = have + [x for x in v if x not in have]
            if merged != have:
                setattr(args, k, merged)
                notes.append('[config] %s = %s（并集）' % (flag, ','.join(merged)))
            continue
        if isinstance(v, bool):
            if v and not cur:
                setattr(args, k, True)
                notes.append('[config] %s = true' % flag)
            continue
        if cur in (None, '', 0):
            setattr(args, k, v)
            notes.append('[config] %s = %s' % (flag, v))
        else:
            notes.append('[config] 跳过 %s（已有值 %s，不覆盖）' % (flag, cur))
    return notes


def given_flags(argv):
    """从 argv 里收用户显式传过的长参数名（兼容 `--k v` 与 `--k=v`）。"""
    out = set()
    for a in argv:
        if a.startswith('--'):
            out.add(a.split('=', 1)[0])
    return out
