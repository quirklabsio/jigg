# Gotchas

## WASM
- WASM must be initialized async before any function calls
- wasm-pack target must be `--target web` — generates ES module importable in module workers; `--target no-modules` uses `importScripts()` which breaks in Vite's module workers (Vite dev mode always serves `?worker` imports as module workers)
- WASM loaded in workers via dynamic import with vite-ignore: `import(/* @vite-ignore */ '/wasm/jigg_analysis.js')` — Vite skips bundling the static public asset. Do not use `importScripts()`
- `vite.config.ts` `worker.format: 'iife'` was explored in Story 1 then removed in Story 3 — only applies to production builds, not Vite dev mode. Do not re-add it

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

## Pixel Extraction
- OffscreenCanvas used for pixel extraction in scene.ts: `texture.source.resource as CanvasImageSource` draws onto `OffscreenCanvas` 2d context; use `new Uint8Array(imageData.data.buffer)` to convert `Uint8ClampedArray` → `Uint8Array` for postMessage to worker

## Zustand
- Use `getState()` / `setState()` outside React context — never import hooks
