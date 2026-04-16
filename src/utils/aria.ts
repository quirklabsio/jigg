import type { Piece } from '../puzzle/types';
import { isInBench, isOnTable, isPlaced } from '../puzzle/types';
import { usePuzzleStore } from '../store/puzzleStore';

// ─── Landmark IDs ─────────────────────────────────────────────────────────────

export const LANDMARK_BENCH_ID = 'landmark-bench';
export const LANDMARK_TABLE_ID = 'landmark-table';

// ─── Filter def type ──────────────────────────────────────────────────────────

export type FilterDef = { id: string; label: string; count: number; isActive: boolean };

// ─── Module state ─────────────────────────────────────────────────────────────

let _landmarkBench: HTMLDivElement | null = null;
let _landmarkTable: HTMLDivElement | null = null;

// O(1) pieceId → button lookup
const _buttonMap = new Map<string, HTMLButtonElement>();

// Persistent focus tracking — NOT cleared on blur, only on explicit actions
// (extraction, placement, bench close). Survives DOM reorders and PixiJS focus steals.
let _trackedPieceId: string | null = null;

export function getFocusedPieceId(): string | null { return _trackedPieceId; }
export function clearFocusedPieceId(): void        { _trackedPieceId = null; }

// ─── Registered callbacks ─────────────────────────────────────────────────────
// Wired by scene.ts via registerBenchHandlers after initFocusRing.
// aria.ts never imports scene.ts or bench.ts — callbacks break the dep cycle.

let _onBenchFocus:    (pieceId: string) => void = () => {};
let _onBenchBlur:     () => void                = () => {};
let _onBenchActivate: (pieceId: string) => void = () => {};

// ─── Registered callbacks — filter group ──────────────────────────────────────

let _onFilterActivate: (filterId: string) => void    = () => {};
let _onCycleFilter:    (direction: 1 | -1) => void   = () => {};

// Bench navigation helpers — wired from bench.ts via registerBenchNavHelpers.
// Used in createBenchButton keydown for keyboard focus continuation (Fix 2, Story 41a).
// bench.ts already imports aria.ts so it can call registerBenchNavHelpers during initTray.
let _getVisibleBenchOrder: () => string[]         = () => [];
let _scrollBenchToId:      (id: string) => void   = () => {};

// ─── Registered callbacks — table ─────────────────────────────────────────────
// Wired by scene.ts via registerTableHandlers after puzzle load.
// Same callback-registration pattern as bench — no circular imports.

interface TableHandlers {
  onFocus:    (pieceId: string) => void;
  onBlur:     () => void;
  onActivate: (pieceId: string) => void; // Enter / Space
  onEscape:   (pieceId: string) => void;
}
let _tableHandlers: TableHandlers | null = null;

// ─── Keyboard mode mirror ─────────────────────────────────────────────────────
// aria.ts mirrors scene.ts's _keyboardMode so bench.ts can read it without
// importing scene.ts (which would create a circular dep).
// Updated via applyBenchTabState(mode) — the only writer.

let _ariaKeyboardMode: 'bench' | 'table' = 'bench';

/** Read the current keyboard mode — for bench.ts creation-time tabIndex. */
export function getAriaKeyboardMode(): 'bench' | 'table' { return _ariaKeyboardMode; }

// ─── Tab stop type ────────────────────────────────────────────────────────────
// Used internally by getTableTabStops / syncTableButtonOrder.

interface TabStop {
  primaryPieceId: string;
  lowestIndex:    number;
  memberIds:      string[];
}

// Filter group DOM element — lives inside #landmark-bench, after all piece buttons
let _filterGroup: HTMLDivElement | null = null;

/**
 * Register focus/blur/activate callbacks for bench buttons.
 * Call once from scene.ts after initFocusRing — before initBenchButtons.
 *
 * onFocus:    called when a bench button receives focus (pieceId)
 * onBlur:     called when a bench button loses focus
 * onActivate: called when Enter or Space fires on a bench button (pieceId)
 */
