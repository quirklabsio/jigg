# Story 46d: Fix piece label clipping on narrow pieces

## Context

During 46b QA the user observed piece number labels with digits cut off by the piece cut mask. This is load-bearing behavior, not a bug in the naive sense — `src/utils/preferences.ts:353` explicitly states:

> // First child so snap highlight renders above; mask clips label to piece shape

Story 37b designed label placement assuming roughly square pieces (the hardcoded 4×4 era) where a fixed-size label comfortably fits inside the piece interior. Story 46 shipped a dynamic grid: a 2048×102 panorama produces narrow pieces (tens of px tall), and a fixed-size label no longer fits inside the piece shape. The mask clip is doing what it was told to do; the label sizing is what's wrong.

## Requirements

### Diagnosis first

Read `src/utils/preferences.ts` starting around line 274 (the "Piece labels (Story 37b)" section). Identify:
- How `createPieceLabel` sizes the Text and its background Graphics rect
- Whether those sizes are absolute or piece-relative
- Where the label is positioned relative to piece geometry (centering)
- Both code paths that attach labels: the bench path (lines ~344–349 with counter-scaling) and the canvas path (line 351 — `label.rotation = -sprite.rotation`)

Confirm the hypothesis: label size is fixed, so it overflows narrow pieces, so the piece-shape mask clips it.

### Fix

Pick one approach. Document the choice and alternatives in `decisions.md`.

- **A. Scale labels to fit the piece's smaller dimension.** Compute label max size from `min(pieceW, pieceH) * K` (pick K by eye — probably 0.4–0.6). On narrow pieces, labels shrink; on square pieces, sizes match today's behavior.
- **B. Move labels above the piece mask.** Attach the label container as a sibling overlay rather than a sprite child. Sync position + rotation via ticker. Breaks the "label inside piece shape" design intent but guarantees no clipping.
- **C. Hybrid.** Apply A's dynamic sizing only when min-dimension falls below a threshold. Preserves the current look on normal pieces; activates the fit logic for narrow ones.

Bias toward A or C unless they prove infeasible — they preserve the existing design language. Don't reach for B unless necessary.

## Constraints

- **Do not touch the piece cut mask.** The mask is load-bearing for snap highlight rendering (per the line 353 comment) and everything else. The fix operates on label sizing, not mask geometry.
- **Preserve the Story 37b rotation invariant.** Counter-rotation stays: `label.rotation = -sprite.rotation` on canvas, `-(piece.rot * Math.PI) / 180` in the bench counter-scaled path. If switching hierarchies (Approach B), the rotation math moves but must remain equivalent.
- **Preserve the bench counter-scaling** (line 349: `label.scale.set(1 / sprite.scale.x)`). Labels render at native size regardless of bench thumbnail scale — this must still hold.
- **Do not change label visual design.** Font family, color, stroke, and background style stay. If sizing forces a lower font size on narrow pieces, that's a dimensional change, not a design change.
- **Do not change the preferences toggle behavior.** Whatever turns labels on/off stays as-is.
- **Don't address the two TODOs already in the file** (`non-scaling labels` at low zoom, `BitmapText` for perf). Out of scope.

## Files likely to touch

- `src/utils/preferences.ts` — primary. `createPieceLabel`, the attach logic, `updateLabelBgAlpha` if sizing knobs need exposure
- `src/canvas/scene.ts` — only if Approach B requires a new overlay container
- `docs/decisions.md` — approach choice + alternatives considered

## Acceptance

User tests via the QA page. Write ACs into `public/qa.html` per the `/qa` command format. Target ACs:

- **AC-1: Normal (square-ish) pieces unchanged.** Load `/test-image.jpg`. Enable labels. Every label on bench and table is fully visible — no digit clipped. Visual size of labels matches pre-fix appearance (or acceptably close).
- **AC-2: Narrow pieces (panorama).** Drop a 4000×200 panorama (or use a pre-normalized 2048×102 fixture). Enable labels. Every label on narrow pieces is fully visible — may be visibly smaller than AC-1's labels, but legible.
- **AC-3: Rotated pieces.** Rotate a bench piece (double-tap or keyboard). Label stays upright (per Story 37b invariant) and fully visible. Same for canvas pieces after extraction.
- **AC-4: Bench counter-scaling preserved.** Labels in the bench don't visually swell or shrink as bench thumbnails resize on window resize.
- **AC-5: Toggle works.** Disable labels via preferences; labels disappear. Re-enable; labels reappear correctly on all pieces.
- **AC-6: No regression in snap highlight or focus ring.** Snap highlight still renders above the label when a piece is dragged into place. 46b's focus ring still visible on bench.

## Out of scope

- The low-zoom non-scaling label TODO (line 291–293 in preferences.ts)
- BitmapText perf swap (line 285–286)
- Story 46c (scatter spread investigation) — still a candidate
- Story 46e (corner piece alignment — 3/4 corners not flush to board edge) — new candidate from 46b QA
- Any visual redesign of labels

## Known candidates still open (for context only)

- **Story 46c** — Scatter spread investigation (from Story 45 QA)
- **Story 46e** — Corner piece alignment: 3 of 4 corner pieces sit with a small gap between the piece edge and the board edge (from 46b QA). Needs investigation into board rect position vs piece canonical positions.
