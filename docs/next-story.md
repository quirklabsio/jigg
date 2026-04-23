# Story 47a: Bench piece uplight glow

## Context

Story 47a-spike (shipped 2026-04-22, see `decisions.md` §"Piece contrast audit") measured that black and near-black pieces fall to 1.0–1.9:1 WCAG contrast against the dark bench — they disappear. The spike's original recommendation was a dual-tone always-on stroke on every piece. **That approach was rejected** because it alters the piece art itself (puzzle pieces are content, not chrome).

Alternative direction: treat the bench's visibility problem as a **chrome** problem. Each bench slot gets a soft uplight glow behind the piece — a bottom-to-top bright gradient that lifts dark pieces off the bench background without touching the piece sprites, filters, or geometry. The metaphor is "pieces resting on a dimly lit shelf with ambient light rising from below."

The board side of the contrast matrix (white pieces disappearing on the white board) is handled separately in Story 47b (adaptive board color), queued after this.

## Scope framing

This is a **visual-discovery story**. The user explicitly wants to see it before judging whether the approach works. Prompt locks down regressions (HC mode, canvas pieces, filter strip, perf); leaves glow parameters (color, alpha, gradient curve) tunable in the QA loop. Expect 1–2 iteration cycles on the visual knobs.

## Requirements

### The glow

For each bench piece slot, insert a new `Graphics` node as a sibling of the piece sprite, rendered **behind** the sprite but **above** the button background. The glow fills the slot bounds with a **vertical linear gradient**: a light color at the bottom, fading to transparent by roughly 60% of the slot height.

Starting parameters (tunable, expose as top-of-file module constants for easy iteration):

- `BENCH_GLOW_COLOR`: warm off-white, starting `#fff5e0` or neutral `#f5f5f3` — dev picks what reads best in-canvas
- `BENCH_GLOW_ALPHA_MAX`: starting `0.22` (at the bottom edge)
- `BENCH_GLOW_FADE_STOP`: starting `0.60` (where alpha reaches 0)
- Gradient shape: linear vertical. Radial is available if linear reads flat, but start linear.

The glow shape tracks the slot, not the piece. Empty slots (between or after extraction) have no glow — glow exists for rendered pieces only.

### Context constraints (hard)

- **Bench only.** Pieces extracted to the workspace or placed on the board receive no glow. The glow lives with the bench slot, not the piece identity.
- **Not in HC mode.** High contrast preference enabled → glow is not added (or is removed if the toggle flips mid-session). HC's sandwich stroke (Story 37d) already provides 21:1 — adding a glow on top would double-treat and feel wrong.
- **Chrome only.** Zero effect on the piece sprite, piece texture, piece filters, piece geometry. The glow is behind the piece; the piece renders on top unchanged.
- **Aesthetic, not WCAG-strict.** This does not promise to hit 3:1 on every piece/bench combo. A black piece at the bottom of the glow will sit around 2:1–2.5:1; the top half of the piece still dissolves into the darker part of the bench. That's acceptable — pieces in the bench are transient, and users don't stare at the bench the way they stare at the board.

### Integration points

- Bench piece containers live inside `_piecesContainer` (see `bench.ts:85-86`, mask setup from Story 32). The glow Graphics is a sibling of the piece sprite inside each piece's container — not a child of `_piecesContainer` directly (which would cover all slots).
- The glow is **clipped by the existing `_piecesContainer` mask**, same as the piece sprite. This is correct: if a glow bleeds past the tray body, the mask crops it, same as Story 46b's piece clipping fix.
- On piece extraction (Story 32 spiral + Story 41a keyboard extraction), the piece container is removed from the grid — glow goes with it. No explicit cleanup required.

### HC gating

The HC preference toggle lives in `src/utils/preferences.ts`. Mirror the sandwich stroke pattern:

- On initial CUTS_COMPLETE: check HC preference. If off, add glow to every bench piece. If on, skip.
- On HC toggle mid-session: remove glow from all bench pieces when HC turns on; re-add when HC turns off.
- Use a named filter/child tag pattern (`'bench-glow'`) so add/remove is idempotent — same protection Story 37d uses for the sandwich.

## Constraints (rephrased + extended)

