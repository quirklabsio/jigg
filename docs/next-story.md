# Story 45: Normalize dropped images before storage

Story 44 ships any dropped image straight into `sessionStorage` as a data URL. Phone photos (typically 3–5 MB JPEG, 4032×3024) routinely exceed the 5 MB quota and silently fall back to the test image. They also risk WebGL texture limits and waste memory as textures. Story 45 introduces a normalization step that runs on the dropped file *before* storage, so the quota-exceeded fallback becomes a rare defence rather than the common case.

## Requirements

Add a pure normalization step between the `drop` handler and `sessionStorage.setItem`:

- **Decode** the `File` into an `ImageBitmap` with `createImageBitmap(file, { imageOrientation: 'from-image' })`. This respects EXIF orientation — without it, iPhone portrait photos load sideways.
- **Downscale** if either dimension exceeds `MAX_DIMENSION = 2048`. Preserve aspect ratio (scale by `MAX_DIMENSION / max(width, height)`). Do not upscale images that are already smaller.
- **Re-encode** as JPEG at quality `0.85` via `OffscreenCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })`. This normalizes PNG payloads (which can be 10×+ the size of an equivalent JPEG) and gives a predictable upper bound on stored size.
- **Convert** the resulting blob to a data URL (same `FileReader.readAsDataURL` pattern as Story 44) and hand it to the existing storage path.
- **Extreme aspect ratios:** do NOT reject or clamp them. If `max(w, h) / min(w, h) > 4`, `console.warn` with the dimensions and proceed — the whole outcome of this epic is "discover performance ceilings early", not "prevent users from trying things". Story 46 will decide what to do about extreme aspects once we see real failure modes.

## Constraints

- No UI. No progress indicator, no "resizing…" toast, no error dialog. A drop either succeeds silently or logs to console.
- Same silent-ignore behaviour as Story 44 for non-image drops (`file.type.startsWith('image/')` gate stays).
- The `sessionStorage` quota fallback from Story 44 stays in place as defence — don't delete it. Normalization should make it rarely-needed, not redundant.
- Normalization must be a pure async function: `normalizeImage(file: File): Promise<string>` returning a data URL. No side effects, no DOM access, no storage. The caller in `main.ts` owns the storage + reload flow.
- Do not touch `loadScene` or the Pixi pipeline. This story operates entirely on the pre-storage boundary.

## Files to touch

- `src/imageNormalize.ts` (new) — the `normalizeImage(file)` pure function
- `src/main.ts` — replace the inline `FileReader.readAsDataURL(file)` path with `await normalizeImage(file)` before `sessionStorage.setItem`

## Acceptance

- Dropping a 4032×3024 phone JPEG results in a stored data URL whose decoded image has longest edge ≤ 2048 px.
- Dropping a 500×500 image leaves its dimensions untouched (no upscaling), though it may be re-encoded as JPEG.
- Dropping a portrait-oriented iPhone photo renders right-side-up (EXIF orientation honoured).
- Dropping a large PNG (e.g. 3000×3000 screenshot) produces a stored size well under the 5 MB `sessionStorage` quota. The Story 44 quota fallback does not trigger.
- Dropping a 4000×200 panorama loads without error; a `console.warn` records the extreme aspect ratio.
- Dropping a non-image file is silently ignored (no change from Story 44).
- No regression in initial boot: with no stored image, the test image still loads.
- No regression in re-drop: dropping a second image replaces the first after reload.

## Out of scope

- Upscaling small images (intentional — forcing uniform resolution hurts crisp small assets)
- Worker-based normalization (`createImageBitmap` + `OffscreenCanvas` are fast enough for single-image decode on main thread; revisit if Story 46 piece generation piles on)
- Content validation (corrupt files, SVG bombs, HEIC, etc. — `createImageBitmap` will reject and `normalizeImage` should surface that as a rejected promise; `main.ts` catches and console.warns)
- Any UI feedback
