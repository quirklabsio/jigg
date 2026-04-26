<!-- audience: BA, Dev -->

# Jigg Roadmap — Development Board

*Story-level planning board. Each story = one Claude Code session.*

---

## ✅ Shipped

*Complete. Stories 1–43 shipped before this log was formalised.*

| Range | Focus |
|---|---|
| Stories 1–38 | Core puzzle solving |
| Stories 40–42c | Keyboard navigation + screen reader support |
| Story 43 | Accessibility audit + docs rewrite |
| Story 44 | Drag-and-drop image load (2026-04-18) |
| Story 45 | Image normalization — EXIF orientation, max 2048, JPEG re-encode (2026-04-18) |
| Story 46 | Dynamic piece grid from image aspect ratio — `computeGrid`, 200-piece cap, removed hardcoded COLS/ROWS (2026-04-20) |
| Story 46b | Fix bench piece clipping — tabs and focus ring (2026-04-21) |
| Story 46c | Scatter spread fix — stepSize × _canvasScale in `bench.ts` (2026-04-21) |
| Story 46e | Corner piece alignment — board sized to piece coverage, not image dimensions (2026-04-21) |
| Story 47 | File picker — "Choose Image" button, same pipeline as drag-and-drop (2026-04-21) |
| Story 48 | Curated image set + dev regression fixture — picker panel, 7 images, forceGrid plumbing, regression-script.md (2026-04-21) |
| Story 47a-spike | Piece contrast audit — WCAG matrix + recommendation (2026-04-22) |
| Story 47a | Bench piece uplight glow — per-slot chrome, HC-gated off (2026-04-22) |
| Story 47b | Adaptive board color — three-preset algorithm (light/mid/dark) chosen from image luminance mean + spread at load time; no user override (2026-04-23) |
| Story 47d | Board as stage — 8-layer painter's-algorithm mesa (offset-stacked rects + noise grain + center glow + edge highlights); no filters, all pure geometry (2026-04-24) |
| Story 47e-spike | Accessibility architecture audit — 15 behaviors inventoried, 5 risks named, MVV vs full-version split (2026-04-25) |
| Story 47f | Filter ordering fix + extraction cleanup helper (Phase 1 MVV) — `addSandwichStroke` inserts before greyscale; `prepareContainerForCanvas` consolidates 4 extraction sites (2026-04-25) |

---

## 📋 Next

### Epic: Real Image Unlock *(kill the hardcoded world)*

*46-series close-out complete. 46d closed without fix; 46f queued below as a standalone follow-up (not blocking Controlled Inputs).*

**Story 46f — Fix piece label clipping (Approach B)**
Move labels from sprite children to a sibling overlay container above the sprite layer. Sync position + rotation per-frame via ticker. No mask clipping ever; labels render at full size on any piece size including 1000+ piece puzzles. Counter-rotation invariant (Story 37b) moves to the sync path but remains equivalent. See `docs/decisions.md` for the full analysis.

---

### Epic: Controlled Inputs *(make it a product, not a dev tool)*

**Story 47 — File Picker (minimal UI)** ✅ Shipped 2026-04-21

**Accessibility architecture pass complete.** Design doc at `docs/accessibility-design.md`. Story briefs sequenced and ready for BA to write next-story prompts. Phased migration: 47f → 47e-r → 47g (opt) → 47h → 47i (deferred).

**Story 47e (CLOSED — original scope)**
Premise was wrong. HC sandwich IS applied to bench sprites via `spriteMap`. Re-scoped as 47e-r.

**Story 47e-r (CLOSED — backed out)**
Quality 0.15 → 0.3 + padding 8 on `OutlineFilter` did not produce a visible sandwich ring at bench thumbnail scale. Reverted. Empirical learning: OutlineFilter at thumbnail scale is unlikely to be the right primitive for HC bench visibility, regardless of parameter tuning.

