**Purpose: keep documentation from going stale.** Every shipped story has the potential to contradict something written in the docs — an architectural assumption now wrong, a pattern now deprecated, a gotcha now resolved. `/refine` is the maintenance pass that reconciles the docs with the current reality. It is additive (capture what's new), corrective (fix what's now wrong), and subtractive (delete what no longer applies) — all three.

**No fluff.** Only add what a future reader will actually need. The bar for every new line is: "does this save someone from having to re-derive it, re-discover it, or re-debug it?" If the answer is no — if it's restating the obvious, narrating what shipped, or adding symmetry for its own sake — don't write it. Doc bloat hurts more than doc absence; padded files stop getting read.

**When to run.** Only after manual QA has passed — after `/qa`, after the user has tested, after any bugfixes. If you are still in the "declared done but not yet verified" window, run `/qa` instead, not this.

## The pass

Read current state first so you can spot drift, not just add to it:
- `docs/README.md` — orient on the doc structure
- `docs/gotchas.md`, `docs/decisions.md`, `docs/architecture.md` — scan for claims the new work contradicts
- `docs/stories.md` — match format and voice of recent entries before writing a new one

Then reconcile. For each doc touched:
- **Add** new knowledge that emerged this session
- **Correct** anything the new work invalidates (a decision that was reversed, an architectural claim that's now outdated, a gotcha whose root cause was fixed)
- **Delete** guidance that no longer applies — don't leave dead sections for "historical context"; commit history is the historical record

## Routing new knowledge

- Something changed about **what exists or how it fits together** → `docs/architecture.md`
- A new **trade-off or choice was made** → `docs/decisions.md`
- A new **implementation detail, pattern, or constraint** → the relevant implementation doc (`engine-conventions.md`, `drag-and-drop.md`, `snap-detection.md`, `wasm-pipeline.md`, `accessibility.md`, `conventions.md`, `spec-integration.md`)
- A new **anti-pattern or failure mode** → `docs/gotchas.md`

Create a new implementation doc in `docs/` only if no existing file fits. Do not create new docs for the other two layers — there is exactly one architecture doc and one decisions doc.

## Always

- Update `docs/stories.md` with a new entry for this session. If the shipped work deviated from the prompt in `docs/next-story.md` (scope crept, sub-task deferred, different files touched than the touch list specified, etc.), explicitly note the delta — the BA needs this before queueing the next story.

## Never

- Touch `docs/next-story.md`. That file is BA-owned; dev never writes or clears it. The next dev session will notice a stale prompt via the staleness guardrail (see `CLAUDE.md`) and ask the user before proceeding.
