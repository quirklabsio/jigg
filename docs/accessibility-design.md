<!-- audience: Dev, BA, Agent -->

# Accessibility Architecture Design

*Produced by tech-architect session, 2026-04-25.*
*Inputs: `docs/accessibility-architecture.md` (47e-spike audit) + user insight on HC bench color.*
*Source of truth: this doc supersedes the audit's §4 "Architecture Proposal" for everything forward-looking. The audit remains the snapshot of what was found; this doc is what we're building toward.*

---

## 1. Principles

These are the durable beliefs the design rests on. All existing `decisions.md` entries are consistent with them.

**P1 — Boundary contrast, not interior contrast.**
WCAG 1.4.11 requires contrast at the visual boundary of a graphical object, not its interior fill. A pure-black piece on a dark bench is acceptable *if the boundary ring meets the threshold*. The sandwich stroke is the WCAG mechanism for piece boundary contrast; the bench background color is NOT. Design and test the boundary treatment, not the fill-vs-background ratio.

**P2 — Separate slot visibility from boundary contrast.**
The bench glow provides slot-level lift (you can see *where* a piece is); the sandwich stroke provides boundary-level contrast (you can see the piece *shape*). These are complementary, never redundant. A behavior that serves one concern must not be removed because the other concern is satisfied.

**P3 — Filter ordering is a hard invariant, not a convention.**
`[BevelFilter(0), sandwich?(1,2), greyscale?(last)]` must be structurally enforced by the code that adds each filter, not by the order in which callers invoke functions. Every `add*` function must inspect the existing array before appending.

**P4 — Extraction always cleans up bench-only decoration.**
Any bench-specific visual treatment must be removed before a piece enters canvas context. The cleanup must be consolidated at a named, documented boundary — never scattered as implicit preconditions at individual call sites.

**P5 — Always-on behaviors own no preference state.**
Bench glow, focus ring, adaptive board color, mesa board hierarchy, and ARIA structure are unconditional. They must not acquire `if (highContrast)` or `if (reducedMotion)` guards. The separation is enforced: these behaviors are structurally separate from the preference system and must stay that way.

---

## 2. Primitives

Each primitive is justified by a concrete current behavior. No speculative abstractions.

### 2.1 `FilterSlot` ordering

**What it is:** The named ordered positions in `sprite.filters`:
- Slot 0: `BevelFilter` — permanent, attached at `CUTS_COMPLETE`
- Slot 1–2: sandwich stroke (`OutlineFilter` × 2, tagged `hc-sandwich`) — HC-only
- Slot last: greyscale (`ColorMatrixFilter`, tagged `greyscale`) — greyscale-only

**Justified by:** R-1 (filter ordering bug) — `addSandwichStroke` appends blindly; when greyscale is already active, sandwich inserts after greyscale, breaking the "greyscale last" invariant.

**Enforcement mechanism:** Each `add*` function explicitly inspects the existing array before inserting. `addSandwichStroke` locates any greyscale filter and inserts *before* it. `addGreyscaleFilter` appends last regardless (already correct). This is the MVV fix — no new class required.

**Not built yet:** A `FilterStack` class with typed slots (see §9). Deferred; the MVV fix gives 80% of the safety at 1/5 the cost.

### 2.2 `prepareContainerForCanvas`

**What it is:** A single exported function in `bench.ts` that performs all bench-to-canvas container cleanup before reparenting.

```ts
export function prepareContainerForCanvas(container: Container): void {
  removeBenchGlowFromContainer(container);
  // future: remove bench-only filter overrides from sprite
  // future: restore canvas-scale label counter-scale
}
```

**Justified by:** R-2 (extraction cleanup fragility) — three extraction paths each call `removeBenchGlowFromContainer` directly. Story 47d found a fourth path that was missing it. The function gives future extraction paths a clear contract target.

**Note:** `extractPieceFromBench` (the internal state-mutation function) retains its own `removeBenchGlowFromContainer` call as a catch-all safety net. `prepareContainerForCanvas` replaces the three visual-reparenting call sites only; both calls are idempotent (glow tag check guards no-op).

### 2.3 HC bench color contract

**What it is:** The contract for the bench background in HC mode has two components:
1. **Solid (α 1.0)** — no canvas bleed-through. This is the accessibility requirement.
2. **Dark** — dark enough for the white inner ring to be visible. The specific hex is a tuning parameter.

