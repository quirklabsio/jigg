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

## Story 44: Drag-and-drop image load

**Shipped:** 2026-04-18

Drop any image file onto the canvas container to replace the current puzzle image. On `drop`, reads `dataTransfer.files[0]`, validates `file.type.startsWith('image/')`, uses `FileReader.readAsDataURL` to encode the file as a base64 data URL, stores it in `sessionStorage` under `jigg:pendingImageUrl`, and reloads the page. On boot, `main.ts` reads that key (falling back to `TEST_IMAGE_URL`) and passes the URL to `loadScene`. Non-image drops are silently ignored. A `try/catch` on the `sessionStorage.setItem` call falls back gracefully if the image exceeds the 5 MB quota. A boot-time guard discards any stored value starting with `blob:` (defence against stale entries from earlier in the session).

**Deviation from prompt:** The prompt suggested blob URLs + `URL.createObjectURL`. Blob URLs are invalidated when the originating document unloads, so `Assets.load` returned null after the reload. Switched to data URLs, which are self-contained and survive the reload. See `decisions.md` (Drag-and-drop image load) and `gotchas.md` (Blob URLs and page reloads).

Files changed:
- `src/main.ts`
