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

// Table landmark label dedup — last written value; prevents redundant DOM writes.
// Story 42a: label is static "Puzzle table", so after first write this is always a no-op.
let _lastTableLabel = '';

// Live region for one-shot screen reader announcements (aria-live="polite").
// Created once in initLandmarks; used via announce().
let _liveRegion:     HTMLElement | null = null;
let _announceTimer:  ReturnType<typeof setTimeout> | null = null;

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
  _lastTableLabel = ''; // reset dedup so initTableLandmarkLabel writes on next call

  // Live region created once — persists across puzzle reloads (idempotent).
  initLiveRegion();

  _landmarkBench = document.createElement('div');
  _landmarkBench.setAttribute('role', 'application');
  _landmarkBench.setAttribute('aria-label', 'Piece tray');
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

// ─── Reactive table landmark label ───────────────────────────────────────────

/**
 * Ensure #landmark-table has the static "Puzzle table" aria-label.
 * Deduped — DOM write fires only once per puzzle load (label never changes after set).
 * Story 42a: label is static. Puzzle-complete announcement goes via announce() in scene.ts.
 */
export function updateTableLandmarkLabel(): void {
  if (!_landmarkTable) return;
  if (_lastTableLabel !== 'Puzzle table') {
    _landmarkTable.setAttribute('aria-label', 'Puzzle table');
    _lastTableLabel = 'Puzzle table';
  }
}

/**
 * Set the static #landmark-table aria-label once at puzzle load.
 * No store subscription needed — label is static in Story 42a.
 * Call after initLandmarks().
 */
export function initTableLandmarkLabel(): void {
  updateTableLandmarkLabel();
}

// ─── Focus safety utility ─────────────────────────────────────────────────────

/**
 * Redirect focus from `el` to `fallback` if `el` is the current active element.
 * Call before removing or hiding any DOM node that might be focused.
 * Prevents focus falling to <body> when a focused element is mutated out of view.
 */
export function redirectFocusIfActive(el: HTMLElement, fallback: HTMLElement): void {
  if (document.activeElement === el) fallback.focus();
}

// ─── Live region announcements ────────────────────────────────────────────────

/**
 * Create the aria-live="polite" region and append it to <body>.
 * Idempotent — no-op if already initialised.
 * Called from initLandmarks() so the region is always available when landmarks exist.
 */
function initLiveRegion(): void {
  if (_liveRegion) return;
  _liveRegion = document.createElement('div');
  _liveRegion.setAttribute('aria-live', 'polite');
  _liveRegion.setAttribute('aria-atomic', 'true');
  _liveRegion.style.cssText = VISUALLY_HIDDEN_CSS;
  document.body.appendChild(_liveRegion);
}

/**
 * Announce `text` to screen readers via the aria-live region.
 * Clears the region first to guarantee re-announcement even when text repeats.
 * Debounced — rapid successive calls keep only the latest text (prevents stacking).
 */
export function announce(text: string): void {
  if (!_liveRegion) return;
  _liveRegion.textContent = '';
  if (_announceTimer !== null) clearTimeout(_announceTimer);
  _announceTimer = setTimeout(() => {
    if (_liveRegion) _liveRegion.textContent = text;
    _announceTimer = null;
  }, 0);
}

// ─── Button label ─────────────────────────────────────────────────────────────

function _updateButtonLabel(btn: HTMLButtonElement, piece: Piece): void {
  // Classification-only label — concise, no IDs, no position metadata (Story 42a).
  const label =
    piece.edgeType === 'corner' ? 'Corner piece' :
    piece.edgeType === 'edge'   ? 'Edge piece'   :
                                  'Interior piece';
  btn.setAttribute('aria-label', label);
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
  // Escape — deselect, return focus to bench landmark (stable recovery point).
  //   Blur fires _onBenchBlur → setFocusedPiece(null) → clears focus ring.
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      document.getElementById(LANDMARK_BENCH_ID)?.focus();
      return;
    }
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
    announce('Activated');

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
 * Set the default table button label — state-only, no position metadata (Story 42a).
 */
function _updateTableButtonLabel(btn: HTMLButtonElement, _piece: Piece): void {
  btn.setAttribute('aria-label', 'Piece');
}

/**
 * Restore a table button label from "Held" (or any transient state).
 * Cluster-aware and placed-aware — Story 42a state-only labels:
 *   Placed         → "Placed"
 *   Primary of N≥2 → "Group of N"
 *   Solo / non-primary member → "Piece"
 *
 * Called from scene.ts after put-down and after board snap.
 * Also called from syncClusterTabStops, which handles the primary-label case
 * independently — both are idempotent so order doesn't matter.
 */
export function updateTableButtonLabel(piece: Piece): void {
  const btn = _buttonMap.get(piece.id);
  if (!btn) return;

  if (isPlaced(piece)) {
    btn.setAttribute('aria-label', 'Placed');
    return;
  }

  const state = usePuzzleStore.getState();
  const cluster = piece.clusterId ? state.groupsById[piece.clusterId] : null;
  if (cluster && cluster.pieceIds.length > 1) {
    // Identify primary = lowest piece.index in cluster
    const members = cluster.pieceIds
      .map((id) => state.piecesById[id])
      .filter(Boolean) as Piece[];
    const primary = [...members].sort((a, b) => a.index - b.index)[0];
    if (primary?.id === piece.id) {
      btn.setAttribute('aria-label', `Group of ${cluster.pieceIds.length}`);
      return;
    }
  }

  btn.setAttribute('aria-label', 'Piece');
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
 * Set tabIndex and aria-label on all buttons for a cluster's members.
 * Primary (lowest index) gets tabIndex=0 and "Group of N".
 * All other members get tabIndex=-1 and "Piece" (not reachable via Tab).
 *
 * Call from snap.ts whenever a cluster forms or gains a new member.
 */
export function syncClusterTabStops(clusterPieces: Piece[]): void {
  const sorted = [...clusterPieces].sort((a, b) => a.index - b.index);
  const n = sorted.length;
  sorted.forEach((piece, i) => {
    setButtonTabIndex(piece.id, i === 0 ? 0 : -1);
    const btn = _buttonMap.get(piece.id);
    if (btn) btn.setAttribute('aria-label', i === 0 ? `Group of ${n}` : 'Piece');
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
