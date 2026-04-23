# Story 47b: Adaptive board color

## Context

Story 47a-spike measured that white and near-white pieces produce 1.0–1.1:1 contrast against the hardcoded white board (`#ffffff`) — they disappear. Story 47a solved the bench-side half with a chrome-only uplight glow. 47b handles the board-side half by making the board color image-aware.

**Principle (durable, see `decisions.md` §"Board/Table asymmetry"):** the board is system-controlled and image-aware; the table is user-controlled via existing presets. These are **not equivalent surfaces** despite both accepting dropped pieces. The board guarantees piece visibility (correctness / clarity); the table is for aesthetic preference. V1 prioritizes "always readable by default" over "user-configurable" on the board. **No user override, ever** — not now, not V2. If the algorithm picks wrong in some edge case, we iterate the algorithm, not add a knob.

A separate follow-up (Story 47d, candidate) will address "board as stage" via visual hierarchy — edge definition, drop shadow, elevation. That's polish on the same principle; still no user knobs.

## Requirements

### The algorithm

Three board-fill presets, deterministically chosen per image at load time:

- **Light:** `#f5f5f3` (the current workspace off-white — matches Story 37a's existing palette)
- **Mid:** `#808080`
- **Dark:** `#2a2a2a` (matches Story 37a's charcoal preset)

Selection rule based on piece-image luminance statistics (compute from the `imageData.data` already extracted once in `loadScene` per `decisions.md` §"OffscreenCanvas extracted once in loadScene"):

1. Compute mean relative luminance `L` across the full image, or sample via a reasonable stride (every Nth pixel) for speed. WCAG formula: `L = 0.2126×R + 0.7152×G + 0.0722×B` with linearised sRGB.
2. Compute luminance spread as `max(L) - min(L)` across sampled pixels (or use standard deviation; dev's pick — both correlate well).
3. Rule:
   - If `spread > 0.60` **and** `0.3 < mean < 0.7` → **mid board**. Image has both very light and very dark content and the mean sits in the middle; a binary light/dark board would sacrifice half the pieces.
   - Else if `mean > 0.5` → **dark board**. Image is dominantly bright.
   - Else → **light board**. Image is dominantly dark.

Three branches total. No tie-breakers needed because `mean > 0.5` vs `mean <= 0.5` covers the binary case completely.

Implementation is a ~20-line function. Keep it in one place — probably `src/canvas/board.ts` alongside `createBoard`, exported as `computeBoardColor(imageData: ImageData): number` returning the Pixi-friendly color int.

### Plumbing

`createBoard` (see `src/canvas/board.ts`) currently fills with hardcoded white:

```ts
g.rect(left, top, bw, bh);
g.fill({ color: 0xffffff });
```

Change signature to accept a `fillColor: number` and pass it through. Caller in `src/canvas/scene.ts` computes the color via `computeBoardColor(imageData)` before calling `createBoard`, using the existing `imageData` reference from `loadScene`.

### What stays the same

- Board shadow (`DropShadowFilter`), `zIndex = -1`, centering math, dimensions (cols × pieceW by rows × pieceH per Story 46e) — all untouched.
- Workspace background and its Shift+B preset cycle (Story 37a) — independent system; do not extend it to the board.
- Bench glow from Story 47a — independent chrome; do not change.
- All existing filters (BevelFilter, DropShadowFilter on pieces, HC OutlineFilter sandwich) — untouched.

## Constraints

- **No user override.** No Shift+B extension, no preference toggle, no "Board color" setting. The algorithm is the answer. If it's wrong, iterate the algorithm; don't add a knob.
- **No overengineering the algorithm.** Three branches, no weighted optimization, no k-means, no per-piece analysis. Mean + spread on the image's raw luminance is sufficient. The existing k-means from Story 35 is overkill for this decision — do not call it.
- **Recompute only on image load.** Not on every frame, not reactive. Board color is fixed for the life of the current puzzle.
- **No animation between board colors.** Reload already rebuilds the scene (per Story 44/47); the board comes up in its new color from the start. If a future story introduces in-place teardown, board color transitions can be considered then.
- **Do not touch HC mode.** HC preference doesn't currently affect the board; keep it that way. The sandwich stroke handles HC contrast; the board color choice is independent.
- **Do not affect Story 46e's corner-alignment fix.** Board dimensions still come from `cols × pieceW`, `rows × pieceH`. Only the fill color changes.
- **Do not add a CLI flag, debug override, or test-hook for forcing a specific board color.** QA uses real images; if a test needs a specific board, pick an image that produces that board via the algorithm.
- **Do not expose a runtime board-color setter.** Board color is determined at load and does not mutate during a session. If future work needs to change it (e.g. Story 47d elevation tuning may adjust adjacent chrome), that work still sets the color through the load-time derivation — no imperative "change board color now" API.

## Files likely to touch

- `src/canvas/board.ts` — add `computeBoardColor`; change `createBoard` signature to accept `fillColor`
- `src/canvas/scene.ts` — call `computeBoardColor(imageData)`; pass result to `createBoard`
- `docs/decisions.md` — record the three-branch algorithm, the thresholds (0.60 spread, 0.3/0.7 mean window, 0.5 binary cutoff), and the choice to hand-hold (no user override)
- `docs/engine-conventions.md` — one-line addition: "Board fill is computed at image load from piece-image luminance; no runtime mutation."

## Acceptance

User tests via QA page. Write ACs into `public/qa.html` per the `/qa` format.

Use spike fixtures (`qa-scratch/spike-47a-pure-white.png`, `spike-47a-pure-black.png`, `spike-47a-mid-gray.png`, `spike-47a-split-wb.png`) plus Story 48 curated images for varied real content.

- **AC-1: Light-dominant image → dark board.** Load `spike-47a-pure-white.png` (solid white). Board renders as `#2a2a2a` (dark). Every piece is visible against the board.
- **AC-2: Dark-dominant image → light board.** Load `spike-47a-pure-black.png` (solid black). Board renders as `#f5f5f3` (light). Every piece is visible against the board.
- **AC-3: Mixed-range image → mid board.** Load `spike-47a-split-wb.png` (half-and-half). Board renders as `#808080` (mid). Both black and white pieces have at least 3:1 contrast against the mid board.
- **AC-4: Mid-luminance image.** Load `spike-47a-mid-gray.png` (solid gray L=0.216). Board picks light (`#f5f5f3`) since mean < 0.5. Mid-gray pieces have usable contrast against the light board (3.6:1 per the spike matrix).
- **AC-5: Real content.** Load at least two Story 48 curated images (varied — one photo-like, one graphic). Board picks sensible colors; no pieces disappear at rest.
- **AC-6: Deterministic.** Loading the same image twice produces the same board color.
- **AC-7: No regressions in piece rendering.** BevelFilter, piece shadow, HC sandwich (toggle on), snap highlight, placed-piece behaviors — all unchanged.
- **AC-8: No regression in board dimensions.** Corners still flush to board edges (Story 46e). Board shadow still renders.
- **AC-9: No regression in bench glow.** Story 47a bench uplight still present, unchanged.
- **AC-10: No perf hit at image load.** The mean-and-spread computation runs once per image load. Measure: load a 2048×2048 image; note the added load time in the QA report. Stride-sampling (every 4th or 8th pixel) is fine if full-image takes more than ~50 ms.

## Out of scope

- **User override of board color** (no Shift+B extension, no preference, no setting). This is a permanent decision — not a V1 punt. See `decisions.md` §"Board/Table asymmetry" for the durable principle.
- Animated transitions between board colors
- Per-piece adaptive board color (different board tint under different pieces — rejected on principle: hand-hold, don't over-engineer)
- K-means integration (Story 35's existing k-means is for the filter strip palette, not board color)
- Story 47c (palette tuning + swap UI) — still candidate
- Story 46f (label clipping Approach B) — still candidate
- Extending the algorithm to more than three presets
- In-place scene teardown / runtime board recolor — deferred

## Known next

Likely queue after 47b:
- **Story 47d (candidate) — Board as stage: visual hierarchy.** Follow-up on the board side: strengthen edge definition, tune drop shadow/elevation so the board reads as a distinct plane against the table, ensure board colors stay visually distinct from all table presets. Still no user-configurable knobs.
- **Story 47c** (palette tuning + swap UI) — still candidate.
- **Story 46f** (label clipping Approach B, overlay container) — still candidate.

BA-session judgement picks the order at that point.
