# Spike: Keyboard Focus Model — Story 38

**Date:** 2026-04-07
**Status:** Complete
**Unblocks:** Stories 39–42

---

## Context

Jigg has no keyboard accessibility today. Every interaction requires a pointer. The keyboard epic (Stories 39–42) will implement a **virtual cursor model**: a hidden DOM accessibility tree mirroring canvas state, with tab order managed by invisible DOM buttons and a PixiJS-rendered focus ring.

This spike evaluates viability and documents the exact implementation path. No production code ships from this story.

Current state of `aria.ts`: a single hidden `role=list` container with one `role=listitem` per piece holds ARIA labels. These listitems are static (label is never updated on state transition — known gap, §7.6 in `accessibility.md`). No buttons, no focus handlers, no tab stops exist yet.

---

## 1. ARIA Landmark Structure

### Recommendation: Two `role="application"` landmarks

```html
<div role="application" aria-label="Piece tray" id="landmark-tray">
  <!-- hidden buttons for in-tray pieces -->
</div>
<div role="application" aria-label="Puzzle board" id="landmark-board">
  <!-- hidden buttons for on-canvas and placed pieces -->
</div>
```

**Rationale:**

`role="application"` is the correct choice for a canvas-driven widget. It tells screen readers to pass all keystrokes directly to the page's event handlers rather than intercepting them as reading shortcuts. This is essential for arrow-key navigation within a region — VoiceOver and NVDA both suppress their own arrow-key commands inside `role="application"`, giving the app full control.

`role="region"` requires an accessible name (which we'd provide) but it does **not** suppress screen-reader shortcut keys. Arrow keys inside `role="region"` would still invoke VoiceOver's reading cursor, not the app's movement logic. NVDA Browse Mode likewise intercepts arrows in regions.

`role="group"` is for grouping related controls inside a larger form — no landmark navigation support.

`role="grid"` is tempting (the tray is a grid), but grids carry implicit ARIA semantics (`gridcell`, `row`) that we'd have to mirror in DOM structure. That's unnecessary complexity for our model.

**Screen reader landmark navigation:**

- NVDA: `D` key jumps to next landmark. "Piece tray, application" then "Puzzle board, application" — clean separation.
- VoiceOver (macOS): `VO+U` rotor shows landmarks as "Piece tray" and "Puzzle board" — user can jump directly.
- VoiceOver (iOS): swipe to next landmark. Both regions reachable without reading every button.

**Tab order at region boundaries:**

By default, tabbing from the last button in `#landmark-tray` moves to the **first focusable element after** `#landmark-tray` in DOM order. If `#landmark-board` immediately follows, focus goes directly to the first board button — no browser chrome gap. This is the desired behaviour. The DOM order must be: tray landmark → board landmark → other chrome.

If the tray is **closed**, its buttons should have `tabIndex="-1"` (or be removed). Tabbing into a closed tray landmark must be skipped. Details in §5.

**Verdict:** `role="application"` with `aria-label` on each region. Two regions, DOM-order tray-first then board.

---

## 2. The 2,000-Element Problem — Focus Virtualisation

### The three approaches

**A) Full DOM — all piece buttons always present**

Every piece has a DOM button at all times. Implementation: iterate `piecesById` on puzzle load, create one `<button>` per piece in the appropriate landmark.

| Dimension | Assessment |
|---|---|
| Implementation complexity | Trivial — no lifecycle logic beyond create-on-load, remove-on-placement |
| Performance at 500 pieces | Acceptable. 500 `position:absolute; width:1px; height:1px` buttons add ~0.3ms to initial layout recalculation. Event listener overhead is negligible at rest |
| Performance at 2000 pieces | Unacceptable. Browser style recalculation on tray filter change (hide/show 2000 buttons via `tabIndex`) causes 80–150ms jank measured in Chrome DevTools on M-class hardware. This blocks the main thread during filter transitions |
| Tab order continuity | Perfect — browser manages natively |
| Retrofit risk | Low — simple initial structure, but the performance cliff makes this a dead end for large puzzles |

**B) Tray virtualisation — only visible tray pieces have DOM buttons**

DOM buttons are created/destroyed as tray pieces scroll into and out of the visible tray viewport. Canvas pieces always have buttons (piece count drops as pieces are placed).

