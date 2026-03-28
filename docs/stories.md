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
- [ ] Story 11: Board snap (group snaps to correct world position)
- [ ] Story 12: Detect puzzle completion

## Epic: Smart Cutting
- [ ] Story 13: Edge detection in WASM → visualize overlay
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
Last completed: Story 10 — Board border + slot grid overlay
Next: Story 11 — Board snap (group snaps to correct world position)
