# Decisions

Do not revisit without asking.

## Stack
- **PixiJS over Canvas 2D** — performance ceiling with 200 pieces, shadows, and shaders
- **PixiJS over Three.js / Babylon.js** — full 3D engines are overkill for pseudo-3D effects
- **Zustand over Redux** — outside-React access pattern is a hard requirement
- **Rust/WASM over OpenCV.js** — bundle size 7MB+; we only need edge detection
- **No accounts** — IndexedDB is the intentional persistence layer, cross-device sync is v2
- **No backend** — fully client-side is architecturally honest for the no-account promise
- **GSAP isolated to completion sequence** — PixiJS Ticker handles the game loop

## Puzzle Model
- **Freeform group assembly** — pieces snap to each other anywhere in world space, not just on the board. Groups move as a unit. Single unconnected piece = group of one. Decided before Story 7.
- **Rotation in 90° increments** — double-tap to rotate, simpler snap logic, works on mobile and desktop
- **Grid-based correct positions** — each piece has a fixed world space correct position set once on creation. Board snap is distance-from-anchor. Piece-to-piece snap is neighbour lookup via gridCoord.

## Drag & Input
- **Single hit layer for drag** — one transparent `Graphics` overlay with `eventMode='static'` handles all pointer events; sprites stay permanently `eventMode='none'`. Avoids per-sprite event listener accumulation and toggling overhead.
- **Spatial hash for hit detection** — groups indexed into cell grid (CELL_SIZE=128); pointerdown queries only cells under the pointer rather than iterating all groups.
- **Monotonic settleCounter for z-index** — each drop increments a module-level counter and assigns it to all sprites in the group. No constants, no cycling. Initialised to `spriteMap.size` so first drop clears all initial per-index values.
- **Rotation-aware hit test** — transform pointer into sprite local space via inverse rotation, then check against `texture.frame` half-extents. `s.width` is wrong for rotated sprites.
- **activePointerId pointer lock** — prevents two groups being dragged simultaneously; checked on every pointermove and pointerup.
- **pointerupoutside on stage** — prevents stuck-drag when pointer leaves canvas.
- **baseScale captured at drag start** — not at init time, so scale is correct if pieces have been resized.
- **DRAG_SCALE solo-only** — scale lift on drag only applied when group has exactly 1 piece. Multi-piece groups scale individual sprites around their own centers, creating visible gaps at inner edges.

## Completion Detection
- **Completion check inlined in store, not imported from `completion.ts`** — avoids a circular dependency (`puzzleStore` → `completion` → `puzzleStore`). The check is three lines and belongs conceptually in `markGroupPlaced` anyway. `isComplete` still lives in `completion.ts` as a pure utility for external callers.
- **`onComplete` receives `totalCount` as a param** — avoids `completion.ts` importing `usePuzzleStore`. `scene.ts` is the natural owner of both `app`, `hitLayer`, and store access; it passes what's needed.
- **Completion message is screen-space PixiJS, not DOM** — UI container at `zIndex: 9999` with `app.screen` coordinates stays centred regardless of zoom/pan. No DOM elements for in-puzzle UI (consistent with the PixiJS-owns-canvas principle).
- **Hit layer disabled on completion, not pieces individually** — setting `hitLayer.eventMode = 'none'` is a single call that stops all interaction. Per-piece toggling would be error-prone as piece count grows.

## WASM / Worker
- **Direct wasm-pkg import over dynamic `/wasm/` path import**: Workers import `init` and exported functions from `../wasm-pkg/jigg_analysis.js` directly rather than the earlier `import(/* @vite-ignore */ '/wasm/...')` pattern. Direct import is statically typed (no manual casts), tree-shaken by Vite, and avoids maintaining a separate `public/wasm/` copy. `wasm-pkg/` files are generated artifacts — committed but not hand-edited.
- **Edge overlay starts hidden, toggled with E**: Always-on overlay is too noisy during normal play. Debug overlays default to `visible=false`; developer toggles with a key. Consistent pattern for all future debug layers.

