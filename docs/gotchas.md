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

## `BevelFilter` has no `.contrast` property
- **Symptom**: `error TS2339: Property 'contrast' does not exist on type 'BevelFilter'`. Spec pseudocode used `f.contrast = value` but pixi-filters v6 BevelFilter exposes no contrast uniform.
- **Root cause**: `BevelFilter` in pixi-filters v6 has `lightAlpha`, `shadowAlpha`, `thickness`, and `rotation` — no aggregate `contrast` property.
- **Fix**: Simulate contrast by scaling `lightAlpha` and `shadowAlpha`. If the spec ratio is `BEVEL_CONTRAST_HIGH / BEVEL_CONTRAST_DEFAULT = 1.8`, multiply the base alpha values (0.2) by 1.8: `f.lightAlpha = 0.36; f.shadowAlpha = 0.36`. Tunable via named constants.
- **Rule**: Always check `BevelFilter.d.ts` before assuming contrast/brightness convenience properties exist.

## `DropShadowFilter` at `offset:{x:0,y:0}` with `blur:0` is invisible
- **Symptom**: No visible edge outline appears on sprites when using DropShadowFilter as a stroke effect with zero offset and zero blur.
- **Root cause**: A drop shadow with `offset:{x:0,y:0}` and `blur:0` renders an exact alpha-shape copy of the sprite directly behind it — identical position and shape. The original sprite sits on top, completely obscuring the shadow.
- **Fix**: Use `OutlineFilter` from `pixi-filters` instead. `OutlineFilter` is purpose-built for edge strokes and actually follows the sprite's alpha mask, rendering a visible ring around the shape boundary. `new OutlineFilter({ thickness: 2, color: 0xffffff, alpha: 1, quality: 0.15 })` attached to `sprite.filters`.
- **Rule**: For outline/edge-stroke effects on sprites, use `OutlineFilter`, not `DropShadowFilter`. DSF is for offset drop shadows only.

## `ColorMatrixFilter` is in `pixi.js` core, not `pixi-filters`
- **Symptom**: If imported from `pixi-filters`, module not found. The filter is part of the PixiJS core bundle.
- **Fix**: `import { ColorMatrixFilter } from 'pixi.js'`. The `.matrix` setter accepts `ColorMatrix = ArrayFixed<number, 20>`; a plain `number[]` requires a type cast: `matrix.matrix = MY_ARRAY as ColorMatrix`.
- **Convenience methods**: `ColorMatrixFilter` has built-in methods — `.greyscale(scale, multiply)`, `.desaturate()`, `.contrast(amount, multiply)` etc. Using `matrix.desaturate()` is cleaner than manually setting the 20-element matrix, but the raw matrix approach works and is explicit.

## `Piece` type has no `.sprite` field
- **Symptom**: Code or spec pseudocode referencing `piece.sprite` fails — `Property 'sprite' does not exist on type 'Piece'`.
- **Root cause**: `Piece` is a pure data model (in `puzzle/types.ts`). Sprites live in `spriteMap: Map<string, Sprite>` owned by `scene.ts`. They are separate concerns.
- **Fix**: Any function that needs to apply a visual effect per-piece must accept `spriteMap: Map<string, Sprite>` as a parameter and look up sprites with `spriteMap.get(piece.id)`. Guard the result: `if (!sprite) return`.
- **Rule**: `Piece` is never augmented with a sprite reference. The spriteMap is the join table.

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

### `getState()` inside a `set` updater returns stale state
- **Symptom**: UI callback fired from inside `set(updaterFn)` reads the old value — e.g. `syncBgPresetUI()` calling `getState().backgroundPreset` returned the pre-toggle value, so the active button highlight was always one step behind.
- **Root cause**: Zustand's `set(fn)` calls `fn(currentState)` to compute the patch, then commits the result. Any `getState()` call made while inside `fn` still returns the pre-commit state, because the state variable hasn't been reassigned yet.
- **Fix**: Move callbacks that read store state OUTSIDE the `set` call. Build `newPrefs` inside the updater (it has access to `state`), call `savePreferences(newPrefs)` there, but call `fireApplyPreferences(newPrefs)` after `set` returns. Since Zustand's `set` is synchronous, the state is committed by the time the next line executes.
  ```typescript
  setPreference: (key, value) => {
    let newPrefs!: Preferences;
    set((state) => {
      newPrefs = { ...state, [key]: value };
      savePreferences(newPrefs);
      return { [key]: value };
    });
    fireApplyPreferences(newPrefs); // after set — getState() now returns new state
  },
  ```
