<!-- audience: Dev, Agent -->

# Engine Conventions — Runtime Invariants

*Critical rules for piece state management, stage transitions, and cluster handling.*

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
