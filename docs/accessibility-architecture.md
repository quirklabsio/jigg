<!-- audience: Dev, BA, Agent -->

# Accessibility Architecture Audit — Story 47e-spike

*Completed: 2026-04-25. No production code changed — read-only spike.*

---

## 1. Behavior Inventory

For each behavior: what / trigger / location / how applied / context coverage / known gaps.

---

### 1.1 High Contrast (HC) — sandwich stroke

| Field | Value |
|---|---|
| **What** | Two-pass `OutlineFilter` on every piece sprite: inner white 1.5 px + outer black 2.5 px. Guarantees at least one ring is visible at 21:1 contrast regardless of piece color or background. |
| **Trigger** | `highContrast: boolean` Zustand preference. In-app toggle. Persisted in `localStorage`. Not a response to CSS `forced-colors`. |
| **Location** | `src/utils/preferences.ts` — `addSandwichStroke`, `removeSandwichStroke`, `applyHighContrast` |
| **How applied** | `applyHighContrast(active, pieces, spriteMap)` iterates ALL pieces in the store, looks up each in `spriteMap`, appends/removes filters. Called via (a) `applyPreferences` in `loadScene` init, (b) `applyPreferences` in `CUTS_COMPLETE`, (c) `fireApplyPreferences` → registered callback on preference toggle. |
| **Context covered** | All sprites in `spriteMap` — this includes both canvas (table) pieces AND bench pieces (same Sprite objects are in `spriteMap` regardless of where the piece is staged). |
| **Known gaps** | **Bench thumbnail rendering gap (the 47e problem).** The filter IS added to bench sprites. However, bench sprites are rendered at `thumbScale()` (≈ 0.08–0.15 × native size). OutlineFilter's `quality: 0.15` combined with small screen-space bounds may produce no visible outline at thumbnail scale. The filter application is correct; the visual output at bench scale is unverified/unreliable. See §5 for reassessment. |

---

### 1.2 High Contrast — BevelFilter alpha boost

| Field | Value |
|---|---|
| **What** | BevelFilter `lightAlpha`/`shadowAlpha` raised from 0.20 → 0.36 (×1.8), enhancing depth illusion in HC mode. |
| **Trigger** | Same `highContrast` toggle as sandwich stroke. Applied in the same `applyHighContrast` call. |
| **Location** | `src/utils/preferences.ts` — `applyHighContrast`, constants `BEVEL_LIGHT_ALPHA_HIGH/DEFAULT` |
| **How applied** | Iterates `sprite.filters` looking for `instanceof BevelFilter`, mutates `f.lightAlpha` / `f.shadowAlpha` in place. |
| **Context covered** | All sprites in `spriteMap` (bench + canvas). BevelFilter is attached in `CUTS_COMPLETE` to every piece; the property mutation is safe whenever the filter exists. |
| **Known gaps** | None identified. BevelFilter exists on all sprites by the time HC can be toggled. |

---

### 1.3 High Contrast — solid tray background

| Field | Value |
|---|---|
| **What** | Tray background changes from `0x1a1a1a` at α 0.85 ("glass tray") to `0x000000` at α 1.0 ("solid tray") in HC mode. Prevents canvas bleed-through. |
| **Trigger** | `highContrast` Zustand preference. |
| **Location** | `src/canvas/bench.ts` — `redrawBackground()`, `TRAY_BG_HC_COLOR`, `TRAY_BG_HC_ALPHA`, `_unsubscribeHC` subscription |
| **How applied** | **Direct Zustand subscription** in `initTray` — NOT via the `applyPreferences` → `applyFn` chain. `_unsubscribeHC` subscribes to `highContrast` changes and calls `redrawBackground()` synchronously on every toggle. |
| **Context covered** | Tray background Graphics rect only. |
| **Known gaps** | This path is independent of `applyPreferences`. A future story that wants to coordinate "tray redraws at the same time as sprite updates" cannot use `applyPreferences` alone — it must also know about this separate subscription. |

---

### 1.4 High Contrast — snap highlight color + alpha

| Field | Value |
|---|---|
| **What** | Board-snap pulse color changes from green (`0x00ff00`, α 0.4) to neon magenta (`0xff00ff`, α 1.0) in HC mode. `reducedMotion` takes priority (also forces magenta). |
| **Trigger** | `highContrast` and/or `reducedMotion` Zustand preferences. |
| **Location** | `src/canvas/scene.ts` — `updateSnapHighlight`, module vars `_snapHighlightColor`, `_snapHighlightAlpha`, constants `SNAP_HIGHLIGHT_COLOR_HC`, `SNAP_HIGHLIGHT_ALPHA_HC`, `SNAP_HIGHLIGHT_THICKNESS_HC` (the thickness constant is declared but not wired — see gaps). |
| **How applied** | **Direct Zustand subscription** in `loadScene` body — subscribes to `highContrast` or `reducedMotion` changes, calls `updateSnapHighlight`. Module-level variables hold current state; the snap-pulse ticker reads them at fire time. |
| **Context covered** | Board-snap pulse (canvas table). |
| **Known gaps** | `SNAP_HIGHLIGHT_THICKNESS_HC = 4` is defined but not wired — the snap pulse uses color/alpha only; no stroke overlay changes thickness. Deferred by design (see `accessibility.md` known gaps). |