- **Rule**: Never call functions that read `getState()` from inside a Zustand `set` updater callback.

## Piece label counter-rotation: two separate failure modes

### Labels rotate with piece on canvas
- **Symptom**: After toggling piece labels off and back on while pieces are rotated on the canvas, numbers appear tilted — they rotate with the sprite.
- **Root cause**: Labels are `Container` children of sprites. PixiJS applies the parent's transform (including rotation) to all children. `applyPieceLabels` counter-rotated tray pieces (`-(actual.rotation * PI)/180`) but set canvas piece labels to `rotation = 0`. Once the sprite rotates (via `rotateGroup` or `tweenRotation`), the label rotates with it and nobody updates it back.
- **Fix — creation**: In `applyPieceLabels` add `else { label.rotation = -sprite.rotation; }` for non-tray pieces so newly created labels start upright regardless of current sprite rotation.
- **Fix — ongoing**: Export `syncLabelRotation(sprite)` from `preferences.ts`. Call it in `rotate.ts` after `sprite.rotation = piece.actual.rotation` and inside the `tweenRotation` ticker in `drag.ts` after `s.rotation = rot`. This keeps labels upright through both snap-rotate and drag-lift tween paths.
- **Fix — extraction**: `tray.ts` extraction paths had `label.rotation = 0; label.scale.set(1)` to kill tray counter-rotation. The `0` is wrong if the sprite already has a canvas rotation. Change to `label.rotation = -sprite.rotation`.
- **Rule**: Labels are children of sprites; they inherit the sprite's rotation. Every code path that mutates `sprite.rotation` must follow with `syncLabelRotation(sprite)`. The invariant is always `label.rotation === -sprite.rotation`.

## Keyboard / Focus (Story 40)

### `syncButtonDOMOrder` (appendChild) silently blurs the focused bench button

- **Symptom**: After a filter change, `document.activeElement` is `document.body`, not the bench button that was focused before the filter. Focus seems to "fall off" during cycling.
- **Root cause**: `syncButtonDOMOrder` reorders bench buttons by calling `_landmarkBench.appendChild(btn)` for each button. `appendChild` on a currently-focused element fires a `blur` event and moves `document.activeElement` to `document.body`. By the time `handleFilterChangeFocus` (or any caller) reads `document.activeElement`, it is stale.
- **Fix**: Track the focused piece ID in a module-level variable (`_trackedPieceId` in `aria.ts`) that is set on `focus` and explicitly **not** cleared on `blur`. Use this for focus-restore decisions, not `document.activeElement`. Only clear it on explicit actions (extraction, placement, `initLandmarks` reset).
- **Rule**: Never rely on `document.activeElement` for focus decisions made _after_ any call to `layoutTrayPieces` or `syncButtonDOMOrder`. Read the persisted variable before the layout runs.

---

### `element.focus()` in an unfocused tab changes `document.activeElement` but does not fire the `focus` event

- **Symptom**: `preview_eval` tests of keyboard focus appear broken — `document.activeElement` shows the expected element but focus event handlers (and anything they set, such as `_trackedPieceId`) never fire.
- **Root cause**: Browsers suppress focus events when the window/tab does not have user focus. `element.focus()` still moves `document.activeElement` (so tab-order works for AT), but the `focus` DOM event is withheld. This is standard cross-browser behaviour.
- **Rule**: Do not use `preview_eval` to test code paths that depend on `focus` events firing (e.g. `_trackedPieceId` tracking, `scrollBenchToId`, `setFocusedPiece`). These only work in real interaction with the window active. `document.activeElement` checks are reliable; event-based side-effects are not.

---

### `window.dispatchEvent(new KeyboardEvent(...))` does not trigger `document` capture-phase listeners

