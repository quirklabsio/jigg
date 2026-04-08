# Stories

Append-only. When a story closes, session notes are added here and the story is marked `[x]` in `docs/roadmap.md`. Never edited retroactively.

---

## Shipped

### Epic: Core Pipeline
- [x] Story 1: WASM pipeline proof of life
- [x] Story 2: PixiJS canvas init + image load
- [x] Story 3: Connect WASM output to PixiJS canvas

### Epic: Core Puzzle Loop
- [x] Story 4: Grid cut — divide image into NxN sprites
- [x] Story 5: Scatter pieces on load
- [x] Story 6: Drag and drop a piece
- [x] Story 7: Refactor to group model (PieceGroup, drag moves group)
- [x] Story 8: Rotate a piece/group (double-tap, 90° increments)
- [x] Story 9: Piece-to-piece snap (merge groups on compatible edge proximity)
- [x] Story 10: Board border + slot grid overlay
- [x] Story 11: Board snap (group snaps to correct world position)
- [x] Story 12: Detect puzzle completion

### Epic: Smart Cutting
- [x] Story 13: Edge detection in WASM → visualize overlay
- [x] Story 14: Bezier cut generation from edge map
- [x] Story 15: Content-aware cut routing (follows contours)

### Epic: Piece Fidelity
- [x] Story 16: Bevel shader on cut edges
- [x] Story 17: Surface texture variants (matte/glossy/canvas/wood)
- [x] Story 18: Soft shadows relative to light source
- [x] Story 18b: Visual foundation reset

### Epic: Workspace
- [x] Story 20: Infinite canvas + zoom with inertia

**Story 19 — deferred.** Z-order revisited post-launch, informed by tray layering.

---

## Session Notes

### Story 38 (2026-04-07)

Keyboard focus spike. No source files modified. Output: `docs/spike-keyboard-focus.md`.

Seven questions answered: ARIA landmark structure (`role="application"` × 2 — "Piece tray" DOM-first, "Puzzle board" second); virtualisation (Approach A full DOM ≤200 pieces, board element count self-reduces as groups form); focus ring (screen-space `Graphics` on `app.stage` topmost, `viewport.toGlobal()` each frame, 2px neon magenta `0xff00ff`, wraps group AABB); tab order at tray→board boundary (direct DOM-order, no intermediary); key bindings (Space `preventDefault()`, R = rotate canvas-only, T/Shift+B safe in `role="application"`); ARIA label format (`"Piece {index} — Zone {N}, row X, column Y, {state}"`); group model (group = one tab stop, primary piece = lowest `piece.index`).

Refinements during spike review: stage layer order explicit (`viewport → trayContainer → focusRing`); zone included in ARIA label to bridge visual/greyscale/auditory identification systems; filter focus-drop prevention documented as critical (move focus before `tabIndex="-1"`, not after); arrow-key collision decision (no snap mid-movement, evaluate on put-down); Story 41 downgraded Hard → Non-trivial; `piece.state` verification elevated to Story 39 first action (prerequisite, not a pre-Story 40 check); `zoomToPlace` + Enter conflict documented as §9.9 (Enter = spiral only, separate preview key TBD in Story 39); Story 41 split into 41a (pick-up/put-down model) and 41b (arrow-key movement).

---

### Story 37d (2026-04-05)

High contrast core repair. `npm run typecheck` passes.

**`src/utils/preferences.ts`**
- Removed dead single-outline system (`OUTLINE_FILTER_TAG`, `addEdgeOutline`, `removeEdgeOutline`) and dead `SNAP_HIGHLIGHT_OPACITY`/`SNAP_HIGHLIGHT_WIDTH` exports (were never imported anywhere).
- AC-1: Added sandwich stroke — `HC_INNER_OUTLINE_THICKNESS = 1.5` (white) + `HC_OUTER_OUTLINE_THICKNESS = 2.5` (black), both tagged `'hc-sandwich'`. `addSandwichStroke` guards against duplicate application; `removeSandwichStroke` calls `f.destroy()` on removed filters to release GPU memory. Both are called from `applyHighContrast` within the existing RAF batch pattern. Filter order: BevelFilter stays at index 0; inner + outer appended to end.
- AC-3: Renamed `LABEL_BG_ALPHA` → `LABEL_BG_ALPHA_DEFAULT = 0.45`, added `LABEL_BG_ALPHA_HC = 0.8`. `createPieceLabel` now takes `bgAlpha` param. `applyPieceLabels` extended with `highContrast: boolean` param; added `updateLabelBgAlpha(label, bgAlpha)` helper that redraws the backing `Graphics` using `getChildAt(0)` (bg) / `getChildAt(1)` (text) — deterministic structure. "active && existing" branch now also calls `updateLabelBgAlpha` alongside the rotation update. `applyPreferences` passes `prefs.highContrast` through.

