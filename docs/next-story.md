# Story 47d: Board as stage — visual hierarchy

## Context

Story 47b shipped the adaptive board color (3-preset algorithm: light / mid / dark picked from image luminance at load). Board now has the *right* color for visibility, but still reads as "a differently-colored rectangle" rather than a distinct, elevated surface. The table it sits on is also user-configurable via existing presets (Story 37a Shift+B cycle: off-white / gray / charcoal).

The problem is most acute in the **3×3 diagonal**: when board fill matches the currently-selected table preset (e.g. light board on off-white table, dark board on charcoal table), the only visual separation between play surface and staging surface is the board's current drop shadow at `alpha: 0.06` — which barely renders. In those cases the board dissolves into the table.

This story makes the board read as a stage. Visual hierarchy only — no user knobs, no preset changes, no algorithm changes. Pure system polish on the board's perceptual weight and boundary.

Per `decisions.md` §"Board/Table asymmetry": board is system-controlled, table is user-controlled. This story does NOT touch board color derivation (Story 47b) or table presets (Story 37a). It operates on the board's rendering only.

## Requirements

Three changes to `createBoard` in `src/canvas/board.ts`, tuned together in the QA loop:

### 1. Stronger drop shadow (elevation)

Current shadow: `offset: {x:0, y:8}, blur: 24, alpha: 0.06`. This is too subtle to read as elevation against any table preset except the lightest one.

Starting parameters (tunable):
- `alpha: 0.18` — up from 0.06; the board should visibly cast a soft shadow
- `offset: {x:0, y:12}` — up from 8; amplifies the "sitting above" cue
- `blur: 28` — slightly softer falloff to avoid a hard shadow edge

Keep `resolution: 1` (the retina-pixel-seam fix from the existing board shadow), keep `quality: 3`.

### 2. Always-on contrast-adaptive edge stroke (boundary)

The board rect gets a 1 px stroke along its perimeter. The stroke color is derived from the **board fill luminance** (not from the table color — the board stays independent per asymmetry principle):

- Board fill luminance < 0.3 → stroke color light (~`#5a5a5a`, ~25% lighter than board dark preset `#2a2a2a`)
- Board fill luminance > 0.7 → stroke color dark (~`#c0c0c0`, ~25% darker than board light preset `#f5f5f3`)
- Mid luminance (0.3–0.7) → pick by contrast with fill; default dark stroke (~`#5a5a5a`) for mid (`#808080`) board since it reads slightly better than light against mid.

Starting stroke alpha: `0.45` — visible but not heavy. The stroke's job is to guarantee a perceivable boundary even when `board fill ≈ table fill`; since it contrasts with the board, it will always be visible against the board itself — and in the matching-color diagonal case it also contrasts with the table (same color).

This is analogous to the HC sandwich's logic (guarantee contrast at a boundary regardless of what's on the other side), scaled down to a single always-on stroke tuned for board/table separation.

### 3. Verify distinctness across the 3×3 matrix

All nine combinations of board preset × table preset must read as "clearly two surfaces, one elevated above the other." Dev explicitly checks all 9 during implementation and in the QA handoff. The three diagonal cases (matching colors) are the acceptance critical path.

## Constraints

- **Do not change `computeBoardColor`** (Story 47b) or the 3-preset algorithm. Board color derivation is orthogonal to this story.
- **Do not change table presets** (Story 37a). Table cycling via Shift+B stays as-is.
- **Do not touch piece rendering, filters, geometry, or the bench glow** (Story 47a).
- **Do not change the corner-alignment / board-sizing work** (Story 46e). Board dimensions stay `cols × pieceW` by `rows × pieceH`.
- **Do not add rounded corners** to the board rect. A sharp rectangle is part of the current aesthetic and rounding subtly changes the character. If the dev feels strongly that a very small radius (≤ 2 px) helps, it can be proposed in QA — not part of this prompt.
- **Do not introduce a "mat" / backdrop layer** behind the board. The edge + shadow should suffice; a second rect adds complexity without clear payoff.
- **Do not make the board visually distinct from the table by coupling the two** (e.g. picking a board color that avoids the current table color). That violates the asymmetry principle in `decisions.md`.
- **No user configurability.** Not now, not ever (per asymmetry principle). Stroke color / thickness / shadow params are constants in `board.ts`.
- **Expose the shadow + stroke parameters as top-of-file module constants** — they will be tuned visually in QA. No burying.