**Justified by:** User insight — "force-pure-black bench in HC may be the wrong constraint." The audit shows pure black (`#000000`) creates 1.0:1 interior contrast for dark pieces even with the glow active. Raising the bench to `#1a1a1a` at α 1.0 (solid, not glass) still looks visually black, maintains the WCAG contract via the sandwich stroke, and is symmetric with normal mode's base color — removing the special case.

**Current value:** `TRAY_BG_HC_COLOR = 0x000000`. Contract says it must be: solid (α 1.0), dark (L ≤ ~0.01, i.e. ≤ `#1a1a1a`). The value is a tunable parameter in `bench.ts`, not a structural invariant. Changing it from `#000000` to `#1a1a1a` at α 1.0 is a Phase 2b story — independent of the Phase 1 MVV.

**Why dark pieces can't meet WCAG 1.4.11 via bench color alone:** For a pure-black piece to reach 3:1 contrast, the bench background needs L ≥ 0.10 — which is a mid-gray (~`#686868`). That's wrong aesthetically and creates failures on the other end (light pieces on mid-gray bench). The sandwich stroke is the correct and only mechanism for dark-piece boundary contrast. The bench background optimizes for "looks right" and "glow-lift works" — not for piece interior contrast.

### 2.4 Animation guard (documentation-only primitive)

**What it is:** The pattern that every animation path must follow: read `usePuzzleStore.getState().reducedMotion` at animation fire time.

**Justified by:** R-3 (new animations ignoring reduced motion) — no registry, no enforcer, just a discipline contract.

**Enforcement:** QA checklist item: every new animation added to the codebase must be tested with `reducedMotion` active. Gotcha entry added (Phase 3). No code change required today.

---

## 3. Contracts

Rules every implementation must follow. Violations are bugs.

**C1 — Filter add is idempotent.**
Every `add*` function must guard against duplicate application using the `_tag` pattern. Calling `addSandwichStroke` twice on the same sprite must produce no accumulation.

**C2 — Filter remove destroys GPU resources.**
Every `remove*` function must call `.destroy()` on removed managed filters. Removing without destroying leaks GPU memory.

**C3 — Greyscale is always last in the filter array.**
When greyscale is active, `sprite.filters[sprite.filters.length - 1]` is always the greyscale `ColorMatrixFilter`. Any code that appends filters after greyscale is active must insert before it.

**C4 — BevelFilter is always at index 0.**
No managed filter may be prepended before BevelFilter. `CUTS_COMPLETE` establishes this; all subsequent additions must preserve it.

**C5 — Bench-to-canvas transition always calls `prepareContainerForCanvas`.**
Any code path that reparents a container from the bench/tray to the viewport must call `prepareContainerForCanvas(container)` before the reparent. The `extractPieceFromBench` catch-all is belt-and-suspenders; it does not replace the call at the reparent site.

**C6 — `CUTS_COMPLETE` filter reset is the lifecycle start.**
No managed filter may be attached to a sprite before `CUTS_COMPLETE` fires. After `CUTS_COMPLETE`, `applyPreferences` re-establishes the correct filter state. Adding filters in `buildGridSprites` (before `CUTS_COMPLETE`) will silently destroy them when `CUTS_COMPLETE` resets `sprite.filters = [new BevelFilter(...)]`.

**C7 — Always-on behaviors have no preference conditions.**
A behavior tagged always-on in §6 must not acquire a preference guard at any point. Changes to always-on behavior must be implemented as changes to the behavior's own logic, not as preference-gating.

**C8 — HC bench is solid (α 1.0).**
`TRAY_BG_HC_ALPHA` must always be `1.0`. The color (`TRAY_BG_HC_COLOR`) is tunable within the "dark" range. Transparency in HC mode is never acceptable.

---

## 4. Composition Model

How the primitives interact when multiple behaviors are active simultaneously.

### 4.1 HC + Greyscale (filter ordering)

When both are active, the correct array is:
```
[BevelFilter, OutlineFilter(inner,hc-sandwich), OutlineFilter(outer,hc-sandwich), ColorMatrixFilter(greyscale)]
```

Toggle sequence must not matter. The post-MVV `addSandwichStroke` ensures this by inserting before any greyscale filter:

| Toggle sequence | Pre-MVV result | Post-MVV result |
|---|---|---|
| Enable greyscale → enable HC | `[Bevel, Grey, Inner, Outer]` ❌ | `[Bevel, Inner, Outer, Grey]` ✅ |
| Enable HC → enable greyscale | `[Bevel, Inner, Outer, Grey]` ✅ | `[Bevel, Inner, Outer, Grey]` ✅ |
| Toggle HC off while grey active | `[Bevel, Grey]` ✅ | `[Bevel, Grey]` ✅ |

