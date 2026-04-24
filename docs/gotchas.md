<!-- audience: Dev, Agent -->

# Development Gotchas — Jigg-specific Issues

*Things that bite you even when you know the system — surprising failures, silent mismatches, environment traps.*

**A gotcha is not a rule or a convention.** If it's a known invariant, a lifecycle rule, or a coordinate-space definition, it belongs in `engine-conventions.md`, not here. Ask: "Would a careful dev who read engine-conventions.md still get burned by this?" If yes — it's a gotcha. If no — it's a convention; put it there.

## WASM Integration

### Current Import Pattern (Story 3+)
Workers import WASM module directly from `wasm-pkg`:

```typescript
import init, { analyze_image, generate_cuts } from '../wasm-pkg/jigg_analysis.js'

// In worker:
await init()  // Initialize WASM
const result = analyze_image(imageData)
```

**Build location:** `src/wasm-pkg/` (bundled by Vite)  
**Superseded:** `public/wasm/` directory no longer used  

### Legacy Pattern (Pre-Story 3)
~~`import(/* @vite-ignore */ '/wasm/jigg_analysis.js')` — Do not use this pattern. It was replaced by direct wasm-pkg imports for better bundling.~~

## Stage Transition Rules

### One-way Movement
```typescript
// WRONG: Moving pieces back to bench
if (shouldReset) {
  piece.stageId = 'bench'  // NEVER allowed
}

// RIGHT: Pieces never return to bench
if (shouldReset) {
  piece.pos = piece.canonical  // Move to correct position
  piece.placed = true
}
```

### Position Invariants
```typescript
// WRONG: Assigning position to bench pieces
if (piece.stageId === 'bench') {
  piece.pos = { x: 0, y: 0 }  // Violates spec
}

// RIGHT: Bench pieces never have position
if (piece.stageId === 'bench') {
  console.assert(piece.pos === undefined)
}
```

## Cluster Management  

### Derived vs Stored
```typescript
// WRONG: Storing clusters as objects
const cluster = { id: nanoid(), pieces: [...] }
store.clusters.push(cluster)

// RIGHT: Clusters are derived from piece.clusterId
const clusters = pieces
  .filter(p => p.clusterId)
  .reduce((acc, piece) => {
    const group = acc.get(piece.clusterId!) ?? []
    group.push(piece)
    acc.set(piece.clusterId!, group)  
    return acc
  }, new Map())
```

### Lifecycle Management
```typescript
// WRONG: Keeping clusterId when placed  
piece.placed = true
// piece.clusterId still set — violation

// RIGHT: Clear clusterId when placing
piece.placed = true
piece.clusterId = undefined  // Required by spec
```

## Type Import Patterns

### Spec Types
```typescript
// WRONG: Direct file import
import { PieceState } from '../jigg-spec/types.ts'

// RIGHT: Use configured alias
import { PieceState } from '@jigg-spec/types'
```

### Extension Types
```typescript
// Runtime extensions go in src/puzzle/types.ts
interface RuntimePieceExtension {
  paletteIndex: number
  textureRegion: Rectangle
}

// Never add runtime fields to jigg-spec/types.ts
```

## Event Handling

### Pointer Lock Gotchas
```typescript
// WRONG: Requesting pointer lock on every drag
element.requestPointerLock()  // Can be denied by browser

// RIGHT: Request once, handle gracefully
if (!document.pointerLockElement) {
  element.requestPointerLock().catch(() => {
    // Fallback to regular mouse events
  })
}
```

### Touch vs Mouse
```typescript
// WRONG: Handling only mouse events
element.addEventListener('mousedown', handler)

// RIGHT: Unified pointer events  
element.addEventListener('pointerdown', handler)
```

## Performance Traps

### Spatial Hash Updates
```typescript
// WRONG: Rebuilding hash on every frame
spatialHash.clear()
pieces.forEach(p => spatialHash.insert(p))

// RIGHT: Incremental updates
if (piece.gridCoord !== newGridCoord) {
  spatialHash.remove(piece)
  piece.gridCoord = newGridCoord
  spatialHash.insert(piece)
}
```

### Texture Cleanup
```typescript
// WRONG: Leaving textures in GPU memory
// No explicit cleanup

// RIGHT: Clean up on puzzle completion
puzzleTexture.destroy(true)  // Destroy base texture too
```

## Accessibility Integration

### ARIA Label Updates  
```typescript
// WRONG: Static labels
button.setAttribute('aria-label', 'Piece')

// RIGHT: Dynamic state-based labels  
function updateLabel(piece: Piece) {
  const type = getPieceType(piece)        // corner, edge, interior
  const state = getPieceState(piece)      // held, placed, grouped
  button.setAttribute('aria-label', `${type} piece, ${state}`)
}
```

