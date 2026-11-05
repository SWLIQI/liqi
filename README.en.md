# liqi-video-forge

[中文版 README](README.md) · **English**

Turn a story, a screenplay or a rough storyboard into **production-ready prompts you can paste
straight into an AI video model** — and build the asset, screenplay and acting layers upstream
instead of patching them afterwards.

Current version **v6.19.9** (tag `v6.19.9`); the five standalone skill packs under `skills/`
are versioned 0.2.x — see the repository map below.

> **Names**: the GitHub repository is `liqi`, the skill `name` is `liqi-video-forge`, and they are
> the same thing — **the main pack is the repository root itself, not a subdirectory.** The old
> Chinese brand name is retired; where `references/` or `CHANGELOG.md` still mention it, read it as
> `liqi-video-forge`.

---

## Repository map

| What you want | Where | Version |
|---|---|---|
| **Main pack** (full Step -1 ~ Step 6 pipeline) | repository root, entry [`SKILL.md`](SKILL.md) | v6.19.9 |
| Character consistency self-check (4-View sheet, face / wardrobe / interlock) | [`skills/liqi-cast/`](skills/liqi-cast/SKILL.md) | 0.2.2 |
| 50 pre-filled style anchors (hex / camera / break modes) | [`skills/liqi-style/`](skills/liqi-style/SKILL.md) | 0.2.2 |
| 8×3 scene-type camera skeletons (three hard blocks) | [`skills/liqi-move/`](skills/liqi-move/SKILL.md) | 0.2.1 |
| Shot list and light (size / FOV / light position / axis / quotas) | [`skills/liqi-lens/`](skills/liqi-lens/SKILL.md) | 0.2.1 |
| Screenplay gates and dialogue (five gates / seven dimensions / speech-rate scheduling) | [`skills/liqi-script/`](skills/liqi-script/SKILL.md) | 0.2.1 |
| Index of the five packs | [`skills/README.md`](skills/README.md) | — |
| Release history | [`CHANGELOG.md`](CHANGELOG.md) | — |

The packs are self-check tools extracted from the main pack's narrative / asset / audiovisual
layers. Each carries its own `SKILL.md`, `references`, `scripts` and tests, and works without the
main pack. Their `SYNCED.json` records hashes of main-pack files, so provenance is verifiable
inside this repository:

```bash
node skills/liqi-cast/scripts/check_sync.mjs .     # the main pack sits at the repo root
```

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

### Two beliefs that run through everything

**1. Prompts are fed one unit at a time, so every unit must stand alone.** Each shot block (or
asset entry) is copy-pasted into the generator on its own — the model never sees the preamble, nor
the previous shot. That is why the style sentence has to be inlined into the body of *every* unit.
Writing "inherits style anchor `<id>`" is the same as writing nothing: the id is a registry index
for humans, and the model does not recognise the string. Gate `S7` in `check_style.mjs` enforces
this per unit.

The same logic applies to **identity**: inside a few hundred characters the model must *first*
recognise who is who, then decide how to shoot it. So every shot carries a cast line
**`出场人物：A——<shape landmark + garment colour/form + one carried object>; B——…`**
(Chinese keyword, placed right after the shot header / staging lines and before `整体风格：`), listing every character
on screen. **Identity lives on that line, look lives on the next — one line, one job.**
Missing it raises `E-IDENTITY-NOT-INLINE` (see SKILL.md Step 3, item 5).

**2. The most dangerous state of a gate is not an error — it is a green light on input it never
actually looked at.** Empty files, wrong formats, zero extracted items: those green lights do far
more damage than red ones. All five checkers have a false-green defence and hard-fail when the
input layer yields nothing.

---

## The preamble locks (lock 0 + three locks, always first)

Before doing any work, lock four things. Missing one means stop and ask — no defaults.

0. **Lock 0 · Track (〇 赛道分流)** — ① domestic episodic / ② overseas episodic / ③ explainer-narration / ④ other.
   This decides *how this kind of content is written*: speech-rate convention, VO budget, asset doctrine, subtitle
   requirements. It is **orthogonal** to the delivery surface; full rules in `references/赛道分流.md`.
   Option ① is the most common, but it is **not** a default — you still have to ask.
1. **Model target** — Seedance 2.0 / Seedance 2.5 / MiniMax H3 (incl. H3 Max)
2. **Aspect ratio** — **six values** 16:9 / 9:16 / 21:9 / 4:3 / 3:4 / 1:1 (the last three only when explicitly requested; **H3 keeps four** 16:9 / 9:16 / 21:9 / 1:1). Single source of truth: `ratio_whitelist` in `references/model-limits.json`
3. **Delivery surface + style track + delivery form**