export function registerBenchHandlers(
  onFocus:    (pieceId: string) => void,
  onBlur:     () => void,
  onActivate: (pieceId: string) => void,
): void {
  _onBenchFocus    = onFocus;
  _onBenchBlur     = onBlur;
  _onBenchActivate = onActivate;
}

/**
 * Register filter-group callbacks. Call once from scene.ts after initBenchButtons.
 * onActivate:    called when a filter button is clicked (mouse-only).
 * onCycleFilter: called when ] / [ fires on a bench piece button.
 */
export function registerFilterHandlers(
  onActivate:    (filterId: string) => void,
  onCycleFilter: (direction: 1 | -1) => void,
): void {
  _onFilterActivate = onActivate;
  _onCycleFilter    = onCycleFilter;
}

/**
 * Register bench navigation helpers for keyboard focus continuation.
 * Called from bench.ts (initTray) — bench.ts already imports aria.ts so no circular dep.
 *
 * getVisibleOrder: returns the current filter's visible bench piece IDs (snapshot source).
 * scrollTo:        scrolls the bench to reveal a piece by ID.
 */
export function registerBenchNavHelpers(
  getVisibleOrder: () => string[],
  scrollTo: (id: string) => void,
): void {
  _getVisibleBenchOrder = getVisibleOrder;
  _scrollBenchToId      = scrollTo;
}

/**
 * Register focus/blur/activate/escape callbacks for table buttons.
 * Call once from scene.ts after puzzle load.
 * Table buttons created subsequently will use these callbacks.
 */
export function registerTableHandlers(handlers: TableHandlers): void {
  _tableHandlers = handlers;
}

/**
 * Belt-and-suspenders tabIndex sweep for all bench piece buttons.
 *
 * When `mode` is provided it updates the cached `_ariaKeyboardMode` first,
 * so subsequent zero-arg calls (e.g. from layoutTrayPieces) use the latest value.
 *
 * Invariant enforced: if _ariaKeyboardMode === 'table', NO bench button is
 * tabbable regardless of when it was created or what filter visibility says.
 *
 * Call from:
 *   - setKeyboardMode (scene.ts) — with the new mode, on every mode switch
 *   - layoutTrayPieces (bench.ts) — without arg, as safety net at end of layout
 *
 * inert is kept as the semantic signal for AT.
 * Explicit tabIndex sweep guarantees Tab order regardless of browser/extension env.
 */
export function applyBenchTabState(mode?: 'bench' | 'table'): void {
  if (mode !== undefined) _ariaKeyboardMode = mode;
  const benchLandmark = document.getElementById(LANDMARK_BENCH_ID);
  if (!benchLandmark) return;
  const buttons = benchLandmark.querySelectorAll<HTMLButtonElement>('button[data-piece-id]');
  if (_ariaKeyboardMode !== 'bench') {
    buttons.forEach((btn) => { btn.tabIndex = -1; });
    return;
  }
  // Bench mode: only filtered-in pieces get tabIndex=0 — Tab stays within visible set.
  // _getVisibleBenchOrder() is registered by bench.ts via registerBenchNavHelpers.
  const visibleIds = new Set(_getVisibleBenchOrder());
  buttons.forEach((btn) => {
    btn.tabIndex = visibleIds.has(btn.dataset.pieceId!) ? 0 : -1;
  });
}

// ─── Visually hidden style ─────────────────────────────────────────────────────
// Same clip-rect pattern as the old aria.ts container.
// pointer-events:none prevents invisible elements intercepting mouse clicks.
// Buttons inside still receive keyboard focus and keydown events.

const VISUALLY_HIDDEN_CSS = [
  'position:absolute',
  'width:1px',
  'height:1px',
  'overflow:hidden',
  'clip:rect(0,0,0,0)',
  'white-space:nowrap',
  'pointer-events:none',
].join(';');

