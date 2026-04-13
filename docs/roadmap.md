# Roadmap

Forward-looking only. No session notes, no implementation detail.
When a story closes: add session notes to `stories.md`, mark `[x]` here, remove detail that is now historical.

---

## Pre-Epic Cleanup

- [x] **Story 29** — Remove edge overlay debug scaffolding; strip visual overlay + `E` key binding from `scene.ts`, retain edge map data for `edgeInfluence` in cut generation. Gate any future dev tooling behind `?debug=true`

---

## Epic: Piece Tray

*Tray-first model. All pieces load into tray on puzzle start. Canvas starts empty. User pulls pieces out as they work. Staging only — no manipulation in tray.*

**Design decisions locked:**
- Piece state machine: `in-tray` → `on-canvas` → `placed`
- Return path to tray (including group behaviour) fully deferred pending user feedback — no architectural constraints added that prevent it later
- Filters: single-select, mutually exclusive (corner / edge / interior / color zone)
- Filter metadata computed at cut time, cached on piece — not derived on filter change
- Rotation On: pieces arrive in tray pre-rotated, double-tap enabled. Rotation Off: pieces arrive upright, double-tap handler explicitly disabled
- **Piece extraction — drag:** follows cursor from tray exit, lands on release. Drop shadow appears and opacity normalises on tray exit
- **Piece extraction — click:** Archimedean spiral from viewport center. Spiral origin locked at first click in sequence, resets on pan. Step spacing computed from max piece diagonal (`imageWidth / N * √2 * 1.3`) — 1.3 buffer accounts for Bezier tab protrusion. If exact coordinates occupied, skip to next spiral step.
- **Keyboard extraction (Enter on tray piece):** triggers spiral logic only — does NOT zoom to piece's correct board position. Zoom-to-place is a separate preview action (key TBD in Story 39). See `docs/spike-keyboard-focus.md §9.9`.

- [x] **Story 30** — Spike: tray rendering model. Decision: Approach C (reserved canvas region). See `docs/spike-tray-rendering.md`.
- [ ] **Story 31** — Spec: tray impact on `jigg-spec`; piece state (`in-tray` / `on-canvas` / `placed`), filter metadata (edge type, dominant color vector), tray-first load behaviour, rotation session property (`session.rotationEnabled`, `piece.initialRotation`), piece extraction UX (drag + spiral click + keyboard Enter all specced above), deferred return-to-tray logged as conscious omission
- [x] **Story 32** — Bottom drawer tray; all pieces populate on load, pushes viewport up when open, collapses.
- [x] **Story 33** — Tray layout; grid view of unplaced pieces, synced with canvas state in real time
- [x] **Story 34** — Piece filtering; single-select filter strip — corner / edge / interior
- [x] **Story 35** — Color zone filter; k-means clustering at cut time, filter tray by dominant color region. `colorZone 0–4` assigned per piece.
- [x] **Story 36** — Zoom-to-piece; click tray piece, canvas pans and zooms to its correct world position
- [ ] **Story 36b** — Content-aware edge type; `edgeType` currently derived from grid position only. For shaped images (circular crop, vignette, alpha-masked source), corner/edge grid pieces may be mostly transparent — not real puzzle edges. Compute average alpha of border pixels per piece at cut time; if a nominally-flat side sits over transparent pixels, don't count it as a flat side. Re-derive `edgeType` from content-aware flat-side count. Affects filter strip counts and future snap logic.
- [x] **Story 37a** — Accessibility foundation; adaptive background, high contrast, greyscale. `src/utils/preferences.ts`, `src/utils/aria.ts`, `src/utils/luminance.ts`.
- [x] **Story 37b** — Piece number label overlay; `piece.index` (1-based, l→r t→b), counter-rotation, counter-scale in tray.
- [x] **Story 37c** — Reduced motion mode; `applyReducedMotion` fully implemented, all four animations respect flag.
- [x] **Story 37d** — High contrast core repair; sandwich stroke (AC-1), solid tray (AC-2), label pill backing (AC-3), neon magenta snap highlight (AC-4).
- [x] **Story 37e** — Greyscale and zone labeling; ITU-R BT.601 `ColorMatrixFilter` on piece sprites, Z1–Z5 text labels on tray color swatches when greyscale active, glowDot hidden on active swatch in greyscale, Sin City effect (snap highlight excluded from greyscale).

---

## Epic: Keyboard Accessibility

*Virtual cursor model — hidden DOM accessibility tree mirrors canvas state. Tabbing moves through invisible DOM buttons. Visual focus ring rendered on PixiJS stage. Browser-native tab order, canvas visual response.*

**Approach locked:** See `docs/spike-keyboard-focus.md` for full rationale on all decisions below.

