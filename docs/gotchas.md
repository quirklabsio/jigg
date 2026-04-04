# Gotchas

## WASM
- WASM must be initialized async before any function calls
- wasm-pack target must be `--target web` — generates ES module importable in module workers; `--target no-modules` uses `importScripts()` which breaks in Vite's module workers (Vite dev mode always serves `?worker` imports as module workers)
- WASM loaded in workers via dynamic import with vite-ignore: `import(/* @vite-ignore */ '/wasm/jigg_analysis.js')` — Vite skips bundling the static public asset. Do not use `importScripts()`
- `vite.config.ts` `worker.format: 'iife'` was explored in Story 1 then removed in Story 3 — only applies to production builds, not Vite dev mode. Do not re-add it
- **`wasm-pack: command not found` in npm scripts**: `wasm-pack` lives in `~/.cargo/bin` which is not on the default shell PATH when npm scripts run. Fix: `export PATH="$HOME/.cargo/bin:$PATH" && npm run wasm:build`, or add `~/.cargo/bin` to the system PATH permanently. Same applies to `cargo`.
- **`Vec<u8>` → `Uint8Array` return type**: wasm-bindgen correctly maps `Vec<u8>` return values to `Uint8Array` on the JS side. No cast needed — the generated `.d.ts` reflects this after `wasm-pack build`. Always check the generated type before adding manual casts.

## TypeScript / tsconfig
- tsconfig must exclude worker files to prevent DOM lib conflict: `src/workers/` files use `/// <reference no-default-lib="true"/>` which strips DOM types from the entire compilation if not excluded. Fix: `"exclude": ["src/workers"]` in tsconfig.json. Workers still compiled by Vite at runtime; exclusion is only for `tsc --noEmit`. tsconfig `lib` should be `["ES2022", "DOM", "DOM.Iterable"]` (no "WebWorker" since workers are excluded)
- Worker files need explicit type references at top: `/// <reference no-default-lib="true"/> /// <reference lib="ESNext" /> /// <reference lib="WebWorker" />`
- `skipLibCheck: true` in tsconfig required to avoid errors from Vite's internal Node.js type definitions
- `/// <reference types="vite/client" />` must live in `src/main.ts`, NOT in tsconfig `types` array — putting it in tsconfig pulls in Vite's Node.js types and causes errors

## Vite / Workers
- Vite requires `?worker` suffix for Web Worker imports: `import Worker from './workers/analysis.worker.ts?worker'`

## PixiJS
- PixiJS v8 API differs significantly from v4/v5 — do not reference legacy docs or examples
- PixiJS Sprite textures must be created from the shared renderer, not instantiated directly
- `s.width` on a rotated sprite returns the AABB width, not the texture width — use `s.texture.frame.width` for rotation-aware hit testing
- Initial sprite zIndex should be unique per sprite (use loop index `i`); set `settleCounter = spriteMap.size` in `initDragListeners` so first drop's zIndex clears all initial values
- **Graphics path resets on fill()/stroke()**: In PixiJS v8, each `g.fill()` or `g.stroke()` call applies to the current path and then resets it. Batch all path commands (moveTo/lineTo, circle, rect) before calling fill()/stroke() to apply one style to many shapes in a single draw call. Calling fill() in a loop = separate draw calls per shape.
- **DRAG_SCALE gap on inner edges**: Applying scale > 1 to every sprite in a multi-piece group scales each around its own center (anchor=0.5), pulling inner edges apart visibly. Fix: only apply DRAG_SCALE when `group.pieceIds.length === 1`.

## Snap / Rotation
- **group.rotation not set in scatter**: `scatter.ts` was randomising `piece.rotation` but not updating `group.rotation`. Snap checks `group.rotation`, not `piece.rotation`. Symptom: snap never fires for rotated pieces because `normRot(group.rotation)` always returned 0. Fix: assign `group.rotation = piece.rotation` in scatter when setting piece rotation.

