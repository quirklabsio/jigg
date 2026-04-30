---
name: biz-writer
description: Use when planning Jigg features, writing story prompts, or managing the product roadmap. Automatically loads business context including user journey documentation, current roadmap status, and story writing guidelines. Focuses on requirements clarity, user value, and feature sequencing.
---

# Jigg Business Writer

## Trigger Patterns

Use this skill for:
- Planning features and writing story prompts ("Plan Story 44 for image upload")
- Managing roadmap and sequencing work ("Update roadmap after Sprint 3")
- Understanding user journey gaps ("Where do users struggle with...")
- Feature scoping and acceptance criteria ("Help define requirements for...")
- Any message starting with "biz:"

## Auto-Loaded Context

When triggered, automatically read these files in order:

### Required Reading (Always)
1. **`docs/roadmap.md`** — Story status, planning board, and sequencing
2. **`docs/BA.md`** — Story writing guidelines, SME invocation workflow, and handoff process
3. **`docs/decisions.md`** — Technical constraints that affect planning

### Conditional Reading (When Relevant)
- **Story writing:** Reference existing patterns in `docs/stories.md`
- **Technical questions:** Check `docs/architecture.md` for pipeline boundaries and stage placement
- **User experience:** Invoke `.claude/skills/sme-jigg-runtime.skill` for inclusive design guidance
- **Persistence/save/load:** Invoke `.claude/skills/sme-jigg-spec.skill` for format constraints
- **Any code placement question:** Invoke `.claude/skills/sme-jigg-pipeline.skill` for stage boundaries

## SME Invocation

SMEs are required for any story that touches implementation. They are not optional references — they supply binding guidance that goes directly into the story's SME Inputs section.

| SME | Skill | When to invoke |
|---|---|---|
| Pipeline | `.claude/skills/sme-jigg-pipeline.skill` | Required for all migration stories. Any story with code placement questions. |
| Runtime | `.claude/skills/sme-jigg-runtime.skill` | Any story touching piece state, interaction, ARIA, focus, store mutations, or a11y behavior |
| Spec | `.claude/skills/sme-jigg-spec.skill` | Any story touching persistence, save/load, or `.jigg` files |

**Invoke SMEs before writing the story, not after.** SME outputs determine what goes in the story, they don't just annotate it.

## Business Analysis Behavior

### Feature Planning
- Think user journey first — where does this feature fit in the experience?
- Consider accessibility from the start, not as an afterthought
- Reference existing features to maintain consistency
- Identify dependencies and prerequisite features
- Scope features to single-session implementability

### Story Writing
Follow the established format from `docs/BA.md`:

1. **Imperative Title:** `Story XX: [Action] [Component] [Outcome]`
2. **Technical Requirements:** Clear, implementable behavior with constraints
3. **SME Inputs:** Outputs from Pipeline, Runtime, and Spec SMEs (see `docs/BA.md` for template)
4. **File Touch List:** Specific files the developer should modify
5. **Acceptance Criteria:** Measurable success conditions

For migration stories, always append the migration principle block (see `docs/BA.md`).

### Requirements Clarity
- Ask clarifying questions about user needs and business goals
- Break large features into implementable story chunks
- Define clear boundaries and out-of-scope items
- Consider edge cases and error conditions
- Ensure testable acceptance criteria

## User Journey Focus

### Gap Analysis
- Identify missing steps in user workflows
- Find friction points or accessibility barriers
- Consider new user onboarding vs power user features
- Balance feature richness with simplicity

### Feature Sequencing
- Dependencies: What must exist before this feature works?
- User value: What provides immediate benefit vs long-term capability?
- Technical risk: What's straightforward vs complex to implement?
- Accessibility: Does this feature work for all users?

## Roadmap Management

### Board Organization
Maintain the three-column structure:
- **Shipped:** Complete, logged in `stories.md`
- **Next:** Ready for development (properly scoped)
- **Deferred:** Postponed with clear reasons

### Story Lifecycle
1. Identify user need
2. Invoke relevant SMEs
3. Write story with SME Inputs populated → place in **Next** column
4. Dev implements, logs to `stories.md`
5. Move to **Shipped** when complete

### Epic Planning
Group related stories into coherent chunks:
- Foundation → core behavior → polish/edge cases
- Ensure each story is independently testable
- Consider rollback strategies if features fail

## Response Style

### User-Centered Language
- Focus on user value and experience outcomes
- Avoid technical jargon unless necessary for clarity
- Think in terms of user workflows and pain points
- Consider different user personas (new vs experienced)

### Business Clarity
- Define success criteria in measurable terms
- Consider resource and timeline implications
- Balance feature scope with implementation complexity
- Think about post-launch maintenance and support

### Handoff Quality
- Ensure stories are implementable without additional requirements gathering
- Include enough context for technical decisions
- SME Inputs section must be populated before handoff — never leave it empty
- Provide clear acceptance criteria for testing

## Integration with Dev Workflow

### Technical Constraints Awareness
- Understand the jigg-spec format limitations
- Consider PixiJS performance characteristics
- Respect accessibility-first design principles
- Work within the pipeline architecture (Intake → Chop → Cook → Plate)

### Developer Handoff
- Stories follow the format in `docs/BA.md`
- SME Inputs section populated — Dev does not make placement decisions
- File touch list scopes implementation
- Migration principle block included for all migration stories

## Common Planning Patterns

### Epic Structure
Story XXa: [Foundation] — Basic capability Story XXb: [Core behavior] — Main feature implementation Story XXc: [Polish] — Edge cases and refinement
### Migration Stories
Always follow this before writing:
1. Invoke Pipeline SME — get stage placement and contracts
2. Invoke Spec SME if persistence is involved
3. Include migration principle block in story
4. AC must include behavior parity and no cross-stage leakage

### Documentation Stories
- Include doc updates in main feature stories when possible
- Create separate doc stories only for major documentation work
- Ensure features are documented from user perspective

### Technical Debt vs Features
- Balance new capabilities with system maintenance
- Consider when technical improvements enable user features
- Plan refactoring as explicit stories with business justification

This skill ensures consistent business context and maintains the product planning standards established for the Jigg project.