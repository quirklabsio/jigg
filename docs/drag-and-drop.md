<!-- audience: Dev, Agent -->

# Drag and Drop — Interaction Architecture

*Pointer-based piece movement, grouping, and snap detection.*

## Group Model (Current)

### Piece Position Storage
**Current implementation:** `piece.pos` stores local offset within group  
**Future implementation:** Will converge to global coordinate (persistence epic, Stories 53-55)

```typescript
interface Piece {
  pos?: Point  // Local offset from group origin (absent for bench pieces)
  // ... other fields
}
```

### Group Reconstruction
Groups are derived at runtime from `clusterId`, never stored as separate objects:

```typescript
function getClusters(pieces: Piece[]): Map<string, Piece[]> {
  return pieces
    .filter(p => p.clusterId && !p.placed)  // Only active clusters
    .reduce((clusters, piece) => {
      const cluster = clusters.get(piece.clusterId!) ?? []
      cluster.push(piece)
      clusters.set(piece.clusterId!, cluster)
      return clusters
    }, new Map())
}
```

### Group Merge Logic
```typescript
function mergeGroups(survivorId: string, absorbedId: string, pieces: Piece[]) {
  // Update all absorbed pieces to survivor clusterId
  pieces
    .filter(p => p.clusterId === absorbedId)
    .forEach(p => p.clusterId = survivorId)
  
  // No explicit group deletion needed — groups are derived
}
```

## Drag Hit Layer

### Hit Testing Pipeline
1. **Spatial Query:** Use spatial hash to get candidate pieces near pointer
2. **Bounds Check:** Filter to pieces whose bounds contain the hit point  
3. **Pixel Test:** Optional precise hit testing for complex shapes
4. **Z-order Sort:** Highest Z-index (most recently moved) wins

```typescript
function hitTest(pointer: Point, spatialHash: SpatialHash): Piece | null {
  const candidates = spatialHash.query(new Rectangle(
    pointer.x - 5, pointer.y - 5, 10, 10  // Small query region
  ))
  
  return candidates
    .filter(piece => piece.bounds.contains(pointer))
    .sort((a, b) => b.zIndex - a.zIndex)  // Highest first
    .find(piece => pixelTest(piece, pointer)) ?? null
}
```

## Drag Mechanics

### Drag Offset Calculation
```typescript
function startDrag(piece: Piece, pointer: Point) {
  if (piece.stageId === 'bench') {
    throw new Error('Cannot drag bench pieces directly')
  }
  
  // Drag offset = pointer position - piece position
  const dragOffset = {
    x: pointer.x - piece.pos!.x,  // piece.pos is local offset currently
    y: pointer.y - piece.pos!.y
  }
  
  return { piece, dragOffset }
}
```

### Group Movement
When dragging a piece that belongs to a cluster, move all cluster members:

```typescript
function updateDrag(dragState: DragState, pointer: Point) {
  const { piece, dragOffset } = dragState
  const newPosition = {
    x: pointer.x - dragOffset.x,
    y: pointer.y - dragOffset.y  
  }
  
  if (piece.clusterId) {
    // Move entire cluster
    const cluster = getClusterPieces(piece.clusterId)
    const delta = {
      x: newPosition.x - piece.pos!.x,
      y: newPosition.y - piece.pos!.y
    }
    
    cluster.forEach(p => {
      p.pos!.x += delta.x
      p.pos!.y += delta.y
      updateSpatialHash(p)
    })
  } else {
    // Move single piece
    piece.pos!.x = newPosition.x
    piece.pos!.y = newPosition.y  
    updateSpatialHash(piece)
  }
}
```

## Spatial Hash Integration

### Hash Cell Updates
```typescript
function updateSpatialHash(piece: Piece) {
  const newCoord = worldToGrid(piece.pos!)
  
  if (!piece.gridCoord || !newCoord.equals(piece.gridCoord)) {
    if (piece.gridCoord) {
      spatialHash.remove(piece)  // Remove from old cell
    }
    piece.gridCoord = newCoord
    spatialHash.insert(piece)    // Add to new cell
  }
}
```