The DEV assertion in `applyGreyscale` catches violations in development builds. It fires only when greyscale is applied while a BevelFilter is present.

### 4.2 HC + Reduced Motion (snap highlight)

`updateSnapHighlight(highContrast, reducedMotion)` is the coordination point. Reduced motion takes priority (magenta, skip animation). HC alone (no RM): magenta at α 1.0. Neither: green at α 0.4. No ordering risk — this is an explicit priority chain, not array-ordering.

### 4.3 HC + Bench Glow (always-on)

No coupling. The glow is unconditional. HC is a preference. They coexist by design (Story 47a decision). The glow provides slot-level lift; HC sandwich provides boundary contrast. Neither replaces the other.

### 4.4 HC + Tray Background (direct subscription)

`_unsubscribeHC` in `bench.ts` fires synchronously on HC toggle via `usePuzzleStore.subscribe`. Path A (`applyFn` chain) fires the sprite updates. Both fire in the same synchronous Zustand notification burst; order depends on subscription registration order.

Current sequencing: HC tray subscription registered in `initTray`, Path A registered in `loadScene` (after `initTray`). Tray redraws first; sprite updates second. This order works and has no observable failure mode. It becomes a risk only if a future story needs the tray to have already redrawn *when sprite filters are being applied*. Document and leave.

### 4.5 Always-on vs preferences (structural isolation)

The five always-on behaviors (bench glow, board color, mesa, focus ring, ARIA) are in separate modules or separate code paths from `applyPreferences`. There is no call from the preference system into always-on code, and no call from always-on code that reads preference state. This is correct and must be preserved.

---

## 5. Extension Contract

Recipe for adding a new preference-driven visual behavior. ≤ half a page.

**Case A: New sprite-level filter behavior (e.g. colorblind simulation filter)**

1. Add constants at top of `preferences.ts`: tag name, filter parameters.
2. Write `add<Behavior>Filter(sprite: Sprite)`:
   - Guard: check `_tag` before adding (idempotency)
   - Determine correct insertion position: after BevelFilter, before greyscale (if greyscale must remain last), after sandwich if sandwich must precede it. Update the `FilterSlot` ordering in §2.1 of this doc.
   - Insert using splice, not blind append.
3. Write `remove<Behavior>Filter(sprite: Sprite)`: filter by tag, call `.destroy()`.
4. Write `apply<Behavior>(active, pieces, spriteMap)`: call add/remove per piece.
5. Add to `applyPreferences` call chain.
6. If the behavior interacts with other preferences (ordering constraints), update the DEV assertion in `applyGreyscale` (or whichever assertion guards the full ordering invariant).
7. Add a QA row to `public/qa.html` testing: activate alone, activate with each existing preference active, rapid toggle (no accumulation).

**Case B: New tray-level visual behavior (no sprite)**

1. Add state/constants in `bench.ts`.
2. Add a `usePuzzleStore.subscribe` callback in `initTray` (following the `_unsubscribeHC` pattern).
3. Unsubscribe on cleanup. Use a module-level `_unsubscribe<Name>` variable.
4. Document the new subscription in the coupling map (§2.7 of the audit) — the dual-path problem is known and managed, not eliminated.

**Case C: New always-on visual treatment**

1. The treatment must NOT read any preference state (P5).
2. Implement in the appropriate module (`bench.ts` for bench, `board.ts` for board, `scene.ts` for stage-level).
3. If the treatment attaches anything to a piece container that must be removed at bench-to-canvas transition, add the cleanup to `prepareContainerForCanvas` in `bench.ts`.

**Case D: New animation**

1. At the animation fire site, read `usePuzzleStore.getState().reducedMotion`.
2. If `reducedMotion` is true: skip, snap to final state, or reduce duration to 0.
3. Add a QA fixture testing the animation with `reducedMotion` active.
4. No registration, no registry — the discipline is the contract.

---

## 6. Mapping Current State to Architecture

Every behavior from the 47e-spike audit placed into the design. Proof the architecture accommodates all 15.

### Always-on behaviors — no preference coupling (P5)

| # | Behavior | Architecture placement | Status |
|---|---|---|---|
| 1.11 | Bench piece uplight glow | Bench context only; removed at extraction via `prepareContainerForCanvas` | **Phase 1**: call sites updated |
| 1.12 | Adaptive board color | Fires once at `loadScene`; pure function of image pixels | ✅ Correct as-is |
| 1.13 | Mesa board hierarchy | Fires once at `loadScene`; pure geometry | ✅ Correct as-is |
| 1.14 | Focus ring | Stage-level ticker; always magenta; no preference state | ✅ Correct as-is |
| 1.15 | Screen reader / ARIA | DOM layer; structurally separate | ✅ Correct as-is |