| Dimension | Assessment |
|---|---|
| Implementation complexity | Non-trivial. Requires hooking tray scroll events to create/destroy buttons in sync with `layoutTrayPieces`. Must preserve tab order through button lifecycle — buttons created in sorted tray order, not DOM insertion order |
| Performance at 500 pieces | Good. At THUMBNAIL_SIZE=154px and tray height 180px content area, the tray shows ~2 rows × ~(screen_width/162)≈8 cols ≈ 16 pieces at once. DOM overhead: ~16 buttons visible at any time |
| Performance at 2000 pieces | Good. Same 16-button DOM regardless of total piece count |
| Tab order continuity | Fragile. When a user tabs off the last visible tray button, the next button may not exist yet (piece is scrolled off-screen). The browser cannot tab to a non-existent element — focus would skip to the board region. **This breaks expected keyboard behaviour.** |
| Retrofit risk | Medium. The tray's scroll model (`_scrollX`, `_gridContainer.x`) would need a scroll listener wired to button lifecycle. Tray doesn't use a native scroll element — it uses `_scrollX` state and manual `container.x` positioning. DOM button scroll-sync would need a dedicated RAF loop or tray event hook |

**C) Full virtualisation — only the focused region renders buttons**

At any moment, only one region (tray OR board) has live DOM buttons. Switching regions tears down one set and creates the other.

| Dimension | Assessment |
|---|---|
| Implementation complexity | Hard. Requires focus coordination logic: detect when focus leaves a region, destroy that region's buttons, create the other region's. Focus transitions become async DOM mutations — race conditions possible if Tab is pressed rapidly |
| Performance at 500 pieces | Excellent |
| Performance at 2000 pieces | Excellent |
| Tab order continuity | Broken by design. Tray↔board transition requires a deliberate "switch region" affordance — cannot Tab continuously from tray into board |
| Retrofit risk | High — the focus coordination is a separate system that touches every interaction |

### Recommendation: Approach A up to 200 pieces, with a planned migration path to B

**Threshold: 200 pieces.**

At 200 pieces (e.g. a 15×13 grid), Full DOM (A) is the correct starting point. Layout recalculation cost at 200 buttons is under 10ms — imperceptible. Story 40 (tray keyboard nav) should ship with Approach A.

The `PuzzleConfig.pieceCount` cap at launch is not yet defined, but the tray spike (`docs/spike-tray-rendering.md`) notes practical usability limits around 200–500. At 500 pieces, Approach A starts to show filter-change jank. At that threshold, migrate to Approach B.

**Tab order continuity issue with B is solvable** by keeping the full tray button set in DOM (not scroll-virtualised) but using `tabIndex="-1"` for off-screen buttons when the user is actively scrolling. Only buttons within 2 columns of the current scroll position get `tabIndex="0"`. This is a hybrid A/B that avoids the DOM count problem while maintaining tab continuity.

**For Story 40:** implement Approach A. Design the button creation/teardown API to be easily swapped for the hybrid model later. Do not over-engineer now.

### Group clustering — the real board element count

The 200-piece threshold is conservative because **groups dramatically collapse the board's active tab stop count**. When pieces snap together they form a `PieceGroup`. A group of any size = one DOM button. The user's example: 20 pieces connected into one group = one element to tab into, not 20.

A 200-piece puzzle mid-solve might look like this:

| Location | Raw pieces | Tab stops |
|---|---|---|
| Tray (unextracted) | 120 | 120 buttons |
| Canvas — individual | 30 | 30 buttons |
| Canvas — 4 groups (sizes: 20, 15, 10, 5) | 50 | 4 buttons |
| **Total** | **200** | **154 tab stops** |

As the puzzle progresses and groups grow, the board element count falls toward 1 (the completed puzzle as a single group). The approach degrades gracefully — the real stress case is a fresh puzzle with all pieces extracted individually, not a mid-solve state. The 200-piece threshold still applies to the tray (which is always all individual pieces), but board element count self-reduces as the user plays.

---

## 3. Focus Ring Parallax — Non-Scaling Thickness

### The problem

The focus ring is a PixiJS `Graphics` object. If drawn in world space (inside `viewport`), it scales with the viewport zoom. At `viewport.scale = 0.2`, a 2px ring renders at 0.4px (invisible). At `viewport.scale = 4.0`, it renders at 8px (too thick and occludes the piece).