### Focus Management
```typescript
// WRONG: Manual focus tracking
let currentFocus = 0

// RIGHT: Use inert attribute for mode switching
benchElement.inert = (mode !== 'bench')
tableElement.inert = (mode !== 'table')
```

## Development Tools

### Debug Keys (Current)
- `F`: FPS counter toggle
- `Shift+B`: Background preset cycle  
- `?`: Keyboard shortcuts panel

**Removed:** `E` key (edge overlay, removed in Story 29)

### Console Assertions
```typescript
// Use in development builds for invariant checking
console.assert(piece.stageId === 'bench' ? !piece.pos : !!piece.pos)
console.assert(!piece.placed || !piece.clusterId)
console.assert([0, 90, 180, 270].includes(piece.rot))
```

## Common Code Patterns

### Safe Position Access
```typescript
// Handle optional position safely
const x = piece.pos?.x ?? 0
const y = piece.pos?.y ?? 0

// Or with explicit stage check
if (piece.stageId === 'table') {
  const x = piece.pos!.x  // Non-null assertion safe here
}
```

### Cluster Origin Determination
```typescript
// Find origin piece (lowest index) for deterministic behavior
function getClusterOrigin(cluster: Piece[]): Piece {
  return cluster.reduce((origin, piece) => 
    piece.index < origin.index ? piece : origin
  )
}
```

### Stage-aware Operations
```typescript
function movePiece(piece: Piece, delta: Point) {
  if (piece.stageId === 'bench') {
    throw new Error('Cannot move bench pieces')
  }
  
  piece.pos!.x += delta.x
  piece.pos!.y += delta.y
  updateSpatialHash(piece)  // Remember to update indices
}
```

## Testing Gotchas

### Async WASM Initialization
```typescript
// WRONG: Using WASM functions immediately
const result = analyze_image(data)  // May fail if WASM not ready

// RIGHT: Wait for initialization
await init()  // Ensure WASM is loaded
const result = analyze_image(data)
```

### Mock Spatial Hash
```typescript
// Create lightweight mock for tests
const mockSpatialHash = {
  insert: jest.fn(),
  remove: jest.fn(), 
  query: jest.fn().mockReturnValue([])
}
```

## Board size and canonical-position origin are two separate computations — fix one without the other and corners stay misaligned

`createBoard` in `board.ts` and `boardLeft`/`boardTop` in `scene.ts` both independently compute the size of the playable area. If they use different widths, the board rect and the piece canonical positions become offset — corner pieces appear close but not flush regardless of which one you fix.

Both must use `Math.floor(imageWidth / cols) * cols * scale`, not `imageWidth * scale`:

```ts
// board.ts — board rect size
const bw = Math.floor(imageWidth / cols) * cols * scale;

// scene.ts — canonical position origin
const boardLeft = (app.screen.width - Math.floor(texture.width / cols) * cols * scale) / 2;
```

If you change one, always change the other in the same commit. The engine-conventions.md §"Board dimensions" has the canonical formula.

## Bench `THUMBNAIL_SIZE` depends on `FILTER_STRIP_HEIGHT` — they must move together

`THUMBNAIL_SIZE` in `bench.ts` is derived from the available piece area inside `_piecesContainer`:

```
THUMBNAIL_SIZE = TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED - FILTER_STRIP_HEIGHT - PADDING - BENCH_RING_CLEARANCE
              = 220 - 40 - 36 - 8 - 8 = 128
```

If you add a new permanent element inside `_piecesContainer` above (or below) the piece grid — e.g. a second toolbar row, a notification bar — the available height shrinks and `THUMBNAIL_SIZE` must be recalculated. Failing to do so causes piece cells to overflow the mask (tab knobs sliced) and the focus ring to go off-screen (clipped at the canvas boundary).

The `_focusRing` Graphics lives on `app.stage`, not inside `_piecesContainer`. **The container mask does not clip the ring.** The ring is clipped only by the canvas (WebGL viewport) boundary. If the sprite's bottom in screen space exceeds `screenH`, the ring drawn `FOCUS_RING_PADDING` pixels outside will be partially off-canvas and invisible. Reducing `THUMBNAIL_SIZE` is the correct fix — expanding the mask alone cannot recover off-screen content.


## Regression fixture (300×300, forceGrid 3×3): pieces hard to grab after zooming out

The color-blocks regression image is 300×300 px. `canvasScale` for this image is ~3.0 (pieces are 300×300 world units each). Pieces scatter across a large world-space region relative to screen size. If you zoom out to see all pieces at once, they become small on screen — and the spatial-hash hit test, which works in world coordinates, may reject clicks that appear "dead center" in screen space when the viewport is significantly zoomed.

