Performance audit of the jigg puzzle canvas. Run this any time rendering,
filters, or drag performance needs checking — after any story that touches
scene.ts, drag.ts, or adds new filters.

Read CLAUDE.md before doing anything else.

Touch only:
- src/canvas/scene.ts
- src/puzzle/drag.ts
- src/puzzle/snap.ts
- src/workers/analysis.worker.ts

Do not add new features. Do not change puzzle logic.
Do not create any files not listed above.

---

## Step 1: Activate FPS counter

Press F key to toggle the FPS counter visible before running tests.
FPS counter is already implemented in scene.ts — do not add a new one.

---

## Step 2: Add performance markers around critical paths

In src/puzzle/drag.ts, wrap onMove with timing:
```ts
const t0 = performance.now()
// ... existing onMove logic
const t1 = performance.now()
if (t1 - t0 > 2) console.warn('slow onMove:', t1 - t0, 'ms')
```

In src/puzzle/snap.ts, wrap snap check with timing:
```ts
console.time('snapCheck')
// ... existing snap logic
console.timeEnd('snapCheck')
```

In src/workers/analysis.worker.ts, log WASM pipeline duration:
```ts
console.time('wasmPipeline')
// ... existing analyze + generate_cuts calls
console.timeEnd('wasmPipeline')
```

---

## Step 3: Audit filters

Log all filters on every sprite after puzzle loads (in scene.ts after all sprites created):
```ts
let totalFilters = 0
for (const [id, sprite] of spriteMap) {
  const count = sprite.filters?.length ?? 0
  totalFilters += count
  if (count > 0) {
    console.log(`piece ${id}: ${count} filters`, sprite.filters)
  }
}
console.log(`total filter passes per frame: ${totalFilters}`)
```

---

## Step 4: Run these specific tests and log results

Test A — idle FPS:
  Press F, load puzzle, do nothing, record FPS for 5 seconds
  Expected: stable 60fps
  Log: 'IDLE FPS: X'

Test B — drag FPS:
  Drag a single piece around for 5 seconds
  Watch for FPS drops and slow onMove warnings
  Log: 'DRAG FPS: X'

Test C — snap check duration:
  Drop a piece near a neighbour
  Check console.timeEnd('snapCheck') output
  Expected: < 1ms
  Log: 'SNAP CHECK: Xms'

Test D — WASM pipeline duration:
  Reload page, check console.timeEnd('wasmPipeline')
  Expected: < 3000ms on desktop
  Log: 'WASM PIPELINE: Xms'

Test E — filter count:
  Check total filter passes per frame logged after load
  Expected: < 20 total passes at medium density
  Log: 'TOTAL FILTER PASSES: X'

---

## Step 5: Report findings

After running all tests log a summary:
```ts
console.group('PERFORMANCE AUDIT')
console.log('Idle FPS:', ...)
console.log('Drag FPS:', ...)
console.log('Snap check:', ...ms)
console.log('WASM pipeline:', ...ms)
console.log('Filter passes per frame:', ...)
console.log('Identified bottlenecks:', [...])
console.groupEnd()
```

---

## Step 6: Fix identified bottlenecks

Based on findings apply fixes in this priority order:

**Priority 1 — if filter passes > 20:**
  Move DropShadowFilter and BevelFilter from per-sprite to container level.

  Create three containers with shared filters:
  - `unplacedContainer` — DropShadowFilter resting state
  - `dragContainer`     — DropShadowFilter dragging state
  - `placedContainer`   — DropShadowFilter placed state

  Remove filters from all individual sprites.
  Move sprite between containers on drag start/end/snap.

**Priority 2 — if snap check > 2ms:**
  Verify spatial hash is being used in snap.ts.
  Log cache hit/miss ratio:
```ts
  console.log('spatial hash candidates:', candidates.size)
```
  If candidates > 20 the hash cell size is too large —
  reduce to pieceWidth * 0.75

**Priority 3 — if WASM pipeline > 5000ms:**
  Add a loading spinner to index.html visible until WASM pipeline
  completes — at minimum the player should know something is happening.

**Priority 4 — if drag FPS < 55:**
  Throttle Zustand writes in onMove — only write to store on drag end,
  not during move.

---

## Step 7: Re-run all tests after fixes

Log second summary: 'POST-FIX PERFORMANCE AUDIT'
Confirm all metrics improved or unchanged.

---

## Step 8: Remove timing markers only

- Remove performance.now() wrappers from drag.ts
- Remove console.time from snap.ts and worker
- Keep console.warn for slow onMove — useful ongoing signal
- Do NOT remove FPS counter — permanent debug tool toggled by F key
- Remove filter audit log from scene.ts

---

## Acceptance criteria

- Audit summary logged to console before any fixes
- Post-fix summary logged after fixes
- Idle FPS stable at 60
- Drag FPS stable at 55+
- Snap check < 2ms
- No more than 20 filter passes per frame at medium density
- Timing markers removed, FPS counter untouched
- npm run typecheck passes