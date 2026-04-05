# Accessibility Audit — jigg.app

**Audit date:** 2026-04-05
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
| `highContrast` | `false` | `Preferences` / `setPreference` | BevelFilter `lightAlpha`/`shadowAlpha` ×1.8 (0.20 → 0.36); white `OutlineFilter` (thickness 2, tagged `highContrastOutline`) added to every sprite; `SNAP_HIGHLIGHT_OPACITY` 0.4 → 0.9; `SNAP_HIGHLIGHT_WIDTH` 2 → 4; tray bg `0x1a1a2e` → `0x1a1a1a` at α 0.9; color-zone swatches gain black border ring | None | None |
| `greyscale` | `false` | `Preferences` / `setPreference` | Luminance-weighted `ColorMatrixFilter` (0.299/0.587/0.114 ITU-R BT.601) added per sprite, tagged `greyscale`; strictly non-destructive — BevelFilter and OutlineFilter are preserved | None | None |
| `backgroundPreset` | `null` (adaptive) | `Preferences` / `setPreference` | `_app.renderer.background.color` set to preset hex or luminance-derived adaptive value (luminance < 100 → `0xf5f5f3` off-white; > 150 → `0x2a2a2a` charcoal; mid → `0x808080` gray) | None | DOM preset-button UI synced via `syncBgPresetUI()` |
| `pieceLabels` | `false` | `Preferences` / `setPreference` | PIXI `Container` (label=`pieceLabel`) with 14 px `Text` (white fill, 2 px black stroke) + semi-opaque `Graphics` roundRect backing (α 0.45) added via `sprite.addChildAt(label, 0)` per piece | `syncLabelRotation(sprite)` called each frame inside `tweenRotation` ticker to keep label upright during lift/snap-back tween | None |

### Vestibular Pillar

| Flag | Store default | Where set | Canvas effect | Ticker effect | DOM effect |
|---|---|---|---|---|---|
| `reducedMotion` | `window.matchMedia('(prefers-reduced-motion: reduce)').matches` at import time | `Preferences` / `setPreference` | **STUB** — `applyReducedMotion` has an empty body (`// TODO: Story 37c`). No canvas filters or property changes occur. | None — drag lift tween (`TWEEN_MS = 80 ms`), snap-back tween, board-snap pulse (150 ms), and zoom-to-piece tween (600 ms) are **all unaffected** by the Zustand flag | None |

### Informational Pillar

| Feature | Source | DOM shape | Data source |
|---|---|---|---|
| Hidden ARIA piece list | `src/utils/aria.ts` | `role=list` container (`aria-label="Puzzle pieces"`), visually hidden via CSS clip rect; one `role=listitem` per piece, `id="piece-{piece.id}"` | `piece.gridCoord.row`, `piece.gridCoord.col`, `piece.state` |
| Piece index (visual label) | `src/utils/preferences.ts` `createPieceLabel` | PixiJS `Text` child of piece sprite; not in DOM | `piece.index` (1-based, l→r t→b, set in `cutter.ts`) |

---

## 2. Logic Verification

### 2.1 reducedMotion: branching vs. duration:0

**Finding: The `reducedMotion` Zustand flag is not yet wired to any animation.**

`applyReducedMotion` in `preferences.ts` is an explicit stub:

```ts
/** Stub — implemented in Story 37c. */
export function applyReducedMotion(_active: boolean): void {
  // TODO: Story 37c
}
```

The four animations that must respect this flag when Story 37c ships:

| Animation | File | Duration | Current reducedMotion handling |
|---|---|---|---|
| Drag-lift rotation tween (1°) | `drag.ts:438,541` | 80 ms | None — always fires |
| Snap-back to nearest 90° tween | `drag.ts:249` | 80 ms | None — always fires |
| Board-snap pulse (scale + tint) | `scene.ts:246` | 150 ms | None — always fires |
| Zoom-to-piece viewport animation | `tray.ts:826` | 600 ms | Reads `window.matchMedia` directly, **not** the Zustand flag (see §2.2) |

