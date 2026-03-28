# WASM Pipeline

## Build
```bash
export PATH="$HOME/.cargo/bin:$PATH" && npm run wasm:build
```
Runs: `cd crates/jigg-analysis && wasm-pack build --target web`
Then copies `.js`, `.d.ts`, `.wasm` files from `pkg/` into `src/wasm-pkg/`.

**`wasm-pack` lives in `~/.cargo/bin`** — not on npm script PATH by default. Always prefix or add to system PATH.

**Target must be `--target web`** — generates an ES module importable in module workers.
`--target no-modules` uses `importScripts()` which breaks in Vite's module workers (Vite dev mode always serves `?worker` imports as ES modules regardless of `worker.format`).

## File Locations
- `src/wasm-pkg/` — generated JS glue + TS bindings, copied from `crates/jigg-analysis/pkg/` after build (do not edit)
- `crates/jigg-analysis/` — Rust source
- `public/wasm/` — **no longer used**; wasm-pkg is imported directly as an ES module

## Worker Setup

### Loading WASM in a Worker (current approach — Story 3+)
Import directly from `wasm-pkg`, not from a `public/` path:
```typescript
import init, { analyze_image } from '../wasm-pkg/jigg_analysis.js';

const initPromise = init(); // kick off once at module load

self.addEventListener('message', async (event) => {
  await initPromise; // wait for WASM to be ready
  const { pixels, width, height } = event.data;
  const result = analyze_image(pixels, width, height);
  self.postMessage({ type: 'ANALYSIS_COMPLETE', payload: { ...result } }, [...transfers]);
});
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
worker.postMessage({ pixels, width, height }, [pixels.buffer]);
```

## Message Protocol

### scene.ts → worker
```typescript
{ pixels: Uint8Array, width: number, height: number }
// Transfer pixels.buffer to avoid copy
```

### worker → scene.ts
```typescript
WorkerMessage<{ edgeMap: Uint8Array; width: number; height: number }>
// type: 'ANALYSIS_COMPLETE'
// Transfer edgeMap.buffer to avoid copy
```

## Edge Map → PixiJS Overlay (scene.ts)
```typescript
// Build RGBA: edge pixels → cyan, non-edge → transparent
const rgba = new Uint8ClampedArray(width * height * 4);
for (let i = 0; i < width * height; i++) {
  if (edgeMap[i] === 255) {
    rgba[i * 4 + 1] = 255; // G
    rgba[i * 4 + 2] = 255; // B
    rgba[i * 4 + 3] = 255; // A
  }
}
const canvas = document.createElement('canvas');
canvas.width = width; canvas.height = height;
canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
const texture = Texture.from(canvas); // HTMLCanvasElement works directly in PixiJS v8
const overlay = new Sprite(texture);
overlay.scale.set(scale);
overlay.position.set(boardLeft, boardTop);
overlay.alpha = 0.6;
overlay.visible = false; // toggled with E key
app.stage.addChild(overlay);
```

## Canny Edge Detection (lib.rs)

### Pipeline
1. RGBA → greyscale: `grey = 0.299r + 0.587g + 0.114b`
2. 5×5 Gaussian blur, sigma=1.4 (normalised at runtime)
3. Sobel operator: Gx/Gy kernels, `magnitude = sqrt(Gx²+Gy²)`
4. Non-maximum suppression: thin edges to 1px using gradient direction quantised to 4 angles (0°/45°/90°/135°)
5. Double threshold: `high = 0.15 × max_magnitude`, `low = 0.05 × max_magnitude`
6. Hysteresis BFS: seed queue with strong pixels, promote weak neighbours transitively

### Return type
`Vec<u8>` — wasm-bindgen maps to `Uint8Array` on the JS side. Same WxH as input, `255` = edge, `0` = non-edge.

## tsconfig Gotchas
- `skipLibCheck: true` required — avoids errors from Vite's internal Node.js type definitions
- `/// <reference types="vite/client" />` must live in `src/main.ts`, NOT in tsconfig `types` array — putting it in tsconfig pulls in Vite's Node.js types and causes errors
- tsconfig `lib`: `["ES2022", "DOM", "DOM.Iterable"]` — no "WebWorker" since workers are excluded