## Jigsaw Tab Shape
- **6-segment (19-point) cubic Bezier path per cut**: 5 segments (16 pts) could not produce a geometrically correct dome head — the single cap segment always produced a flat-topped bump. Splitting the cap into two quarter-circle arcs (K=0.5523 Bezier constant) gives G1-continuous joins at entry, tip, and exit, and a true dome shape regardless of tab size.
- **K=0.5523 for quarter-circle arcs**: this constant (`4/3*(√2-1)`) is the standard Bezier approximation for a 90° arc. Each quarter arc is a single cubic segment; two arcs = semicircular dome. Applied symmetrically so the tab and blank are exact inverses.
- **neck_y = cut_y + tab_dy − sgn·r**: this formula places the dome entry such that `tip_y − neck_y = r` always, giving a dome of radius r regardless of piece aspect ratio. The head is always a true semicircle.
- **`cutter.ts` reads cut-point arrays generically** (loop step 3 from index 1): any `1+3n` point count works. Adding or removing segments in Rust requires no TypeScript changes.
- **`textureRegion` is the authoritative grid size**: expanded texture frames (for tab padding) must not be used to derive grid piece dimensions in snap or hit-test logic. Always read `piece.textureRegion.w/h`.

## Edge-Aware Cut Routing (Story 15)
- **Worker stores edgeMap copy, not re-runs analyze_image**: `ANALYZE_IMAGE` and `GENERATE_CUTS` are sent simultaneously. The worker stores `edgeMap.slice()` at module scope during ANALYZE_IMAGE so GENERATE_CUTS can reuse it. This works because JavaScript's microtask queue guarantees ANALYZE_IMAGE's continuation runs before GENERATE_CUTS's when both `await` the same already-resolved `initPromise` — messages are processed in receive order.
- **Worker not terminated after both jobs complete**: The worker stays alive after ANALYZE_IMAGE and GENERATE_CUTS finish. Small idle cost, acceptable. Debug keys (1/2/3) that originally motivated this were removed in Story 16; the worker simply remains alive as settled behaviour — no `terminateIfDone` call.
- **`EDGE_INFLUENCE = 0.5` lives only in `cutter.ts`**: This constant is the single partition point for cut style configuration. Scene.ts imports and passes it; the worker receives it in the payload; the WASM call uses it. Future config UI or presets change only `cutter.ts`.
- **Endpoint pinning, not control-point adjustment**: When edge influence shifts a cut's baseline, only the INTERIOR of the path moves. `pts[0]` and `pts[18]` are pinned back to `cut_y_grid`/`cut_x_grid` after path generation. Adjusting the adjacent control points for a smooth transition would be complex and is not worth it — the kink at the endpoints is at the piece corner and is hidden by adjacent pieces' masks.
- **`roundPixels: true` as the mask antialias fix**: PixiJS v8 has no `antialias: false` on Graphics. StencilMask is binary, so alpha fringe isn't the issue. The gap comes from sub-pixel stencil boundaries leaving a pixel unclaimed. `roundPixels: true` snaps stencil vertices to integer device pixels, making shared boundaries deterministic.
- **`scene.ts` touched despite "touch only" spec**: Debug key bindings (1/2/3 for edge influence) and pipeline wiring (passing `edgeInfluence`/`imageWidth`/`imageHeight` in the GENERATE_CUTS payload) require scene.ts changes. The "touch only" constraint applied to production logic; the debug feature explicitly requires scene.ts.

## Workspace Background
- **Off-white WebGL clear color over Graphics rect**: Previously used a dark charcoal `Graphics` rect with `SimplexNoiseFilter`. Story 18b switched to off-white `#f5f5f3`. A `Graphics` rect produced triangle-seam artifacts on retina displays (see gotchas.md), so the background is now handled entirely by the WebGL clear color (`app.init({ background: '#f5f5f3' })`). Zero geometry, no possible seams. Body CSS background also set to `#f5f5f3` to prevent black gaps at canvas edges.

