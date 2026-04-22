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

## Story 48: Curated image set + dev regression fixture

**Shipped:** 2026-04-21

Added a 7-image public-domain curated set and a minimal picker panel triggered by the existing "Choose Image" button.

**Picker panel**: The button now opens a `<dialog>` (positioned near the button, not a full-screen modal) with a 3-column thumbnail grid and an "Upload your own…" fallback at the bottom. Focus moves to the first thumbnail on open; arrow-key navigation across the grid; Tab/Shift+Tab cycles through all focusable elements; Escape closes and returns focus to the button; click outside (backdrop) closes. The pre-47 file-picker path is unchanged — "Upload your own…" just triggers the same `fileInput.click()`.

**Curated set** (`src/curated/images.ts`): 7 entries — Regression test (3×3, color blocks), Earthrise (NASA), The Great Wave (Hokusai), The Starry Night (Van Gogh), Sunflowers (Van Gogh), Girl with a Pearl Earring (Vermeer), Water Lilies (Monet). Variety covers portrait/landscape/square, graphic/photographic, cool/warm. All pre-normalized to ≤ 2048px and ≤ 300 KB, stored in `public/curated/`.

**forceGrid plumbing**: `loadScene` gains an optional `{ cols, rows }` parameter. When provided and valid (≥ 2×2, ≤ 200 pieces), it bypasses `computeGrid`. `main.ts` stores it in a separate `jigg:forceGrid` sessionStorage key alongside `jigg:pendingImageUrl` and reads it at boot. `handleImageFile` always clears the key so an upload after a curated pick never inherits a stale forced grid.

**Regression fixture**: The `color-blocks-3x3.png` entry uses `forceGrid: { cols: 3, rows: 3 }` — 9 pieces with 4 corners, 4 edges, 1 interior; each piece a distinct solid color for unambiguous placement. Loads and verifies in ~2 minutes. Seeded `docs/regression-script.md` with the end-to-end steps.

Files changed:
- `src/curated/images.ts` — new; typed `CuratedImage` interface + `CURATED_IMAGES` array
- `public/curated/*.jpg` + `public/curated/color-blocks-3x3.png` — 7 new image assets
- `index.html` — `<dialog id="image-picker-dialog">` with thumbnail grid, upload button, close button, and all associated styles
- `src/main.ts` — full picker wiring (thumbnail population, arrow-key nav, focus trap, backdrop/Escape close, `loadImageUrl` helper, `SESSION_GRID_KEY` sessionStorage)
- `src/canvas/scene.ts` — `loadScene` accepts optional `forceGrid`; validates and bypasses `computeGrid` when present
- `docs/regression-script.md` — new; 7-step manual test for the core puzzle loop
- `docs/decisions.md` — new section on forceGrid, sessionStorage key, panel reuse, `<dialog>` choice, grid-key clearing
- `public/qa.html` — STORY and FIXTURES updated to Story 48 ACs (10 criteria)

---

## Story 47: Choose-image file picker (minimal UI)

**Shipped:** 2026-04-21

Added a persistent "Choose Image" `<button>` to `index.html` fixed in the top-right corner. On click, a hidden `<input type="file" accept="image/*">` is created programmatically and triggered; on `change`, `files[0]` is validated (`file.type.startsWith('image/')`) then passed to `handleImageFile`, which was already extracted in Story 46 — no duplication with the drop handler. Both entry points (drag-and-drop and button click) share the same `normalizeImage` → `sessionStorage` → `reload` pipeline unchanged.

Files changed:
- `index.html` — `<button id="choose-image-btn">` added as sibling of `#app`; inline styles in the existing `<style>` block (fixed top-right, system font, `#f0f0ee` background, hover state, browser default focus ring)
- `src/main.ts` — click handler wired to `chooseBtn`; creates hidden `<input type="file">`, calls `handleImageFile` on change
- `public/qa.html` — STORY and FIXTURES updated to Story 47 ACs

---

## Story 46e: Fix corner piece alignment — board size mismatch

**Shipped:** 2026-04-21

Root cause: `createBoard` in `board.ts` computed `bw = imageWidth * scale` and `bh = imageHeight * scale`, but piece coverage is `cols * Math.floor(imageWidth / cols) × rows * Math.floor(imageHeight / rows)`. For non-evenly-divisible images (e.g. 2048×1536 on a 15×11 grid), the board extended past the piece grid by up to `cols-1` px right and `rows-1` px bottom, creating visible corner gaps. Story-46-introduced — pre-dynamic grids (4×4 on 800×600 or 2048×2048) happened to divide evenly.

Fix (Option A): `createBoard` now computes `bw = Math.floor(imageWidth / cols) * cols * scale` and `bh = Math.floor(imageHeight / rows) * rows * scale`. The `cols`/`rows` params were already in the signature (previously `void`-ed). No change to centering math, shadow, or `scene.ts` call site. Options B (extend last-row/col pieces) and C (pad image at ingest) ruled out per story prompt.