**Story 47g — Remove HC piece sandwich; switch HC bench to `#1a1a1a` α 1.0** *(in progress — see `docs/next-story.md`)*
Two changes folded into one story given the empirical evidence: (1) flip bench HC color to `#1a1a1a` α 1.0 (architect's optional Phase 2b); (2) remove the per-piece HC sandwich entirely (Story 37d behavior, no longer earning its complexity). Bench filter-strip swatch HC styling is **explicitly preserved** — different feature, different code path. Deliberate walk-back of WCAG AAA-grade piece outline contrast in HC; HC retains its other treatments (BevelFilter, snap, label, swatches, solid tray).

**Story 47h — Accessibility gotchas documentation** *(any time after 47f)*
Add R-3/R-4/R-5 gotcha entries to `docs/gotchas.md`. No code.

**Story 47c (candidate) — Palette tuning + swap UI**
Current k=5 palette (Story 35) doesn't capture the punchy / saturated colors human eyes focus on. Two sub-concerns; may split into 47c + 47d: (a) tune extraction — higher k, saturation weighting, or alternate algorithm; (b) paint-drop icon at the right of the palette strip that opens an overlay to preview and swap palette variants. Start with (a) alone — may resolve the complaint without needing the UI.

**Story 48 — Curated Image Set + dev regression fixture** ✅ Shipped 2026-04-21
7 public-domain images with a picker panel triggered by the existing "Choose Image" button. Regression fixture uses `forceGrid: {cols:3, rows:3}`. `docs/regression-script.md` seeded. 47b absorbed.

**Story 49 — Minimal Metadata Shape**
Introduce lightweight structure: `id`, `title`, `source` (string only). Stored inline with curated set.
*Outcome: Spec evolves from reality, not guesswork.*

---

### Epic: Daily Mechanic *(habit loop, still local-first)*

**Story 50 — Deterministic Daily Rotation**
`dayOfYear % imageCount`. Uses curated set only.

**Story 51 — Auto-load Daily on Boot**
App loads daily image immediately. Still drops into puzzle directly (no landing screen yet).

**Story 52 — Landing Choice (first fork)**
Two options: "Play Today" / "Choose Image".
*Outcome: First real UX decision point.*

---

### Epic: App Shell *(only what's necessary)*

**Story 53 — Piece Counter**
Live: placed / total.

**Story 54 — Timer**
Starts on first interaction. Pauses safely.

**Story 55 — Completion Detection**
Detect final snap. Fire completion event.

**Story 56 — Basic Completion Feedback**
Simple visual payoff (overlay or modal).

**Story 57 — Piece Recall (undo last extraction)**
Z-to-undo returns the last piece sent to the table back to the bench. A 3-second dismissing hint appears on first extraction only ("Z to undo") then fades — no persistent UI, no popup. Works for both keyboard and pointer extraction paths.
*Constraint: no modal, no persistent chrome. Fast and forgettable when not needed.*

**Story 58 — Reference Image (v1)**
Toggle on/off. Fixed position (corner). Accessible label + alt text.
*Not yet: drag, resize, ghost overlay.*

---

### Epic: Persistence *(prove the local-first claim)*

**Story 59 — Session Model**
Define serializable puzzle state: piece positions, rotations, elapsed time, image reference.

**Story 60 — IndexedDB Auto-save**
Save on interval or meaningful change.

**Story 61 — Resume on Reload**
Restore active session if present.

---

### Epic: .jigg File System *(portable state)*

**Story 62 — Export `.jigg`**
Serialize session → download file.

**Story 63 — Import `.jigg`**
Drag-and-drop file. Validate + parse.

**Story 64 — Load Imported Session**
Hydrate puzzle from file.

---

### Epic: External Content *(MET comes last, not first)*

**Story 65 — Single Fetch Integration**
Fetch one object from Metropolitan Museum of Art API. Normalize to internal format.

**Story 66 — Swap Daily Source to MET**
Replace curated rotation with fetched image.

**Story 67 — Manifest (365 IDs)**
Introduce `manifest.json`. Map date → object ID.
*Outcome: This becomes trivial now instead of speculative.*

---

### Epic: Progressive Polish *(only after usage proves value)*

**Story 68 — Draggable Reference Panel**

**Story 69 — Resizable Panel**

**Story 70 — Settings Panel**
Rotation toggle, snap sensitivity, background.

**Story 71 — Enhanced Completion Animation**

---

## ⏸️ Deferred

*Parked — revisit post-launch. Renumbered to avoid conflicts with active stories.*

### Arrow Key Movement
**Story 72:** Grid-aligned incremental movement while piece is held, viewport following, cluster coordination.
*Reason: Explicitly deferred post-launch (per `accessibility.md`).*

### Keyboard Accessibility Polish
**Story 73:** Screen reader enhancements — live regions, progress announcements.
**Story 74:** Keyboard accessibility testing and polish — edge cases, performance, user testing.

### PWA
**Story 75:** Service worker and offline support.
**Story 76:** App manifest and installation.
**Story 77:** Background sync capabilities.
*Reason: Post-launch enhancement.*

### Usage Tracking
**Story 78:** Anonymous analytics foundation.
**Story 79:** Accessibility usage metrics.
**Story 80:** Performance monitoring.
*Reason: Privacy review needed.*

### Advanced / Speculative
**Story 81:** Custom piece counts.
**Story 82:** Collaboration features.
**Story 83:** Advanced hint system.
**Story 84:** Whimsy cuts (vision API integration).
**Story 85:** Social sharing.
**Story 86:** Achievement system.
*Reason: Post-launch, validate demand first.*


---

## 🎯 Launch Sequence

**Target:** Accessibility-first MVP with daily habit loop

**Criteria:**
- ✅ Core puzzle solving (Stories 1–38)
- ✅ Keyboard accessibility (Stories 40–43)
- 📋 Real image unlock (Stories 44–46)
- 📋 Controlled inputs (Stories 47–49)
- 📋 Daily mechanic (Stories 50–52)
- 📋 App shell (Stories 53–58)
- 📋 Persistence (Stories 59–61)

**Beta:** Accessibility communities
**Public Launch:** Daily loop + persistence proven
**Post-Launch:** .jigg format, MET integration, progressive polish

---

## Story Template

```
Story XX: [Action] [Component] [Outcome]

[Technical requirements with constraints]

Files to touch:
- [List of specific files]

Acceptance:
- [Measurable success criteria]
```

See `docs/BA.md` for full story writing guidelines.

---

*Last updated: 2026-04-18*
