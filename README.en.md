# SuperLiqi Prompt Forge

[中文版 README](README.md) · **English**

Turn a story, a screenplay or a rough storyboard into **production-ready prompts you can paste
straight into an AI video model** — and build the asset, screenplay and acting layers upstream
instead of patching them afterwards.

---

## Why this exists

Most AI-video prompts fail the same way: plenty of adjectives, decent camera moves, but the
character changes face between shots, shots do not cut together, dialogue cannot be spoken in the
time given, and a re-roll three days later produces a different person.

This skill breaks that into layers you can check mechanically:

| Layer | Step | What it governs |
|---|---|---|
| Screenplay gate | Step -1 | five gates, seven-dimension dialogue diagnosis, measured speech-rate calibration |
| Asset layer | Step 2.5 | 4-View character board, pixel budget, lighting anchors, registry reuse |
| Acting layer | Step 3 | FACS four-zone breakdown, real vs fake smile, three intensity tiers |
| Spatial layer | Step 3 | axis three states, four blocking elements, framing-radius rule |
| Audiovisual layer | Step 3 | three-task rule, colour budget, anti-adjective translation |
| QC layer | Step 4 | P0–P2 gates, three-step re-verification, content-risk loop |

---

## The three locks (always first)

Before doing any work, lock three things. Missing one means stop and ask — no defaults.

1. **Model target** — Seedance 2.0 / Seedance 2.5 / MiniMax H3 (incl. H3 Max)
2. **Aspect ratio** — 16:9 / 9:16 / 21:9 (1:1 only when explicitly requested)
3. **Delivery surface + style track + delivery form**

Segment headers, duration limits, dialogue write-count and `Must not` handling all differ per
surface. The authoritative comparison is the **"Delivery Surface Parameter Table"** in `SKILL.md`.

---

## Quick start

1. Copy the whole directory into your skills directory and rename it to the skill name
   `super-liqi-prompt` (the folder name must match the `name` field in `SKILL.md`, which
   only allows lowercase letters, digits and hyphens).
2. Copy the registry seed: `references/style-registry.seed.json` → project-level `style-registry.json`.
3. Give it a story or screenplay and state the three locks.
4. Follow Step -1 → Step 6. Use the Load Map in `SKILL.md` to see which reference file to load
   at each step — load 1–2, never all 44.

### Mandatory checks before delivery

```bash
# Seedance surface
node scripts/check_prompt.mjs <file.md> --surface cn
node scripts/check_prompt.mjs <file.md> --surface cn --official   # adds the official 500-char gate

# MiniMax H3 surface (never mix with the above; the script self-detects and bails out)
node scripts/check_prompt_h3.mjs <file.md>

# Abstract-phrasing scan (required for multi-shot / merged-shot packages)
python scripts/audit_literal.py <package.md>

# When you have a screenplay or asset library
python scripts/audit_project.py <pkg.md> --script <script.txt> --assets <assets-dir>

# When delivering to CN platforms
python scripts/audit_risk.py <file.md>
```

**Any ERROR blocks delivery.** Both scripts now self-detect the delivery surface: feed an H3
package to `check_prompt.mjs` and it exits with `E-WRONG-SCRIPT` instead of burying you in false
`E-SECTION-MISSING` errors.

---

## Style coverage

6 style tracks, 30 style ids, **9 with a ready style-anchor file (30% coverage)**.

| id | Name | Track | Note |
|---|---|---|---|
| `celshade-guoman-2d` | Chinese-donghua cel shading | Cartoon | stable, long-form friendly |
| `anime-2d` | Japanese 2D anime | Cartoon | stable; **no camera orbit** (2D art breaks on orbit) |
| `webtoon-2d` | Korean webtoon | Cartoon | medium; vertical 9:16 specialisation |
| `ink-wash-2d` | East-Asian ink wash | Hand-painted | risky; tends to drift to 2.5D |
| `gothic-puppet` | Gothic stop-motion puppet | Stop-motion | medium; has a reversed dedupe table |
| `npr-celshaded-3d` | NPR cel-shaded 3D | NPR 3D | stable; best long-form consistency, needs asset art |
| `stylized-pixar-3d` | Stylized 3D (Pixar-like) | NPR 3D | stable; soft multi-tone shading, no outline |
| `photoreal-pbr` | Photoreal PBR / CG film | Realistic | risky; always add imperfection words |
| `documentary-live-action` | Documentary live action | Realistic | medium; differs from PBR by "signs the camera operator was there" |

To add a style: fill the ten-section skeleton in `references/风格锚_模板.md` and write it back to
`style-registry.json`.

---

## Dependencies

```bash
pip install -r requirements.txt   # matplotlib + pillow; only two scripts need them
```

- Python >= 3.8
- Node >= 16 (scripts use the `node:fs` prefix)
- Zero npm dependencies
- No python-docx, no pandas

Optional external skills (**11 in total; everything works without them**): `h3-camera-shots`,
`h3-shot-iteration`, `h3-storyboard`, MiniMax `h3-prompt-writing`, `md-to-docx`, `lengyi-shotlist`,
`seedance-video-prompt`, `realistic-actor`, `cinematic-shot-prompt-expert`, `infimind-video-analysis`,
`direct-seedance25-video`. See the "外部依赖与降级方案" table in `SKILL.md` for what each one does and
the fallback when it is absent — no main workflow path requires any of them.

---

## Repository layout

```
SKILL.md                 main pipeline (Step -1 ~ Step 6) + the authoritative surface parameter table
references/              45 rule and example files; load on demand
scripts/                 12 mechanical checks and tools
LICENSE / README.md / README.en.md / CHANGELOG.md / requirements.txt / .gitignore
```

---

## Language note

File names and rule text are Chinese. Two things make this usable in English:

- `references/术语对照表_glossary.md` — a full CN↔EN glossary for every term used here
  (tracks, locks, budgets, gates, rule-code prefixes).
- When delivering to the MiniMax H3 surface the prompt body **must** be English anyway, and
  `audit_literal.py` carries English rules alongside the Chinese ones.

---

## Boundaries

- Covers: narrative shorts — animation, drama, period/supernatural realism, public-service, PREVIS
- Does not cover: e-commerce/talking-head ads, TVC brand spots, dance and FPV specialities,
  dedicated fight choreography, fantasy magic systems. Hand-off table: `references/任务模板路由.md`

---

## License

MIT — see LICENSE.
