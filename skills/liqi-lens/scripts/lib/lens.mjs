// 镜头表校验与统计：逐镜字段 + 轴线 + 11 项配额的机检部分。
// 只做能由数据确定判断的项；语义项（Q2、表演装不装得下）明确标注「需人工」。

const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = v => typeof v === 'string' && v.trim().length > 0;
const norm = v => String(v == null ? '' : v).trim();
const low = v => norm(v).toLowerCase();

export function validateShotList(data, vocab) {
  const errors = [];
  const warns = [];
  const notes = [];

  if (!isPlain(data)) {
    return { errors: ['根节点必须是 JSON 对象'], warns, notes, stats: null, rows: [] };
  }
  const shots = Array.isArray(data.shots) ? data.shots : null;
  if (!shots || !shots.length) {
    return { errors: ['shots 必须是非空数组'], warns, notes, stats: null, rows: [] };
  }

  const sizeMap = new Map(vocab.shotSizes.map(s => [s.name, s]));
  const fovMap = new Map(vocab.fov.map(f => [Number(f.deg), f]));
  const angles = new Set(vocab.angles);
  const moves = new Set(vocab.moves);
  const lights = new Set(vocab.lightDirections);
  const tasks = new Set(vocab.tasks);
  const axisSides = new Set(vocab.axisSides);
  const transitions = new Set(vocab.transitions);
  const compositions = new Set(vocab.compositions);
  const techniques = new Set(vocab.heavyTechniques);
  const heavyMax = vocab.quota.heavyMax || {};
  const ids = new Set();
  const rows = [];

  shots.forEach((s, i) => {
    const n = i + 1;
    if (!isPlain(s)) {
      errors.push('镜头第 ' + n + ' 项必须是对象');
      rows.push(null);
      return;
    }
    const id = isText(s.id) ? norm(s.id) : '#' + n;
    if (!isText(s.id)) errors.push('镜头 ' + id + ' 缺 id');
    else if (ids.has(id)) errors.push('镜头 id 重复：' + id);
    ids.add(id);

    ['scene', 'segment', 'subject', 'action', 'visual'].forEach(k => {
      if (!isText(s[k])) errors.push('镜头 ' + id + ' 缺 ' + k);
    });

    const size = isText(s.shot_size) ? sizeMap.get(norm(s.shot_size)) : null;
    if (!size) errors.push('镜头 ' + id + ' 的 shot_size 不在 9 档里：' + (s.shot_size === undefined ? '(缺)' : s.shot_size));

    if (!angles.has(norm(s.angle))) errors.push('镜头 ' + id + ' 的 angle 不在角度表里：' + s.angle);

    const deg = Number(s.fov_deg);
    const fov = fovMap.get(deg);
    if (!fov) errors.push('镜头 ' + id + ' 的 fov_deg 不在 ' + [...fovMap.keys()].join(' / ') + ' 里：' + s.fov_deg);
    if (isText(s.perspective) && fov && norm(s.perspective) !== fov.perspective) {
      errors.push('镜头 ' + id + ' 的 perspective 与 fov_deg 不一致：' + s.perspective + ' vs ' + fov.perspective);
    }

    if (!moves.has(norm(s.move))) errors.push('镜头 ' + id + ' 的 move 不在 7 词表里：' + s.move);

    const dur = Number(s.duration);
    if (!Number.isFinite(dur) || dur < 2 || dur > 15) {
      errors.push('镜头 ' + id + ' 的 duration 必须在 2–15 秒：' + s.duration);
    }

    if (!lights.has(norm(s.light))) errors.push('镜头 ' + id + ' 的 light 不在光位表里：' + s.light);
    if (!isText(s.light_source)) errors.push('镜头 ' + id + ' 缺 light_source（物理光源）');
    if (isText(s.light_ratio)) {
      if (!/^1:\d+$/.test(norm(s.light_ratio))) errors.push('镜头 ' + id + ' 的 light_ratio 要写成 1:4 这种格式：' + s.light_ratio);
    } else {
      warns.push('镜头 ' + id + ' 没写 light_ratio（光比）');
    }

    const people = Number(s.people);
    if (!Number.isInteger(people) || people < 1) errors.push('镜头 ' + id + ' 的 people 必须是 ≥1 的整数：' + s.people);

    if (!tasks.has(norm(s.task))) errors.push('镜头 ' + id + ' 的 task 必须是三任务之一：' + (s.task === undefined ? '(缺)' : s.task));

    if (s.subject_type !== undefined && !['人物', '物件'].includes(norm(s.subject_type))) {
      errors.push('镜头 ' + id + ' 的 subject_type 只能是 人物 / 物件：' + s.subject_type);
    }
    if (isText(s.composition) && !compositions.has(norm(s.composition))) {
      errors.push('镜头 ' + id + ' 的 composition 不在四件套里：' + s.composition);
    }
    if (isText(s.technique) && !techniques.has(norm(s.technique))) {
      errors.push('镜头 ' + id + ' 的 technique 不在重技法表里：' + s.technique);
    }

    if (people >= 2) {
      if (!isText(s.axis)) errors.push('镜头 ' + id + ' 多人镜缺轴线声明');
      else if (!s.axis.includes('左') || !s.axis.includes('右')) {
        errors.push('镜头 ' + id + ' 的轴线声明必须写清谁在左、谁在右');
      }
      if (!axisSides.has(norm(s.axis_side))) errors.push('镜头 ' + id + ' 多人镜缺 axis_side（左 / 右 / 轴上）');
    }
    if (isText(s.cross_axis) && !transitions.has(norm(s.cross_axis))) {
      errors.push('镜头 ' + id + ' 的 cross_axis 必须是四种合法过渡之一：' + s.cross_axis);
    }
    if (s.jump_declared !== undefined && typeof s.jump_declared !== 'boolean') {
      errors.push('镜头 ' + id + ' 的 jump_declared 只能是 true / false');
    }
    if (s.reverse !== undefined && typeof s.reverse !== 'boolean') {
      errors.push('镜头 ' + id + ' 的 reverse 只能是 true / false');
    }

    const hay = [s.scene, s.segment, s.subject, s.action, s.visual, s.move, s.prompt_en,
      s.axis, s.light_source, s.task, s.composition, s.technique].filter(isText).join(' ');
    vocab.bannedNamedMoves.forEach(t => {
      if (hay.includes(t)) errors.push('镜头 ' + id + ' 出现具名复合镜头「' + t + '」：用原语拼');
    });
    vocab.bannedGenericWords.forEach(t => {
      if (low(hay).includes(low(t))) errors.push('镜头 ' + id + ' 出现抽象词「' + t + '」：先做反形容词转译');
    });

    rows.push({
      raw: s,
      index: i,
      id,
      scene: norm(s.scene),
      segment: norm(s.segment),
      people,
      level: size ? size.level : null,
      size: size || null,
      fov: fov || null,
      perspective: fov ? fov.perspective : null,
      move: norm(s.move),
      angle: norm(s.angle),
      subject_type: norm(s.subject_type || '人物'),
      duration: Number.isFinite(dur) ? dur : null
    });
  });

  const valid = rows.filter(Boolean);

  // 跨镜：同场景的「上一个多人镜」跨轴必须有过渡；单人镜不建立/不改变轴线
  const lastMulti = new Map();
  valid.forEach(r => {
    if (r.people < 2) return;
    const prev = lastMulti.get(r.scene);
    if (prev) {
      const a = norm(prev.raw.axis_side);
      const b = norm(r.raw.axis_side);
      // 「轴上」是中性态：它本身切断左右连续性，前后任一侧都合法
      if (a && b && a !== '轴上' && b !== '轴上' && a !== b) {
        if (!isText(r.raw.cross_axis)) {
          errors.push('镜头 ' + r.id + ' 与上一多人镜 ' + prev.id + ' 跨轴，但没写 cross_axis（中性镜 / 运动镜 / 插入特写 / 重新建轴）');
        }
      } else if (a && b && a === b && isText(r.raw.cross_axis)) {
        warns.push('镜头 ' + r.id + ' 声明了 cross_axis，但 axis_side 与上一多人镜相同');
      }
    }
    lastMulti.set(r.scene, r);
  });

  // Q10：连续第 3 镜同运镜（固定不计入连续链）
  let runMove = null;
  let run = 0;
  valid.forEach(r => {
    if (!r.move) return;
    if (r.move === '固定') { runMove = null; run = 0; return; }
    if (r.move === runMove) run++;
    else { runMove = r.move; run = 1; }
    if (run === 3) errors.push('连续第 3 镜同运镜「' + r.move + '」（镜头 ' + r.id + '）；固定机位不计入连续链');
  });

  // Q7 / Q5 / Q6 / Q11
  const countAngle = name => valid.filter(r => r.angle === name).length;
  const dutch = countAngle('荷兰角');
  if (dutch > vocab.quota.dutchMax) errors.push('荷兰角 ' + dutch + ' 次，超过 ' + vocab.quota.dutchMax + ' 次上限');
  const bigLow = countAngle('大仰角');
  const bigHigh = countAngle('大俯角');
  if (bigLow > vocab.quota.bigLowMax) warns.push('大仰角 ' + bigLow + ' 次，超过 ' + vocab.quota.bigLowMax + ' 次');
  if (bigHigh > vocab.quota.bigHighMax) warns.push('大俯角 ' + bigHigh + ' 次，超过 ' + vocab.quota.bigHighMax + ' 次');

  const techCount = {};
  valid.forEach(r => {
    const t = norm(r.raw.technique);
    if (t) techCount[t] = (techCount[t] || 0) + 1;
  });
  Object.entries(techCount).forEach(([t, c]) => {
    const max = heavyMax[t];
    if (max !== undefined && c > max) errors.push('重技法「' + t + '」' + c + ' 次，超过上限 ' + max);
  });

  // Q1 / Q3 / Q4：占比类，镜数不足时明确「未查」
  const total = valid.length;
  let closeShare = null;
  let side45Share = null;
  let sideShare = null;
  if (total >= vocab.quota.minShotsForRatio) {
    const close = valid.filter(r => r.level >= 8 && r.subject_type !== '物件').length;
    closeShare = close / total;
    if (closeShare < vocab.quota.closeUpShare[0] || closeShare > vocab.quota.closeUpShare[1]) {
      warns.push('Q1 人物特写占比 ' + Math.round(closeShare * 100) + '%，越出 25%~40%');
    }
    const side45 = valid.filter(r => r.angle === '侧 45°').length;
    side45Share = side45 / total;
    if (side45Share < vocab.quota.side45Share[0] || side45Share > vocab.quota.side45Share[1]) {
      warns.push('Q3 侧 45° 机位占比 ' + Math.round(side45Share * 100) + '%，越出 30%~40%');
    }
    const side = valid.filter(r => r.angle === '侧面').length;
    sideShare = side / total;
    if (sideShare > vocab.quota.sideShareMax) warns.push('Q4 侧面机位占比 ' + Math.round(sideShare * 100) + '%，超过 15%');
  } else {
    notes.push('Q1/Q3/Q4 本门未查（镜数 ' + total + ' < ' + vocab.quota.minShotsForRatio + '），未查 ≠ 通过');
  }

  // Q8 / Q9
  const fovKinds = new Set(valid.filter(r => r.fov).map(r => r.fov.deg)).size;
  const moveKinds = new Set(valid.filter(r => vocab.moves.includes(r.move)).map(r => r.move)).size;
  if (total >= vocab.quota.minShotsForFov) {
    if (fovKinds < vocab.quota.fovKindsMin) warns.push('Q8 全片焦段种数 ' + fovKinds + '，少于 ' + vocab.quota.fovKindsMin);
  } else {
    notes.push('Q8 本门未查（镜数 ' + total + ' < ' + vocab.quota.minShotsForFov + '），未查 ≠ 通过');
  }
  if (total >= vocab.quota.minShotsForMove) {
    if (moveKinds < vocab.quota.moveKindsMin) warns.push('Q9 全片运镜种数 ' + moveKinds + '，少于 ' + vocab.quota.moveKindsMin);
  } else {
    notes.push('Q9 本门未查（镜数 ' + total + ' < ' + vocab.quota.minShotsForMove + '），未查 ≠ 通过');
  }
  notes.push('Q2 常规机位占比：需人工（数据模型未区分正面 / 过肩，不硬算）');

  // C1：每段至少 1 大景别 + 1 特写 + 1 中景
  const segs = new Map();
  valid.forEach(r => {
    if (!segs.has(r.segment)) segs.set(r.segment, []);
    segs.get(r.segment).push(r);
  });
  segs.forEach((list, seg) => {
    const levels = list.map(r => r.level).filter(n => n !== null);
    const miss = [];
    if (!levels.some(l => l >= 1 && l <= 3)) miss.push('大景别（1–3）');
    if (!levels.some(l => l >= 8)) miss.push('特写（8–9）');
    if (!levels.includes(5)) miss.push('中景（5）');
    if (miss.length) warns.push('C1 段「' + seg + '」缺 ' + miss.join(' / '));
  });

  // S21：相邻景别差 ≥3，声明即豁免（本包用 per-shot jump_declared 简化段级声明）
  for (let i = 1; i < valid.length; i++) {
    const a = valid[i - 1];
    const b = valid[i];
    if (a.segment !== b.segment) continue;
    if (a.level === null || b.level === null) continue;
    const delta = Math.abs(a.level - b.level);
    if (delta >= vocab.quota.jumpWarnDelta && b.raw.jump_declared !== true) {
      warns.push('S21 相邻景别差 ' + delta + ' 档（' + a.id + '→' + b.id + '）：补过渡素材，或声明 jump_declared=true');
    }
  }

  // S22：统计失效元检查
  const missingStats = valid.filter(r => r.level === null || r.duration === null);
  if (valid.length && missingStats.length === valid.length) {
    errors.push('S22 统计失效：所有镜头都缺景别或时长，本门没有真正查过，不算通过');
  } else if (missingStats.length) {
    notes.push('S22 有 ' + missingStats.length + ' 镜缺景别/时长，已计入分母、不计入分子');
  }

  const stats = {
    total,
    segments: segs.size,
    closeShare,
    side45Share,
    sideShare,
    fovKinds,
    moveKinds,
    dutch,
    bigLow,
    bigHigh,
    techCount
  };

  return { errors, warns, notes, stats, rows: valid };
}

export function pct(v) {
  return v === null || v === undefined ? '—' : Math.round(v * 100) + '%';
}