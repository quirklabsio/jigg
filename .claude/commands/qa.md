Produce the QA handoff for the work just completed. The primary artifact is the QA page at `http://localhost:5173/qa`. Chat output is a thin pointer plus the context the user needs before opening the page.

## Before running /qa

### 1. Update `STORY` and `FIXTURES` at the top of `public/qa.html`

Find the `const STORY = { ... }` block (around line 301). Replace with:
- `number` — story number (integer)
- `title` — short imperative title, matching `docs/next-story.md`
- `criteria` — array of `{ id: 'AC-N', text: '...' }`. Each AC's text should embed the expected outcome so the user can judge Pass/Fail from reading it alone (not "it works" — "bench shows 165 ± 10 pieces, pieces look square-ish").

Find the `const FIXTURES = [ ... ]` block. Replace with one entry per candidate fixture — both existing `public/` assets (e.g. `/test-image.jpg`) and any new `/qa-scratch/` images created this story. Each entry:
- `src` — the path the app loads (e.g. `/qa-scratch/foo.jpg` or `/test-image.jpg`)
- `name` — display label
- `dims` — e.g. `'2048 × 1536'`
- `acs` — list of AC ids this fixture exercises
- `expect` — one-line "what the user should see"
- `qaFile` — scratch fixtures only: filesystem path, e.g. `'qa-scratch/synthetic-2048x1536.jpg'`
- `recommended` — `true` if you are nominating this fixture for promotion to `/test/fixtures/`
- `recommendReason` — one-line rationale, visible on the page and included in the copied QA Report

### 2. Drop new fixtures into `/qa-scratch/`

Gitignored, local-only. A nominated fixture's `qaFile` must point to a real file. See `test/fixtures/README.md` for the three-tier system.

### 3. Pre-nominate fixtures for promotion

Tick `recommended: true` on any scratch fixture you believe belongs in `/test/fixtures/images/<area>/`. The user ticks/unticks in the page UI. **Never promote unilaterally.** After the user signs off, they tell you which nominations they accepted; you do the actual move + `fixtures.json` entry then.

`recommendReason` is not fluff — answer: "what does this fixture uniquely prove that a user-supplied file wouldn't?"

## /qa chat output

Keep it thin — the page carries the weight.

**Lead with:** `Done.`

**1. Pointer.** `QA page live at http://localhost:5173/qa — N ACs, M fixtures (K nominated for promotion).`

**2. Out of scope.** Things the user should NOT flag as bugs: deferred sub-tasks, known limitations, adjacent features that weren't touched.

**3. What's coming up.** Next 2–3 stories from the Next column of `docs/roadmap.md` (title + one-line outcome), so the tester knows what's deliberately unfinished vs. a bug.

## Do / Don't

- **Do not** write to `docs/next-story.md` (BA-owned).
- **Do not** run `/refine` — separate step, after the user confirms QA passed.
- **Do not** promote fixtures unilaterally. Nominate only; user approves; dev does the move.
- **Do not** create any other handoff files. The QA page + chat is the complete handoff.
- **Do** keep the chat output short. The page is the primary interface.
