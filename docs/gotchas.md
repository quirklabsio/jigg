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

## PixiJS Sprite.addChild deprecation (v8)
- `sprite.addChild(graphics)` works in v8 (Sprite extends Container) but logs a deprecation warning: "Only Containers will be allowed to add children in v8.0.0". This will break in v9. Current workaround: accept the warning for now; future fix is to wrap sprite+mask in a parent Container. The mask still moves with the sprite because it is a child.

## PixiJS Texture from Canvas
- **`Texture.from(HTMLCanvasElement)` works in PixiJS v8**: `HTMLCanvasElement` is part of `ImageResource` which is part of `TextureResourceOrOptions`. Pass a canvas element directly — no intermediate `ImageBitmap` or data URL needed. Creates a GPU-backed texture immediately.

## Zustand
- Use `getState()` / `setState()` outside React context — never import hooks

## Circular Imports
- **`puzzleStore` ↔ `completion.ts` circular dep**: `puzzleStore.ts` needed `isComplete` from `completion.ts`; `completion.ts` originally imported `usePuzzleStore` for the total piece count. This created a cycle and TypeScript/bundler module resolution fails silently or throws at runtime. Fix: inline the completion check directly in `markGroupPlaced` in the store (it's three lines); remove the `usePuzzleStore` import from `completion.ts`; pass `totalCount` as a parameter to `onComplete` from the call site (`scene.ts`) which already has access to the store. Rule: `store/` files must not import from `puzzle/` or `canvas/` files that themselves import from `store/`.
