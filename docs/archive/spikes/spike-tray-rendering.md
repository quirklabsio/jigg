# Spike: Tray Rendering Model (Story 30)

**Date:** 2026-04-03
**Status:** Complete — Approach C selected
**Unblocks:** Stories 31–37

---

## Context

The tray is a bottom drawer that holds all unplaced pieces. Pieces populate on puzzle load; canvas starts empty. Piece state machine: `in-tray` → `on-canvas` → `placed`. Tray is staging only — no manipulation inside. Pushes viewport up when open, collapses to a strip when closed.

Current architecture constraints relevant to this decision:
- Single PixiJS `Application` with one `WebGLRenderer`
- `pixi-viewport` container holds all world-space content (`viewport` is a child of `app.stage`)
- Single transparent `Graphics` hit layer inside `viewport` handles all pointer events
- Spatial hash (128×128 cells) for O(1) hit detection — indexes world-space groups
- Sprites permanently `eventMode='none'`; all pointer events go through hit layer
- Architecture principle: **"PixiJS owns the canvas — never use DOM elements for puzzle pieces or in-puzzle UI"**

---

## The Three Approaches

---

### Approach A: Separate PixiJS Stage

A second `Application` (second WebGL context) owns the tray. Tray pieces are sprites in this stage. Two renderers, shared `Assets` cache for CPU-side texture data.

#### Texture memory at scale (500+ pieces)
**Bad.** `Assets` shares CPU-side texture data but not GPU uploads. Each `WebGLRenderer` has its own GL context and uploads its own copy of every texture to VRAM. At 500 pieces, VRAM usage doubles. On mobile where VRAM is shared with system RAM, this is a hard limit — mobile Safari allows only 8–16 concurrent WebGL contexts and already penalises multiple contexts with reduced texture budgets.

#### State sync
Zustand is the single source of truth; both renderers subscribe to state changes independently. The sync model is fine — this is the least problematic dimension of Approach A.

#### Extraction moment
On drag-out from tray:
1. Destroy or remove the tray sprite from the tray stage.
2. Create an equivalent sprite in the main stage inside `viewport`.
3. Position at world coordinates derived from `viewport.toWorld(pointerPosition)`.
4. Continue drag.

This is a **discontinuous handoff** — the piece visually disappears and reappears at the frame boundary when the new sprite is created. Even with careful timing, the piece is absent from both stages for at least one frame. The coordinate conversion is straightforward, but the sprite-recreation step is unavoidable. There is no "reparent across contexts" in WebGL.

On spiral-click placement: same sprite-recreation pattern, just without user-driven coordinates.

#### Zoom-to-piece (Story 36)
Viewport controls (`viewport.animate()`) live in the main renderer's module scope. Tray code must hold a reference to the viewport instance, passed at init. Achievable but indirect — the tray renderer is conceptually decoupled from the main renderer but needs to reach back into it for this feature.

#### Keyboard accessibility (Story 38)
The tray renderer produces a second `<canvas>` element in the DOM. The virtual cursor model needs to maintain two separate DOM accessibility trees (one per canvas), or a single DOM tree that maps to both. Tray tab order and canvas tab order crossing a renderer boundary is awkward and non-standard. Higher implementation risk for the keyboard epic.

#### Return path (deferred)
Creating a return animation means: destroy canvas sprite, recreate tray sprite, animate in tray stage. Same discontinuous handoff in reverse. No smooth cross-renderer animation is possible.

#### Existing architecture impact
- Hit layer: not affected for main canvas. Tray needs its own separate pointer event wiring in the second renderer.
- Spatial hash: not affected.
- Group model: tray pieces could be excluded from PieceGroups until extraction — clean.
- The second GL context is the core risk: mobile context limits, doubled VRAM, no cross-context reparenting.

**Verdict: Eliminated.** Doubled VRAM at scale, discontinuous extraction handoff, mobile GL context risk, awkward keyboard accessibility story.

---

### Approach B: DOM Thumbnails

Tray is a DOM element. Piece thumbnails are `<canvas>` or `<img>` elements generated from the original image. PixiJS owns nothing in the tray.