**`src/canvas/tray.ts`**
- AC-2: Replaced `TRAY_BG_COLOR`/`TRAY_STRIP_COLOR`/`TRAY_BG_HIGH_CONTRAST` with `TRAY_BG_DEFAULT_COLOR = 0x1a1a1a`/`TRAY_BG_DEFAULT_ALPHA = 0.85` (glass) and `TRAY_BG_HC_COLOR = 0x000000`/`TRAY_BG_HC_ALPHA = 1.0` (solid). `redrawBackground` simplified to single-rect fill — no separate strip colour in normal mode.
- AC-2: Added `_unsubscribeHC` module var. At end of `initTray`: `_unsubscribeHC?.()` (idempotent) then subscribe to `usePuzzleStore` comparing `state.highContrast !== prev.highContrast`; calls `redrawBackground()` on change. Fires synchronously — not deferred via applyFn chain.
- Added `teardownTray()` export: cleans up `_unsubscribeHC`.

**`src/canvas/scene.ts`**
- AC-4: Added snap highlight constants (`SNAP_HIGHLIGHT_COLOR_DEFAULT = 0x00ff00`, `SNAP_HIGHLIGHT_COLOR_HC = 0xff00ff`, `SNAP_HIGHLIGHT_ALPHA_DEFAULT = 0.4`, `SNAP_HIGHLIGHT_ALPHA_HC = 1.0`, `SNAP_HIGHLIGHT_THICKNESS_DEFAULT/HC = 2/4`). Module-level `_snapHighlightColor` + `_snapHighlightAlpha` vars.
- `updateSnapHighlight(hc, rm)`: `reducedMotion` takes priority (magenta at 1.0); else HC or default values applied.
- Board-snap pulse updated: replaced hardcoded cycling gChannel tint with `pulseColor`/`pulseAlpha` snapshot (read from module-level vars at snap time). Scale pulse retained. `s.alpha` animated from `pulseAlpha` → 1.0 over the pulse and reset to 1 at end.
- `updateSnapHighlight` called immediately after preferences load; Zustand subscription fires on `highContrast` or `reducedMotion` change.

---

### Story 37c (2026-04-05)

Reduced motion mode — `applyReducedMotion` fully implemented, no longer a stub. `npm run typecheck` passes.

**`src/utils/preferences.ts`**
- Added `Viewport` import from `pixi-viewport`.
- Added `_viewport: Viewport | null` module var + `initPreferencesViewport(viewport)` export (same pattern as `initPreferencesApp`).
- Added `DECELERATE_FRICTION_DEFAULT = 0.95` (mirrors `scene.ts` `.decelerate({ friction: 0.95 })`) and `DECELERATE_FRICTION_REDUCED = 1.0`.
- Implemented `applyReducedMotion(active)`: gets `_viewport.plugins.get('decelerate')`, casts to `any` and sets `.friction`; calls `_viewport.plugins.remove('animate')` on enable only.

**`src/canvas/scene.ts`**
- Imported `applyReducedMotion` and `initPreferencesViewport` from preferences.
- Called `initPreferencesViewport(viewport)` immediately after `.decelerate({ friction: 0.95 })`.
- Extended existing `usePuzzleStore.subscribe` — added `if (state.reducedMotion !== prev.reducedMotion) applyReducedMotion(state.reducedMotion)` branch so mid-session toggles apply immediately.
- Board-snap pulse: wrapped `app.ticker.add(tickerFn)` in `if (!reducedMotion)` block; added per-tick bail-out inside the ticker for mid-pulse toggle. Reset to `scale/tint/alpha` defaults in all exit paths.

**`src/puzzle/drag.ts`**
- `tweenRotation` ticker: added per-tick `reducedMotion` check — snaps to `to` and removes ticker immediately.
- `initDragListeners` pointerdown lift: replaced `tweenRotation(...)` with explicit `if (reducedMotion) { snap } else { tween }`. `syncLabelRotation` called in both branches.
- `startDragForPiece` lift: same explicit branch.
- `onUp` snap-back: same explicit branch.

**`src/canvas/tray.ts`**
- `setTrayOpen`: replaced `window.matchMedia('prefers-reduced-motion')` with `usePuzzleStore.getState().reducedMotion`.
- Animation ticker: added reducedMotion snap block at top — `currentTrayHeight = targetTrayHeight; applyTrayLayout(); return` when flag is set and heights differ.
- `zoomToPlacePiece`: replaced `window.matchMedia` with `usePuzzleStore.getState().reducedMotion`; removed TODO comment.
- Visual tether ticker: added per-tick `reducedMotion` check — snaps sprite to `endScreenX/endScreenY`, removes viewport animate plugin, calls `completeZoomAnimation`.

---

### Accessibility Audit + Story 37c Intake (2026-04-05)

**Accessibility Audit — post-37d**