- **Symptom**: Tests dispatching keydown on `window` don't set `_lastInputWasKeyboard = true`, so the focus ring never draws in eval tests.
- **Root cause**: The capture-phase listener `document.addEventListener('keydown', ..., { capture: true })` is on `document`, not `window`. Events dispatched on `window` via `window.dispatchEvent` originate at `window` and never flow _through_ `document` in the capture phase — the document capture listener is skipped entirely.
- **Fix** (test only): Accept that `_lastInputWasKeyboard` cannot be set via `window.dispatchEvent`. If testing ring visibility is required, click on the page first (to give window focus) and use real user keypresses, or inject `_lastInputWasKeyboard = true` via a temporary debug export.
- **Rule**: `window.dispatchEvent` bypasses document capture listeners. Use `document.dispatchEvent` or an element's `dispatchEvent` if capture handlers must fire.

## Tool Invocation / Claude Agent SDK

### Typed tool parameters fail if the tool schema is not in context — load with `ToolSearch` first
- **Symptom**: `InputValidationError: TodoWrite failed — parameter 'todos' expected as array but provided as string`. The tool call looks correct in the source but the runtime rejects the parameter type.
- **Root cause**: Some tools (e.g. `TodoWrite`) are deferred — their schemas are not included in the initial prompt context. Without the schema, typed parameters (arrays, numbers, booleans) are serialised as plain strings. The client-side validator then rejects the mismatch.
- **Fix**: Call `ToolSearch` with `query: "select:TodoWrite"` (substituting the target tool name) before invoking the tool. Once `ToolSearch` returns the schema in a `<functions>` block, the tool can be called with correctly-typed parameters.
- **Rule**: If any tool call fails with `InputValidationError` citing an unexpected string type, the tool's schema is missing from context. Use `ToolSearch` to load it, then retry the call.

## pixi-viewport: decelerate plugin `.friction` not on the `Plugin` type — cast to `any`
- **Symptom**: TypeScript would reject `viewport.plugins.get('decelerate').friction = value` — `friction` does not exist on type `Plugin`.
- **Root cause**: `Plugins.get(name)` returns the `Plugin` base class type. `DeceleratePlugin` extends `Plugin` and adds `.friction` at runtime, but the narrowed return type doesn't know which plugin subtype was retrieved.
- **Fix**: Cast the result: `(viewport.plugins.get('decelerate') as any).friction = value`. The property exists at runtime; the cast is safe.
- **Rule**: pixi-viewport plugin-specific properties always require `as any` or a manual cast when accessed via `plugins.get()`.

## PixiJS Graphics: active ring radius must track the fill radius, not a hardcoded constant
- **Symptom**: After scaling the active swatch fill from radius 10 to 13, the non-HC active ring (previously `SWATCH_RADIUS + 3 = 13`) sat exactly at the fill edge — visually the ring merged with or disappeared behind the fill.
- **Root cause**: The ring radius was hardcoded as `SWATCH_RADIUS + 3` — a constant. When `drawRadius` was made dynamic (10 inactive, 13 active), the ring didn't follow.
- **Fix**: Use `drawRadius + 3` instead of `SWATCH_RADIUS + 3` for the ring so it always sits 3 px outside the current fill radius, regardless of active state.
- **Rule**: Any decorative ring that must appear outside a fill circle should be expressed as `fillRadius + gap`, not as a constant, when the fill radius can change.

## TypeScript path alias: `paths` without `baseUrl` silently fails to resolve

- **Symptom**: `error TS2307: Cannot find module '@jigg/spec'` even though the `paths` entry is in tsconfig.
- **Root cause**: TypeScript `paths` are relative to `baseUrl`. Without `"baseUrl": "."`, the resolver has no anchor directory and the alias is never matched.
- **Fix**: Add `"baseUrl": "."` alongside `"paths"` in `compilerOptions`. Both must be present:
  ```json
  "baseUrl": ".",
  "paths": { "@jigg/spec": ["./jigg-spec/types.ts"] }
  ```
- **Rule**: `paths` without `baseUrl` = broken alias. Always add `"baseUrl": "."` when introducing `paths`.

## Unresolved import produces `any` — cascades into unrelated files

