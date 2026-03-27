# Snap Detection

Story 9 — not yet implemented.

---

## Planned Approach

### Neighbour Lookup
- Each piece has `gridCoord: { col: number; row: number }` set once on creation
- On drop, check the 4 cardinal neighbours of each piece in the dropped group
- Neighbour lookup: O(1) via `piecesById` store record keyed by `"col,row"`

### Proximity Test
- Compare world position of piece's `correctPosition` vs actual world position
- Snap threshold: TBD (likely a fraction of piece size)
- Snap detection compares world space positions only — never screen space

### Group Merge
- When snap triggers: the larger group absorbs the smaller
- Each piece in the absorbed group gets a new `localPosition` relative to the target group's origin
- Absorbed group is removed from store; all piece `groupId` fields updated
- Spatial hash updated for the merged group

### Spatial Hash Reuse
- Same `SpatialHash` infrastructure used for drag hit detection (see `docs/drag-and-drop.md`)
- On snap merge: remove absorbed group, update surviving group's AABB

---

## Key Decisions
- **Freeform** — snap can happen anywhere in world space, not just near the board
- **Neighbour-based** — only compatible edges trigger snap (gridCoord adjacency check)
- **Larger absorbs smaller** — preserves the dominant group's origin; minimises piece position recalculation
