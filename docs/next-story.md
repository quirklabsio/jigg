Story 44: Implement drag-and-drop image load

Drop any image file onto the canvas to immediately replace the current puzzle with that image. This is a dev-tool story — the goal is to test the pipeline with real images in seconds, not to build polished UX.

Technical requirements:

Listen for `dragover` and `drop` events on the canvas container in `src/main.ts`. On drop, read `event.dataTransfer.files[0]`, validate it is an image type (`file.type.startsWith('image/')`), create a Blob URL with `URL.createObjectURL(file)`, and reload the puzzle with that image.

There is currently no scene teardown path. The simplest correct approach is a page reload: store the Blob URL in `sessionStorage` before reloading, then on boot check `sessionStorage` for a pending image URL and use it instead of the hardcoded `TEST_IMAGE_URL`. This avoids writing a teardown path that will be rewritten in Story 46.

Constraints:
- Call `preventDefault()` on both `dragover` and `drop` to stop the browser from navigating away from the page
- No visual feedback required — the drop is the whole interaction
- Revoke the previous Blob URL before creating a new one to avoid memory leaks
- Do not validate beyond `file.type.startsWith('image/')` — broken or oversized images are acceptable at this stage (Story 45 handles normalization)

Files to touch:
- `src/main.ts` — drop listener, sessionStorage read/write, pass resolved URL to `loadScene`

Acceptance:
- Drop a JPEG or PNG anywhere on the canvas → puzzle reloads with that image
- Drop a non-image file → nothing happens (no error, no reload)
- Large images load but may render slowly or look wrong — acceptable (fixed in Story 45)
- No regression to existing puzzle interaction after the image loads