- **Symptom**: `error TS7053: Element implicitly has an 'any' type because expression of type 'EdgeType' can't be used to index type 'Record<"corner"|"edge"|"interior"|"all", number>'` in a file that was never touched.
- **Root cause**: `EdgeType` was imported from `@jigg/spec` which couldn't be resolved. TypeScript fell back to `any` for the entire import. `record[anyValue]++` is rejected by strict mode (TS7053).
- **Fix**: Fix the broken import first. Once `@jigg/spec` resolves correctly, `EdgeType` is a proper `'corner' | 'edge' | 'interior'` union and the indexing error disappears.
- **Rule**: A TS7053 "can't be used to index" error in a file you didn't touch almost always means a type upstream resolved to `any` due to a broken import or missing path alias.

## `vite.config.ts` in tsconfig `include` without `@types/node`

- **Symptom**: `error TS2307: Cannot find module 'path'` / `Cannot find module 'url'` when `vite.config.ts` uses `import path from 'path'` and `import { fileURLToPath } from 'url'`.
- **Root cause**: `path` and `url` are Node.js built-ins. Without `@types/node` installed, TypeScript has no declarations for them. The standard tsconfig for a browser app (no `@types/node`) will always fail.
- **Fix**: Install `@types/node` as a devDependency (`npm install --save-dev @types/node`) then use `path.resolve`:
  ```ts
  import path from 'path'
  // ...
  '@jigg-spec': path.resolve(__dirname, './jigg-spec')
  ```
  `skipLibCheck: true` in tsconfig prevents `@types/node` from polluting browser source type checking.
- **Rule**: `import path from 'path'` in `vite.config.ts` requires `@types/node` as a devDependency. Add it — `skipLibCheck` keeps it safe. The earlier workaround using `new URL(..., import.meta.url).pathname` works but is less readable and doesn't support `__dirname`-style directory resolution.