### Neighbor Query Optimization
```typescript
function getSnapCandidates(piece: Piece, radius: number): Piece[] {
  const queryBounds = new Rectangle(
    piece.pos!.x - radius,
    piece.pos!.y - radius,
    radius * 2,
    radius * 2
  )
  
  return spatialHash.query(queryBounds)
    .filter(candidate => candidate !== piece)
    .filter(candidate => candidate.clusterId !== piece.clusterId)  // Exclude same cluster
}
```

## Pointer Lock Integration

### Lock Behavior
```typescript
function requestPointerLock(element: HTMLElement): Promise<boolean> {
  return new Promise((resolve) => {
    if (document.pointerLockElement === element) {
      resolve(true)
      return
    }
    
    const onLockChange = () => {
      document.removeEventListener('pointerlockchange', onLockChange)
      resolve(document.pointerLockElement === element)
    }
    
    document.addEventListener('pointerlockchange', onLockChange)
    element.requestPointerLock()
  })
}
```

### Movement Delta Processing
```typescript
function onPointerMove(event: PointerEvent) {
  if (document.pointerLockElement) {
    // Use movement delta when locked
    updateDragFromDelta({
      dx: event.movementX,
      dy: event.movementY
    })
  } else {
    // Use absolute position when not locked
    updateDragFromPosition({
      x: event.clientX,  
      y: event.clientY
    })
  }
}
```

## Stage Transition Handling

### Bench to Table Movement
```typescript
function moveToTable(piece: Piece, tablePosition: Point) {
  console.assert(piece.stageId === 'bench')
  console.assert(piece.pos === undefined)  // Bench pieces have no position
  
  piece.stageId = 'table'
  piece.pos = tablePosition  // Now piece has position
  
  updateSpatialHash(piece)  // Add to spatial index
}

// Note: Table to bench movement is never allowed (one-way)
```

### Position Validation
```typescript
function validatePiecePosition(piece: Piece) {
  if (piece.stageId === 'bench') {
    console.assert(piece.pos === undefined, 'Bench pieces must not have position')
  } else if (piece.stageId === 'table') {
    console.assert(piece.pos !== undefined, 'Table pieces must have position')
  }
}
```

## Performance Optimizations

### Batched Updates
```typescript
function updateMultiplePieces(pieces: Piece[], delta: Point) {
  // Batch spatial hash updates
  const toUpdate = pieces.filter(p => p.stageId === 'table')
  
  // Remove all from hash
  toUpdate.forEach(p => spatialHash.remove(p))
  
  // Update positions  
  toUpdate.forEach(p => {
    p.pos!.x += delta.x
    p.pos!.y += delta.y
  })
  
  // Re-insert all
  toUpdate.forEach(p => spatialHash.insert(p))
}
```

### Debounced Snap Testing
```typescript
let snapTestTimeout: number
function scheduleSnapTest(piece: Piece) {
  clearTimeout(snapTestTimeout)
  snapTestTimeout = setTimeout(() => {
    testForSnaps(piece)
  }, 16)  // One frame delay
}
```

## Error Conditions

### Common Failure Cases
- Dragging bench pieces (position undefined)
- Moving pieces between incompatible stages  
- Forgetting to update spatial hash after position changes
- Using global coordinates when piece.pos is local offset

### Defensive Programming
```typescript
function safeDragUpdate(piece: Piece, newPos: Point) {
  if (piece.stageId === 'bench') {
    console.error('Cannot drag bench piece:', piece.index)
    return false
  }
  
  if (!piece.pos) {
    console.error('Table piece missing position:', piece.index)
    return false
  }
  
  piece.pos.x = newPos.x
  piece.pos.y = newPos.y
  updateSpatialHash(piece)
  return true
}
```

---

*See `snap-detection.md` for snap behavior details.*
