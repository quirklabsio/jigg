# Story 46c: Bench→table scatter spread investigation

## Context

During Story 45 QA the user observed: *"the scatter design or pattern of random placement of pieces from bench to table, still working but the spread is bigger than it used to be imo"*. The "imo" is load-bearing — it might be real, it might be perception. This story is investigation-first, fix-only-if-warranted.

The spiral math lives in `src/canvas/bench.ts:961` (`spiralPlace`), not in the stub at `src/puzzle/scatter.ts` (gutted in Story 32 — don't touch it). The step size formula is:

```ts
const maxDim  = Math.max(_piecePixelW, _piecePixelH);        // line 975
const stepSize = maxDim * Math.SQRT2 * 1.3;                  // line 976
const b = stepSize / (2 * Math.PI);                          // line 977
// Archimedean: r(θ) = b·θ, with θ = spiralIndex * 1.5
```

`stepSize` is calibrated to piece pixel dimensions. Before Story 46, pieces were uniform (4×4 grid → piece side ≈ image_side / 4). After Story 46, piece dimensions vary hugely: panorama ~30 px, phone ~150 px, tiny ~60 px. If the formula was tuned for the old piece size, the new dynamic sizes may produce a different-feeling spread.

Viewport zoom is the other suspect. Screen-space spread = world-space radius × `viewport.scale`. If `pixi-viewport`'s default zoom now differs per image (it may, via fit-to-content logic), the visual spread can change without the spiral math changing.

## Requirements

### Measure before touching code

Compute the radius at which the Nth piece lands, for three representative image sizes. Use existing fixtures where possible (`/test-image.jpg`, `/test-face.png`) plus one panorama-class fixture.

For each image:
- Grid dimensions (from `computeGrid`)
- Piece pixel dimensions (`_piecePixelW`, `_piecePixelH`)
- Resulting `stepSize`, `b`
- `r` at N = 5, 10, 16, 50
- Current viewport default scale on that image
- Resulting **screen-space** spread (r × viewport.scale) at the same N values

Compare to the pre-Story-46 baseline (same math with 4×4 grid and each image's pre-dynamic piece dimensions — computable from the formula, no need to revert code).

Document the table in `docs/decisions.md` under a new `## Scatter spread investigation (Story 46c)` section. This measurement is the acceptance artifact regardless of outcome.

### Decide

One of three outcomes — pick the one the data supports, and say so plainly in `decisions.md`:

- **A. No real bug.** Perception drift. Close without code change. The measurement table and decision are the deliverable.
- **B. Real bug, step-size formula is wrong for dynamic piece sizes.** The `maxDim * √2 * 1.3` constant was tuned for the old uniform grid; propose a replacement that produces visually consistent spread across piece sizes. Options worth considering: pin to a viewport-relative constant, pin to an absolute world-space constant, use `sqrt(pieceW · pieceH)` (geometric mean) instead of `max`, or something else the data suggests.
- **C. Real bug, viewport zoom is the issue.** World-space spread is fine; screen-space spread varies because viewport zoom varies per image. Fix by stabilizing the default zoom across image sizes (or noting it's out-of-scope here and routing to a separate story).

### Fix (only if B or C)

Pick the simplest change that makes spread consistent. No clever algorithm substitutions. Don't swap Archimedean for Fibonacci or hexagonal packing — the spiral's already doing its job; just get the step right.

Leave alternatives considered in `decisions.md`. If data supports both B and C partially, bias toward the smaller diff.

## Constraints

- **Do not resurrect `src/puzzle/scatter.ts`.** It's an intentional stub (Story 32 history). Live code is `bench.ts spiralPlace`.
- **Preserve "origin locks on first click" behavior** (per `decisions.md` Story 32). Rapid successive extractions must still build a coherent cluster near the viewport center.
- **Preserve the viewport-pan origin reset** (`bench.ts:1646` region). Panning, then extracting again, resets the spiral origin to the new center.
- **Do not touch the occupancy check** (bench.ts:993–1007) — it prevents placement overlap; independent of step size.
- **Do not touch the keyboard extraction path** beyond what's required. `spiralExtractPiece` (called from `aria.ts:347`) must continue to work identically.
- **Do not touch completion detection, snap logic, or piece rotation.**

## Files likely to touch

- `src/canvas/bench.ts` — `spiralPlace` (line 961) and the `stepSize`/`b` formula
- `docs/decisions.md` — the measurement table + decision record (required regardless of outcome)
- Possibly `src/canvas/scene.ts` — only if outcome C requires viewport zoom adjustment and the fix lands there

## Acceptance

User tests via the QA page. Write ACs into `public/qa.html` per `/qa` format.

- **AC-1: Measurement delivered.** `docs/decisions.md` contains the three-image table (grid, piece dims, step, r at N=5/10/16/50, viewport scale, screen-space spread) plus pre-Story-46 baseline for comparison. Decision (A/B/C) stated plainly.
- **AC-2 (if outcome A — no bug):** No production code changed. User reads the measurement note, agrees or pushes back. Story closes without a fix.
- **AC-3 (if outcome B or C — fix shipped):** Extract 5–10 pieces from each of three test images. On-screen spread is comparable across images (not image-size-dependent). User eyeballs it and confirms.
- **AC-4: Rapid-click clustering preserved.** Extract 5 pieces rapidly from bench without panning. All 5 land in a coherent visual cluster near viewport center.
- **AC-5: Viewport-pan origin reset preserved.** Pan viewport, extract another piece. New piece's spiral origin is at the new viewport center.
- **AC-6: Keyboard extraction still works.** `T` to open bench, Tab to a piece, Enter — piece extracts to the spiral location identically to click.
- **AC-7: No regression in occupancy check.** Placing 20+ pieces rapidly — none visibly overlap.

## Out of scope

- Story 46e (corner piece alignment — 3/4 corners not flush to board edge). Next after this.
- Story 46f (label clipping Approach B overlay). Queued, not in the close-out sequence before Story 47.
- Any redesign of the scatter algorithm itself. Fix step-size or zoom only; don't swap spirals for alternatives.
- `src/puzzle/scatter.ts` stub — leave it.
- Occupancy check perf — fine at current scale, not urgent.

## Known next in committed sequence

`docs/roadmap.md` commits to `46c → 46e → Story 47`. Story 46f (label clipping) is queued separately, not a blocker for 47.
