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