Segment headers, duration limits, dialogue write-count and `Must not` handling all differ per
surface. The authoritative comparison is the **"Delivery Surface Parameter Table"** — `references/投放面参数总表.md` (moved out of `SKILL.md` as a standalone file in v6.0.0).

---

## Quick start

1. **The main pack is the repository root.** Put the root directory into your skills directory and
   rename it to match the frontmatter `name` — `liqi-video-forge` (kebab-case since v5.47.0). If you
   only want one layer's self-check, take a single `skills/liqi-<pack>/` directory instead; the main
   pack is not required.
2. Copy the registry seed: `references/style-registry.seed.json` → project-level `style-registry.json`.
3. Give it a story or screenplay and state the locks.
4. Follow Step -1 → Step 6. Use the Load Map in `SKILL.md` to see which reference file to load
   at each step — **load one or two, never all 75.**

### Mandatory checks before delivery

```bash
# 1. Main gate: per-shot format and hard rules (Seedance surface; code count per check_skill.mjs item 2, not hand-maintained)
node scripts/check_prompt.mjs <pkg.md> --surface cn
node scripts/check_prompt.mjs <pkg.md> --surface cn                 # official length advice is on by default
node scripts/check_prompt.mjs <pkg.md> --surface cn --no-official   # internal caps only
node scripts/check_prompt.mjs <pkg.md> --beats <beats.txt>        # beat-claim reconciliation
node scripts/check_prompt.mjs <pkg.md> --beats <beats.txt> --len  # per-section length breakdown

# 2. Style consistency (P0; run it for video packages AND asset packages)
node scripts/check_style.mjs <pkg.md>

# 3. MiniMax H3 surface (never mix with 1; the script self-detects and bails out)
node scripts/check_prompt_h3.mjs <pkg.md>

# 4. Abstract-phrasing scan (required for multi-shot / merged-shot packages)
python scripts/audit_literal.py <pkg.md>

# 5. Content-risk pre-check (when delivering to CN platforms)
python scripts/audit_risk.py <pkg.md>

# 6. When you have a screenplay or an asset library
python scripts/audit_project.py <pkg.md> --script <script.txt> --assets <assets-dir>

# Self-tests (run after touching scripts/)
node scripts/selftest_check_prompt.mjs    # 144 break-through cases
node scripts/selftest_check_style.mjs     # 10 break-through cases (incl. negative-word self-consistency)

# Any time during a project: which gate fires most often
node scripts/gates_stats.mjs <dir>
```

**Any ERROR blocks delivery.**

The five checkers `check_prompt.mjs`, `check_prompt_h3.mjs`, `check_style.mjs`, `audit_literal.py`
and `audit_risk.py` append every run to a `.gates.jsonl` next to the file being checked
(`--no-log` disables; a failed write is skipped silently and never affects the exit code).
`gates_stats.mjs` aggregates it to answer three questions: which gate fires most (the wording is
probably wrong), which gate never fires (possibly dead), and what the failures actually look like.
Rule iteration driven by data, not by feel.

---

## Dependencies

```bash
pip install -r requirements.txt   # matplotlib + pillow; only two scripts need them
```

- Python >= 3.8 (no 3.9+ syntax used)
- Node >= 16 (scripts consistently use the `node:` prefix)
- Zero npm dependencies
- No python-docx, no pandas — docx parsing goes through zipfile + ElementTree
- Windows: python detection order is `python3` → `python` → `py` (the official Windows launcher;
  `winget install Python.Python.3` or the Microsoft Store provides it). Without Python,
  `run_all_checks.sh` refuses to run (exit 2) instead of skipping silently — six audit gates depend on it.

Optional external skills (**everything works without them**): MiniMax `h3-prompt-writing`,
`lengyi-shotlist`, `seedance-video-prompt`.

---

## Repository layout

```
SKILL.md                 main pipeline (Step -1 ~ Step 6) — entry layer (param table moved to references/ in v6.0.0)
references/              115 files (113 md at top level + style-registry.seed.json + model-limits.json)
                         ├ 50 ready style anchors + 1 anchor template
                         ├ 工作流_写镜细则.md (v5.48.0: sole authority for Step 1/2/2.5/3) + 工作流_交付三步.md (v5.46.0: Step 4/5/6) — SKILL.md keeps quick layers
                         ├ six layer rule files (asset / spatial / audiovisual / acting / QC / narrative)
                         ├ three surface adaptations (MiniMaxH3 / Seedance2.5 / Seedream5)
                         ├ external/ 16 third-party reference files (MIT / MIT-0 / Apache-2.0 / MIT+attribution)
                         └ 术语对照表_glossary.md — CN↔EN glossary, the entry point for English users
scripts/                 51 checkers and tools (14 Node + 36 Python + 1 shell)
examples/                golden sample (a complete package + beat list)
docs/                    sample-emotion-curve.png
skills/                  5 standalone packs: liqi-cast 0.2.2 / liqi-style 0.2.2 / liqi-move 0.2.1 / liqi-lens 0.2.1 / liqi-script 0.2.1
                         └ index and usage in skills/README.md; each pack ships its own selftest and check_sync
LICENSE / THIRD-PARTY-NOTICES.md / README.md / README.en.md / CHANGELOG.md / requirements.txt / .gitignore
```