## Files likely to touch

- `src/canvas/board.ts` — primary: beef shadow params, add edge stroke, derive stroke color from fill luminance
- `docs/decisions.md` — record final tuned values and a short note on why these three levers (elevation, boundary, 3×3 verification) were chosen

## Acceptance

User tests via the QA page. Write ACs into `public/qa.html` per `/qa` format.

Test across all **3 board colors × 3 table presets = 9 combinations**. Use Shift+B to cycle the table while loading different images to cycle the board.

- **AC-1: Light board on off-white table (diagonal case 1).** Board is clearly visible as a distinct elevated plane. Shadow + edge stroke make the boundary unambiguous.
- **AC-2: Mid board on gray table (diagonal case 2).** Same.
- **AC-3: Dark board on charcoal table (diagonal case 3).** Same.
- **AC-4: All 6 off-diagonal combinations.** Board reads clearly as elevated against the table — the edge + shadow don't overpower or look cheap.
- **AC-5: Edge stroke visible on all 3 board colors.** Stroke contrasts with its own board fill; no invisible stroke.
- **AC-6: Shadow reads as elevation, not as a drawn line.** Soft falloff; no sharp band.
- **AC-7: No regression in 47b board color algorithm.** Load each spike fixture (pure-white / pure-black / split-wb / mid-gray) — correct board color still chosen.
- **AC-8: No regression in 47a bench glow.** Bench uplight still present; not affected by board rendering changes.
- **AC-9: No regression in 46e corner alignment.** Corner pieces still flush to board edges. Edge stroke sits *on* the rect boundary without interfering with piece placement geometry.
- **AC-10: No regression in HC mode.** HC-specific piece rendering (sandwich stroke) unchanged. Board shadow + edge apply the same way in HC (no separate code path).
- **AC-11: Visual feel.** Subjective: the user looks at the board and thinks "stage" / "card floating above the table" / "play surface." Not "rectangle I barely see."

## Out of scope

- **Story 47e (candidate) — HC bench visibility.** Still queued for after this story. Black pieces on the HC bench being hard to recognize is a separate gap (HC sandwich likely not applied to bench thumbnails; uplight glow currently HC-gated off). Flagged in `/qa` "what's coming up" so user knows it's known.
- **Story 47c** (palette tuning + swap UI) — still candidate.
- **Story 46f** (label clipping Approach B) — still candidate.
- Any user-configurable board chrome (permanent: see `decisions.md` §"Board/Table asymmetry")
- Rounded corners beyond a possible ≤ 2 px radius discussion in QA
- A separate "mat" layer behind the board
- Coupling board color to table color (violates asymmetry)
- Piece rendering, piece filters, piece geometry
- Board size / positioning (Story 46e territory)

## Known next

Queued candidates after 47d ships, in likely order of priority:

- **Story 47e — HC bench visibility.** Accessibility gap surfaced during 47b testing (screenshot: HC mode, black pieces on dark bench, no visible separation). Proposed fix: extend HC sandwich to bench thumbnails + ungate the 47a uplight glow in HC mode.
- **Story 47c — Palette tuning + swap UI.** User's earlier observation about punchy-color palette extraction.
- **Story 46f — Label clipping Approach B.** Deferred architectural debt.
- **Story 49 — Minimal metadata shape.** Epic progression.

BA-session judgement picks the order once 47d ships.