**Good news:** None of the animations use a `duration: 0` hack. All use fixed positive denominators (`TWEEN_MS = 80`, `DURATION_MS = 150`, `ANIM_DURATION = 600`), so there is **no risk of NaN or Infinity** from a divide-by-zero when the flag ships. Story 37c should use explicit `if/else` branching (skip the animation block entirely, or jump to end-state immediately) — never set a duration to 0.

### 2.2 Zoom-to-piece: matchMedia vs. Zustand flag mismatch

`tray.ts:826` reads the OS-level media query directly:

```ts
// TODO: replace matchMedia check with Story 37 reducedMotion Zustand flag when it ships
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  // jump directly, no animation
}
```

This means:
- A user who sets `reducedMotion: true` via the in-app checkbox will **not** have zoom-to-piece animations suppressed.
- A user whose OS has reduced motion enabled will have zoom-to-piece suppressed **but** the in-app checkbox is redundant for this path.

When Story 37c ships, this must be replaced with `usePuzzleStore.getState().reducedMotion`.

---

## 3. The "Glass Tray" Conflict

**Tray background in normal mode** (`highContrast: false`):

```ts
_bg.rect(0, 0, w, h).fill({ color: TRAY_BG_COLOR }); // 0x1a1a2e, α implicit 1.0
_bg.rect(0, 0, w, TRAY_HEIGHT_CLOSED).fill({ color: TRAY_STRIP_COLOR }); // 0x16213e
```

The tray is **fully opaque** (α 1.0) in normal mode — there is no glass/translucency effect in the current implementation.

**Tray background in high-contrast mode** (`highContrast: true`):

```ts
_bg.rect(0, 0, w, h).fill({ color: TRAY_BG_HIGH_CONTRAST, alpha: 0.9 }); // 0x1a1a1a
_bg.rect(0, 0, w, TRAY_HEIGHT_CLOSED).fill({ color: TRAY_BG_HIGH_CONTRAST, alpha: 0.9 });
```

**Finding:** The tray uses α 0.9 in high-contrast mode, making it *marginally more transparent* than in normal mode (α 1.0). This is counter to accessibility best practice: high-contrast mode should maximise foreground/background separation, which requires the background to be **fully opaque** (α 1.0). Canvas content bleeding through at 10% will reduce contrast for users who need it most.

**Recommendation for Story 37a follow-up:** Change the high-contrast fill to `alpha: 1` (or omit the alpha key to default to 1.0).

---

## 4. ARIA Label Sync

### 4.1 Data sourcing (hallucination check)

`setAriaLabel` in `aria.ts`:

```ts
`Piece row ${piece.gridCoord.row + 1}, column ${piece.gridCoord.col + 1} — ${stateLabel}`
```

- Uses `piece.gridCoord.row` and `piece.gridCoord.col` ✓ — no `piece.row` reference
- `piece.gridCoord` is defined in `types.ts` as `{ col: number; row: number }` ✓
- No reference to `piece.sprite` anywhere ✓ — spec-correct

### 4.2 State-transition gap

`initAriaLabels` is called once in `scene.ts` after `CUTS_COMPLETE`. However, `setAriaLabel` is **never called on state transitions** (in-tray → on-canvas → placed). The `setAriaLabel` docstring explicitly says "Call on every piece state transition" but no call site exists in `tray.ts` (extraction) or `snap.ts`/`scene.ts` (placement).

Screen readers will announce the initial state for all pieces correctly, but will never announce that a piece has been extracted or placed. This must be wired as part of Story 38 (keyboard focus spike) or earlier.

### 4.3 piece.index vs. ARIA label

The `pieceLabels` visual overlay uses `piece.index` (1-based sequential number). The ARIA label uses grid coordinates (`row+1, col+1`). These are consistent representations of the same position but worded differently. This is intentional: sighted users see a number; screen readers announce a spatial coordinate. No conflict.

---

## 5. Hallucination Check — .jigg Spec Compliance

Audited all five source files against the `.jigg` spec constraints:

| Check | Result |
|---|---|
| No `piece.row` field | ✓ Confirmed — `types.ts` has `gridCoord: { col, row }`, no top-level `row` |
| No `piece.sprite` field | ✓ Confirmed — sprites live in `spriteMap: Map<string, Sprite>`, never on `Piece` |
| `piece.gridCoord` used for ARIA | ✓ Confirmed — `aria.ts` reads `piece.gridCoord.row / .col` |
| `piece.index` used for labels | ✓ Confirmed — `cutter.ts` sets `index = row * cols + col + 1`; `preferences.ts` reads it |
| No `spriteMap` confusion | ✓ Confirmed — `applyPreferences`, `applyHighContrast`, `applyGreyscale`, `applyPieceLabels` all take `Map<string, Sprite>` as an explicit argument; no property access on `Piece` for visual state |

---

## 6. Known Constraints

### 6.1 Piece labels at low zoom (Visual)

Labels are rendered at a fixed 14 px font size and scale with the viewport. At viewport zoom < 0.3× labels become unreadable. There is a `TODO` comment in `createPieceLabel` (`preferences.ts:203`):

```ts
// TODO: implement non-scaling labels
// At low viewport zoom (<0.3x) labels become unreadable
// Fix: on each ticker frame, label.scale = 1 / viewport.scale.x for all visible labels
// Only worth implementing if user feedback confirms this is a real pain point
```

The `clampZoom` in `scene.ts` allows zoom down to 0.05×. At that zoom level, a 14 px label renders at ~0.7 px — completely invisible.

### 6.2 Label GPU cost at high piece counts (Visual)

`PIXI.Text` generates one GPU texture per unique string. At current 4×4 = 16 pieces this is negligible. A `TODO` in `preferences.ts:196` flags this:

```ts
// TODO: swap PIXI.Text for BitmapText if piece count exceeds ~2000
```

Relevant if jigg scales to user-defined grid sizes.

### 6.3 Greyscale does not affect tray background (Visual)

`applyGreyscale` operates on the `spriteMap` (PixiJS sprites). The tray `Graphics` background and HTML DOM elements (preference checkboxes, filter strip, ARIA container) are unaffected. Users who enable greyscale will still see the coloured tray chrome and colored color-zone swatches. The swatches have no greyscale fallback text label — zone identification relies solely on the mean color fill.

### 6.4 High contrast does not affect the board grid overlay (Visual)

`applyHighContrast` targets piece sprites only. The board grid overlay (`board.ts`) has no high-contrast variant — grid line color and opacity are static.

### 6.5 reducedMotion auto-detect fires once at module import (Vestibular)

```ts
const defaults: Preferences = {
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ...
};
```

This samples the media query **once at module evaluation time** and persists it to `localStorage`. If a user changes their OS accessibility setting mid-session without reloading, the in-memory Zustand state will not update. A `MediaQueryList.addEventListener('change', ...)` listener would be needed for live-update support.

### 6.6 ARIA list is never updated after initial load (Informational)

`setAriaLabel` must be called on every `piece.state` transition. Until Story 38 wires this up, screen-reader users hear stale state ("In tray") for pieces that have since been extracted or placed.

### 6.7 No keyboard navigation on canvas (Informational)

Stories 38–42 (keyboard focus epic) are unscheduled beyond the spike in Story 38. The virtual cursor model is locked architecturally but not yet implemented. Canvas interactions (drag, rotate, snap) are pointer-only.

---

## 7. Summary: Open Work by Priority

| Priority | Issue | Story |
|---|---|---|
| P1 | `applyReducedMotion` is a stub — all four canvas animations ignore the flag | Story 37c |
| P1 | zoom-to-piece reads `matchMedia` directly, not Zustand `reducedMotion` flag | Story 37c |
| P1 | `setAriaLabel` never called on state transitions — screen reader state is stale | Story 38 |
| P2 | High-contrast tray background uses α 0.9 instead of α 1.0 | Story 37a follow-up |
| P2 | No keyboard navigation — canvas is pointer-only | Stories 38–42 |
| P3 | Labels unreadable below ~0.3× zoom | Post-launch (low priority) |
| P3 | Greyscale filter doesn't reach tray chrome or color-zone swatches | Story 37a follow-up |
| P3 | `reducedMotion` OS-change not detected live (only sampled at module load) | Story 37c |
