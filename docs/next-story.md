# Story 46e: Fix corner piece alignment — board size mismatch

## Context

User observed during 46b QA: 3 of 4 corner pieces sit with a small gap between the piece edge and the board edge. Top-left aligns; top-right, bottom-left, and bottom-right all show visible whitespace.

### Root cause (confirmed by inspection)

The board is drawn at the full image dimensions:

```ts
// src/canvas/board.ts:24-25
const bw = imageWidth  * scale;
const bh = imageHeight * scale;
```

But piece dimensions are truncated in the cutter (both `src/canvas/scene.ts` and `src/puzzle/cutter.ts`):

```ts
const pieceW = Math.floor(imageWidth  / cols);
const pieceH = Math.floor(imageHeight / rows);
```

So the total piece coverage is `cols * pieceW × rows * pieceH`, which is less than `imageWidth × imageHeight` by the remainder pixels. Corner pieces at canonical positions `(0,0)`, `((cols-1)*pieceW, 0)`, `(0, (rows-1)*pieceH)`, `((cols-1)*pieceW, (rows-1)*pieceH)` snap correctly, but the board rect extends past the right/bottom edges of the piece coverage by up to `cols-1` px on the right and `rows-1` px on the bottom (scaled by `scale`).

Example: 2048 × 1536 image, 15 × 11 grid → pieceW = 136, pieceH = 139. Piece coverage 2040 × 1529. Board 2048 × 1536. Gap: 8 px right, 7 px bottom (world units, then × scale for screen).

This is a Story-46-introduced bug. Pre-dynamic grids (the 4×4 era on 800×600, 2048×2048) happened to divide evenly.

## Requirements

### Fix

The snap area — where pieces can land — is `cols * pieceW × rows * pieceH`. The board should match the snap area, not the image. One canonical fix:

**A. Shrink the board to `cols * pieceW × rows * pieceH`.** The remainder pixels of the image are not part of any piece's texture frame anyway; they're invisible in puzzle-solving context. Update `createBoard` in `src/canvas/board.ts` to compute `bw = cols * pieceW * scale` and `bh = rows * pieceH * scale`. The caller in `scene.ts` already has `piecePixelW`/`piecePixelH` — either pass them through, or compute `Math.floor(imageWidth / cols)` inside `createBoard` (caller already passes `cols` and `rows`).

**B. Extend last-row/last-col pieces by the remainder.** Piece widths/heights become position-dependent. Last-col piece is `imageWidth - (cols-1) * pieceW` wide. Requires changes in cutter, snap, render. Significantly more invasive. Do not pick unless A has a fatal issue.

**C. Pad or crop the image pre-cut so dimensions divide evenly.** Re-normalize at image load. Loses a few pixels of content but clean. Ripples into the ingest pipeline (Story 44/45 territory) — probably wrong layer to fix at.

**Bias toward A.** If you pick anything else, explain why in `decisions.md`.

### Verify nothing else depends on `imageWidth/imageHeight`-sized board

Before implementing, confirm snap detection, completion detection, and anything reading the board rect don't assume `imageWidth × imageHeight` matches the snap area. Quick grep:

- `src/puzzle/snap.ts` — how does board-snap locate the target?
- `src/puzzle/completion.ts` — does completion check any global bounds?
- `src/canvas/scene.ts` — does anything pass `imageWidth/imageHeight` as an implicit board size?

Most likely snap uses canonical positions (per `engine-conventions.md` §"Grid-based correct positions") which are derived from `pieceW`/`pieceH` and are self-consistent — snap logic should be unaffected. But verify, don't assume.

## Constraints

- **Do not touch `Math.floor` in piece dimension computation.** Integer piece dimensions are load-bearing for texture frame integrity (see `decisions.md` §"textureRegion is the authoritative grid size"). The board must adapt to the pieces, not the other way around.
- **Do not change piece canonical positions.** They're correct.
- **Do not touch the shadow/zIndex/layout logic** in `createBoard` — only the `bw`/`bh` computation.
- **Do not change how the board is centered on screen.** The `(screenWidth - bw) / 2` centering math stays; only the `bw`/`bh` inputs change.
- **Do not touch the ingest pipeline** (`main.ts`, `imageNormalize.ts`). Option C is out of scope.

## Files likely to touch

- `src/canvas/board.ts` — `createBoard` signature (possibly) and `bw`/`bh` computation
- `src/canvas/scene.ts` — caller of `createBoard`, only if signature changes
- `docs/decisions.md` — short note explaining the fix and alternatives
- `docs/engine-conventions.md` — add a line noting "board dimensions = cols × pieceW by rows × pieceH, NOT imageWidth × imageHeight" (per the `/refine` routing rule, this is a coordinate-system rule that belongs in engine-conventions)

## Acceptance

User tests via QA page. Write ACs into `public/qa.html`.

- **AC-1: All four corners flush on a typical image.** Load `/test-image.jpg`. Solve or place the four corner pieces. Each corner piece's outer edges align with the board's outer edges — no visible whitespace gap on any side.
- **AC-2: All four corners flush on a non-divisible image.** Load a fixture with dimensions that don't divide evenly by the computed grid (any phone-sized photo will do — 2048×1536 with a 15×11 grid is the canonical case). Same corner-alignment check.
- **AC-3: All four corners flush on a panorama.** Load a panorama (or the 2048×102 normalized panorama). Corners flush.
- **AC-4: Board centered on screen.** Board appears horizontally and vertically centered in the viewport at default zoom. No off-center drift introduced by the size change.
- **AC-5: No regression in snap.** Pieces still snap to their canonical positions. Solve a few pieces end-to-end.
- **AC-6: No regression in completion detection.** Solve the puzzle. Completion event still fires.
- **AC-7: No regression in shadow/visual design.** Board still has its drop shadow; no clipping or visual artifact from the size change.

## Out of scope

- Story 46f (label clipping Approach B overlay) — queued separately, not in the close-out sequence.
- Story 47 (file picker) — starts after 46e ships.
- Any change to piece dimensions, cut generation, WASM pipeline, snap tolerance.
- Any redesign of the board (colors, border, slot markers). Size-of-rectangle only.
- Image pre-padding / pre-cropping at ingest time.

## Known next

After 46e: Story 47 kicks off the Controlled Inputs epic. 46f (label clipping Approach B) stays queued but is not a blocker for 47.
