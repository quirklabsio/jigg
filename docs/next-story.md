# Story 47g: Remove HC sandwich; switch HC bench to `#1a1a1a` α 1.0

## Context

Two changes, one story. Both are admissions that the HC sandwich primitive isn't delivering the value it was designed for, and both are user-driven decisions made after the 47e-r failure:

**Change 1 — Switch HC bench color from `#000000` to `#1a1a1a` α 1.0.** The architectural contract (per `decisions.md` §"HC bench color contract") is *solid (α 1.0), dark*, not specifically *pure black*. The lighter base symmetric with normal mode + the always-on bench glow (Story 47a) provides perceptible silhouettes for dark pieces — without requiring any sandwich ring at all.

**Change 2 — Remove the HC sandwich stroke from PIECES.** Story 37d added the sandwich (inner white + outer black `OutlineFilter` pair) as a WCAG AAA-grade contrast guarantee around every piece in HC mode. Story 47e-r tried tuning its rendering parameters at thumbnail scale and failed. Story 47f tightened its filter-array ordering. None of it has delivered the user-visible benefit it was supposed to: bench HC pieces are still invisible without the bench-color change. **The piece sandwich doesn't solve the problem we keep trying to solve with it.** Maintaining it has cost (two filter passes per piece, ordering invariant complexity, all of Story 47f's work). User's call: rip it out from pieces. If a real HC user later reports canvas pieces are insufficiently bordered, we re-add it as a targeted treatment — for now, the defaults (BevelFilter, adaptive board, bench glow, mesa) plus the new HC bench color carry HC's perceptual character on pieces.

**Critical scope boundary: this removes the sandwich from PIECE sprites only.** The HC treatment on the bench's filter-strip swatches (a separate concern in `renderFilterStrip` / `bench.ts`, audit §1.6 — uses `SWATCH_HC_ACTIVE_CLR` and the dual-ring black-inner / magenta-outer styling on the active swatch) is **untouched**. That's a different HC treatment in a different code path, serving a different purpose (active-selection visibility on filter chrome, not piece visibility). Don't confuse the two.

This is a deliberate walk-back of WCAG AAA-level piece outline contrast. HC retains its other treatments: BevelFilter alpha boost, magenta snap highlight, label backing alpha, **filter-strip swatch ring colors and dual-ring HC styling**, solid tray. Only the sandwich-on-pieces is removed.

Before starting, read:
- `docs/decisions.md` §"HC bench color contract" (around line 23)
- `docs/decisions.md` §"High Contrast Repair (Story 37d)" (the original sandwich rationale)
- `docs/accessibility-design.md` Phase 2/2b sections
- `src/canvas/bench.ts` — `TRAY_BG_HC_*` constants
- `src/utils/preferences.ts` — `addSandwichStroke`, `removeSandwichStroke`, the `applyHighContrast` call site, `HC_FILTER_TAG` constant

## Requirements

### Change 1: HC bench color

In `src/canvas/bench.ts`:

1. Change `TRAY_BG_HC_COLOR` from `0x000000` to `0x1a1a1a`.
2. Keep `TRAY_BG_HC_ALPHA` at `1.0` (solid contract preserved).
3. Update the constant's comment to: *solid (α 1.0), dark — symmetric with normal mode `TRAY_BG_DEFAULT_COLOR`. The contract is "solid, dark," not specifically "pure black." Lighter base + bench glow makes dark pieces perceptible without per-piece outline.*

### Change 2: Remove HC sandwich from PIECES

**Scope is `src/utils/preferences.ts` only.** The bench filter-strip swatch HC treatment (`renderFilterStrip` in `bench.ts`, `SWATCH_HC_ACTIVE_CLR`) is a **different feature** — leave it completely alone.

In `src/utils/preferences.ts`:

1. Delete `addSandwichStroke` and `removeSandwichStroke` functions entirely.
2. Delete the `HC_FILTER_TAG` constant (no longer referenced).
3. Delete the inner/outer `OutlineFilter` constants if they were extracted at module scope (parameters that no longer have a caller in this file).
4. In `applyHighContrast`, remove the `addSandwichStroke(sprite)` / `removeSandwichStroke(sprite)` call branches. The function still exists for the BevelFilter alpha boost — that's the remaining HC-on-pieces behavior.
5. If `OutlineFilter` is no longer imported anywhere in `preferences.ts`, remove the import from `preferences.ts`. **Do not touch the `OutlineFilter` import or any usage in `bench.ts`** — bench has its own HC swatch logic that may use `OutlineFilter` independently.
6. Story 47f's insert-before-greyscale logic was inside `addSandwichStroke` — it dies with the function. The greyscale "must be last" invariant becomes trivially satisfied when sandwich doesn't exist; `addGreyscaleFilter` already appends correctly.