Rewrote `docs/accessibility.md` as a comprehensive post-37d audit. All five source files (`puzzleStore.ts`, `preferences.ts`, `scene.ts`, `tray.ts`, `drag.ts`) plus `aria.ts` and `types.ts` audited against spec.

**Story 37d verified repairs (all PASS):**
- AC-1 Sandwich stroke: two `OutlineFilter` instances (white 1.5px + black 2.5px), both tagged `hc-sandwich`, BevelFilter stays at index 0, GPU memory freed on removal.
- AC-2 Solid tray: `TRAY_BG_HC_COLOR = 0x000000` / `TRAY_BG_HC_ALPHA = 1.0` confirmed. Previous α 0.9 gap resolved. `usePuzzleStore.subscribe` in `initTray` fires `redrawBackground()` synchronously on toggle.
- AC-3 Label pill backing: `LABEL_BG_ALPHA_HC = 0.8` applied only when `highContrast: true`; update path (`active && existing`) also calls `updateLabelBgAlpha`.
- AC-4 Neon magenta snap: `SNAP_HIGHLIGHT_COLOR_HC = 0xff00ff` at α 1.0 confirmed. `SNAP_HIGHLIGHT_THICKNESS_HC = 4` defined but deferred (reserved for future stroke overlay — P2 gap).

**Hallucination guard:** `grep` across all of `src/` — zero matches for `piece.sprite`. Confirmed spec-clean.

**Remaining gaps (unchanged from pre-37d except α 0.9 resolved):**
- P1: `applyReducedMotion` still a stub (Story 37c).
- P1: zoom-to-piece reads `window.matchMedia` directly, not Zustand flag (Story 37c).
- P1: `setAriaLabel` never called on state transitions — screen reader state is stale (Story 38).
- P2: No keyboard navigation (Stories 38–42).
- P2: `SNAP_HIGHLIGHT_THICKNESS_HC` not yet wired.
- P3: Labels unreadable below ~0.3× zoom; greyscale doesn't reach tray chrome; `reducedMotion` not re-detected on OS change mid-session.

**Story 37c spec received — not yet implemented**

Full spec delivered. Touch only: `preferences.ts`, `drag.ts`, `scene.ts`, `tray.ts`. Key contracts:
- `applyReducedMotion` must be fully implemented — no longer a stub.
- Decelerate friction → `1.0` on enable, restored to `DECELERATE_FRICTION_DEFAULT` on disable; in-flight `animate` plugin cancelled immediately.
- Store subscription wired for mid-session toggle, idempotent.
- Every ticker tween checks flag on every tick — snaps to end state if toggled mid-tween.
- Drag lift: snaps immediately, no 80ms tween. `syncLabelRotation` always called.
- Snap-back: immediate `position.set`. Board pulse: skipped entirely.
- Tray open/close: snaps immediately. Spiral: piece appears at position.
- Zoom-to-piece: `moveCenter` + `scale.set`, `window.matchMedia` check replaced with Zustand flag.
- Visual tether + opacity pulse: skipped entirely.
- Completion animation: `// TODO: Story 51` comment only.
- STRICT: never `duration: 0`. Explicit `if (reducedMotion)` branches only.

### Story 37c — AC-3 Precision Centering + UI Repairs (2026-04-05)

Follow-on refinements after the core Story 37c implementation.

**AC-3 Precision Centering**

Initial `zoomToPlacePiece` teleport placed the piece at raw screen centre (ignoring tray height). Refined to centre on the playable area (above tray):
- `viewport.scale.set(clampedScale)` called **first**
- `trayOffset = currentTrayHeight / 2 / viewport.scale.y` converts tray half-height to world units
- `viewport.moveCenter(piece.canonical.x, piece.canonical.y + trayOffset)` shifts piece to playable centre
- `viewport.plugins.get('decelerate')?.reset()` clears any residual momentum
- Same three-step sequence applied to the mid-flight tether ticker bail-out path

**HC Color Swatch Halo**

Dark swatches (`0x000000`) were invisible against the pure-black HC tray. Replaced single black border with a dual-ring halo designed to abut at `r+1.5`:
- Outer ring: `circle(cx, cy, drawRadius + 2.5).stroke({ color: outerColor, width: 2 })` — covers `r+1.5` to `r+3.5`
- Inner ring: `circle(cx, cy, drawRadius + 1).stroke({ color: 0x000000, width: 1 })` — covers `r+0.5` to `r+1.5`
- Rings share a clean abutment edge at exactly `r+1.5` — no overlap, no gap
- In HC mode: outer ring is white (normal) or magenta `0xff00ff` (active)
- Non-HC active ring drawn at `drawRadius + 3` (dynamically relative to fill radius)

**SWATCH_SPACING Tuning**

Iterated on spacing feedback: `28 → 36 → 32`. Settled at `SWATCH_SPACING = 32`.

