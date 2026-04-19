# Story 46: Dynamic piece grid from image aspect ratio

Story 44 and 45 unlocked arbitrary image input but the puzzle grid is still hardcoded at `COLS = 4, ROWS = 4` in `src/canvas/scene.ts:36-37`. That's fine for a square test image but wrong for everything else: a 4032×3024 phone photo gets 16 oversized pieces, a 4000×200 panorama (normalized to 2048×102) gets 16 absurdly wide pieces, and small images get legible pieces only by accident. The 200-piece cap the roadmap promises is also unenforced — it's a value we've written down but never checked against.

Replace the constants with a pure function that computes rows and cols from the incoming texture dimensions. Goal: pieces that are close to square, never smaller than they need to be, capped at 200.

## Requirements

Introduce `computeGrid(imageWidth: number, imageHeight: number): { rows: number; cols: number }` — a pure function in `src/puzzle/cutter.ts` (co-located with `gridCut`, which already accepts arbitrary `rows`/`cols`).

Constants and their intent:
- **`TARGET_PIECES = 160`** — aim for this count; the cap is the ceiling, not the target
- **`MAX_PIECES = 200`** — hard cap, never exceed
- **`MIN_PIECE_SIDE = 60`** — soft floor in pixels; preferred minimum per-piece dimension
- **`MIN_GRID = 2`** — absolute floor on rows and cols; a 1×N strip has no corner/edge variety

Algorithm (spec, not prescription):
1. Start from an ideal square piece side: `sqrt(imageWidth * imageHeight / TARGET_PIECES)`
2. Clamp the piece side upward to at least `MIN_PIECE_SIDE` if possible
3. Derive `cols = round(imageWidth / side)`, `rows = round(imageHeight / side)`
4. Enforce `MIN_GRID`: both must be ≥ 2. For extreme aspects (panorama 2048×102), this forces piece side below the soft floor — that's fine; `MIN_GRID` wins over `MIN_PIECE_SIDE`
5. Enforce `MAX_PIECES`: if `rows * cols > 200`, reduce whichever dimension is larger until the product fits

The exact implementation is the dev's call — above is a correctness spec, not a line-by-line prescription. Pick clear code over clever code.

Call site in `src/canvas/scene.ts`: delete the `COLS`/`ROWS` module constants; call `computeGrid(texture.width, texture.height)` inside `loadScene` before `gridCut`; thread the result through every existing use of `COLS`/`ROWS` (there are many — see the grep output for the full list).

## Constraints

- **Do not change the reload-based rebuild.** Image load still goes through `sessionStorage` + `window.location.reload()` per Story 44. In-place scene teardown is a separate future story (the "clean rebuild" language from `decisions.md` is aspirational and stays deferred). "Reset puzzle state cleanly" as the roadmap phrases it is already handled by the reload — this story only needs to verify no state assumptions break when the grid size differs across reloads.
- **Do not touch the WASM side.** `cutter.ts` → worker already parameterises `cols`/`rows`; the Rust side is grid-agnostic.
- **Do not touch `src/main.ts` or `src/imageNormalize.ts`.** The ingest pipeline is correct.
- **Do not introduce a UI for piece-count selection.** That's a future story (candidate for the settings panel, Story 70).

## Files to touch

- `src/puzzle/cutter.ts` — add `computeGrid` + the four constants
- `src/canvas/scene.ts` — remove `COLS`/`ROWS` constants; thread the computed values through every use

## Acceptance

- 4032×3024 phone JPEG (normalized to 2048×1536 by Story 45) → grid near 14×10 (~140 pieces, inside target). Exact values depend on rounding; what matters is "square-ish pieces, piece count in the 120–180 range, never above 200".
- 500×500 → grid near 8×8 (~64 pieces), piece side above `MIN_PIECE_SIDE`.
- 4000×200 panorama (normalized to 2048×102) → grid with `rows ≥ 2`, `cols` filling to cap or close. Pieces are narrow (side below 60) but this is the intentional trade for having more than one row.
- 2048×2048 → grid near 13×13 (~169 pieces).
- Puzzle remains solvable on every grid: drag, snap, bench filters (corner/edge/middle classification works for any `rows ≥ 2` and `cols ≥ 2` — confirm the existing `flatSides >= 2` rule from `decisions.md` holds), keyboard navigation across bench and table, rotation, completion detection.
- The 200-piece cap is verifiable: feed a synthetic 4096×4096 input (bypass normalization temporarily or use a pre-normalized PNG fixture) and confirm `rows * cols <= 200`.

## Known adjacent issues (NOT in scope — do not fix here)

Two regressions observed during Story 45 testing, to be tracked as separate stories:
1. **Bench piece clipping** — pieces with downward-facing knobs, and the magenta active-state ring, appear cut off at the bottom of bench buttons. Pre-existing mask-padding issue; unrelated to grid.
2. **Wider bench→table scatter spread** — the Archimedean spiral step (see `decisions.md` / Story 32) is a world-space constant; if Story 45 changed effective piece dimensions, the spread looks larger. Worth measuring before fixing. Candidate Story 46b/c.

Mention either if they block testing of Story 46's criteria, but do not address them in this session.

## Out of scope

- In-place scene teardown / `rebuildScene` entry point — deferred
- Runtime piece count selection via UI — belongs in the settings panel (Story 70)
- Shaped/circular cuts for images with alpha borders — Story 36b deferred elsewhere
- Performance work on very-high-piece grids — revisit if 200-piece runs reveal a specific bottleneck
