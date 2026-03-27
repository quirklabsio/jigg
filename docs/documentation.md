# How to Write Documentation for Jigg

## Purpose
docs/ is a living knowledge base. It evolves from real problems encountered during development. Every session is an opportunity to improve it.

## File Responsibilities
- `architecture.md` — types, principles, folder structure
- `stack.md` — technology choices and one-line rationale
- `conventions.md` — naming, file, store conventions
- `decisions.md` — settled architectural decisions, do not relitigate
- `gotchas.md` — specific errors encountered and how they were fixed
- `stories.md` — story list and current session state
- `drag-and-drop.md` — drag architecture and implementation detail
- `snap-detection.md` — snap and group merge logic
- `wasm-pipeline.md` — WASM/worker setup and build process

## Writing Rules
- Gotchas must include: what went wrong, why, and the exact fix
- Decisions must include: what was decided and why alternatives were rejected
- No duplication across files — one home per piece of knowledge
- Concrete over abstract — code snippets preferred over prose
- New file only if no existing file is the right home

## When to Update
- `gotchas.md` — any time an unexpected error occurs and is resolved
- `decisions.md` — any time an architectural choice is made mid-session
- Relevant domain file — any time implementation detail is discovered that would help future sessions (e.g. a PixiJS v8 API nuance)
