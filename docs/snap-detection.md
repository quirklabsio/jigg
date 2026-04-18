<!-- audience: Dev, Agent -->

# Snap Detection — Assembly Algorithm

*Proximity testing, edge alignment, and group merging for piece assembly.*

## Snap Detection Pipeline

### 1. Proximity Test
Find nearby pieces within snap threshold:

```typescript
function findSnapCandidates(piece: Piece, threshold: number): Piece[] {
  const queryBounds = new Rectangle(
    piece.pos!.x - threshold,
    piece.pos!.y - threshold, 
    threshold * 2,
    threshold * 2
  )
  
  return spatialHash.query(queryBounds)
    .filter(candidate => candidate !== piece)
    .filter(candidate => candidate.clusterId !== piece.clusterId)  // Exclude same cluster
}
```

### 2. Edge Alignment Test
Check if piece edges can connect:

```typescript
function testEdgeAlignment(pieceA: Piece, pieceB: Piece): SnapResult | null {
  for (const edgeA of pieceA.edges) {
    for (const edgeB of pieceB.edges) {
      if (canConnect(edgeA, edgeB)) {
        const snapPoint = calculateSnapPosition(pieceA, pieceB, edgeA, edgeB)
        const distance = Point.distance(pieceA.pos!, snapPoint)
        
        if (distance <= SNAP_THRESHOLD) {
          return {
            pieceA, pieceB,
            snapPoint,
            confidence: 1 - (distance / SNAP_THRESHOLD)
          }
        }
      }
    }
  }
  
  return null
}
```

### 3. Rotation Guard
Ensure pieces have compatible rotations:

```typescript
function canConnect(edgeA: EdgeDefinition, edgeB: EdgeDefinition): boolean {
  // Account for piece rotations
  const rotationDiff = Math.abs(edgeA.rotation - edgeB.rotation) % 360
  
  // Edges must be perpendicular (90° or 270°) to connect
  return rotationDiff === 90 || rotationDiff === 270
}
```

### 4. Snap Correction
Adjust piece position for perfect alignment:

```typescript
function executeSnap(snapResult: SnapResult): void {
  const { pieceA, pieceB, snapPoint } = snapResult
  
  // Move pieceB to snap position
  const delta = Point.subtract(snapPoint, pieceB.pos!)
  
  if (pieceB.clusterId) {
    // Move entire cluster
    const cluster = getClusterPieces(pieceB.clusterId)
    cluster.forEach(piece => {
      piece.pos!.x += delta.x
      piece.pos!.y += delta.y
    })
  } else {
    // Move single piece
    pieceB.pos!.x = snapPoint.x
    pieceB.pos!.y = snapPoint.y
  }
}
```

## Group Merge Rules

### Cluster Assignment
When pieces snap together, merge their clusters:

```typescript
function mergeCluster(pieceA: Piece, pieceB: Piece): void {
  const survivorId = pieceA.clusterId || nanoid(8)
  const absorbedId = pieceB.clusterId
  
  // Assign survivor ID to both pieces
  pieceA.clusterId = survivorId
  pieceB.clusterId = survivorId
  
  // If pieceB had a cluster, absorb all members
  if (absorbedId) {
    pieces
      .filter(p => p.clusterId === absorbedId)
      .forEach(p => p.clusterId = survivorId)
  }
  
  // No explicit cluster deletion — clusters are derived at runtime
}
```

### Origin Piece Selection
For cluster operations, use the piece with the lowest index as origin:

```typescript
function getClusterOrigin(clusterId: string): Piece {
  return pieces
    .filter(p => p.clusterId === clusterId)
    .reduce((origin, piece) => 
      piece.index < origin.index ? piece : origin
    )
}
```

## Correctness Detection

### Placement Test
Check if piece/cluster is in the correct final position:

```typescript
function testCorrectness(piece: Piece): boolean {
  const tolerance = 5  // pixels
  
  if (piece.clusterId) {
    // Test entire cluster
    const cluster = getClusterPieces(piece.clusterId)
    return cluster.every(p => 
      Point.distance(p.pos!, p.canonical) <= tolerance
    )
  } else {
    // Test single piece
    return Point.distance(piece.pos!, piece.canonical) <= tolerance
  }
}
```