### Preference-toggled via `applyPreferences` chain (Path A)

| # | Behavior | Architecture placement | Status |
|---|---|---|---|
| 1.1 | HC sandwich stroke | FilterSlot ordering, `addSandwichStroke` | **Phase 1**: insert-before-greyscale fix |
| 1.2 | HC bevel alpha boost | Iterates `sprite.filters` for `instanceof BevelFilter` | ✅ Correct as-is |
| 1.5 | HC label pill alpha | Reads `highContrast` in `applyPieceLabels` | ✅ Correct as-is |
| 1.6 | HC filter strip rings | Reads `highContrast` in `renderFilterStrip` at call time | ✅ Correct as-is |
| 1.7 | Greyscale | `addGreyscaleFilter` appends last; DEV assertion guards order | ✅ Correct as-is |
| 1.9 | Piece labels | Managed as sprite children; rotation synced at 3 sites | ✅ Correct as-is |
| 1.10 | Adaptive background | Reads preset from prefs, mutates `renderer.background.color` | ✅ Correct as-is |

### Preference-toggled via direct Zustand subscription (Path B)

| # | Behavior | Architecture placement | Status |
|---|---|---|---|
| 1.3 | HC solid tray background | `_unsubscribeHC` → `redrawBackground()` in `bench.ts` | **Phase 2b**: color contract clarified; possibly tune `#000000` → `#1a1a1a` |
| 1.4 | HC snap highlight color | `updateSnapHighlight(hc, rm)` with RM priority | ✅ Correct as-is |
| 1.8 | Reduced motion | `applyReducedMotion` for viewport; per-animation `getState()` checks | ✅ Correct as-is; document R-3 |

### Rendering gap (not an application gap)

| # | Behavior | Architecture placement | Status |
|---|---|---|---|
| 1.1 (bench) | HC sandwich at thumbnail scale | `OutlineFilter.quality` / `padding` parameters in `addSandwichStroke` | **Phase 2**: raise quality, add padding |

---

## 7. Migration Plan

Four phases. Each independently shippable. Each a valid stopping point.

---

### Phase 1 — MVV: filter ordering fix + extraction cleanup *(~35 lines, single session)*

**Scope:** Fix R-1 (filter ordering violation) and consolidate extraction cleanup (R-2). No behavior change visible to users. Pure structural fix.

**Changes:**

*`src/utils/preferences.ts` — `addSandwichStroke` (≈15 lines):*

Replace blind append with position-aware insert:
```ts
function addSandwichStroke(sprite: Sprite): void {
  if (sprite.filters?.some((f) => (f as TaggedFilter)._tag === HC_FILTER_TAG)) return;

  const inner = new OutlineFilter({ thickness: HC_INNER_OUTLINE_THICKNESS, color: HC_INNER_OUTLINE_COLOR, quality: 0.15 });
  const outer = new OutlineFilter({ thickness: HC_OUTER_OUTLINE_THICKNESS, color: HC_OUTER_OUTLINE_COLOR, quality: 0.15 });
  (inner as TaggedFilter)._tag = HC_FILTER_TAG;
  (outer as TaggedFilter)._tag = HC_FILTER_TAG;

  const existing = sprite.filters ?? [];
  const greyIdx = existing.findIndex((f) => (f as TaggedFilter)._tag === GREYSCALE_FILTER_TAG);
  if (greyIdx === -1) {
    sprite.filters = [...existing, inner, outer];
  } else {
    sprite.filters = [
      ...existing.slice(0, greyIdx),
      inner,
      outer,
      ...existing.slice(greyIdx),
    ];
  }
}
```

*`src/canvas/bench.ts` — `prepareContainerForCanvas` (≈20 lines):*

Add exported function and update the three visual-reparenting call sites:
```ts
export function prepareContainerForCanvas(container: Container): void {
  removeBenchGlowFromContainer(container);
  // Extend here when bench-only filter overrides or label scale corrections are added.
}
```

Replace `removeBenchGlowFromContainer(container)` with `prepareContainerForCanvas(container)` at:
- `spiralPlace` (line ~1109)
- the drag extraction path in `onStagePointerUp` (line ~1196)
- `zoomToPlacePiece` (line ~1346)

