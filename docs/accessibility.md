# Accessibility Audit — jigg.app

**Audit date:** 2026-04-05 (updated after Story 37d)
**Audited files:**
- `src/store/puzzleStore.ts`
- `src/utils/preferences.ts`
- `src/canvas/scene.ts`
- `src/canvas/tray.ts`
- `src/puzzle/drag.ts`
- `src/utils/aria.ts` *(pulled in during audit)*
- `src/puzzle/types.ts` *(hallucination check)*

---

## 1. Accessibility Suite — Feature Matrix

The suite is organised into three pillars: **Visual**, **Vestibular**, and **Informational**.

### Visual Pillar

| Flag | Store default | Where set | Canvas effect | Ticker effect | DOM effect |
|---|---|---|---|---|---|
| `highContrast` | `false` | `Preferences` / `setPreference` | BevelFilter `lightAlpha`/`shadowAlpha` ×1.8 (0.20 → 0.36); **sandwich stroke** — two `OutlineFilter` instances: white 1.5px (`hc-sandwich`) then black 2.5px (`hc-sandwich`) appended after BevelFilter (BevelFilter stays at index 0); `_snapHighlightColor` → neon magenta `0xff00ff`, `_snapHighlightAlpha` → 1.0, thickness reserved at 4px; tray bg `0x1a1a1a` α 0.85 → pure black `0x000000` α 1.0; color-zone swatches gain black border ring | None | None |
| `greyscale` | `false` | `Preferences` / `setPreference` | Luminance-weighted `ColorMatrixFilter` (0.299/0.587/0.114 ITU-R BT.601) added per sprite, tagged `greyscale`; strictly non-destructive — BevelFilter and sandwich stroke are preserved | None | None |
| `backgroundPreset` | `null` (adaptive) | `Preferences` / `setPreference` | `_app.renderer.background.color` set to preset hex or luminance-derived adaptive value (luminance < 100 → `0xf5f5f3` off-white; > 150 → `0x2a2a2a` charcoal; mid → `0x808080` gray) | None | DOM preset-button UI synced via `syncBgPresetUI()` |
| `pieceLabels` | `false` | `Preferences` / `setPreference` | PIXI `Container` (label=`pieceLabel`) with 14 px `Text` (white fill, 2 px black stroke) + black `Graphics` roundRect backing; backing alpha: **0.45** in normal mode, **0.8** in high-contrast mode (AC-3); added via `sprite.addChildAt(label, 0)` per piece | `syncLabelRotation(sprite)` called each frame inside `tweenRotation` ticker to keep label upright during lift/snap-back tween | None |

### Vestibular Pillar

| Flag | Store default | Where set | Canvas effect | Ticker effect | DOM effect |
|---|---|---|---|---|---|
| `reducedMotion` | `window.matchMedia('(prefers-reduced-motion: reduce)').matches` at import time | `Preferences` / `setPreference` | `applyReducedMotion(active)` fully implemented (Story 37c): decelerate plugin friction set to `1.0` on enable (board stops instantly) / restored to `0.95` on disable; in-flight `animate` plugin cancelled on enable. Board-snap pulse skipped entirely when flag is set. Zoom-to-piece teleports to playable-area centre (`scale.set` → `moveCenter` with `trayOffset` → `decelerate.reset()`). Tray open/close snaps immediately. | `tweenRotation` ticker checks flag every tick — snaps to end rotation and self-removes. Drag lift and snap-back use explicit `if/else` branches (no tween when set). Tray animation ticker snaps `currentTrayHeight = targetTrayHeight` on first frame when flag is set. Visual tether ticker checks flag per tick — snaps sprite, cancels animate plugin, calls `completeZoomAnimation`. | None |

### Informational Pillar

| Feature | Source | DOM shape | Data source |
|---|---|---|---|
| Hidden ARIA piece list | `src/utils/aria.ts` | `role=list` container (`aria-label="Puzzle pieces"`), visually hidden via CSS clip rect; one `role=listitem` per piece, `id="piece-{piece.id}"` | `piece.gridCoord.row`, `piece.gridCoord.col`, `piece.state` |
| Piece index (visual label) | `src/utils/preferences.ts` `createPieceLabel` | PixiJS `Text` child of piece sprite; not in DOM | `piece.index` (1-based, l→r t→b, set in `cutter.ts`) |

