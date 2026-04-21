# Story 47: Choose-image file picker (minimal UI)

## Context

Story 44 introduced drag-and-drop as a dev-tool entry for arbitrary images; Story 45 normalized them; Story 46 made the puzzle rebuild around any grid. End users don't drag files onto web apps as a first instinct though — they click buttons. Story 47 is the first of the Controlled Inputs epic ("make it a product, not a dev tool"): add a minimal DOM button that triggers the native file picker, routing the chosen file through the same pipeline drag-and-drop already uses.

No design flourish. One button, one click, reuse the existing path.

## Requirements

Add a persistent DOM `<button>` element to `index.html` (a sibling of `#app`, not inside the pixi-managed region). Label it clearly — "Choose Image" is the roadmap's suggested text; you can pick any equivalent imperative label but avoid verbose copy.

On click:
1. Programmatically create a hidden `<input type="file" accept="image/*">` and trigger `.click()` on it (the standard pattern for styled upload triggers — a real `<input>` is clunky to style, a hidden one driven by a button is accessible and clean).
2. On `change`, read `files[0]`. Apply the existing gate `file.type.startsWith('image/')`.
3. Call `normalizeImage(file)` — the exact same function Story 45 added.
4. Store to `sessionStorage` under the existing `SESSION_KEY` (`'jigg:pendingImageUrl'`).
5. `window.location.reload()`.

This is the drag-and-drop pipeline, reused. **Do not duplicate the logic.** Extract the shared "process-and-load-image" path from `main.ts`'s drop handler into a single helper (e.g. `loadImageFile(file)`) and call it from both the drop handler and the new click handler. The drop handler must continue to work identically after the refactor.

### Styling

Inline styles in `index.html`'s existing `<style>` block. No separate stylesheet. Keep it visually small and unobtrusive:

- Fixed position, one corner of the viewport (top-right is the default recommendation — top-left may conflict with future settings or landmark focus)
- ~8–12 px padding, system font, neutral background (off-white or pale gray) matching the existing `#f5f5f3` body background so it doesn't shout
- Subtle hover state
- Clear focus ring (honor the default browser outline or provide an equivalent; accessibility is non-negotiable)

### Accessibility

- It's a real `<button>`, not a styled `<div>`. Tab lands on it. Enter/Space activates. Screen readers announce "button, Choose Image".
- The button must remain reachable regardless of the bench/table keyboard mode (see `decisions.md` §"Keyboard Mode Switching — `inert` model"). It is NOT inside the bench or table landmark — it's a top-level document control, so the `inert` management on `benchLandmark` / `table` does not touch it.
- Do not interfere with existing keyboard shortcuts (T, Tab, Enter, etc.). The button responding to its own click/keydown is fine; global keydown handlers in `scene.ts` still fire.
- Confirm the button tabs into a sensible order — probably first (before the puzzle landmark) or last, whichever fits naturally. Don't force a specific tabindex unless necessary.

## Constraints

- **Do not change the image pipeline.** `normalizeImage`, `sessionStorage`, reload-based rebuild — all stays. This story is a new entry point, not a rewrite.
- **Do not remove or weaken drag-and-drop.** Both entry points coexist. Drop still works exactly as before.
- **Do not introduce a loading spinner or progress UI.** Normalization is fast at 2048 max; a spinner adds ceremony for a non-problem. If perf is ever a real issue, that's a future story.
- **Do not add a custom file-type error dialog.** Non-image selection is silently ignored, matching Story 44's behavior. User picks the file; we trust the `accept` attribute to guide them.
- **Do not style the button into something clever.** "Minimal UI" means it looks like a button, not like a brand.
- **Do not touch pixi UI layers** (`scene.ts` tray, filter strip, etc.). This is a DOM button outside the canvas.
- **Do not pre-empt the Settings panel (Story 70).** If you find yourself thinking about a panel, a dropdown, or a menu, step back — a single button is the entire surface.

## Files likely to touch

- `index.html` — add the `<button>`, add inline styles for it
- `src/main.ts` — extract `loadImageFile(file)` helper, wire it to both the drop handler (refactor) and the new click handler

## Acceptance

User tests via QA page. Write ACs into `public/qa.html` per the `/qa` command format.

- **AC-1: Button visible on load.** The "Choose Image" button is visible in the corner of the viewport on initial load. Doesn't overlap the tray, filter strip, or other existing UI.
- **AC-2: Click opens native picker.** Clicking the button opens the OS file picker. The picker filter shows image types only (`accept="image/*"`).
- **AC-3: Picked image loads.** Pick any JPEG or PNG from the QA page's fixture list (or any image on disk). The page reloads and the puzzle regenerates around the chosen image. Behavior is identical to drag-and-drop of the same file.
- **AC-4: Non-image silently ignored.** If the user picks a non-image file via a file picker that allowed it (rare given `accept`, but possible), nothing happens — no error, no reload. Matches Story 44 drop behavior.
- **AC-5: Drag-and-drop still works.** Drop an image onto the canvas. Loads identically. Both entry points functional.
- **AC-6: Keyboard accessible.** Tab to the button. It receives a visible focus ring. Press Enter — picker opens. Press Space — picker opens. Screen readers announce it as a button with the correct label.
- **AC-7: Tabs through without breaking keyboard modes.** Open the tray with `T`. Tab. Focus lands sensibly (button reachable; bench landmark still navigable; no accidental inert violations). Close the tray with `T`. Tab still works correctly on the table side.
- **AC-8: No regression in puzzle solving.** Load an image via the button, solve a few pieces, extract via keyboard, snap to the board. All Story 40–46e behaviors still work.

## Out of scope

- Curated image set (Story 48)
- Metadata shape (Story 49)
- Landing screen with "Play Today" / "Choose Image" fork (Story 52 — that's further out and includes a second button)
- Settings panel (Story 70)
- Any progress UI, error dialog, or file-type feedback
- Visual design beyond "minimal system button"
- Story 46f (label clipping Approach B) — still queued separately; not a blocker

## Known next

After 47: Story 48 (Curated Image Set — hardcoded) kicks off the "baked-in images" work, still inside Controlled Inputs. 46f queued independently.