#### Texture memory at scale (500+ pieces)
Two cost centres:
1. PixiJS GPU textures remain in VRAM for pieces once extracted to canvas (normal).
2. DOM thumbnails require CPU-side copies of each piece's pixel data. If generated via WebGL readback (`renderer.extract`), this triggers a GPU→CPU transfer per piece, which is expensive and synchronous. If generated from the original `imageUrl` via `drawImage` on 2D `<canvas>` elements (using `textureRegion` for crop coordinates), the GPU readback is avoided — but thumbnails are then rectangular crops, not jigsaw-shaped. Acceptable for a staging area, but a visual compromise.

At 500 pieces with ~128px thumbnails: ~33MB of CPU-side bitmap data. Not catastrophic but non-trivial.

#### State sync
DOM updates driven by Zustand. Each piece's `<canvas>` or `<img>` is hidden when the piece transitions to `on-canvas`. Clean model.

#### Extraction moment
On drag-out from DOM thumbnail:
1. Hide the DOM element.
2. Convert DOM pointer coordinates to PixiJS world coordinates via `viewport.toWorld()`.
3. Create a PixiJS sprite (with full jigsaw mask and filters) inside `viewport` at that world position.
4. Wire the sprite into the drag system (spatial hash, group model).
5. Hand off to `drag.ts`.

This is the **roughest extraction of the three approaches.** The visual jump from rectangular DOM thumbnail to jigsaw-masked PixiJS sprite is inherently discontinuous. The sprite creation at extraction time also means jigsaw mask geometry must be generated on-demand rather than kept warm, or kept in memory but detached from any stage — adding bookkeeping.

On spiral-click: similar creation flow but with a computed world position. Less rough since the piece appears at a distinct location rather than under the user's pointer.

#### Zoom-to-piece (Story 36)
Viewport reference must be accessible from DOM tray event handlers. Doable via module-level singleton or Zustand, but the tray is now a DOM event world — `viewport.animate()` is called from a `mousedown` handler. Not architecturally wrong, just cross-domain plumbing.

#### Keyboard accessibility (Story 38)
This is the one dimension where Approach B wins. DOM thumbnails are natively accessible: natural tab order, `aria-label`, focus rings via CSS, browser-managed. Aligns well with the virtual cursor model. However the virtual cursor model is specifically designed to provide keyboard access to **PixiJS canvas state** — pieces on the canvas. The tray portion is cleanly handled by native DOM accessibility, but the boundary between tray (DOM) and canvas (virtual cursor) must be bridged carefully.

#### Return path (deferred)
Canvas sprite → DOM thumbnail:
1. Remove PixiJS sprite from stage.
2. Re-render thumbnail to DOM element (from original image crop, or from a cached bitmap).
3. Show DOM element.

The handoff is rough — same discontinuity as extraction, in reverse. No smooth animation across the DOM/WebGL boundary.

#### Existing architecture impact
- **Violates the architecture principle: "PixiJS owns the canvas — never use DOM elements for puzzle pieces or in-puzzle UI."** This is a locked decision. Approach B directly contradicts it.
- Hit layer: not affected.
- Spatial hash: not affected until extraction.
- Sprite creation at extraction time adds a new path not present in the current system.

**Verdict: Eliminated.** Violates the architecture principle. Rough extraction handoff. DOM/PixiJS boundary creates permanent friction at the most important interaction in the tray epic.

---

### Approach C: Reserved Canvas Region ✓ SELECTED

Tray is a fixed screen-space `Container` added directly to `app.stage`, outside the `pixi-viewport` container. Viewport's screen-space render area resizes dynamically when the tray opens/closes:

```typescript
viewport.resize(app.screen.width, app.screen.height - TRAY_HEIGHT);
```

Tray pieces are standard PixiJS sprites positioned in screen-space within the tray container. No second renderer. No DOM elements for pieces.

#### Texture memory at scale (500+ pieces)
**Zero duplication.** One GPU context, one `Assets` cache, one texture upload per piece region. Tray sprites reference the same `Texture` objects as their eventual canvas counterparts. At 500 pieces, VRAM usage is identical to a world where all pieces start on the canvas.

#### State sync
One PixiJS stage, one Zustand store. The tray container subscribes to Zustand state changes and shows/hides sprites based on `piece.state === 'in-tray'`. No cross-renderer coordination. The source of truth is unambiguous: Zustand owns state, the single PixiJS stage renders it.

#### Extraction moment