// ─── Landmark init ────────────────────────────────────────────────────────────

/**
 * Create (or recreate) the two role="application" landmark divs.
 * Idempotent — removes any pre-existing landmarks before creating new ones.
 * DOM order: #landmark-bench first, #landmark-table second — natural tab flow.
 *
 * Call on puzzle load (before initBenchButtons).
 * TODO: Story 55 — call initLandmarks() + initBenchButtons() after session restore.
 */
export function initLandmarks(): void {
  document.getElementById(LANDMARK_BENCH_ID)?.remove();
  document.getElementById(LANDMARK_TABLE_ID)?.remove();
  _buttonMap.clear();
  _trackedPieceId = null;

  _landmarkBench = document.createElement('div');
  _landmarkBench.setAttribute('role', 'application');
  _landmarkBench.setAttribute('aria-label', 'Piece bench — 5 Palette Groups');
  _landmarkBench.id       = LANDMARK_BENCH_ID;
  _landmarkBench.tabIndex = -1; // programmatically focusable, not in tab order
  _landmarkBench.style.cssText = VISUALLY_HIDDEN_CSS;

  _landmarkTable = document.createElement('div');
  _landmarkTable.setAttribute('role', 'application');
  _landmarkTable.setAttribute('aria-label', 'Puzzle table');
  _landmarkTable.id       = LANDMARK_TABLE_ID;
  _landmarkTable.tabIndex = -1;
  _landmarkTable.style.cssText = VISUALLY_HIDDEN_CSS;

  // Prepend to <body> so bench buttons are the first focusable elements in DOM order.
  // First Tab from anywhere on the page lands on the first bench piece — no chrome in between.
  document.body.insertBefore(_landmarkBench, document.body.firstChild);
  document.body.insertBefore(_landmarkTable, _landmarkBench.nextSibling);

  // Space key conflict — prevent page scroll inside both landmarks.
  _landmarkTable.addEventListener('keydown', (e) => {
    if (e.key === ' ') e.preventDefault();
  });

  // #landmark-bench: Space prevention only.
  // [/] filter cycling is handled per-button in createBenchButton.
  _landmarkBench.addEventListener('keydown', (e) => {
    if (e.key === ' ') e.preventDefault();
  });
}

// ─── Button label ─────────────────────────────────────────────────────────────

function _updateButtonLabel(btn: HTMLButtonElement, piece: Piece): void {
  const stageLabel =
    isPlaced(piece)  ? 'Placed'   :
    isOnTable(piece) ? 'On table' :
    isInBench(piece) ? 'In bench' :
                       'Unknown';

  btn.setAttribute(
    'aria-label',
    `Piece ${piece.index} — Palette ${piece.paletteIndex + 1}, ` +
    `row ${piece.gridCoord.row + 1}, column ${piece.gridCoord.col + 1}, ` +
    `${stageLabel}`,
  );
}

// ─── Button lifecycle ─────────────────────────────────────────────────────────

/**
 * Create a focusable bench button for `piece` and append it to #landmark-bench.
 * Wires focus / blur / keydown handlers using the registered callbacks.
 */