---

## 2. Verified Repairs — Story 37d

Story 37d (High Contrast Core Repair) addressed four numbered accessibility criteria. All four are verified against source as of the 2026-04-05 commit.

### AC-1 — Sandwich Stroke (VERIFIED PASS)

**File:** `src/utils/preferences.ts:100–128`

`addSandwichStroke` creates two distinct `OutlineFilter` instances — separate fragment shader passes are mandatory for the visual effect:

```ts
const inner = new OutlineFilter({ thickness: 1.5, color: 0xffffff, quality: 0.15 });
const outer = new OutlineFilter({ thickness: 2.5, color: 0x000000, quality: 0.15 });
(inner as any)._tag = 'hc-sandwich';
(outer as any)._tag = 'hc-sandwich';
sprite.filters = [...(sprite.filters ?? []), inner, outer];
```

- Both instances are tagged `hc-sandwich` — required for clean removal (`removeSandwichStroke` calls `f.destroy()` to release GPU memory).
- **Filter order is preserved:** `BevelFilter` (set at sprite creation, index 0) → `inner` white 1.5px (index n-1) → `outer` black 2.5px (index n).
- Guard on line 102 prevents double-application: checks `sprite.filters?.some((f) => f._tag === 'hc-sandwich')` before proceeding.
- Called from `applyHighContrast` within the existing RAF-batch pattern (immediate below `BATCH_THRESHOLD = 200`, two-frame split above it).

**Pre-37d state:** A single `OutlineFilter` (green, 2px) tagged `highContrastOutline` was used. No sandwich separation, no BevelFilter ordering guarantee. The dead system was fully removed in 37d.

### AC-2 — Solid Tray (VERIFIED PASS)

**File:** `src/canvas/tray.ts:28–31, 183–186`

Constants (top of module):

```ts
const TRAY_BG_DEFAULT_COLOR = 0x1a1a1a;
const TRAY_BG_DEFAULT_ALPHA = 0.85;  // glass
const TRAY_BG_HC_COLOR      = 0x000000;
const TRAY_BG_HC_ALPHA      = 1.0;   // solid — AC-2
```

`redrawBackground()` applies them as a single rect:

```ts
const bgColor = highContrast ? TRAY_BG_HC_COLOR : TRAY_BG_DEFAULT_COLOR;
const bgAlpha = highContrast ? TRAY_BG_HC_ALPHA : TRAY_BG_DEFAULT_ALPHA;
_bg.rect(0, 0, w, h).fill({ color: bgColor, alpha: bgAlpha });
```

- **High contrast:** pure black `0x000000` at `alpha: 1.0` — no canvas bleed-through.
- **Normal mode:** `0x1a1a1a` at `alpha: 0.85` — deliberate glass effect.
- **Subscription wired:** `usePuzzleStore.subscribe` at `initTray:1281` fires `redrawBackground()` synchronously on every `highContrast` toggle (not deferred via the `applyFn` chain).
- **Idempotent:** `_unsubscribeHC?.()` called before resubscribing — prevents duplicates if `initTray` is called more than once.

**Pre-37d state:** The previous audit (§3) identified α 0.9 in HC mode as counter to accessibility best practice. This is now repaired — α 1.0 confirmed.

### AC-3 — Label Pill Backing (VERIFIED PASS)

**File:** `src/utils/preferences.ts:210–212, 265, 242`

```ts
const LABEL_BG_ALPHA_DEFAULT = 0.45;
const LABEL_BG_ALPHA_HC      = 0.8;  // solid enough in high contrast — AC-3

// In applyPieceLabels:
const bgAlpha = highContrast ? LABEL_BG_ALPHA_HC : LABEL_BG_ALPHA_DEFAULT;

// In createPieceLabel:
bg.roundRect(-tw / 2, -th / 2, tw, th, 2).fill({ color: 0x000000, alpha: bgAlpha });
```

- Black `Graphics` roundRect backing applied at `alpha: 0.8` **only when `highContrast: true`**.
- Normal mode uses `alpha: 0.45` (sufficient for most images).
- The `active && existing` update branch also calls `updateLabelBgAlpha(label, bgAlpha)` — backing is redrawn live when HC is toggled while labels are active.
- `updateLabelBgAlpha` uses deterministic structure: `getChildAt(0)` is always the `Graphics` bg, `getChildAt(1)` is always the `Text`.