Keep `removeBenchGlowFromContainer(extractedContainer)` in `extractPieceFromBench` as the catch-all (belt-and-suspenders; idempotent).

**Acceptance:**
- Enable greyscale → enable HC: `sprite.filters` = `[Bevel, Inner, Outer, Grey]` (greyscale last)
- Enable HC → enable greyscale: same result
- Rapid toggle HC with greyscale active: no filter accumulation
- Three extraction paths in `bench.ts` call `prepareContainerForCanvas` — no direct `removeBenchGlowFromContainer` at those call sites
- All existing HC + greyscale QA criteria pass

**Valid stopping point:** R-1 and R-2 resolved; remaining risks (R-3 through R-5) are non-urgent and documented.

---

### Phase 2 — 47e re-scoped: OutlineFilter rendering at thumbnail scale *(~5 lines, single session)*

**Background on 47e's original premise and why it was wrong:**
Story 47e was scoped as "extend HC sandwich to bench thumbnails." The spike revealed the sandwich IS applied to bench sprites via `spriteMap`. The original premise was incorrect. The gap is a rendering issue: `quality: 0.15` (very low sample count) and no `padding` on the OutlineFilter instances mean the ring may not render visibly at thumbnail scale (`thumbScale()` ≈ 0.08–0.15).

**The padding issue is the likely root cause.** `OutlineFilter.padding` controls how many pixels the filter can bleed outside the sprite's bounding box. Without it, PixiJS clips the ring to the sprite bounds — the outer ring (which extends outside the alpha mask boundary) gets clipped. At canvas scale (800px sprite) this clipping is unnoticeable; at bench scale (16px displayed sprite) the ring has no room and disappears.

**Scope:** In `addSandwichStroke`, raise `quality` from `0.15` to `0.3` on both filters, and set `padding` to `Math.max(6, Math.ceil(HC_OUTER_OUTLINE_THICKNESS * 3))` (≈ 8). This is a universal improvement — canvas behavior is unchanged (quality improvement is invisible on large sprites; padding is always generous enough). Bench thumbnails gain a visible ring.

**Changes:**
- `src/utils/preferences.ts` — `addSandwichStroke`: update `quality: 0.15` → `quality: 0.3`; add `padding: 8` to both `OutlineFilter` constructor calls (≈5 lines changed)

If bench and canvas need demonstrably different parameters after visual QA, introduce bench-specific constants:
```ts
const HC_OUTLINE_QUALITY_CANVAS = 0.15;
const HC_OUTLINE_QUALITY_BENCH  = 0.3;
const HC_OUTLINE_PADDING_CANVAS = 4;
const HC_OUTLINE_PADDING_BENCH  = 8;
```
But start with universal values; diverge only if QA shows a regression.

**Story 47e disposition: CLOSE the original scope; open Story 47e-r (re-scoped) for this Phase 2 work.**

**Acceptance:**
- HC mode active: bench piece thumbnails show a visible stroke ring — white inner ring visible against the HC bench background
- Canvas pieces: no visible change in outline rendering
- Rapid HC toggle: no filter accumulation (idempotent guard unchanged)
- `git diff src/` shows only `preferences.ts` changes

**Valid stopping point:** HC is visually correct for bench thumbnails; 47e-r closed.

---

### Phase 2b — HC bench color: solid, not pure-black *(≈3 lines, single session, optional)*

**Background:** The current `TRAY_BG_HC_COLOR = 0x000000` (pure black) was chosen in Story 37d for "maximum contrast with light pieces." The audit shows pure black creates 1.0:1 interior contrast for dark pieces — the piece body is invisible, only the ring distinguishes it. This violates the spirit of HC even though it satisfies the letter (WCAG via the sandwich stroke).

**User insight:** The requirement is SOLID (α 1.0), not PURE BLACK. Changing to `#1a1a1a` at α 1.0:
- Still looks visually black
- Is symmetric with the normal-mode base color (normal mode uses `0x1a1a1a` at α 0.85 — just the opacity changes)
- Dark pieces have marginally better interior visibility (1.2:1 vs 1.0:1 — not a WCAG win, but perceptually less "invisible")
- No functional change: sandwich stroke still provides the boundary contrast

**Scope:** Change `TRAY_BG_HC_COLOR` from `0x000000` to `0x1a1a1a` in `bench.ts`. Update the comment to reflect the correct contract ("solid, matches normal-mode base").

