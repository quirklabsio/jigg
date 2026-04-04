# Stories

## Completed

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

## Roadmap

### Pre-Epic Cleanup
- [x] **Story 29** — Remove edge overlay debug scaffolding; strip visual overlay + `E` key binding from `scene.ts`, retain edge map data for `edgeInfluence` in cut generation. Gate any future dev tooling behind `?debug=true`

---

### Epic: Piece Tray
*Tray-first model. All pieces load into tray on puzzle start. Canvas starts empty. User pulls pieces out as they work. Staging only — no manipulation in tray.*

**Design decisions locked:**
- Piece state machine: `in-tray` → `on-canvas` → `placed`
- Return path to tray (including group behaviour) fully deferred pending user feedback — no architectural constraints added that prevent it later
- Filters: single-select, mutually exclusive (corner / edge / interior / color zone)
- Filter metadata computed at cut time, cached on piece — not derived on filter change
- Rotation On: pieces arrive in tray pre-rotated, double-tap enabled. Rotation Off: pieces arrive upright, double-tap handler explicitly disabled
- **Piece extraction — drag:** follows cursor from tray exit, lands on release. Drop shadow appears and opacity normalises on tray exit
- **Piece extraction — click:** Archimedean spiral from viewport center. Spiral origin locked at first click in sequence, resets on pan. Step spacing computed from max piece diagonal (`imageWidth / N * √2 * 1.3`) — 1.3 buffer accounts for Bezier tab protrusion. If exact coordinates occupied, skip to next spiral step.
- **Keyboard extraction (Enter on tray piece):** triggers same spiral logic as click

- [x] **Story 30** — Spike: tray rendering model; prototype all three approaches (separate PixiJS stage / DOM thumbnails / canvas viewport region), pick one, document the decision. Explicitly assess how each model handles a future return path to tray — PixiJS-managed tray wins on animation smoothness, DOM-to-canvas handoff is rough. Unblocks all subsequent tray stories. **Decision: Approach C (reserved canvas region). See `docs/spike-tray-rendering.md`.**
- [ ] **Story 31** — Spec: tray impact on `jigg-spec`; piece state (`in-tray` / `on-canvas` / `placed`), filter metadata (edge type, dominant color vector), tray-first load behaviour, rotation session property (`session.rotationEnabled`, `piece.initialRotation`), piece extraction UX (drag + spiral click + keyboard Enter all specced above), deferred return-to-tray logged as conscious omission
- [x] **Story 32** — Bottom drawer tray; all pieces populate on load, pushes viewport up when open, collapses. Note: `scatter.ts` — gut the scatter-on-load behaviour, preserve the random distribution math for potential future use (e.g. "scatter all canvas pieces" panic button). Bug-fix round: tray width on resize, open/close hit area, 2-row wrap, piece randomisation, drag extraction jump, board shadow retina artifact, tray scale vs expanded sprite frames.
- [x] **Story 33** — Tray layout; grid view of unplaced pieces, synced with canvas state in real time
- [x] **Story 34** — Piece filtering; single-select filter strip — corner / edge / interior
- [x] **Story 35** — Color zone filter; k-means clustering at cut time, filter tray by dominant color region. `colorVector` computed per piece in `gridCut()` (dominantColor, sample every 4th pixel). k-means k=5 runs synchronously in `gridCut()` after all pieces created, assigns `colorZone 0–4`. Five filled-circle swatches appended to filter strip; fill = mean colorVector of zone; active swatch has white ring; zero-piece swatches dimmed. Pixel data extracted once in `loadScene` and reused for the WASM worker (eliminated duplicate OffscreenCanvas). Mutually exclusive with edge type filter. Filter resets to `all` on new puzzle load (via `setPieces`).
- [x] **Story 36** — Zoom-to-piece; click tray piece, canvas pans and zooms to its correct world position
- [ ] **Story 36b** — Content-aware edge type; `edgeType` currently derived from grid position only. For shaped images (circular crop, vignette, alpha-masked source), corner/edge grid pieces may be mostly transparent — not real puzzle edges. Compute average alpha of border pixels per piece at cut time; if a nominally-flat side sits over transparent pixels, don't count it as a flat side. Re-derive `edgeType` from content-aware flat-side count. Affects filter strip counts and future snap logic.
- [ ] **Story 37** — Accessibility modes; high contrast toggle, piece number label overlay, reduced motion (disables inertia + snap animations)

---

### Epic: Keyboard Accessibility
*Scoped as its own epic. Parallel focus system on WebGL canvas is non-trivial — spike before committing to estimates.*

**Approach locked:** Virtual cursor model — hidden DOM accessibility tree mirrors canvas state. Tabbing moves through invisible DOM buttons. Visual focus ring rendered on PixiJS stage. Browser-native tab order, canvas visual response.

- [ ] **Story 38** — Spike: keyboard focus model; implement virtual cursor approach, assess ARIA tree structure, produce realistic estimates for Stories 40–42 before they are scheduled
- [ ] **Story 39** — Spec: keyboard nav impact on `jigg-spec`; focus state, interaction model, ARIA landmark structure
- [ ] **Story 40** — Tray keyboard nav; tab through tray pieces via hidden DOM buttons, focus ring rendered on PixiJS stage
- [ ] **Story 41** — Canvas keyboard interaction; arrow keys to move focused piece, Enter to place. Enter on tray piece triggers spiral extraction identical to click behaviour
- [ ] **Story 42** — Focus coordination; tray ↔ canvas focus handoff, no dead ends in tab order

---