**Pre-37d state:** Single `LABEL_BG_ALPHA = 0.45` constant — no differentiation for HC mode.

### AC-4 — Neon Magenta Snap (VERIFIED PASS)

**File:** `src/canvas/scene.ts:40–65`

```ts
const SNAP_HIGHLIGHT_COLOR_HC          = 0xff00ff; // neon magenta
const SNAP_HIGHLIGHT_ALPHA_HC          = 1.0;      // no partial opacity in HC
const SNAP_HIGHLIGHT_THICKNESS_HC      = 4;        // reserved — future stroke overlay

function updateSnapHighlight(highContrast: boolean, reducedMotion: boolean): void {
  if (reducedMotion) {
    _snapHighlightColor = SNAP_HIGHLIGHT_COLOR_HC;
    _snapHighlightAlpha = SNAP_HIGHLIGHT_ALPHA_HC;
    return;
  }
  _snapHighlightColor = highContrast ? SNAP_HIGHLIGHT_COLOR_HC : SNAP_HIGHLIGHT_COLOR_DEFAULT;
  _snapHighlightAlpha = highContrast ? SNAP_HIGHLIGHT_ALPHA_HC : SNAP_HIGHLIGHT_ALPHA_DEFAULT;
}
```

- `_snapHighlightColor` and `_snapHighlightAlpha` are module-level vars read by the board-snap pulse ticker at snap time (`pulseColor` / `pulseAlpha` snapshot at `scene.ts:280`).
- `reducedMotion` takes highest priority in `updateSnapHighlight` — even without an active stub, the snap remains maximally visible for vestibular users.
- `updateSnapHighlight` is called immediately after preferences load AND from the `usePuzzleStore.subscribe` handler on `highContrast` or `reducedMotion` change.
- **One gap:** `SNAP_HIGHLIGHT_THICKNESS_HC = 4` is defined (line 45) but is explicitly deferred — line 67 comment: "SNAP_HIGHLIGHT_THICKNESS_DEFAULT / _HC reserved for a future Graphics stroke overlay." The board-snap pulse does not yet apply a 4px border. This is a known partial implementation, not a regression.

**Pre-37d state:** Snap pulse used a hardcoded cycling green channel tint with no HC variant.

---

## 3. Logic Verification

### 3.1 reducedMotion: IMPLEMENTED (Story 37c)

`applyReducedMotion` in `preferences.ts` is fully implemented. The four animations now respect the flag:

| Animation | File | Duration | reducedMotion handling |
|---|---|---|---|
| Drag-lift rotation tween (1°) | `drag.ts` | 80 ms | Explicit `if/else` — snaps to `preDragRotation + LIFT_ROT`, calls `syncLabelRotation` |
| Snap-back to nearest 90° tween | `drag.ts` | 80 ms | Explicit `if/else` — snaps immediately, calls `syncLabelRotation` |
| Board-snap pulse (scale + tint) | `scene.ts` | 150 ms | Skipped entirely; per-tick bail-out for mid-pulse toggle |
| Zoom-to-piece viewport animation | `tray.ts` | 600 ms | Teleports: `scale.set` → `moveCenter` with `trayOffset` → `decelerate.reset()` |

Precision centering: zoom-to-piece teleport centres the piece in the playable area (above tray), not raw screen centre. `trayOffset = currentTrayHeight / 2 / viewport.scale.y` added to `piece.canonical.y` as the `moveCenter` Y argument.

### 3.2 Zoom-to-piece: matchMedia mismatch RESOLVED

`tray.ts` previously read `window.matchMedia` directly. Story 37c replaced all occurrences with `usePuzzleStore.getState().reducedMotion`. In-app toggle and OS-level setting are now equivalent.

### 3.3 Drag ticker: syncLabelRotation wiring (VERIFIED PASS)

`drag.ts:56` calls `syncLabelRotation(s)` inside the `tweenRotation` ticker, every frame:

```ts
for (const { sprite: s } of entries) { s.rotation = rot; syncLabelRotation(s); }
```

Labels remain upright throughout all rotation tweens (lift and snap-back). No separate counter-rotation needed in drag.ts.