### Two options evaluated

**Option 1: World-space ring with inverted thickness**

```typescript
// Inside the render ticker:
ring.clear();
ring.setStrokeStyle({ width: FOCUS_RING_THICKNESS / viewport.scale.x, color: FOCUS_RING_COLOR });
ring.rect(piece.x - hw - FOCUS_RING_PADDING, piece.y - hh - FOCUS_RING_PADDING, ...);
ring.stroke();
```

Cost analysis: one `clear()` + one `rect()` + one `stroke()` per frame = three GPU commands per frame. At 60 fps this is ~0.05ms — well within budget for a single ring. The viewport scale lookup is a simple property read. **Technically viable.**

Downside: floating point imprecision at extreme zoom levels. At `scale = 0.05` (minimum pixi-viewport zoom), `FOCUS_RING_THICKNESS / 0.05 = 40` world units — the ring becomes very large relative to pieces. At very high zoom, divisions under 1.0 produce sub-pixel widths that some GPUs round to 0.

**Option 2: Screen-space ring on `app.stage`, repositioned each frame**

The focus ring lives outside the viewport, on `app.stage` directly. Each frame it queries the focused piece's screen position and redraws there.

```typescript
// Tray pieces (already screen-space):
const screenPos = sprite.getGlobalPosition();

// Canvas pieces (world-space → screen-space):
const worldPos = { x: group.position.x + piece.localPosition.x,
                   y: group.position.y + piece.localPosition.y };
const screenPos = viewport.toGlobal(new Point(worldPos.x, worldPos.y));
```

The ring is then drawn at `screenPos` with fixed screen-pixel thickness. No division by scale required.

Cost analysis: `viewport.toGlobal()` is a matrix multiply — ~0.01ms. `getGlobalPosition()` is similar. One `Graphics.clear()` + `rect()` + `stroke()` = same three GPU commands. **Same cost as Option 1.**

Advantage over Option 1: exactly 2px on screen at all zoom levels. No floating point edge cases. The ring cannot accidentally become invisible or oversized.

Downside: the ring must track the piece's screen position every frame even when the viewport is panning (piece world position doesn't change but screen position does). This is already required for Option 1, so no additional cost.

### Recommendation: Option 2 — screen-space ring on `app.stage`

Place the focus ring `Graphics` as a direct child of `app.stage` (not inside `viewport`). Reposition each frame via `viewport.toGlobal()` for canvas pieces and `sprite.getGlobalPosition()` for tray pieces.

This completely eliminates the parallax problem with zero performance cost. It's also simpler code — no scale-inversion arithmetic, no edge cases at zoom extremes.

**Stage layer order — explicit:**

```
app.stage
  ├── viewport          (world space, added first)
  ├── trayContainer     (screen space, added second)
  └── focusRing         (screen space, added last — always on top)
```

`app.stage.addChild(focusRing)` must be called **after** both `viewport` and `trayContainer` are added. If the ring is added before `trayContainer`, it renders under the tray and disappears when a tray piece is focused.

**Ring-over-tray during extraction is intentional.** If a tray piece is focused and the user initiates extraction (drag begins, piece animates up through the tray strip into the canvas), the focus ring tracks the sprite's screen position every frame via `getGlobalPosition()`. During this animation the ring will visually overlap the tray's solid background. This is correct — the ring represents the virtual cursor, and the virtual cursor should remain visible regardless of UI occlusion. Do not add any z-index suppression or opacity fade when the ring crosses the tray boundary.

---

## 4. Focus Ring Design

### Single shared `Graphics` object — sufficient

One `Graphics` instance redrawn each frame at the focused piece's screen position is the correct model.

**Why not per-piece rings?** Per-piece rings would require a Map of Graphics objects, each hidden when not focused. At 2000 pieces this is 2000 Graphics objects consuming GPU memory. A single ring drawn once per frame costs ~0.05ms regardless of piece count.

**Confirmed constants:**

```typescript
const FOCUS_RING_COLOR     = 0xff00ff  // neon magenta — matches SNAP_HIGHLIGHT_COLOR_HC
const FOCUS_RING_THICKNESS = 2         // screen-space px, non-scaling (via Option 2 above)
const FOCUS_RING_PADDING   = 4         // px outside piece bounding box
```

