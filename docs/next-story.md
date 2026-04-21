# Story 46b: Fix bench piece clipping — tabs and focus ring

The user reported this during Story 45 manual QA and confirmed it persisted through Story 46: bench pieces with downward-facing tabs get their knob tip sliced off at the bottom of the bench body, and the magenta active/focus ring on the currently-focused piece is clipped the same way. Both symptoms point to the `_piecesContainer` mask in `src/canvas/bench.ts:85-86` (and refreshed around line 875) not leaving room for the legitimate overflow that tabs and the focus ring are designed to produce.

The clip is doing exactly what Story 32 set it up to do ("prevents overflow during layout") — the problem is the mask rect's geometry doesn't know about tab overhang or ring thickness, both of which are intentional visual features that exist *outside* the piece's nominal grid cell.

## Requirements

### Diagnosis first

Find where the magenta focus/active ring is drawn on bench pieces. `SWATCH_HC_ACTIVE_CLR = 0xff00ff` (`bench.ts:507`) is for filter-strip swatches in HC mode — confirm whether the piece-focus ring is a different code path. Likely locations: `bench.ts`, `preferences.ts`, `aria.ts` focus handlers, or a per-button Graphics overlay. Note the actual ring thickness and where it's positioned relative to the piece sprite's bounding box.

Measure the tab overhang. Tab height is a function of piece size (~20–25% per existing cutter convention). For a bench piece scaled to slot size `S`, maximum overhang below the piece nominal bounding box is roughly `tabHeight ≈ 0.25 * S` in any of the four directions.

### Fix

Pick one approach and implement it. The dev decides based on what the code structure supports most cleanly — this list is the option space, not a preference:

- **A. Pad the mask rect** — widen `_piecesMask` by `max(tabOverhang, ringThickness) + margin` on all four edges. Keeps piece positioning unchanged; the clip just relaxes.
- **B. Shrink pieces within button bounds** — reserve padding inside each bench button for tab + ring, render the piece sprite smaller so overflow fits inside the existing mask.
- **C. Per-button scissor** — drop the container mask for focused pieces and rely on individual button bounds (more complex; flag if you discover A and B both have fatal issues).

Whichever you pick, leave a short `decisions.md` note explaining the choice and the alternatives considered.

## Constraints

- **Do not touch piece geometry.** `cutter.ts`, tab heights, piece texture regions stay exactly as they are. This is a bench-rendering fix, not a piece-cutting fix.
- **Do not regress horizontal clipping.** Pieces must still not bleed past the left/right ends of the tray (scroll overflow was one of the original reasons for the mask — see `decisions.md` Story 32). The fix adjusts vertical breathing room, not horizontal.
- **Do not change the focus ring colour or behaviour.** The magenta ring's existence is correct; it's just clipped.
- **Do not touch filter strip layout.** Keep `_filterContainer` positioning unchanged (`bench.ts:1524`).
- **Do not introduce a new focus indicator system.** Use the one that already exists — just make it visible.

## Files likely to touch

- `src/canvas/bench.ts` — primary; mask geometry or button slot geometry
- Possibly `src/canvas/preferences.ts` or `src/utils/aria.ts` if the focus ring lives there and needs a thickness adjustment coordinated with the mask

## Acceptance

The user will test these through the QA page (`http://localhost:5173/qa`). Write ACs into `public/qa.html` per the `/qa` command format.

- **AC-1: Tabs fully visible, all rotations.** Load `/test-image.jpg` or a phone-JPEG-size fixture. Scroll the bench to find pieces with tabs pointing in each of the four directions. Every tab tip is visible — none sliced off at any tray edge.
- **AC-2: Focus ring fully visible.** Press `T` to open bench, Tab to reach it, arrow-right through pieces. The magenta active/focus ring is fully rendered — not clipped at top, bottom, or (where applicable) sides.
- **AC-3: Horizontal overflow still prevented.** Rapidly flick between filters and scroll the bench; no piece bleeds past the left or right end of the tray strip.
- **AC-4: Resize, tray open/close still correct.** Trigger a window resize and toggle the tray open/closed with `T`; mask geometry refreshes correctly, pieces stay inside the bench body.
- **AC-5: No regression in other bench features.** Filter strip renders correctly; swatch active states still show correctly; keyboard navigation still moves focus as before; piece extraction still works.

## Out of scope

- **Story 46c (scatter spread investigation)** — separate candidate story. Do not touch spiral geometry in this session.
- Arrow-key piece movement on the table (Story 72 deferred post-launch).
- Any change to piece cut generation, textures, or WASM pipeline.
- Any change to focus-ring colour, thickness-by-design, or the active-state visual language.

## Known adjacent items (for context only — not to fix)

- Scatter spread from Story 45 testing: still open as candidate Story 46c.
- If you notice the focus ring is drawn once globally and re-used, that's fine — don't refactor focus-ring architecture as part of this fix.