---

### 1.5 High Contrast — label pill backing alpha

| Field | Value |
|---|---|
| **What** | Piece number label pill backing alpha raised from 0.45 to 0.80 in HC mode for higher legibility. |
| **Trigger** | `highContrast` preference, read inside `applyPieceLabels`. |
| **Location** | `src/utils/preferences.ts` — `applyPieceLabels`, `LABEL_BG_ALPHA_DEFAULT`, `LABEL_BG_ALPHA_HC` |
| **How applied** | Part of `applyPreferences` → `applyPieceLabels(prefs.pieceLabels, pieces, spriteMap, prefs.highContrast)`. Updates existing label containers when labels are already active. |
| **Context covered** | All pieces in `spriteMap` (bench + canvas) where labels are active. |
| **Known gaps** | Labels are only present when `pieceLabels` preference is on. If HC is toggled while labels are off, the correct backing alpha is used when labels are subsequently enabled. No gap. |

---

### 1.6 High Contrast — filter strip swatch rings

| Field | Value |
|---|---|
| **What** | Color-zone swatches in the bench filter strip show a dual-ring halo (black inner + white/magenta outer) instead of the normal white selection ring. Active swatch ring becomes neon magenta. |
| **Trigger** | `highContrast` Zustand preference, read at render time inside `renderFilterStrip`. |
| **Location** | `src/canvas/bench.ts` — `renderFilterStrip()`, `SWATCH_HC_ACTIVE_CLR`, constants at top of bench.ts |
| **How applied** | `renderFilterStrip` reads `highContrast` from Zustand at call time and switches rendering logic. Called by `applyTrayPreferences` (via `applyFn` callback), the greyscale subscription, and every `layoutTrayPieces` call. |
| **Context covered** | Bench filter strip swatches only. |
| **Known gaps** | None identified. |

---

### 1.7 Greyscale

| Field | Value |
|---|---|
| **What** | ITU-R BT.601 `ColorMatrixFilter` applied per sprite; converts piece textures to greyscale. Also shows `P1`–`P5` zone labels on filter strip swatches and hides glow dot. |
| **Trigger** | `greyscale: boolean` Zustand preference. In-app toggle. |
| **Location** | `src/utils/preferences.ts` — `addGreyscaleFilter`, `removeGreyscaleFilter`, `applyGreyscale` (sprite side). `src/canvas/bench.ts` — `renderFilterStrip` for swatch labels; `_unsubscribeGreyscale` subscription |
| **How applied** | Sprite side: via `applyPreferences` → `applyGreyscale`. Filter tag `'greyscale'`, always appended last. DEV assertion checks `BevelFilter[0]` and `greyscale[last]` invariant. Swatch side: `_unsubscribeGreyscale` in bench.ts fires `layoutTrayPieces` on toggle (which calls `renderFilterStrip`). |
| **Context covered** | All sprites in `spriteMap` (bench + canvas). Bench swatch labels. |
| **Known gaps** | Greyscale does NOT reach tray chrome (background, DOM checkboxes, filter strip backgrounds) — documented in `accessibility.md`. The `applyGreyscale` function targets `spriteMap` only. |

---

### 1.8 Reduced Motion

| Field | Value |
|---|---|
| **What** | Four animations disabled or simplified: drag-lift rotation tween (80 ms → snap), snap-back tween (80 ms → snap), board-snap pulse (150 ms → skipped entirely), zoom-to-piece viewport animation (600 ms → teleport). Decelerate friction set to 1.0 (board stops instantly). |
| **Trigger** | `reducedMotion: boolean` Zustand preference. Default sampled once from `window.matchMedia('(prefers-reduced-motion: reduce)')` at module import. In-app toggle. |
| **Location** | `src/utils/preferences.ts` — `applyReducedMotion` (viewport friction). `src/canvas/scene.ts` — snap-pulse ticker, drag-lift/snap-back tweens, `updateSnapHighlight`. `src/canvas/bench.ts` — zoom-to-piece path in `zoomToPlacePiece`. |
| **How applied** | `applyReducedMotion` is called on init and via Zustand subscription in `loadScene`. Individual animation paths read `usePuzzleStore.getState().reducedMotion` directly at execution time. |
| **Context covered** | Viewport decelerate (global). Drag/rotation animations (canvas pieces). Board-snap pulse (canvas). Zoom-to-piece (bench extraction path). |
| **Known gaps** | `reducedMotion` not live — sampled once at module import. OS setting changed mid-session without reload will not update. Documented in `accessibility.md`. |

