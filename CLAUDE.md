# CLAUDE.md — Agent Development Workflow

**DEFAULT: Development Mode**
Unless explicitly told otherwise, this is a technical implementation session.

## Required Reading
Always read these files before responding:
1. `docs/next-story.md` — The story prompt the BA prepared for this session (read first)
2. `docs/roadmap.md` — Current status
3. `docs/stories.md` — Implementation history
4. `docs/decisions.md` — Technical constraints

For any code-shaped story, also read:
- `docs/architecture.md` — Pipeline structure (Intake → Chop → Cook → Plate), contracts, import rules. Load-bearing.

For spec work:
- `docs/spec-integration.md` — Type imports and git workflow

For work touching piece positions, coordinate math, or world-space logic:
- `docs/engine-conventions.md` — Coordinate systems, stage rules, rotation, cluster lifecycle

## The Model

Technical authority moves upstream. SMEs are the architecture, in active skill form. The BA invokes them while writing the story and bakes their guidance directly into the prompt. By the time dev opens `next-story.md`, the architecture has already spoken — placement is decided, contracts are named, constraints are written down.

**Dev is an order-taker by design.** No placement calls, no contract guessing, no architectural improvisation. The prompt is complete or it's wrong; if it's wrong, push back to BA — do not paper over a gap.

This is the shift from the old model: the architecture used to be a passive doc that dev was expected to read and apply on the fly. Now it is three active skills, consulted upstream, with their output already encoded in the story.

## Roles

Two roles, one direction of flow:

```
biz-writer (BA) — invokes SMEs, bakes their guidance into the story
       ↓ produces a complete next-story.md prompt
dev-writer (Dev) — implements per the prompt
```

- **biz-writer** owns story scoping and the roadmap. Invokes SMEs before writing. Produces a `docs/next-story.md` prompt with all technical guidance encoded — placement, contracts, files, acceptance. See `.claude/skills/biz-writer/SKILL.md`.
- **dev-writer** owns implementation. Reads the prompt. Implements. Logs to `docs/stories.md`. See `.claude/skills/dev-writer/SKILL.md`.

## SMEs — The Architecture, in Skill Form

| SME | Skill | Authority |
|---|---|---|
| Pipeline | `.claude/skills/sme-jigg-pipeline.skill` | Stage boundaries, Cook admission, contracts, import rules |
| Runtime | `.claude/skills/sme-jigg-runtime.skill` | Store mutations, runtime a11y, ARIA, piece state invariants |
| Spec | `.claude/skills/sme-jigg-spec.skill` | `.jigg` format, persistence, dissection ↔ assembly |

The BA invokes these per story. Their guidance lands in the **SME Inputs** section of the prompt, in the file touch list, and in acceptance criteria. Dev reads the prompt; the SME work is already done.

There is no a11y SME. Accessibility is distributed — Cook derivation (pipeline), `plate/aria/` (runtime), user prefs (store). The relevant SME owns it in context.

Overflow detail for each SME lives at `docs/sme/<name>.md` (stubs — populated during migration).

## Story Implementation
- `docs/next-story.md` is the handoff contract — **BA owns this file exclusively. Dev reads only, never writes, never clears, never overwrites.**
- **Staleness guardrail:** before implementing, cross-check the prompt against `docs/stories.md`. If the story number or described work already appears as shipped, stop and ask the user — do not re-implement. The BA may not have queued the next story yet.
- The story prompt format includes title, requirements, **SME Inputs** (populated by BA), file touch list, acceptance criteria.
- Push back in-session if the prompt is unclear, wrong, or under-specified. Interrupt the user; do not invent.
- Always update `stories.md` with what shipped.
- **QA handoff at end of work.** Before declaring done, run `/qa`. Primary artifact is the QA page at `http://localhost:5173/qa` (`public/qa.html`) — update its `STORY` and `FIXTURES` data to match the current story, pre-nominate any scratch fixtures you recommend for promotion (user ticks/unticks, dev does the promotion later). Chat output is a thin pointer plus out-of-scope and roadmap preview. See `.claude/commands/qa.md` for the format and `test/fixtures/README.md` for the fixture tiers.

## Migration Awareness

The codebase is mid-migration to the pipeline structure in `docs/architecture.md`. Two truths coexist:

- **Old code** in `src/canvas/`, `src/puzzle/`, `src/workers/`, `src/utils/`, etc. — still authoritative for shipped behavior.
- **New scaffolding** in `src/pipeline/` with typed contracts in `src/pipeline/types.ts`. Stubs throw `not implemented` until logic migrates in.

**Migration principle:** behavior must remain unchanged throughout. Stories incrementally introduce structure, move existing logic, or remove old code that's been replaced. Never rewrite working behavior.

The story prompt tells you which side of the line you're on.

## Key References
- Architecture & pipeline: `docs/architecture.md`
- Runtime invariants, coordinate systems, stage rules: `docs/engine-conventions.md`
- Surprising failures / environment traps: `docs/gotchas.md`
- Accessibility: `docs/accessibility.md`
- Spec integration: `docs/spec-integration.md`
