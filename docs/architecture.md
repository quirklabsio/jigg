# Architecture

## Principles

### Implemented
- PixiJS owns the canvas — never use DOM elements for puzzle pieces or in-puzzle UI
- State lives in Zustand, PixiJS reads it imperatively via `getState()`
- All CPU-heavy work runs in Web Workers; WASM communicates via `postMessage` only — no shared state
- All piece positions are stored in world space, never screen space
- Correct positions are set once on puzzle creation and never mutate
- Drag moves the group, not the individual piece — a single piece is a group of one
- Sprites are permanently `eventMode='none'`; a single transparent hit layer (`Graphics`) over the stage handles all pointer events — no per-sprite toggling
- Spatial hash maps screen cells to group IDs for O(1) pointer-to-group lookup on pointerdown
- Z-index uses a monotonic `settleCounter` — each drop gets a unique value so most-recently-placed group always renders on top
- `activePointerId` pointer lock prevents two groups from being dragged simultaneously
- `store/` files must not import from `puzzle/` or `canvas/` files that themselves import from `store/` — prevents circular deps

### Planned (not yet implemented)
- Dexie writes debounced 500ms via persistence bridge that subscribes to Zustand — nothing else writes to Dexie directly (Stories 27–29)
- Snap detection compares world space positions only (Story 9)
- Piece-to-piece snapping merges groups anywhere in world space, not just on the board (Story 9)

---

## Folder Structure

### Exists now
```
src/
  canvas/        # PixiJS setup, scene management, render loop, UI overlays
  puzzle/        # piece logic, cutting, drag, scatter, snap, completion
  workers/       # Web Worker entry points
  store/         # Zustand stores
  wasm-pkg/      # generated WASM bindings (do not edit — output of wasm:build)
crates/
  jigg-analysis/ # Rust WASM crate (edge detection, Bezier cut generation)
public/
  wasm/          # static WASM assets served directly (not bundled by Vite)
docs/            # this directory
```

### Planned (not yet created)
```
src/
  db/            # Dexie schema and queries (Stories 27–29)
  shaders/       # GLSL .frag/.vert files (Stories 16–19)
```

---

## Core Types

`src/puzzle/types.ts` is the source of truth for all shared types. Do not redefine these elsewhere.

```typescript
interface Piece {
  id: string;
  groupId: string;                                       // always belongs to a group
  localPosition: { x: number; y: number };              // offset from group origin
  correctPosition: { x: number; y: number };            // fixed world space, set once on puzzle creation
  gridCoord: { col: number; row: number };              // used for neighbour lookup
  rotation: number;
  placed: boolean;
  touched: boolean;
  stackIndex: number;
  textureRegion: { x: number; y: number; w: number; h: number };
}

interface PieceGroup {
  id: string;
  pieceIds: string[];                                   // single unconnected piece = group of one
  position: { x: number; y: number };                  // group origin in world space
}

interface PuzzleConfig {
  imageUrl: string;
  pieceCount: number;          // 12–200 (cap at 50 on mobile)
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