export function createBenchButton(piece: Piece): HTMLButtonElement {
  if (!_landmarkBench) throw new Error('initLandmarks() must be called before createBenchButton()');

  const btn = document.createElement('button');
  btn.dataset.pieceId = piece.id;
  btn.tabIndex = 0;
  _updateButtonLabel(btn, piece);

  btn.addEventListener('focus', () => {
    _trackedPieceId = piece.id; // persist — survives DOM reorders and blur/refocus cycles
    _onBenchFocus(piece.id);
  });

  btn.addEventListener('blur', () => {
    // Do NOT clear _trackedPieceId — it must survive filter changes and DOM reorders.
    // Only cleared explicitly: extraction, placement, bench close.
    _onBenchBlur();
  });

  // Enter / Space — spiral extraction. See docs/spike-keyboard-focus.md §9.9.
  // [/] filter cycling is global (scene.ts window handler) — not on individual buttons.
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();

    // Snapshot pre-mutation order — immune to DOM reflow and filter updates
    const snapshotOrder = _getVisibleBenchOrder();
    const currentIdx    = snapshotOrder.indexOf(piece.id);

    // Next only — no reverse fallback (linear, predictable).
    // If extracting the last piece, nextId is null — reconciliation handles the rest.
    const nextId: string | null = currentIdx === -1
      ? snapshotOrder[0] ?? null
      : snapshotOrder[currentIdx + 1] ?? null;

    // Extract — reconcileBenchState fires inside extractPieceFromBench
    _onBenchActivate(piece.id);

    // Focus continuation — keyboard only, never fires for mouse or drag.
    requestAnimationFrame(() => {
      if (nextId) {
        const p = usePuzzleStore.getState().piecesById[nextId];
        if (p && isInBench(p)) {
          focusButton(nextId);
          _scrollBenchToId(nextId);
          return;
        }
      }
      // nextId null or piece no longer in bench —
      // reconciliation already handled mode switch and collapse.
    });
  });

  _landmarkBench.appendChild(btn);
  _buttonMap.set(piece.id, btn);
  return btn;
}

/**
 * Update the aria-label of an existing bench button to reflect current piece state.
 * Call on every piece state transition.
 */
export function updateButtonLabel(piece: Piece): void {
  const btn = _buttonMap.get(piece.id);
  if (btn) _updateButtonLabel(btn, piece);
}

/**
 * Create bench buttons for all currently in-bench pieces.
 * Call after initLandmarks() and registerBenchHandlers() on puzzle load.
 */
export function initBenchButtons(pieces: Piece[]): void {
  pieces.filter(isInBench).forEach(createBenchButton);
}

/**
 * Remove a piece's button from DOM and the button map.
 * Call immediately after extraction (before focus handoff).
 */
export function removeButton(pieceId: string): void {
  const btn = _buttonMap.get(pieceId);
  if (!btn) return;
  btn.remove();
  _buttonMap.delete(pieceId);
}

/**
 * Set the tabIndex of a bench button.
 * Use 0 for visible (in-filter) pieces, -1 for filtered-out pieces.
 * tabIndex=-1 removes the element from tab order without removing it from DOM.
 */
export function setButtonTabIndex(pieceId: string, n: 0 | -1): void {
  const btn = _buttonMap.get(pieceId);
  if (btn) btn.tabIndex = n;
}

/**
 * Programmatically focus a bench button.
 * Used for focus handoff after extraction or filter change.
 */
export function focusButton(pieceId: string): void {
  _buttonMap.get(pieceId)?.focus();
}

/**
 * Reorder bench buttons in the DOM to match the given visual order.
 * Uses appendChild to move each button to the end in sequence — after all calls
 * the buttons are in `orderedIds` order with no gaps.
 *
 * Call after every layoutTrayPieces (from bench.ts) and once after initBenchButtons
 * (from scene.ts, using getTrayDisplayOrder) to fix the initial creation order.
 *
 * Only pass IDs for buttons that should be reachable via Tab (tabIndex=0 — the
 * currently-filtered-in set). Filtered-out buttons (tabIndex=-1) remain wherever
 * they are in DOM; their order doesn't affect tab flow.
 */
export function syncButtonDOMOrder(orderedIds: string[]): void {
  if (!_landmarkBench) return;
  for (const id of orderedIds) {
    const btn = _buttonMap.get(id);
    if (btn) _landmarkBench.appendChild(btn); // moves to end — browser preserves no duplicates
  }
  // Always keep the filter group last inside the landmark (after all piece buttons).
  if (_filterGroup) _landmarkBench.appendChild(_filterGroup);
}

// ─── Filter radiogroup ────────────────────────────────────────────────────────

/**
 * Maps a filter ID to a human-readable name for ARIA labels.
 */
