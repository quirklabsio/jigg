<!-- audience: Dev, Agent -->

# Engine Conventions — Runtime Invariants

*Critical rules for piece state management, stage transitions, and cluster handling.*

**Board fill** is computed once at image load from piece-image luminance (`computeBoardColor` in `src/canvas/board.ts`); it does not mutate during a session.

## Piece Initialization

All pieces start with these invariants:

```typescript
const newPiece: Piece = {
  // From PieceDefinition (immutable)
  index: number,
  edges: EdgeDefinition[],
  canonical: Point,
  
  // Initial PieceState
  stageId: 'bench',        // All pieces start on bench
  pos: undefined,          // Absent for bench pieces (required!)
  rot: randomCardinal(),   // 0, 90, 180, or 270 degrees
  clusterId: undefined,    // Absent at creation
  placed: false,          // No pieces start placed
  
  // Runtime fields
  paletteIndex: assignedIndex,
  initialRotation: rot,    // Store for reset capability
  textureRegion: computedRegion,
  gridCoord: undefined     // Computed on table entry
}
```

## Stage Movement Rules

### Valid Transitions
| From | To | Condition | One-way |
|------|----|-----------| --------|
| `bench` | `table` | User pickup | ✓ |
| `table` | `table` | Drag/drop | - |
| `bench` | `bench` | Invalid | - |
| `table` | `bench` | **Never** | ✓ |

**Critical:** Once a piece moves `bench` → `table`, it never returns to bench.

### Position Invariants
```typescript
// BENCH pieces
if (piece.stageId === 'bench') {
  assert(piece.pos === undefined)  // Must be absent
}

// TABLE pieces  
if (piece.stageId === 'table') {
  assert(piece.pos !== undefined)  // Must be present
  // Currently: local group offset
  // Future: global table coordinate (persistence epic)
}
```

## Cluster Lifecycle

### Creation (Game Start)
- All pieces: `clusterId` absent
- Clusters don't exist until first snap

### Merge (Snap Event)
```typescript
// When pieces snap together
const clusterId = nanoid(8)  // Generate new ID
survivors.forEach(piece => {
  piece.clusterId = clusterId
})
```

### Placement (Completion)
```typescript
// When cluster reaches correct position
cluster.forEach(piece => {
  piece.placed = true
  piece.clusterId = undefined  // Placed pieces have no cluster
})
```

**Reconstruction:** Clusters are derived at runtime by grouping on `clusterId`. Never stored as separate objects.

**Origin piece:** Lowest `PieceDefinition.index` in cluster (for deterministic behavior).

## Coordinate Systems

Four coordinate spaces are in play. Mixing them silently produces wrong results.

### 1. Texture pixels

Raw pixel dimensions of the sliced piece image. Stored in `piece.textureRegion.w/h`.

```
textureRegion.w = Math.floor(imageWidth / cols)   // e.g. 136 for 2048px / 15 cols
```

**Never use texture pixels as distances in world space.** They are only valid for texture UV math, sprite frame construction, and occupancy-check thresholds that have been converted (see §3 below).

---

### 2. World units

PixiJS's internal coordinate space. The viewport world is `WORLD_SIZE × WORLD_SIZE` (4000 × 4000). At `viewport.scale = 1.0` (the default — no auto-fit runs at startup), 1 world unit = 1 CSS pixel.

Piece sprites enter world space with `sprite.scale.set(_canvasScale)`, where:

```
_canvasScale = Math.min(screenW / imageW, screenH / imageH)
```

So a piece with `textureRegion.w = 136 px` occupies `136 × _canvasScale` **world units** in width.

**`_canvasScale` varies per image.** A 2048×1536 image on a 1440×900 screen → `_canvasScale ≈ 0.586`. An 800×600 image → `_canvasScale = 1.5`. Code that works on the dev test image (800×600) will break silently on phone images if it treats texture pixels as world units.

**Converting texture pixels → world units:**
```ts
const worldHalfW = piece.textureRegion.w * _canvasScale / 2;
```

---

### 3. Group-local space

`piece.pos` is an offset relative to `group.position`, not an absolute world coordinate:

```ts
// world position of a piece:
const worldX = group.position.x + piece.pos!.x;
const worldY = group.position.y + piece.pos!.y;
```

Both `group.position` and `piece.pos` are in world units. Piece canonical positions (`piece.canonical`) are also in world units and are absolute (not group-relative).

**Future:** `piece.pos` will store absolute world coordinates when the persistence epic ships. `group.position` will become the canonical anchor. Until then, always add `group.position` when you need absolute world coords.