There is no `liqi-video-forge/` wrapper directory above the tree above — **the root of this
repository is the main pack.** Looking for the main pack means `SKILL.md`; looking for a layer
pack means `skills/`.

The repository carries Markdown sources only. Convert to docx / PDF on demand when you need to
hand something to a non-technical collaborator.

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
  fantasy magic systems. Hand-off table: `references/任务模板路由.md`
- **Fight choreography is covered in-skill** — see `references/专项_打斗编排.md` (contact chain, weapon
  locks, blood-scale, time-freeze five beats, `W-COMBAT-*` checks). Only ultimate-move naming
  libraries are handed off.

---

## Contributing

To add a style anchor, fill the ten-section skeleton in `references/风格锚_模板.md` and update
**three places in sync**:

1. L0 source of truth — `references/style-registry.seed.json`
2. L2 routing — `references/风格路由表.md` (register `excludes` **bidirectionally**; one-way entries
   make the cross-track detector miss half the cases)
3. The anchor file itself — `references/风格锚_<slug>.md`

Three-way consistency is guarded by the registry cases in `selftest_check_prompt.mjs`
(equal sets / anchor file exists / CN+EN style sentences present / excludes bidirectional /
`风格锚_` filename prefix). **Run the self-tests before opening a PR.**

6 style tracks, 57 style ids, **50 with a ready style anchor (88%)** — C32 expansion 26→50 completed in v6.11.0 (N19 closed):