**Note:** This is the lowest-risk possible change (3 lines) but its *value* depends on whether the Phase 2 OutlineFilter fix makes the bench HC experience good enough on its own. QA this after Phase 2 — if the ring is visible and the bench feels right, skip 2b. If dark pieces still feel invisible even with the ring, ship 2b.

**Valid stopping point:** HC bench has the correct color contract documented; may or may not change the hex.

---

### Phase 3 — Documentation: gotchas additions *(~1 hour, no code)*

Address R-3, R-4, R-5 as documented risks, not code changes.

**R-3 (new animations ignoring reduced motion) → `docs/gotchas.md`:**
> Any new animation — tween, ticker, GSAP — must check `usePuzzleStore.getState().reducedMotion` at fire time. If true: snap to final state or skip entirely. Add a QA fixture for every new animation. There is no central registry; the discipline is the contract.

**R-4 (CUTS_COMPLETE filter reset) → `docs/gotchas.md`:**
> `CUTS_COMPLETE` does `sprite.filters = [new BevelFilter({...})]` for every piece — a hard reset. Any filter attached to a sprite before `CUTS_COMPLETE` fires will be silently destroyed. All managed filter additions must happen after `CUTS_COMPLETE` (in `applyPreferences`, called from the `CUTS_COMPLETE` handler). Never attach a managed filter in `buildGridSprites`.

**R-5 (subscription ordering) → `docs/gotchas.md`:**
> On HC toggle, two code paths fire: `_unsubscribeHC → redrawBackground()` (tray background) and `fireApplyPreferences → applyPreferences` (sprites). Order is tray-first, sprites-second (registration order). This is stable today because the two paths are independent. If a future story needs cross-context coordination (tray already redrawn when sprites update), this implicit order must be made explicit via a sequencing mechanism.

**Valid stopping point:** All five risks are either fixed (R-1, R-2 in Phase 1) or documented as known gotchas.

---

### Phase 4 — Full FilterStack *(deferred indefinitely)*

**Trigger:** A third managed filter type (beyond HC sandwich and greyscale) is added AND ordering bugs surface again post-Phase 1.

**What it is:** A `FilterStack` class per sprite with typed named slots (`_bevel`, `_sandwich`, `_greyscale`, etc.). Ordering enforced structurally — impossible to put greyscale before sandwich by construction. See the audit §4.4 for the full spec.

**Why deferred:** Phase 1 gives 80% of the safety at 1/5 the cost. The remaining 20% (type-enforced ordering for a hypothetical third filter type) is not worth ~150 lines of new abstraction with no concrete trigger. If the day comes, the audit has the full design ready.

**Valid stopping point:** Not started. Phase 1 is sufficient.

---

## 8. Testing Strategy

### Unit-level (filter correctness)

For each toggle sequence in `applyHighContrast` and `applyGreyscale`, assert the resulting `sprite.filters` array matches the expected ordering. Sequences to cover:

1. HC enabled, greyscale disabled: `[Bevel, Inner, Outer]`
2. Greyscale enabled, HC disabled: `[Bevel, Grey]`
3. HC enabled then greyscale enabled: `[Bevel, Inner, Outer, Grey]`
4. Greyscale enabled then HC enabled: `[Bevel, Inner, Outer, Grey]`
5. Toggle HC off (greyscale still on): `[Bevel, Grey]`
6. Toggle greyscale off (HC still on): `[Bevel, Inner, Outer]`
7. Rapid: HC on/off × 10 with greyscale active — no accumulation

### Extraction path (glow cleanup)

After each extraction path (spiralPlace, drag, zoomToPlacePiece), assert:
- The piece container has no child with label `'bench-glow'`
- The sprite has the correct canvas-context filter state

### Visual QA checklist (public/qa.html)

Existing rows to verify after Phase 1:
- HC sandwich visible on canvas pieces (regression check)
- HC + greyscale together: no visual artifacts, correct border rendering
- Rapid HC toggle: no filter accumulation (no thick multi-ring effect)

New rows to add for Phase 2:
- HC mode active: bench thumbnails show visible white inner ring against bench background
- HC mode: dark piece (near-black) thumbnail — ring visible
- HC mode: light piece (near-white) thumbnail — ring visible

### Regression protection

`test/fixtures/images/slice/` — the existing split-wb fixture (`spike-47a-split-wb.png`) exercises both white-on-board and black-on-bench. Promote a bench-HC fixture (a pure-black or near-black image) after Phase 2 completes.

---

## 9. Future-Proofing

Named near-term patterns only. No speculative abstractions.