---

### 4. Screen pixels

What the user actually sees: `world units × viewport.scale`. At default zoom (`viewport.scale = 1.0`) screen pixels equal world units. When the user pinches or scrolls to zoom, `viewport.scale` changes and the same world-space distance maps to a different number of screen pixels.

Snap distances, focus ring thickness, and other screen-space constants must account for `viewport.scale` if they need to be zoom-stable. The focus ring is drawn on `app.stage` (above the viewport) for this reason — it uses screen coordinates directly.

---

### Quick reference

| Space | Unit | Where used | Convert to world |
|---|---|---|---|
| Texture pixels | `textureRegion.w/h` | Sprite frames, UV math | `× _canvasScale` |
| World units | `group.position`, `piece.pos`, `piece.canonical` | All PixiJS positions | — |
| Group-local | `piece.pos` offset | Piece positions within a group | `+ group.position` |
| Screen pixels | Visible px on display | Focus ring, snap highlight, DOM overlays | `÷ viewport.scale` |

### Board dimensions

The board rectangle matches the piece coverage area, **not** the full image dimensions:

```
boardW = Math.floor(imageWidth  / cols) * cols   // = cols  × pieceW
boardH = Math.floor(imageHeight / rows) * rows   // = rows  × pieceH
```

`imageWidth × imageHeight` is almost always larger (remainder pixels from the floor division). The board must be sized to the piece coverage so corner pieces align flush with the board edges.

## Rotation Handling

### Storage Formats
- **Spec:** `piece.rot` in degrees `{0, 90, 180, 270}`
- **PixiJS:** `sprite.rotation` in radians
- **Conversion:** `sprite.rotation = piece.rot * Math.PI / 180`

### Constraints
- Only cardinal rotations in v1 (no free rotation)
- Rotation changes must update both `piece.rot` and `sprite.rotation`
- Initial rotation assigned randomly at piece creation

## Correctness Signals

### Primary Authority
```typescript
if (piece.placed === true) {
  // Piece is correctly positioned and locked
  // piece.clusterId must be undefined
  // Piece will never move again
}
```

### Stage vs Correctness
- **Stage identity** (`stageId`) ≠ correctness
- Pieces can be on table but incorrect
- Pieces can be correct but not yet placed (temporary states)
- `placed: boolean` is the sole correctness authority

## Reserved Identifiers

### Stage IDs
- `"bench"` — reserved for piece tray
- `"table"` — reserved for assembly area
- User stages must use different IDs (when multi-stage support added)

### Validation
```typescript
function isValidUserStageId(id: string): boolean {
  return id !== 'bench' && id !== 'table'
}
```

## Performance Considerations

### Spatial Indexing
- `piece.gridCoord` enables O(1) neighbor lookup
- Recompute when piece position changes significantly
- Grid size: balance memory vs lookup performance

### Cluster Operations
- Group pieces by `clusterId` for batch operations
- Cache cluster membership during drag operations
- Prefer iteration over repeated lookups

## Debugging Invariants

Use these checks in development builds:

```typescript
function validatePiece(piece: Piece) {
  // Position/stage consistency
  if (piece.stageId === 'bench') {
    console.assert(piece.pos === undefined)
  }
  if (piece.stageId === 'table') {
    console.assert(piece.pos !== undefined)
  }
  
  // Placement/cluster consistency
  if (piece.placed) {
    console.assert(piece.clusterId === undefined)
  }
  
  // Rotation constraints
  console.assert([0, 90, 180, 270].includes(piece.rot))
}
```

## Common Patterns

### Safe Position Access
```typescript
// WRONG
const x = piece.pos.x  // Crashes on bench pieces

// RIGHT
const x = piece.pos?.x ?? 0  // Safe default
```

### Stage-aware Operations
```typescript
function movePiece(piece: Piece, delta: Point) {
  if (piece.stageId === 'bench') {
    throw new Error('Bench pieces cannot move')
  }
  
  piece.pos!.x += delta.x  // Non-null assertion safe here
  piece.pos!.y += delta.y
}
```

### Cluster Reconstruction
```typescript
function getClusters(pieces: Piece[]): Map<string, Piece[]> {
  const clusters = new Map()
  
  pieces
    .filter(p => p.clusterId && !p.placed)  // Only active clusters
    .forEach(piece => {
      const cluster = clusters.get(piece.clusterId!) ?? []
      cluster.push(piece)
      clusters.set(piece.clusterId!, cluster)
    })
    
  return clusters
}
```
