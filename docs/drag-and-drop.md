# Drag and Drop

## Architecture

### Hit Layer Pattern
- One `Graphics` overlay (zIndex=1000) sits over the entire stage — uses `hitArea = new Rectangle(...)` with no drawn geometry (avoids retina rendering artifacts from a transparent-fill rect)
- `eventMode='none'` at rest; `activateDrag()` sets it to `'static'` after load completes
- All sprites permanently `eventMode='none'` — they never participate in hit testing
- Eliminates per-sprite event listener accumulation and toggling overhead

### Spatial Hash
- `SpatialHash` class maps grid cells (`"cx,cy"`) to `Set<groupId>`
- Cell size: `CELL_SIZE = 128`
- On `pointerdown`: query cells under pointer → collect candidate groups → rotation-aware hit test → pick topmost by zIndex
- On `onMove`: `spatialHash.update(groupId, aabb)` keeps index current
- On drop: final `spatialHash.update` with settled position

### Pointer Lock
- `activePointerId: number | null` — set on drag start, checked on every `pointermove` and `pointerup`
- Prevents two groups being dragged simultaneously
- `pointerupoutside` on stage prevents stuck-drag when pointer leaves canvas

### Z-Index
- Monotonic `settleCounter` — module-level, incremented on every drop
- Each drop: `zIdx = ++settleCounter`, assigned to all containers in the group via `(s.parent ?? s).zIndex`
- On drag start: `(s.parent ?? s).zIndex = settleCounter + 1` lifts piece above all settled pieces
- `app.stage.sortChildren()` called explicitly after bulk zIndex mutation — PixiJS `sortDirty` flag only triggers during the render pass, which can miss the first frame
- Initialised to `spriteMap.size` in `initDragListeners` so first drop's index is above all initial per-sprite values (containers start at zIndex=`i`)
- No constants, no cycling — most-recently-placed group always wins

### Drag Lift Rotation
- 1° (`0.0175 rad`) tilt on pointerdown, tween back to nearest 90° on pointerup
- 80ms ease-in-out quad tween via `app.ticker`
- `tweenId` counter: each `tweenRotation()` call increments it; stale ticker functions check `tweenId !== myId` and bail. Prevents snap-back tween from clobbering `rotateGroup()` on double-tap

### Drag Callbacks
- `setDragStartCallback(cb)` / `setDragEndCallback(cb)` — called in pointerdown/pointerup, wired by scene.ts for shadow state changes (currently disabled)

---

## Group Model

```
PieceGroup.position     — world origin of the group
Piece.localPosition     — fixed offset from group origin (set once, never changes until snap merge)
sprite.x/y              — world position = group.position + piece.localPosition
```

- Single unconnected piece = group of one
- `cutter.ts` creates one `PieceGroup` per piece with `localPosition: {0,0}`
- On snap merge: target group absorbs source group; each piece's `localPosition` is recalculated relative to new origin

### Drag Offset
On `pointerdown`, the drag offset is the delta between the group origin and the pointer:
```
dragOffsetX = (anchorSprite.x - anchorPiece.localPosition.x) - pointerX
dragOffsetY = (anchorSprite.y - anchorPiece.localPosition.y) - pointerY
```
On `onMove`, group origin is:
```
gx = pointer.x + dragOffsetX
gy = pointer.y + dragOffsetY
```
Each sprite: `s.x = gx + localX`, `s.y = gy + localY`

---

## Hit Testing

### Rotation-Aware Local Space Check
AABB using `s.width` is wrong for rotated sprites — PixiJS returns the rotated bounding box width.

Correct approach:
```typescript
const dx = px - s.x;
const dy = py - s.y;
const cos = Math.cos(-s.rotation);
const sin = Math.sin(-s.rotation);
const lx = (cos * dx - sin * dy) / s.scale.x;
const ly = (sin * dx + cos * dy) / s.scale.y;
const hw = s.texture.frame.width / 2;
const hh = s.texture.frame.height / 2;
if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) { ... }
```

---

## GC Optimisation
- `_pos = new Point()` allocated once at module level, reused in `onMove` via `toLocal(e.global, undefined, _pos)`
- No per-event Point allocation

---

## Key Files
- `src/puzzle/drag.ts` — all drag logic, hit layer, spatial hash
- `src/canvas/scene.ts` — calls `createHitLayer`, `initDragListeners`
- `src/main.ts` — calls `activateDrag()` after full load chain resolves
