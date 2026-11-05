# 来源：github.com/nolanx-ai/nolanx.ai → skills/dialogue-performance-blocking/SKILL.md
# 许可：MIT License（SPDX: MIT）· Copyright (c) 2026 NolanX · 许可全文见根目录 THIRD-PARTY-NOTICES.md
# 收编：2026-10-12　用途：对白戏的表演与调度原则
# 本文件原样未改，仅加此头注。
---
name: dialogue-performance-blocking
description: Use for dialogue scenes, emotional performance beats, actor blocking, lip-sync-driven moments, and character interaction with clear emotional progression.
tags:
  - dialogue
  - performance
  - blocking
  - acting
  - lip-sync
  - emotion
agents:
  allow:
    - planner
    - script_writer
    - video_designer
    - flf_video_designer
    - tts_designer
---
# Dialogue Performance Blocking

Use this skill when scenes depend on acting, emotional readability, or conversational power shifts.

## Goals
- Make dialogue playable on screen.
- Tie performance to body behavior, gaze, tempo, and framing.
- Keep lip-sync and emotional arcs aligned.

## Performance Design
For each line or vocal beat, define:
- objective: what the character wants right now
- subtext: what they really mean or hide
- emotional vector: suppressing, exploding, seducing, pleading, threatening, breaking
- body behavior: stillness, pacing, turn-away, advance, recoil, grip, glance, breath pattern
- facial behavior: eye lock, jaw tension, micro-smile, swallow, flinch, blink rhythm

## Blocking Rules
- Characters should move because of changing power, pressure, or vulnerability.
- Stillness can be stronger than motion if it intensifies dominance or dread.
- Repositioning should mark a beat change.
- Camera proximity should reflect intimacy, threat, shame, revelation, or collapse.

## Dialogue Scene Rules
- Avoid long neutral talking heads.
- Every line should either attack, defend, reveal, conceal, or break.
- Add reaction beats and silence when they sharpen power dynamics.
- For short-form drama, compress emotional transitions so each beat is screen-legible quickly.

## Lip Sync / Voice Rules
- If a line is specified, preserve the exact spoken line unless user requests rewrite.
- Mouth motion should be continuous and readable across the full beat when dialogue is sustained.
- Performance intensity should match the physical state of the character.