**Drag extraction:**
1. User pointerdown on a tray sprite (tray container handles its own pointer events — it sits at a higher `zIndex` than `viewport`, so PixiJS event propagation naturally gives it priority).
2. On tray-exit threshold (pointer y crosses tray boundary): reparent the sprite from the tray container into `viewport`.
3. Coordinate conversion: `viewport.toLocal(sprite.getGlobalPosition())` gives the world-space position to assign. This is one function call.
4. Wire into drag system: add to spatial hash, assign to a PieceGroup, hand off to `drag.ts`.
5. Drop shadow activates, opacity normalises — per the design decision.

The reparent is a live DOM-tree operation within one renderer. The sprite is never destroyed or recreated. It moves. No frame where the piece is absent from both containers.

**Spiral-click extraction:**
1. Compute the world-space spiral position.
2. Reparent sprite from tray container to `viewport`.
3. Set world position directly. Animate from tray edge to spiral position if desired (optional, one Ticker).

The key mechanic — the sprite is the same object throughout — is what makes Approach C cleanly superior here.

#### Zoom-to-piece (Story 36)
`viewport` is a module-level export (or accessible via a singleton pattern already established in `scene.ts`). Tray code can call `viewport.animate({ position: worldPos, scale: targetZoom })` directly. No cross-renderer indirection. This is a one-liner once the tray has the world position from the piece's `canonical` transform.

#### Keyboard accessibility (Story 38)
Tray sprites are in screen-space. The virtual cursor model needs to render a focus ring on the PixiJS stage — tray focus ring positioning is trivial because `sprite.getGlobalPosition()` gives screen coordinates directly (no world→screen transform needed, since tray sprites are already in screen space). The virtual DOM tree maps one hidden `<button>` per tray piece, positioned over the corresponding screen-space sprite. Tab order across tray and canvas is a single DOM tree. Clean.

#### Return path (deferred)

**Retrofit cost: medium.** The forward path (tray → canvas) is a sprite reparent with coordinate conversion. The reverse path (canvas → tray) is the same operation in reverse:

1. World position → screen position: `viewport.toGlobal(sprite.getGlobalPosition())` (or equivalent).
2. Reparent sprite from `viewport` into the tray container.
3. Set screen-space position within the tray grid.

The complexity is the **mid-animation coordinate space switch**. A smooth return animation requires:
- Phase 1: animate in world space toward the tray edge (via Ticker, normal drag deceleration or a dedicated tween).
- At tray boundary: snapshot screen position → reparent → continue animation in screen space to tray slot.

The snapshot-and-reparent at the boundary is a single-frame operation. With careful timing it is imperceptible. This is doable but requires a `TrayReturnAnimator` or equivalent — it's non-trivial code, not a one-liner. However, it is **categorically smoother** than Approach A's cross-renderer sprite recreation or Approach B's DOM/WebGL handoff. PixiJS-managed return animation wins on smoothness, as expected.

#### Existing architecture impact

**Hit layer:**
The tray container sits at a higher `zIndex` on `app.stage` than `viewport`. PixiJS event propagation gives the tray container priority. The existing hit layer (inside `viewport`) continues to intercept all world-space canvas events. Tray pointer events never reach the hit layer. No changes to the hit layer required.

**Spatial hash:**
Tray pieces are not in world space and are not in the spatial hash. The hash is only populated when a piece is extracted to canvas (when it gets a PieceGroup and a world position). No changes required.

**Pointer lock:**
`activePointerId` lock is in `drag.ts` and applies only to world-space drag. Tray has its own, simpler pointer tracking. No conflict.

**Group model:**
Tray pieces do not need to belong to PieceGroups while `in-tray`. A PieceGroup is created at extraction time (single-piece group). This is consistent with the existing pattern where `cutter.ts` creates one group per piece on puzzle creation — the tray model just defers that moment.

**`scatter.ts`:**
Must be gutted per Story 32 — the scatter-on-load behaviour is replaced by tray-on-load. The random distribution math should be preserved (commented out or extracted) for potential future use.

**`viewport.resize()`:**
This is a documented API call on `pixi-viewport`. It is the intended mechanism for resizing the viewport's screen-space render area. No hacks or workarounds.

---

## Decision

**Approach C: Reserved Canvas Region.**

Rationale:
1. Zero texture duplication — single GPU context, single `Assets` cache.
2. Extraction is a sprite reparent, not a sprite recreation — no frame where the piece is absent.
3. Coordinate conversion at extraction is one `viewport.toLocal()` call.
4. Zoom-to-piece (Story 36) is a direct `viewport.animate()` call — no cross-renderer indirection.
5. Consistent with the architecture principle: PixiJS owns the canvas, no DOM elements for pieces.
6. Return path animation is achievable within one renderer — smooth, no DOM/WebGL handoff.
7. No new dependencies, no second GL context, no mobile context budget risk.

