<!-- audience: Dev, Agent -->

# Spec Compliance — MANDATORY jigg-spec Integration

*CRITICAL: Every piece of code must honor the jigg-spec format. This is not optional. This doc covers enforcement, type boundaries, and the submodule workflow.*

## Import Alias

Use the configured TypeScript path alias:

```typescript
import { PieceState, PieceDefinition, JiggHeader } from '@jigg-spec/types'
```

**Configuration:**
- `tsconfig.json`: `"@jigg-spec/*": ["./jigg-spec/*"]`  
- `vite.config.ts`: Alias resolves to `./jigg-spec/`
- Source: `jigg-spec/types.ts`

## Runtime Type Extensions

### Piece Type Structure
```typescript
// Runtime Piece extends spec types
interface Piece extends PieceDefinition, PieceState {
  // Runtime-only fields (not in spec):
  paletteIndex: number        // Visual grouping index
  initialRotation: number     // Starting rotation for reset
  textureRegion: Rectangle    // PixiJS texture coordinates
  gridCoord?: Point          // Spatial hash coordinate
}
```

**PieceDefinition** (from spec): `index`, `edges`, `canonical`  
**PieceState** (from spec): `stageId`, `pos?`, `rot`, `clusterId?`, `placed`  
**Runtime additions**: `paletteIndex`, `initialRotation`, `textureRegion`, `gridCoord`

### Known Semantic Gap
**Current:** `piece.pos` stores local group offset  
**Spec intent:** `piece.pos` stores global table coordinate  
**Timeline:** Will converge in persistence epic (Stories 53-55)  

Until then:
- `piece.pos` = local offset when on table
- `piece.pos` = absent for bench pieces (per spec)

## Serialization Boundary

*Not yet implemented — part of persistence epic.*

**At save:** Runtime `Piece[]` → spec-compliant `PieceState[]`  
**At load:** spec `PieceState[]` → runtime `Piece[]` (hydrate missing fields)  

The boundary strips runtime-only fields before serialization and regenerates them on load.

## Git Submodule Workflow

### Making Spec Changes
```bash
# 1. Work in submodule
cd jigg-spec
# ... make changes to types.ts or spec.md ...
git add -A
git commit -m "Add new field to PieceState"
git push origin main

# 2. Update main repo pointer
cd ..
git add jigg-spec
git commit -m "Update jigg-spec: new PieceState field"
git push origin main
```

### Pulling Updates
```bash
# Update submodule to latest
git pull origin main
git submodule update --remote

# Or in one step
git pull --recurse-submodules
```

### Initial Clone
```bash
git clone --recurse-submodules [repo-url]
```

## Key Invariants

**Stage Movement:** `STAGE_BENCH` → `STAGE_TABLE` is one-way; pieces never return to bench  

**Position Rules:**
- Bench pieces: `pos` must be absent
- Table pieces: `pos` required (currently local offset)

**Cluster Lifecycle:**
- Created: `clusterId` absent for all pieces
- Merged: `clusterId` set (NanoID 8 chars) 
- Placed: `clusterId` absent (`placed: true` implies no cluster)

**Rotation Storage:**
- Spec: `piece.rot` in degrees {0, 90, 180, 270}
- PixiJS: `sprite.rotation` in radians
- Conversion: `sprite.rotation = piece.rot * Math.PI / 180`

**Correctness Signal:**
- `placed: boolean` is authoritative (not stage identity)
- Pieces can be correct but unplaced (temporary states)

## Reserved IDs
- Stage IDs: `"table"` and `"bench"` must not be used as UserStageId
- Cluster origin: piece with lowest `PieceDefinition.index` in cluster

## Development Workflow

1. **Check spec first:** `jigg-spec/spec.md` and `jigg-spec/types.ts`
2. **Import via alias:** `@jigg-spec/types` 
3. **Follow invariants:** Position absent for bench, one-way stage movement
4. **Runtime extensions only:** New fields go in `src/puzzle/types.ts`, not spec
5. **Update both:** Spec changes require updating submodule pointer
