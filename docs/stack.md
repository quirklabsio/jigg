# Stack

## Installed and in use
- **Vite + TypeScript** — no UI framework
- **PixiJS v8** — WebGL2 renderer, owns all canvas rendering
- **Rust → WASM** via wasm-pack — image analysis, edge detection, cut generation
- **Web Workers** — all CPU-heavy work runs off main thread
- **Zustand** — state management, used outside React

## Planned (not yet installed)
- **Dexie.js** — IndexedDB wrapper for per-piece persistence (Stories 27–29)
- **GSAP** — completion sequence animation only (Story 30)
- **ONNX Runtime Web** — quantized segmentation model for semantic clustering (v2)

## Rationale

| Decision | Reason |
|----------|--------|
| PixiJS over Canvas 2D | Performance ceiling with 200 pieces, shadows, shaders |
| PixiJS over Three.js/Babylon | Full 3D overkill for pseudo-3D effects |
| Zustand over Redux | Outside-React access pattern is hard requirement |
| Rust/WASM over OpenCV.js | OpenCV.js bundle 7MB+; we only need edge detection |
| No accounts | IndexedDB is intentional persistence; cross-device sync is v2 |
| No backend | Fully client-side is architecturally honest for no-account promise |
| GSAP isolated to completion | PixiJS Ticker handles game loop |