**AC-6 Swatch Selection State**

Added distinct active-swatch visual treatment. Initial pass was wrong — tied `drawRadius` and white dot to `isActive && highContrast` condition. User correction:
- `drawRadius = isActive ? SWATCH_RADIUS_ACTIVE : SWATCH_RADIUS` — unconditional on HC
- White centre dot `if (isActive)` — unconditional on HC
- Magenta outer ring: only inside existing `if (hcSwatches)` block, changes `outerColor` from white to `0xff00ff` when `isActive`

Constants: `SWATCH_RADIUS_ACTIVE = 13`, `SWATCH_GLOW_R = 2`, `SWATCH_HC_ACTIVE_CLR = 0xff00ff`.

---

### Story 36

- **`src/store/puzzleStore.ts`**: Added `zoomToPlace: boolean` (default `false`) and `setZoomToPlace` action to `PuzzleState`.
- **`src/canvas/tray.ts`**: All changes isolated here.
  - **Dev checkbox** (DOM element, `position: fixed`, right-aligned in tray strip): wired to `zoomToPlace` Zustand flag; updates bottom position in `applyTrayLayout()` to track tray animation. Removed on reinit. `TODO` comment for Story 52.
  - **4px movement threshold**: `trayPointerDownX/Y` recorded on `pointerdown`; `trayPointerMovedFar` set in `onStagePointerMove` when squared distance > 16. Cleared when boundary crossed. On release: if `movedFar` → ignore (drag stayed in tray); if `≤4px` → dispatch to zoom or spiral.
  - **`cancelZoomAnimation()`**: removes viewport `'animate'` plugin, removes ticker tween, reparents in-flight sprite back to `_gridContainer`, clears filters, reflows tray.
  - **`completeZoomAnimation()`**: stops ticker tween, reparents sprite from `app.stage` to `viewport`, sets world-space landing position, calls `extractPieceToCanvas` + `insertGroupAABB`, reflows tray.
  - **`zoomToPlacePiece()`**: captures tray screen position; reparents to `app.stage`; restores filters and canvas scale; computes `clampedScale = min((screen.height × 0.30) / (piecePixelH × canvasScale), 8.0)`; randomised `LANDING_OFFSET = 35px` angle offset from canonical center (within 60px board snap radius); launches `viewport.animate()` (600ms, easeInOutQuad) + parallel ticker tween for visual tether (sprite flies from tray → screen center); reduced motion: `viewport.moveCenter()` + `viewport.scale.set()` + immediate complete (uses OS `prefers-reduced-motion` until Story 37 Zustand flag ships).
  - **Rapid click handling**: `onStagePointerUp` calls `cancelZoomAnimation()` before `zoomToPlacePiece()` if `_zoomInFlight`.
  - **`easeInOutQuad(t)`** helper added.
  - **No changes to `scene.ts`**: `viewport.animate()` is a built-in pixi-viewport plugin, no pre-registration required; typecheck confirmed availability.
- `npm run typecheck` passes clean.

### Story 34

- **`src/puzzle/types.ts`**: Added `EdgeType = 'corner' | 'edge' | 'interior'`; added `edgeType: EdgeType` field to `Piece`
- **`src/puzzle/cutter.ts`**: Computes `flatSides` (count of border edges) in `gridCut`; assigns `edgeType` (`>= 2` flat → `corner`, `1` → `edge`, `0` → `interior`). No WASM changes.
- **`src/store/puzzleStore.ts`**: Exports `TrayFilter = 'all' | EdgeType`; adds `activeFilter: TrayFilter` (default `'all'`), `setActiveFilter`; resets `activeFilter` to `'all'` in `setPieces` (new puzzle start)
- **`src/canvas/tray.ts`**: Added `FILTER_STRIP_HEIGHT = 36`; `_filterContainer` as non-scrolling child of `_piecesContainer` at `y=0`; `_gridContainer.y = FILTER_STRIP_HEIGHT`; `visibleInTray()` helper filters `_trayDisplayOrder` by `activeFilter`; `renderFilterStrip()` redraws 4 Graphics+Text buttons (All/Corners/Edges/Interior) with live counts — called from `layoutTrayPieces()`; button `pointerdown` calls `setActiveFilter`, resets `_scrollX=0`, reflows grid; `layoutTrayPieces()` hides all in-tray containers then re-shows filtered subset; `hitTestTrayPiece` uses `visibleInTray()` and subtracts `FILTER_STRIP_HEIGHT` from y; empty-state check uses `allInTray.length === 0` (not filtered count); `availH` updated for filter strip height
- No DOM elements. `npm run typecheck` passes clean.
- **Post-implementation polish** (user feedback): inactive button text `0xaaaacc` was unreadable — bumped to `0xddddf0` (near-white), `fontSize: 12`, active label `fontWeight: 'bold'`; dimmed (0-count) buttons `0x777799`. Added `T` key to toggle tray via the existing `keydown` listener in `scene.ts` (imports `setTrayOpen` from `tray.ts`); guard skips handler when focus is in `INPUT`/`TEXTAREA`/`SELECT` elements.