---

## 4. Tray Background: Pre-37d Conflict (RESOLVED)

The previous audit (§3 in original) flagged that the high-contrast tray used `alpha: 0.9` — counter to the intent of HC mode, which requires fully opaque backgrounds.

**Story 37d resolved this.** Current state:

| Mode | Color | Alpha | Notes |
|---|---|---|---|
| Normal | `0x1a1a1a` | `0.85` | Deliberate "glass tray" — canvas content shows through |
| High contrast | `0x000000` | `1.0` | Solid — no canvas bleed-through (AC-2) |

Previously the tray used two separate rects (main bg + strip colour). 37d simplified to a single rect fill, removing the dead `TRAY_BG_COLOR`/`TRAY_STRIP_COLOR`/`TRAY_BG_HIGH_CONTRAST` constants.

---

## 5. ARIA Label Sync

### 5.1 Data sourcing (hallucination check)

`setAriaLabel` in `aria.ts` (updated Story 39):

```ts
`Piece ${piece.index} — Palette ${piece.paletteIndex + 1}, row ${piece.gridCoord.row + 1}, column ${piece.gridCoord.col + 1}, ${stageLabel}`
```

- Uses `piece.gridCoord.row` and `piece.gridCoord.col` ✓ — no `piece.row` reference.
- `piece.gridCoord` is defined in `types.ts` as `{ col: number; row: number }` ✓.
- State derived from `isInBench`/`isOnTable`/`isPlaced` helpers — no reference to removed `piece.state` field ✓.
- No reference to `piece.sprite` anywhere ✓.

### 5.2 State-transition gap

`initAriaLabels` is called once in `scene.ts` after `CUTS_COMPLETE`. `setAriaLabel` is **never called on state transitions** (bench → table → placed). The `setAriaLabel` docstring says "Call on every piece state transition" but no call site exists in `bench.ts` (extraction) or `snap.ts`/`scene.ts` (placement).

Screen readers announce the initial state correctly for all pieces, but will never announce that a piece has been extracted or placed. Must be wired as part of Story 40.

### 5.3 piece.index vs. ARIA label

The `pieceLabels` visual overlay uses `piece.index` (1-based sequential number). The ARIA label uses grid coordinates (`row+1, col+1`). These are consistent representations of the same position but expressed differently. This is intentional: sighted users see a number; screen readers announce a spatial coordinate. No conflict.

---

## 6. Hallucination Check — .jigg Spec Compliance

Audited all five source files against the `.jigg` spec constraints:

| Check | Result |
|---|---|
| No `piece.row` field | ✓ Confirmed — `types.ts` has `gridCoord: { col, row }`, no top-level `row` |
| No `piece.sprite` field | ✓ Confirmed — `grep` across all of `src/` returns zero matches for `piece.sprite`; sprites live exclusively in `spriteMap: Map<string, Sprite>` |
| `piece.gridCoord` used for ARIA | ✓ Confirmed — `aria.ts` reads `piece.gridCoord.row / .col` |
| `piece.index` used for labels | ✓ Confirmed — `cutter.ts` sets `index = row * cols + col + 1`; `preferences.ts` reads it |
| No `spriteMap` confusion | ✓ Confirmed — `applyHighContrast`, `applyGreyscale`, `applyPieceLabels` all take `Map<string, Sprite>` as explicit argument; no visual state accessed via `Piece` |
| sandwich filters destroyed on removal | ✓ Confirmed — `removeSandwichStroke` calls `f.destroy()` on each removed filter |

---

## 7. Known Constraints

### 7.1 Piece labels at low zoom (Visual)

Labels are rendered at 14 px and scale with the viewport. At zoom < 0.3× they become unreadable. `clampZoom` in `scene.ts` allows down to 0.05× — at that zoom a 14 px label renders at ~0.7 px.

```ts
// TODO: implement non-scaling labels
// Fix: on each ticker frame, label.scale = 1 / viewport.scale.x for all visible labels
```

### 7.2 Label GPU cost at high piece counts (Visual)

`PIXI.Text` generates one GPU texture per unique string. At 4×4 = 16 pieces this is negligible.

```ts
// TODO: swap PIXI.Text for BitmapText if piece count exceeds ~2000
```