## Circular Imports
- **`puzzleStore` ↔ `completion.ts` circular dep**: `puzzleStore.ts` needed `isComplete` from `completion.ts`; `completion.ts` originally imported `usePuzzleStore` for the total piece count. This created a cycle and TypeScript/bundler module resolution fails silently or throws at runtime. Fix: inline the completion check directly in `markGroupPlaced` in the store (it's three lines); remove the `usePuzzleStore` import from `completion.ts`; pass `totalCount` as a parameter to `onComplete` from the call site (`scene.ts`) which already has access to the store. Rule: `store/` files must not import from `puzzle/` or `canvas/` files that themselves import from `store/`.

## replace_all prefix misses
- **`replace_all` only matches the exact string.** In a file with `piece.actual.x`, `anchorPiece.actual.x`, and `p.actual.x`, replacing `piece.actual.x` leaves the other two untouched. After any bulk rename, grep for the old field name (`\.actual\.`, `\.groupId`, etc.) to confirm zero remaining occurrences before running typecheck.

## `inert=false` does NOT mean "blocked" — it means "accessible"

- **Symptom**: After implementing `inert`-based keyboard mode switching, the initial state `bench.inert = false` looked wrong — as if the bench was not inert (not blocked), implying something was broken.
- **Root cause**: Misreading of the `inert` attribute semantics. `inert=false` (or absent) means the element IS accessible, IS in tab order, IS interactive. `inert=true` means the element is blocked/hidden from keyboard and AT. The initial bench-mode state correctly has `bench.inert = false` (bench is active) and `table.inert = true` (table is blocked).
- **Rule**: `inert=true` = blocked. `inert=false` = accessible. Active landmark has `inert=false`, inactive landmark has `inert=true`.

## Redundant `_collapsed || mode !== 'x'` in `inert` derivation

- **Symptom**: spec wrote `benchLandmark.inert = _benchCollapsed || mode !== 'bench'` to permanently inert the bench after collapse. This compiles and runs correctly, but the `_benchCollapsed ||` part is dead code.
- **Root cause**: Once `_benchCollapsed = true`, `setKeyboardMode('table')` is called immediately. This makes `_keyboardMode === 'table'` permanent. `mode !== 'bench'` is therefore always `true` — `_benchCollapsed ||` adds nothing.
- **Fix**: `benchLandmark.inert = mode !== 'bench'`. Symmetric with `tableLandmark.inert = mode !== 'table'`. `_benchCollapsed` is still needed as a T key guard (prevents switching back to bench mode), but plays no role in `inert` derivation.
- **Rule**: Derive `inert` only from the active `mode` variable. Collapsed/permanent state is enforced by preventing mode transitions, not by injecting extra conditions into the inert formula.

## Splitting `t`/`T` by case for different key behaviours silently broke existing UX

- **Symptom**: After assigning keyboard mode switching to uppercase `T` (Shift+T) and tray toggle to lowercase `t`, user reported "t is no longer working to collapse/expand bench". Then when both `t` and `T` were made to do mode switching only, tray open/close broke entirely.
- **Root cause**: `e.key === 'T'` requires Shift on a QWERTY keyboard. Users pressing the physical T key (no Shift) produce `e.key === 't'`. Assigning different behaviours to the two cases is effectively invisible — the user just sees "T broke".
- **Fix**: Keep `t`/`T` (both cases) for the same action — tray open/close. Call `setKeyboardMode('bench')` when opening, `setKeyboardMode('table')` when closing. Symmetric coupling: open tray = bench active, close tray = table active. "Close deferred to Story 42" was tried first but left `table.inert` permanently true — fixed by adding the close branch immediately.
- **Rule**: Do not split `e.key === 't'` and `e.key === 'T'` for semantically different actions. They correspond to the same physical key; users have no reliable way to know which case applies.

## `table.inert` permanently true — second landmark never activated

- **Symptom**: `document.getElementById('landmark-table').inert` stays `true` regardless of user actions. Console audit check "table.inert false ✓" never passes.
- **Root cause**: `setKeyboardMode('bench')` was called on tray open, but nothing called `setKeyboardMode('table')` on tray close. The "close deferred to Story 42" approach left one half of the symmetric model unimplemented.
- **Fix**: Add `setKeyboardMode('table')` in the tray-close branch of the T key handler. The inert model must be symmetric — every code path that enters bench mode must have a corresponding path that exits it.
- **Rule**: For any `inert`-based two-landmark model, every entry point for mode A must have a corresponding exit point (entry for mode B). Never implement one side without the other.

## Mode switch wired only to T key handler — click path silently bypassed

- **Symptom**: Pressing `T` to close the bench correctly sets `table.inert=false`. Clicking the PixiJS bench strip or the DOM strip handle button to close the bench does NOT — `table.inert` stays `true`.
- **Root cause**: `setKeyboardMode('table')` was called inside the T key `keydown` handler in `scene.ts`. The PixiJS `_stripHitArea.on('pointerdown')` and DOM `_benchStripHandle.addEventListener('click')` both call bench.ts's `setTrayOpen` directly, which mutates the Zustand store but never reaches the T key handler in `scene.ts`.
- **Fix**: Move `setKeyboardMode` out of the T key handler and into a `usePuzzleStore.subscribe` callback watching `trayOpen`. The subscriber fires synchronously for any `trayOpen` mutation regardless of origin. T key handler becomes `setTrayOpen(!isOpen); return;` — one line.
  ```typescript
  usePuzzleStore.subscribe((state, prev) => {
    if (state.trayOpen !== prev.trayOpen) {
      if (state.trayOpen) { if (!_benchCollapsed) setKeyboardMode('bench'); }
      else { setKeyboardMode('table'); }
    }
  });
  ```
- **Rule**: When a side-effect must fire on a state change, subscribe to the state — never couple it to one specific input path. Any future code that changes `trayOpen` will then automatically trigger the mode switch.

## Browser extension interference with keyboard tab order

Symptom: First Tab press lands on an invisible element, focus ring never appears, `document.activeElement.getAttribute('aria-label')` returns null.

Cause: Browser extensions (password managers, ad blockers, dev tools) inject focusable `<div>` elements into the page before bench buttons in DOM order.

Diagnosis: Check `document.activeElement.id` after Tab — if it's something like `jsExtensionMenuParent` it's an extension, not app code.

Confirm: Test in incognito (extensions disabled). If keyboard nav works correctly there, the extension is the culprit.

Fix: `guardFocusWithinApp()` in `scene.ts` listens for `focusin` and redirects to `#landmark-bench button[tabindex="0"]` whenever focus lands outside owned regions. Works against late-injected elements too (unlike a one-shot silencing pass). Add new legitimate focusable regions to the `isOurs` check as the app grows.

