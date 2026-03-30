# Stories

## Epic: Core Pipeline (de-risk first)
- [x] Story 1: WASM pipeline proof of life
- [x] Story 2: PixiJS canvas init + image load
- [x] Story 3: Connect WASM output to PixiJS canvas

## Epic: Core Puzzle Loop
- [x] Story 4: Grid cut — divide image into NxN sprites
- [x] Story 5: Scatter pieces on load
- [x] Story 6: Drag and drop a piece
- [x] Story 7: Refactor to group model (PieceGroup, drag moves group)
- [x] Story 8: Rotate a piece/group (double-tap, 90° increments)
- [x] Story 9: Piece-to-piece snap (merge groups on compatible edge proximity)
- [x] Story 10: Board border + slot grid overlay
- [x] Story 11: Board snap (group snaps to correct world position)
- [x] Story 12: Detect puzzle completion

## Epic: Smart Cutting
- [x] Story 13: Edge detection in WASM → visualize overlay
- [x] Story 14: Bezier cut generation from edge map
- [x] Story 15: Content-aware cut routing (follows contours)

## Epic: Piece Fidelity
- [x] Story 16: Bevel shader on cut edges
- [ ] Story 17: Surface texture variants (matte/glossy/canvas/wood)
- [ ] Story 18: Soft shadows relative to light source
- [ ] Story 19: Realistic stacking z-order

## Epic: Workspace
- [ ] Story 20: Infinite canvas + zoom with inertia
- [ ] Story 21: Pan with momentum
- [ ] Story 22: Zoom-locked reference image panel
- [ ] Story 23: Ghost image underlay with opacity control

## Epic: Sorting Tools
- [ ] Story 24: Edge piece detection + filter
- [ ] Story 25: Color clustering (k-means in worker)
- [ ] Story 26: Touched-but-unplaced dot marker

## Epic: Persistence
- [ ] Story 27: Save piece and group state to IndexedDB via Dexie
- [ ] Story 28: Restore full puzzle state on load
- [ ] Story 29: Export completed image as download

## Epic: Completion Sequence
- [ ] Story 30: GSAP timeline — pull-back, sharpen, fuse, glow

---

## Current Session
Last completed: Story 16 — Bevel shader on cut edges
Next: Story 17 — Surface texture variants

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
- Debug key bindings in `scene.ts`: 1→0.0, 2→0.5, 3→1.0 — rebuilds cuts without page reload; remove after story is verified
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
- Edge overlay in `scene.ts`: cyan RGBA canvas → `Texture.from(canvas)` → Sprite at board position, `alpha=0.6`, `zIndex=999`, starts hidden, `E` toggles
- `wasm-pack: command not found` on first run — `~/.cargo/bin` not on PATH; fix in `gotchas.md`
- `Vec<u8>` return maps to `Uint8Array` after wasm-pack build — no manual cast needed

### Story 12 notes
- `isComplete` in `completion.ts` — pure O(n) early-exit check over `piecesById`
- Completion check inlined in `markGroupPlaced` (store) to avoid circular dep: `puzzleStore` ↔ `completion`
- `puzzleComplete: boolean` added to Zustand store; set once, never unset
- `onComplete(app, hitLayer, totalCount)` — disables hit layer, logs, triggers fade-in message
- `showCompletionMessage` in `ui.ts` — PixiJS Container at zIndex 9999, dark panel + white 32px text, Ticker fade 0→1 over 2s
- Completion checked in `setBoardSnapCallback` in `scene.ts` after board snap fires
