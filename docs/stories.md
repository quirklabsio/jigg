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
- [ ] Story 14: Bezier cut generation from edge map
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
Last completed: Story 13 — Edge detection in WASM → visualize overlay
Next: Story 14 — Bezier cut generation from edge map

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
