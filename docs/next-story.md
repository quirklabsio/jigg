# Story 47a-spike: Piece contrast audit and accessibility recommendation

## Context

User reports pieces disappearing into their surroundings: white pieces vanish against the off-white board (`#f5f5f3`), black pieces vanish against the dark bench background (`#1a1a1a` normal / `#000000` HC). Once you factor in the full matrix — bench vs. board vs. stage background, normal vs. HC mode, the Shift+B background-preset cycle from Story 37a, snap highlight states, Story 37d's sandwich stroke, BevelFilter baseline, the experimented-then-disabled DropShadowFilter — "just add a stroke" risks fighting or duplicating treatments that already exist.

This is a spike: no production code ships from this session. The deliverable is a measured audit and a concrete recommendation for the follow-up story that will implement the fix.

## Accessibility framing (non-negotiable)

**WCAG 2.1 SC 1.4.11 "Non-text Contrast"** — user-interface components and graphical objects that are essential for understanding a state must have a contrast ratio of at least **3:1** against adjacent colors. Puzzle pieces are essential graphical objects. This is the acceptance threshold for the audit: every piece/background pair must either hit 3:1 at the visible boundary already, or be called out as failing.

For users with the High Contrast preference enabled (Story 37a), the target tightens — 4.5:1 where feasible, matching WCAG AA text contrast, reflecting the user's explicit signal that they need stronger visual separation.

## Requirements

### 1. Build the context × piece-color matrix

Enumerate every surface a piece renders against. At minimum:
- **Board** in each of the Story 37a background presets — off-white `#f5f5f3`, charcoal, and the adaptive mid-gray band (see `decisions.md` §"Adaptive background thresholds").
- **Bench body** in normal mode (`#1a1a1a` α 0.85) and HC mode (`#000000` α 1.0). Both the strip-closed state and the strip-open state.
- **Workspace background** (`#f5f5f3` body CSS + WebGL clear).
- **Snap highlight** — the pulse area during a board-snap attempt (HC-modified per Story 37d).
- Any other context a piece visibly occupies (extracted mid-drag, placed-and-settled, cluster rendering).

Piece-color buckets to test against each:
- Pure white (`#ffffff`)
- Near-white (`#f0f0f0`-ish — very common in photographs: clouds, highlights, skin)
- Pure black (`#000000`)
- Near-black (`#101010`-ish — shadows, hair, dark fabric)
- Mid-gray (`#808080`)
- Three saturated hues (red, blue, green at ~70% saturation) — sanity check, not the failure case

### 2. Audit existing piece-edge treatments

For each of the following, document what it contributes to piece/background contrast today:
- **BevelFilter** (Story 13 baseline, adjusted in Story 37d) — what's its visible effect on the piece boundary? Does it help contrast or just add depth?
- **OutlineFilter sandwich** (Story 37d, HC-only) — confirm it's HC-gated. Measure the contrast it provides in HC mode.
- **DropShadowFilter** — currently disabled (see `decisions.md` §"Piece Shadows"). Revisit: would re-enabling it at `resolution: 1` with appropriate alpha restore sufficient contrast without the seam / complexity issues that got it disabled? Document the tradeoff.
- **Piece background fill** under the texture (if any) — does the piece have any backdrop that participates in the visible boundary?

### 3. Measure contrast

For each cell in the matrix, compute the WCAG contrast ratio at the piece/background boundary. Use the standard formula: `(L1 + 0.05) / (L2 + 0.05)` where L1/L2 are relative luminances.

For pieces whose boundary is a gradient (bevel highlight/shadow across the edge) or a filter-produced rim (outline sandwich), measure at the point of minimum contrast — the pessimistic number is the one that governs whether a piece "disappears."

Present results as a table in `decisions.md`. Flag every cell below 3:1 normal / 4.5:1 HC.

### 4. Recommend

Based on the measurements, recommend one primary approach and describe 1–2 alternatives. The option space (non-exhaustive):

