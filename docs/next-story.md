# Story 47f: Filter ordering fix + extraction cleanup helper (Phase 1 MVV)

## Context

This is **Phase 1** of the accessibility architecture migration designed in `docs/accessibility-design.md`. It's the minimum viable refactor: two targeted structural fixes that close the only currently-reproducible bug (R-1) and reduce extraction-path fragility (R-2), with **zero behavior change for users**.

Before starting, read:
- `docs/accessibility-design.md` — the architecture this story implements (focus on the §"Composition model" filter-ordering rules and Phase 1 in §"Migration plan")
- `docs/accessibility-architecture.md` §3 R-1 and R-2 — the original risks this story closes
- `src/utils/preferences.ts` `addSandwichStroke` (current implementation)
- `src/canvas/bench.ts` `removeBenchGlowFromContainer` and the three extraction sites (`spiralPlace`, drag pointer-up, `zoomToPlacePiece`)

This story does NOT introduce a `FilterStack` class or atomic-preference restructuring. Both are explicitly deferred per the design's MVV-first phasing — Phase 1 is the cheapest, highest-leverage safety improvement; subsequent phases stay queued only if needed.

## Requirements

### Fix 1: `addSandwichStroke` inserts before greyscale, not blind-append

In `src/utils/preferences.ts`, `addSandwichStroke` currently appends the two new `OutlineFilter` instances to the end of `sprite.filters`. When greyscale is already active, this puts greyscale at index 1 and the sandwich filters at the tail — the "greyscale must be last" invariant breaks.

Replace the append with an explicit insert-before-greyscale:

1. Build the two `OutlineFilter` instances and tag them as today (`HC_FILTER_TAG`).
2. Read `sprite.filters` (or `[]` if null).
3. Find the index of any existing greyscale filter (matched by its `_tag === GREYSCALE_FILTER_TAG`).
4. If no greyscale filter exists, append: `[...existing, inner, outer]`.
5. If greyscale exists at index `i`, splice: `[...existing.slice(0, i), inner, outer, ...existing.slice(i)]`.

The idempotency guard (`if (sprite.filters?.some(f => (f as TaggedFilter)._tag === HC_FILTER_TAG)) return`) stays unchanged — this is the existing protection against duplicate insertion, not the bug being fixed.

### Fix 2: `prepareContainerForCanvas` helper in `bench.ts`

Three extraction sites in `bench.ts` each manually call `removeBenchGlowFromContainer(container)` before reparenting a piece container to the viewport. The fourth path (`extractPieceFromBench`) calls it as a catch-all. The risk: any future story that adds a fifth extraction path silently leaks the glow to canvas.

Replace the manual removal at the three sites with a single named helper:

```ts
// Exported from bench.ts
export function prepareContainerForCanvas(container: Container): void {
  removeBenchGlowFromContainer(container);
  // Future: any other bench-only chrome cleanup goes here
}
```

The three sites change from `removeBenchGlowFromContainer(container)` to `prepareContainerForCanvas(container)`. The single comment line ("Future: any other bench-only chrome cleanup goes here") is the named hook for the next bench-context behavior added — that addition lands in one place instead of having to update N extraction sites.

`extractPieceFromBench` keeps its own direct `removeBenchGlowFromContainer` call as the catch-all safety net — do NOT change it. Catch-all and named-helper coexist by design; the helper makes new paths self-correcting, the catch-all protects against helper-skip mistakes.

### What does NOT change

- **No visual change.** Pixel-for-pixel identical output before and after.
- **No new abstractions.** No `FilterStack`, no behavior registry, no preference restructuring. Phase 1 is structural-fix only.
- **No `quality` / `padding` changes** on `OutlineFilter` — that's Story 47e-r (Phase 2).
- **No bench color changes** — that's Story 47g (Phase 2b, optional).
- **No new gotcha doc entries** — that's Story 47h (separate doc-only story).
- **No changes to `applyHighContrast`'s caller logic.** The fix lives entirely inside `addSandwichStroke`.
- **No changes to `addGreyscaleFilter`** — already correct (appends last).

## Constraints

- **Single-session scope.** ≈35 lines of code change total. If you find yourself touching a third file, you're scope-crept.
- **Do not introduce a `FilterStack` class.** The architect deferred it; the MVV inside-`addSandwichStroke` fix gives 80% of the safety at 1/5 the cost.
- **Do not refactor `addGreyscaleFilter` for symmetry.** Greyscale already appends correctly; touching it adds risk for no gain.
- **Do not change `OutlineFilter` constructor parameters** (`thickness`, `color`, `alpha`, `quality`, `padding`). Visual output stays identical.
- **Do not change the idempotency guards** in either function. Existing tag-based duplicate prevention stays.
- **Do not delete the catch-all in `extractPieceFromBench`.** The defense-in-depth coexists with the named helper.
- **Per `decisions.md` §"Process":** never commit without explicit user instruction. Present the work via `/qa` and wait.

