// 剧本校验：五阶门控、台词七维、语速排期、VO/OS、去AI味与尾钩。
// 只做能由 JSON 结构/文本判定的项；潜台词好坏、类型语感、三视角审稿明确留人工。

const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = v => typeof v === 'string' && v.trim().length > 0;
const norm = v => String(v == null ? '' : v).trim();
const countChars = s => Array.from(String(s == null ? '' : s)).filter(ch => /[\p{L}\p{N}]/u.test(ch)).length;

function pauses(s, vocab) {
  const t = String(s == null ? '' : s);
  const comma = (t.match(/[，,、；;：:]/g) || []).length;
  const end = (t.match(/[。！!？?…]/g) || []).length;
  return comma * vocab.pauses.comma + end * vocab.pauses.end;
}

function rateValue(v, vocab) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    if (typeof vocab.rates[v] === 'number') return vocab.rates[v];
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function findWords(text, list) {
  const t = String(text == null ? '' : text);
  return list.filter(w => t.includes(w));
}

export function validateScript(data, vocab) {
  const errors = [];
  const warns = [];
  const notes = [];
  const g = { 1: { err: false, warn: false }, 2: { err: false, warn: false }, 3: { err: false, warn: false }, 4: { err: false, warn: false }, 5: { err: false, warn: false } };
  const fail = (n, msg) => { g[n].err = true; errors.push(msg); };
  const warn = (n, msg) => { if (!g[n].err) g[n].warn = true; warns.push(msg); };

  // 自由文本统一扫：镜头语言 / 不可拍词 / slop。只报警，不改写。
  const checkProse = (text, label, gate) => {
    if (!isText(text)) return;
    const cam = findWords(text, vocab.cameraWords);
    if (cam.length) warn(gate, label + ' 出现镜头语言「' + cam[0] + '」：剧本页不写分镜，交给 liqi-lens');
    const unf = findWords(text, vocab.unfilmableWords);
    if (unf.length) warn(gate, label + ' 出现不可拍词「' + unf[0] + '」：改成可见动作/声音');
    const slop = findWords(text, vocab.slopWords);
    if (slop.length) warn(gate, label + ' 出现 slop 词 ' + slop.length + ' 个（' + slop.slice(0, 3).join(' / ') + '）');
  };

  if (!isPlain(data)) {
    return { errors: ['根节点必须是 JSON 对象'], warns, notes, gates: g, stats: null, scenes: [] };
  }

  if (!isText(data.title)) fail(5, '缺 title（剧本名）');

  // Gate 1 · Premise
  if (!isPlain(data.premise)) {
    fail(1, '缺 premise（30 字前提四要素）');
  } else {
    const p = data.premise;
    ['protagonist', 'desire', 'obstacle', 'cost'].forEach(k => {
      if (!isText(p[k])) fail(1, 'premise 缺 ' + k);
      else checkProse(p[k], 'premise.' + k, 1);
    });
    const total = ['protagonist', 'desire', 'obstacle', 'cost'].map(k => countChars(p[k])).reduce((a, b) => a + b, 0);
    if (total > vocab.premiseMaxChars) warn(1, 'premise 合计 ' + total + ' 字，超过 30 字前提公式');
  }
  if (!vocab.openingHooks.includes(norm(data.opening_hook))) {
    fail(1, 'opening_hook 非法：' + data.opening_hook + '（可选：' + vocab.openingHooks.join(' / ') + '）');
  }

  // Gate 2 · Structure
  if (data.acts === undefined) {
    warn(2, 'Gate 2 未声明三幕比例（完整剧本建议写 30% / 50% / 20%）');
  } else if (!Array.isArray(data.acts) || data.acts.length !== 3) {
    fail(2, 'acts 必须是 3 项（铺垫 / 冲突 / 转折）');
  } else {
    const percents = [];
    data.acts.forEach((a, i) => {
      if (!isPlain(a) || !isText(a.name) || !Number.isFinite(Number(a.percent))) {
        fail(2, 'acts 第 ' + (i + 1) + ' 项必须是 {name, percent}');
      } else {
        percents.push(Number(a.percent));
      }
    });
    if (percents.length === 3) {
      const sum = percents.reduce((a, b) => a + b, 0);
      if (sum !== 100) fail(2, 'acts 合计 ' + sum + '%，必须 100%');
      else if (percents.join('/') !== vocab.gate2Ratio.join('/')) {
        warn(2, 'acts 比例 ' + percents.join(' / ') + '，主包口径是 ' + vocab.gate2Ratio.join(' / '));
      }
    }
  }

  // Gate 4 · Entity bounds
  const charSet = new Set();
  if (!Array.isArray(data.characters) || !data.characters.length) {
    fail(4, 'characters 必须是非空数组');
  } else {
    data.characters.forEach((c, i) => {
      if (!isText(c)) { fail(4, 'characters 第 ' + (i + 1) + ' 项不是非空字符串'); return; }
      if (charSet.has(norm(c))) fail(4, 'characters 重名：' + c);
      charSet.add(norm(c));
    });
  }

  // Optional: tail hook / chips
  if (data.tail_hook !== undefined) {
    if (!isPlain(data.tail_hook)) fail(5, 'tail_hook 必须是对象');
    else {
      const th = data.tail_hook;
      if (!vocab.tailHooks.includes(norm(th.type))) fail(5, 'tail_hook.type 非法：' + th.type + '（可选：' + vocab.tailHooks.join(' / ') + '）');
      if (!isText(th.content)) fail(5, 'tail_hook.content 不能为空');
      if (!isText(th.recall)) warn(5, 'tail_hook.recall 为空：下集前 30 秒必须回收');
      else if (!/E\s*\d+/i.test(th.recall)) warn(5, 'tail_hook.recall 不含集号（建议写成 E2 0:08 …）');
    }
  } else if (isText(data.episode)) {
    notes.push('未声明 tail_hook：单集可忽略；多集项目每集必须有尾钩');
  }
  if (data.chips !== undefined) {
    if (!Array.isArray(data.chips) || !data.chips.length) warn(5, 'chips 为空：每集至少一类筹码变化');
    else data.chips.forEach((c, i) => {
      if (!isPlain(c) || !vocab.chipTypes.includes(norm(c.type))) fail(5, 'chips 第 ' + (i + 1) + ' 项 type 非法：' + (c && c.type));
      else if (!isText(c.content)) warn(5, 'chips 第 ' + (i + 1) + ' 项 content 为空');
    });
  } else if (isText(data.episode)) {
    notes.push('未登记 chips：多集项目建议每集写筹码变化（信息/关系/资源/力量）');
  }

  const scenes = data.scenes;
  if (!Array.isArray(scenes) || !scenes.length) {
    fail(3, 'scenes 必须是非空数组');
    return { errors, warns, notes, gates: g, stats: null, scenes: [] };
  }

  const sceneIds = new Set();
  const lineIds = new Set();
  const outScenes = [];
  let totalChars = 0;
  let totalSpeech = 0;
  let totalLineSeconds = 0;
  let totalBudget = 0;
  let totalPlotPoints = 0;
  let totalLines = 0;
  let voLines = 0;
  let voChars = 0;
  let longLines = 0;
  let fastLines = 0;

  scenes.forEach((s, si) => {
    const n = si + 1;
    if (!isPlain(s)) { fail(5, '场景第 ' + n + ' 项必须是对象'); return; }
    const sid = isText(s.id) ? norm(s.id) : '#' + n;
    if (!isText(s.id)) fail(5, '场景第 ' + n + ' 项缺 id');
    else if (sceneIds.has(sid)) fail(5, '场景 id 重复：' + sid);
    sceneIds.add(sid);

    if (!isText(s.interior_exterior) || !['内景', '外景'].includes(norm(s.interior_exterior))) {
      fail(5, '场景 ' + sid + ' 的 interior_exterior 必须是 内景 / 外景：' + s.interior_exterior);
    }
    if (!isText(s.location)) fail(5, '场景 ' + sid + ' 缺 location');
    else checkProse(s.location, '场景 ' + sid + ' 的 location', 5);
    if (!isText(s.time)) fail(5, '场景 ' + sid + ' 缺 time');
    else checkProse(s.time, '场景 ' + sid + ' 的 time', 5);
    if (!isText(s.description)) fail(5, '场景 ' + sid + ' 缺 description（动作/环境描述）');

    if (!Array.isArray(s.characters) || !s.characters.length) {
      fail(4, '场景 ' + sid + ' 的 characters 必须是非空数组');
    } else {
      s.characters.forEach(c => {
        if (!isText(c) || !charSet.has(norm(c))) fail(4, '场景 ' + sid + ' 的角色「' + c + '」不在 characters 里');
      });
    }

    const beatTexts = {};
    vocab.beats.forEach(k => {
      if (!isText(s[k])) fail(3, '场景 ' + sid + ' 缺 ' + k);
      else {
        beatTexts[k] = norm(s[k]);
        checkProse(s[k], '场景 ' + sid + ' 的 ' + k, 3);
      }
    });
    if (beatTexts.goal && beatTexts.result && beatTexts.goal === beatTexts.result) {
      warn(3, '场景 ' + sid + ' 的 goal 与 result 相同，可能没有推进');
    }

    const dur = Number(s.duration);
    if (!Number.isFinite(dur) || dur <= 0 || dur > 300) fail(5, '场景 ' + sid + ' 的 duration 必须是 1–300 秒：' + s.duration);
    else totalBudget += dur;
    let actionTime = 0;
    if (s.action_time !== undefined) {
      actionTime = Number(s.action_time);
      if (!Number.isFinite(actionTime) || actionTime < 0 || actionTime > 300) fail(5, '场景 ' + sid + ' 的 action_time 必须是 0–300 秒');
    }

    if (!Array.isArray(s.plot_points) || !s.plot_points.length) {
      warn(3, '场景 ' + sid + ' 没有情节点标注（未标注 ≠ 通过）');
    } else {
      const pp = s.plot_points.filter(isText).length;
      totalPlotPoints += pp;
      s.plot_points.filter(isText).forEach((p, pi) => checkProse(p, '场景 ' + sid + ' 的情节点 ' + (pi + 1), 3));
      const min = Number.isFinite(dur) ? Math.floor(dur / 15) * vocab.plotPer15s : 0;
      if (pp < min) warn(3, '场景 ' + sid + ' 的 15s 段应 ≥' + min + ' 个情节点（当前 ' + pp + '）');
    }

    // 剧本页/动作描述：不写镜头，不写不可拍心理，不堆 slop
    checkProse(s.description, '场景 ' + sid + ' 描述', 5);

    const lines = Array.isArray(s.lines) ? s.lines : [];
    if (!Array.isArray(s.lines)) fail(5, '场景 ' + sid + ' 的 lines 必须是数组');
    let sceneLineSeconds = 0;
    let sceneVoChars = 0;
    let sceneVoLines = 0;
    const outLines = [];

    lines.forEach((l, li) => {
      const ln = li + 1;
      if (!isPlain(l)) { fail(3, '台词第 ' + ln + ' 项必须是对象'); return; }
      const lid = isText(l.id) ? norm(l.id) : sid + '-L' + ln;
      if (!isText(l.id)) warn(3, '台词第 ' + ln + ' 项缺 id');
      else if (lineIds.has(lid)) fail(3, '台词 id 重复：' + lid);
      lineIds.add(lid);
      totalLines++;

      const speaker = norm(l.speaker);
      if (!isText(speaker)) fail(4, '台词 ' + lid + ' 缺 speaker');
      else if (!charSet.has(speaker) && speaker !== '旁白') fail(4, '台词 ' + lid + ' 的 speaker「' + speaker + '」不在 characters 里');

      if (!isText(l.text)) fail(3, '台词 ' + lid + ' 的 text 不能为空');

      const type = l.type === undefined ? '对白' : norm(l.type);
      if (!vocab.voiceTypes.includes(type)) fail(5, '台词 ' + lid + ' 的 type 非法：' + l.type);
      if (speaker === '旁白' && type === '对白') fail(5, '台词 ' + lid + ' 的 speaker 是旁白，但 type 是对白；旁白只能用于 VO/OS');

      const rv = l.rate === undefined ? vocab.rates.normal : rateValue(l.rate, vocab);
      if (rv === null) fail(3, '台词 ' + lid + ' 的 rate 非法：' + l.rate + '（slow/normal/fast 或 1–6.5 的数字）');
      else if (rv > vocab.rates.hardMax) fail(3, '台词 ' + lid + ' 的 rate ' + rv + ' 超过物理硬闸 ' + vocab.rates.hardMax + ' 字/秒');
      else if (rv > vocab.rates.fast) warn(3, '台词 ' + lid + ' 是快速档（' + rv + ' 字/秒）：连续 >5 字/秒不得超过 3 秒');
      else if (rv < vocab.rates.comfort[0]) warn(3, '台词 ' + lid + ' 的 rate ' + rv + ' 低于舒适下限 ' + vocab.rates.comfort[0]);

      const funcs = Array.isArray(l.functions) ? l.functions.map(norm) : [];
      if (!funcs.length) warn(3, '台词 ' + lid + ' 未做七维标注（functions）');
      else {
        funcs.forEach(f => { if (!vocab.functions.includes(f)) fail(3, '台词 ' + lid + ' 的 functions 非法：' + f); });
        if (funcs.length > 3) warn(3, '台词 ' + lid + ' 承担 ' + funcs.length + ' 个功能，可能过载');
      }
      if (funcs.includes('潜台词层级') && !isText(l.subtext)) {
        fail(3, '台词 ' + lid + ' 标注了「潜台词层级」但没有 subtext');
      }

      const text = String(l.text == null ? '' : l.text);
      const chars = countChars(text);
      totalChars += chars;
      if (chars > vocab.lineErrorChars) { fail(3, '台词 ' + lid + ' 超过 ' + vocab.lineErrorChars + ' 字（当前 ' + chars + '），必须拆镜'); longLines++; }
      else if (chars > vocab.lineWarnChars) { warn(3, '台词 ' + lid + ' 超过 ' + vocab.lineWarnChars + ' 字（当前 ' + chars + '），建议拆镜'); longLines++; }

      const pauseAfter = l.pause_after === undefined ? 0 : Number(l.pause_after);
      if (!Number.isFinite(pauseAfter) || pauseAfter < 0 || pauseAfter > 10) fail(3, '台词 ' + lid + ' 的 pause_after 必须是 0–10 秒');
      const speech = rv ? chars / rv : 0;
      const seconds = speech + pauses(text, vocab) + (Number.isFinite(pauseAfter) ? pauseAfter : 0);
      totalSpeech += speech;
      totalLineSeconds += seconds;
      sceneLineSeconds += seconds;
      if (rv && rv > vocab.rates.fast && seconds > 3) warn(3, '台词 ' + lid + ' 快速档持续 ' + seconds.toFixed(1) + 's，超过 3 秒上限');
      if (rv && rv > vocab.rates.fast) fastLines++;

      if (type === 'VO' || type === 'OS') {
        sceneVoChars += chars;
        sceneVoLines++;
        voChars += chars;
        voLines++;
        if (l.lipsync === true) fail(5, '台词 ' + lid + ' 是 ' + type + '，但 lipsync=true（画外声不锁口型）');
      } else if (l.lipsync === false) {
        warn(5, '台词 ' + lid + ' 是对白，但 lipsync=false（对白要锁口型）');
      }

      const action = isText(l.action) ? l.action : '';
      if (action) checkProse(action, '台词 ' + lid + ' 的 action', 5);
      const ts = findWords(text, vocab.slopWords);
      if (ts.length) warn(3, '台词 ' + lid + ' 含 AI 腔词 ' + ts.length + ' 个（' + ts.slice(0, 2).join(' / ') + '）');

      outLines.push({
        id: lid, speaker, type, text, chars, rate: rv, seconds,
        functions: funcs, subtext: norm(l.subtext), action, pauseAfter
      });
    });

    if (Number.isFinite(dur)) {
      const sceneTotal = sceneLineSeconds + actionTime;
      if (sceneTotal > dur) fail(5, '场景 ' + sid + ' 台词+动作 ' + sceneTotal.toFixed(1) + 's，超过预算 ' + dur + 's');
      else if (dur >= 10 && dur - sceneTotal > dur * 0.5) warn(5, '场景 ' + sid + ' 台词+动作只占 ' + sceneTotal.toFixed(1) + '/' + dur + 's，余量过大，确认是否空镜');
      if (sceneVoChars > 0) {
        const perMin = sceneVoChars / (dur / 60);
        if (perMin > vocab.voCharsPerMinMax) warn(5, '场景 ' + sid + ' VO 口播 ' + Math.round(perMin) + ' 字/分钟，超过 ' + vocab.voCharsPerMinMax);
      }
      if (lines.length && sceneVoLines / lines.length > vocab.voShareMax) {
        warn(5, '场景 ' + sid + ' VO/OS 行占比 ' + Math.round(sceneVoLines / lines.length * 100) + '%，超过 ' + Math.round(vocab.voShareMax * 100) + '%（行占比；主包按镜数，分镜层复核）');
      }
    }

    outScenes.push({
      id: sid, interior_exterior: norm(s.interior_exterior), location: norm(s.location), time: norm(s.time),
      characters: Array.isArray(s.characters) ? s.characters.map(norm) : [],
      goal: norm(s.goal), obstacle: norm(s.obstacle), escalation: norm(s.escalation),
      turn: norm(s.turn), result: norm(s.result),
      duration: Number.isFinite(dur) ? dur : null, action_time: actionTime,
      plot_points: Array.isArray(s.plot_points) ? s.plot_points.filter(isText).map(norm) : [],
      description: norm(s.description), lines: outLines,
      line_seconds: sceneLineSeconds, total_seconds: sceneLineSeconds + actionTime
    });
  });

  if (totalPlotPoints === 0) notes.push('全剧没有情节点标注，无法核对（未标注 ≠ 通过）');
  else if (totalPlotPoints < vocab.plotPointsMin) warn(3, '全剧情节点 ' + totalPlotPoints + ' 个，少于 ' + vocab.plotPointsMin);

  const avgRate = totalSpeech > 0 ? totalChars / totalSpeech : null;
  if (avgRate !== null && avgRate > vocab.rates.planningCap) {
    warn(3, '全剧口播均值 ' + avgRate.toFixed(2) + ' 字/秒，超过实测排期上限 ' + vocab.rates.planningCap);
  }

  const gates = {};
  Object.keys(g).forEach(k => { gates[k] = g[k].err ? 'error' : g[k].warn ? 'warn' : 'ok'; });

  return {
    errors, warns, notes, gates,
    stats: {
      scenes: outScenes.length, lines: totalLines, chars: totalChars,
      speechSeconds: totalSpeech, lineSeconds: totalLineSeconds,
      budget: totalBudget, plotPoints: totalPlotPoints,
      voLines, voChars, longLines, fastLines, avgRate
    },
    scenes: outScenes
  };
}