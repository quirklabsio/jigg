# Jigg Docs

Three questions, three categories.

## What exists and how it fits together
- [`architecture.md`](architecture.md) — puzzle model, rendering, interaction, accessibility overview

## Why it exists / trade-offs
- [`decisions.md`](decisions.md) — stack choices, model choices, and alternatives rejected

## How it's built
- [`engine-conventions.md`](engine-conventions.md) — runtime invariants and contracts every file must obey
- [`spec-integration.md`](spec-integration.md) — jigg-spec submodule, type boundary, import alias
- [`drag-and-drop.md`](drag-and-drop.md) — drag mechanics, hit testing, group movement
- [`snap-detection.md`](snap-detection.md) — proximity algorithm, edge alignment, cluster merge
- [`wasm-pipeline.md`](wasm-pipeline.md) — Rust/WASM build, worker setup, message protocol
- [`accessibility.md`](accessibility.md) — ARIA structure, keyboard map, visual accessibility
- [`conventions.md`](conventions.md) — code style, naming, testing patterns
- [`gotchas.md`](gotchas.md) — anti-patterns and common failure modes

## Planning (BA)
- [`roadmap.md`](roadmap.md) — story board: shipped, next, deferred
- [`BA.md`](BA.md) — story writing guide and handoff workflow

## Development log
- [`stories.md`](stories.md) — implementation log, one entry per shipped story
