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
- `docs/engine-conventions.md` — Runtime invariants

## Story Implementation
- `docs/next-story.md` is the handoff contract — **BA owns this file exclusively. Dev reads only, never writes, never clears, never overwrites.**
- **Staleness guardrail:** before implementing, cross-check the prompt against `docs/stories.md`. If the story number or described work already appears as shipped, stop and ask the user — do not re-implement. The BA may not have queued the next story yet.
- Follow story prompt format (title, requirements, files, acceptance)
- Push back in-session if the prompt is unclear or wrong
- Always update `stories.md` with what shipped
- **QA handoff at end of work.** Before declaring done, run `/qa` (or produce the equivalent inline): a chat-only summary the user can test from cold — refreshed acceptance criteria, concrete test steps, any test images dropped into `/qa-scratch/`, and what's deliberately out of scope. See `.claude/commands/qa.md` for the format and `test/fixtures/README.md` for the fixture system.

## Key References
- Patterns: `docs/gotchas.md`
- Architecture: `docs/architecture.md`  
- Accessibility: `docs/accessibility.md`