| Name | id | Track | Note |
|---|---|---|---|
| Chinese-donghua cel shading | `celshade-guoman-2d` | Cartoon | stable, long-form friendly |
| Japanese 2D anime | `anime-2d` | Cartoon | stable; **no camera orbit** (2D art breaks on orbit) |
| Korean webtoon | `webtoon-2d` | Cartoon | medium; vertical 9:16 specialisation |
| Dark gothic 2D | `gothic-2d` | Cartoon | medium; flat hand-drawn body (ink line + flat fill + silhouette), excludes gothic stop-motion |
| East-Asian ink wash | `ink-wash-2d` | Hand-painted | risky; tends to drift to 2.5D |
| Gothic stop-motion puppet | `gothic-puppet` | Stop-motion | medium; has a reversed dedupe table |
| NPR cel-shaded 3D | `npr-celshaded-3d` | NPR 3D | stable; best long-form consistency, needs asset art |
| Stylized 3D (Pixar-like) | `stylized-pixar-3d` | NPR 3D | stable; soft multi-tone shading, no outline |
| Photoreal PBR / CG film | `photoreal-pbr` | Realistic | risky; always add imperfection words |
| Documentary live action | `documentary-live-action` | Realistic | medium; differs from PBR by "signs the camera operator was there" |
| Chinese feature-film 3D | `guofeng-cine-3d` | Realistic | medium; Tang-dynasty theatrical animation |
| Urban realism · Chinese folk horror | `urban-folk-filmstill` | Realistic | medium; default for modern-urban supernatural, no gore — tension via light and aftermath |
| Papercut | `papercut-2d` | Flat craft | stable; negative-space cutout |
| Shadow puppet | `shadow-puppet-2d` | Flat craft | stable; backlit translucency |
| Guochao (new Chinese style) | `guochao-2d` | Flat craft | stable; indigo + gold line |
| New Year print | `nianhua-2d` | Flat craft | stable; woodblock overprint, no light and no shadow |
| Thick-paint anime | `thickpaint-2d` | Cartoon | medium; soft transitions, hard edges forbidden, opposite cel-shading logic |
| Claymation (warm general) | `claymation-3d` | Stop-motion | stable; border with gothic is subject and lighting, not material; needle-felting is a sub-tier |
| American comic pop art | `comic-popart-2d` | Cartoon | stable; halftone and colour clash are graphics not text, but speech bubbles and onomatopoeia are still banned |
| Ghibli-style | `ghibli-2d` | Cartoon | stable; hand-painted watercolour backgrounds + natural light only, excludes `ink-wash-2d` |
| Isometric low-poly 3D | `lowpoly-iso-3d` | NPR 3D | stable (v5.42.0 batch 3); orthographic isometric view |
| Chibi super-deformation | `chibi-qban-2d` | Cartoon | stable (v5.42.0 batch 3); 2-3 head-body ratio is the definition, negatives exclude chibi |
| Dunhuang gongbi mineral-pigment | `dunhuang-gongbi-2d` | Hand-painted | medium (v5.42.0 batch 3); mineral-colour layering |
| Shinkai-style | `shinkai-2d` | Cartoon | stable (v5.42.0 alt batch); light bloom and sky gradients |
| Dark anime | `dark-anime-2d` | Cartoon | medium (v5.42.0 batch 3); high-contrast dark palette |
| Picture-book gouache | `gouache-2d` | Cartoon | stable (v5.42.0 alt batch); grainy dry brushwork |
| Xianxia idol drama (live) | `xianxia-idol-live` | Realistic | medium (v6.7.0 batch 1 · C32); drama-grade retouch keeping skin texture, ethereal props capped at three |
| Sweet romance (creamy pink) | `sweet-romance-live` | Realistic | stable (v6.7.0 batch 1 · C32); high-key soft light, excludes cold suspense grade |
| Retro Hong Kong neon | `hk-retro-filmstill` | Realistic | medium (v6.7.0 batch 1 · C32); film grain, hard light, signboards stay defocused |
| Urban suspense (cold cyan) | `urban-suspense-live` | Realistic | stable (v6.7.0 batch 1 · C32); low-light in-frame sources, manila archive the only warm hue |
| Shonen hot-blood 2D | `shonen-hotblood-2d` | Cartoon | medium (v6.7.0 batch 1 · C32); high-saturation hard-edge cel + speed lines, intensity tier above anime |
| Republic calendar poster | `republic-calendar-poster` | Hand-painted | stable (v6.7.0 batch 1 · C32); charcoal-watercolour poster formula, excludes woodblock prints |
| Song-dynasty court silk | `song-aesthetic-2d` | Hand-painted | medium (v6.8.0 batch 2 · C32); thin mineral wash with bare-silk negative space, opposite of expressive ink |
| Blue-white porcelain | `qinghua-porcelain-2d` | Flat craft | stable (v6.8.0 batch 2 · C32); white glaze and cobalt only, five ink-loading tones |
| Blue-green gold-outline landscape | `jinbi-landscape-2d` | Hand-painted | medium (v6.8.0 batch 2 · C32); mineral saturation never neon, staffage figures dwarfed by mountains |
| Han relief rubbing | `han-relief-rubbing` | Flat craft | stable (v6.8.0 batch 2 · C32); two-value rubbing frieze, cinnabar capped at one accent |
| Bronze ritual motifs | `bronze-motif-2d` | Flat craft | stable (v6.9.0 batch 3 · C32); three-colour bronze cap, inscriptions are pattern never text |
| Opera stage (live) | `opera-stage-live` | Realistic | medium (v6.9.0 batch 3 · C32); bare stage convention, stage-top front light |
| Miao batik and silver | `miao-batik-indigo` | Flat craft | stable (v6.9.0 batch 3 · C32); indigo ground with resist-white, inverse of porcelain, silver only metal |
| Thangka-style mineral gold | `thangka-mineral-gold` | Hand-painted | medium (v6.9.0 batch 3 · C32); full mineral ground with hair-fine gold lines, religious symbols kept out of story |
| US comic ink | `us-comic-ink-2d` | Cartoon | medium (v6.10.0 batch 4 · C32); pen hatching with CMYK print feel, distinct from pop-art flats |
| Cyberpunk anime | `cyberpunk-anime-2d` | Cartoon | medium (v6.10.0 batch 4 · C32); three-path neon ambient light, signs stay defocused |
| Synthwave graphics | `synthwave-retro-2d` | Cartoon | stable (v6.10.0 batch 4 · C32); self-lit geometric silhouettes, no narrative figures |
| Film-noir illustration | `noir-ink-2d` | Cartoon | stable (v6.10.0 batch 4 · C32); pure two-value hard light, cigarette ember the only colour |
| Classical oil painting | `classical-oil-2d` | Hand-painted | medium (v6.10.0 batch 4 · C32); transparent glazes and impasto, single warm light |

Batch 5 (v6.11.0 · C32) added the final five — flat minimal, translucent watercolour, western
fantasy epic, pixel art (conditional entry promoted), chalk and pastel — all registered above.

The table above lists the 50 with ready anchors; the remaining 7 pending ids are in
`references/风格路由表.md` section 2, with the fallback guide in section 5.

---

## Third-party content

`references/external/` carries 16 files from open-source projects (**MIT / MIT-0 / Apache-2.0 / MIT+attribution**, included
verbatim with a source + licence header). One research target is deliberately **not** included —
its upstream repository declares no licence at all — so only the link and our own conclusions are
recorded, never its content.

Full list with copyright lines and licence texts: **[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)**.

---

## License

MIT — see [LICENSE](LICENSE). Third-party content: see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
