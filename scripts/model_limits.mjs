#!/usr/bin/env node
/**
 * model_limits.mjs —— 锁①模型硬参数的唯一加载入口
 *
 * 事实源是 references/model-limits.json。本模块只做三件事：读 JSON、校验字段、给出兜底。
 * check_prompt.mjs / check_prompt_h3.mjs / audit_project.py 都从同一份 JSON 取数字。
 *
 * 为什么要有这个文件（v5.37.1）：
 *   这些数字曾经同时存在于三处 —— check_prompt.mjs 写死 30/20、check_prompt_h3.mjs 写死
 *   `dur < 4 || dur > 15`、audit_project.py 另有一份 MODEL_DURATION。结果同一份
 *   「Seedance 2.0 面 20s」包，一台判 0 error、一台判 ERROR（审查报告 MA-1 / MA-2）；
 *   H3 Max 的 5s 下限三处文档都写了，代码里一处都没有（MA-4）。
 *
 * 兜底策略：JSON 读不到或字段残缺时用内置副本，**不阻断校验**。
 *   内置副本必须与 JSON 保持一致（selftest 有一项专门比对）。
 */
import { readFileSync } from 'node:fs';

// 内置副本：仅在 JSON 不可读时生效。改数字请改 references/model-limits.json。
const BUILTIN = {
  '2.5': { label: 'Seedance 2.5', cap: 30, soft: 20, floor: null, refs: { image: 30, video: 10, audio: 10, total: 50 } },
  '2.0': { label: 'Seedance 2.0', cap: 15, soft: 15, floor: 4, refs: { image: 9, video: 3, audio: 3, total: 12 } },
  h3: { label: 'MiniMax H3', cap: 15, soft: 15, floor: 4, refs: { image: 9, video: 3, audio: 3, total: 12 } },
  h3max: { label: 'MiniMax H3 Max', cap: 15, soft: 15, floor: 5, refs: { image: 9, video: 3, audio: 3, total: 12 } },
};

/** 包内未声明型号时的兜底档：取最严的 15s / 12 份素材，绝不静默放宽到 30s / 50 份（与 audit_project.py:FALLBACK_CAP 同口径）。 */
export const FALLBACK_LIMIT = { label: '未声明模型', cap: 15, soft: 15, floor: null, refs: { image: 9, video: 3, audio: 3, total: 12 } };

// v5.49.0：提示词长度建议（官方口径为「建议」级）与锁② 画幅白名单也从 JSON 共读——
// 此前活在 check_prompt.mjs 的代码常量里，是「数值唯一事实源」原则的缺口（同 MA-5 病型）。
// 兜底与 JSON 保持一致（selftest 的内置副本对拍一并覆盖这两组）。
export const PROMPT_LENGTH = { cjkMax: 500, enMax: 1000 };
const BUILTIN_RATIOS = ['16:9', '9:16', '21:9', '4:3', '3:4', '1:1'];
export let RATIO_VALUES = BUILTIN_RATIOS.slice();
export let RATIO_EXTRA = ['adaptive'];
export function ratioOk(v) {
  const s = String(v || '').toLowerCase();
  return RATIO_VALUES.includes(s) || RATIO_EXTRA.includes(s);
}

let limits = BUILTIN;
let src = '内置副本（未读到 references/model-limits.json）';

try {
  const j = JSON.parse(readFileSync(new URL('../references/model-limits.json', import.meta.url), 'utf8'));
  const m = {};
  for (const [k, v] of Object.entries(j.models || {})) {
    if (!v || !Number.isFinite(v.cap)) continue;   // cap 缺失的档位直接丢弃：宁可回落副本，也不拿 undefined 判红
    m[k] = {
      label: v.label || k,
      cap: v.cap,
      soft: Number.isFinite(v.soft) ? v.soft : v.cap,
      floor: Number.isFinite(v.floor) ? v.floor : null,
      // refs（参考素材上限，v5.37.2）：单镜一次调用能塞多少张图/段视频/条音频。
      // 旧版 JSON 里已有这四个数，但没有任何脚本读它——文档写着上限、机器不查，是 MA-5。
      refs: v.refs && Number.isFinite(v.refs.total) ? {
        image: Number.isFinite(v.refs.image) ? v.refs.image : 0,
        video: Number.isFinite(v.refs.video) ? v.refs.video : 0,
        audio: Number.isFinite(v.refs.audio) ? v.refs.audio : 0,
        total: v.refs.total,
      } : null,
    };
  }
  if (Object.keys(m).length) {
    limits = m;
    src = 'references/model-limits.json';
  }
  const fb = j.fallback || {};
  if (Number.isFinite(fb.cap)) {
    FALLBACK_LIMIT.cap = fb.cap;
    FALLBACK_LIMIT.soft = Number.isFinite(fb.soft) ? fb.soft : fb.cap;
  }
  if (fb.refs && Number.isFinite(fb.refs.total)) {
    FALLBACK_LIMIT.refs = fb.refs;
  }
  // v5.49.0：prompt_length / ratio_whitelist（字段残缺时保留兜底值，绝不拿 undefined 判红）
  if (j.prompt_length && Number.isFinite(j.prompt_length.cjk_chars_max)) {
    PROMPT_LENGTH.cjkMax = j.prompt_length.cjk_chars_max;
    PROMPT_LENGTH.enMax = Number.isFinite(j.prompt_length.en_words_max)
      ? j.prompt_length.en_words_max : PROMPT_LENGTH.enMax;
  }
  if (j.ratio_whitelist && Array.isArray(j.ratio_whitelist.values) && j.ratio_whitelist.values.length) {
    RATIO_VALUES = j.ratio_whitelist.values.map((s) => String(s).toLowerCase());
    RATIO_EXTRA = Array.isArray(j.ratio_whitelist.extra)
      ? j.ratio_whitelist.extra.map((s) => String(s).toLowerCase()) : [];
  }
} catch {
  /* 读不到就用内置副本：数字旧一点也比拒绝校验好 */
}

export const MODEL_LIMITS = limits;
export const MODEL_LIMITS_SRC = src;
export { BUILTIN, BUILTIN_RATIOS };  // 仅供 selftest 对拍（BUILTIN ↔ JSON 逐档一致）；运行时不直接用

/**
 * 取某一档的硬参数；未知型号返回 null（调用方自行决定是报错还是走兜底）。
 * @param {string} key '2.5' | '2.0' | 'h3' | 'h3max'
 */
export function limitOf(key) {
  return MODEL_LIMITS[String(key || '').toLowerCase()] || null;
}