### Lock Placement
When a cluster is correctly positioned, lock it in place:

```typescript
function lockPlacement(clusterId: string): void {
  const cluster = getClusterPieces(clusterId)
  
  cluster.forEach(piece => {
    piece.pos = piece.canonical  // Snap to exact correct position
    piece.placed = true         // Mark as complete
    piece.clusterId = undefined // Remove from cluster (placed pieces have no cluster)
  })
  
  // Update completion tracking
  updateCompletionStatus()
}
```

## Performance Optimizations

### Spatial Hash Optimization
Use grid-based spatial indexing for O(1) neighbor lookup:

```typescript
class SpatialHash {
  private cellSize: number = 100
  private grid = new Map<string, Set<Piece>>()
  
  insert(piece: Piece): void {
    const coord = this.worldToGrid(piece.pos!)
    const key = `${coord.x},${coord.y}`
    
    if (!this.grid.has(key)) {
      this.grid.set(key, new Set())
    }
    this.grid.get(key)!.add(piece)
    piece.gridCoord = coord
  }
  
  query(bounds: Rectangle): Piece[] {
    const results: Piece[] = []
    const min = this.worldToGrid({ x: bounds.x, y: bounds.y })
    const max = this.worldToGrid({ 
      x: bounds.x + bounds.width, 
      y: bounds.y + bounds.height 
    })
    
    for (let x = min.x; x <= max.x; x++) {
      for (let y = min.y; y <= max.y; y++) {
        const cell = this.grid.get(`${x},${y}`)
        if (cell) results.push(...cell)
      }
    }
    
    return results
  }
}
```

### Snap Test Throttling
Limit snap testing frequency during rapid movement:

```typescript
let lastSnapTest = 0
const SNAP_TEST_INTERVAL = 50  // ms

function throttledSnapTest(piece: Piece): void {
  const now = performance.now()
  if (now - lastSnapTest < SNAP_TEST_INTERVAL) {
    return  // Skip test
  }
  
  lastSnapTest = now
  performSnapTest(piece)
}
```

## Edge Case Handling

### Multiple Snap Candidates
When multiple valid snaps exist, choose by confidence:

```typescript
function selectBestSnap(candidates: SnapResult[]): SnapResult | null {
  if (candidates.length === 0) return null
  
  return candidates.reduce((best, current) => 
    current.confidence > best.confidence ? current : best
  )
}
```

### Rotation Conflicts
Resolve cases where pieces could snap at multiple rotations:

```typescript
function resolveRotationConflict(piece: Piece, snaps: SnapResult[]): SnapResult | null {
  // Prefer snaps that don't require rotation
  const noRotationSnaps = snaps.filter(snap => 
    snap.requiredRotation === 0
  )
  
  return noRotationSnaps.length > 0 
    ? selectBestSnap(noRotationSnaps)
    : selectBestSnap(snaps)
}
```

### Cluster Overlap Prevention
Ensure merged clusters don't overlap with existing pieces:

```typescript
function validateClusterMerge(clusterA: Piece[], clusterB: Piece[]): boolean {
  const allPieces = [...clusterA, ...clusterB]
  
  for (let i = 0; i < allPieces.length; i++) {
    for (let j = i + 1; j < allPieces.length; j++) {
      if (piecesOverlap(allPieces[i], allPieces[j])) {
        return false  // Merge would create overlap
      }
    }
  }
  
  return true
}
```

## Visual Feedback

### Snap Preview
Show visual indicator when snap is possible:

```typescript
function updateSnapPreview(piece: Piece): void {
  const candidate = findBestSnapCandidate(piece)
  
  if (candidate) {
    showSnapIndicator(candidate.snapPoint, candidate.confidence)
  } else {
    hideSnapIndicator()
  }
}
```

### Highlight Zones
Indicate valid snap regions around piece edges:

```typescript
function renderSnapZones(piece: Piece, context: CanvasRenderingContext2D): void {
  const zones = calculateSnapZones(piece)
  
  context.strokeStyle = 'rgba(0, 255, 0, 0.3)'
  context.lineWidth = 2
  
  zones.forEach(zone => {
    context.strokeRect(zone.x, zone.y, zone.width, zone.height)
  })
}
```

---

*See `drag-and-drop.md` for interaction mechanics.*
