<!-- audience: Dev, Agent, BA -->

# Architecture — What Exists and How It Fits Together

*Conceptual overview of the Jigg application. For implementation details see the relevant how-it's-built docs. For why things are this way see `decisions.md`.*

---

## The Puzzle Model

A puzzle is a flat collection of **pieces**. Each piece carries two categories of data: its immutable definition (shape, correct position, index) sourced from the `jigg-spec` submodule, and its mutable runtime state (where it is, whether it's been placed, which group it belongs to).

Pieces live in one of two **stages**: the bench (the unsolved tray) or the table (the assembly area). Movement is one-way — a piece that reaches the table never returns to the bench.

**Groups (clusters)** form when pieces snap together. A group is not a stored object; it is derived at runtime by collecting pieces that share a `clusterId`. A lone piece is implicitly a group of one. When a group reaches its correct position, all its pieces are marked `placed` and the group dissolves — placed pieces have no cluster.

`placed: boolean` is the sole authority on correctness. Stage identity is not a proxy for correctness.

---

## Rendering

PixiJS owns the canvas. All puzzle pieces, visual feedback, snap highlights, and background rendering happen inside the PixiJS scene graph.

The DOM contributes two layers alongside the canvas:

1. **Accessibility layer** — visually hidden landmarks, a hidden button tree for screen readers, and a live announcement region, fully wired to puzzle state.
2. **App shell controls** — visible top-level DOM elements outside the canvas (e.g. the "Choose Image" button). These are siblings of `#app` in the document, never inside the PixiJS-managed region, and are not affected by the `inert` management on the bench/table landmarks.

The PixiJS scene and both DOM layers are kept in sync as piece state changes.

---

## Interaction

**Pointer input** uses a single transparent hit layer rather than per-piece event listeners. A spatial hash indexes pieces by grid cell, so hit testing is O(1) regardless of piece count.

**Snap detection** runs on drag end. The pipeline queries nearby pieces, tests edge alignment and rotation compatibility, selects the best candidate by confidence, and executes a position correction. Groups snap as units.

**Keyboard input** runs in parallel to pointer input, not as a fallback. The app maintains a keyboard mode (bench or table) and uses the `inert` attribute to restrict tab focus to the active region. Keyboard piece movement, rotation, and placement are first-class interactions.

---

## Accessibility

Two `role="application"` landmarks bracket the experience — bench first, table second in DOM order. `role="application"` suppresses assistive technology shortcut keys so the app owns all key events.

A live region announces state changes: filter switches, piece pickup, snap, placement, completion. Piece buttons carry labels derived from piece type and current state, updated as state changes.

Visual accessibility (high contrast, greyscale, reduced motion) is managed through PixiJS filters and Zustand preferences, with in-app toggles independent of OS-level settings.

See `accessibility.md` for the full keyboard map, ARIA label formats, and known gaps.

---

## State

Game state lives in a **Zustand store** outside React, making it accessible to the PixiJS scene, workers, and DOM accessibility layer without prop threading. The store holds pieces, puzzle metadata, user settings, and UI state.

Piece state is the ground truth. The PixiJS scene and DOM layers read from it and write back to it on user interaction.

---

## WASM Integration

Image analysis and cut generation run in a **Web Worker** backed by a Rust/WASM module. The worker receives raw pixel data from the main thread, runs Canny edge detection and cut routing in WASM, and returns results via structured message protocol. The main thread remains unblocked during processing.

The WASM module is imported directly into the worker as an ES module (not served from `public/`). See `wasm-pipeline.md` for build steps and the message protocol.

---

## Module Map

```
src/
├── puzzle/           # Game logic — piece state, types, snap detection
├── canvas/           # PixiJS rendering — scene, sprites, spatial index
├── interaction/      # Input handling — pointer, keyboard, ARIA integration
├── workers/          # Web Worker + WASM bridge
└── wasm-pkg/         # Generated Rust/WASM bindings (do not edit)

jigg-spec/            # Git submodule — canonical .jigg format types
docs/                 # Documentation
```

The spec submodule (`jigg-spec/`) defines the serialisable types that cross the persistence boundary. Runtime extensions to those types live in `src/puzzle/types.ts`. See `spec-integration.md` for the import alias and the boundary rules.

---

*For runtime invariants and contracts: `engine-conventions.md`*  
*For implementation mechanics: `drag-and-drop.md`, `snap-detection.md`, `wasm-pipeline.md`*  
*For architectural trade-offs: `decisions.md`*
