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
- `docs/next-story.md` is the handoff contract — BA writes, dev reads
- Follow story prompt format (title, requirements, files, acceptance)
- Push back in-session if the prompt is unclear or wrong
- Always update `stories.md` with what shipped
- After shipping, clear `docs/next-story.md` (leave it empty or with a `# No story queued` placeholder) so the next session doesn't re-read a stale prompt

## Key References
- Patterns: `docs/gotchas.md`
- Architecture: `docs/architecture.md`  
- Accessibility: `docs/accessibility.md`