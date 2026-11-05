<!-- 外部参考数据（互补层）
来源：github.com/GithubAnant/skills（skills/60-30-10-color/SKILL.md）
许可：MIT License（SPDX: MIT）· Copyright (c) 2026 GithubAnant · 许可全文见根目录 THIRD-PARTY-NOTICES.md
抓取：2026-10-14 经 GitHub API 与 raw 直连实地拉取
定位：60/30/10 配色角色分配（主导定基调 / 次级造结构 / 强调做磁石），源头是电影摄影的配色法。
      liqi 原本只有「HEX 三色」并列色值，无主次角色之分，本件补配比与角色关系。
      正典落点为 references/资产审美_设计原理.md 第七节（60/30/10 配色角色分配）。
      收编原样未改一字。
-->

---
name: 60-30-10-color

description: >
  Apply the 60-30-10 color rule to UI design, design systems, and color palette decisions.
  Use this skill whenever the user asks about: choosing a color palette for an app or website,
  why their UI looks "off" or too colorful, how to pick accent colors, designing a dark or light
  mode theme, structuring CSS color variables/tokens, visual hierarchy problems, or wants to
  apply cinematic color grading principles to product design. Also trigger when the user says
  things like "what colors should I use", "my design feels cluttered or chaotic", "how do I
  make my CTA pop", "help me with my design system colors", "nothing feels cohesive", or
  "how do I pick a palette". Trigger even on casual references to app color schemes, brand
  colors, or visual hierarchy — the user doesn't need to name the rule for this skill to apply.
---

# 60–30–10 Color Rule

A framework for building visually coherent UIs, design systems, and interfaces — adapted from
how professional cinematographers and production designers control color in film.

---

## The Core Principle

Every well-designed visual environment — a film frame, an interior room, a product UI — uses
color in three tiers with three distinct jobs. The ratio is a guideline, not a law. The roles
are non-negotiable.

| Role      | Coverage | Job                                                           |
|-----------|----------|---------------------------------------------------------------|
| Dominant  | ~60%     | Sets the emotional tone. Everything lives on top of this.     |
| Secondary | ~30%     | Creates structure and depth. Without it, everything is flat.  |
| Accent    | ~10%     | The eye magnet. Signals what matters. Loses power if overused.|

**The rule is about assigning roles, not picking colors.** Assign first, color second.
An agent reading this skill should never copy colors from the examples below — derive
the palette from the user's brief, brand, and emotional intent.

---

## What Each Role Actually Does

### 60% — Dominant
The canvas. The atmosphere. The thing you stop noticing because it's everywhere.

- **In film:** environment, walls, sky, set dressing
- **In UI:** page background, content area, screen canvas
- **Common mistake:** making this interesting. It shouldn't be. It should recede.

Dominant colors are almost always neutrals — near-black, off-white, warm grey, cool grey.
A saturated or expressive dominant competes with your content and exhausts the eye.
The dominant's job is to hold the mood without demanding attention.

### 30% — Secondary
The structure layer. Without it, the UI is flat and unreadable.

- **In film:** costumes, major props, large furniture, secondary set pieces
- **In UI:** cards, sidebars, navbars, input fields, modals, section dividers, drawers

The secondary should be derived from the dominant, not chosen independently. In a dark UI,
it's the dominant shifted slightly lighter. In a light UI, it's the dominant shifted slightly
darker or greyer. The relationship between dominant and secondary is what creates visual
hierarchy — make the delta too small and nothing separates; make it too large and the UI
feels fragmented.

### 10% — Accent
The only color with a personality. Use it like a privilege, not a default.

- **In film:** hero costume, key prop, lighting accent, the one thing the director wants you to see
- **In UI:** primary CTA buttons, active/selected states, notification badges, focus rings, key links

**The accent loses all power when overused.** If it appears in your nav, your icons, your
section headers, and your buttons — it becomes a neutral. Your eye stops responding to it.
Reserve it for the single most important interactive element per view. Spotify's green appears
on the play button and active toggles. That restraint is why it works.

