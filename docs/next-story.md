# Spike: Architecture Migration Assessment

**Type:** Spike (read-only research)
**Timebox:** Half day (4 hours max)
**Output:** `docs/migration.md` — written recommendation. No code. No doc moves.
**Depends on:** Story 0 — `src/pipeline/` scaffolded, `.claude/skills/sme-jigg-*.skill` exist, `docs/architecture.md` rewritten as the pipeline reference. ✅ shipped (commits `f2b43ec`, `e89a2a0`).

---

## Required Reading (before starting)

1. `docs/architecture.md` — the target structure (Intake → Chop → Cook → Plate, derivation vs realization, contracts, import rules)
2. `.claude/skills/sme-jigg-pipeline.skill` — stage boundaries, Cook admission rules, contracts at a glance
3. `.claude/skills/sme-jigg-runtime.skill` — what belongs in store vs pipeline, runtime a11y placement
4. `.claude/skills/sme-jigg-spec.skill` — persistence shape, dissection vs assembly
5. `src/pipeline/` (the scaffold) and `src/pipeline/types.ts` — the contracts that already exist as types

This is a research story. You are not writing code. You are walking the existing codebase and producing a written assessment that will sequence every migration story that follows.

---

## Goal

Produce `docs/migration.md` — a short written assessment that informs the sequencing of all migration stories.

The architecture is fixed (`docs/architecture.md` is load-bearing). The scaffold exists (`src/pipeline/`). What does not yet exist is a **map from today's code to the target stages**, with honest assessment of where the migration is clean vs. tangled. That map is this spike's deliverable.

---

## What to Investigate

### 1. Stage mapping

Walk `src/` (everything except `src/pipeline/` itself) and map existing modules to the four pipeline stages. Produce a table:

| Current module | Target stage | Clean boundary? | Notes |
|---|---|---|---|
| `src/puzzle/` | ? | ? | |
| `src/canvas/` | ? | ? | |
| `src/workers/` | ? | ? | |
| `src/store/` | (stays as Store) | n/a | Confirm no derivation logic has accumulated here |
| `src/utils/` | various | per-file | Likely splits across stages — call out each file |
| `src/imageNormalize.ts` | ? | ? | |
| `src/curated/` | ? | ? | |
| `src/main.ts` | (orchestration) | ? | Will become `src/pipeline/index.ts` consumer |

For each: is the module cleanly bounded, or co-mingled with other concerns? Flag anything that needs untangling **before** it can move (e.g., a single file that contains both Cook-shaped derivation and Plate-shaped rendering).

**Note on interaction code specifically.** The expected mapping per `docs/architecture.md`:
- Pointer/touch input → `plate/pixi/`
- Keyboard input → `plate/aria/runtime/`

Today, there is no `src/interaction/`; pointer and keyboard logic appear to live inside `src/canvas/` and possibly `src/puzzle/`. Confirm where the pointer hit-test layer, drag lifecycle, snap detection trigger, keyboard mode (bench/table), and `inert` toggling actually live. Flag whether these are extractable cleanly or tangled into rendering.

### 2. Contract gaps

For each contract already typed in `src/pipeline/types.ts`, identify whether a partial version exists in today's code:

- `IntakeResult` (discriminated union) — does anything resembling this exist? File picker + drag-and-drop both produce *something* today; what shape?
- `IntakePayload` — image normalization (Story 45) produces a normalized buffer; is its return shape close to `IntakePayload`?
- `CutsReady` — the worker handoff message. What does the worker→main `postMessage` look like today?
- `JiggDissection` — already in `@jigg-spec`. Is it being consumed correctly today, or is the cut data flowing through some ad-hoc shape?
- `RenderSpec` — is there anything in today's code that looks like a single source of truth for rendering, or is render data scattered?
- `A11ySpec` / `A11yStatic` — accessibility decisions today (board color in Story 47b, contrast mode handling): where do they live, and what would `deriveA11ySpec.ts` need to absorb?

For each: note where the partial version lives and how close it is to the target shape. "Identical," "needs renaming + relocation," "needs a wrapper," "needs to be derived from scratch" — be specific.

### 3. Migration-sensitive working code

Some logic is proven, fragile, and must not regress during migration. For each, assess isolation:

- **WASM cut generation** (`crates/`, `src/wasm-pkg/`, worker glue) — how isolated? Can the worker move into `src/pipeline/chop/worker/` without touching the WASM build?
- **PixiJS rendering** (bench, table, mesa, filters, glow, sandwich-removed-as-of-47g) — what's the cleanest carve from `src/canvas/` into `src/pipeline/plate/pixi/`? Are there imports out into puzzle logic that need breaking first?
- **Snap detection** — currently runs on drag end. Where does the detection logic live vs. the position correction? Snap is interaction → moves to Plate runtime, but the rules feel like Cook. Confirm.
- **Accessibility DOM layer** (Stories 40–43, 47-series) — landmarks, hidden button tree, live region. Where does this live now? Does any of it derive (→ Cook → `RenderSpec.a11y`) vs. behave (→ `plate/aria/runtime/`)? The split matters.
- **Adaptive board color** (Story 47b) — pure derivation from image luminance; this is a Cook concern. Where does it live today?
- **Mesa / 8-layer board chrome** (Story 47d) — pure geometry, derived from board dimensions. Cook or Plate?

For each: how isolated is it today, and can it move without dragging neighbors?

### 4. Doc consolidation

Today's `docs/` contains implementation detail. The new model is: **skills are the lookup point, `docs/sme/*.md` are overflow detail, `docs/architecture.md` is load-bearing.** No doc should exist in two places after migration.

Review each doc and recommend its fate. Suggested starting table:

| Doc | Recommendation |
|---|---|
| `docs/spec-integration.md` | Absorb into `docs/sme/jigg-spec.md`? |
| `docs/accessibility.md` | Split — runtime behavior into `docs/sme/jigg-runtime.md`, derivation rules into `docs/sme/jigg-pipeline.md`? |
| `docs/accessibility-architecture.md` | Historical audit — keep as-is with archive marker? |
| `docs/accessibility-design.md` | Historical design doc — keep as-is with archive marker? |
| `docs/wasm-pipeline.md` | Absorb into `docs/sme/jigg-pipeline.md`? |
| `docs/drag-and-drop.md` | Absorb into `docs/sme/jigg-pipeline.md` or `jigg-runtime.md`? |
| `docs/snap-detection.md` | Absorb into `docs/sme/jigg-runtime.md`? |
| `docs/engine-conventions.md` | Absorb into `docs/sme/jigg-spec.md` or `jigg-pipeline.md`? |
| `docs/conventions.md` | ? |
| `docs/decisions.md` | Keep standalone — architectural rationale doesn't belong in skills |
| `docs/gotchas.md` | Keep standalone — surprising failures need a single bucket |
| `docs/regression-script.md` | Keep standalone — operational, not architectural |
| `docs/stories.md` | Keep standalone — implementation log |
| `docs/roadmap.md` | Keep standalone — BA's planning board |
| `docs/BA.md` | Keep standalone — BA workflow |
| `docs/README.md` | Verify still accurate after the rest is reorganized |
| `docs/archive/` | Already archived — leave |

You may add rows for any doc not listed. Goal: every doc has either a destination (absorbed into a skill/overflow doc) or an explicit "keep standalone" rationale.

### 5. Architecture contradictions

Does anything in the current codebase contradict `docs/architecture.md` in a way that warrants updating the doc rather than moving the code? Note any cases where the architecture may need to flex — but be conservative. The default assumption is "code moves to fit the architecture," not "the architecture flexes to fit the code." Flag a contradiction only if the existing code embodies a real constraint that the architecture missed.

### 6. Migration path recommendation

Based on the above, recommend an approach:

- **Parallel structure** — scaffold new folders alongside existing code, migrate stage by stage, remove old code only when replaced. This is the current default per the migration principle.
- **Greenfield pipeline** — pull proven logic into the new structure deliberately rather than migrating wholesale. Use if the existing structure is too tangled to migrate incrementally.
- **Branch rewrite** — port logic, not files. Most aggressive option.

Include **proposed stage sequencing** — which stage to migrate first, second, etc., and why. Include any pre-requisites that aren't a stage themselves (e.g., "must extract pointer hit-test out of `src/canvas/` into a sibling before Plate migration can begin").

Sketch a story sequence — not full prompts, just a list of titles and one-sentence scopes, in the order they should run. This is the input the BA will use to write the actual migration story prompts.

