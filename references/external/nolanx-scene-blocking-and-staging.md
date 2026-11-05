# 来源：github.com/nolanx-ai/nolanx.ai → skills/scene-blocking-and-staging/SKILL.md
# 许可：MIT License（SPDX: MIT）· Copyright (c) 2026 NolanX · 许可全文见根目录 THIRD-PARTY-NOTICES.md
# 收编：2026-10-12　用途：场面调度原则（主体路径与机位路径分开描述）
# 本文件原样未改，仅加此头注。
---
name: scene-blocking-and-staging
description: Use for actor blocking, spatial staging, movement through frame, and dynamic scene geography in dialogue, action, or ensemble scenes.
tags:
  - blocking
  - staging
  - actor-movement
  - scene-geography
  - directing
agents:
  allow:
    - planner
    - script_writer
    - video_designer
    - flf_video_designer
---
# Scene Blocking And Staging

Use this skill to turn static ideas into filmable spatial behavior.

## Source Basis
- Frame.io / StudioBinder blocking and staging principles.

## Blocking Rules
- Characters should move because something changes: objective, power, fear, discovery, urgency.
- Entering frame, crossing frame, sitting, turning away, approaching, or stopping must each mean something.
- Maintain readable stage geography so the audience can track who controls the space.

## Staging Heuristics
- Foreground/background layering can express hierarchy or entrapment.
- Distance between characters signals intimacy, danger, alienation, or escalation.
- Re-block when the emotional power changes.
- If tension rises, compress the frame or reduce available movement.

## For AI Video
- Describe subject path and camera path separately.
- State whether the performer is advancing, circling, recoiling, kneeling, mounting, collapsing, etc.
- Tie staging to props and environmental obstacles.