The DEV assertion in `applyGreyscale` that checks filter ordering may need adjustment — if it asserts on sandwich presence, simplify it to "BevelFilter at 0, greyscale at last (if present)." Don't delete the assertion; just relax it.

**Do not modify anything in `bench.ts` related to HC swatch styling, swatch active rings, filter strip rendering, or `SWATCH_HC_ACTIVE_CLR`.** Change 1 (above) touches `bench.ts` for the `TRAY_BG_HC_COLOR` constant — that's the only `bench.ts` change in this story.

### Documentation updates (in this story, not deferred)

- `docs/decisions.md` — mark the Story 37d "Two `OutlineFilter` instances (sandwich stroke) over one" decision as **superseded by Story 47g**. Add a short superseding entry near it: "HC sandwich removed in Story 47g — see entry below" with a one-paragraph explanation. The original entry stays for historical reference; readers see the supersession marker.
- `docs/decisions.md` §"HC bench color contract" — add a one-line follow-up: "Story 47g flipped to `#1a1a1a` α 1.0 (was `#000000`)."
- `docs/accessibility-design.md` — the design doc references the sandwich extensively. Add a banner at the top (after the title): *"Updated 2026-04-25: Story 47g removed the HC sandwich primitive. Sandwich-related sections (1.1, parts of 4 composition rules, Brief 47e-r, etc.) are kept for historical reference but no longer reflect current code."* Don't rewrite the design doc — note the supersession.
- `docs/accessibility-architecture.md` (the audit) — same banner. The audit was a snapshot in time; it stays as-is with a marker.

### What does NOT change

- **Normal mode bench** — `TRAY_BG_DEFAULT_COLOR` and `TRAY_BG_DEFAULT_ALPHA` untouched.
- **Bench glow** (Story 47a) — unchanged. Same color, same alpha, same fade. Both modes.
- **HC's other treatments** — BevelFilter alpha boost, magenta snap highlight, label backing alpha, swatch ring colors, solid tray. All preserved.
- **Greyscale** (Story 37a) — `addGreyscaleFilter` and `applyGreyscale` untouched. Just the ordering-assertion relaxation noted above.
- **Story 47f's `prepareContainerForCanvas` helper** — still useful for future bench-only chrome cleanup. Don't remove.
- **Adaptive board color** (Story 47b), **mesa hierarchy** (Story 47d), **filter strip rendering** (Stories 32+) — all independent, untouched.

## Constraints

- **Two files, ≈30–50 lines net.** Most of the diff is deletions in `preferences.ts`. If `git diff src/` touches any third file, that's scope creep.
- **Single session.** This is bigger than 47e-r (~5 lines) but still a tight, well-bounded change.
- **Do not re-tune `OutlineFilter` parameters** — there's no `OutlineFilter` left in HC after this story.
- **Do not bump the bench glow** to compensate for sandwich removal. We're testing whether glow + lighter base color is sufficient. If it isn't, the next story is "boost glow in HC" — separate decision.
- **Do not de-bundle HC into atomic preferences** in this story. The architect's Phase 3 is still queued; this story works inside the current bundled HC toggle.
- **Do not change normal mode** in any way.
- **Do not delete the historical decisions/audit content** — supersession markers only.
- **Per `decisions.md` §"Process":** never commit without explicit user instruction. Present via `/qa` and wait.

## Files

- `src/canvas/bench.ts` — `TRAY_BG_HC_COLOR` constant value + comment (~3 lines)
- `src/utils/preferences.ts` — delete `addSandwichStroke` / `removeSandwichStroke` / `HC_FILTER_TAG` + related constants and import; remove call sites in `applyHighContrast`; relax greyscale ordering assertion (~30–40 lines net deletion)
- `docs/decisions.md` — supersession markers (~10 lines added)
- `docs/accessibility-design.md` — supersession banner (~3 lines added)
- `docs/accessibility-architecture.md` — supersession banner (~3 lines added)

`git diff src/` should show **only `bench.ts` and `preferences.ts`**.

## Acceptance

