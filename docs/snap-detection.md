# Snap Detection

Implemented in Story 9. Logic lives in `src/puzzle/snap.ts`.

---

## How It Works

### Neighbour Lookup
- Each piece has `gridCoord: { col, row }` set once on creation
- `gridIndex: Map<"col,row", pieceId>` in Zustand — O(1) lookup
- On drop: check 4 cardinal neighbours for each piece in the dragged group
- Skip neighbours in the same group

### Proximity Test
- `SNAP_THRESHOLD_SQ = 40 * 40` (squared distance, no sqrt)
- For neighbour direction `[dc, dr]`, compute world-space delta accounting for group rotation:
  ```typescript
  const worldDx = localDx * cos - localDy * sin;
  const worldDy = localDx * sin + localDy * cos;
  ```
- Compare expected neighbour position `(pSprite.x + worldDx, pSprite.y + worldDy)` vs actual
- Early exit on first valid snap

### Rotation Guard
- Both groups must have matching orientations: `Math.abs(normRot(a) - normRot(b)) < 0.01`
- `normRot(r) = ((r % 2π) + 2π) % 2π` — handles accumulated rotation past 2π
- Mismatched rotations cannot produce a valid physical join

### Snap Correction
- On snap: shift dragged group by `(nSprite.x - worldDx - pSprite.x, ...)` to pixel-perfect align
- Call `moveGroup(draggedGroupId, newGroupPos)` then `mergeGroups(survivorId, absorbedId)`
- Final pixel-sync: re-apply `survivor.position + piece.localPosition` to all survivor sprites

### Group Merge Rules
- Larger group (more pieces) absorbs smaller — preserves dominant origin
- Absorbed pieces get new `localPosition = absorbed.position + piece.localPosition - survivor.position`
- Absorbed group deleted from store; all absorbed `piece.groupId` updated to survivorId
- `onUp` in drag.ts: removes absorbed group from spatial hash, rebuilds survivor AABB
- All survivor sprites assigned unified `++settleCounter` zIndex after merge

---

## Key Decisions
- **Freeform** — snap anywhere in world space, not just near the board
- **Neighbour-based** — only gridCoord-adjacent pieces with matching rotation snap
- **Larger absorbs smaller** — preserves dominant group origin; minimises recalculation
- **Squared distance throughout** — avoids sqrt in tight loop