### 7.3 Greyscale does not affect tray background (Visual)

`applyGreyscale` operates on the `spriteMap` (PixiJS sprites). The tray `Graphics` background and DOM elements (preference checkboxes, filter strip, ARIA container) are unaffected. Users who enable greyscale will still see coloured tray chrome and coloured color-zone swatches. The swatches have no greyscale fallback text label — zone identification relies solely on the mean color fill.

### 7.4 High contrast does not affect the board grid overlay (Visual)

`applyHighContrast` targets piece sprites only. The board grid overlay (`board.ts`) has no high-contrast variant — grid line color and opacity are static.

### 7.5 reducedMotion auto-detect fires once at module import (Vestibular)

```ts
const defaults: Preferences = {
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ...
};
```

Samples the media query **once at module evaluation time** and persists to `localStorage`. If the user changes their OS accessibility setting mid-session without reloading, the in-memory Zustand state will not update. A `MediaQueryList.addEventListener('change', ...)` listener would be needed for live-update support.

### 7.6 ARIA button labels update on state change (Informational)

Story 40: bench buttons call `updateButtonLabel(piece)` on state transitions. `removeButton` is called on extraction. Labels no longer go stale for bench→table transitions. Table and placed-piece labels deferred to Stories 41a/42.

### 7.7 No keyboard navigation on canvas (Informational)

Stories 38–42 (keyboard focus epic) are unscheduled beyond the spike in Story 38. The virtual cursor model is locked architecturally but not yet implemented. Canvas interactions (drag, rotate, snap) are pointer-only.

### 7.8 Snap thickness constant not yet wired (Visual)

`SNAP_HIGHLIGHT_THICKNESS_HC = 4` is defined in `scene.ts:45` but deferred (line 67: "reserved for a future Graphics stroke overlay"). The board-snap pulse currently applies only color and alpha from the HC variant. A 4px stroke border around the snap region is not yet rendered.

---

## 8. Remaining Gaps by Priority

| Priority | Issue | Story |
|---|---|---|
| P1 | Bench button labels update on extraction (Story 40 ✓); table/placed label updates deferred to Stories 41a/42 | Stories 41a/42 |
| P2 | Table keyboard navigation — canvas is pointer-only | Stories 41a/41b/42 |
| P2 | Snap pulse thickness not applied (`SNAP_HIGHLIGHT_THICKNESS_HC = 4` wired to nothing) | Post-37d follow-up |
| P3 | Labels unreadable below ~0.3× zoom | Post-launch (low priority) |
| P3 | Greyscale filter doesn't reach tray chrome or color-zone swatches | Story 37a follow-up |
| P3 | `reducedMotion` OS-change not detected live (only sampled at module load) | Post-37c follow-up |

**Resolved this session:**
- ~~P1: `applyReducedMotion` is a stub~~ — fully implemented (Story 37c)
- ~~P1: Zoom-to-piece reads `window.matchMedia` directly~~ — replaced with Zustand flag (Story 37c)

---

## 9. Keyboard Navigation Model

**Status:** Spec complete (Story 39). Implementation begins Story 40.
**Spike:** `docs/spike-keyboard-focus.md` (Story 38).

### 9.1 ARIA Landmark Structure

```html
<div role="application"
     aria-label="Piece bench — 5 Palette Groups"
     id="landmark-bench">
  <!-- hidden buttons for bench pieces -->
</div>
<div role="application"
     aria-label="Puzzle table — N pieces on table"
     id="landmark-table">
  <!-- hidden buttons for on-table pieces -->
</div>
```

`role="application"` suppresses AT shortcut keys — correct for canvas-driven widgets where the app owns all key events. `role="region"` does not suppress AT shortcuts. `role="grid"` carries implicit ARIA semantics (`gridcell`, `row`) that would need DOM mirroring — unnecessary complexity.

`#landmark-bench` DOM order before `#landmark-table` — natural tab flow from bench into table. No intermediary "switch region" button needed. When the bench is closed, bench buttons get `tabIndex="-1"` — the landmark is skipped in tab order.

### 9.2 ARIA Label Format — Single Pieces

```
"Piece {index} — Palette {paletteIndex + 1}, row {gridRow + 1}, column {gridCol + 1}, {stageLabel}"
```

