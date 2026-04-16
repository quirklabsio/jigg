# Accessibility

Last audited: 2026-04-16 (Stories 37a–42c complete)

---

## Screen reader support

### Landmarks

Two `role="application"` divs prepended to `<body>` (DOM order: bench first, table second):

```html
<div role="application" aria-label="Piece tray"   id="landmark-bench" tabindex="-1">
<div role="application" aria-label="Puzzle table" id="landmark-table" tabindex="-1">
```

`role="application"` suppresses AT shortcut keys so the app owns all key events.
Both landmarks are visually hidden (clip-rect). `inert` mode switching via `setKeyboardMode(mode)` in `scene.ts`:

- bench mode: `#landmark-bench.inert = false`, `#landmark-table.inert = true`
- table mode: `#landmark-bench.inert = true`, `#landmark-table.inert = false`

`applyBenchTabState(mode)` belt-and-suspenders sweep on every mode switch: forces all bench
buttons to `tabIndex=-1` when table mode is active, regardless of filter visibility.

### Button label formats

**Bench buttons** — classification only (Story 42a):

- `"Corner piece"` / `"Edge piece"` / `"Interior piece"` — derived from `piece.edgeType`

**Table buttons** — state only (Story 42a):

- `"Piece"` — lone on-table piece (default on creation)
- `"Group of N"` — cluster primary (lowest `piece.index` in cluster)
- `"Held"` — while picked up via keyboard
- `"Placed"` — after board snap completes

Non-primary cluster members remain in the `_buttonMap` with `tabIndex=-1` and label `"Piece"`.

### Filter radiogroup

`role="radiogroup"` div inside `#landmark-bench`, after all piece buttons. Each filter
entry is a `role="radio"` button with `tabIndex=-1` (mouse-only — keyboard users cycle
via `]`/`[`). Labels: `"Corners filter, 4 pieces"` / `"Corners filter, empty"` /
`"Corners filter, empty, currently selected"`. `aria-checked` synced on every filter change.
Empty inactive filters: `disabled=true`.

### Live region

`aria-live="polite"` + `aria-atomic="true"` region appended to `<body>` once in
`initLandmarks()`. Announcements are debounced (latest wins) via `announce(text)` in
`aria.ts`. Triggers:

| Event | Announcement |
|---|---|
| Filter change | `"Corners"` / `"Edges"` / `"Interior"` / `"All pieces"` / `"Palette N"` |
| Keyboard extraction | `"Activated"` |
| Pick up | `"Picked up"` |
| Drop (Escape) | `"Dropped"` |
| Board snap (place) | `"Placed"` |
| Puzzle complete | `"Puzzle complete"` |
| T key (close tray) | `"Puzzle table"` |
| T key (open tray) | `"Piece tray"` |

### Focus safety

`redirectFocusIfActive(el, fallback)` in `aria.ts` — checks `document.activeElement === el`;
if true, calls `fallback.focus()`. Applied at bench collapse: if `_benchStripHandle` is
focused when the last piece leaves the bench, focus moves to `#landmark-table` before the
handle is hidden and removed from tab order.

---

## Keyboard shortcuts

| Key | Bench context | Table context | Global |
|---|---|---|---|
| `Tab` | Next bench piece | Next table piece/cluster | — |
| `Shift+Tab` | Previous bench piece | Previous table piece/cluster | — |
| `Enter` | Move piece to table (spiral) | Pick up / put down | — |
| `Space` | Move piece to table (spiral) | Pick up / put down | — |
| `]` | Next non-empty filter | — | — |
| `[` | Previous non-empty filter | — | — |
| `Escape` | Deselect + return to bench landmark | Drop held piece + return to table button | Closes `?` panel if open |
| `R` | — | Rotate focused piece/cluster 90° CW | — |
| `T` | Switch to table | Switch to bench (if bench open) | No-op: bench collapsed / bench empty / holding piece |
| `Shift+B` | Cycle background | Cycle background | Always |
| `?` | Toggle shortcuts panel | Toggle shortcuts panel | Always |

**T key hint:** small fixed overlay (`bottom:50px right:12px`, monospace, `z-index:601`).
Hidden until first keyboard interaction. Four states:
1. Hidden — before first keyboard interaction
2. `"T → table"` — bench mode, bench exists
3. `"T → piece tray"` — table mode, bench exists
4. Hidden — bench permanently collapsed (all pieces extracted)

**`?` panel** (`src/canvas/shortcuts.ts`): `role="dialog"`, `aria-modal="true"`,
`aria-label="Keyboard shortcuts"`. Focus trap — Tab cycles to close button only. Focus
restored to `document.activeElement` on close. Escape and `?` both close. Backdrop click
closes. Wired in `scene.ts` via `initShortcutsPanel()` + `toggleShortcutsPanel()`.

---

## Visual accessibility

### Reduced motion

`prefers-reduced-motion: reduce` sampled **once** at module import in `preferences.ts`;
default value for the Zustand `reducedMotion` flag. In-app toggle also available.

Four animations respect the flag (`applyReducedMotion` in `preferences.ts`):