### Epic: Image Ingestion
*File picker immediately after Tray — unblocks real playtesting against user images.*

- [ ] **Story 43** — Spec: image ingestion impact on `jigg-spec`; image source, dimensions, library metadata
- [ ] **Story 44** — File picker + drag-drop own image onto canvas; replace hardcoded dev image
- [ ] **Story 45** — Static curated library (10–15 CC0 images); `metadata.json` drives picker UI
- [ ] **Story 46** — Image of the day; deterministic rotation (`dayOfYear % count`), featured on load

---

### Epic: App Shell
*Chrome shaped around the proven tray mechanic and real image input.*

- [ ] **Story 47** — Spec: app shell impact on `jigg-spec`; session init, grid size, difficulty
- [ ] **Story 48** — New puzzle flow; image source picker → grid size selector → launch
- [ ] **Story 49** — HUD; piece counter + elapsed timer, togglable
- [ ] **Story 50** — Reference image panel; draggable DOM overlay, snaps to nearest corner on release, resizable, fullscreen option, hotkey toggle (`R`), collapsed by default, ARIA landmark, meaningful `alt` text
- [ ] **Story 50b** — Ghost underlay mode; opt-in semi-transparent overlay on canvas, opacity slider 0–100%, `pointer-events: none`. Continuous coordinate transform synced to viewport pan and zoom via event listener — DOM position updates on every viewport move event. Gated on Story 50.
- [ ] **Story 50c** — High contrast integration; when Story 37 high contrast active, reference panel offers edge-only view toggle. Gated on Stories 50 and 50b.
- [ ] **Story 51** — Completion animation; payoff moment on solve
- [ ] **Story 52** — Settings panel; texture variant, snap sensitivity, rotation On/Off, accessibility toggles from Story 37

---

### Epic: Persistence
*IndexedDB-first. Flat + serializable for future Supabase sync.*

Note: Story 53 (spec) runs in parallel with App Shell. Stories 54–55 explicitly gated on Story 48 — no session model exists until then.

- [ ] **Story 53** — Spec: persistence model; canonical vs actual transforms per piece, session schema (including `rotationEnabled`), session reset trigger (destructive settings change e.g. grid size mid-puzzle prompts "Starting a new puzzle will lose your current progress. Continue?"), sync extension points
- [ ] **Story 54** — Auto-save to IndexedDB; debounced ~2s on snap, place, rotate, tray interaction. Gated on Story 48.
- [ ] **Story 55** — Resume on load; detect in-progress session, offer Continue or New Game. Gated on Story 48.

---

### Epic: Usage Tracking
*Anonymous only, no accounts. Pull into launch window — want data from user one.*

- [ ] **Story 56** — Spec: tracking impact on `jigg-spec`; conscious call, likely no changes needed
- [ ] **Story 57** — Anonymous device UUID; generate on first load, persist in IndexedDB
- [ ] **Story 58** — Supabase event logging; fire-and-forget on `puzzle_started`, `puzzle_completed`, `puzzle_abandoned`
- [ ] **Story 59** — Umami integration; standard snippet, configure goals for start/complete events
- [ ] **Story 60** — Privacy notice; minimal inline copy, no consent wall needed for anonymous data

---

### Epic: PWA
*Low effort given the stack. Last mile before launch.*

- [ ] **Story 61** — Spec: PWA impact on `jigg-spec`; asset manifest, cache strategy — likely no changes, conscious call
- [ ] **Story 62** — `vite-plugin-pwa`; manifest, service worker, precache app shell + WASM binary
- [ ] **Story 63** — Curated image cache strategy; lazy-cache on first access, not upfront precache

---

### Epic: Spec Doc
*Co-deliverable. Chapters written after each epic ships.*

- [ ] **Story 64** — Spec chapter: rendering pipeline (PixiJS, WebGL, shader decisions)
- [ ] **Story 65** — Spec chapter: cut algorithm (WASM, Canny, Bezier, content-aware routing)
- [ ] **Story 66** — Spec chapter: persistence model + sync extension points
- [ ] **Story 67** — Resolve Bezier geometry representation + spec chapter: cut algorithm math. Pulled forward — resolved during this chapter. **Public repo risk, do not defer past Story 66.**
- [ ] **Story 68** — Spec chapter: tray system + accessibility rationale
- [ ] **Story 69** — Spec chapter: what Jigg proves as a reference application

---

### Launch Sequence
```
NOW      Story 29         (Cleanup — before anything else)          ✓
         Story 30         (Tray spike — unblocks tray epic)
         Story 38         (Keyboard spike — parallel, get estimate early)
NEXT     Stories 31–37    (Tray epic — mechanic first)
         Stories 39–42    (Keyboard — informed by spike estimate)
         Story 44         (File picker — unblocks real playtesting immediately)
THEN     Stories 43–52    (Ingestion + Shell — content + chrome)
           50 → 50b → 50c (Reference image panel — sequential dependency)
         Story 53         (Persistence spec — parallel with Shell)
         Stories 54–55    (Persistence impl — gated on Story 48)
         Stories 56–60    (Tracking — pull into launch window)
         Stories 61–63    (PWA — last mile)
LAUNCH
POST     Story 19         (Z-order, informed by tray layering)
         Stories 64–69    (Spec — after each epic, Story 67 resolved at Story 66)
```

---

### Open / Deferred
- **Return-to-tray mechanic** — deferred pending user feedback post-launch. No architectural constraints added that prevent it later.
- **Stories 40–42 estimates** — not schedulable until Story 38 spike closes.

---

## Session Notes

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