function filterAriaName(id: string): string {
  if (id === 'all')      return 'All';
  if (id === 'corner')   return 'Corners';
  if (id === 'edge')     return 'Edges';
  if (id === 'interior') return 'Interior';
  if (id.startsWith('palette-')) return `Palette ${parseInt(id.slice(8), 10) + 1}`;
  return id;
}

/**
 * Compute the accessible label for a filter button.
 * Empty inactive → "Corners filter, empty"
 * Empty active   → "Corners filter, empty, currently selected"
 * Non-empty      → "Corners filter, 4 pieces"
 */
function filterAriaLabel(f: FilterDef): string {
  const name    = filterAriaName(f.id);
  const isEmpty = f.count === 0;
  if (isEmpty) {
    return f.isActive
      ? `${name} filter, empty, currently selected`
      : `${name} filter, empty`;
  }
  return `${name} filter, ${f.count} pieces`;
}

/**
 * Create filter buttons inside #landmark-bench — mouse-only, all tabIndex=-1.
 * Idempotent — removes any pre-existing group first.
 * Keyboard users cycle filters via ] / [ on piece buttons.
 * Call after initBenchButtons and registerFilterHandlers.
 */
export function initFilterButtons(filters: FilterDef[]): void {
  if (!_landmarkBench) return;
  _filterGroup?.remove();

  const group = document.createElement('div');
  group.id = 'bench-filter-group';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Filter pieces');
  group.style.cssText = VISUALLY_HIDDEN_CSS;

  filters.forEach((f) => {
    const radio = document.createElement('button');
    radio.type = 'button';
    radio.setAttribute('role', 'radio');
    radio.setAttribute('aria-checked', f.isActive ? 'true' : 'false');
    radio.setAttribute('aria-label', filterAriaLabel(f));
    radio.dataset.filterId = f.id;
    radio.tabIndex = -1; // mouse-only — never reachable by Tab
    radio.textContent = f.label;
    // Empty inactive = disabled for AT. Empty active = enabled (selection visible).
    radio.disabled = f.count === 0 && !f.isActive;

    radio.addEventListener('click', () => _onFilterActivate(f.id));

    group.appendChild(radio);
  });

  _landmarkBench.appendChild(group);
  _filterGroup = group;
}

/**
 * Update filter radio button labels and ARIA state without recreating the group.
 * Sets disabled + aria-label to match empty/active state exactly.
 * No-op if initFilterButtons has not been called.
 */
export function updateFilterButtonLabels(filters: FilterDef[]): void {
  if (!_filterGroup) return;
  const radios = Array.from(
    _filterGroup.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  );
  filters.forEach((f, i) => {
    const radio = radios[i];
    if (radio) {
      radio.textContent = f.label;
      radio.setAttribute('aria-label', filterAriaLabel(f));
      radio.dataset.filterId = f.id;
      // Empty inactive → disabled. Empty active → enabled (selection state visible).
      radio.disabled = f.count === 0 && !f.isActive;
    }
  });
}

/**
 * Sync aria-checked on filter radio buttons to reflect the active filter.
 * tabIndex is always -1 (mouse-only buttons) — not touched here.
 * Call at the end of applyBenchFilter (bench.ts).
 */
export function setActiveFilterButton(filterId: string): void {
  if (!_filterGroup) return;
  _filterGroup.querySelectorAll<HTMLButtonElement>('[role="radio"]').forEach((radio) => {
    radio.setAttribute('aria-checked', radio.dataset.filterId === filterId ? 'true' : 'false');
  });
}

// ─── Table buttons ────────────────────────────────────────────────────────────

/**
 * Compute the aria-label for a table button in its default (not-held) state.
 * Row/col are 1-based for human-readable output.
 */
function _updateTableButtonLabel(btn: HTMLButtonElement, piece: Piece): void {
  btn.setAttribute(
    'aria-label',
    `Piece ${piece.index} — row ${piece.gridCoord.row + 1}, ` +
    `column ${piece.gridCoord.col + 1}, On table`,
  );
}