| Animation | File | Normal | Reduced motion |
|---|---|---|---|
| Drag-lift rotation tween (1°) | `drag.ts` | 80 ms ease | Snaps immediately |
| Snap-back to nearest 90° | `drag.ts` | 80 ms ease | Snaps immediately |
| Board-snap pulse (scale + tint) | `scene.ts` | 150 ms | Skipped entirely |
| Zoom-to-piece viewport animation | `tray.ts` | 600 ms | `scale.set` + `moveCenter` (teleport) |

Decelerate friction set to `1.0` on enable (board stops instantly); restored to `0.95` on
disable. In-flight `animate` plugin cancelled immediately on enable.

### High contrast

App-level toggle (`highContrast: boolean` in Zustand store). **Not** a response to the
CSS `forced-colors` media query — no `@media (forced-colors: active)` rules exist.

Four repairs (Story 37d), all verified:

| Repair | File | Detail |
|---|---|---|
| AC-1 Sandwich stroke | `preferences.ts` | Two `OutlineFilter` instances: white 1.5px + black 2.5px, both tagged `hc-sandwich`. BevelFilter stays at index 0. GPU memory freed on removal via `f.destroy()`. |
| AC-2 Solid tray | `tray.ts` | `TRAY_BG_HC_COLOR = 0x000000`, `TRAY_BG_HC_ALPHA = 1.0`. Subscription in `initTray` redraws synchronously on toggle. |
| AC-3 Label pill backing | `preferences.ts` | `LABEL_BG_ALPHA_HC = 0.8` (vs `0.45` default). Redrawn live via `updateLabelBgAlpha` when HC toggled while labels active. |
| AC-4 Neon magenta snap | `scene.ts` | `SNAP_HIGHLIGHT_COLOR_HC = 0xff00ff`, `SNAP_HIGHLIGHT_ALPHA_HC = 1.0`. `reducedMotion` takes priority (also forces magenta). |

Focus ring: always neon magenta `0xff00ff`, 2px, screen-space `Graphics` on `app.stage`
at `zIndex: 1000`. Non-scaling. Redrawn each frame at focused piece's screen position.
Wraps full cluster AABB for clusters. Active in both bench and table modes.

### Greyscale and zone labeling

App-level toggle (`greyscale: boolean` in Zustand store).

- ITU-R BT.601 `ColorMatrixFilter` (weights 0.299 / 0.587 / 0.114) applied per sprite,
  tagged `greyscale`. Non-destructive — BevelFilter and sandwich stroke preserved.
- Filter strip palette swatches gain `P1`–`P5` text labels when greyscale is active
  (`addZoneLabel` in `bench.ts`). Glowing dot hidden on active swatch in greyscale mode.
- Snap highlight excluded from greyscale ("Sin City" effect) — `ColorMatrixFilter` is
  not applied to the snap pulse overlay.

---

## Known gaps

- **No `forced-colors` support.** The app has no CSS `@media (forced-colors: active)` rules.
  Users with Windows High Contrast mode or other forced-colors environments get browser
  defaults, not the app's HC theme. The HC toggle must be enabled manually.
- **`SNAP_HIGHLIGHT_THICKNESS_HC = 4` not wired.** Constant defined in `scene.ts:45` but
  no rendered stroke uses it. Board-snap pulse applies color and alpha only.
- **`reducedMotion` not live.** Sampled once at module import. OS accessibility setting
  changed mid-session without page reload will not update the in-memory flag.
- **Greyscale does not reach tray chrome.** `applyGreyscale` targets `spriteMap` (PixiJS
  sprites) only. Tray background, DOM preference checkboxes, and filter strip backgrounds
  remain coloured.
- **Piece labels unreadable at low zoom.** Visual piece-number labels (`piece.index`,
  PixiJS `Text`) render at ~14px and scale with viewport. Below ~0.3× zoom they become
  illegible. `clampZoom` allows down to 0.05×.
- **Arrow key movement not implemented.** Keyboard piece movement (incremental grid-aligned
  steps while held) was not shipped. Enter picks up and puts down; no mid-hold movement.
- **Roadmap discrepancy on Stories 41a/41b.** Roadmap shows both `[ ]` (unchecked) but
  session notes and source confirm pick-up/put-down, cluster tab stops, R rotate, and
  escape-drop are all implemented. Arrow-key movement (the unbuilt part) is what remains.

---

## Deferred

- **Arrow key piece movement** — incremental grid-aligned movement while a piece is held.
  No snap mid-movement; snap evaluates on put-down. Explicitly deferred post-launch.
- **Return-to-tray** — deferred pending user feedback post-launch. No architectural
  constraints block a later implementation.
- **Zoom-to-piece preview key** — keyboard shortcut to show a piece's correct board
  position without extracting it. `Enter` always triggers spiral extraction. Deferred
  post-launch; key TBD.
- **`aria-description` colour hint per palette group** — e.g. "Palette 1: predominantly
  blue". Requires HSL + colour-naming heuristic. Post-launch.
- **`reducedMotion` live OS-change detection** — `MediaQueryList.addEventListener`
  listener not added. Post-launch, P3.
- **Non-scaling piece labels** — label text stays readable at all zoom levels by
  counter-scaling each frame. Post-launch, P3.
