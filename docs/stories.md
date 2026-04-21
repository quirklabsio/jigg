<!-- audience: Dev, Agent -->

# Stories — Implementation Log

*What shipped, in order. One entry per story. Stories 1–43 shipped before this log was started.*

---

<!-- Story entries go here as features ship. Format:

## Story XX: Title

**Shipped:** YYYY-MM-DD

What was built. Key decisions made during implementation. Any deviations from the story prompt.

Files changed:
- `src/...`

-->

## Story 46: Dynamic piece grid from image aspect ratio

**Shipped:** 2026-04-20

Adds `computeGrid(imageWidth, imageHeight)` to `src/puzzle/cutter.ts`. The function computes rows/cols so pieces are close to square, uses four constants (`TARGET_PIECES=160`, `MAX_PIECES=200`, `MIN_PIECE_SIDE=60`, `MIN_GRID=2`), and enforces the 200-piece hard cap by reducing the larger dimension first. The `COLS=4`/`ROWS=4` module constants in `scene.ts` were removed. `buildGridSprites` now accepts `cols`/`rows` as parameters; `loadScene` calls `computeGrid(texture.width, texture.height)` and threads the result through every use: `gridCut`, `buildGridSprites`, `createBoard`, the WASM worker `GENERATE_CUTS` message, and `buildPieceMask`.

QA results: 800×600 → 13×10 = 130 pieces; 512×512 → 9×9 = 81 pieces (MIN_PIECE_SIDE floor raises piece size from ~40px to 60px, giving fewer pieces than TARGET_PIECES — correct and expected); 2048×2048 → 13×13 = 169 pieces; 2048×102 panorama → loads with rows=2 enforced by MIN_GRID.

Also added in this session (dev tool, not story scope): `public/qa.html` (at `/qa`) — QA checklist with numbered AC rows (Pass/Fail buttons, progress bar), draggable fixture cards, fixture nomination for promotion, observations field, and Copy QA Report button. `main.ts` now handles both OS file drops and browser-to-browser URL drops (`text/uri-list`); extraction logic moved into a shared `handleImageFile`. `vite.config.ts` gained a dev-only middleware serving `qa-scratch/` at `/qa-scratch/` so scratch images are available to the picker without being committed. Two fixtures promoted after QA: `grid_phone-aspect_2048x1536_165pieces.jpg` and `grid_panorama-extreme_2048x102_mingrid.jpg` into `test/fixtures/images/slice/`. Clipboard copy uses a three-tier fallback: `navigator.clipboard` → `execCommand` → modal with pre-selected text.

Files changed:
- `src/puzzle/cutter.ts` — added `computeGrid` + four constants
- `src/canvas/scene.ts` — removed `COLS`/`ROWS`; threaded `cols`/`rows` from `computeGrid` through all uses
- `src/main.ts` — extracted `handleImageFile`; added URL-based drop path
- `vite.config.ts` — dev middleware serving `qa-scratch/` at `/qa-scratch/`
- `public/qa.html` — new QA checklist tool
- `test/fixtures/images/slice/fixtures.json` — two new promoted fixtures

---

## Story 45: Normalize dropped images before storage

**Shipped:** 2026-04-18

Adds a `normalizeImage(file: File): Promise<string>` pure function in `src/imageNormalize.ts`. On drop, the file is decoded via `createImageBitmap(file, { imageOrientation: 'from-image' })` (respects EXIF orientation), downscaled to a longest edge of `MAX_DIMENSION = 2048` if needed (no upscaling), re-encoded as JPEG at quality 0.85 via `OffscreenCanvas.convertToBlob`, and converted to a data URL via `FileReader.readAsDataURL`. Extreme aspect ratios (max/min > 4) emit a `console.warn` and proceed. The caller in `main.ts` retains all storage and reload logic; `normalizeImage` has no side effects. The Story 44 `sessionStorage` quota fallback is preserved. On `normalizeImage` rejection (e.g. corrupt file), `main.ts` logs the error and does not reload.

A `test-images/` directory was created with six acceptance-test fixtures (Python/Pillow script, generated once and committed): `phone-4032x3024.jpg`, `small-500x500.jpg`, `iphone-portrait-exif6.jpg`, `large-3000x3000.png`, `panorama-4000x200.jpg`, and `not-an-image.txt`. The EXIF fixture was initially built wrong (portrait raw pixels with Orientation=6, which rotates to landscape — the opposite of a real iPhone photo). Fixed in session: raw pixels must be landscape (4032×3024) so Orientation=6 rotates them to portrait (3024×4032), scaling to 1536×2048. See `gotchas.md`.

Manual verification confirmed: phone JPEG downscaled to 2048×1536, small image unchanged at 500×500, panorama stored at 2048×102 with `console.warn` emitted (visible with Preserve Log). Note: the panorama produces visually broken puzzle pieces because Story 46 (puzzle rebuild on image load) has not shipped — this is expected and intentional per the story prompt ("discover performance ceilings early").

Files changed:
- `src/imageNormalize.ts` (new)
- `src/main.ts`
- `test-images/` (new directory — acceptance-test fixtures, not shipped assets)

---

## Story 44: Drag-and-drop image load

**Shipped:** 2026-04-18

Drop any image file onto the canvas container to replace the current puzzle image. On `drop`, reads `dataTransfer.files[0]`, validates `file.type.startsWith('image/')`, uses `FileReader.readAsDataURL` to encode the file as a base64 data URL, stores it in `sessionStorage` under `jigg:pendingImageUrl`, and reloads the page. On boot, `main.ts` reads that key (falling back to `TEST_IMAGE_URL`) and passes the URL to `loadScene`. Non-image drops are silently ignored. A `try/catch` on the `sessionStorage.setItem` call falls back gracefully if the image exceeds the 5 MB quota. A boot-time guard discards any stored value starting with `blob:` (defence against stale entries from earlier in the session).

**Deviation from prompt:** The prompt suggested blob URLs + `URL.createObjectURL`. Blob URLs are invalidated when the originating document unloads, so `Assets.load` returned null after the reload. Switched to data URLs, which are self-contained and survive the reload. See `decisions.md` (Drag-and-drop image load) and `gotchas.md` (Blob URLs and page reloads).

Files changed:
- `src/main.ts`