---

## Return Path Retrofit Cost (Approach C)

**Medium.** Not architecturally foreclosed — the sprite is alive in the PixiJS stage throughout, so reparenting back to the tray container is always possible. The cost is in the **mid-animation coordinate space switch** at the tray boundary. Implementation requires:

- A `TrayReturnAnimator` or equivalent that owns the transition: world-space deceleration → snapshot screen position → reparent → screen-space approach to tray slot.
- Spatial hash must be updated (piece removed) at transition start.
- Group model: dissolve the PieceGroup at transition start (piece returns to `in-tray`, group is removed if it becomes empty).

Estimated scope: ~150–200 lines including animation and state cleanup. Non-trivial but well-contained. The return path for groups (multiple connected pieces returning to tray together) adds additional complexity and is correctly deferred pending user feedback.

---

## Constraints Discovered That Affect Stories 31–37

1. **`scatter.ts` must be gutted in Story 32, not just skipped.** If scatter still fires on load, pieces end up in world space instead of the tray. The scatter math must be preserved but the scatter-on-load call must be removed. Story 32 owns this.

2. **PieceGroup creation is deferred to extraction time under Approach C.** `cutter.ts` currently creates one group per piece immediately. Under the tray model, pieces start without a group (or in a placeholder `in-tray` state). The group creation path must be refactored in Story 32. The Piece type needs a `state: 'in-tray' | 'on-canvas' | 'placed'` field — this is the Story 31 spec work.

3. **Tray container z-index must be above `viewport` but below UI overlays.** The completion message (`ui.ts`) sits at `zIndex: 9999`. The tray container should sit at an intermediate value (e.g. `zIndex: 500`). The current stage has: `viewport` (world content), `hitLayer` (inside viewport, `zIndex: 1000` in world space), `ui` container (`zIndex: 9999` in screen space). Tray container at `zIndex: 500` on `app.stage` is clean.

4. **Tray pointer events must not fire during canvas drag.** When a canvas drag is active (`activePointerId` is set), the tray container's pointer events should be suppressed. This requires tray code to check drag state before handling tray pointer events. A shared `isDraggingCanvas()` guard is the cleanest interface.

5. **`viewport.resize()` on tray open/close must happen before rendering the tray frame**, not after, to avoid a one-frame misalignment where the viewport renders into the tray region.

6. **Tray layout is screen-space grid layout** (Story 33) — a solved problem within a PixiJS Container. Piece sprites are repositioned within the tray container on filter changes. This is straightforward since all positions are local to the container.

---

## Complexity Signals for Stories 31–37 (Under Approach C)

| Story | Title | Signal | Notes |
|-------|-------|--------|-------|
| 31 | Spec: tray impact on jigg-spec | **straightforward** | Piece state field, extraction UX, tray-first load behaviour, rotation session property. No novel concepts — documenting decisions already made. |
| 32 | Bottom drawer tray | **non-trivial** | `scatter.ts` gutting, deferred PieceGroup creation, `viewport.resize()` on open/close, drawer open/close animation, tray container setup on stage. Multiple moving parts but all within one renderer. |
| 33 | Tray layout | **straightforward** | Grid layout within a screen-space Container. Sprite repositioning on filter change. Zustand subscription drives updates. |
| 34 | Piece filtering (corner/edge/interior) | **trivial** | Show/hide tray sprites based on piece metadata. Filter metadata pre-computed at cut time. Single-select strip is pure UI state. |
| 35 | Color zone filter | **trivial** (given metadata) | Same show/hide mechanic as Story 34. Complexity is in the k-means clustering at cut time — but that's WASM/cutter work, not tray rendering work. |
| 36 | Zoom-to-piece | **straightforward** | `viewport.animate({ position: piece.canonical, scale })` is a direct call. World position is always available from `piece.canonical`. Need to confirm `pixi-viewport` animate API supports easing. |
| 37 | Accessibility modes | **straightforward** | High contrast: filter/palette swap on tray sprites and canvas sprites uniformly. Label overlay: text sprites positioned over piece sprites. Reduced motion: disable inertia on `viewport.decelerate()`, disable tray drawer animation. All within one renderer. |
