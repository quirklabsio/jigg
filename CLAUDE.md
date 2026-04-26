# CLAUDE.md — Agent Development Workflow

**DEFAULT: Development Mode**
Unless explicitly told otherwise, this is a technical implementation session.

## Required Reading
Always read these files before responding:
1. `docs/next-story.md` — The story prompt the BA prepared for this session (read first)
2. `docs/roadmap.md` — Current status
3. `docs/stories.md` — Implementation history
4. `docs/decisions.md` — Technical constraints

For spec work, also read:
- `docs/spec-integration.md` — Type imports and git workflow

For any work touching piece positions, coordinate math, or world-space logic:
- `docs/engine-conventions.md` — Coordinate systems, stage rules, rotation, cluster lifecycle

## Roles

Three roles, three skills, one direction of flow:

```
tech-architect (designs the pattern, when needed)
       ↓ produces story briefs
biz-writer (scopes individual stories from briefs)
       ↓ produces next-story prompt
dev-writer (implements per the pattern)
```

- **tech-architect** owns architecture / pattern design. Read-only re: production code. Output: design docs + sequenced story briefs. Triggered when the *pattern itself* is the question (audit → architecture, cross-cutting refactor, foundational decision). See `.claude/skills/tech-architect/SKILL.md`.
- **biz-writer** owns story scoping and the roadmap. Writes `docs/next-story.md`. Hands off to dev. See `.claude/skills/biz-writer/SKILL.md`.
- **dev-writer** owns implementation. Writes code. Logs to `docs/stories.md`. See `.claude/skills/dev-writer/SKILL.md`.

If dev keeps failing on a story, that's a signal the architectural decision was hidden inside it — kick back upstream to tech-architect.

## Story Implementation
- `docs/next-story.md` is the handoff contract — **BA owns this file exclusively. Dev reads only, never writes, never clears, never overwrites.**
- **Staleness guardrail:** before implementing, cross-check the prompt against `docs/stories.md`. If the story number or described work already appears as shipped, stop and ask the user — do not re-implement. The BA may not have queued the next story yet.
- Follow story prompt format (title, requirements, files, acceptance)
- Push back in-session if the prompt is unclear or wrong
- Always update `stories.md` with what shipped
- **QA handoff at end of work.** Before declaring done, run `/qa`. Primary artifact is the QA page at `http://localhost:5173/qa` (`public/qa.html`) — update its `STORY` and `FIXTURES` data to match the current story, pre-nominate any scratch fixtures you recommend for promotion (user ticks/unticks, dev does the promotion later). Chat output is a thin pointer plus out-of-scope and roadmap preview. See `.claude/commands/qa.md` for the format and `test/fixtures/README.md` for the fixture tiers.

## Key References
- Runtime invariants, coordinate systems, stage rules: `docs/engine-conventions.md`
- Surprising failures / environment traps: `docs/gotchas.md`
- Architecture: `docs/architecture.md`
- Accessibility: `docs/accessibility.md`