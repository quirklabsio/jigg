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
- [ ] Story 15: Content-aware cut routing (follows contours)

## Epic: Piece Fidelity
- [ ] Story 16: Bevel shader on cut edges
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
Last completed: Story 14 tab refinement + snap regression fix
Next: Story 15 — Content-aware cut routing

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
