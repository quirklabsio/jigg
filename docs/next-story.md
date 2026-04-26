# Story 47e-r: HC sandwich rendering at thumbnail scale

## Context

Original Story 47e was based on a wrong premise — the HC sandwich stroke "wasn't applied to bench thumbnails." The 47e-spike audit (`docs/accessibility-architecture.md` §1.1) confirmed it IS applied: `applyHighContrast` iterates the entire piece sprite map, which includes bench sprites. The actual gap is **rendering**, not application: at bench thumbnail scale (~60–110 px wide), the existing `OutlineFilter` parameters (`quality: 0.15`, no `padding`) likely produce a sandwich ring too coarse or clipped to be visible. This is the long-overdue fix that closes the original 47e question.

47f's filter-ordering MVV (Phase 1) shipped 2026-04-25; this story is **Phase 2** of the accessibility migration plan from `docs/accessibility-design.md`. The MVV foundation means we can change `addSandwichStroke`'s constructor parameters with confidence that the surrounding filter-array contract still holds.

Before starting, read:
- `docs/accessibility-design.md` Phase 2 section and §"Brief 47e-r"
- `docs/accessibility-architecture.md` §1.1 (the rendering-issue clarification)
- `src/utils/preferences.ts` `addSandwichStroke` — the post-47f implementation

## Requirements

### The change

In `src/utils/preferences.ts`, in `addSandwichStroke`, modify both `OutlineFilter` constructor calls:

- Raise `quality` from `0.15` to `0.3`
- Add `padding: 8`

That's it for the universal-fix path. Both inner (white 1.5 px) and outer (black 2.5 px) instances get the same two parameter additions. All other parameters (`thickness`, `color`, `alpha`) stay unchanged.

### Decision fork (universal vs. bench-specific)

Try the universal change first. Verify in QA that:
- Canvas pieces in HC mode look identical (or visually indistinguishable) before/after
- Bench thumbnails in HC mode now show the sandwich ring

**If canvas regresses visibly** (the 0.3 quality + padding 8 makes canvas pieces look chunkier, more aliased, or otherwise wrong), split into bench-specific constants:

```ts
const HC_OUTLINE_QUALITY_CANVAS = 0.15;
const HC_OUTLINE_QUALITY_BENCH = 0.3;
const HC_OUTLINE_PADDING_CANVAS = 0;   // or whatever existing default is
const HC_OUTLINE_PADDING_BENCH = 8;
```

…and pick the right values based on which sprite map is being iterated. Document the split in `decisions.md` if you go this route.

**Strong preference:** universal fix. Only split if the canvas regression is real and visible. Don't pre-emptively split for theoretical reasons.

### What does NOT change

- **Idempotency guard** — existing tag-based duplicate prevention stays.
- **Filter ordering** — Story 47f's insert-before-greyscale logic is untouched. This story changes constructor parameters only.
- **`OutlineFilter` thickness, color, alpha** — sandwich visual character (white inner ring, black outer ring) stays.
- **`addGreyscaleFilter`, `addBenchGlowToContainer`, `prepareContainerForCanvas`, `applyHighContrast` caller** — none touched.
- **Bench background color** (`TRAY_BG_HC_COLOR`) — separate concern, deferred to optional Story 47g.

## Constraints

- **Single file, ≈5 lines (or ≈10 if the bench-specific split is needed).** If `git diff src/` touches anything beyond `preferences.ts`, that's scope creep — flag it and revisit.
- **No new dependencies, no new abstractions.** `OutlineFilter` from `pixi-filters` is already imported.
- **Do not change `addBenchGlowToContainer` or any non-HC bench rendering.** This story is HC-mode-only.
- **Do not touch the four extraction paths** that were updated in 47f. They use `prepareContainerForCanvas` correctly; not your concern.
- **Do not start the optional Story 47g** (HC bench color `#000000` → `#1a1a1a` α 1.0). It's queued for later, only if 47e-r reveals it's still needed.
- **Do not add the gotchas doc entries** (Story 47h). Doc-only follow-up, separate story.
- **Per `decisions.md` §"Process":** never commit without explicit user instruction. Present via `/qa` and wait.

