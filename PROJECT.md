# Jigg — Browser Jigsaw Puzzle

A client-side, no-account, no-ad jigsaw puzzle app with content-aware cutting,
infinite canvas, and a satisfying completion sequence.

---

## Stack
- **Vite + TypeScript** — no UI framework
- **PixiJS v8** — WebGL2 renderer, owns all canvas rendering
- **Rust → WASM** via wasm-pack — image analysis, edge detection, cut generation
- **Web Workers** — all CPU-heavy work runs off main thread
- **Zustand** — state management, used outside React
- **Dexie.js** — IndexedDB wrapper for per-piece persistence
- **GSAP** — completion sequence animation only
- **ONNX Runtime Web** — quantized segmentation model for semantic clustering (v2)

---

## Folder Structure
```
src/
  canvas/        # PixiJS setup, scene management, render loop
  puzzle/        # piece logic, cutting, snap, stacking
  workers/       # Web Worker entry points
  store/         # Zustand stores
  db/            # Dexie schema and queries
  shaders/       # GLSL fragment and vertex shaders
  ui/            # toolbar, panels (plain TS, no framework)
crates/
  jigg-analysis/ # Rust WASM crate (edge detection, Bezier cut generation)
public/
stories/         # agent story files
```

---

## Core Types
`src/puzzle/types.ts` is the source of truth for all shared types. Do not
redefine these elsewhere.

```typescript
interface Piece {
  id: string;
  textureRegion: { x: number; y: number; w: number; h: number };
  position: { x: number; y: number };
  rotation: number;
  placed: boolean;
  touched: boolean;
  stackIndex: number;
}

interface PuzzleConfig {
  imageUrl: string;
  pieceCount: number;          // 12–200
  surface: 'matte' | 'glossy' | 'canvas' | 'wood';
  lightAngle: number;          // degrees
}

interface EdgeMap {
  data: Float32Array;
  width: number;
  height: number;
}

type WorkerMessageType =
  | 'ANALYZE_IMAGE'
  | 'ANALYSIS_COMPLETE'
  | 'ERROR';

interface WorkerMessage<T = unknown> {
  type: WorkerMessageType;
  payload: T;
}
```

---

## Architecture Principles
- PixiJS owns the canvas — never use DOM elements for puzzle pieces
- State lives in Zustand, PixiJS reads it imperatively via `getState()`
- All CPU-heavy work (image analysis, k-means clustering) runs in Web Workers
- WASM communicates via `postMessage` only — no shared state
- Dexie writes are always debounced 500ms via the persistence bridge
- The persistence bridge subscribes to Zustand and writes to Dexie — nothing else writes to Dexie directly

---

## Conventions
- Strict TypeScript, no `any`
- Web Workers use typed `WorkerMessage` enums for all communication
- Zustand stores: `usePuzzleStore`, `useWorkspaceStore`, `useUIStore`
- GLSL shaders live in `.frag` / `.vert` files, imported as strings via Vite
- Worker files use the `?worker` Vite suffix on import
- File names: `camelCase.ts` for modules, `PascalCase.ts` for class-like constructs

---

## Explicitly Out of Scope
- No React, Vue, Svelte, or any component framework — no JSX ever
- No backend, no API calls, no user accounts
- No CSS frameworks
- No Canvas 2D — PixiJS/WebGL only
- No localStorage for puzzle state — IndexedDB only
- No multiplayer, no puzzle sharing (yet)

---

## Commands
```bash
npm run dev                                              # dev server
npm run build                                            # production build
npm run typecheck                                        # tsc --noEmit
cd crates/jigg-analysis && wasm-pack build --target no-modules  # build WASM
```

Claude should run `npm run typecheck` after every story to verify no type errors.

---

## Known Gotchas
- WASM must be initialized async before any function calls
- PixiJS v8 API differs significantly from v4/v5 — do not reference legacy docs or examples
- Vite requires `?worker` suffix for Web Worker imports: `import Worker from './workers/analysis.worker.ts?worker'`
- wasm-pack target must be `--target no-modules` for Web Worker context, not `--target web`
- Zustand: use `getState()` / `setState()` outside of any React context — never import hooks
- PixiJS Sprite textures must be created from the shared renderer, not instantiated directly

---

## Decisions (don't revisit without asking)
- **PixiJS over Canvas 2D** — performance ceiling with 200 pieces, shadows, and shaders
- **PixiJS over Three.js / Babylon.js** — full 3D engines are overkill for pseudo-3D effects
- **Zustand over Redux** — outside-React access pattern is a hard requirement
- **Rust/WASM over OpenCV.js** — bundle size (7MB+) and we only need edge detection
- **No accounts** — IndexedDB is the intentional persistence layer, cross-device sync is v2
- **No backend** — fully client-side is architecturally honest for the no-account promise
- **GSAP isolated to completion sequence** — PixiJS Ticker handles the game loop

---

## Stories

### Epic: Core Pipeline (de-risk first)
- [x] Story 1: WASM pipeline proof of life
- [x] Story 2: PixiJS canvas init + image load
- [ ] Story 3: Connect WASM output to PixiJS canvas

### Epic: Core Puzzle Loop
- [ ] Story 4: Grid cut — divide image into NxN sprites
- [ ] Story 5: Scatter pieces on load
- [ ] Story 6: Drag and drop a piece
- [ ] Story 7: Snap piece to correct position
- [ ] Story 8: Detect puzzle completion

### Epic: Smart Cutting
- [ ] Story 9: Edge detection in WASM → visualize overlay
- [ ] Story 10: Bezier cut generation from edge map
- [ ] Story 11: Content-aware cut routing (follows contours)

### Epic: Piece Fidelity
- [ ] Story 12: Bevel shader on cut edges
- [ ] Story 13: Surface texture variants (matte/glossy/canvas/wood)
- [ ] Story 14: Soft shadows relative to light source
- [ ] Story 15: Realistic stacking z-order

### Epic: Workspace
- [ ] Story 16: Infinite canvas + zoom with inertia
- [ ] Story 17: Pan with momentum
- [ ] Story 18: Zoom-locked reference image panel
- [ ] Story 19: Ghost image underlay with opacity control

### Epic: Sorting Tools
- [ ] Story 20: Edge piece detection + filter
- [ ] Story 21: Color clustering (k-means in worker)
- [ ] Story 22: Touched-but-unplaced dot marker

### Epic: Persistence
- [ ] Story 23: Save piece state to IndexedDB via Dexie
- [ ] Story 24: Restore full puzzle state on load
- [ ] Story 25: Export completed image as download

### Epic: Completion Sequence
- [ ] Story 26: GSAP timeline — pull-back, sharpen, fuse, glow

---

## Current Session
Working on: Story 3 — Connect WASM output to PixiJS canvas
Last completed: Story 2 — PixiJS canvas init + image load
Known issues: —
Next after this: Story 4 — Grid cut (divide image into NxN sprites)