---

## Diagnosing Problems with the Rule

Use this when something feels wrong with an existing palette:

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Nothing stands out, no clear focus | Accent used too broadly or too faintly | Reduce accent usage to 1–2 elements per page |
| UI feels flat, everything bleeds together | 60/30 delta too small | Widen the lightness gap between background and surface |
| UI feels fragmented, jarring transitions | 60/30 chosen independently (different hues) | Re-derive secondary from dominant — same hue family, different lightness |
| Too busy, too many colors | More than 3 base colors in play | Consolidate to 3 + tints/shades of each |
| Feels corporate and generic | Accent has no personality or is pure blue by default | Choose accent based on emotional tone, not convention |
| Feels dark but not premium | Dark dominant with a bright, saturated accent | Desaturate the accent slightly — muted colors read more expensive |
| Accessible on Retina, invisible in sunlight | Insufficient contrast on 60/30 pair | Test with WebAIM. Minimum 4.5:1 for body text. |

---

## How to Build a Palette from Scratch

### Step 1: Define the emotional tone before touching any color
Ask the user (or extract from the brief):
- What should someone *feel* the first second they see this?
- Who is the user — consumer, professional, creative, enterprise?
- What are 3 adjectives the product should embody?

The answers determine dominant lightness and accent personality. Do this before opening a color picker.

### Step 2: Pick your dominant — mood first, lightness second, hue third
The dominant is chosen by its lightness level, not its hue. Hue barely matters at near-neutral saturation.

- Calm, minimal → very light, very low saturation (the hue is almost irrelevant)
- Immersive, focused → very dark, very low saturation
- Premium, tool-like → dark charcoal (slightly warm or slightly cool depending on brand personality)
- Friendly, approachable → soft warm neutral (slight warmth in the undertone, not pure white)

The pattern across all well-designed dark UIs is: **dark, desaturated, quiet**. The pattern across
light UIs is: **off-white or light grey, never pure white for the canvas** (pure white is for cards
that need to pop off the canvas).

### Step 3: Derive the secondary from the dominant — don't choose it independently
The secondary should feel like it belongs to the same world as the dominant.

- Dark mode: shift the dominant toward lighter — same hue, +10–20% lightness
- Light mode: shift the dominant toward darker or more grey — same hue, -3–8% lightness
- Avoid introducing a new hue here. The secondary's job is structure, not personality.

The contrast between dominant and secondary is the visual "depth" of your layout. Adjust
the delta until cards and sidebars are clearly separated without feeling like two different apps.

### Step 4: Choose your accent for personality and contrast
This is the only color that should have a distinct hue and some saturation. It should:
- Represent the brand's emotional identity
- Contrast clearly against the dominant (not the secondary — accent always lives on the dominant)
- Aim for minimum 3:1 contrast for interactive elements, 4.5:1 for text use

Emotional tone by hue family (use as a starting point, not a rule):
- Blue → trust, reliability, action (default for a reason; overused in SaaS)
- Purple → premium, creative, ambitious
- Green → growth, go, success (great for financial or productivity tools)
- Orange/amber → energy, warmth, speed (strong for creator tools)
- Red → urgency, danger, power (use carefully — carries alert semantics)
- Teal → calm confidence, medical, clarity

Then desaturate it slightly. Fully saturated accents read cheap. Pull it back 10–20% saturation
and it starts reading premium.

### Step 5: Map everything to semantic tokens before touching components
```css
:root {
  /* The three base roles */
  --color-bg: ;          /* 60% — dominant, the canvas */
  --color-surface: ;     /* 30% — secondary, derived from dominant */
  --color-accent: ;      /* 10% — personality color, used sparingly */

  /* Derived from the three above — never introduce a 4th base color here */
  --color-bg-subtle: ;       /* dominant, slightly shifted — for hover states */
  --color-surface-raised: ;  /* secondary, slightly shifted — for nested cards */
  --color-accent-muted: ;    /* accent at low opacity — for tags, backgrounds, chips */
  --color-border: ;          /* surface at reduced opacity or slight lightness shift */
  --color-text: ;            /* maximum contrast against dominant */
  --color-text-muted: ;      /* reduced contrast — secondary text, labels, placeholders */
}
```