User tests via QA page. Update `STORY` and `FIXTURES` per the `/qa` command format. Use the spike's synthetic fixtures (still in `/qa-scratch/`).

- **AC-1: HC + dark piece + bench → dark pieces discernible.** Load `spike-47a-pure-black.png`. Enable HC. The user can tell bench thumbnails apart at a glance. Pieces no longer disappear into the bench. Mechanism: warm glow + lighter base creates a visible silhouette; no per-piece ring needed.
- **AC-2: HC + canvas pieces — no sandwich ring.** Place a piece on the canvas in HC mode. Pieces have BevelFilter and DropShadowFilter (existing depth treatments) but no white/black outline ring around the piece edge. This is the deliberate change.
- **AC-3: Normal mode — unchanged.** Toggle HC off. Normal mode bench, normal mode pieces, normal mode everything renders identically to pre-fix.
- **AC-4: HC's other treatments preserved.** BevelFilter alpha boost still applies on HC toggle (verify visually: piece edges are slightly more pronounced in HC than normal). Snap highlight is magenta in HC. **Filter-strip swatch active state uses its full HC ring colors and dual-ring styling — explicitly verify the active swatch shows the magenta-outer / black-inner ring exactly as before. This treatment is intentionally untouched and must not regress.** Tray is solid.
- **AC-5: Greyscale + HC interaction.** Enable greyscale, then HC: filter array on each piece is `[BevelFilter, ColorMatrixFilter]` (no sandwich filters between them). Reverse order: same result. The 47f insert-before-greyscale logic dies with the sandwich, but the ordering invariant is now trivially satisfied.
- **AC-6: Bench glow (47a) preserved.** Glow visible behind each bench piece in both modes. Unaffected.
- **AC-7: HC bench background reads "dark / solid".** Slightly lighter than pure black, but the user shouldn't notice the change perceptually unless directly comparing. No canvas content visible through.
- **AC-8: All other shipped behaviors preserved.** Adaptive board color (47b), mesa (47d), filter strip layout (Story 32+), keyboard navigation, focus ring, all preferences except HC sandwich.
- **AC-9: `git diff src/` shows only `bench.ts` and `preferences.ts`.** Run the diff yourself; report line counts in the QA handoff.
- **AC-10: Documentation supersession markers applied.** `decisions.md` Story 37d entry marked superseded; `accessibility-design.md` and `accessibility-architecture.md` have supersession banners. Historical content preserved, current state clear.
- **AC-11: User confirms bench HC visibility resolved.** This is the moment the long-running issue closes. After QA, the user explicitly confirms whether bench HC visibility now works. If still failing, kick to tech-architect for a rethink (sandwich tuned, sandwich removed, bench color changed — what's left?).

## Out of scope

- **Boosting the bench glow** in HC mode. Separate decision after this story's QA.
- **De-bundling HC into atomic preferences.** Phase 3 of the architect's plan; deferred.
- **Story 47h** — gotchas doc entries for R-3/R-4/R-5. Doc-only follow-up, low priority, anytime.
- **Story 47c** — palette tuning + swap UI. Independent.
- **Story 46f** — label clipping Approach B. Independent.
- **Story 49** — metadata shape. Epic progression, independent.
- Any other HC behavior change (BevelFilter parameters, snap highlight color, **filter-strip swatch styling**, label alpha). Out of scope; HC visual character preserved beyond the piece-sandwich removal.
- **Filter-strip swatch HC treatment in `bench.ts`** (`SWATCH_HC_ACTIVE_CLR`, `renderFilterStrip` HC branch, dual-ring active styling). Explicitly out of scope. Different feature, different code path, different purpose. Untouched.
- Re-adding the piece sandwich as a targeted canvas-only treatment in some future story. Possible but not now; if a real HC user reports canvas piece outline insufficient, we revisit.

## Known next

After 47g ships, two branches based on AC-11:

- **AC-11 passes (bench HC visibility resolved):** the entire bench HC saga closes. HC sandwich removal is permanent (until/unless a user reports the canvas-side regression). Next: 47h (gotchas docs, low priority anytime), then back to feature work — 47c, 49, 46f, or 50+ (Daily Mechanic).
- **AC-11 fails (bench HC visibility still broken):** kick to tech-architect for a rethink. Three failed attempts (47e-r sandwich tuning, sandwich removal, bench color change) means our architectural primitive for "make HC bench pieces visible" is wrong at a fundamental level. Architect designs the next approach — possibly involving bench-context-specific chrome the sandwich never could provide.