/**
 * Update the aria-label of an existing table button to the default "On table" state.
 * Called after put-down to restore the label from "Held".
 */
export function updateTableButtonLabel(piece: Piece): void {
  const btn = _buttonMap.get(piece.id);
  if (btn) _updateTableButtonLabel(btn, piece);
}

/**
 * Create a focusable table button for `piece` and append it to #landmark-table.
 * Wires focus / blur / keydown / escape handlers using registered table callbacks.
 *
 * Call from extractPieceFromBench (bench.ts) after the piece transitions to STAGE_TABLE.
 * The piece's bench button must already have been removed via removeButton before this call.
 */
export function createTableButton(piece: Piece): HTMLButtonElement {
  if (!_landmarkTable) throw new Error('initLandmarks() must be called before createTableButton()');

  const btn = document.createElement('button');
  btn.dataset.pieceId = piece.id;
  btn.tabIndex = 0;
  _updateTableButtonLabel(btn, piece);

  btn.addEventListener('focus', () => {
    _tableHandlers?.onFocus(piece.id);
  });

  btn.addEventListener('blur', () => {
    _tableHandlers?.onBlur();
  });

  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      _tableHandlers?.onActivate(piece.id);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      _tableHandlers?.onEscape(piece.id);
    }
  });

  _landmarkTable.appendChild(btn);
  _buttonMap.set(piece.id, btn);
  return btn;
}

// ─── Cluster tab stops ────────────────────────────────────────────────────────

/**
 * Set tabIndex on all buttons for a cluster's members.
 * The lowest-index member gets tabIndex=0 (the single tab stop for the cluster).
 * All other members get tabIndex=-1 (reachable only via the primary button).
 *
 * Call from snap.ts whenever a cluster forms or gains a new member.
 */
export function syncClusterTabStops(clusterPieces: Piece[]): void {
  const sorted = [...clusterPieces].sort((a, b) => a.index - b.index);
  sorted.forEach((piece, i) => {
    setButtonTabIndex(piece.id, i === 0 ? 0 : -1);
  });
}

/**
 * Derive one tab stop per cluster (primary = lowest index) plus one per lone piece.
 * Returns an unsorted list — caller sorts by lowestIndex.
 */
function getTableTabStops(pieces: Piece[]): TabStop[] {
  const clusters = new Map<string, Piece[]>();
  const lone: Piece[] = [];

  for (const p of pieces) {
    if (p.clusterId) {
      const group = clusters.get(p.clusterId) ?? [];
      group.push(p);
      clusters.set(p.clusterId, group);
    } else {
      lone.push(p);
    }
  }

  const stops: TabStop[] = [];

  clusters.forEach((members) => {
    const sorted = [...members].sort((a, b) => a.index - b.index);
    stops.push({
      primaryPieceId: sorted[0].id,
      lowestIndex:    sorted[0].index,
      memberIds:      sorted.map((p) => p.id),
    });
  });

  lone.forEach((p) => {
    stops.push({ primaryPieceId: p.id, lowestIndex: p.index, memberIds: [p.id] });
  });

  return stops;
}

/**
 * Reorder table buttons in DOM so Tab flows ascending by lowest piece index
 * within each cluster (or lone piece). Pure derivation from current store state —
 * never persisted, recomputed on every snap/merge event.
 *
 * Call from snap.ts after every snap or merge.
 */
export function syncTableButtonOrder(): void {
  if (!_landmarkTable) return;
  const pieces = usePuzzleStore.getState().pieces.filter(isOnTable);
  const tabStops = getTableTabStops(pieces);
  tabStops.sort((a, b) => a.lowestIndex - b.lowestIndex);
  tabStops.forEach((stop) => {
    const btn = _buttonMap.get(stop.primaryPieceId);
    if (btn) _landmarkTable!.appendChild(btn); // appendChild to end = reorder
  });
}
