// 角色设定的校验规则（cast_sheet 与 check_cast 共用，避免两套判定）。
// 所有类型异常都转成中文 ERROR，不向用户抛 TypeError。
export const FACE = ['bone', 'brow', 'eye', 'pupil', 'nose', 'lip', 'jaw', 'ear', 'mark', 'skin'];
export const FACE_REQUIRED = FACE.filter(k => k !== 'mark'); // 第 9 项「标志特征」可写「无」
export const WARDROBE = ['fabric', 'texture', 'drape', 'wear', 'metal', 'seam'];
export const VERDICTS = ['reuse', 'new_variant', 'new_asset', 'unresolved'];

const HEX = /^#[0-9a-fA-F]{6}$/;
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = v => typeof v === 'string' && v.trim().length > 0;
const norm = v => String(v).trim().toLowerCase();

export function validate(cast) {
  const errors = [];
  const warns = [];

  if (!isPlainObject(cast)) {
    const what = Array.isArray(cast) ? '数组' : cast === null ? 'null' : typeof cast;
    return { errors: ['根节点必须是 JSON 对象（当前是 ' + what + '）'], warns };
  }

  if (!isText(cast.name)) errors.push('缺 name（角色名）');
  if (!['男', '女', 'male', 'female'].includes(cast.gender)) {
    errors.push('gender 必须是 男/女（性别锚点必写，否则模型会自行推断）');
  }
  if (!isText(cast.age_range) || !/^\d+\s*[~-]\s*\d+$/.test(cast.age_range)) {
    errors.push('age_range 要写成 "24~26" 这种区间');
  }

  const height = cast.height_cm;
  if (height === undefined || height === null || height === '') {
    errors.push('缺 height_cm（身高线数值，50–250 的整数，例如 168）');
  } else if (!Number.isInteger(Number(height)) || Number(height) < 50 || Number(height) > 250) {
    errors.push('height_cm 必须是 50–250 的整数：' + height);
  }

  if (!isPlainObject(cast.face)) {
    errors.push('face 必须是对象（五官 10 项）');
  } else {
    FACE_REQUIRED.forEach(k => {
      if (!isText(cast.face[k])) errors.push('五官缺 ' + k + '（第 ' + (FACE.indexOf(k) + 1) + ' 项）');
    });
    const mark = cast.face.mark;
    if (mark === undefined || mark === null || mark === '') {
      warns.push('mark 未声明（第 9 项；无标志特征请写「无」）');
    } else if (typeof mark !== 'string') {
      errors.push('face.mark 必须是字符串（无标志特征写「无」）');
    }
  }

  if (!isPlainObject(cast.wardrobe)) {
    errors.push('wardrobe 必须是对象（服装 6 项）');
  } else {
    WARDROBE.forEach((k, i) => {
      if (!isText(cast.wardrobe[k])) errors.push('服装缺 ' + k + '（第 ' + (i + 11) + ' 项）');
    });
  }

  ['face_en', 'wardrobe_en'].forEach(k => {
    if (cast[k] !== undefined && !isPlainObject(cast[k])) warns.push(k + ' 不是对象，已忽略');
  });

  if (!Array.isArray(cast.palette)) {
    errors.push('palette 必须是数组（至少 3 项）');
  } else {
    if (cast.palette.length < 3) errors.push('色板至少 3 个色值（当前 ' + cast.palette.length + '）');
    cast.palette.forEach((c, i) => {
      const n = i + 1;
      if (typeof c === 'string') {
        if (!HEX.test(c)) errors.push('色值 ' + n + ' 不是 #RRGGBB：' + c);
        else warns.push('色板第 ' + n + ' 项缺中文色名（卡面只标 HEX，建议写成 {"name":"青灰","hex":"#3A4E48"}）');
        return;
      }
      if (!isPlainObject(c)) {
        errors.push('色板第 ' + n + ' 项必须是 {"name","hex"} 对象或 #RRGGBB 字符串');
        return;
      }
      if (!isText(c.name)) warns.push('色板第 ' + n + ' 项缺中文色名（卡面只标 HEX）');
      if (!HEX.test(String(c.hex))) errors.push('色板第 ' + n + ' 项 hex 不是 #RRGGBB：' + c.hex);
      if (c.part !== undefined && typeof c.part !== 'string') errors.push('色板第 ' + n + ' 项 part 必须是字符串');
    });
  }

  if (cast.audio_label !== undefined) {
    if (!isText(cast.audio_label)) {
      errors.push('audio_label 必须是非空字符串（英文 ≤8 词）');
    } else {
      const words = cast.audio_label.trim().split(/\s+/);
      if (words.length > 8) errors.push('audio_label 超过 8 词（当前 ' + words.length + ' 词）');
      if (/[\u4e00-\u9fff]/.test(cast.audio_label)) {
        warns.push('audio_label 含中文；主包口径是英文速览标签（≤8 词）');
      }
    }
  }

  if (cast.versions !== undefined && !Array.isArray(cast.versions)) {
    errors.push('versions 必须是数组');
  } else if (!Array.isArray(cast.versions) || !cast.versions.length) {
    warns.push('没有 versions：单版可忽略，跨集项目建议至少声明一版');
  } else {
    const seen = new Set();
    cast.versions.forEach((v, i) => {
      const n = i + 1;
      if (!isPlainObject(v)) {
        errors.push('版本第 ' + n + ' 项必须是对象');
        return;
      }
      const name = isText(v.name) ? v.name.trim() : '';
      if (!name) errors.push('版本第 ' + n + ' 项缺 name');
      if (name && seen.has(name)) errors.push('版本重名：' + name + '（不许同名两版）');
      if (name) seen.add(name);

      if (!VERDICTS.includes(v.verdict)) {
        errors.push('版本 ' + (name || n) + ' 的 verdict 缺失或非法：' + v.verdict);
      }
      if (v.verdict === 'unresolved') warns.push('版本 ' + (name || n) + ' 是 unresolved：禁止出图，先补证据');
      if (v.diff !== undefined && typeof v.diff !== 'string') {
        errors.push('版本 ' + (name || n) + ' 的 diff 必须是字符串');
      }

      if (!Array.isArray(v.interlock) || !v.interlock.length) {
        errors.push('版本 ' + (name || n) + ' 缺互锁词（interlock 至少 1 项：本版不该出现的特征）');
      } else {
        v.interlock.forEach((t, j) => {
          if (!isText(t)) errors.push('版本 ' + (name || n) + ' 的互锁词第 ' + (j + 1) + ' 项为空');
        });
        const self = norm(name + ' ' + (typeof v.diff === 'string' ? v.diff : ''));
        v.interlock.forEach(t => {
          if (isText(t) && t.trim().length >= 2 && self.includes(norm(t))) {
            errors.push('版本 ' + (name || n) + ' 的互锁词「' + t.trim() + '」出现在本版 name/diff 里（自我矛盾）');
          }
        });
      }

      if (v.interlock_en !== undefined) {
        if (!Array.isArray(v.interlock_en) || !v.interlock_en.length || v.interlock_en.some(t => !isText(t))) {
          errors.push('版本 ' + (name || n) + ' 的 interlock_en 必须是非空字符串数组');
        }
      }
    });

    // 两版互锁词完全雷同 = 没有体现版本差异；一版被另一版完全覆盖 = 至少一版偷懒。
    for (let i = 0; i < cast.versions.length; i++) {
      for (let j = i + 1; j < cast.versions.length; j++) {
        const a = cast.versions[i];
        const b = cast.versions[j];
        if (!isPlainObject(a) || !isPlainObject(b)) continue;
        if (Array.isArray(a.interlock) && Array.isArray(b.interlock)) {
          const sa = setOf(a.interlock);
          const sb = setOf(b.interlock);
          if (sa.length && sa.length === sb.length && sa.every((x, k) => x === sb[k])) {
            errors.push('版本 ' + a.name + ' 与 ' + b.name + ' 的互锁词完全相同（互锁未体现版本差异）');
          } else if (sa.length && (isSubset(sa, sb) || isSubset(sb, sa))) {
            warns.push('版本 ' + a.name + ' 与 ' + b.name + ' 的互锁词存在完全覆盖，建议各写一条本版独有的负向词');
          }
        }
        if (isText(a.diff) && a.diff === b.diff) {
          warns.push('版本 ' + a.name + ' 与 ' + b.name + ' 的 diff 完全相同');
        }
      }
    }
  }

  return { errors, warns };
}

function setOf(list) {
  return [...new Set(list.filter(isText).map(norm))].sort();
}

function isSubset(a, b) {
  return a.every(x => b.includes(x));
}
