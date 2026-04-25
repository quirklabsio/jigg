# Story 47e-spike: Accessibility architecture audit

## Context

Story 47e (extend HC sandwich stroke to bench thumbnails) is failing — the dev is iterating without converging. That, plus the recurring pattern of:

- Story 47a's HC-gate flip (originally gated off, then made unconditional after QA proved it was needed in HC too)
- The silent gap in the sandwich application (canvas pieces had it; bench pieces never did)
- The 47e plumbing requiring three different approaches because no clean integration point exists

…all signal the same thing: **the accessibility system isn't architected for safe modification.** Adding HC-only behavior without affecting non-HC, or modifying non-HC without leaking into HC, is currently more nervous-system than we want it to be.

This spike steps back from "fix HC bench" and instead audits the whole accessibility architecture. We need a contract that lets us change one preference's behavior in confidence that another isn't being silently affected.

This replaces the previous Story 47e (HC sandwich fix). Story 47e — if still warranted post-spike — will be re-scoped from this audit's findings.

## Scope: every accessibility preference, not just HC

The audit covers all current accessibility-related behaviors, not just high contrast:

- **High contrast** (Story 37a/c/d) — sandwich stroke, BevelFilter alpha shift, snap-highlight color, solid bench fill, possibly more
- **Greyscale** (Story 37a) — `ColorMatrixFilter` toggle
- **Reduced motion** (Story 37c) — `decelerate.friction` adjustment, viewport teleport tweaks, possibly other animation knobs
- **Piece labels** (Story 37b + follow-up) — Text overlay with rotation sync
- **Adaptive background presets** (Story 37a, Shift+B) — workspace bg cycle
- **Always-on accessibility-by-default treatments** (Story 47a–d) — bench uplight glow, adaptive board color, mesa hierarchy
- Any other preference or auto-applied accessibility behavior the audit surfaces

If a behavior exists for accessibility reasons, it goes in the audit.

## Requirements

This is a spike. **No production code changes.** Deliverables are documents and a follow-up plan.

### 1. Inventory

For each accessibility behavior, document:
- **What it does** — observable user-facing effect
- **Trigger** — preference toggle, automatic on image load, hard-coded always-on, etc.
- **Where it lives** — file(s), function(s), entry points
- **How it's applied** — filter add/remove? state mutation? render-time conditional? container insertion?
- **What context it covers** — canvas pieces? bench pieces? board? workspace? all? subset?
- **What context it does NOT cover** — known or suspected gaps (the bench-sandwich gap is the seed example)

### 2. Coupling map

For each behavior, document its interactions:
- **Other accessibility prefs it depends on or affects** — e.g., does HC change the snap-highlight color while reduced-motion changes its duration, and do they collide?
- **Non-accessibility code it touches** — e.g., `applyHighContrast` reaching into the same filter array as BevelFilter and DropShadowFilter; does adding/removing a filter risk reordering or losing others?
- **Shared state** — module-level variables, `_tag` patterns, sprite/container references. Where is mutation cross-cutting?
- **Order dependencies** — does the order of filter add/remove matter? Are filter-array indices implicit assumptions?

### 3. Risk surface

For each behavior, identify the regression failure modes:
- "If a future story changes X, what could break?"
- Specific examples: filter accumulation on toggle, missing remove path, lost ordering, stale state on toggle mid-extraction, etc.
- Look for patterns where a future change to one preference would silently break another.

### 4. Architecture proposal

Based on findings, propose:
- **A clean contract** for adding a new accessibility behavior — the dev should be able to specify what it does and which contexts it applies to without needing to understand the whole system. E.g., a registry pattern, or a per-context filter manager, or just better separation of concerns.
- **What stays as-is** — call out what already works well so the proposal isn't a full rewrite for its own sake.
- **What changes** — concrete refactoring with files, functions, and signatures.
- **The invariant we want**: *changes to one accessibility preference's behavior do not silently affect another preference's behavior.* The proposal should make this checkable.
- **Feasibility/cost**: is this one refactoring story, or several? What's the minimum viable refactor that gives us 80% of the safety, and what's the full version?

### 5. Reassess Story 47e