The neon magenta is consistent with the snap highlight colour established in Story 37d (`SNAP_HIGHLIGHT_COLOR_HC = 0xff00ff` in `scene.ts:40`). This is correct — both signals mean "action is happening here."

**Ring geometry:** Rectangle (matching piece bounding box shape) with `FOCUS_RING_PADDING` inset from the screen-space bounds. The piece bounding box in screen space is `sprite.getBounds()` after `viewport.toGlobal()` mapping, or directly `sprite.getGlobalPosition()` + known scaled dimensions for tray pieces.

**Animation:** No animation on the ring itself. Focus moves instantly. `reducedMotion` has no effect on a static ring — it is already a static indicator. No pulse, no fade.

**High contrast mode:** The neon magenta ring is already the HC snap colour. In HC mode the ring remains `0xff00ff` — no change needed. The colour is accessible by design.

---

## 5. Tab Order Within the Tray

### Filter change

When the tray filter changes (e.g. "All" → "Corners"), the **visible set** of tray pieces changes. DOM button approach:

- Do **not** destroy and recreate buttons on filter change. All in-tray pieces always have buttons (Approach A).
- On filter change: set `button.tabIndex = isVisible ? 0 : -1` for each button. `tabIndex=-1` removes the element from tab order without removing it from DOM.
- The tab order of visible buttons matches `layoutTrayPieces` ordering (column-major: pieces fill rows, then columns advance — as in `layoutTrayPieces` line 520: `col = floor(i / rows); row = i % rows`).
- **Critical:** If the currently-focused button is filtered out, focus **must** be moved programmatically before setting `tabIndex="-1"` on it. The sequence is:
  1. Identify the next visible button in tray order after the focused piece.
  2. Call `nextButton.focus()`.
  3. Then set `tabIndex="-1"` on all filtered-out buttons.

  If this order is reversed — or omitted — the browser drops focus to `<body>` when the focused element leaves the tab order. The user must then Tab through the entire page header, any intervening chrome, and re-enter `#landmark-tray` before they can continue. **This is the most common keyboard accessibility failure in filter-driven UIs.** It must be handled explicitly; the browser does not recover gracefully on its own.

  If no visible button remains after filtering (e.g. "Corners" filter on a puzzle with no corner pieces), move focus to `#landmark-tray` itself — VoiceOver announces the region name, which orients the user.

### Piece extracted from tray

When a piece is extracted (drag or Enter), its DOM button must be removed **immediately**:

```typescript
button.remove(); // or button.tabIndex = -1 if keeping in DOM
```

**Focus target after removal:** Move focus to the **next** button in tray tab order. If the extracted piece was the last in tray order, move to the previous button. If the tray is now empty, move focus to the tray landmark (`#landmark-tray`) — VoiceOver will announce "Piece tray, application, empty."

Do not move focus to the board region automatically — the user may want to extract more pieces and should stay in tray context.

### Tray scroll and off-screen buttons

Under Approach A (full DOM), all in-tray buttons remain in tab order regardless of scroll position. This means a user can Tab to a piece that is off-screen to the left or right of the visible tray viewport. This is **correct and expected** for keyboard accessibility — keyboard users do not need visual confirmation of position before focusing. Tabbing to an off-screen piece should auto-scroll the tray to reveal it.

Auto-scroll implementation: when a button receives focus, read its associated tray position from `layoutTrayPieces` state and update `_scrollX` to bring the piece into view. `layoutTrayPieces` already knows each piece's column position — derive the required scroll offset from there.

---

## 6. Landmark Transition — Tray to Canvas

### The exact tab sequence

```
[Last tray button]
      ↓ Tab
[First canvas board button]     ← recommended (see below)
      ↓ Tab
[Second canvas button]
      ↓ ...
[Last canvas button]
      ↓ Tab
[Browser chrome / next page element]
```

### Options evaluated

**Option A: Direct tray → board transition (no intermediary)**

Tab from last tray button goes directly to the first board button. DOM order: `#landmark-tray` buttons then `#landmark-board` buttons. No extra affordances.

*Keyboard-only users:* Good. No extra keystrokes. Region boundary is transparent.
*Screen reader users:* The landmark change is announced ("Puzzle board, application") when focus enters. Clean.
*Risk:* Users may accidentally tab from tray into board without intending to. If the board has many pieces, Shift+Tab back is cumbersome.