## Pixel Extraction
- OffscreenCanvas used for pixel extraction in scene.ts: `texture.source.resource as CanvasImageSource` draws onto `OffscreenCanvas` 2d context; use `new Uint8Array(imageData.data.buffer)` to convert `Uint8ClampedArray` → `Uint8Array` for postMessage to worker
- **Image conversion tooling not available in this environment**: `convert` (ImageMagick), `ffmpeg`, and Python `PIL` are all absent. To swap test images, copy the file directly and update `TEST_IMAGE_URL` in `main.ts` to match the extension. PNG works fine with PixiJS `Assets.load`.

## Snap broke after texture frame expansion (Story 14 → session)
- **Symptom**: piece-to-piece snap stopped firing entirely after the jigsaw mask work expanded sprite texture frames to include tab padding.
- **Root cause**: `snap.ts` computed `pieceW/pieceH` from `firstSprite.texture.frame.width/height`. After texture frames grew to include tab overhang, those values were larger than the actual grid cell size, so the expected neighbour world position was wrong and distance always exceeded the threshold.
- **Fix**: use `firstPiece.textureRegion.w * sprite.scale.x` and `firstPiece.textureRegion.h * sprite.scale.y`. `textureRegion` always holds the original un-expanded grid dimensions. Rule: **never derive grid piece size from `texture.frame`** — use `textureRegion` from the Piece model.

## Edge-influence shifts cut endpoints off grid corners (Story 15)
- **Symptom**: black slivers between adjacent pieces; mask bezier curves start from wrong positions at corners.
- **Root cause**: `generate_cuts` applied the edge-influence baseline offset to ALL points in the cut path, including `pts[0]` and `pts[18]`. These endpoints are supposed to sit at the exact grid corner coordinates so adjacent horizontal and vertical cuts connect at the same point. After the offset, they no longer matched.
- **Fix**: After computing the shifted bezier path, override the endpoints back to the unshifted grid corner: `pts[0][1] = cut_y_grid; pts[18][1] = cut_y_grid;` for horizontal cuts; `pts[0][0] = cut_x_grid; pts[18][0] = cut_x_grid;` for vertical cuts.
- **Rule**: Cut path endpoints must always sit exactly on the grid corner coordinates. Edge influence offsets the BASELINE (middle of the path), not the endpoints.

## `drawCutSegments` assumes cursor is already at pts[0]
- **Symptom**: mask path has an invisible "skip" at each cut join — bezier starts from wherever the cursor happens to be rather than from the cut's first point.
- **Root cause**: `drawCutSegments` starts its loop at index 1, treating the caller's current cursor as the implicit pts[0]. If any discrepancy exists between the cursor and pts[0] in local space, the first bezier segment starts from the wrong point.
- **Fix**: Always call `g.lineTo(toLocal(pts[0]))` before `drawCutSegments`. When pts[0] equals the cursor (no edge influence), this is a zero-length no-op. When they differ, it bridges the gap explicitly.
- **Rule**: Never call `drawCutSegments` without first lining to pts[0].

## PixiJS v8: no `antialias: false` on Graphics — use `roundPixels: true`
- **Symptom**: sub-pixel gap pixels at shared stencil mask boundaries appear as dark slivers.
- **Root cause**: PixiJS v8 `GraphicsOptions` has `roundPixels?: boolean` but NO `antialias` property. Graphics masks use `StencilMask` (binary stencil buffer), which is inherently non-antialiased. However, stencil triangles at sub-pixel boundary positions can leave a boundary pixel unclaimed by either adjacent mask.
- **Fix**: Set `mask.roundPixels = true` after building the mask (or `new Graphics({ roundPixels: true })`). This snaps stencil geometry vertices to integer device pixels so shared boundaries always land on a whole pixel and are unambiguously claimed by one of the two adjacent masks.
- **PixiJS v8 mask type routing**: `AlphaMask.test(mask)` returns true only for `Sprite` instances; `StencilMask.test(mask)` returns true for any `Container` (including Graphics). Graphics masks always use the stencil buffer — no alpha fringe.