**Colorblind simulation filter (candidate Story 7x):** If a colorblind simulation `ColorMatrixFilter` is added, it needs a FilterSlot position. Per the composition model, it must go between sandwich (if active) and greyscale (which must remain last). Add a new `_tag` constant, follow the Extension Contract §5 Case A. The `addSandwichStroke` fix in Phase 1 generalizes: insert before any filter that must be last.

**Bench-only filter overrides (candidate):** If bench thumbnails ever need a different filter variant than canvas pieces (e.g. a simplified BevelFilter at thumbnail scale), add that logic to `prepareContainerForCanvas` — either inverting bench-specific filters on extraction, or applying canvas-specific ones on reparent. The function is the named extension point (P4, §2.2).

**Forced-colors / OS-level HC (deferred):** The current system does not respond to CSS `forced-colors`. If that becomes a requirement, it touches both the DOM layer (ARIA, already structured correctly) and the PixiJS layer (canvas cannot respect `forced-colors` CSS — would require explicit `(prefers-contrast: forced)` media query handling at app init). Not a near-term trigger; document when OS HC integration is scoped.

**Animation registry (deferred):** If R-3 surfaces repeatedly (multiple new animations shipping without reduced-motion support), an `animateIfAllowed(fn, reducedFn)` utility function could centralize the check. Not worth building until it's been missed twice.

---

## 10. Story Briefs — BA Handoff

Sequenced. BA reads these and writes individual `next-story.md` prompts. Stories are ordered by dependency and safety-improvement-per-unit-of-work.

---

### Brief 47f: MVV — Filter ordering fix + extraction cleanup

**Priority:** Highest. Fixes the only currently-reproducible bug (R-1). Unblocks safe filter modification for all subsequent stories.

**Scope summary:** Two targeted fixes: (1) `addSandwichStroke` inserts before greyscale instead of blind-appending; (2) `prepareContainerForCanvas` consolidates the three extraction-path glow-removal call sites. No behavior change for users.

**Files likely touched:**
- `src/utils/preferences.ts` — `addSandwichStroke` function only (≈15 lines)
- `src/canvas/bench.ts` — new exported `prepareContainerForCanvas`; three call-site replacements (≈20 lines)

**Acceptance criteria:**
1. Enable greyscale then HC: `sprite.filters` = `[BevelFilter, OutlineFilter(inner), OutlineFilter(outer), ColorMatrixFilter]` — greyscale last ✅
2. Enable HC then greyscale: same result ✅
3. Rapid HC toggle with greyscale active: no filter accumulation (no multi-ring artifact)
4. Three extraction paths (`spiralPlace`, drag pointer-up, `zoomToPlacePiece`) call `prepareContainerForCanvas` — zero direct `removeBenchGlowFromContainer` calls at those sites
5. `extractPieceFromBench` retains its own `removeBenchGlowFromContainer` catch-all (unchanged)
6. All existing HC and greyscale QA criteria pass (no regression)
7. `git diff src/` shows only `preferences.ts` and `bench.ts`

**Key constraints:**
- Do not change `quality` or `padding` on OutlineFilter — that is Phase 2's scope
- Do not change any visual parameters; this is structural-only

**Scope:** ≈35 lines changed. Single session.

---

### Brief 47e-r: HC sandwich rendering at thumbnail scale

**Priority:** Second. Closes the long-running 47e question.

**Background for BA:** The original 47e premise ("sandwich not applied to bench sprites") was wrong. The audit confirmed the sandwich IS applied. The gap is rendering: `quality: 0.15` and no `padding` on the `OutlineFilter` instances likely cause the ring to be invisible at bench thumbnail scale. This story fixes the rendering parameters. Must be implemented on top of 47f (filter ordering fix).

**Scope summary:** In `addSandwichStroke` in `preferences.ts`, raise `quality` from `0.15` to `0.3` and add `padding: 8` to both `OutlineFilter` constructor calls. Verify that bench thumbnails show a visible ring in HC mode. If visual QA reveals canvas regressions, introduce bench-specific parameter constants; otherwise a single universal fix is preferred.

**Files likely touched:**
- `src/utils/preferences.ts` — `addSandwichStroke` only (≈5 lines)

**Acceptance criteria:**
1. HC mode active: bench piece thumbnails show a visible white inner ring against the bench background (against `#000000` or `#1a1a1a` HC bench)
2. HC mode: a near-black piece thumbnail shows the ring visibly distinguishing it from the bench
3. HC mode: a near-white piece thumbnail shows the outer black ring distinguishing it from a light background
4. Canvas pieces in HC mode: no visible regression in ring rendering (ring still appears correctly shaped, no artifacts)
5. Rapid HC toggle: no filter accumulation (idempotent guard unchanged)
6. `git diff src/` shows only `preferences.ts`