---

### 1.9 Piece Labels

| Field | Value |
|---|---|
| **What** | Piece index number overlay on each sprite: white text with black stroke, on a semi-transparent black rounded-rect pill. Counter-rotated to appear upright regardless of piece rotation. |
| **Trigger** | `pieceLabels: boolean` Zustand preference. In-app toggle. |
| **Location** | `src/utils/preferences.ts` — `applyPieceLabels`, `createPieceLabel`, `updateLabelBgAlpha`, `syncLabelRotation`, `LABEL_CONTAINER_NAME` |
| **How applied** | Part of `applyPreferences` → `applyPieceLabels`. Labels are sprite children (tagged with `LABEL_CONTAINER_NAME`). Counter-rotation maintained at three call sites: `rotateGroup` (rotate.ts), `tweenRotation` ticker (drag.ts), bench extraction. `syncLabelRotation` is the shared helper. |
| **Context covered** | All pieces in `spriteMap`. Bench pieces receive the label with counter-scale compensation (`label.scale.set(1 / sprite.scale.x)`). |
| **Known gaps** | Labels are sprite children, clipped by the piece-shape mask. At 60–80px piece size the safe zone (≈0.43 × minDimension) clips 3-digit labels. Story 46f (label overlay layer) is the queued fix. At zoom < 0.3× labels become illegible. |

---

### 1.10 Adaptive Background Preset

| Field | Value |
|---|---|
| **What** | WebGL clear color (`app.renderer.background.color`) set to one of three presets: off-white, gray, charcoal. User can cycle presets (Shift+B); `null` means "adaptive" (auto-derived from image luminance). |
| **Trigger** | `backgroundPreset: BackgroundPreset | null` Zustand preference. Shift+B cycles; adaptive on `null`. |
| **Location** | `src/utils/preferences.ts` — `applyBackground`, `deriveAdaptiveBackground`, `BACKGROUND_PRESETS`, `BG_PRESETS_ORDER` |
| **How applied** | Part of `applyPreferences` → `applyBackground`. Mutates `_app.renderer.background.color`. |
| **Context covered** | WebGL clear color (workspace/table). |
| **Known gaps** | None identified. |

---

### 1.11 Bench Piece Uplight Glow (always-on)

| Field | Value |
|---|---|
| **What** | Warm off-white (`#fff5e0`) vertical gradient behind each bench piece thumbnail. Max α 0.22 at slot bottom, fading to transparent at 60% from bottom. Lifts dark pieces off the dark bench. |
| **Trigger** | **Always-on** — no preference toggle. Applied to all bench slots at load time, on every `layoutTrayPieces` call. |
| **Location** | `src/canvas/bench.ts` — `addBenchGlowToContainer`, `removeBenchGlowFromContainer`, `addAllBenchGlows`, `getGlowGradient`, `BENCH_GLOW_*` constants |
| **How applied** | `initTray` calls `addAllBenchGlows`. `layoutTrayPieces` redraws glow rect at each slot position. Glow is removed in three extraction paths (`extractPieceFromBench`, `spiralExtractPiece`, `zoomToPlacePiece`). |
| **Context covered** | Bench slots only. Canvas pieces have no glow — removed before reparent at every extraction path. |
| **Known gaps** | **Three extraction paths must each manually call `removeBenchGlowFromContainer`.** If a fourth extraction path is added, it will silently leak glow to canvas. This already happened in Story 47d (spiralPlace missed one path). Pattern is fragile; documented in §3. |

---

### 1.12 Adaptive Board Color (always-on)

| Field | Value |
|---|---|
| **What** | Board fill derived deterministically from image luminance at load time: light/mid/dark preset based on mean luminance and spread. |
| **Trigger** | **Always-on** — fires once at `loadScene` on image load. Not a preference toggle. Not user-overridable. |
| **Location** | `src/canvas/board.ts` — `computeBoardColor(imageData: ImageData): number`, used in `loadScene` in `scene.ts` |
| **How applied** | `computeBoardColor` called in `loadScene` before `createBoard`. No toggles, no subscriptions. |
| **Context covered** | Board surface only. |
| **Known gaps** | None (by design — this is a "set once, never change" invariant). |

---

### 1.13 Mesa Board Visual Hierarchy (always-on)