### Story 33

- **`src/canvas/tray.ts`** (only file touched):
- Replaced `TRAY_ROWS = 2` / `PAD = 10` with `THUMBNAIL_SIZE = TRAY_HEIGHT_OPEN * 0.7` (~154px) and `PADDING = 8`
- Added `_gridContainer` as scrollable child of `_piecesContainer` (`x = -_scrollX`). Mask stays on `_piecesContainer` so clip rect is stable; scrolling moves `_gridContainer` only
- Grid is column-first (top-to-bottom within each column, expanding right). With default constants only 1 row fits → natural horizontal scroll band
- Sprite scale computed per-layout as `Math.min(THUMBNAIL_SIZE/expandedW, THUMBNAIL_SIZE/expandedH)` (uniform, aspect-preserving). Sprite centered within THUMBNAIL_SIZE cell
- `_totalGridWidth` tracked; `_scrollX` clamped on every reflow via `clampScroll()`
- Wheel listener on `tray` container: `e.stopPropagation()` + horizontal scroll (uses `deltaX` if nonzero, else `deltaY`)
- Scroll drag: pointer down on background (no piece hit) → `_scrollDragActive` / `_scrollDragPointerId`. Handled in `onStagePointerMove` / `onStagePointerUp` alongside existing piece drag
- `usePuzzleStore.subscribe()` watches for `on-canvas` / `placed` transitions → prunes `_trayDisplayOrder`, calls `layoutTrayPieces()` same frame
- `_originalFilters` map: clears BevelFilter from sprites when entering tray, restores on `extractToCanvas()` and `spiralPlace()`
- `updateEmptyState()`: lazily creates a `Text` "All pieces placed" centered in pieces area; shown when `inTray.length === 0`
- `hitTestTrayPiece()` updated: uses `THUMBNAIL_SIZE / 2` hit bounds; accounts for `_scrollX` in coord conversion
- `onTrayResize()` calls `layoutTrayPieces()` which recalculates cols, clamps scroll, redraws mask
- `npm run typecheck` passes clean

### Story 32

- **`src/puzzle/types.ts`**: Added `state: 'in-tray' | 'on-canvas' | 'placed'` to `Piece`
- **`src/store/puzzleStore.ts`**: Added `trayOpen: boolean`, `setTrayOpen`, `extractPieceToCanvas(pieceId, groupId, groupPos)` (sets state + groupId + creates PieceGroup atomically); `markGroupPlaced` now also sets `state: 'placed'`
- **`src/puzzle/cutter.ts`**: `gridCut` no longer creates `PieceGroup`s; pieces start with `groupId: null`, `state: 'in-tray'`. Return type is `{ pieces }` only
- **`src/puzzle/scatter.ts`**: Scatter-on-load logic removed (function is a no-op stub); all math preserved as commented-out block
- **`src/puzzle/drag.ts`**: Added `isDraggingCanvas()`, `insertGroupAABB()`, `startDragForPiece()` — the three hooks tray.ts needs
- **`src/canvas/tray.ts`** (new): Screen-space `Container` at `zIndex: 500`; lerp animation with `viewport.resize()` every frame; flat row layout; drag-extraction (pointer crosses tray boundary → reparent + coord convert + `startDragForPiece`); click-extraction (Archimedean spiral, occupied-skip, spiral origin locks on first click, resets on viewport pan); `isDraggingCanvas()` guard on all tray handlers; chevron close / strip-click open; reduced-motion snap
- **`src/canvas/scene.ts`**: Removed `scatterPieces` / `applyScatterToSprites`; pieces go into tray via `initTray`; `setGroups([])` on load; board added to viewport for visible empty canvas; `onTrayResize` wired to `window.resize`
- `npm run typecheck` passes clean

