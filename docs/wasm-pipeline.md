# WASM Pipeline

## Build
```bash
npm run wasm:build
```
Runs: `cd crates/jigg-analysis && wasm-pack build --target web`
Then copies `.js`, `.d.ts`, `.wasm` files from `pkg/` into `src/wasm-pkg/`.

**Target must be `--target web`** — generates an ES module importable in module workers.
`--target no-modules` uses `importScripts()` which breaks in Vite's module workers (Vite dev mode always serves `?worker` imports as ES modules regardless of `worker.format`).

## File Locations
- `public/wasm/` — static WASM assets served directly, not bundled by Vite
- `src/wasm-pkg/` — generated TS bindings, imported by worker (do not edit)
- `crates/jigg-analysis/` — Rust source

## Worker Setup

### Loading WASM in a Worker
```typescript
// Use dynamic import with @vite-ignore so Vite skips bundling the public asset
const wasm = await import(/* @vite-ignore */ '/wasm/jigg_analysis.js');
await wasm.default(); // init — must complete before calling any exported fn
```

### Worker File Header
Worker files must have these triple-slash references at the top to get clean WebWorker types without DOM conflicts:
```typescript
/// <reference no-default-lib="true"/>
/// <reference lib="ESNext" />
/// <reference lib="WebWorker" />
```

### tsconfig Exclusion
`src/workers/` is excluded from the main tsconfig compilation (`"exclude": ["src/workers"]`).
The `/// <reference no-default-lib="true"/>` in worker files would strip DOM types from the entire compilation if included. Workers are still compiled by Vite at runtime; exclusion only affects `tsc --noEmit`.

## Pixel Extraction (scene.ts → worker)
```typescript
// Draw PixiJS texture onto OffscreenCanvas to get pixel data
const offscreen = new OffscreenCanvas(width, height);
const ctx = offscreen.getContext('2d')!;
ctx.drawImage(texture.source.resource as CanvasImageSource, 0, 0);
const imageData = ctx.getImageData(0, 0, width, height);
// Convert Uint8ClampedArray → Uint8Array for postMessage
const pixels = new Uint8Array(imageData.data.buffer);
worker.postMessage({ type: 'ANALYZE_IMAGE', payload: { pixels, width, height } });
```

## tsconfig Gotchas
- `skipLibCheck: true` required — avoids errors from Vite's internal Node.js type definitions
- `/// <reference types="vite/client" />` must live in `src/main.ts`, NOT in tsconfig `types` array — putting it in tsconfig pulls in Vite's Node.js types and causes errors
- tsconfig `lib`: `["ES2022", "DOM", "DOM.Iterable"]` — no "WebWorker" since workers are excluded

## Crate
- `crates/jigg-analysis/` — Rust crate using `wasm-bindgen`
- Currently: `analyze_image(pixels: &[u8], width: u32, height: u32) -> JsValue`
- Planned: edge detection, Bezier cut generation, content-aware routing (Stories 13–15)
