<!-- audience: BA -->

# BA Guide — Writing Jigg Story Prompts

## Operating Model

The BA orchestrates story definition. Dev executes. SMEs supply technical authority.

**BA** — decides what the next story is, defines scope and intent, invokes SMEs to get placement and constraints. Does not invent technical details.

**Dev** — implements exactly what the story says. Does not make architectural decisions.

**SMEs** — invoked per story. Provide binding guidance on placement, contracts, and constraints.

---

## SME Skills

Invoke these before writing any story that touches their domain. SME outputs go directly into the story's **SME Inputs** section.

| SME | Skill | Invoke when... |
|---|---|---|
| Pipeline | `.claude/skills/sme-jigg-pipeline.skill` | Any story touching code placement, stage boundaries, or pipeline contracts |
| Runtime | `.claude/skills/sme-jigg-runtime.skill` | Any story touching piece state, interaction, ARIA, focus, store mutations, or a11y behavior |
| Spec | `.claude/skills/sme-jigg-spec.skill` | Any story touching persistence, save/load, or `.jigg` files |

**Pipeline SME is required for every migration story.** The other two are invoked as needed.

---

## Story Prompt Format

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

### 3. SME Inputs

Required section. Record outputs from each relevant SME invocation before handing off to Dev.

```
#### Pipeline (required for migration stories)
- Target stage: [Intake / Chop / Cook / Plate]
- Target files: [src/pipeline/...]
- Contracts used: [IntakeResult / CutsReady / JiggDissection / RenderSpec / ...]

#### Spec (if persistence involved)
- Schema fields touched: [...]
- Mapping to .jigg: [...]

#### Accessibility (if relevant)
- Placement: [Cook static / Plate aria/runtime/]
- Behavior required: [...]
```

If an SME is not relevant to the story, note "N/A" — don't omit the section.

### 4. File Touch List
Explicit list of files the dev/agent should modify:

```
Files to touch:
- src/[module]/[file].ts (main implementation)
- src/[module]/types.ts (if new types needed)
- docs/[relevant].md (update documentation)
```

### 5. Acceptance Criteria
Measurable success conditions:

```
Acceptance:
- [Testable behavior 1]
- [Testable behavior 2]
- No regression in [existing feature]
```

For migration stories, always include:
```
- Behavior parity with current system
- Correct placement in pipeline structure
- No cross-stage leakage
```

---

## Migration Principle

Include this block in every migration story:

```
The pipeline is net new.

This story does not rewrite the system. It incrementally:
- introduces pipeline structure, or
- migrates existing logic into it, or
- removes old code that has been replaced

Behavior must remain unchanged throughout migration.
```

---

## Managing the Roadmap

### Board Columns
- **Shipped** — Complete, in `stories.md`
- **Next** — Ready for next dev session
- **Deferred** — Postponed, with reason

### Story Lifecycle
1. Invoke relevant SMEs
2. Write story in **Next** column with SME Inputs populated
3. Dev implements, updates `stories.md`
4. Move to **Shipped** with completion date

### Cross-References
- Link to related stories: `(builds on Story XX)`
- Reference decisions: `(per Decision YY in decisions.md)`
- Note dependencies: `(requires Story ZZ complete)`

---

## Handoff to Development

The handoff contract is `docs/next-story.md`. **The BA owns this file exclusively** — BA writes, BA clears, BA overwrites. The dev session reads it as part of boot (see `CLAUDE.md` and the dev-writer skill) but never writes to it. No copy/paste, single source of truth.

### Before writing a story:
1. Check `roadmap.md` — understand what's shipped and what's planned
2. Review `decisions.md` — understand existing constraints
3. Review `architecture.md` — understand pipeline boundaries
4. Invoke relevant SMEs — get placement and constraint guidance
5. Check `docs/next-story.md` — if it still holds a shipped story, overwrite it

### When handing off:
1. Write the story prompt to `docs/next-story.md` (overwrite any previous prompt)
2. Story prompt follows the format above, SME Inputs populated
3. Move story from **Next** to **In Progress** in `roadmap.md`

### After implementation:
1. Review what dev added to `stories.md`
2. Move story to **Shipped** in `roadmap.md`
3. `docs/next-story.md` still holds the shipped prompt — dev does not clear it. Clear it yourself by either overwriting with the next story, or setting it to `# No story queued` if nothing is ready.

### Staleness guardrail (dev-side)
If a dev session starts and the prompt in `next-story.md` matches a story already logged in `stories.md`, dev is instructed to stop and ask rather than re-implement. This protects against a BA forgetting to queue the next story — the worst case is a "is this stale?" question at session start, not a re-implementation.

---

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

### Migration Stories
Always invoke Pipeline SME. Always include the migration principle block. Always include behavior parity in AC.

### Documentation Stories
Usually paired with feature work:
- Include doc updates in main story, or
- Separate Story XX-docs if substantial

---

## File Responsibilities

You own:
- `roadmap.md` — Planning board
- Story prompts (before handoff)

Dev owns:
- `stories.md` — Implementation log
- `decisions.md` — Technical choices
- All `src/` files

Shared:
- This file (`BA.md`)
- `architecture.md` — read by both, updated by dev when contradictions are found
- Cross-file consistency

SME skills (read-only for BA — updated by dev during migration):
- `.claude/skills/sme-jigg-pipeline.skill`
- `.claude/skills/sme-jigg-runtime.skill`
- `.claude/skills/sme-jigg-spec.skill`