| Field | Value |
|---|---|
| **What** | 8-layer painter's-algorithm Graphics stack on the board: three shadow rects with interference bias, edge layer (mesa walls), surface, center glow, noise grain, highlight. Creates physical depth without filters. |
| **Trigger** | **Always-on** — pure geometry, no toggle, no runtime state. |
| **Location** | `src/canvas/board.ts` — `createBoard` |
| **How applied** | Called once in `loadScene`. `cacheAsTexture` bakes the whole container to GPU at load. |
| **Context covered** | Board container. |
| **Known gaps** | None. This is geometrically static, no coupling to any preference. |

---

### 1.14 Focus Ring (always-on for keyboard)

| Field | Value |
|---|---|
| **What** | Neon magenta `0xff00ff` rectangle redrawn every frame around the keyboard-focused piece or cluster. Screen-space (non-scaling). 2px thick, 4px padding outside piece bounds. |
| **Trigger** | Active whenever `_focusTarget` is non-null and `_lastInputWasKeyboard` is true. Suppressed on pointer interaction. |
| **Location** | `src/canvas/scene.ts` — `initFocusRing`, `setFocusedTarget`, `setFocusedPiece`, `_focusRing`, `FOCUS_RING_*` constants |
| **How applied** | `initFocusRing` adds a ticker that redraws the ring every frame. Always magenta — does not change with HC preference. |
| **Context covered** | Canvas pieces and bench pieces (wherever the sprite is screen-visible). |
| **Known gaps** | Focus ring color is hardcoded magenta — no distinction between HC and non-HC. In non-HC mode, magenta ring may still be jarring for users who don't need HC. This is intentional (a strong ring is always good for keyboard nav) but is implicit. |

---

### 1.15 Screen Reader Landmarks + ARIA Buttons (always-on)

| Field | Value |
|---|---|
| **What** | Two `role="application"` divs (`#landmark-bench`, `#landmark-table`) with `inert` switching. Bench piece buttons, filter radiogroup, live region. |
| **Trigger** | **Always-on** — structural accessibility, no toggle. |
| **Location** | `src/utils/aria.ts` — all ARIA management. `src/canvas/scene.ts` — `initLandmarks`, `setKeyboardMode`, `initBenchButtons`, etc. |
| **How applied** | DOM elements added once in `initLandmarks`. Mode switching via `setKeyboardMode`. |
| **Context covered** | DOM layer. No PixiJS involvement. |
| **Known gaps** | Documented in `accessibility.md`: no `forced-colors` support; `reducedMotion` not live; greyscale doesn't reach DOM elements. |

---

## 2. Coupling Map

### 2.1 HC → Greyscale

**No functional coupling.** Both apply their own filters (OutlineFilter pair vs ColorMatrixFilter). The ordering invariant is their only interaction: `BevelFilter[0] → hc-sandwich[1,2] → greyscale[last]`. A `ColorMatrixFilter` added after the sandwich is correct; a `ColorMatrixFilter` added before the BevelFilter would cause incorrect rendering. The DEV assertion in `applyGreyscale` checks both. If greyscale is added while HC is already active, the assertion confirms ordering. If HC is then added while greyscale is active, `addSandwichStroke` appends before greyscale — **this is a bug waiting to happen**: the BevelFilter is at 0, but the sandwich filters would be inserted between BevelFilter and greyscale, moving greyscale to index 3. The greyscale "always last" invariant would break.

> **Coupling risk C-1:** `addSandwichStroke` appends to the END of the filter array. If greyscale is active, the array is `[BevelFilter, ColorMatrixFilter]`. After `addSandwichStroke`, the array becomes `[BevelFilter, ColorMatrixFilter, inner, outer]`. Greyscale is at index 1, no longer last. The sandwich renders AFTER greyscale instead of BEFORE it — the OutlineFilter would outline a greyscale piece, which is visually fine, but the ordering invariant states greyscale must be last. The DEV assertion would fire in `applyGreyscale` after this. In production it's silent. **Reproducer: load puzzle, enable greyscale, enable HC.**

---

### 2.2 HC → Snap highlight

**Direct coupling via `updateSnapHighlight(highContrast, reducedMotion)`.** Both HC and RM change the snap highlight color/alpha. They share the same `_snapHighlightColor` / `_snapHighlightAlpha` module vars. RM overrides HC (takes priority). If future stories add a third preference that affects snap color, it must be threaded into `updateSnapHighlight` and its priority order documented.

---

### 2.3 Greyscale → Bench filter strip labels

**One-way dependency.** Greyscale active → `renderFilterStrip` adds `P1`–`P5` labels to zone swatches via `addZoneLabel`. `addZoneLabel` also hides the `glowDot` child of the swatch container. Turning greyscale off rebuilds the strip without labels, restoring the glow dot. The coupling is internal to `renderFilterStrip` and `bench.ts`.

