<!-- audience: BA -->

# BA Guide — Writing Jigg Story Prompts

## Story Prompt Format

Each story prompt follows this structure:

### 1. Imperative Title
`Story XX: [Action] [Component] [Outcome]`

Example: `Story 44: Implement piece tray keyboard navigation`

### 2. Technical Description
Clear, implementable requirements with specific constraints:

```
Implement [feature/component] in [file/module].

Key requirements:
- [Specific behavior 1]
- [Specific behavior 2] 
- [Integration with existing system]

Constraints:
- Do not [specific restriction]
- Must preserve [existing behavior]
- Performance target: [if relevant]
```

### 3. File Touch List
Explicit list of files the dev/agent should modify:

```
Files to touch:
- src/[module]/[file].ts (main implementation)
- src/[module]/types.ts (if new types needed)
- docs/[relevant].md (update documentation)
```

### 4. Acceptance Criteria
Measurable success conditions:

```
Acceptance:
- [Testable behavior 1]
- [Testable behavior 2]
- No regression in [existing feature]
```

## Managing the Roadmap

### Board Columns
- **Shipped** — Complete, in `stories.md`
- **Next** — Ready for next dev session
- **Deferred** — Postponed, with reason

### Story Lifecycle
1. Write story in **Next** column
2. Dev implements, updates `stories.md`
3. Move to **Shipped** with completion date

### Cross-References
- Link to related stories: `(builds on Story XX)`
- Reference decisions: `(per Decision YY in decisions.md)`
- Note dependencies: `(requires Story ZZ complete)`

## Handoff to Development

The handoff contract is `docs/next-story.md`. **The BA owns this file exclusively** — BA writes, BA clears, BA overwrites. The dev session reads it as part of boot (see `CLAUDE.md` and the dev-writer skill) but never writes to it. No copy/paste, single source of truth.

### Before writing a story:
1. Check `roadmap.md` — understand what's shipped and what's planned
2. Review `decisions.md` — understand existing constraints
3. Check `docs/next-story.md` — if it still holds a shipped story, overwrite it (see below). Dev leaves stale prompts in place by design; reconciling is the BA's job.

### When handing off:
1. Write the story prompt to `docs/next-story.md` (overwrite any previous prompt)
2. Story prompt follows the format above
3. Move story from **Next** to **In Progress** in `roadmap.md`

### After implementation:
1. Review what dev added to `stories.md`
2. Move story to **Shipped** in `roadmap.md`
3. `docs/next-story.md` still holds the shipped prompt — dev does not clear it. Clear it yourself by either overwriting with the next story, or setting it to `# No story queued` if nothing is ready.

### Staleness guardrail (dev-side)
If a dev session starts and the prompt in `next-story.md` matches a story already logged in `stories.md`, dev is instructed to stop and ask rather than re-implement. This protects against a BA forgetting to queue the next story — the worst case is a "is this stale?" question at session start, not a re-implementation.

## Common Patterns

### Epic Stories
Large features broken into implementable chunks:
- Story XXa: [Foundation]
- Story XXb: [Core behavior]  
- Story XXc: [Integration/polish]

### Spike Stories
Research before implementation:
- Story XX-spike: [Research question]
- Follow with Story XX: [Implementation based on spike]

### Documentation Stories
Usually paired with feature work:
- Include doc updates in main story, or
- Separate Story XX-docs if substantial

## File Responsibilities

You own these files:
- `roadmap.md` — Planning board
- Story prompts (before handoff)

Dev owns these:
- `stories.md` — Implementation log
- `decisions.md` — Technical choices
- All `src/` files

Shared:
- This file (`BA.md`)
- Cross-file consistency

Create any documentation files you need to plan effectively. The existing structure is a starting point - add new files when they help clarify requirements or improve the handoff to development.