**Bug-fix round (post-initial-implementation):**
- **Tray width wrong on resize/fullscreen**: `app.screen.width` lags one frame. Fixed with `screenW() = Math.max(app.screen.width, window.innerWidth)` and dual resize listeners (`window` + `app.renderer.on('resize')`). `_stripHitArea` reference stored so `redrawBackground()` can resize it correctly.
- **Open/close not working**: Chevron was drawn stroke-only (`Graphics` with no fill) → no hit area. Fixed: chevron is purely decorative; dedicated `_stripHitArea` transparent-fill rect handles both open and close toggle via unified `setTrayOpen(!trayOpen)` call.
- **All 16 pieces not accessible**: Single flat row overflows viewport width. Fixed: 2-row wrap (`TRAY_ROWS = 2`), `piecesPerRow = Math.floor((screenW()-PAD)/slotW)`. Added `_piecesContainer` child container with Graphics mask for overflow clipping.
- **Pieces not randomized**: Added Fisher-Yates shuffle into `_trayDisplayOrder` on `initTray`. Store order untouched.
- **Drag extraction jump (piece snaps to cursor center)**: `startDragForPiece` was receiving sprite world coords as `worldX/Y` → `dragOffset = 0` → center jump. Fixed: pass `_viewport.toLocal(e.global)` (pointer world pos) from `onStagePointerMove` into `extractToCanvas` → `startDragForPiece`.
- **Board shadow pixelated ("old video game console")**: `board.ts` had `resolution: window.devicePixelRatio` on `DropShadowFilter`. Same retina seam artifact as piece shadows. Fixed: `resolution: 1`.
- **Tray scale ignored tab padding**: Scale computed against raw `piecePixelH` (128px) but sprite frames expand to `ph + 2*tabPad` ≈ 232px. Fixed: `_trayScale = Math.min(rowH/expandedH, rowH/expandedW, canvasScale)`. Same fix in slot sizing and hit-test half-extents.

### Story 30
- Spike complete. **Approach C selected: Reserved Canvas Region.**
- Tray = screen-space `Container` on `app.stage`, outside `pixi-viewport`
- `viewport.resize(width, height - TRAY_HEIGHT)` on open/close — documented `pixi-viewport` API
- Zero texture duplication (one GL context, one Assets cache)
- Extraction = sprite reparent via `viewport.toLocal()` — no sprite recreation, no missing frames
- Return path retrofit: medium cost — mid-animation coordinate space switch at tray boundary; `TrayReturnAnimator` ~150–200 lines; smooth within one renderer
- Approaches A (dual GL context, 2× VRAM, cross-renderer handoff) and B (DOM thumbnails, violates architecture principle, rough extraction) eliminated
- Key constraints for Stories 31–37: scatter.ts gutted in Story 32, PieceGroup creation deferred to extraction, tray z-index between viewport and UI, tray pointer events suppressed during canvas drag
- Full analysis: `docs/spike-tray-rendering.md`

### Story 29
- Removed `edgeOverlay` Sprite and all overlay construction from `ANALYSIS_COMPLETE` handler in `scene.ts`
- Removed `E` key binding from `keydown` listener
- `edgeMap` data path untouched — stored in worker scope, flows into `GENERATE_CUTS` → `edgeInfluence` as before
- Future dev tooling gated behind `?debug=true` per roadmap decision

### Roadmap revision (2026-04-03)
- Full roadmap reset. Stories 21–30 (old Workspace/Sorting/Persistence/Completion epics) replaced.
- New roadmap: Stories 29–69 across Pre-Epic Cleanup, Piece Tray, Keyboard Accessibility, Image Ingestion, App Shell, Persistence, Usage Tracking, PWA, Spec Doc.
- Key decisions: tray-first model, piece state machine (`in-tray` → `on-canvas` → `placed`), extraction UX (drag + Archimedean spiral click + keyboard Enter), virtual cursor keyboard model, Story 50 split into 50/50b/50c, Story 67 Bezier geometry public repo risk flagged.

### jigg-spec + Piece type refactor
- Created `jigg-spec` public repo (`quirklabsio/jigg-spec`) with full v0.1 draft scaffold
- Added as git submodule at `/jigg-spec`
- `pieces.md` now defines canonical/actual Transform model (v0.1.2)
- `src/puzzle/types.ts`: added `Transform` interface; replaced `Piece` fields:
  - `localPosition` → `actual.x / actual.y`
  - `correctPosition` → `canonical.x / canonical.y`
  - `rotation` → `actual.rotation`
  - `stackIndex` → `actual.z`
  - `groupId` typed as `string | null` per spec
- All call sites updated: cutter, scatter, rotate, snap, drag, scene, puzzleStore
- `groupId == null` null guard added in snap.ts; `groupId!` assertion in scene.ts
  (all pieces always have a groupId in practice — null is a spec-level concept only)
- `typecheck` passes clean

### Story 20 notes
- **pixi-viewport**: `Viewport` from `pixi-viewport` replaces manual camera. Added to `app.stage` as the sole world-space parent.
- **World content**: All piece containers, hit layer, and edge overlay live inside `viewport`. Completion UI (`ui.ts`) stays on `app.stage` (screen-space).
- **Viewport plugins**: `.drag()` (pan), `.pinch()` (mobile zoom), `.wheel()` (scroll zoom), `.decelerate({ friction: 0.95 })` (inertia). Zoom clamped: `minScale: 0.15`, `maxScale: 8.0`.
- **World size**: 4000×4000. Hit layer covers `(-2000, -2000)` to `(2000, 2000)`.
- **Drag coord fix**: `drag.ts` accepts optional `worldContainer: Container` param for `toLocal()` and `sortChildren()`. Defaults to `app.stage` for backwards compat. Scene passes `viewport` as worldContainer.
- **Hit layer**: `createHitLayer` now takes `(worldContainer, worldW, worldH)` instead of `(app)`. Rectangle centred at world origin.
- **Resize**: Window resize listener calls `viewport.resize()`. Renderer resize still handled by `resizeTo: window`.
- **No coordinate changes**: All piece positions remain in world space. Viewport transform handles screen mapping. Scatter, snap, and drag logic unchanged.
- **Event conflict prevention**: Piece pointerdown calls `e.stopPropagation()` → viewport drag doesn't fire during piece drag. Non-piece clicks propagate to viewport for panning.
- Story 19 skipped — z-order handled implicitly by drag system settle counter.

