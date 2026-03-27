# Conventions

## Code
- Strict TypeScript, no `any`
- Web Workers use typed `WorkerMessage<T>` interface + `WorkerMessageType` union for all communication
- Worker files use the `?worker` Vite suffix on import
- File names: `camelCase.ts` for all modules
- GLSL shaders will live in `.frag` / `.vert` files, imported as strings via Vite (planned, Stories 16–19)

## Stores
- Zustand store: `usePuzzleStore` — only store that currently exists
- Planned: `useWorkspaceStore` (Stories 20–23), `useUIStore` (Stories 20+)
- Always use `getState()` / `setState()` — never import React hooks

## Commands
```bash
npm run dev          # dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run wasm:build   # build Rust crate and copy bindings to src/wasm-pkg/
```

`wasm:build` runs: `cd crates/jigg-analysis && wasm-pack build --target web` then copies `.js`, `.d.ts`, `.wasm` into `src/wasm-pkg/`.

Run `npm run typecheck` after every story.

## Explicitly Out of Scope
- No React, Vue, Svelte, or any component framework — no JSX ever
- No backend, no API calls, no user accounts
- No CSS frameworks
- No Canvas 2D — PixiJS/WebGL only
- No localStorage for puzzle state — IndexedDB only
- No multiplayer, no puzzle sharing (yet)

## Mobile
- Pointer events via PixiJS unified API — mouse and touch handled together
- Rotation: double-tap for 90° increments (works on desktop and mobile)
- Viewport: `user-scalable=no`, `touch-action: none` on canvas element
- Piece count: cap at 50 on mobile (detect via `window.innerWidth < 768`)
- Scatter: tighter radius on mobile so pieces aren't far apart
