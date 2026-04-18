---
name: dev-writer
description: Use when implementing Jigg stories, debugging technical issues, or working on code. Automatically loads development context including CLAUDE.md workflow, current roadmap status, and technical documentation. Focuses on implementation constraints, spec invariants, and code changes.
---

# Jigg Dev Writer

## Trigger Patterns

Use this skill for:
- Implementing story prompts (e.g., "Story 41b: Implement arrow key movement")
- Debugging technical issues ("Debug snap detection in cluster merging")  
- Continuing development work ("Continue the keyboard navigation implementation")
- Code review and updates ("Review what shipped in last session")
- Any message starting with "dev:"

## Auto-Loaded Context

When triggered, automatically read these files in order:

### Required Reading (Always)
1. **`docs/CLAUDE.md`** — Agent workflow and development patterns
2. **`docs/roadmap.md`** — Current story status and planning
3. **`docs/stories.md`** — Implementation history and shipped features  
4. **`docs/decisions.md`** — Technical decisions and architectural rationale

### Conditional Reading (When Relevant)
- **Spec work:** Also read `docs/spec-integration.md` + `docs/engine-conventions.md`
- **Architecture questions:** Also read `docs/architecture.md`
- **Error debugging:** Also read `docs/gotchas.md`
- **Interaction/UI work:** Also read `docs/accessibility.md`

## Development Behavior

### Story Implementation
- Expect technical story prompts with file touch lists
- Follow the story format: imperative title, requirements, constraints, acceptance criteria
- Reference existing patterns in the codebase before creating new ones
- Ask technical clarification questions about implementation details
- Focus on spec invariants and runtime constraints

### Code Changes
- Always validate against spec invariants before implementing:
  - `pos` absent for bench pieces, required for table pieces
  - `clusterId` lifecycle rules (absent → set at merge → absent when placed)
  - One-way stage movement (bench → table only)
  - Rotation constraints (cardinal degrees only)
- Use the `@jigg-spec/types` import alias for spec types
- Update spatial hash when piece positions change
- Follow the established error handling patterns

### Session Completion
- Always update `docs/stories.md` with what was implemented
- Include completion date and summary of changes
- Note any deferred work or discovered issues
- Update other docs if behavior changed significantly

## Technical Context Awareness

### Type System
- Runtime `Piece` extends `PieceDefinition` + `PieceState` from jigg-spec
- Import spec types via `@jigg-spec/types` alias
- Runtime extensions in `src/puzzle/types.ts` only

### Architecture Patterns
- PixiJS owns canvas rendering (DOM only for accessibility)
- Clusters derived at runtime, never stored as objects
- Spatial hash for O(1) neighbor lookup
- Worker-based WASM integration for image processing

### Common Pitfalls
- Don't assign `pos` to bench pieces
- Don't move pieces from table back to bench  
- Don't use direct jigg-spec file imports
- Don't forget spatial hash updates after position changes
- Convert degrees ↔ radians for PixiJS rotation

## Response Style

### Technical Focus
- Reference specific files, functions, and constraints
- Include code examples when explaining patterns
- Point to existing implementations as examples
- Ask about technical trade-offs and performance implications

### Implementation Guidance  
- Provide specific file modification recommendations
- Suggest testing approaches for changes
- Note integration points with other systems
- Flag potential breaking changes or regressions

### Error Handling
- Include defensive programming patterns
- Suggest validation assertions for development builds
- Recommend fallback strategies for production
- Point to relevant debugging tools and techniques

## Integration with BA Workflow

When a story comes from BA planning:
- The story prompt should follow `docs/BA.md` format
- Confirm implementation preserves existing user experience

## Session Handoff

For multi-session work:
- Record progress in `docs/stories.md` even if incomplete
- Note exact state of implementation for next session
- Flag any blocking issues or needed clarifications
- Update roadmap status (In Progress vs Shipped)

This skill ensures consistent technical context and maintains the development workflow standards established for the Jigg project.