The first fix (board.ts only) still left corners misaligned — `boardLeft`/`boardTop` in scene.ts was computing the canonical-position origin using `texture.width * scale`, not `piecePixelW * cols * scale`. The board rect and the canonical origin were now computing different widths/heights, shifting the board relative to the piece grid. Second fix: scene.ts line 503–504 changed to `(app.screen.width - piecePixelW * cols * scale) / 2` and `(app.screen.height - piecePixelH * rows * scale) / 2`.

Files changed:
- `src/canvas/board.ts` — `bw`/`bh` now computed from piece coverage, not raw image dimensions
- `src/canvas/scene.ts` — `boardLeft`/`boardTop` now use `piecePixelW * cols * scale` (consistent with board.ts)
- `docs/decisions.md` — new "Board size matches piece coverage" section
- `docs/engine-conventions.md` — new "Board dimensions" subsection in Coordinate Systems
- `public/qa.html` — STORY and FIXTURES updated to Story 46e ACs

---

## Story 46c: Bench→table scatter spread investigation

**Shipped:** 2026-04-21

**Outcome B — real bug fixed.** The `spiralPlace` step-size formula (`bench.ts:976`) used raw texture pixels (`maxDim * √2 * 1.3`) for a world-space step. Sprites are placed with `sprite.scale.set(_canvasScale)`, so world-space piece width = `maxDim × _canvasScale`. The formula was missing the `_canvasScale` factor, making spread proportional to `1 / canvasScale`. For the old test image (800×600, canvasScale=1.5) the spread was 1.46× piece widths — compact and felt right. For phone images (2048×1536, canvasScale=0.586) the spread was 3.75× — visibly wider. Story 46 did not introduce the bug; it became observable because Story 44/45 made real images the default input.

Fix: `stepSize = maxDim * _canvasScale * Math.SQRT2 * 1.3`. Spread factor is now constant at 2.20× piece widths at N=5 for all image sizes. Viewport.scale stays at 1.0 for all images (no auto-fit in loadScene); Outcome C was ruled out.

Full measurement table and decision in `docs/decisions.md` §Scatter spread investigation.

Files changed:
- `src/canvas/bench.ts` — `stepSize` formula now includes `_canvasScale`; occupancy check `hw`/`hh` also corrected to world units (`textureRegion * _canvasScale / 2`)
- `docs/decisions.md` — new "Scatter spread investigation (Story 46c)" section

---

## Story 46d: Fix piece label clipping on narrow pieces

**Closed without code fix:** 2026-04-21

Approach A (dynamic container scale) was attempted but abandoned. The piece-shape mask safe zone is only `≈ 0.43 × minDimension` wide; at 60–80px piece sizes with 3-digit labels, any K small enough to prevent clipping makes labels visually poor. The architecture (label as sprite child clipped by mask) does not scale to 1000+ piece puzzles. Approach B (overlay layer above mask, ticker-synced) is the correct fix; queued as Story 46f. See `docs/decisions.md` for full analysis.

No production code changed. `public/qa.html` updated to Story 46d ACs (usable when Story 46f ships).

---

## Story 46b: Fix bench piece clipping — tabs and focus ring

**Shipped:** 2026-04-21

Root cause: `THUMBNAIL_SIZE = TRAY_HEIGHT_OPEN * 0.7 = 154px` was set before Story 34 added the 36px filter strip. With the strip, available piece height dropped to 136px — 18px less than `THUMBNAIL_SIZE`. Piece cells overflowed the `_piecesContainer` mask AND extended off-screen, clipping both downward tab knobs and the stage-level focus ring.

Fix (Option B): changed `THUMBNAIL_SIZE` from the fixed formula to `TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED - FILTER_STRIP_HEIGHT - PADDING - BENCH_RING_CLEARANCE = 128`. Added `BENCH_RING_CLEARANCE = 8` constant (≥ `FOCUS_RING_PADDING + FOCUS_RING_THICKNESS` from `scene.ts`). Option A (pad mask) was rejected because the piece cell bottom was already off-canvas — mask expansion can't make off-screen content visible. `decisions.md` records the full option analysis.

Files changed:
- `src/canvas/bench.ts` — `THUMBNAIL_SIZE` redefined from `TRAY_HEIGHT_OPEN * 0.7` to geometry-derived constant; `BENCH_RING_CLEARANCE` added; `PADDING` and `FILTER_STRIP_HEIGHT` reordered before `THUMBNAIL_SIZE`
- `docs/decisions.md` — new "Bench piece clipping fix (Story 46b)" section
- `public/qa.html` — STORY and FIXTURES updated to Story 46b ACs

---

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
