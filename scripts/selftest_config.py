#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""liqi 项目配置回归（v5.37.5 · `--config liqi.json`）

治的病：**配置文件是本项目里唯一「配了却没生效，你也不会知道」的东西**。
参数忘了传，屏幕上会有一行「未查」；配置写错一个键名，屏幕上什么都不会变——
G 门照样报「未查」，而你以为它查过了。所以 `liqi_config.py` 立了四条口径
（未知键报错 / 类型不对报错 / 相对路径按配置目录 / 只填空值），
本脚本把这四条口径**逐条钉成回归锁**：以后谁把「未知键忽略」改回去，这里会红。

覆盖：
  C1  未知键 ledgerr              → rc=2 且点名「未知键 ledgerr」        ← 静默忽略回归锁
  C2  `_note` 注释键              → 不报未知键（rc≠2）                   ← 反向锁：别把注释也禁了
  C3  limit 写成字符串 "20"       → rc=2 且点名类型
  C4  adapt 写成字符串 "true"     → rc=2（不收 "true"）                  ← 布尔隐式转换回归锁
  C5  registry 指向不存在的文件   → rc=2 且提示「按 <配置名> 解析」
  C6  相对路径 + 在别的 cwd 跑    → 仍能找到（按配置目录解析，不按 cwd）  ← cwd 依赖回归锁
  C7  `--config auto` 无 liqi.json→ rc=2，不静默跳过
  C8  配置生效                    → 输出 `[config] --registry = …`
  C9  显式 CLI `--model 2.0`      → `[config] 跳过 --model` + 锁①=2.0     ← 优先级回归锁
  C10 audit_project 拿到 surface  → 不报错（认识的键，只是本脚本不消费）
  C11 audit_all --config auto     → 首行 `surface=cn`，且总账「未查 0」

用法：python scripts/selftest_config.py
退出码：0 = 全过；1 = 有败
注意：包与配置写入临时目录，跑完清理；需要 node（C11 会走 audit_all 的 check_prompt 段）。
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
P = sys.executable

# 一份「能被 audit_project 正常读完」的最小包。配置回归不关心门禁判据，
# 只关心「配置有没有被读到」，所以包越短越好——短包红了，一定是配置的问题。
PKG = '''# 配置回归包
【赛道】1 国内剧
【三锁】模型=2.5 ｜ 画幅=16:9 ｜ 投放面=国内面
【模型版本】：2.5
【风格】urban-folk-filmstill
【资产依赖分级】A2
素材形态：M1（编号占位 · 图号见文末接线单）

镜1｜楼道灯灭（8s）
# title: 镜1｜楼道灯灭 | # duration: 8s | # ratio: 16:9
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
音乐层：无
参考图接线单：@图片1 = 陈默定妆
'''


def run(cmd, cwd=None):
    p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out = p.communicate()[0].decode('utf-8', 'replace')
    # 必须先 communicate() 再读 returncode：`return p.returncode, p.communicate()…`
    # 这种写法里元组从左往右求值，returncode 在子进程收尾前就被读走了 —— 恒为 None。
    # （selftest_boundary.py 原来就是这写法，只因它丢掉了 rc 才没露出来，v5.37.5 一并改掉）
    return p.returncode, out


def run2(cmd):
    """stdout / stderr 分开收：`--json` 的纯净度只能用这个测。"""
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    o, e = p.communicate()
    return p.returncode, o.decode('utf-8', 'replace'), e.decode('utf-8', 'replace')