---

## SME Inputs

### Pipeline (consult, don't request)
This is a research story, not a migration story. The Pipeline SME (`.claude/skills/sme-jigg-pipeline.skill`) is your **reference during analysis**, not the source of placement decisions to put into a migration story. Read it before you start mapping. Apply Cook admission rules and import rules when judging "clean boundary?" — that judgment is the spike's contribution.

### Runtime
N/A — no runtime work in this story. (`sme-jigg-runtime.skill` is reference reading for the store/pipeline boundary judgments in §1 and §3, but no SME *output* goes into a code story here.)

### Spec
N/A — no persistence work in this story. (`sme-jigg-spec.skill` is reference reading for §2's `JiggDissection` / `JiggAssembly` questions.)

---

## Output Format — `docs/migration.md`

Structure the document as:

1. **Stage mapping table** — one row per existing module, with target stage and clean-boundary assessment (§1 above)
2. **Contract gap summary** — for each pipeline contract, where its partial form lives today and the delta to target (§2)
3. **Migration-sensitive code list** — proven logic that must not regress, with isolation assessment (§3)
4. **Doc consolidation table** — current doc → destination (§4)
5. **Architecture contradictions** — none expected; flag any found (§5)
6. **Recommended migration path + stage sequencing** — with a sketched story sequence (§6)
7. **Open questions** — anything the spike couldn't answer that needs a decision before migration begins. The user will answer these; do not invent answers.

Keep it short. The whole doc should be readable in 15 minutes. This is the input to BA's next planning pass; brevity matters.

---

## Files

**Created:**
- `docs/migration.md` (the deliverable)

**Touched:** none. No code changes. No existing doc edits. If you find yourself wanting to fix something during the spike — flag it in §7 (Open questions) and leave it alone.

---

## Acceptance

- **AC-1:** `docs/migration.md` exists with all seven sections populated.
- **AC-2:** Stage mapping table covers every top-level item under `src/` (excluding `src/pipeline/` itself).
- **AC-3:** Contract gap summary covers `IntakeResult`, `IntakePayload`, `CutsReady`, `JiggDissection`, `RenderSpec`, `A11ySpec` — at minimum.
- **AC-4:** Doc consolidation table covers every file in `docs/` (excluding `docs/sme/`, `docs/archive/`, and `docs/migration.md` itself).
- **AC-5:** A migration path is recommended (one of the three, or a clear hybrid) with rationale. Stage sequencing is concrete (ordered list with one-sentence scopes), not vague.
- **AC-6:** No code changed. `git diff src/` is empty. `git diff crates/` is empty.
- **AC-7:** No existing docs changed. `git diff docs/` should show only the addition of `docs/migration.md`.
- **AC-8:** Open questions are explicit and unanswered. Do not pretend to know what only the user can decide.

---

## Out of scope

- Any code migration. This story produces a plan, not a move.
- Any doc moves or merges. The consolidation **table** is the deliverable; the actual moves happen in later stories.
- Updates to `docs/architecture.md`. If the spike surfaces a contradiction, log it under §5; the actual edit is a separate decision point.
- Updates to `roadmap.md` or `stories.md`. The BA owns roadmap; the BA will turn the spike's stage sequencing into queued stories. Dev's job is to log this spike's completion in `stories.md` per the usual workflow.
- Anything in `src/pipeline/` itself — it's already typed, do not modify.

---

## Migration principle (reference, since this spike informs migration)

```
The pipeline is net new.

Migration stories will incrementally:
- introduce pipeline structure (Story 0 — done), or
- migrate existing logic into it, or
- remove old code that has been replaced

Behavior must remain unchanged throughout migration.
```

The spike does none of the above — it produces the plan that sequences them.

---

## QA handoff

This is a doc-only deliverable. The QA page (`http://localhost:5173/qa`) is for runtime regression verification — not relevant here. Update `docs/stories.md` per the usual workflow when the spike completes. The "QA" for this story is the user reading `docs/migration.md` and either approving the recommended path or sending the spike back for refinement.

After the spike ships, expect the BA to:
1. Reset/refresh `docs/roadmap.md` based on the recommended sequencing
2. Write the first migration story prompt
3. Move this spike into `docs/stories.md` shipped log
