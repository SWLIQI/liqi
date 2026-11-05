<!-- 外部参考数据（互补层）
来源：github.com/nolanx-ai/nolanx.ai（.nolanx/skills/environment-scene-extraction-bible/SKILL.md）
许可：MIT License（SPDX: MIT）· Copyright (c) 2026 NolanX · 许可全文见根目录 THIRD-PARTY-NOTICES.md
抓取：2026-10-12 经 GitHub API 实地拉取（直连恢复）
定位：38 行极简场景纪律（场景规则/连续性规则/无人物规则/避免四坑），与 liqi 场景锚逐条互证。
      独有条：「同地点每镜改名」禁令——建议补进 novel-art 崩点清单。收编原样未改一字。
-->

---
name: environment-scene-extraction-bible
description: Use for location-first, no-human, and scene-bible workflows that need stable environment naming, spatial continuity, lighting logic, and clean world extraction without character contamination.
tags:
  - environment
  - scene-design
  - location
  - no-human
  - worldbuilding
agents:
  allow:
    - planner
    - script_writer
    - image_designer
    - video_designer
---
# Environment Scene Extraction Bible

Use this skill when the location is the subject.

## Scene Rules
- Name each environment specifically, not generically.
- Describe foreground, midground, background, and atmosphere.
- Lock time of day, weather, light direction, and dominant materials.

## Continuity Rules
- Reuse the same landmark set across adjacent scene beats.
- If the world changes, state exactly what changed: damage, weather, occupancy, or lighting.
- Keep scale readable with architecture, terrain, debris, or horizon cues.

## No-Human Rules
- Explicitly exclude people when the brief is environment-only.
- Remove stray body parts, silhouettes, crowds, and ambiguous human traces unless story requires them.

## Avoid
- generic empty-room language
- relabeling the same location every shot
- mixing incompatible weather or time states
