Think about what we learned during this session. Analyse errors that occurred and how they were fixed. Then:

- Read `docs/README.md` to orient on the current doc structure
- Read `docs/gotchas.md` and `docs/decisions.md`
- Update `docs/stories.md` with a new entry for this session

For any new knowledge gained, route it to the right layer:
- Something changed about **what exists or how it fits together** → `docs/architecture.md`
- A new **trade-off or choice was made** → `docs/decisions.md`
- A new **implementation detail, pattern, or constraint** → the relevant implementation doc (`engine-conventions.md`, `drag-and-drop.md`, `snap-detection.md`, `wasm-pipeline.md`, `accessibility.md`, `conventions.md`, `spec-integration.md`)
- A new **anti-pattern or failure mode** → `docs/gotchas.md`

Create a new implementation doc in `docs/` only if no existing file fits. Do not create new docs for the other two layers — there is exactly one architecture doc and one decisions doc.