The original 47e premise was "extend HC sandwich to bench thumbnails." Re-evaluate:
- Is the sandwich-on-bench actually what HC users need at thumbnail scale, or is the always-on glow already serving them?
- If still needed, does it look right at 128 px thumbnail size, or should the parameters diverge?
- Does the new architecture proposal change how 47e is implemented, or even whether it's still necessary?

End with a clear recommendation: **47e proceeds with new scope X / 47e is closed without code / 47e is closed and a different story Y replaces it.**

### 6. Follow-up story brief(s)

Concrete scope for the next story (or stories) the audit recommends. Could be:
- A refactor story (the architecture proposal applied)
- A re-scoped 47e
- Multiple stories sequenced (refactor first, then 47e on the new foundation)

BA reads the brief and writes the formal next-story prompt from it.

## Constraints

- **No production code changes.** A small throwaway helper to inventory filter arrays is fine; don't commit it. `git diff src/` should be empty at session end.
- **Read-only spike.** Goal is understanding, not modification.
- **Cover the breadth, not the depth.** Don't go deep on any one preference. The point is to see the whole shape and identify coupling. Detailed implementation lives in the follow-up.
- **Don't propose a full rewrite for its own sake.** Identify the minimum changes needed for the safety invariant. Big refactors invite bigger bugs.
- **Don't try to fix anything during the spike** — even something obviously wrong. Note it in the audit and route to a follow-up story.

## Files likely to touch (read, not write)

- `src/utils/preferences.ts` — the main accessibility plumbing
- `src/canvas/scene.ts` — where canvas-side prefs are wired (callbacks, applyHighContrast call site, sprite map registration)
- `src/canvas/bench.ts` — bench-specific accessibility (glow, separate sprite map, label sync)
- `src/canvas/board.ts` — adaptive board (Story 47b/d)
- `src/canvas/app.ts`, possibly other canvas modules — anything called from preference-apply paths
- `docs/decisions.md` — every existing accessibility decision (sandwich, BevelFilter alpha, snap colors, glow, mesa, etc.)
- `docs/accessibility.md` — existing accessibility doc (status, principles)
- `docs/engine-conventions.md` — any accessibility invariants

### Files to write

- `docs/accessibility-architecture.md` (NEW) — primary deliverable: inventory, coupling map, risk surface, architecture proposal, re-scoping for 47e, follow-up brief(s)
- `docs/decisions.md` — short note: "Accessibility architecture audit (Story 47e-spike)" pointing at the new doc, with a one-paragraph summary of the recommended invariant and refactor approach
- `public/qa.html` — STORY + FIXTURES updated for this spike (ACs are about the document, not runtime behavior)

## Acceptance

- **AC-1: Inventory complete.** `docs/accessibility-architecture.md` lists every accessibility behavior in the codebase with the schema in §1 (what / trigger / location / application / context coverage / gaps). User reviews and confirms nothing meaningful is missing.
- **AC-2: Coupling map exists.** Each behavior has its dependencies, non-accessibility-code interactions, shared state, and order dependencies documented.
- **AC-3: Risk surface identified.** At least 3 named failure modes with worked examples, plus the structural pattern that creates them.
- **AC-4: Architecture proposal.** A concrete refactoring proposal that makes the invariant *"changes to one accessibility preference do not silently affect another"* checkable. Names files, functions, signatures. Identifies the minimum viable version vs. the full version.
- **AC-5: 47e reassessed.** Clear recommendation on the original 47e: proceed with new scope, close without code, or replace with a different story.
- **AC-6: Follow-up brief.** Concrete next-story scope in `docs/accessibility-architecture.md` that BA can lift into a prompt.
- **AC-7: No production code committed.** `git diff src/` returns empty at session end.

## Out of scope

- Implementing any of the proposal — that's the follow-up story or stories
- Visual tweaks to existing accessibility treatments (HC sandwich parameters, glow alpha, etc. — those are tuning, not architecture)
- The original Story 47e implementation (paused pending audit)
- Story 47c (palette tuning), Story 49 (metadata), Story 46f (label clipping Approach B) — still candidates, untouched

## Known next

After this spike: at minimum one follow-up story emerges from the audit. Likely shape:
- **Architecture refactor story** — apply the minimum-viable invariant fix
- **Re-scoped 47e** — or 47e closed and a different story takes its place

Story 47c, 49, 46f remain candidates.
