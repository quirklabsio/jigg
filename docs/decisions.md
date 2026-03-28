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

## Process
- **Never commit without user testing** — always present the completed work and wait for explicit user approval before running `git commit`. No exceptions, not even for "obviously correct" changes.