## Files

- `src/utils/preferences.ts` — `addSandwichStroke` only (~5 lines, or ~10 if splitting)

`git diff src/` should show **only this one file**.

## Acceptance

User tests via QA page. Update `STORY` and `FIXTURES` per the `/qa` command format. Use the spike's synthetic fixtures (still in `/qa-scratch/`):

- `qa-scratch/spike-47a-pure-white.png` — solid white, exercises black outer ring on light bench pieces (in HC, bench is black; pieces from this image render mostly white → black outer ring is the visible separator)
- `qa-scratch/spike-47a-pure-black.png` — solid black, exercises white inner ring on dark bench pieces (the original 47e visibility complaint)
- `qa-scratch/spike-47a-split-wb.png` — half-and-half, exercises both rings simultaneously

Acceptance criteria:

- **AC-1: HC + dark piece + bench → visible white inner ring.** Load `spike-47a-pure-black.png`. Enable HC. Bench thumbnails show a discernible white ring distinguishing each piece silhouette from the dark bench background. The user can tell pieces apart at a glance.
- **AC-2: HC + light piece + bench → visible black outer ring.** Load `spike-47a-pure-white.png`. Enable HC. Bench thumbnails show a discernible black ring distinguishing each piece from the surrounding bench (and from each other).
- **AC-3: HC + mixed-luminance pieces → both rings visible where they're needed.** Load `spike-47a-split-wb.png`. Some bench thumbnails show the black outer ring (light pieces), some show the white inner ring (dark pieces). All are perceptible as discrete pieces.
- **AC-4: Canvas pieces in HC mode — no visible regression.** Place a piece on the canvas in HC mode. Sandwich ring still renders correctly: same shape, no new artifacts, no visible parameter-change side effect. If you can't tell the canvas piece changed, you're done. If you can, decide: is it a regression? If yes, split into bench-specific constants per the decision fork above.
- **AC-5: Rapid HC toggle — no filter accumulation.** With greyscale active and a puzzle loaded, toggle HC: on / off / on / off / on. After settling, sprite filters contain exactly the expected set (no duplicates). The 47f idempotency guarantee still holds; this story doesn't touch it.
- **AC-6: All previously-shipped behaviors preserved.** Bench glow (Story 47a) still visible. Canvas mesa board (Story 47d) still rendered. Adaptive board color (Story 47b) still selected per image. Filter ordering (Story 47f) still correct (`[BevelFilter, ...sandwich, ColorMatrixFilter]` when greyscale + HC both active).
- **AC-7: `git diff src/` shows only `preferences.ts`.** Run the diff yourself and report line count in the QA handoff. If you split into bench-specific constants, the diff is still one file.
- **AC-8: User confirms 47e closed.** This is the moment the long-running 47e issue resolves. After QA passes, the user explicitly confirms: bench HC visibility no longer feels broken. If the user still says "I can barely see them in HC," consider Story 47g.

## Out of scope

- **Story 47g (optional)** — HC bench color contract change. Only queue if AC-8 fails (bench HC still feels wrong after this story).
- **Story 47h** — gotchas doc entries (R-3/R-4/R-5). Doc-only follow-up.
- **Story 47i (deferred)** — `FilterStack` class. Only if a third managed filter type appears.
- **Story 47c** — palette tuning + swap UI. Independent.
- **Story 46f** — label clipping Approach B. Independent.
- **Story 49** — metadata shape. Epic progression, independent.
- Any other `OutlineFilter` parameter (`thickness`, `color`, `alpha`) — out of scope; keep visual character identical.
- Any rendering performance optimization — separate concern.

## Known next

After 47e-r ships:
1. **If AC-8 fails:** Story 47g (HC bench color → `#1a1a1a` α 1.0). ~3 lines.
2. **Story 47h** — gotchas doc entries. Doc-only, low priority, anytime.
3. **Then:** back to feature work — 47c (palette UI), 49 (metadata), 46f (label clipping), or 50+ (Daily Mechanic epic).