**Key constraints:**
- No changes to canvas-scale visual output unless unavoidable
- If separate bench/canvas constants are needed, name them clearly (`HC_OUTLINE_QUALITY_BENCH` vs `HC_OUTLINE_QUALITY_CANVAS`)
- Prerequisite: 47f must be shipped first

**Scope:** ≈5 lines changed. Single session.

---

### Brief 47g (optional): HC bench color contract

**Priority:** Low. Cosmetic/principle improvement; no WCAG impact.

**Background for BA:** The HC bench is currently `#000000` (pure black). The architectural contract says the requirement is SOLID (α 1.0), not pure black. Using `#1a1a1a` at α 1.0 is symmetric with normal mode's base color, marginally improves dark-piece interior visibility, and removes a special case. Queue only if visual QA after 47e-r confirms dark-piece bench experience still feels "invisible even with the ring."

**Scope summary:** In `bench.ts`, change `TRAY_BG_HC_COLOR` from `0x000000` to `0x1a1a1a` and update the comment to reflect the correct contract. Verify no regression in HC visual QA.

**Files likely touched:**
- `src/canvas/bench.ts` — one constant and one comment (≈3 lines)

**Acceptance criteria:**
1. HC mode: bench background visually reads as dark/black (perceptually unchanged from `#000000`)
2. HC mode: no canvas content visible through bench background (solid, no bleed-through)
3. Normal mode: unchanged (uses `TRAY_BG_DEFAULT_COLOR` / `TRAY_BG_DEFAULT_ALPHA`, unaffected)
4. `git diff src/` shows only `bench.ts`

**Scope:** ≈3 lines changed. Sub-story (can bundle with 47e-r or ship standalone).

---

### Brief 47h: Accessibility gotchas documentation

**Priority:** Low. Documentation only; no code. Can be done any time after Phase 1.

**Scope summary:** Add three gotcha entries to `docs/gotchas.md` for R-3 (new animations ignoring reduced motion), R-4 (CUTS_COMPLETE filter reset), and R-5 (subscription ordering). No production code changes.

**Files likely touched:**
- `docs/gotchas.md` — three new entries

**Acceptance criteria:**
1. R-3 entry: states the contract, gives the code pattern for checking `reducedMotion`, says "no registry — discipline is the contract"
2. R-4 entry: states that `CUTS_COMPLETE` hard-resets `sprite.filters`; never add managed filters in `buildGridSprites`
3. R-5 entry: documents the dual-path firing order and when it becomes a problem
4. No production code in `src/` changed

**Scope:** ≈1 hour. Single session.

---

### Brief 47i (deferred): Full FilterStack

**Priority:** Deferred indefinitely. **Do not queue until trigger fires.**

**Trigger:** A third managed filter type is added and the Phase 1 MVV fix is insufficient to maintain ordering (e.g. two ordering violations in a 3-month window post-Phase 1).

**Scope summary:** `FilterStack` class per sprite with named typed slots. See `docs/accessibility-architecture.md` §4.4 for the full spec. ≈150 lines of new code; touches `preferences.ts`, `scene.ts`, and `bench.ts`.

**Do not bundle with any feature story.** This is a pure structural refactor; ship alone.

---

## Appendix: Disposition of Risks

| Risk | Phase | Resolution |
|---|---|---|
| R-1: Filter ordering violation (HC+greyscale toggle) | Phase 1 | Fixed: `addSandwichStroke` inserts before greyscale |
| R-2: New extraction path leaks glow | Phase 1 | Mitigated: `prepareContainerForCanvas` is the named contract; catch-all remains |
| R-3: New animation ignores reduced motion | Phase 3 | Documented in gotchas.md |
| R-4: CUTS_COMPLETE filter reset destroys prior state | Phase 3 | Documented in gotchas.md |
| R-5: HC tray vs sprite subscription ordering | Phase 3 | Documented in gotchas.md |

## Appendix: 47e Disposition

| Version | Scope | Status |
|---|---|---|
| 47e (original) | "Extend HC sandwich to bench thumbnails" | **CLOSE** — premise was wrong. Sandwich is already applied via spriteMap. |
| 47e-r (re-scoped) | Fix OutlineFilter quality + padding for thumbnail-scale rendering | **Queue as Story 47e-r** after 47f ships |