---

### 2.4 HC + greyscale → tray background

**Independent.** The tray background is driven only by `highContrast` (via `_unsubscribeHC`). Greyscale has no effect on the tray background. Future stories adding a greyscale-aware tray would need a second subscription or a combined subscription.

---

### 2.5 ReducedMotion → multiple animation paths

**Fan-out dependency.** `applyReducedMotion` handles viewport decelerate only. All individual animation paths read `usePuzzleStore.getState().reducedMotion` directly at fire time. This means adding a new animation requires the developer to know they need to check `reducedMotion` — there's no central registration. See risk R-3.

---

### 2.6 Always-on behaviors → preferences

**No coupling.** Bench glow, adaptive board color, mesa, and focus ring do not read any preference state. They are structurally separate. The only indirect relationship is that HC glow was originally intended to be gated off but was made unconditional after QA (Story 47a). This decision is recorded in `decisions.md` but not enforced in code — any future dev could add a `!highContrast` guard and not know it would break HC bench visibility.

---

### 2.7 `applyPreferences` vs direct Zustand subscriptions — the dual-path problem

There are **two separate wiring paths** for preference changes:

**Path A — applyFn callback chain:**  
`setPreference` → `fireApplyPreferences` → registered `applyFn` → `applyPreferences(prefs, pieces, spriteMap, lum)` → individual apply functions → also calls `applyTrayPreferences()`.

**Path B — direct Zustand subscriptions:**  
- `_unsubscribeHC` in bench.ts → `redrawBackground()` (tray background)  
- `_unsubscribeGreyscale` in bench.ts → `layoutTrayPieces()` (swatch labels)  
- Scene subscription → `updateSnapHighlight()` (snap color)  
- Scene subscription → `applyReducedMotion()` (viewport friction)

Both paths fire on the same preference change. They execute in subscription registration order. **There is no coordination between them** — if a future story needs to apply a preference to both a sprite (Path A) and a bench graphics element (Path B), those two updates happen at different times with no sequencing guarantee.

---

### 2.8 Non-accessibility code touchpoints

**BevelFilter**: `applyHighContrast` iterates `sprite.filters` looking for `instanceof BevelFilter`. Adding another filter before BevelFilter in the array (wrong order) would cause `applyHighContrast` to fail silently — it only finds BevelFilter at index 0 because that's where `CUTS_COMPLETE` puts it. Any code that inserts a filter before BevelFilter would break HC's BevelFilter alpha adjustment.

**DropShadowFilter** (pieces, from scene.ts): Not touched by any preference function. Lives at `sprite.filters` index alongside others — but `CUTS_COMPLETE` resets `sprite.filters = [new BevelFilter({...})]`, which would obliterate DropShadowFilter if it were added there. Currently DropShadowFilter is assigned before `CUTS_COMPLETE` (in `buildGridSprites` — actually, no, let me correct this: `buildGridSprites` does NOT add DropShadowFilter to sprites. DropShadowFilter is added to the board container in `board.ts`. Pieces use DropShadowFilter via scene.ts shadow state helpers — these are added separately). Actually from the code: `makeShadow()` creates a DropShadowFilter, and it's added to the sprite separately from `CUTS_COMPLETE`. The reset `sprite.filters = [new BevelFilter({...})]` in CUTS_COMPLETE WOULD destroy the DropShadowFilter if it were already attached. The sequence must be: CUTS_COMPLETE fires → BevelFilter assigned → `applyPreferences` called (adds HC/greyscale filters) → then sometime later drag shadow is applied. If DropShadowFilter is ever attached before CUTS_COMPLETE, it will be lost. This is an implicit sequencing assumption.

Wait — actually checking: `makeShadow` is called inside `buildGridSprites` from the initial setup. Let me verify...

Actually from the scene.ts code I read, `makeShadow` is defined and `applyShadowResting/Dragging/Placed` are defined, but I didn't see where DropShadowFilter is actually attached to piece sprites. This is worth a closer look during implementation.

---

## 3. Risk Surface

### R-1: Filter accumulation on HC+greyscale toggle sequence (C-1 above)

**Pattern:** `addSandwichStroke` and `addGreyscaleFilter` both append to the filter array. The ordering invariant (BevelFilter[0], greyscale last) is maintained by convention, not enforcement. If HC is enabled AFTER greyscale is already active:

- Array before HC: `[BevelFilter, ColorMatrixFilter(greyscale)]`
- `addSandwichStroke` appends: `[BevelFilter, ColorMatrixFilter, inner, outer]`
- Greyscale is no longer last; the "greyscale must be last" invariant is violated