## Piece Shadows (DropShadowFilter)
- **Disabled after experimentation**: Container-wrapped DropShadowFilter was implemented (resting/dragging/placed states) but produced two issues: (1) `resolution: DPR` caused a thin vertical seam on retina displays, (2) at `resolution: 1` the effect was too subtle at low alpha values (0.04–0.10) to justify the rendering overhead and code complexity. Shadows disabled for now. Container wrapper architecture remains in place for future use. If re-enabled, use `resolution: 1` and mutate filter properties in place (never replace the `filters` array).

## Rendering / Shaders
- **lightAngle hardcoded to 45° (top-left)** — no UI for light direction, universal jigsaw convention. `BevelFilter rotation: 225` (= lightAngle + 180 in BevelFilter's convention). Revisit if surface texture story needs it.

## Tray Architecture (Story 32)

- **Unified strip toggle for open AND close**: A single `_stripHitArea` transparent-fill Graphics rect covers the tray strip and calls `setTrayOpen(!trayOpen)` regardless of current state. Two separate handlers (open vs close) were tried but caused the close path to silently fail when the chevron was stroke-only. Unified handler is simpler and always correct.
- **`_piecesContainer` with Graphics mask for overflow clipping**: Piece containers live inside `_piecesContainer` (a child of `_trayContainer`) rather than directly in the tray container. A `Graphics` mask on `_piecesContainer` clips pieces to the tray body, preventing overflow during layout. The mask rect is redrawn on every `redrawBackground()` call.
- **2-row wrap with `piecesPerRow`**: Single flat row would overflow to 1200px+ for 16 pieces. Two rows (`TRAY_ROWS = 2`) with `piecesPerRow = Math.floor((screenW() - PAD) / slotW)` adapts to viewport width. Wrap is recalculated on every `layoutTrayPieces()` call.
- **`screenW()` utility**: `Math.max(app.screen.width, window.innerWidth)` — always returns the larger of the two because `app.screen.width` lags one frame after `window.resize`. Avoids a class of resize bugs where tray doesn't extend full width on first resize event.
- **Dual resize listeners**: Both `window.addEventListener('resize')` and `app.renderer.on('resize')` call `onTrayResize`. Window fires first (with `window.innerWidth` correct), renderer fires after (with `app.screen.width` correct). Either event alone would miss one scenario; both together handle fullscreen, DPR changes, and normal resize.
- **`_trayDisplayOrder` shuffled array separate from store order**: Module-level `_trayDisplayOrder: string[]` is Fisher-Yates shuffled on `initTray`. Filtered on each layout pass to show only `state === 'in-tray'` pieces. Store piece array order is never mutated for display randomisation — keeps store as the authority for puzzle state, tray as the authority for display order.
- **Archimedean spiral origin locks on first click, resets on viewport pan**: Spiral origin (`spiralOriginX/Y`) is set once when the first piece is click-extracted and held until the viewport moves. This lets rapid successive clicks build a coherent cluster rather than spreading to random world positions. Viewport `moved` event resets the origin so the next spiral starts at the new screen center.

## Filter Strip (Story 34)

- **`flatSides >= 2` for corner, not `=== 2`**: for any puzzle with rows ≥ 2 and cols ≥ 2, corner pieces always have exactly 2 flat sides. Using `>= 2` gracefully handles degenerate grids (1×1, 1×N) where pieces can have 3–4 flat sides; they classify as corners, which is the least surprising behaviour. No production puzzles hit this branch.
- **`activeFilter` lives in Zustand store, not tray module state**: filter is puzzle-session data, not UI-only state. Storing it in the store means it resets cleanly on `setPieces` (new puzzle start), can be persisted in Story 54, and is accessible from outside `tray.ts` without a getter. Tray module state would have required an exported getter or reset hook.
- **Filter strip is a non-scrolling sibling of `_gridContainer` inside `_piecesContainer`**: placing `_filterContainer` at `y=0` inside `_piecesContainer` (with `_gridContainer` offset to `y=FILTER_STRIP_HEIGHT`) means the filter buttons are clipped by the same mask as the piece grid (correct), but are unaffected by `_gridContainer.x = -_scrollX` (also correct). The alternative — placing the strip directly in `_trayContainer` above `_piecesContainer` — would have required adjusting `_piecesContainer.y` and recomputing the mask, with more moving parts.
- **`renderFilterStrip()` recreates children on every call**: filter buttons are rebuilt from scratch each time `layoutTrayPieces()` runs (on piece extraction, filter change, resize). The call frequency is low enough that recreation cost is negligible. The alternative — mutating existing button Graphics/Text in place — would require tracking per-button references and adds complexity for no measurable gain.
- **Empty state message only for `allInTray.length === 0`**: when a filter produces an empty view but pieces remain in the tray, the empty grid space is the message — the zero counts on the filter buttons explain it. Showing "No pieces match filter" text would require a second text object, conditional logic, and a different message per scenario. The counts make it self-explanatory.
- **`T` key added to existing `keydown` handler in `scene.ts`**: keeps all keyboard shortcuts co-located (F for FPS, T for tray). Adding a second `keydown` listener in `tray.ts` would work but scatter shortcuts across files without benefit. Guard (`INPUT`/`TEXTAREA`/`SELECT` tag check) added to all key handling since it was missing — it applies to both T and F now.

## Color Zone Filter (Story 35)

- **k-means runs synchronously inside `gridCut()`, not deferred via setTimeout**: at 4×4=16 pieces the clustering is under 1ms. The spec noted deferral as an option only if profiling revealed a problem. It didn't, so we kept it synchronous — simpler call path, zones are available before `initTray` runs, no intermediate state where pieces have no zone.
- **`pixelData` is an optional param on `gridCut()`**: if absent, `colorVector` defaults to `[128, 128, 128]` and k-means is skipped. Backwards compatible; future tests or environments without pixel access still work. The optional param also makes the call site's intent explicit (`gridCut(..., imageData.data)` — you chose to pass colour data).
- **Swatch fill = mean colorVector of ALL pieces, not just in-tray pieces**: the zone colour represents the image region, not the current tray state. If computed from in-tray pieces, swatch colour would drift as pieces are extracted — a swatch for a sky-blue zone would slowly grey as sky pieces left the tray. Fixed fill is the right semantic.
- **OffscreenCanvas extracted once in `loadScene`, reused for k-means and WASM worker**: the previous code created the OffscreenCanvas and drew the texture twice — once implicitly (earlier attempt) and explicitly for the worker. Extracting it once at the top of `loadScene` and reusing the `imageData.data` reference eliminates the duplicate canvas alloc, reduces peak memory, and makes the data-extraction site unambiguous.
- **Color zone and edge type filters share one `activeFilter` in the store**: no second filter slot needed. The filter is mutually exclusive by design (selecting a swatch clears the edge button highlight and vice versa). A single `activeFilter: TrayFilter` handles both; `visibleInTray()` switches on whether the filter starts with `'zone-'` or matches an edge type. If future stories need multi-select or combined filters, a separate slot can be introduced then.
- **Swatch area reserved on the right, text buttons occupy the remainder**: rather than dividing the strip into 9 equal buttons (4 text + 5 swatches), the right `SWATCH_AREA_W = 148px` is reserved for swatches and the text button area scales with viewport width. Swatches are a fixed visual size regardless of screen width; text buttons need space for their label + count. Mixed fixed/fluid layout is the correct split here.
- **`edgeType` remains grid-position-only**: Story 36b defers content-aware edge detection (checking alpha at borders for shaped/circular images) to a separate story. `gridCut()` computing it from pixel content would conflate two concerns and slow the simpler rectangular case.

## Process
- **Never commit without user testing** — always present the completed work and wait for explicit user approval before running `git commit`. No exceptions, not even for "obviously correct" changes.
