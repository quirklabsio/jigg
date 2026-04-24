# Story 47e: Extend HC sandwich stroke to bench thumbnails

## Context

User confirmed the HC bench visibility issue persists after Story 47a's revision (which made the uplight glow unconditional / coexistent with HC). Dark pieces on the HC bench still read as solid black silhouettes — the glow alone can't separate piece-edge from bench-background when the piece content is near-black and the HC bench is pure black (`#000000` α 1.0 per Story 37d).

Root cause confirmed by inspection:

- HC sandwich stroke is applied in `applyHighContrast` at [src/utils/preferences.ts:152](src/utils/preferences.ts#L152), which iterates a `spriteMap: Map<string, Sprite>` passed in by caller.
- The caller (scene.ts) passes its **canvas piece sprite map**. Bench thumbnails live in their own separate map at [src/canvas/bench.ts:105](src/canvas/bench.ts#L105) — `let _spriteMap: Map<string, Sprite> | null = null`.
- The two maps are completely disconnected. `applyHighContrast` has never touched bench thumbnails.

Fix: make the HC sandwich cover bench sprites too. In HC mode, bench pieces get **both** the uplight glow (Story 47a) and the sandwich stroke — glow gives slot-level visibility, sandwich gives WCAG-strict edge contrast. Neither is sufficient alone; together they solve the problem.

## Requirements

### Extend sandwich application to bench

Implementation approach is dev's choice — the option space:

- **A. Secondary sprite-map registration in `preferences.ts`.** Add `registerBenchSpriteMap(map: Map<string, Sprite>)` alongside the existing `registerApplyFn`. `applyHighContrast` iterates both the canvas and bench maps, applying the sandwich to any sprite found. Cleanest — preferences.ts stays the single source for filter management.
- **B. Export the sandwich helpers and have `bench.ts` wire its own HC subscription.** Export `addSandwichStroke` / `removeSandwichStroke` from preferences.ts; `bench.ts` subscribes to HC changes (mirroring its existing pattern for labels or glow) and applies the sandwich to `_spriteMap` entries.
- **C. Pass the bench sprite map through `applyHighContrast`'s signature.** Add a second optional map parameter; scene.ts passes both. Simpler but spreads the responsibility.

Bias toward **A** — it keeps filter lifecycle centralized in `preferences.ts` and mirrors how scene.ts's spriteMap is registered today. But the dev decides based on what reads cleanly.

### Cover the lifecycle

- **Initial CUTS_COMPLETE:** if HC is on at puzzle load, bench thumbnails get the sandwich as soon as they're created.
- **HC toggle mid-session:** on → add sandwich to every bench thumbnail; off → remove. Uses the existing `_tag: 'hc-sandwich'` idempotency pattern from Story 37d (the `_tag` check already in preferences.ts). No filter accumulation on repeated toggles.
- **New thumbnails created after puzzle start:** not applicable — bench sprites are created once on CUTS_COMPLETE; none are added later in current code paths. If that ever changes, a future story handles it.
- **Piece extraction:** when a bench thumbnail is extracted to the canvas (spiralPlace, drag, zoomToPlacePiece — three paths in bench.ts), the bench-specific treatments (glow, sandwich if added here) are removed as part of reparenting — same way 47a removes the glow. The sandwich on the canvas-side is handled by the existing `applyHighContrast` on the scene spriteMap; no duplication.

### Sandwich parameters unchanged

Use the exact same `addSandwichStroke` from Story 37d — inner white 1.5 px + outer black 2.5 px. Do not retune for bench thumbnail scale. At THUMBNAIL_SIZE = 128 (Story 46b), 2.5 px outer ring = ~2% of the piece extent, which looks subtle but is enough when combined with the glow slot-lift. If QA reveals the stroke thickness genuinely isn't perceptible on small bench pieces even with the glow, that's a separate follow-up story — do not diverge the parameters from the canvas version in this one.

## Constraints

- **Do not touch the uplight glow** (Story 47a). Glow stays unconditional, glow stays at current parameters. This story is additive.
- **Do not touch canvas HC behavior.** Canvas pieces continue to receive the sandwich exactly as today via scene.ts's spriteMap call.
- **Do not re-tune the sandwich parameters** for bench scale. Same filter, same sizes.
- **Preserve the `_tag: 'hc-sandwich'` idempotency.** Rapid HC toggle must not accumulate filters. Same `_tag` read/write pattern as canvas side.
- **Preserve Story 46b bench clipping fix** — the mask still clips cleanly; adding the sandwich outline must not make pieces bleed past the tray body or cause new clipping regressions.
- **Preserve the three extraction paths** (spiralPlace click, drag extraction, zoomToPlacePiece). Whichever path removes the glow today must now also remove the sandwich. If using Approach A, the preference system may handle removal automatically; if Approach B, the three paths call an additional remove helper.
- **No algorithm change, no color change, no new filter primitive.** Reuses existing OutlineFilter sandwich infrastructure.
- **Do not turn off the glow in HC.** The spike's original assumption that "sandwich alone suffices at canvas scale" did NOT hold at thumbnail scale; the fix is additive, not substitutive.

## Files likely to touch

- `src/utils/preferences.ts` — primary if Approach A: new `registerBenchSpriteMap`, extend `applyHighContrast` iteration
- `src/canvas/bench.ts` — call the new registration during `initTray` / CUTS_COMPLETE wiring; possibly add removal in the three extraction paths depending on approach
- `src/canvas/scene.ts` — minor: if approach needs the bench sprite map passed through from scene context
- `docs/decisions.md` — short note: why sandwich is now applied to bench, and the "glow + sandwich both required at thumbnail scale" conclusion
- `docs/gotchas.md` — candidate one-liner: "HC sandwich at thumbnail scale is necessary but not sufficient — combine with slot-level chrome treatment"

## Acceptance

User tests via QA page. Write ACs into `public/qa.html`.

- **AC-1: HC ON, dark piece on HC bench.** Load `qa-scratch/spike-47a-pure-black.png` (or any fixture with very dark pieces — the Story 48 regression fixture on a dark patch works). Enable HC. Bench thumbnails show a visible white outer ring (the sandwich's inner white at 1.5 px) — pieces are now discernible as piece-shaped objects, not black silhouettes.
- **AC-2: HC ON + glow visible.** Same scenario. The uplight glow from 47a is still visible behind each piece. Both treatments coexist.
- **AC-3: HC OFF → HC ON → HC OFF.** Rapid toggle. No filter accumulation on bench thumbnails. No visible flicker other than the intended on/off state. Each toggle leaves the pieces in a correct state.
- **AC-4: Canvas HC unchanged.** Pieces on the canvas/board in HC still have the sandwich as they did before this story. No double-sandwich, no missing sandwich.
- **AC-5: HC OFF — bench thumbnails have NO sandwich.** Only the uplight glow. Confirms the sandwich is strictly HC-gated.
- **AC-6: Extraction paths clean.** Extract a bench piece via (a) single click (spiralPlace), (b) drag-and-drop out of bench, (c) keyboard Enter on a focused bench piece (which goes through zoomToPlacePiece or spiralPlace depending on mode). In all three cases, the extracted piece on the canvas receives the normal canvas HC sandwich (if HC is on), and no ghost sandwich is left behind in the bench.
- **AC-7: Story 47d mesa board unchanged.** No visual regression on board rendering — the board's 8-layer mesa stack is unaffected.
- **AC-8: Story 46b clipping preserved.** Tabs with downward knobs still visible, focus ring still visible, pieces still clipped to bench body horizontally.
- **AC-9: Story 47a glow lifecycle preserved.** Glow removal on extraction still happens; no glow ghosts appearing on the canvas.
- **AC-10: Perf stable at 200-piece grid.** Large-grid image (2048×2048) loads; HC toggle doesn't introduce noticeable lag. Filter cost is "HC sandwich × number of bench thumbnails" — the same per-piece cost as canvas HC today, applied to the same piece count (before extraction), so this is worst-case doubling HC filter cost briefly while bench is full. Measure and note in QA report.

## Out of scope

- Retuning sandwich thickness for bench scale (deferred — do sandwich at canonical parameters first, retune only if needed)
- Any new piece-color-adaptive contrast treatment (rejected per the 47a prompt direction — art stays untouched)
- Non-HC sandwich on bench (the uplight glow is the non-HC treatment; sandwich is HC-only)
- Changes to Story 47d board rendering, Story 46b bench mask, Story 37d HC preference toggle UI
- Story 47c (palette tuning) — still candidate
- Story 46f (label clipping Approach B) — still candidate
- Story 49 (metadata shape) — epic progression; queued after accessibility gaps close

## Known next

Queued candidates after 47e ships:
- **Story 47c** — Palette tuning + swap UI (user's punchy-color frustration)
- **Story 49** — Minimal metadata shape (Controlled Inputs epic progression)
- **Story 46f** — Label clipping Approach B (architectural debt)

BA picks the order at that point.