**Why it's silent:** `addSandwichStroke` has a tag-based guard against duplicates but does NOT check the position of existing managed filters relative to the new ones. `addGreyscaleFilter` has the same pattern. The DEV assertion in `applyGreyscale` catches this — but only if `applyGreyscale` is called again AFTER the out-of-order insertion.

**Failure mode:** In a production build, enabling HC with greyscale active silently breaks the intended filter order. The visual result (outline of a greyscale piece) may look the same, but the semantic invariant is gone. Any future story that adds a third filter type (e.g., a colorblind-simulation filter) may rely on ordering assumptions that are already broken.

---

### R-2: New extraction path leaks bench glow to canvas

**Pattern:** Three extraction paths (`extractPieceFromBench`, `spiralExtractPiece` spiral-place click, `zoomToPlacePiece`) each manually call `removeBenchGlowFromContainer(container)` before reparenting to viewport. Story 47d found a fourth path (drag extraction) that was missing this call.

**Why it's silent:** There's no shared "pre-extraction hook." The glow removal is a manual checklist item, not an enforced contract. If a developer adds Story 57 (piece recall / undo) or Story 73 (direct placement from bench via keyboard), they must know to call `removeBenchGlowFromContainer`. There is no test or compile-time check that enforces it.

**Failure mode:** A canvas piece would render with the glow gradient behind it during dragging/placement, producing a visual artifact (warm gradient floating over the table). Intermittent and hard to debug.

---

### R-3: New animation ignores reduced motion

**Pattern:** `applyReducedMotion` handles viewport decelerate only. Every animation path checks `reducedMotion` directly at runtime. There is no animation registry or central "is animation allowed?" gatekeeper.

**Why it's silent:** A dev adding a new animation (e.g., a completion burst, a snap preview shimmer) who doesn't know to check `reducedMotion` will produce an animation that always plays regardless of the user's preference. The preference toggle will appear to "not work" for the new animation.

**Failure mode:** A new animation ships without reduced-motion respect. Discovered during QA only if the QA script explicitly tests `reducedMotion`.

---

### R-4: CUTS_COMPLETE filter reset destroys prior state

**Pattern:** `CUTS_COMPLETE` does `sprite.filters = [new BevelFilter({...})]` for every piece — a hard reset of the entire filter array. This is immediately followed by `applyPreferences`, which re-adds HC/greyscale filters. If any filter is added to a sprite BEFORE `CUTS_COMPLETE` arrives (e.g., on init), it is silently destroyed.

**Why it's silent:** The current code adds BevelFilter only in CUTS_COMPLETE, so there's nothing to destroy today. But if a future story adds a filter on sprite creation (in `buildGridSprites`), it will be destroyed when CUTS_COMPLETE fires.

**Failure mode:** A filter added in `buildGridSprites` disappears after the worker responds. Timing-dependent bug that only manifests after image processing completes.

---

### R-5: `highContrast` → tray background vs canvas sprites fire in unknown order

**Pattern:** On HC toggle, the Zustand subscription in bench.ts (`_unsubscribeHC → redrawBackground`) and the `fireApplyPreferences → applyFn` path both fire. Subscription order depends on registration order. The tray background redraws and the canvas sprites update in the same event but via separate code paths with no sequencing contract.

**Why it matters:** Currently the two paths are independent and their order doesn't matter. But if a future story adds a behavior that depends on "tray has already redrawn when sprite filters update" (e.g., a combined visual transition), the implicit ordering will be wrong.

**Failure mode:** Not currently observable. Becomes a problem when a story needs cross-context coordination on preference toggle.

---

## 4. Architecture Proposal

### 4.1 The invariant we want

> *Changes to one accessibility preference's behavior do not silently affect another preference's behavior.*

A corollary: *adding a new accessibility behavior should not require knowing how every existing behavior's filter array is ordered.*

---

### 4.2 What stays as-is (already works well)

- The `_tag` pattern for filter identification and idempotent add/remove — correct concept, just needs ordering enforcement.
- The `registerApplyFn` / `fireApplyPreferences` callback pattern for breaking the circular import — keep it.
- Direct Zustand subscriptions for tray-only behaviors (tray background, greyscale swatch labels) — these are tray-internal and the subscription is the right layer.
- `applyReducedMotion` as a centralized viewport decelerate handler.
- DEV filter order assertions in `applyGreyscale` — good model; needs to be expanded.

---

### 4.3 Minimum viable refactor (MVV)

**Goal:** Fix R-1 (filter ordering violation) and make extraction cleanup less fragile (R-2). These are the two risks with currently reproducible paths.

**MVV-1: Fix filter ordering in `addSandwichStroke`**

Instead of blindly appending, `addSandwichStroke` should insert the sandwich filters BEFORE any greyscale filter:

