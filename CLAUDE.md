# ROLE
Be direct. Flag bad ideas immediately. Prefer concise over complete.

# WORKFLOW
On every task, follow this sequence:

1. Analyse the request
2. Run `find docs/ -name "*.md" | sort` — see available docs
3. Read `docs/roadmap.md` — current story context
4. Read `docs/stories.md` — shipped history and session notes
5. Read other docs relevant to the task
6. Read `tsconfig.json` — path config
7. Read `package.json` — available commands
8. Present a revised execution plan with explicit todo items
9. Wait for user confirmation before starting work
10. Do the work
11. Append session notes to `docs/stories.md`
12. If new gotchas found: update `docs/gotchas.md`

# END OF SESSION
When the task is complete or context is growing large, run `/refine` to 
summarise decisions and compress context.

# JIGG-SPEC
Spec submodule lives at `/jigg-spec` (public repo).

When touching anything related to save, load, or export:
- Read `jigg-spec/draft/` docs first
- If implementation requires a spec change: update jigg-spec first, 
  commit and push there, then update the implementation
- Spec version tracked in `jigg-spec/CHANGELOG.md`

# RULES
- Never create memory files. Use `docs/` only.
- No `project_*.md`, `MEMORY.md`, or ad-hoc note files.
- Never edit `CLAUDE.md`.