**Decisions locked:**
- ARIA landmarks: `role="application"` × 2 — "Piece tray" (DOM-order first) + "Puzzle board" (DOM-order second)
- Virtualisation: Approach A (full DOM) ≤200 pieces; migrate to hybrid A/B above that threshold. Board element count self-reduces as groups form.
- Focus ring: single shared `Graphics` on `app.stage` (topmost stage child, above trayContainer). Screen-space, repositioned via `viewport.toGlobal()` each frame. 2px neon magenta `0xff00ff`, non-scaling. Wraps full group AABB for groups.
- Stage layer order: `viewport → trayContainer → focusRing`
- Arrow-key snap: no snap or merge mid-movement; evaluated on put-down (Enter/Space) only
- ARIA label format: `"Piece {index} — Zone {N}, row X, column Y, {state}"`. Groups: `"Group of N — pieces A, B, C"` (≤5 members) or `"Group of N — rows X–Y, columns X–Y"` (>5 members)
- `zoomToPlace` + Enter: Enter = spiral extract only; zoom is separate preview action (key TBD in Story 39)
- R key: rotate 90° in canvas context only; no tray action

- [x] **Story 38** — Spike: keyboard focus model complete. See `docs/spike-keyboard-focus.md`.

- [x] **Story 39** — Spec: keyboard nav impact on `jigg-spec`.
  **FIRST ACTION:** verify `piece.state: 'in-tray' | 'on-canvas' | 'placed'` exists on `Piece` type in `types.ts`. Add and wire all construction/transition sites if absent. Run `npm run typecheck`. This is a prerequisite for all keyboard code — do not proceed until confirmed.
  Confirm `zoomToPlace` + Enter decision (Enter = spiral extract only; zoom preview key TBD).
  Confirm arrow-key snap-on-drop decision.
  Document: ARIA landmark structure, ARIA label format (index + zone + coords + state), key bindings, group focus model (group = single tab stop, primary piece = lowest `piece.index`).
  **HARD GATE — Story 40 does not open until Story 39 is confirmed.**

- [ ] **Story 40** — Tray keyboard nav; refactor `aria.ts` into two-landmark structure (`role="application"` × 2), create DOM buttons for all in-tray pieces (Approach A). Wire button `focus` → PixiJS focus ring reposition. Auto-scroll tray on button focus via `scrollTrayToId()` export from `tray.ts`. Filter change: move focus programmatically to next visible button *before* setting `tabIndex="-1"` on filtered-out buttons — prevents focus drop to `<body>`. Extraction: remove button immediately, move focus to next in tray order. Tray handle must have a focusable DOM element (required for Story 42 tray-close focus handoff).

- [ ] **Story 41a** — Canvas pick-up/put-down model; Enter/Space picks up and puts down focused canvas piece or group. Group = single tab stop (primary piece = lowest `piece.index`, member buttons `tabIndex="-1"`). Focus ring wraps full group AABB in screen space. Placed pieces: `tabIndex="-1"`, aria-label reads "Placed" for reference.

- [ ] **Story 41b** — Arrow-key movement; grid-aligned incremental movement in world space when piece is held. Step size = one grid cell width in world space. No snap or merge mid-movement — snap evaluated on put-down only. R key rotates 90° when piece/group is focused (canvas context only).

- [ ] **Story 42** — Focus coordination; tray↔board direct tab-order transition (no intermediary button). Board landmark `aria-label` updates reactively with on-canvas piece count. Escape: tray = deselect + return to tray landmark; canvas = drop held piece + return to board button. Tray close moves focus to tray handle focusable element.

---

## Epic: Image Ingestion

*File picker immediately after Tray — unblocks real playtesting against user images.*

- [ ] **Story 43** — Spec: image ingestion impact on `jigg-spec`; image source, dimensions, library metadata
- [ ] **Story 44** — File picker + drag-drop own image onto canvas; replace hardcoded dev image
- [ ] **Story 45** — Static curated library (10–15 CC0 images); `metadata.json` drives picker UI
- [ ] **Story 46** — Image of the day; deterministic rotation (`dayOfYear % count`), featured on load

---

## Epic: App Shell

*Chrome shaped around the proven tray mechanic and real image input.*

- [ ] **Story 47** — Spec: app shell impact on `jigg-spec`; session init, grid size, difficulty
- [ ] **Story 48** — New puzzle flow; image source picker → grid size selector → launch
- [ ] **Story 49** — HUD; piece counter + elapsed timer, togglable
- [ ] **Story 50** — Reference image panel; draggable DOM overlay, snaps to nearest corner on release, resizable, fullscreen option, hotkey toggle (`R`), collapsed by default, ARIA landmark, meaningful `alt` text
- [ ] **Story 50b** — Ghost underlay mode; opt-in semi-transparent overlay on canvas, opacity slider 0–100%, `pointer-events: none`. Continuous coordinate transform synced to viewport pan and zoom via event listener. Gated on Story 50.
- [ ] **Story 50c** — High contrast integration; when Story 37 high contrast active, reference panel offers edge-only view toggle. Gated on Stories 50 and 50b.
- [ ] **Story 51** — Completion animation; payoff moment on solve
- [ ] **Story 52** — Settings panel; texture variant, snap sensitivity, rotation On/Off, accessibility toggles from Story 37

