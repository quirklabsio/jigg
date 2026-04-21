# Story 48: Curated image set + dev regression fixture

## Context

Story 47 shipped a "Choose Image" button that goes straight to a native file picker. That's fine for power users but gives a first-time user nothing to click through to. Story 48 adds a small baked-in set of public-domain images users can pick from, surfaced via the same button. One of those entries is a **designated dev regression fixture** — a small-grid image with documented manual-test steps (this absorbs the parked Story 47b into 48 per the fold-in decision).

Metadata stays lightweight per the roadmap — no JSON file (that's Story 49), no landing screen (Story 52), no settings panel (Story 70). Just a typed array and a minimal picker panel.

## Requirements

### The curated set

Create a new module at `src/curated/images.ts` exporting a typed array. Each entry:

```ts
{
  src: string;                     // path under public/curated/, e.g. '/curated/landscape-01.jpg'
  label: string;                   // short display name, e.g. "Mountain lake"
  forceGrid?: { cols: number; rows: number };  // optional grid override (used by the regression fixture)
}
```

Target set: **5–10 images** chosen for variety across the dimensions that matter: aspect ratio (at least one portrait, one landscape, one roughly square), palette complexity (at least one simple/graphic, one busy/photographic), and dominant-color spread (not all cool tones, not all warm). Dev picks the specific images.

**Public-domain only.** No personal photos. Good sources: Wikimedia Commons, Unsplash (public-domain license only), NASA, Met Open Access. Each image pre-normalized to ≤ 2048 px longest edge (to avoid Story 45's runtime normalization on every load) and ≤ 300 KB per file. Drop them in `public/curated/`.

### The regression fixture (the 47b fold-in)

Exactly one entry in the curated set is the dev regression image:
- **Grid: 3×3 = 9 pieces** via `forceGrid`. Chosen over 2×4=8 because 3×3 includes all three piece-classification types (4 corners, 4 edges, 1 interior) — that's the minimum grid that exercises the full bench filter strip.
- **Content**: clearly distinct regions per piece — a simple geometric or high-contrast image where correct placement is obvious at a glance. An abstract color-block composition beats a photograph here. Dev picks.
- **Label**: something like `"Regression test (3×3)"` — communicate the dev-tool nature in the label itself.
- **Always present in the set.** It's not hidden behind a debug flag. If a user loads it they get a small puzzle. No harm.

### The forceGrid plumbing

`computeGrid` currently derives `cols`/`rows` from image dimensions (Story 46). When a curated image with `forceGrid` is loaded, the override wins:

- Pass the optional forced grid through the image-load path (same path Story 47 refactored into `loadImageFile(file)` — this needs a sibling or parameter for "load by URL + optional forced grid").
- In `scene.ts`' `loadScene` (or wherever `computeGrid` is called), if a forced grid is provided, skip `computeGrid` and use the override. Otherwise behave as today.
- The grid override must respect the existing constraints: `rows >= 2`, `cols >= 2`, `rows * cols <= 200`. Throw or console.warn and ignore if the override violates. 3×3 satisfies all constraints.

### The picker panel

Repurpose the "Choose Image" button from Story 47. On click, it now opens a small panel (previously: triggered picker directly). The panel contains:

- A grid of thumbnails, one per curated entry (label below or overlay)
- An "Upload your own…" affordance at the bottom of the panel that triggers the hidden `<input type="file">` — the pre-48 flow
- Close affordances: Escape key, click outside the panel, or a small × in the panel corner

Click on a curated thumbnail → `loadImageFile(url, { forceGrid })` (the URL equivalent of the existing file-object path) → same `sessionStorage + reload` pipeline Story 45/47 established.

### Panel accessibility

Non-negotiable, consistent with the accessibility bar:
- Panel is a `<dialog>` (preferred) or a landmark region with `role="dialog"` + `aria-label="Choose an image"`
- Focus moves into the panel on open; trap focus inside while open (arrow keys navigate thumbnails, Tab cycles within)
- Enter activates the focused thumbnail
- Escape closes and returns focus to the "Choose Image" button
- Thumbnails are real `<button>` elements with `aria-label` including the image label (e.g. `aria-label="Mountain lake"`); a screen reader announces them

### The regression script document

Create `docs/regression-script.md` — a short, durable manual-test doc. Seed it with the end-to-end steps for the regression fixture: load regression image → open bench → extract one piece via click → extract one via keyboard → rotate a piece → snap to board → merge two pieces into a cluster → solve to completion. Each step should call out what it verifies. ~2 minutes of clicks, covers the core loop.

The doc is living — future stories add steps as they ship features. This first version just seeds it.

## Constraints

- **Do not introduce a metadata JSON file.** That's Story 49. The typed array in `src/curated/images.ts` is the entire metadata surface right now.
- **Do not build a landing screen.** Story 52 owns the "Play Today / Choose Image" fork.
- **Do not pre-empt Story 70's settings panel.** The picker panel is for image selection only — no rotation toggle, no snap sensitivity, no background controls.
- **Do not change drag-and-drop.** Drop still works onto the canvas, same as today.
- **Do not break 47's upload flow.** The "Upload your own…" option inside the panel must go through the exact same `loadImageFile(file)` helper. No duplication.
- **Do not commit images that can't pass a public-domain check.** If unsure about a specific image's license, skip it. Seven good images beats ten with a lawyer-attracting eighth.
- **Do not add image-level description text, credits, or license URLs to the array.** Those are Story 49's concern. Just `src`, `label`, optional `forceGrid`.
- **Do not remove the existing `public/test-image.jpg` or `public/test-face.png`.** They're referenced by QA fixtures; this story is additive.

## Files likely to touch

- `src/curated/images.ts` — new; the typed array
- `public/curated/*.jpg` — new image assets (5–10 files, each ≤ 300 KB)
- `index.html` — panel markup and inline styles (keep consistent with the existing `<style>` block)
- `src/main.ts` — extend `loadImageFile` (or add a sibling) to accept a URL + optional `forceGrid`; repurpose the Choose Image button to open the panel; wire thumbnail clicks and the upload fallback
- `src/canvas/scene.ts` (or wherever `computeGrid` is called) — honor the forced grid when present; fall through to `computeGrid` otherwise
- `docs/regression-script.md` — new
- `docs/decisions.md` — short note on the `forceGrid` override path and why the panel reused the 47 button rather than adding a second

## Acceptance

User tests via QA page. Write ACs into `public/qa.html` per the `/qa` command format.

- **AC-1: Panel opens from the existing button.** Click "Choose Image". A small panel appears near the button showing 5–10 thumbnails and an "Upload your own…" affordance. No duplicate or secondary button was added.
- **AC-2: Curated selection loads.** Click any curated thumbnail. The page reloads and the puzzle rebuilds around that image. Behavior matches drag-and-drop for the same image.
- **AC-3: Regression fixture produces exactly 9 pieces.** Click the regression entry. Bench shows exactly 9 pieces in a 3×3 grid. Filter strip shows 4 corners, 4 edges, 1 interior.
- **AC-4: Regression script is executable.** Follow `docs/regression-script.md` end-to-end on the regression image. Every step is clear; full script finishes in under ~3 minutes; all steps pass.
- **AC-5: Upload fallback unchanged.** Click "Upload your own…" inside the panel. Native file picker opens. Selecting an image loads it — identical to Story 47's flow.
- **AC-6: Drag-and-drop unchanged.** Drop an image onto the canvas (panel closed). Loads normally.
- **AC-7: Keyboard access.** Tab reaches the button. Enter/Space opens the panel. Focus moves into the panel. Arrow keys navigate thumbnails; Enter activates a selection. Escape closes the panel and returns focus to the button.
- **AC-8: Panel closes on outside click.** With panel open, click anywhere outside the panel. Panel closes.
- **AC-9: Screen reader announces.** Panel announces as a dialog with its `aria-label`. Each thumbnail announces its image label.
- **AC-10: No regression in Story 40–47 behaviors.** Tray open/close, bench filters, keyboard nav within bench/table, snap, rotation, completion detection all unchanged.

## Out of scope

- Metadata file (`docs/curated.json` or similar) — Story 49
- Landing screen / first-load fork — Story 52
- Settings panel — Story 70
- Dynamic image sources (MET API) — Stories 65–67
- Story 47a (piece visibility on board) — still a candidate
- Story 47c (palette tuning + swap UI) — still a candidate
- Story 46f (label clipping Approach B) — still a candidate
- Image attribution / credits text — Story 49
- A "scroll through all 10" panel layout if the set stays under ~10; a grid that fits in-panel is sufficient

## Known next

After 48: the remaining 47-series candidates (47a piece visibility, 47c palette), and Story 49 (metadata file). The roadmap has no committed order beyond "47a is probably the most pressing UX fix" — re-queue at BA-session time once 48 ships.