## Worker edgeMap buffer transfer detaches the buffer — must slice() before postMessage
- **Symptom**: `generate_cuts` receives an empty/detached `Uint8Array` for `edge_map` when trying to reuse the edge map computed by `analyze_image`.
- **Root cause**: `self.postMessage(response, [edgeMap.buffer])` transfers the buffer to the main thread. After transfer, the worker's `edgeMap` variable references a zero-length detached buffer. Any attempt to read it returns zeros.
- **Fix**: Before transferring, store a copy: `storedEdgeMap = edgeMap.slice()`. The `.slice()` creates a new buffer that remains in the worker's memory. Transfer the original.
- **Rule**: Any `Uint8Array` that will be transferred via postMessage must be `.slice()`d first if the worker needs to retain the data.

## `Graphics` missing from PixiJS import when casting `sprite.mask as Graphics`
- **Symptom**: TypeScript error `Cannot find name 'Graphics'` in scene.ts when adding mask-clear logic (`sprite.mask as Graphics`).
- **Root cause**: `Graphics` was not in the PixiJS named import in scene.ts — the file only used `Sprite`, `Application`, etc.
- **Fix**: Add `Graphics` to the import: `import { Application, Assets, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';`

## PixiJS v8 filters: `dFdx`/`dFdy` unavailable without extension
- **Symptom**: GLSL shader compile error `'dFdx' : no matching overloaded function found` when using screen-space partial derivatives in a PixiJS filter.
- **Root cause**: PixiJS v8 does NOT add `#version 300 es` to filter shaders. Without this directive, the GLSL compiler treats the source as GLSL ES 1.0 regardless of the WebGL2 context. In GLSL ES 1.0, `dFdx`/`dFdy` require the `GL_OES_standard_derivatives` extension which PixiJS does not enable automatically.
- **Fix**: Avoid `dFdx`/`dFdy` entirely. Compute the gradient via central-difference texture samples:
  ```glsl
  uniform vec2 uDistanceFieldTexel; // vec2(1/textureWidth, 1/textureHeight)
  float dx = texture(uTex, uv + vec2(uDistanceFieldTexel.x, 0.0)).r
           - texture(uTex, uv - vec2(uDistanceFieldTexel.x, 0.0)).r;
  float dy = texture(uTex, uv + vec2(0.0, uDistanceFieldTexel.y)).r
           - texture(uTex, uv - vec2(0.0, uDistanceFieldTexel.y)).r;
  ```
- **Rule**: Never use `dFdx`/`dFdy` in PixiJS v8 filters; always pass texel size as a uniform and use finite differences.

## Stale variable reference after removing debug code
- **Symptom**: `error TS2304: Cannot find name 'currentEdgeInfluence'` after removing the Story 15 debug key bindings (1/2/3 keys that reassigned `currentEdgeInfluence`).
- **Root cause**: The `GENERATE_CUTS` postMessage payload still referenced `currentEdgeInfluence` after the variable declaration and key-binding block were deleted. TypeScript correctly catches the dangling reference.
- **Fix**: Replace `currentEdgeInfluence` with the canonical constant `EDGE_INFLUENCE` imported from `cutter.ts`. The debug bindings were the only thing that ever diverged from it.
- **Rule**: When removing a debug variable that shadows a module constant, grep for every use of the debug variable before deleting the declaration — don't assume only one call site exists.

## DropShadowFilter + stencil mask: must apply filter to parent Container, not the masked Sprite
- **Symptom**: Shadow is cast from the full rectangular sprite bounds instead of the jigsaw piece shape. Black rectangular blobs appear around each piece.
- **Root cause**: PixiJS filters on a Sprite operate on the sprite's texture before the stencil mask is applied. The filter sees a fully-opaque rectangle, not the masked jigsaw shape.
- **Fix**: Wrap each sprite in a one-child `Container`. Apply `DropShadowFilter` to the Container. PixiJS renders the Container's subtree (including the stencil-masked sprite) to an intermediate `RenderTexture` first; the filter then receives the correctly-shaped alpha and casts the right shadow.
- **Rule**: Any filter that needs to respect a stencil mask (drop shadow, glow, outline) must be placed on a parent Container, not on the masked sprite itself.

## PixiJS Sprite.addChild deprecation (v8)
- `sprite.addChild(graphics)` works in v8 (Sprite extends Container) but logs a deprecation warning: "Only Containers will be allowed to add children in v8.0.0". This will break in v9. Current workaround: accept the warning for now; future fix is to wrap sprite+mask in a parent Container. The mask still moves with the sprite because it is a child.