- **Always-on contrast-aware edge stroke** — extend the HC sandwich stroke pattern (or a lighter version of it) to all modes. Pros: uses existing OutlineFilter infrastructure, per-piece contrast adapts automatically if the stroke color is computed from piece content. Cons: more rendering cost, may fight the BevelFilter depth illusion.
- **Re-enable DropShadowFilter** with specific parameters that address the disabled-reasons. Pros: preserves current edge treatment, adds separation via offset shadow rather than rim stroke. Cons: shadow direction (45°, top-left convention) doesn't help on board edges where shadow falls into the board anyway.
- **Board color tint** — retire the pure off-white in favor of a neutral mid-gray board (e.g. `#c8c8c6`) that contrasts with both white and black pieces. Pros: one change, solves the most acute failure (pieces-on-board). Cons: bench still has the black-on-dark problem; only solves half.
- **Per-piece adaptive edge color** — sample the piece's edge pixels, pick a stroke color that maximizes contrast against both the piece and the expected background. Pros: always optimal. Cons: complexity, runtime cost, implementation risk.
- **Hybrid** — combine a subtle board tint (addresses board case) with a thin always-on stroke (addresses bench case and serves as defence everywhere else).

The recommendation should justify the choice with the measurement data, name the runtime cost, and name anything it might break (BevelFilter depth illusion, Story 37d sandwich stroke, snap highlight visibility).

### 5. Follow-up story brief

End the `decisions.md` entry with a concrete scope for the next story — the implementation of the recommended approach. Include:
- Story title
- Files likely to touch
- 4–6 acceptance criteria measured against the same contrast matrix from step 1
- Known constraints (don't break HC sandwich, don't break Bevel depth, etc.)

BA will read this brief and write the formal next-story prompt from it.

## Constraints

- **No production code changes in this session.** A small throwaway measurement helper (e.g. a console-logged contrast calculation) is fine — don't commit it.
- **Do not implement the fix.** That's the follow-up story. Resist the urge to "just try" a fix if the audit points somewhere obvious; the user needs the audit document regardless for future regression checks.
- **Do not change existing preferences, HC behavior, or any accessibility primitive.** Inventory only.
- **No performance optimization** on any existing filter. The spike measures, not tunes.
- **No changes to the BevelFilter, OutlineFilter, or any filter config.** Auditing their effect is allowed; changing them isn't.

## Files likely to touch

- `docs/decisions.md` — primary deliverable: audit matrix, existing-treatment audit, recommendation, follow-up story brief
- `public/qa.html` — update `STORY` and `FIXTURES` for the spike
- Possibly `qa-scratch/*.png` — synthetic high-contrast test images (see below)

## Acceptance

This is a spike; ACs are about the document, not runtime behavior.

- **AC-1: Context × piece-color matrix in `decisions.md`.** A table with every context (board × each bg preset, bench normal, bench HC, workspace, snap highlight) × every piece-color bucket. Each cell has a measured contrast ratio.
- **AC-2: Every failing cell flagged.** Cells below 3:1 normal / 4.5:1 HC are explicitly called out. No hand-waving.
- **AC-3: Existing treatments audited.** Each of BevelFilter, OutlineFilter sandwich, (disabled) DropShadowFilter documented: what it does today and how much it contributes (or doesn't) to the boundary contrast.
- **AC-4: One primary recommendation with justification.** The recommendation references specific matrix cells as evidence. 1–2 alternatives briefly documented with the tradeoffs named.
- **AC-5: Follow-up story brief.** Concrete scope (title, files, ~5 ACs, constraints) that BA can turn into the next-story prompt with minimal rewriting.
- **AC-6: No production code committed.** `git diff src/` returns empty at the end of the session.

## Test fixtures (spike)

Create 3–4 synthetic high-contrast test images in `/qa-scratch/` — pre-normalized PNGs sized 1024×1024 (so they drop straight into the existing ingest pipeline):

- `qa-scratch/spike-47a-pure-white.png` — solid `#ffffff`
- `qa-scratch/spike-47a-pure-black.png` — solid `#000000`
- `qa-scratch/spike-47a-mid-gray.png` — solid `#808080`
- `qa-scratch/spike-47a-split-wb.png` — half-white half-black (50/50 split) so a single loaded puzzle has both failure cases simultaneously

These make the worst-case boundary visible at a glance. User loads each through the 48 picker panel's "Upload your own…" affordance (or drag-drop) and verifies the audit's findings match what they see.

Nominate any of these for promotion if the follow-up regression story would want them around. Likely yes — the `split-wb` image is a great long-term fixture for any contrast-related work.

## Out of scope

- Story 47c palette tuning / swap UI (still candidate)
- Story 46f label clipping (still candidate)
- Story 49 metadata shape
- Any change to rendering pipeline, filters, board color, or piece geometry
- Any implementation of the recommended fix — that's the follow-up story

## Known next

After this spike: Story 47a (implementation) follows, scoped from the spike's recommendation. Then the remaining 47-series candidates (47c palette) and 46f label clipping per BA judgement.