### Story 18b final state
- **Background**: WebGL clear color `#f5f5f3` only (no Graphics rect — retina triangle-seam artifact). `index.html` body background also `#f5f5f3`.
- **Board**: `board.ts` rewritten to return `Container` with white fill + DropShadowFilter, but NOT added to stage (too visually intrusive on off-white).
- **Piece shadows**: DropShadowFilter on Container wrappers implemented with 3-state system (resting/dragging/placed), persistent filter mutation, drag callbacks. **Disabled** — too subtle at low alpha, retina seam at `resolution: DPR`, `resolution: 1` imperceptible. Container wrapper architecture retained.
- **BevelFilter**: `thickness:2`, `lightAlpha:0.2`, `shadowAlpha:0.2` on sprites (subtle edge lighting).
- **1° rotation tween**: `tweenRotation()` on pointerdown (lift) and pointerup (snap-back to nearest 90°). 80ms ease-in-out quad via `app.ticker`. `tweenId` counter cancels stale tweens (prevents snap-back from clobbering double-tap rotate).
- **Container wrapper**: Each sprite wrapped in a one-child `Container` on stage. Container owns `zIndex` and `filters`; sprite owns position, rotation, scale, anchor, mask. `(s.parent ?? s).zIndex` pattern in drag.ts.
- **Hit layer**: `hitArea = new Rectangle(...)` instead of transparent-fill rect (no rendered geometry at zIndex 1000).
- **Drag zIndex**: `stage.sortChildren()` called explicitly after bulk zIndex mutation in pointerdown/pointerup.
- **Drag callbacks**: `setDragStartCallback` / `setDragEndCallback` exported from drag.ts, wired in scene.ts for shadow state (currently no-op since shadows disabled).

### Story 16 notes
- Uses `pixi-filters` v6 `BevelFilter` — no custom GLSL or distance field required for v1
- Applied per sprite in `CUTS_COMPLETE` after mask is set: `sprite.filters = [new BevelFilter({ rotation, thickness, lightAlpha, shadowAlpha })]`
- `rotation: 225` hardcoded directly — light from top-left, universal jigsaw convention. No derivation from `lightAngle` (no UI for it). See decisions.md.
- `thickness: 2`, `lightAlpha: 0.3`, `shadowAlpha: 0.3` for subtle effect
- Removed Story 15 debug key bindings (1/2/3) — Story 15 phase complete
- Custom distance-field shader (BFS in WASM + bevel.frag) prototyped but scrapped; logged as future polish story. Gotcha noted: PixiJS v8 filters cannot use `dFdx`/`dFdy` without `GL_OES_standard_derivatives`.

### Story 15 notes
- `generate_cuts` in `lib.rs` gains `edge_map: &[u8]`, `image_width`, `image_height`, `edge_influence` params
- `sample_edge_band()` scans ±pieceSize×0.3 band every 4 px; returns (strength 0..1, signed_pixel_offset)
- Baseline offset = `sign(offset) * strength * edge_influence * pieceSize * 0.25`; skipped if strength < 0.1
- Variation scaled: `var_h = 1 - influence*(2/3)` (±15%→±5%) and `var_w = 1 - influence*0.5` (±10%→±5%)
- `analysis.worker.ts`: stores `edgeMap.slice()` in module scope after `ANALYZE_IMAGE` (before buffer transfer); GENERATE_CUTS reads `edgeInfluence` from payload and passes stored map to WASM
- `cutter.ts`: exports `EDGE_INFLUENCE = 0.5` — single partition point for cut style config
- `scene.ts`: imports `EDGE_INFLUENCE`; passes it + `imageWidth`/`imageHeight` in GENERATE_CUTS payload; worker is no longer terminated (stays alive for debug re-runs); CUTS_COMPLETE handler clears old masks before applying new ones
- `Graphics` added to PixiJS import in `scene.ts` (needed for mask cast in rebuild path)

### Story 15 critical fix — sliver gaps between adjacent pieces