## Files

- `src/utils/preferences.ts` — `addSandwichStroke` only (≈ 15 lines changed)
- `src/canvas/bench.ts` — new exported `prepareContainerForCanvas`; three call-site replacements (≈ 20 lines changed)

`git diff src/` should show **only these two files**. Any third file touched is a scope violation; flag it and revisit before continuing.

## Acceptance

User tests via QA page (`http://localhost:5173/qa`). Update `STORY` and `FIXTURES` per the `/qa` command format.

- **AC-1: HC then greyscale produces correct ordering.** Load any image. Enable HC, then enable greyscale. `sprite.filters` on any piece = `[BevelFilter, OutlineFilter(inner), OutlineFilter(outer), ColorMatrixFilter]`. Greyscale last; sandwich before greyscale. Verify in console / debugger or DEV assertion.
- **AC-2: Greyscale then HC produces same ordering.** Reverse order: enable greyscale first, then HC. Same final array shape. This is the bug R-1 directly fixes — pre-MVV would put greyscale at index 1 and sandwich at the tail.
- **AC-3: Rapid HC toggle with greyscale active — no filter accumulation.** Greyscale on. Toggle HC: on / off / on / off / on. After the dust settles, the filter array contains exactly the expected filters (no duplicates, no orphaned sandwich filters). Visual output: clean ring, no multi-ring artifact.
- **AC-4: No visual regression on canvas pieces.** Pieces rendered on the canvas / board look identical to pre-fix. Same BevelFilter, same sandwich (when HC), same greyscale (when active), same DropShadowFilter.
- **AC-5: No visual regression on bench thumbnails.** Bench piece appearance identical to pre-fix. The sandwich's thumbnail-scale invisibility is a known issue addressed by Story 47e-r (Phase 2) — do not address it here.
- **AC-6: Three extraction paths use the helper.** Grep `src/canvas/bench.ts` for `removeBenchGlowFromContainer`: only one direct call remains (in `extractPieceFromBench`); all three other extraction sites use `prepareContainerForCanvas`.
- **AC-7: Glow removal still happens at extraction.** Extract a bench piece via (a) single click (spiralPlace), (b) drag-and-drop out of bench, (c) keyboard Enter (zoomToPlacePiece). In all three cases, the resulting canvas piece has no glow ghost.
- **AC-8: Story 47a glow lifecycle preserved.** Glow appears on bench pieces, is unconditional (HC and non-HC), still removed cleanly on extraction.
- **AC-9: All previously-shipped HC + greyscale + reduced-motion + label QA paths still pass.** Spot-check the `regression-script.md` flow. No regression introduced by structural change.
- **AC-10: `git diff src/` shows only `preferences.ts` and `bench.ts`.** Run the diff yourself and report the line counts in the QA handoff.

## Out of scope

- **Story 47e-r** — HC sandwich rendering at thumbnail scale (`quality` / `padding` tuning). Queued next; depends on 47f shipping first.
- **Story 47g (optional)** — HC bench color contract change (`#000000` → `#1a1a1a` α 1.0). Queue only if 47e-r reveals it's still needed.
- **Story 47h** — Accessibility gotchas documentation (R-3, R-4, R-5 entries). Doc-only follow-up.
- **Story 47i (deferred)** — Full `FilterStack` class. Queued only if a third managed filter type is added AND ordering bugs surface again.
- **Story 47c (palette tuning + swap UI)** — independent of accessibility architecture; still candidate.
- **Story 46f (label clipping Approach B)** — independent; still queued.
- **Story 49 (metadata shape)** — Controlled Inputs epic progression; independent.
- Anything visual: filter parameters, colors, alphas, padding, quality.
- Anything new: new behaviors, new abstractions, new preferences, new contexts.

## Known next

After 47f ships:
1. **Story 47e-r** — raise `OutlineFilter.quality` from 0.15 → 0.3, add `padding: 8`. ~5 lines. Closes the long-running 47e question.
2. **Story 47g (optional)** — only if 47e-r's bench HC visual QA reveals the pure-black bench is still a problem. ~3 lines.
3. **Story 47h** — gotchas doc entries for R-3/R-4/R-5. Doc-only, low priority, any time after Phase 1.

Then back to feature work: 47c, 49, 46f, etc.