---

## Epic: Persistence

*IndexedDB-first. Flat + serializable for future Supabase sync.*

Note: Story 53 (spec) runs in parallel with App Shell. Stories 54–55 explicitly gated on Story 48 — no session model exists until then.

- [ ] **Story 53** — Spec: persistence model; canonical vs actual transforms per piece, session schema (including `rotationEnabled`), session reset trigger, sync extension points
- [ ] **Story 54** — Auto-save to IndexedDB; debounced ~2s on snap, place, rotate, tray interaction. Gated on Story 48.
- [ ] **Story 55** — Resume on load; detect in-progress session, offer Continue or New Game. Gated on Story 48.

---

## Epic: Usage Tracking

*Anonymous only, no accounts. Pull into launch window — want data from user one.*

- [ ] **Story 56** — Spec: tracking impact on `jigg-spec`; conscious call, likely no changes needed
- [ ] **Story 57** — Anonymous device UUID; generate on first load, persist in IndexedDB
- [ ] **Story 58** — Supabase event logging; fire-and-forget on `puzzle_started`, `puzzle_completed`, `puzzle_abandoned`
- [ ] **Story 59** — Umami integration; standard snippet, configure goals for start/complete events
- [ ] **Story 60** — Privacy notice; minimal inline copy, no consent wall needed for anonymous data

---

## Epic: PWA

*Low effort given the stack. Last mile before launch.*

- [ ] **Story 61** — Spec: PWA impact on `jigg-spec`; asset manifest, cache strategy — likely no changes, conscious call
- [ ] **Story 62** — `vite-plugin-pwa`; manifest, service worker, precache app shell + WASM binary
- [ ] **Story 63** — Curated image cache strategy; lazy-cache on first access, not upfront precache

---

## Epic: Spec Doc

*Co-deliverable. Chapters written after each epic ships.*

- [ ] **Story 64** — Spec chapter: rendering pipeline (PixiJS, WebGL, shader decisions)
- [ ] **Story 65** — Spec chapter: cut algorithm (WASM, Canny, Bezier, content-aware routing)
- [ ] **Story 66** — Spec chapter: persistence model + sync extension points
- [ ] **Story 67** — Resolve Bezier geometry representation + spec chapter: cut algorithm math. **Public repo risk, do not defer past Story 66.**
- [ ] **Story 68** — Spec chapter: tray system + accessibility rationale
- [ ] **Story 69** — Spec chapter: what Jigg proves as a reference application

---

## Launch Sequence

```
DONE     Story 29         (Cleanup)                                   ✓
         Story 30         (Tray spike)                                ✓
         Story 38         (Keyboard spike)                            ✓
         Stories 32–37e   (Tray epic)                                 ✓

NEXT     Story 40         (Tray keyboard nav)
         Stories 41a+41b  (Canvas keyboard — re-estimate after Story 39 closes)
         Story 42         (Focus coordination)
         Story 44         (File picker — unblocks real playtesting)

THEN     Stories 31, 43   (Specs — tray + ingestion)
         Stories 45–52    (Ingestion + Shell — content + chrome)
           50 → 50b → 50c (Reference image panel — sequential dependency)
         Story 53         (Persistence spec — parallel with Shell)
         Stories 54–55    (Persistence impl — gated on Story 48)
         Stories 56–60    (Tracking — pull into launch window)
         Stories 61–63    (PWA — last mile)

LAUNCH

POST     Story 19         (Z-order — deferred, informed by tray layering)
         Stories 64–69    (Spec doc — after each epic, Story 67 at Story 66)
```

---

## Open / Deferred

- **Return-to-tray mechanic** — deferred pending user feedback post-launch. No architectural constraints added that prevent it later.
- **Stories 41a/41b re-estimate** — after Story 39 closes the `zoomToPlace` + Enter question (§9.9 in spike doc).
- **zoomToPlace preview key** — non-Enter key for "show me where this piece goes" action. TBD in Story 39.
- **Tray handle focusable DOM element** — must ship in Story 40 (required for Story 42 tray-close focus handoff). Not a Story 42 deferral.
- **Story 36b (content-aware edge type)** — deferred post-launch. Low priority unless shaped/masked source images become common.
- **Story 19 (Z-order)** — deferred post-launch, informed by tray layering decisions.
- **`SNAP_HIGHLIGHT_THICKNESS_HC = 4`** — defined in `scene.ts` but not yet wired to a rendered stroke. Post-37d follow-up, P2.
- **Non-scaling piece labels at low zoom** — unreadable below ~0.3×. Post-launch, P3.
- **Greyscale on tray chrome / color-zone swatches** — P3. Zone text labels (Story 37e) are the current mitigation.
- **`reducedMotion` live OS-change detection** — sampled once at module load. Post-launch, P3.