**Cause 1 (lib.rs)**: Edge-influence offset shifts `cut_y`/`cut_x` off the grid line. Cut path endpoints (pts[0] and pts[18]) are now pinned to the unshifted grid corner after path generation. Adjacent horizontal and vertical cuts always meet at the exact same corner coordinate.

**Cause 2 (cutter.ts)**: `drawCutSegments` implicitly draws from the cursor, which may differ from pts[0] if any small offset exists. Added explicit `lineTo(pts[0])` before each `drawCutSegments` call for all four edges. Also changed `new Graphics()` to `new Graphics({ roundPixels: true })` for crisp integer-pixel mask geometry.

**Cause 3 (scene.ts)**: PixiJS v8 has no `antialias: false` option on Graphics; stencil masks are binary by design but sub-pixel boundaries can leave a gap pixel unclaimed by either adjacent mask. `mask.roundPixels = true` set after `buildPieceMask` snaps the stencil vertices to integer device pixels, ensuring the shared boundary is always at a whole pixel and covered by one of the two adjacent masks.

Rule: **never call drawCutSegments without first lineTo to pts[0]** — the cursor must be exactly at the cut path start before drawing.

### Post-Story-14 session notes (tab refinement + snap fix)

**Snap regression (texture.frame vs textureRegion)**
- After Story 14 expanded sprite texture frames to include tab padding, `snap.ts` was reading `firstSprite.texture.frame.width/height` for `pieceW/pieceH`. Frame size > grid size → wrong expected neighbour distance → snap never fired.
- Fix: read `firstPiece.textureRegion.w/h` — always the original grid cell size. See `gotchas.md`.

**Tab profile redesign (lib.rs)**
- Old: 5-segment path (16 pts), single cubic for cap → flat-topped bump, not a dome.
- New: 6-segment path (19 pts), cap split into two K=0.5523 quarter-circle arcs → true semicircular dome, G1-continuous at all joins.
- Profile: flat approach → shoulder flare + 5px waist dip → pinch to narrow neck (neck_w = tab_w × 0.50) → expand into dome → two quarter arcs → symmetric return.
- `neck_y = cut_y + tab_dy − sgn·r` ensures dome height = r always (geometric circle regardless of piece aspect ratio).
- Tab/blank interlock unchanged — path is symmetric, so blank is exact inverse.
- `cutter.ts` required zero changes — reads point arrays generically with `i += 3`.

### Story 14 notes
- `generate_cuts` in `lib.rs`: returns JSON string (no serde dep) — 5-segment cubic Bezier tab per interior edge
- Tab direction: `hash_edge(col, row, dir) % 2` → 'A' protrudes +Y/+X, 'B' protrudes −Y/−X; deterministic per seed
- `mulberry32(seed)` PRNG for per-edge variation: tab offset ±10%, height/width ±15%, neck ±10%
- Cut path format: 16 CutPoints — 1 start + 5 × (cp1, cp2, end); indexed by `h,col,rowA` / `v,colA,row`
- Mask traversal: CW — top=FORWARD(rowB), right=FORWARD(colA), bottom=REVERSE(rowA), left=REVERSE(colB)
- Graphics added as child of sprite (local pixel space, anchor 0.5); mask stays with sprite during drag
- Worker handles both `ANALYZE_IMAGE` and `GENERATE_CUTS` in same instance; terminates when both complete
- `generate_cuts` wasm-bindgen return type maps to `string` (not `JsValue`) — parse with `JSON.parse` in worker
- `satisfies` used in `postMessage` calls in scene.ts for type-safe worker messages without casting

### Story 13 notes
- Full Canny in `lib.rs`: greyscale → Gaussian blur → Sobel → NMS → double threshold → hysteresis BFS — see `wasm-pipeline.md` for detail
- Worker message protocol updated: posts `{ edgeMap, width, height }`, transfers buffer — see `wasm-pipeline.md`
- Edge overlay in `scene.ts`: cyan RGBA canvas → `Texture.from(canvas)` → Sprite at board position, `alpha=0.6`, `zIndex=999`, starts hidden, `E` toggles — **removed in Story 29**
- `wasm-pack: command not found` on first run — `~/.cargo/bin` not on PATH; fix in `gotchas.md`
- `Vec<u8>` return maps to `Uint8Array` after wasm-pack build — no manual cast needed

### Story 12 notes
- `isComplete` in `completion.ts` — pure O(n) early-exit check over `piecesById`
- Completion check inlined in `markGroupPlaced` (store) to avoid circular dep: `puzzleStore` ↔ `completion`
- `puzzleComplete: boolean` added to Zustand store; set once, never unset
- `onComplete(app, hitLayer, totalCount)` — disables hit layer, logs, triggers fade-in message
- `showCompletionMessage` in `ui.ts` — PixiJS Container at zIndex 9999, dark panel + white 32px text, Ticker fade 0→1 over 2s
- Completion checked in `setBoardSnapCallback` in `scene.ts` after board snap fires
