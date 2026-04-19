Produce a chat-only QA handoff for the work just completed. The tester has not seen the code and may have forgotten what the story was about — write for that reader.

Output this, in chat, in order:

**Lead with:** `Done.`

**1. Refreshed acceptance criteria.** Copy the criteria from `docs/next-story.md` and amend to reflect what actually shipped. If scope expanded, add the new criteria. If a criterion moved, note the move. If one was dropped, say why. This list is what the user ticks through when testing.

**2. Test steps.** Concrete click-paths, key presses, drop targets, URLs. Each step maps to one or more acceptance criteria. No "verify it works" hand-waving — say exactly what to do and what to look for.

**3. Test fixtures.** Drop any test images needed for this story into `/qa-scratch/` (gitignored, local-only scratch). Do not promote anything into `/test/fixtures/` — that's a human decision made after actual testing. `/qa` produces artifacts; the user decides what's worth keeping.

For each file dropped into `/qa-scratch/` this story, report:
- Path (e.g. `qa-scratch/iphone-portrait-exif.jpg`)
- Which acceptance criterion it exercises (from section 1)
- Why a user-supplied file wouldn't prove the criterion as reliably

Size guidance: keep images under 1 MB where the story allows — a 1200×1600 portrait JPEG proves EXIF rotation as well as a 5 MB one.

If no fixtures were needed, say so and explain reproduction (e.g. "use any portrait-oriented phone photo"). Don't invent paths that don't exist.

See `test/fixtures/README.md` for the three-tier system (scratch → promoted → external) and the promotion rules. `/qa` only operates on the scratch tier.

**4. Out of scope.** Things the user should NOT test in this pass — deferred sub-tasks, known limitations, unrelated adjacent features that weren't touched. Prevents the user from chasing non-bugs.

**5. What's coming up.** Read the Next column of `docs/roadmap.md` and list the next 2–3 stories in the current epic (title + one-line outcome each). This gives the tester context on what's deliberately unfinished vs. what's a bug. Example: "Story 46 — Rebuild Puzzle on Image Load: piece regeneration after image load. So if extracting pieces still reflects the old puzzle grid, that's a Story 46 concern, not a Story 45 bug."

**Do not:**
- Write to `docs/next-story.md` (BA-owned)
- Run `/refine` — that's a separate step, after QA confirms the work
- Create `qa-checklist.md` or any handoff file — this command is chat-only by design

**Do:**
- Drop test images in `/qa-scratch/` for user testing. Report what was created and why. Promotion decisions happen after actual testing — not here.
- Keep each section scannable — this is a checklist, not prose