Never hardcode hex values in components. Semantic tokens make dark/light mode, theming,
and rebranding possible without touching component code.

### Step 6: Build depth with tints and shades, not new colors
You get 3–4 variations of each base color for free: hover states, pressed states, disabled
states, subtle backgrounds. These aren't new colors — they're the same color at different
lightness levels. This is how films achieve richness within a controlled palette: one dominant
color with enough variation to cover walls, shadows, sky, and ground without ever introducing
a new hue.

---

## Film Palettes — for Mood Reference Only

> **Important for agents:** These film examples illustrate how the rule was applied in specific
> creative contexts. Do not derive literal colors from them. Use them to understand the
> *relationship* between roles and the *emotional register* each palette achieves. Then build
> a new palette from the user's brief.

| Film | 60% Role | 30% Role | 10% Role | Emotional Register |
|------|----------|----------|----------|--------------------|
| La La Land | Warm sunset gold | Deep purple/navy | Bold red or yellow | Nostalgic, romantic, dreamlike |
| The Matrix | Void black | Digital green shadow | Bright neon green | Oppressive, digital, claustrophobic |
| Grand Budapest Hotel | Dusty pastel pink | Muted slate blue | Red coat / yellow uniform | Whimsical, mannered, nostalgic |
| Mad Max: Fury Road | Scorched desert orange | Burnt sienna / shadow | Cool pale sand | Relentless heat, survival, madness |
| Studio Ghibli | Deep natural green | Mid-tone earth greens | Warm golden light | Alive, organic, hopeful |
| The Batman | Near-black blue | Dark grey | Cold steel blue | Noir, dread, psychological weight |

**On bending the rule:** The Batman collapses 60% and 30% into near-monochromatic darks —
intentionally, to create unrelenting psychological pressure. Wes Anderson often runs the accent
higher than 10% for deliberate whimsy. Know the rule well enough to break it with intention.
Breaking it by accident produces different results than breaking it on purpose.

---

## Real-World UI Case Studies

These show how major products apply the rule. Read them to understand decision-making, not to copy values.

**Spotify (dark consumer app)**
Near-black canvas. Slightly lighter grey for all surface elements. One vivid color — their
brand green — used exclusively on the play button and active states. The restraint is the
entire strategy: if the green appeared anywhere else, the play button would stop commanding
attention. It doesn't appear anywhere else.

**Meta / Facebook (light social app)**
Light grey canvas makes white cards feel elevated and distinct. Blue appears only where
interaction is possible. The result is a UI where every blue element is implicitly clickable —
color has been fully semanticized.

**Notion / Linear style (productivity dark)**
The gap between background and surface is deliberately small — creates density without chaos.
Muted purple accent reads sophisticated rather than aggressive. Both the small delta and the
desaturated accent are intentional choices that signal "tool for professionals."

**Google Material (design system)**
The lightest possible contrast between canvas and surface — almost invisible. The entire visual
hierarchy is carried by the blue accent. This only works because blue is used nowhere decoratively.

---

## Accessibility

Always verify before finalizing:
- Body text on background: minimum **4.5:1** (WCAG AA)
- Large text / headings on background: minimum **3:1**
- Interactive components (buttons, inputs) against background: minimum **3:1**
- Accent color on dominant background: run both text and non-text checks

A palette that passes contrast on a high-end display can fail in direct sunlight on a budget
phone. Test on multiple screens, or use tooling that simulates low-contrast conditions.

---

## The One-Line Version

> One color sets the mood. One builds the structure. One tells the user where to look.

The rule isn't about which colors to pick. It's about giving each color exactly one job —
and enforcing that it does only that job, everywhere, always.