- **Do not modify the bench background itself** (`#1a1a1a` α 0.85 normal — Story 37d). The glow is per-slot, not a bench-wide change.
- **Do not apply the glow to pieces on the canvas** — bench only.
- **Do not touch the piece sprite, its filters, its texture, or any existing piece-level work.** BevelFilter, DropShadowFilter, and HC sandwich all remain exactly as they are.
- **Preserve all Story 46b fixes.** Tab overhang and focus ring clearance behave identically — glow clipping obeys the same mask geometry.
- **Preserve Story 37d HC behavior.** HC mode is untouched here. The sandwich stroke continues to do its job; glow does not exist in HC.
- **Do not change filter strip or tray open/close animations.**
- **Do not pre-empt Story 47b** (adaptive board color). Board fill stays `#ffffff` in this session.
- **Expose glow parameters as top-of-file module constants.** Not buried. This story is explicitly expected to iterate on color/alpha/fade-stop during QA.

## Files likely to touch

- `src/canvas/bench.ts` — primary: add glow Graphics insertion per piece container; HC-gated add/remove
- `src/utils/preferences.ts` — HC toggle wiring (may need a new exported function for `setBenchGlowEnabled(on)` or similar, mirroring `addSandwichStroke` / `removeSandwichStroke`)
- `docs/decisions.md` — record the approach, final tuned parameters, and a short note on why the stroke alternative was rejected
- `docs/engine-conventions.md` — possibly; if there's a useful invariant to record about "chrome vs content" for future contributors (dev's call)

## Acceptance

User tests via QA page. Write ACs into `public/qa.html` per `/qa` format.

Test with the synthetic fixtures from the spike: `qa-scratch/spike-47a-pure-white.png`, `qa-scratch/spike-47a-pure-black.png`, `qa-scratch/spike-47a-mid-gray.png`, `qa-scratch/spike-47a-split-wb.png`. Also confirm behavior on `/test-image.jpg` and one of the Story 48 curated images.

- **AC-1: Glow visible on every bench piece (normal mode).** Load any test image. Every piece in the bench has a visible soft glow behind it, brighter at the bottom of the slot, fading upward.
- **AC-2: Dark pieces materially more visible.** Load `spike-47a-pure-black.png` or `spike-47a-split-wb.png`. Black pieces in the bench are discernible where they were previously invisible. User judges whether "discernible" meets their bar; dev tunes parameters if not.
- **AC-3: Light pieces don't look harmed.** Load `spike-47a-pure-white.png`. White/near-white bench pieces still look fine — not washed out, not over-bright, no visible artifact.
- **AC-4: HC mode unchanged.** Enable high contrast (Shift+H or whatever the toggle is — see `preferences.ts`). Glow disappears on all bench pieces; the HC sandwich stroke is visible and unchanged.
- **AC-5: HC toggle mid-session clean.** Enable HC → glow removes cleanly. Disable HC → glow returns cleanly. No residual filters, no duplicate glow layers.
- **AC-6: Canvas pieces have no glow.** Extract a piece (click or keyboard). The extracted piece on the workspace/board has no glow. The bench slot (if it still exists) has no glow either since it's empty.
- **AC-7: Story 46b regressions all pass.** Tabs with downward knobs still render fully; focus ring still visible. Glow clipping obeys the same mask geometry.
- **AC-8: Filter strip + tray behaviors unchanged.** Filter cycling, tray open/close (T key), piece extraction, keyboard nav — all unaffected.
- **AC-9: Perf stable at 200-piece grid.** Load a large-grid image (2048×2048 or similar, yielding ~169 pieces). Frame rate matches pre-change baseline — measured via the FPS counter (F key, if exposed) or browser devtools. Dev notes the measurement in the QA report.

## Out of scope

- **Story 47b — Adaptive board color.** Queued as the follow-up. Board stays `#ffffff` this session.
- **Story 47c — Palette tuning + swap UI.** Still candidate.
- **Story 46f — Label clipping Approach B.** Still candidate.
- Glow on canvas pieces (post-extraction, placed on board, mid-drag). Bench only.
- Per-piece adaptive glow color based on piece content. Uniform glow across all slots.
- Animated glow (pulse, flicker). Static gradient only.
- Changing the bench background itself (normal `#1a1a1a` or HC `#000000`).
- Any piece-sprite-level treatment (stroke, outline, shadow) — rejected per user direction.

## Known next

- **Story 47b** (immediately after 47a ships): Adaptive board color — the board-side half of the contrast problem. Board becomes image-aware (likely k-means on piece luminances picks a board color), with a `Shift+B`-style preset override as escape valve.
- Story 47c (palette tuning) and 46f (label clipping Approach B) remain candidates beyond 47b.