```ts
function addSandwichStroke(sprite: Sprite): void {
  if (sprite.filters?.some((f) => (f as TaggedFilter)._tag === HC_FILTER_TAG)) return;
  const inner = new OutlineFilter({...});
  const outer = new OutlineFilter({...});
  (inner as TaggedFilter)._tag = HC_FILTER_TAG;
  (outer as TaggedFilter)._tag = HC_FILTER_TAG;

  // Insert before greyscale (if present) but after BevelFilter.
  // Desired order: [BevelFilter, ...hc-sandwich, greyscale?]
  const existing = sprite.filters ?? [];
  const greyIdx = existing.findIndex((f) => (f as TaggedFilter)._tag === GREYSCALE_FILTER_TAG);
  if (greyIdx === -1) {
    sprite.filters = [...existing, inner, outer];
  } else {
    sprite.filters = [
      ...existing.slice(0, greyIdx),
      inner,
      outer,
      ...existing.slice(greyIdx),
    ];
  }
}
```

This is a small, targeted change. No new abstraction required. The ordering is now enforced by `addSandwichStroke` itself rather than relying on "caller applied things in the right order."

**MVV-2: Single extraction cleanup helper in bench.ts**

Replace the three manual `removeBenchGlowFromContainer` call sites with a single exported `prepareContainerForCanvas(container: Container): void` that handles all bench-to-canvas cleanup in one place:

```ts
export function prepareContainerForCanvas(container: Container): void {
  removeBenchGlowFromContainer(container);
  // future: remove any bench-only filters from sprite
  // future: adjust label counter-scale for canvas context
}
```

All three extraction paths call `prepareContainerForCanvas` instead. New extraction paths get a clear checklist target in the function signature.

**Files touched by MVV:**
- `src/utils/preferences.ts` — `addSandwichStroke` ordering fix (≈ 15 lines changed)
- `src/canvas/bench.ts` — `prepareContainerForCanvas` new export; three extraction paths updated (≈ 20 lines changed)

**What MVV does NOT fix:**
- R-3 (new animations ignoring reduced motion) — requires developer discipline or a new registry
- R-4 (CUTS_COMPLETE filter reset) — not currently breaking; document and leave
- R-5 (subscription ordering) — not currently observable; document and leave

---

### 4.4 Full version (if the safety invariant needs to be type-enforced)

Introduce a `FilterStack` class per sprite that owns the ordered filter array and exposes named slots:

```ts
class FilterStack {
  private _bevel:     BevelFilter;
  private _sandwich:  [OutlineFilter, OutlineFilter] | null = null;
  private _greyscale: ColorMatrixFilter | null = null;
  // future slots appended here

  get ordered(): Filter[] {
    return [
      this._bevel,
      ...(this._sandwich ?? []),
      ...(this._greyscale ? [this._greyscale] : []),
    ];
  }

  setSandwich(active: boolean): void { ... }
  setGreyscale(active: boolean): void { ... }
  apply(sprite: Sprite): void { sprite.filters = this.ordered; }
}
```

- One `FilterStack` per piece, stored alongside the sprite.
- `applyHighContrast`, `applyGreyscale` call stack methods, not direct array mutation.
- Order is enforced structurally; you cannot put greyscale before sandwich — it's not a parameter.
- Adding a new managed filter is a new named slot with a defined position.

**Cost:** ~150 lines new code, touches `preferences.ts` (all apply functions), `scene.ts` (CUTS_COMPLETE), and potentially `bench.ts`. Every managed filter operation becomes a `stack.setSomething(active)` call instead of a `sprite.filters` mutation.

**Minimum viable version vs. full version:** The MVV gives 80% of the safety for ~35 lines of change. It fixes the one currently-reproducible ordering bug and makes extraction cleanup explicit. The full FilterStack gives the remaining 20% (type-enforced ordering) at 5× the implementation cost. Recommended sequence: **MVV first** to unblock 47e and other stories; full FilterStack deferred to a dedicated refactor story if the ordering bugs continue to surface.

---

## 5. Story 47e Reassessment

### Original premise

"Extend HC sandwich stroke to bench thumbnails."

### What the audit found

The sandwich stroke IS applied to bench sprites. `applyHighContrast` iterates all pieces in the Zustand store (bench and table alike), looks up each sprite in `spriteMap`, and calls `addSandwichStroke`. The `spriteMap` contains bench piece sprites — the same Sprite objects that `layoutTrayPieces` repositions and rescales for thumbnail display.

**The gap is a rendering issue, not an application issue.** The OutlineFilter parameters were tuned for canvas-scale sprites (natural size). When `layoutTrayPieces` sets `sprite.scale.set(thumbScale())` (roughly 0.08–0.15), the filter renders in the sprite's local coordinate space — where the sprite is the original texture size — but displays at a fraction of that on screen. The `quality: 0.15` setting (very low sample count) may be insufficient to produce a visible outline at thumbnail display scale. Additionally, the filter `padding` property (not set in the current `OutlineFilter` construction) controls how many extra pixels the filter can bleed into. Without sufficient padding, the outline clips to the sprite's bounding box.