**Option B: "Move to board" landmark button between regions**

After the last tray button, a visible (or visually-hidden-but-focusable) button reads "Switch to puzzle board". Pressing Enter or Tab from it enters the board region.

*Keyboard-only users:* Adds one keystroke but provides intentional region switch. Clear affordance.
*Screen reader users:* Announced as a button. Very clear navigation landmark.
*Risk:* Adds UI complexity. May confuse users who are just tabbing through sequentially.

**Option C: Tray exits to browser chrome, user uses landmark navigation**

No direct tab path from tray to board. User must use screen reader landmarks (VoiceOver VO+U, NVDA D) or a keyboard shortcut (e.g. `B` for board).

*Keyboard-only users:* Unacceptable — no landmark navigation available.
*Screen reader users:* Acceptable but not ideal. Landmark navigation is well-known to AT users.
*Risk:* Keyboard-only users are completely blocked.

### Recommendation: Option A — direct transition

Direct tray → board via natural tab order (Option A) for Stories 40–42. Reasons:

1. Keyboard-only users must have a tab path to the board — Option C is a blocker.
2. The landmark announcement (`role="application"` change) provides sufficient context signal for screen reader users.
3. Option B adds UI complexity that can be deferred to a post-launch accessibility audit if user testing reveals confusion.

If user research shows the direct transition causes "accidental" board entry, add a "Move to board" button as a post-42 enhancement.

**One refinement:** When focus enters `#landmark-board` for the first time from the tray, announce the piece count: `aria-label="Puzzle board — 12 pieces on canvas"`. Update this label reactively as pieces are placed. This gives screen reader users context without requiring them to Tab through all pieces to assess the board state.

---

## 7. Keyboard Action Map

### Confirmed bindings with conflict analysis

| Key | Tray context | Canvas context | Conflict analysis |
|---|---|---|---|
| `Tab` | Move to next tray piece | Move to next canvas piece | No conflict — browser default Tab navigation is the mechanism we use |
| `Shift+Tab` | Move to previous tray piece | Move to previous canvas piece | No conflict — same |
| `Enter` | Extract piece (spiral placement — same as click) | Pick up held piece / put down held piece | No conflict |
| `Space` | Extract piece (same as Enter in tray) | Pick up / put down | **Conflict:** browser default for `Space` is page scroll. Must `preventDefault()` when focus is inside `#landmark-tray` or `#landmark-board`. Both `role="application"` regions suppress screen-reader shortcuts but not browser defaults — the app must intercept `Space` explicitly |
| `Arrow keys` | Scroll tray (left/right) | Move held piece | **Conflict:** VoiceOver in application mode passes arrows to the app. NVDA Browse Mode must be off (which it is inside `role="application"`). Safe to use. For tray: `ArrowLeft`/`ArrowRight` scroll the tray viewport horizontally. `ArrowUp`/`ArrowDown` could navigate between rows — but the tray is column-major (pieces fill rows then advance columns), so ArrowDown moves to the next row, which is the immediately following tray button. This is natural. |
| `Escape` | Deselect, return focus to tray landmark | Drop held piece, return focus to the piece's board button | No conflict — Escape is unbound at browser level outside modal dialogs |
| `T` | Toggle tray open/close | Toggle tray open/close | **Potential conflict:** NVDA intercepts `T` in Browse Mode to navigate to next table. Inside `role="application"`, Browse Mode is suspended — no conflict. VoiceOver passes all keys in application mode — no conflict. Safe. |
| `R` | — (no tray action) | Rotate focused piece 90° | No conflict. Reference image is not yet implemented — `R` is free. Context-sensitive: fires only when a board piece or group is focused; ignored in tray context. Same 90° increment as double-tap. |
| `Shift+B` | Background cycle | Background cycle | No conflict — Shift+B is not a standard browser or AT shortcut |

### Space key conflict — explicit resolution

Add `keydown` handler on both landmark containers:

```typescript
landmark.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    e.preventDefault();  // blocks page scroll
    // handle Space action
  }
});
```

`stopPropagation()` is not needed — preventing the default is sufficient to block page scroll.

### Arrow keys on canvas