Where `stageLabel`: `isInBench` → `"In bench"` / `isOnTable` → `"On table"` / `isPlaced` → `"Placed"`

Field order: `index` first (matches visual label), Palette second (bridges greyscale/auditory), grid coords third, state last.

### 9.3 ARIA Label Format — Clusters

```typescript
// ≤5 members — list piece numbers:
"Group of {n} — pieces {index1}, {index2}, {index3}, On table"

// >5 members — summarise spatially:
"Group of {n} — rows {minRow}–{maxRow}, columns {minCol}–{maxCol}, On table"
```

Cluster = single tab stop. Primary piece = lowest `PieceDefinition.index`. All other member buttons: `tabIndex="-1"`. Focus ring wraps full cluster AABB in screen space.

### 9.4 Key Binding Map

| Key | Bench mode | Table mode | Global |
|---|---|---|---|
| `Tab` | Next bench piece | Next table piece/cluster | — |
| `Shift+Tab` | Previous bench piece | Previous table piece/cluster | — |
| `Enter` / `Space` | Spiral extract | Pick up / put down | — |
| `]` | Next non-empty filter | — | — |
| `[` | Previous non-empty filter | — | — |
| `Escape` | Deselect, return to bench landmark | Drop held piece, return to table button | — |
| `R` | — | Rotate focused piece 90° CW | — |
| `T` | Switch to table | Switch to bench (if has pieces) | No-op if collapsed, empty, or holding a piece |
| `Shift+B` | Background cycle | Background cycle | Always |

`[`/`]` cycle the bench filter strip globally whenever the bench is open (handled in `scene.ts` window keydown, not on individual buttons). Skips empty filters. First press when no bench piece is focused cycles the filter and jumps focus to the first visible piece. Arrow keys are reserved for piece movement on the table (post-launch). Arrow key snap: no snap mid-movement. Snap evaluated on put-down (Enter/Space) only — matches pointer drag model.

`T` guards (all are no-ops, no state change, no sound):
- While holding a piece (`_heldRef.value !== null`)
- After permanent bench collapse (`_benchCollapsed === true`)
- When bench has no pieces (all extracted but collapse callback not yet fired)

`Enter` always triggers spiral extraction from bench. `zoomToPlacePiece()` is pointer-only. Dedicated zoom-preview key deferred post-launch.

`Enter` always triggers spiral extraction. `zoomToPlacePiece()` is pointer-only. Dedicated zoom-preview key deferred post-Story 42.

### 9.5 Stage Layer Order

```
app.stage children (render order):
  1. viewport          (world space  — zIndex: 0)
  2. benchContainer    (screen space — zIndex: 500)
  3. focusRing         (screen space — zIndex: 1000, always topmost)
```

`focusRing` added to `app.stage` after both `viewport` and `benchContainer`.

### 9.6 Focus Ring Specification

```typescript
const FOCUS_RING_COLOR     = 0xff00ff  // neon magenta — matches SNAP_HIGHLIGHT_COLOR_HC
const FOCUS_RING_THICKNESS = 2         // screen-space pixels, non-scaling
const FOCUS_RING_PADDING   = 4         // pixels outside piece bounding box
```

Single shared `Graphics` on `app.stage`, redrawn each frame at focused piece screen position. Non-scaling (screen space, not inside `viewport`). Table pieces: `viewport.toGlobal(sprite.getGlobalPosition())`. Bench pieces: `sprite.getGlobalPosition()` directly.

### 9.7 Story 40 Target API

```typescript
// src/utils/aria.ts
initLandmarks(): void
initBenchButtons(pieces: Piece[]): void
initTableButtons(pieces: Piece[]): void
updateButtonLabel(piece: Piece): void
removeButton(pieceId: string): void
setButtonTabIndex(pieceId: string, n: 0 | -1): void
focusButton(pieceId: string): void
scrollBenchToId(pieceId: string): void
```

### 9.8 Deferred

- **zoomToPlace preview key** — non-Enter key TBD post-Story 42
- **`aria-description` colour hint per palette group** — e.g. "Palette 1: predominantly blue". Requires HSL + colour naming heuristic. Post-launch.
- **Return-to-bench mechanic** — post-launch pending user feedback
- **`@jigg-spec` npm package** — publish when spec stabilises post-launch