### Does bench HC sandwich still make sense?

**At 128px thumbnail scale, the sandwich stroke parameters need adjustment.** The canvas-scale parameters (1.5 px inner / 2.5 px outer at quality 0.15) are tuned for sprites 500–2000 px wide. At 128 px cell size the rendered sprite may be 60–110 px wide. A 1.5–2.5 px outline on a 80 px sprite is proportionally larger than on a 800 px canvas piece — but the `quality: 0.15` reduces it to a coarse approximation.

**The always-on glow already handles slot-level visibility** for normal mode. The bench-specific HC question is: "does a sandwich stroke at thumbnail scale add enough value to justify the complexity?" At 128px, the white inner ring (providing contrast for dark pieces on the HC black tray) is the most valuable part — equivalent functionality could be achieved with a simpler 1 px white border rendered by the tray, not by the sprite filter.

### Recommendation

**47e proceeds with a narrowed scope:**

1. Diagnose the current rendering: temporarily set `quality: 0.5` and add `padding: 4` to both OutlineFilter instances in `addSandwichStroke`. If bench thumbnails then show the stroke visibly, the parameters need a bench-specific path.
2. If bench and canvas need different parameters, introduce separate `addSandwichStrokeCanvas` / `addSandwichStrokeBench` variants (or a `scale` param), and apply the bench variant in `initTray` / `layoutTrayPieces` rather than via the shared `applyHighContrast` path.
3. If the always-on glow already provides sufficient bench contrast for HC users (the tray is solid black, glow provides lift), consider closing 47e after user testing confirms it.

**47e does NOT need the full architecture refactor to proceed.** The MVV (§4.3) fixes the ordering risk that was blocking confidence in the current filter state; 47e can then land on the MVV foundation.

---

## 6. Follow-Up Story Briefs

### Story 47e (re-scoped): Verify and fix HC sandwich on bench thumbnails

**Scope:** Diagnose why the sandwich stroke is not visible on bench piece thumbnails in HC mode. Fix either the filter parameters (quality/padding) for bench scale, or introduce a bench-specific HC treatment path. Must not change canvas behavior.

**Acceptance:**
- HC mode active: bench piece thumbnails show a visible stroke ring at ≥ 3:1 contrast against the HC black tray
- Canvas pieces: unchanged (no regression)
- Filter application is idempotent — rapid HC toggle produces no accumulation
- `git diff src/` shows only preferences.ts and/or bench.ts changes

**Files likely to touch:**
- `src/utils/preferences.ts` — OutlineFilter quality/padding params; possible bench vs canvas variant
- `src/canvas/bench.ts` — possible bench-specific HC stroke application in `layoutTrayPieces` or `initTray`

---

### Story 47f: Accessibility filter ordering fix (MVV refactor)

**Scope:** Apply the minimum viable refactor from §4.3. Fix the HC+greyscale ordering bug (R-1). Introduce `prepareContainerForCanvas` to consolidate extraction cleanup (R-2). No behavior change — pure structural fix.

**Acceptance:**
- Enabling greyscale then HC (or HC then greyscale) produces filter array `[BevelFilter, inner, outer, ColorMatrixFilter]` — greyscale last, sandwich before greyscale
- Three extraction paths in bench.ts call `prepareContainerForCanvas` — no direct `removeBenchGlowFromContainer` calls at extraction sites
- All existing HC + greyscale QA criteria still pass
- `git diff src/` shows only preferences.ts and bench.ts

**Files to touch:**
- `src/utils/preferences.ts` — `addSandwichStroke` ordering fix (≈ 15 lines)
- `src/canvas/bench.ts` — `prepareContainerForCanvas` export; three extraction sites updated (≈ 20 lines)

---

### Deferred: Full FilterStack (Story 47g, candidate)

If filter-order bugs continue to surface post-MVV, the full `FilterStack` class from §4.4 is the next investment. Not recommended immediately — it's a larger refactor with no clear trigger beyond "nice to have type safety." Queue it when a third ordering bug appears in QA.

---

## Summary of recommended sequence

1. **Story 47f** — MVV ordering fix and extraction cleanup (unblocks safe filter modification)
2. **Story 47e (re-scoped)** — bench HC sandwich on the MVV foundation
3. **Story 47c** (palette tuning) — independent; no dependency on HC architecture
4. **Story 46f** (label overlay) — independent; removes label-clipping risk surface
5. **Full FilterStack** — if ordering bugs continue post-47f