**This is expected behavior** for the regression fixture; it is optimized for classification correctness (all three piece types present), not ergonomic play. For the regression script, work at the default viewport scale (don't zoom out) or extract pieces one at a time at normal zoom.



`computeGrid` aims for `TARGET_PIECES=160`, but for small images the `MIN_PIECE_SIDE=60` floor overrides the target — raising the piece size forces fewer, larger pieces.

**Example:** 512×512 image
- Natural piece side: `√(512² / 160)` ≈ 40 px — below MIN_PIECE_SIDE
- Floor clamps to 60 px → `round(512/60)` = 9 → **9×9 = 81 pieces**
- Without the floor: 13×13 = 169 pieces

A 2048×2048 image produces more pieces (169) than a 512×512 image (81). This is correct — tiny pieces on a small canvas are unplayable. Don't write QA expectations for small images by plugging the dimensions into the TARGET_PIECES formula alone; check whether MIN_PIECE_SIDE will engage.

**Rule of thumb:** MIN_PIECE_SIDE engages when `√(w × h / 160) < 60`, i.e. when the image area is less than `160 × 60² = 576 000 px²` (roughly anything smaller than ~760×760).

## `navigator.clipboard.writeText` fails silently when document is not focused

`navigator.clipboard` requires the document to be focused. In a split-window QA setup — picker open in one tab, app in another — the document loses focus when the user switches tabs, causing `writeText` to reject with `NotAllowedError: Document is not focused`. The `.catch` fires but is easy to miss if the toast disappears quickly.

**Fix:** always provide a fallback chain:
1. `navigator.clipboard.writeText(text)` — works in normal focused-tab use
2. `document.execCommand('copy')` via a temporary off-screen `<textarea>` — works without focus in most desktop browsers
3. Modal with pre-selected text — last resort for sandboxed iframes and mobile

```typescript
navigator.clipboard.writeText(text)
  .catch(() => {
    // execCommand fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (!ok) showModal(text); // final fallback
  });
```

`window.isSecureContext` guards `navigator.clipboard` access — localhost qualifies, so this isn't the failure mode in dev. The failure is always focus, not security context.

## Blob URLs Don't Survive Page Reloads

`URL.createObjectURL(file)` produces a blob URL (`blob:http://...`) that is only valid for the lifetime of the document that created it. Storing a blob URL in `sessionStorage` and reading it back after `window.location.reload()` gives you a dead reference — the new document's `Assets.load` receives the string but the resource is gone.

**Symptom:** `Assets.load` resolves to `null` (no throw, no 404 in the network panel), causing a null-destructure crash at the first line that reads `texture.width`.

**Fix:** Use `FileReader.readAsDataURL` to convert the file to a base64 data URL before storing. Data URLs are self-contained strings — no browser resource to expire.

```typescript
// WRONG: blob URL dies on reload
sessionStorage.setItem(KEY, URL.createObjectURL(file));
window.location.reload();

// RIGHT: data URL survives reload
const reader = new FileReader();
reader.onload = () => {
  sessionStorage.setItem(KEY, reader.result as string);
  window.location.reload();
};
reader.readAsDataURL(file);
```

**Secondary defence:** On boot, discard any stored value starting with `'blob:'` — a guard against stale entries written by an older code version:

```typescript
const stored = sessionStorage.getItem(KEY);
const imageUrl = stored && !stored.startsWith('blob:') ? stored : FALLBACK_URL;
```

**Size limit:** `sessionStorage` is capped at ~5 MB per origin. Wrap `sessionStorage.setItem` in a `try/catch` (`QuotaExceededError`) and remove the key on failure so the next boot falls back cleanly instead of looping.

## EXIF Orientation Test Images — Raw Pixel Orientation Must Match Real Device

When constructing a test image for EXIF Orientation=6 (the common iPhone portrait case), the **raw pixel dimensions must be landscape** (wider than tall), not portrait.

A real iPhone captures in landscape sensor orientation and sets EXIF Orientation=6 to say "rotate 90° CW to display correctly." The raw bytes are therefore wider than tall (e.g. 4032×3024). After applying Orientation=6, the displayed image becomes portrait (3024×4032).

If you create the test image with portrait raw pixels (3024×4032) and set Orientation=6, the rotation produces landscape — the opposite of what you're testing.

```python
# WRONG: portrait raw pixels with Orientation=6 → rotates to landscape
img = Image.new('RGB', (3024, 4032), ...)  # tall
exif = piexif.dump({'0th': {piexif.ImageIFD.Orientation: 6}})

# RIGHT: landscape raw pixels with Orientation=6 → rotates to portrait
img = Image.new('RGB', (4032, 3024), ...)  # wide, like iPhone sensor
exif = piexif.dump({'0th': {piexif.ImageIFD.Orientation: 6}})
```

**Expected result after `normalizeImage`:** width: 1536, height: 2048 (portrait)
**Bug result (EXIF ignored):** width: 2048, height: 1536 (landscape)

---

## PixiJS `FillGradient` with `textureSpace: 'local'` uses normalized [0, 1] coords, not pixels

When you construct a `FillGradient` with `textureSpace: 'local'`, the `start` and `end` coordinates must be in **normalized [0, 1] space** mapped to the shape's bounding box — not in pixel coordinates. Using pixel values (e.g. `end: { x: 0, y: 128 }` for a 128px tall rect) stretches the gradient over 128× the intended area, rendering the entire shape transparent with no error, no warning, and no visual indication that anything is wrong.

```ts
// WRONG: y: 128 stretches the gradient 128× — rect shows only the invisible transparent slice
const grad = new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 128 }, textureSpace: 'local' });

// RIGHT: y: 1 maps to the bottom of the shape's bounding box
const grad = new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local' });
```

**Failure mode:** the gradient appears to not render at all. No console error. The shape draws transparently. Easy to diagnose by cranking alpha to 1.0 — if still invisible, the coordinate scale is wrong.

**Alternative:** use `textureSpace: 'global'` (or omit it if the default changes) and provide actual pixel/world coordinates. `'local'` is more convenient when you want the gradient to track the shape's bounds automatically, but requires the normalized convention.

## `DropShadowFilter` with `resolution: 1` looks fine at small blur, jagged at large blur on retina

`resolution: 1` forces the filter to render at 1× pixel density. On a DPR=2 retina display, the shadow texture is upscaled 2× by WebGL, producing visibly blocky/pixelated edges. For small shadows (blur ≤ 10, alpha ≤ 0.10) the low-res artifact is too subtle to notice — which is why `resolution: 1` was applied as a blanket fix for piece shadows (originally targeting a pixel-seam artifact at DPR resolution). For **large, prominent shadows** (blur ≥ 30, alpha ≥ 0.20) the pixelation is immediately obvious and looks like "old PC game graphics."

**Fix for large shadows:** use `resolution: window.devicePixelRatio ?? 1`. Also set `padding = blur + offsetY + margin` to prevent the shadow from being clipped by the filter's default padding budget.

```ts
const shadow = new DropShadowFilter({ blur: 40, offset: { x: 0, y: 20 }, alpha: 0.42, quality: 4,
  resolution: window.devicePixelRatio ?? 1,
});
shadow.padding = 64; // blur(40) + offsetY(20) + margin(4)
```

The small-shadow `resolution: 1` pattern in `scene.ts` (`makeShadow`) is intentional and safe for its scale — don't "fix" it.

## PixiJS filter performance: quality, layering, and caching

Three independent mistakes that compound badly:

**1. High `quality` on filters re-runs every frame.** `quality: N` on a `DropShadowFilter` means N blur passes per render. Two filters at `quality: 8` = 16 shader passes drawn every frame the scene ticks. For a board that never moves, this is pure waste. Rule of thumb: `quality: 4` is enough for `blur ≤ 10`; `quality: 5` for `blur ≤ 25`. Going higher has diminishing returns on smoothness and direct FPS cost.

**2. `BlurFilter` is isotropic — it spreads in all 4 directions equally.** Using `BlurFilter` on a solid rect to simulate a drop shadow produces a symmetric halo, not a directional shadow. `DropShadowFilter` is the correct tool for directional shadows; `BlurFilter` is only appropriate when you *want* an even glow (e.g. a neon or highlight effect).

**3. Static objects with filters must be cached.** Any `Container` with `.filters` is re-evaluated by the GPU every frame the renderer ticks, even if nothing changed. For objects that never move or change after creation (board, background panels, static UI), call `container.cacheAsTexture({ resolution: window.devicePixelRatio })` immediately after setup. This bakes the filtered result to a texture once at load time and replaces the live filter with a simple sprite — zero shader cost per frame thereafter.

```ts
// Full pattern for a static board shadow:
const umbra = new DropShadowFilter({ blur: 7, quality: 4, resolution: window.devicePixelRatio });
const penumbra = new DropShadowFilter({ blur: 22, quality: 5, resolution: window.devicePixelRatio });
container.filters = [umbra, penumbra];
container.filterArea = new Rectangle(left - pad, top - pad, bw + pad * 2, bh + pad * 2);
container.cacheAsTexture({ resolution: window.devicePixelRatio }); // <-- critical
```

**4. Asymmetric shadow clipping.** With `offset.x: 0`, a shadow should be symmetric left-right. If it looks different on one side, PixiJS computed asymmetric filter texture bounds from the container's geometry. Fix: set `container.filterArea` explicitly with generous padding on all sides. This gives PixiJS a fixed region instead of a dynamically-calculated one that can round differently on each edge.

*Report new gotchas to maintain this list.*
