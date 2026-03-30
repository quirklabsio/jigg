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
- **Worker not terminated after both jobs complete**: Removing `terminateIfDone()` keeps the worker alive for debug key re-runs (1/2/3 keys rebuild cuts at different `edge_influence`). Acceptable cost: a small idle Web Worker. Restore termination after debug keys are removed.
- **`EDGE_INFLUENCE = 0.5` lives only in `cutter.ts`**: This constant is the single partition point for cut style configuration. Scene.ts imports and passes it; the worker receives it in the payload; the WASM call uses it. Future config UI or presets change only `cutter.ts`.
- **Endpoint pinning, not control-point adjustment**: When edge influence shifts a cut's baseline, only the INTERIOR of the path moves. `pts[0]` and `pts[18]` are pinned back to `cut_y_grid`/`cut_x_grid` after path generation. Adjusting the adjacent control points for a smooth transition would be complex and is not worth it — the kink at the endpoints is at the piece corner and is hidden by adjacent pieces' masks.
- **`roundPixels: true` as the mask antialias fix**: PixiJS v8 has no `antialias: false` on Graphics. StencilMask is binary, so alpha fringe isn't the issue. The gap comes from sub-pixel stencil boundaries leaving a pixel unclaimed. `roundPixels: true` snaps stencil vertices to integer device pixels, making shared boundaries deterministic.
- **`scene.ts` touched despite "touch only" spec**: Debug key bindings (1/2/3 for edge influence) and pipeline wiring (passing `edgeInfluence`/`imageWidth`/`imageHeight` in the GENERATE_CUTS payload) require scene.ts changes. The "touch only" constraint applied to production logic; the debug feature explicitly requires scene.ts.

## Rendering / Shaders
- **lightAngle hardcoded to 45° (top-left)** — no UI for light direction, universal jigsaw convention. `BevelFilter rotation: 225` (= lightAngle + 180 in BevelFilter's convention). Revisit if surface texture story needs it.

## Process
- **Never commit without user testing** — always present the completed work and wait for explicit user approval before running `git commit`. No exceptions, not even for "obviously correct" changes.