## PixiJS Texture from Canvas
- **`Texture.from(HTMLCanvasElement)` works in PixiJS v8**: `HTMLCanvasElement` is part of `ImageResource` which is part of `TextureResourceOrOptions`. Pass a canvas element directly — no intermediate `ImageBitmap` or data URL needed. Creates a GPU-backed texture immediately.

## `pixi-filters` exports `SimplexNoiseFilter`, not `NoiseFilter`
- **Symptom**: `error TS2305: Module '"pixi-filters"' has no exported member 'NoiseFilter'`
- **Root cause**: There is no `NoiseFilter` in `pixi-filters` v6. The noise filter is named `SimplexNoiseFilter`. PixiJS v8 core also has no built-in noise filter.
- **Fix**: `import { SimplexNoiseFilter } from 'pixi-filters'`. Constructor option is `strength` (default 0.5), not `noise`.
- **Rule**: Always check `Object.keys(require('pixi-filters'))` or the package `.d.ts` files before importing by assumed name.

## `Uint8Array.buffer` types as `ArrayBufferLike` — `ImageData` rejects it
- **Symptom**: `error TS2769: No overload matches this call` when passing `new Uint8ClampedArray(uint8arr.buffer)` to `new ImageData(...)`.
- **Root cause**: `TypedArray.buffer` is typed as `ArrayBufferLike` in TypeScript's DOM lib, which is a union of `ArrayBuffer | SharedArrayBuffer`. `ImageData`'s constructor only accepts `ArrayBuffer` (not `SharedArrayBuffer`), so the union doesn't satisfy the parameter type.
- **Fix**: Cast to `ArrayBuffer`: `new Uint8ClampedArray(rgba.buffer as ArrayBuffer)`. In practice the buffer is always a regular `ArrayBuffer` from WASM; the cast is safe.

## PixiJS v8: `sortChildren()` not called automatically within the same frame
- **Symptom**: Pieces disappear under other pieces when dragged — they render at their old z-position during the first frame(s) of the drag.
- **Root cause**: The `zIndex` setter correctly sets `parent.sortDirty = true`, but `sortChildren()` is only called lazily during the render pass. If other operations (filter swaps, scale changes) trigger a render before the sort runs, the old z-order is used.
- **Fix**: Call `app.stage.sortChildren()` explicitly after mutating `zIndex` on stage children in the same event handler (pointerdown, pointerup). This forces the sort immediately so the next render uses the correct order.
- **Rule**: After bulk `zIndex` mutation on stage children, always call `stage.sortChildren()` before the handler returns.

## DropShadowFilter `resolution: DPR` causes thin vertical seam on retina displays
- **Symptom**: A thin fixed vertical line appears on the canvas, visible on retina displays (Brave, Safari) but not at DPR=1. The line overlays pieces and moves with the viewport.
- **Root cause**: `DropShadowFilter` with `resolution: window.devicePixelRatio` (e.g. 2) creates internal Kawase blur textures at 2x resolution. A texture boundary/seam artifact appears at a specific x position on retina GPUs (macOS WebGL).
- **Fix**: Use `resolution: 1` for DropShadowFilter. Shadows are intentionally blurry, so 1x resolution has no perceptible quality loss.
- **Rule**: Never use `resolution: DPR` on `DropShadowFilter`. Unlike sprite content, shadow blur does not benefit from retina resolution, and the retina texture sizing causes rendering artifacts.

## Replacing `container.filters` array during drag causes rendering gaps
- **Symptom**: Pieces flicker or momentarily disappear when transitioning between shadow states (resting → dragging → resting).
- **Root cause**: `c.filters = [new DropShadowFilter(...)]` replaces the entire filters array, triggering PixiJS `FilterEffect` teardown/setup. The old filter is destroyed (`FilterEffect.destroy()` calls `filter.destroy()` on each), and a new filter effect is created. During this transition, there can be a rendering gap.
- **Fix**: Keep one persistent `DropShadowFilter` per container and mutate its properties in place (`f.offset`, `f.blur`, `f.alpha`). Never reassign the `filters` array after initial setup.
- **Rule**: For state-driven filter changes (resting/dragging/placed), mutate existing filter properties — never replace the `filters` array.