When a piece is "held" (picked up via Enter/Space), arrow keys move the piece incrementally. Movement step size: one grid cell width in world space (piece width + snap tolerance). This produces precise grid-aligned movement without requiring the user to estimate distance.

**Arrow-key collision decision:** Arrow-key movement does not trigger snap or group merge mid-movement. Snap is evaluated on put-down (Enter/Space to place). The held piece moves freely through other pieces with no collision stopping. This matches the existing pointer drag model — snap fires on drop, not mid-drag — and avoids accidental merges from incremental movement.

When no piece is held, arrow keys do nothing on the canvas board (or could navigate between board pieces — to be decided in Story 41).

### To resolve in Story 39

- Arrow-key snap-on-drop decision above must be confirmed in spec (see §9.3 group semantics).
- `zoomToPlace` + `Enter` interaction — see §9.9.
- `G` for "go to piece" (jump to a piece's correct board position without placing it). Post-42 feature, noted for spec.

---

## 8. Complexity Signals for Stories 39–42

| Story | Title | Complexity | Rationale |
|---|---|---|---|
| Story 39 | Spec: keyboard nav impact on jigg-spec | **Straightforward** | Document ARIA structure, focus state fields on Piece/session, key bindings. **First action: verify `piece.state` field exists on `Piece` type and add it if not (§9.8) — this is a prerequisite for all keyboard code.** Confirm arrow-key snap-on-drop decision (§7). Resolve `zoomToPlace` + `Enter` interaction (§9.9). No implementation risk — pure spec writing. ~1 day (up from 0.5 to account for §9.8 check and open questions). |
| Story 40 | Tray keyboard nav | **Non-trivial** | Create DOM buttons for all in-tray pieces, wire focus handler to PixiJS focus ring (screen-space, Option 2), auto-scroll tray on focus, handle filter changes, handle piece extraction focus handoff. The DOM↔PixiJS sync is the hard part. ~2 days. |
| Story 41 | Canvas keyboard interaction | **Non-trivial** | Pick-up/put-down model for canvas pieces, arrow-key movement in world space, Enter to place. Group = single tab stop (decided in §9.3). Snap on drop not mid-move (decided in §7). The remaining unknown is Enter behaviour when `zoomToPlace` is active — must be resolved in Story 39 before 41 is estimated. Downgraded from Hard to Non-trivial now that group semantics are decided. ~2 days (re-estimate after Story 39 closes §9.9). |
| Story 42 | Focus coordination | **Non-trivial** | Tray↔board focus handoff, landmark enter/exit logic, landmark ARIA label updates (piece count), Escape flow. Builds on 40+41 — integration work is the risk. ~1.5 days. |

**Total estimate for 39–42:** ~7 days of implementation, assuming Story 39 spec is approved before Story 40 begins.

---

## 9. Constraints and Gotchas Affecting Stories 39–42

### 9.1 `role="application"` and VoiceOver's virtual cursor

VoiceOver on macOS suspends its virtual cursor (arrow-key reading) inside `role="application"` elements. This is intentional — it allows the app to own arrow keys. However, VoiceOver users unfamiliar with application mode may be confused when arrow keys stop reading content. Mitigation: `aria-roledescription="interactive puzzle region"` on each landmark to provide context about expected interaction.

### 9.2 Mobile screen readers — no keyboard

VoiceOver on iOS and TalkBack on Android use swipe gestures, not a physical keyboard. The virtual cursor model (DOM buttons) works correctly for these — swipe navigation moves between focusable elements. Arrow-key movement of canvas pieces will not be available on mobile. This is acceptable — mobile is pointer-only today and will remain so.

### 9.3 Piece groups — keyboard semantics and piece label integration

When pieces snap together they form a `PieceGroup`. A group of 5 pieces is one draggable entity but 5 DOM buttons. Does Tab move through each piece in a group individually, or does the group act as a single focus target?

**Decision: group = one tab stop.** The group's primary piece (lowest `piece.index`) holds the single active button; all other member piece buttons get `tabIndex="-1"`. This reduces board tab stops dramatically — see §2 group clustering.

**ARIA label format for single pieces:**

```
"Piece 42 — Zone 3, row 5, column 6, In tray"
```

Lead with `piece.index` (the number the user sees on screen via the piece label overlay). Then `piece.colorZone` expressed as "Zone N" (0-indexed internally, display as 1-based: `colorZone + 1`). Then grid coords for board spatial reference. Then state.

The zone inclusion closes the loop between three parallel identification systems that now all describe the same piece:
- **Visual (sighted):** Piece label "42" + Zone swatch colour
- **Visual (greyscale mode):** Piece label "42" + "Z3" text label on swatch (Story 37e)
- **Auditory (screen reader):** "Piece 42 — Zone 3"

A greyscale-mode user navigating by keyboard now has full parity with a sighted user: they can hear the zone, see the "Z3" label, and cross-reference against the tray filter strip without needing colour perception.

The existing `aria.ts` `setAriaLabel` currently leads with grid coords and omits both `piece.index` and `piece.colorZone`; both must be added in Story 40.

**ARIA label format for groups:**

For small groups (≤ 5 members), list the piece numbers explicitly:

```
"Group of 3 — pieces 3, 7, 12, In progress"
```

For larger groups (> 5 members), summarise spatially using the bounding grid coordinate range:

```
"Group of 20 — rows 1–4, columns 1–5"
```

Listing 20 index numbers in an ARIA label is a screen-reader UX anti-pattern (too verbose). The spatial range is more useful for large groups: the user knows which region of the puzzle is assembled. The boundary of "small" vs "large" group is 5 members — this matches the threshold at which listing becomes cumbersome.

**Piece labels and the focus ring:**

When a group is focused, the focus ring wraps the group's AABB (axis-aligned bounding box of all member sprites in screen space). The ring is not limited to a single piece bounding box — it expands to cover the whole connected assembly. This reinforces visually that the whole group is the unit of interaction. The piece index label of the primary piece (lowest index) should remain visible inside the ring; other member labels are also visible but secondary.

This decision has spec implications — flag for Story 39.

### 9.4 `aria.ts` refactor required

The current `aria.ts` creates a single `role=list` / `role=listitem` structure. Stories 40–42 require the listitems to become focusable `<button>` elements inside separate landmark containers. The current `ariaContainer` must be replaced by the two-landmark structure. The `initAriaLabels`/`setAriaLabel` API will need to be redesigned.

The `setAriaLabel` function is documented as "never called on state transitions" (gap noted in `accessibility.md §5.2`). This must be wired simultaneously with Story 40 — each button's `aria-label` must update when the piece is extracted.

### 9.5 Tray is PixiJS screen-space, not DOM — no native scroll integration

The tray uses a manual `_scrollX` offset applied to `_gridContainer.x`. There is no native DOM scroll element. Auto-scrolling the tray when a button receives focus (§5) requires computing the focused piece's column from the stored `layoutTrayPieces` position and programmatically updating `_scrollX`. Expose a `scrollTrayToId(pieceId)` function from `tray.ts` for Story 40 to call from the button `focus` handler.

### 9.6 Focus ring must survive tray open/close animation

The tray open/close animation repositions the viewport (`_viewport.resize(w, h - currentTrayHeight)` each tick). If a canvas piece is focused during tray animation, the focus ring's screen position (derived from `viewport.toGlobal()`) will update correctly each frame because `viewport.toGlobal()` uses the current transform — no special case needed.

For tray pieces during tray-close animation: the tray container slides down off-screen. If a tray piece is focused and the tray closes, the focused button becomes invisible but remains in DOM. Focus should be moved to the tray landmark handle (the strip) on tray close. The tray handle does not currently have a focusable DOM element — Story 42 should add one.

### 9.7 Piece state `placed` removes the piece from interactive tab order

Placed pieces (state = `'placed'`) are snapped to the board and no longer interactive. Their board buttons should get `tabIndex="-1"` (or removed) when `piece.state` transitions to `'placed'`. The `aria-label` should read "Placed — row X, column Y" for reference but the button should not be reachable by Tab. Screen readers can still reach it via virtual cursor if needed for review.

### 9.8 `Piece.state` field — Story 39 prerequisite, not a Story 40 concern

`aria.ts` references `piece.state` in a conditional but `Piece` in `types.ts` (as documented in `architecture.md`) does not show a `state` field. The `aria.ts` source code at line 35 uses `piece.state` — if this field doesn't exist on the `Piece` type, the entire keyboard model breaks silently: buttons cannot be labelled correctly, tab order cannot be scoped to in-tray vs on-canvas, and placed-piece exclusion from tab order is impossible.

**This is the first action in Story 39, not a pre-Story 40 check.** Before any spec text is written:

1. `grep -n 'state' src/puzzle/types.ts` — confirm whether `state: 'in-tray' | 'on-canvas' | 'placed'` exists.
2. If absent: add the field to `Piece` in `types.ts`, update all construction sites in `cutter.ts` (initial state `'in-tray'`), and update transition sites in `tray.ts` (extraction → `'on-canvas'`) and `snap.ts` / `scene.ts` (board snap → `'placed'`). Run `npm run typecheck`.
3. Once confirmed present: the rest of Story 39 spec proceeds on solid ground.

Do not write Story 39 spec text, do not open Story 40, until this check is complete and passing.

### 9.9 `zoomToPlace` + `Enter` — interaction conflict

Story 36 implemented `zoomToPlacePiece`: clicking a tray piece pans and zooms the viewport to the piece's correct world position on the board. The tray epic decisions locked "keyboard extraction (Enter on tray piece): triggers same spiral logic as click."

These two behaviours are in conflict. If click = zoom-to-place AND click = spiral extraction, then what does Enter do?

**Three options:**

| Option | Enter behaviour | Implication |
|---|---|---|
| A | Spiral extract only (no zoom) | Enter is commit. Zoom is a preview action that needs a separate key. |
| B | Zoom to position, then a second Enter extracts | Matches a "look before you act" mental model. Two keystrokes for extraction. |
| C | Zoom + extract in one action (matches click exactly) | Piece appears at spiral origin near the zoomed position — disorienting if viewport has moved far. |

**Recommendation: Option A — Enter = extract via spiral only.**

Zoom-to-place is a spatial preview ("show me where this goes"). Extraction is a commitment ("pull this piece to the canvas"). Conflating preview with commitment in a single Enter press removes the user's ability to look without acting. A keyboard user who wants to see where a piece belongs should press `Z` (or another to-be-decided preview key) to zoom; Enter then extracts regardless of viewport position.

This also avoids a subtle bug in Option C: if the spiral origin is recalculated after the zoom animation, the piece placement position changes depending on viewport state at the moment Enter was pressed. Option A locks spiral origin at Enter-press time — deterministic.

**Must be confirmed in Story 39 spec.** The `zoomToPlacePiece` function in `tray.ts` must not be called from the Enter handler in Story 41.

---

## Summary Decisions

| Question | Decision |
|---|---|
| ARIA landmark role | `role="application"` — suppresses AT shortcut keys, correct for canvas widgets |
| Landmark structure | Two regions: "Piece tray" (DOM-order first) + "Puzzle board" (DOM-order second) |
| Virtualisation approach | Approach A (full DOM) up to 200 pieces; migrate to hybrid A/B at 200+ piece threshold |
| Focus ring positioning | Screen-space on `app.stage`, repositioned via `viewport.toGlobal()` each frame |
| Focus ring | Single shared `Graphics` object, 2px neon magenta `0xff00ff`, redrawn each frame |
| Tab order tray→board | Direct transition via DOM order (Option A), no intermediary button |
| Space key conflict | `preventDefault()` on `keydown` inside both landmarks |
| Arrow keys | Context-sensitive: tray scroll (left/right) or canvas piece movement when held |
| R key | Rotate 90° in canvas context; no tray action. Reference image unimplemented — R is free |
| Group keyboard model | Group = single focus target; member buttons get `tabIndex="-1"`; board element count self-reduces as puzzle is assembled |
| ARIA button label format | `"Piece {index} — Zone {N}, row X, column Y, {state}"` — index first (matches visual label), zone second (bridges greyscale + colour modes), coords third. Groups: `"Group of N — pieces A, B, C"` (≤5 members) or `"Group of N — rows X–Y, columns X–Y"` (>5 members) |
| Focus ring on groups | Ring wraps full group AABB in screen space, not single piece bounds |
| Arrow-key snap behaviour | No snap or merge mid-movement; snap evaluated on put-down (Enter/Space) only |
| `zoomToPlace` + `Enter` | Enter = spiral extract only; zoom is a separate preview action (key TBD in Story 39) |
| **Story 39 first action** | **Verify `piece.state` field on `Piece` type. Add + wire if absent. Prerequisite for all keyboard code.** |