def main():
    # v5.47.1：再深一层，包的父目录是夹具私有目录而非 %TEMP%（auto 探针扫父目录会串台）
    root = tempfile.mkdtemp(prefix='liqi_cfg_')
    tmp = os.path.join(root, 'proj')
    os.makedirs(tmp)
    pkg = os.path.join(tmp, '包.md')
    with open(pkg, 'w', encoding='utf-8') as f:
        f.write(PKG)
    # 资产库占位：C6 要证明「相对路径按配置文件目录解析」，
    # 所以这个文件必须真实存在，且只可能被「按配置目录」这一条规则找到。
    reg = os.path.join(tmp, 'asset-registry.json')
    with open(reg, 'w', encoding='utf-8') as f:
        json.dump({'characters': {}, 'props': {}}, f, ensure_ascii=False)

    def write_cfg(obj, name='liqi.json'):
        p = os.path.join(tmp, name)
        with open(p, 'w', encoding='utf-8') as f:
            if isinstance(obj, str):
                f.write(obj)
            else:
                json.dump(obj, f, ensure_ascii=False, indent=2)
        return p

    def ap(cfg_arg, *extra, cwd=None):
        cmd = [P, os.path.join(HERE, 'audit_project.py'), pkg, '--no-log']
        if cfg_arg:
            cmd += ['--config', cfg_arg]
        cmd += list(extra)
        return run(cmd, cwd=cwd or tmp)

    def expect(name, rc, out, want_rc=0, has=(), absent=(), note=''):
        """want_rc=None = 本用例不断言退出码。

        为什么不一律断言 rc=0：夹具包只有一镜，配额门本来就会报「未查」、转场表本来就没有，
        退出码必然非 0。把 rc 断言进来，等于让这条配置回归去背门禁判据的锅 ——
        门禁改了判据，这里就跟着红，而红的地方跟配置一点关系都没有。
        所以只在「必须拦下来」的用例上断言 rc=2，其余用输出内容断言。
        """
        ok = True
        why = []
        if want_rc is not None and rc != want_rc:
            ok = False
            why.append('rc 应为 %d，实为 %d' % (want_rc, rc))
        for h in has:
            if h not in out:
                ok = False
                why.append('输出缺「%s」' % h)
        for a in absent:
            if a in out:
                ok = False
                why.append('输出不该有「%s」' % a)
        return name, ok, why, note

    rows = []

    # C1 未知键 —— 拼错一个字母就必须当场报错
    write_cfg({'ledgerr': 'continuity-ledger.md'})
    rc, out = ap('auto')
    rows.append(expect('C1 未知键 ledgerr → rc=2 并点名', rc, out, 2,
                       has=['未知键 ledgerr']))

    # C2 `_note` 是注释键，必须放行（否则用户没法在 JSON 里写说明）
    write_cfg({'_note': '本项目说明', 'registry': 'asset-registry.json'})
    rc, out = ap('auto')
    rows.append(expect('C2 `_note` 注释键放行', rc, out, None, has=['[config] --registry'],
                       absent=['未知键']))

    # C3 int 类型
    write_cfg({'limit': '20'})
    rc, out = ap('auto')
    rows.append(expect('C3 limit 写成字符串 → rc=2', rc, out, 2, has=['limit 必须是整数']))

    # C4 bool 类型：不收 "true"
    write_cfg({'adapt': 'true'})
    rc, out = ap('auto')
    rows.append(expect('C4 adapt 写成 "true" → rc=2', rc, out, 2, has=['adapt 必须是 true 或 false']))

    # C5 路径不存在：要指出「按配置文件解析」，否则用户会去查 cwd
    write_cfg({'registry': 'nope.json'})
    rc, out = ap('auto')
    rows.append(expect('C5 路径不存在 → rc=2 且说明解析基准', rc, out, 2,
                       has=['不存在', 'liqi.json']))

    # C6 相对路径按配置目录：故意在别的 cwd 下跑
    write_cfg({'registry': 'asset-registry.json'})
    rc, out = ap('auto', cwd=ROOT)
    rows.append(expect('C6 换 cwd 仍能找到（按配置目录解析）', rc, out, None, has=['[config] --registry']))

    # C7 `--config auto` 找不到：明确报错，不静默降级
    empty_root = tempfile.mkdtemp(prefix='liqi_cfg_empty_')
    empty = os.path.join(empty_root, 'proj')  # v5.47.1：深一层，同上
    os.makedirs(empty)
    try:
        pkg2 = os.path.join(empty, '包.md')
        shutil.copyfile(pkg, pkg2)
        rc, out = run([P, os.path.join(HERE, 'audit_project.py'), pkg2,
                       '--no-log', '--config', 'auto'])
    finally:
        shutil.rmtree(empty_root, ignore_errors=True)
    rows.append(expect('C7 --config auto 无配置 → rc=2', rc, out, 2,
                       has=['E-CONFIG', 'auto']))

    # C8 配置生效
    write_cfg({'registry': 'asset-registry.json'})
    rc, out = ap('auto')
    rows.append(expect('C8 配置生效并逐条打印', rc, out, None, has=['[config] --registry =']))

    # C9 优先级：显式 CLI 不许被配置覆盖。
    # 用 --json 读 lock.model 而不是 grep 文本 —— 文本里「锁①=2.0」只在特定段才打，
    # 断言一个可能不出现的字符串，测的就不是优先级而是排版。顺带把「--json 里不能混
    # 人类可读行」也钉住（v5.37.5 修的就是这个：--json --auto 曾直接让 json.loads 抛异常）。
    write_cfg({'model': '2.5'})
    rc, jout, jerr = run2([P, os.path.join(HERE, 'audit_project.py'), pkg,
                           '--no-log', '--config', 'auto', '--model', '2.0', '--json'])
    try:
        lock = json.loads(jout).get('lock') or {}
    except ValueError:
        lock = {}
    ok9 = (lock.get('model') == '2.0') and ('跳过 --model' in jerr)
    rows.append(('C9 显式 --model 2.0 不被配置覆盖（且 --json 纯净）', ok9,
                 [] if ok9 else ['lock.model=%r（应 2.0），stderr 是否含「跳过 --model」=%s'
                                 % (lock.get('model'), '跳过 --model' in jerr)], ''))

    # C10 认识的键但本脚本不消费（surface 属于 audit_all）→ 静默跳过，不报错
    write_cfg({'surface': 'intl', 'registry': 'asset-registry.json'})
    rc, out = ap('auto')
    rows.append(expect('C10 surface 不属于 audit_project → 不报错', rc, out, None,
                       has=['[config] --registry'], absent=['E-CONFIG']))

    # C13 style_registry（v6.4.1）：项目自建风格的注册表路径——认识的键、相对路径按配置目录解析。
    # 断言只看配置层（键放行、不报未知键）：夹具包只有一镜，check_style 的门级结论不该由这里背锅。
    write_cfg({'style_registry': 'style-registry.json', 'model': '2.5', 'surface': 'cn'})
    rc, out = ap('auto')
    rows.append(expect('C13 style_registry 键放行且不报未知键', rc, out, None,
                       absent=['未知键', 'E-CONFIG']))

    # C11 audit_all 端到端：拿「有配置 vs 没配置」两次的「未查」做差。
    # 不写死「未查 ≤ N」——写死就变成记录当前状态的橡皮章（今天 6、明天加一道门变 7，
    # 测试红了却和配置无关）。差分的语义才是这条要锁的东西：**配置必须真的多查了几门。**
    #
    # 数据刻意放在 `项目资料/` 这种自动发现扫不到的子目录（_search_dirs 只认
    # 包目录 / 父目录 / assets / docs / data / script）。否则 --auto 本来就找得到，
    # 有没有配置都一样，差分恒为 0 —— 那测的就是「两件事都不出错」，不是配置的作用。
    d2_root = tempfile.mkdtemp(prefix='liqi_cfg_proj_')
    # v5.47.1：深一层——本夹具故意把输入藏进 项目资料/ 制造差分，父目录若直接是 %TEMP%，
    # 同名遗留文件会被 --auto 捞走，差分前提（off-run 必须有未查）整个被冲掉
    d2 = os.path.join(d2_root, 'proj')
    os.makedirs(d2)
    try:
        pkg2 = os.path.join(d2, '包.md')
        with open(pkg2, 'w', encoding='utf-8') as f:
            f.write(PKG)
        sub = os.path.join(d2, '项目资料')
        os.makedirs(sub)
        with open(os.path.join(sub, 'asset-registry.json'), 'w', encoding='utf-8') as f:
            json.dump({'characters': {}, 'props': {}}, f, ensure_ascii=False)
        with open(os.path.join(sub, '剧本.txt'), 'w', encoding='utf-8') as f:
            f.write('陈默：灯怎么又灭了。\n')
        with open(os.path.join(sub, 'beats.txt'), 'w', encoding='utf-8') as f:
            f.write('1｜灯灭｜0-4s｜钩子\n')
        with open(os.path.join(d2, 'liqi.json'), 'w', encoding='utf-8') as f:
            json.dump({'surface': 'cn',
                       'registry': '项目资料/asset-registry.json',
                       'script': '项目资料/剧本.txt',
                       'beats': '项目资料/beats.txt'}, f, ensure_ascii=False, indent=2)

        def audit_all(path, extra):
            rc, o = run([P, os.path.join(HERE, 'audit_all.py'), path] + extra)
            m = re.search(r'未查 (\d+)', o)
            return rc, o, (int(m.group(1)) if m else None)

        _rc, _o, skip_off = audit_all(pkg2, [])
        _rc, out_on, skip_on = audit_all(pkg2, ['--config', 'auto'])
    finally:
        shutil.rmtree(d2_root, ignore_errors=True)
    ok = ('surface=cn' in out_on) and ('[config] 生效' in out_on) \
        and skip_on is not None and skip_off is not None and skip_on < skip_off
    rows.append(('C11 audit_all 端到端（surface 生效，未查 %s → %s）' % (skip_off, skip_on), ok,
                 [] if ok else ['未查没有下降（%s → %s），或首行 surface / [config] 缺失'
                                % (skip_off, skip_on)], ''))

    # C12 `--json` 纯度（v5.37.5 修的真缺陷）：stdout 只能有那一段 JSON。
    # `--json --auto` 此前第 1 行就是 `[auto] --registry → …`，CI 侧 json.loads 直接抛
    # JSONDecodeError —— v5.37.1 加 --json 时说的是「供 CI / 看板消费」，那时就不成立。
    # 这里同时断言话术没被删掉（跑到 stderr 去了），避免「修脏」变成「修没」。
    rc, jout, jerr = run2([P, os.path.join(HERE, 'audit_project.py'), pkg,
                           '--no-log', '--auto', '--json'])
    try:
        json.loads(jout)
        pure = True
    except ValueError:
        pure = False
    ok12 = pure and ('[auto]' in jerr)
    rows.append(('C12 `--json --auto` stdout 只有 JSON（话术走 stderr）', ok12,
                 [] if ok12 else ['stdout 可解析=%s；stderr 含 [auto]=%s'
                                  % (pure, '[auto]' in jerr)], ''))

    shutil.rmtree(root, ignore_errors=True)

    passed = 0
    failed = []
    for name, ok, why, _note in rows:
        print('%s %s' % ('✅' if ok else '❌', name))
        if ok:
            passed += 1
        else:
            failed.append('%s：%s' % (name, '；'.join(why)))
    print('\n结果：%d 过 / %d 败' % (passed, len(failed)))
    for f in failed:
        print('  ✗ ' + f)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