## Background Graphics rect produces triangle-seam artifacts on retina
- **Symptom**: A thin line artifact on retina displays from a full-screen `Graphics` rect used as background.
- **Root cause**: WebGL renders rectangles as two triangles. On retina displays with `antialias: true`, the diagonal seam between triangles can produce a sub-pixel rendering artifact.
- **Fix**: Use the WebGL clear color (`app.init({ background: '#f5f5f3' })`) instead of a `Graphics` rect. The clear color fills the entire canvas uniformly with no geometry, so no triangle seams.
- **Rule**: For solid-color full-screen backgrounds, always use the WebGL clear color, not a Graphics rect.

## Tray system (Story 32)

### PixiJS Graphics stroke-only path has no hit area
- **Symptom**: Clicking the chevron decoration on the tray strip does nothing; `containsPoint()` always returns false.
- **Root cause**: A `Graphics` object with only `moveTo` / `lineTo` / `stroke()` (no `fill()`) produces no filled geometry. PixiJS hit testing uses the fill bounding area — stroke-only paths have no hittable surface.
- **Fix**: Move the chevron to a purely decorative role. Create a separate transparent `Graphics` fill rect (`_stripHitArea`) that covers the strip and handles open/close toggling. Never rely on stroke-only Graphics for pointer events.
- **Rule**: If a Graphics shape must receive pointer events, it needs a fill (can be `alpha: 0`). Stroke-only Graphics are invisible to the hit system.

### `app.screen.width` lags one frame after window resize
- **Symptom**: Tray background doesn't extend full width in certain fullscreen / resize transitions. Width is correct on the second resize event but not the first.
- **Root cause**: `window.addEventListener('resize')` fires before the PixiJS renderer has processed the new dimensions. `app.screen.width` still holds the previous value at that moment.
- **Fix**: Use `screenW() = Math.max(app.screen.width, window.innerWidth)` — whichever is larger is always the correct target width. Also add a second listener `app.renderer.on('resize', ...)` which fires after the renderer updates `screen.width`. Belt-and-suspenders: whichever fires with accurate dimensions wins.
- **Rule**: Never use `app.screen.width` alone in resize handlers. Use `Math.max(app.screen.width, window.innerWidth)`.

### Tray scale must account for expanded sprite frames (tab padding), not raw piece pixel size
- **Symptom**: Pieces overflow the tray height; pieces are much larger than the tray rows.
- **Root cause**: `_trayScale = rowH / piecePixelH` used the raw grid cell height (e.g. 128px for a 4×4 cut). But sprites have expanded texture frames that include tab padding (`tabPad = Math.ceil(Math.max(pw, ph) * 0.4)` on each side), so the real sprite height is `ph + 2 * tabPad` ≈ 232px. Scale was too large.
- **Fix**: Compute `tabPad = Math.ceil(Math.max(pw, ph) * 0.4)`, `expandedW = pw + 2*tabPad`, `expandedH = ph + 2*tabPad`, then `_trayScale = Math.min(rowH / expandedH, rowH / expandedW, canvasScale)`. Apply the same `expandedW/H` in `layoutTrayPieces()` slot sizing and `hitTestTrayPiece()` half-extents.
- **Rule**: Tray sizing must use expanded frame dimensions (matching `buildGridSprites`), not raw `piecePixelW/H`.

### Drag handoff from tray: pass POINTER world coords to `startDragForPiece`, not sprite center
- **Symptom**: Extracted piece jumps so its center is at the pointer, rather than maintaining the natural grab offset.
- **Root cause**: `extractToCanvas` was passing `spriteWorld.x/y` (the sprite's world position) as the `worldX/Y` argument to `startDragForPiece`. Inside drag.ts, `dragOffset = spritePos - worldX` → `0` → piece center snaps to pointer on next move.
- **Fix**: In `onStagePointerMove`, compute `pointerWorld = _viewport.toLocal(e.global)` and pass `pointerWorld.x/Y` to `extractToCanvas` → `startDragForPiece`. The sprite's own world position is computed separately inside `startDragForPiece`.
- **Rule**: `startDragForPiece(pieceId, pointerId, worldX, worldY)` — the last two args are POINTER world position, never sprite center.

### Container hierarchy must be tracked after adding `_piecesContainer` layer
- **Symptom**: `_trayContainer.removeChild(container)` throws "child not found" after `_piecesContainer` was introduced.
- **Root cause**: Piece containers were added to `_trayContainer` initially but moved to `_piecesContainer` inside `initTray`. Extraction code still called `_trayContainer.removeChild`.
- **Fix**: `(_piecesContainer ?? _trayContainer!).removeChild(container)` everywhere that removes a piece from the tray. Or always use `container.parent.removeChild(container)` to be parent-agnostic.
- **Rule**: Use `container.parent?.removeChild(container)` when the parent container may have changed since initial setup.

## Color Zones (Story 35)

### `Record<TrayFilter, number>` breaks when TrayFilter union is extended
- **Symptom**: TypeScript error — `Record<TrayFilter, number>` required all 9 keys (`all`, `corner`, `edge`, `interior`, `zone-0`…`zone-4`) to be present, but the old `counts` object only initialised 4.
- **Root cause**: A `Record<K, V>` type requires every member of `K` to be present. When `TrayFilter` was extended with 5 zone keys, the `const counts: Record<TrayFilter, number> = { all:0, corner:0, edge:0, interior:0 }` initialiser became incomplete and TypeScript correctly rejected it.
- **Fix**: Replace the single `counts` object with two narrower ones: `const edgeCounts: Record<'all' | 'corner' | 'edge' | 'interior', number>` for edge buttons, and `const zoneCounts: number[]` for the zone swatches. Each typed only for what it actually holds.
- **Rule**: If a `Record<UnionType, V>` exists and the union will grow, either use `Partial<Record<...>>` or split into separate objects typed over each sub-union.

### `preview_eval` variables persist across calls — always use IIFE
- **Symptom**: `SyntaxError: Identifier 'canvas' has already been declared` on the second `preview_eval` call in the same session.
- **Root cause**: `preview_eval` runs in the same JS scope as previous calls. Variables declared with `const`/`let` at the top level collide on re-declaration.
- **Fix**: Always wrap multi-step eval logic in an IIFE: `(() => { const c = ...; return result; })()`. Self-contained scope, no collision.
- **Rule**: Never use bare `const`/`let` at the top level of a `preview_eval` expression. Always IIFE.

### PixiJS canvas hit testing: compute coordinates from actual viewport dimensions, not guesses
- **Symptom**: Dispatching a synthetic `pointerdown` at a hardcoded position (e.g. `{x:630, y:404}`) missed the target PixiJS element entirely. The filter state didn't change.
- **Root cause**: PixiJS element positions are derived from `app.screen.width/height` at runtime. The preview viewport was 554×442, but the hardcoded coordinates assumed a much larger screen.
- **Fix**: Query `window.innerWidth`/`window.innerHeight` in a first `preview_eval` call, then compute the correct screen coordinates from those values before dispatching. For the tray: swatch screen-y = `windowH - TRAY_HEIGHT_OPEN + TRAY_HEIGHT_CLOSED + FILTER_STRIP_HEIGHT/2`.
- **Rule**: Never hardcode PixiJS canvas coordinates for testing. Always derive from `window.innerWidth/Height` in the same or a prior eval.

## Zustand
- Use `getState()` / `setState()` outside React context — never import hooks

## Circular Imports
- **`puzzleStore` ↔ `completion.ts` circular dep**: `puzzleStore.ts` needed `isComplete` from `completion.ts`; `completion.ts` originally imported `usePuzzleStore` for the total piece count. This created a cycle and TypeScript/bundler module resolution fails silently or throws at runtime. Fix: inline the completion check directly in `markGroupPlaced` in the store (it's three lines); remove the `usePuzzleStore` import from `completion.ts`; pass `totalCount` as a parameter to `onComplete` from the call site (`scene.ts`) which already has access to the store. Rule: `store/` files must not import from `puzzle/` or `canvas/` files that themselves import from `store/`.
