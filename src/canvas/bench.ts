import {
  Application,
  Container,
  FederatedPointerEvent,
  FederatedWheelEvent,
  FillGradient,
  Filter,
  Graphics,
  Point,
  Sprite,
  Text,
} from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { usePuzzleStore, type TrayFilter } from '../store/puzzleStore';
import { isInBench, isOnTable, type Piece } from '../puzzle/types';
import { hexToRgb } from '../puzzle/cutter';
import {
  LANDMARK_BENCH_ID,
  LANDMARK_TABLE_ID,
  removeButton,
  focusButton,
  setButtonTabIndex,
  syncButtonDOMOrder,
  updateFilterButtonLabels,
  setActiveFilterButton,
  getFocusedPieceId,
  clearFocusedPieceId,
  registerBenchNavHelpers,
  createTableButton,
  applyBenchTabState,
  getAriaKeyboardMode,
  redirectFocusIfActive,
  announce,
  type FilterDef,
} from '../utils/aria';

// Filter ID → concise announcement text (Story 42a — filter name only, no sentence).
const FILTER_ANNOUNCE: Record<string, string> = {
  all:      'All pieces',
  corner:   'Corners',
  edge:     'Edges',
  interior: 'Interior',
};
import {
  isDraggingCanvas,
  insertGroupAABB,
  startDragForPiece,
} from '../puzzle/drag';
import { addGreyscaleFilter, BACKGROUND_PRESETS, BG_PRESETS_ORDER, LABEL_CONTAINER_NAME } from '../utils/preferences';

// ─── Constants ────────────────────────────────────────────────────────────────

export const TRAY_HEIGHT_OPEN   = 220; // px — tunable
export const TRAY_HEIGHT_CLOSED =  40; // collapsed strip height

// Normal mode: glass tray at 85% opacity.
// High contrast: pure black at full opacity — no transparency, maximises legibility (AC-2).
const TRAY_BG_DEFAULT_COLOR = 0x1a1a1a;
const TRAY_BG_DEFAULT_ALPHA = 0.85;
const TRAY_BG_HC_COLOR      = 0x000000;
const TRAY_BG_HC_ALPHA      = 1.0;
const TRAY_HANDLE_COLOR     = 0x888899;

// Grid layout constants — Story 33 / Story 46b
const PADDING             = 8;  // px between thumbnails
// Filter strip — Story 34
const FILTER_STRIP_HEIGHT = 36; // px — above the piece grid

// THUMBNAIL_SIZE is the piece cell size (px). Must fit within the mask area with room
// for the stage-level focus ring (FOCUS_RING_PADDING=4 + FOCUS_RING_THICKNESS=2 in scene.ts).
// Available height = TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED - FILTER_STRIP_HEIGHT - PADDING
//   = 220 - 40 - 36 - 8 = 136. Subtract BENCH_RING_CLEARANCE → 128.
// If scene.ts ring constants change, update BENCH_RING_CLEARANCE here too.
const BENCH_RING_CLEARANCE = 8; // ≥ FOCUS_RING_PADDING + FOCUS_RING_THICKNESS in scene.ts
const THUMBNAIL_SIZE = TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED - FILTER_STRIP_HEIGHT - PADDING - BENCH_RING_CLEARANCE; // 128

// ─── Bench glow constants ─────────────────────────────────────────────────────
// Tunable parameters for the per-slot uplight gradient. Exposed at top of file
// for easy iteration during QA. Not in HC mode (sandwich stroke handles that).
const BENCH_GLOW_COLOR     = 0xfff5e0;   // warm off-white uplight
const BENCH_GLOW_ALPHA_MAX = 0.22;       // alpha at the bottom edge of the slot
const BENCH_GLOW_FADE_STOP = 0.60;       // glow reaches zero alpha at this fraction from the bottom
const BENCH_GLOW_TAG       = 'bench-glow'; // Graphics label for idempotent add/remove

const FILTER_OPTIONS: { key: TrayFilter; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'corner',   label: 'Corners' },
  { key: 'edge',     label: 'Edges' },
  { key: 'interior', label: 'Interior' },
];

// ─── Module state ─────────────────────────────────────────────────────────────

let _app: Application | null = null;
let _viewport: Viewport | null = null;
let _trayContainer: Container | null = null;
let _bg: Graphics | null = null;
let _handle: Graphics | null = null;
let _stripHitArea: Graphics | null = null;
let _piecesContainer: Container | null = null; // clips piece overflow (mask applied)
let _piecesMask: Graphics | null = null;        // mask on _piecesContainer
let _gridContainer: Container | null = null;    // scrollable inner container
let _filterContainer: Container | null = null;
let _emptyText: Text | null = null;
let _spriteMap: Map<string, Sprite> | null = null;
let _containerMap: Map<string, Container> | null = null;
let _canvasScale = 1;
let _piecePixelW = 0;
let _piecePixelH = 0;

// Per-piece original filters — cleared in tray, restored on extraction
const _originalFilters = new Map<string, Filter[]>();

// Shuffled display order — randomised once on init, updated as pieces extract.
// Also serves as keyboard tab order: Tab follows the visual bench layout left→right.
let _trayDisplayOrder: string[] = [];

// Animation state
let currentTrayHeight = TRAY_HEIGHT_OPEN;
let targetTrayHeight  = TRAY_HEIGHT_OPEN;

// Tray pointer state (piece drag)
let trayPointerDownId: number | null = null;
let trayPointerDownPieceId: string | null = null;
let trayPointerDownX = 0;
let trayPointerDownY = 0;
let trayPointerMovedFar = false; // true if pointer moved >4px from down position
let trayPointerDidCross = false;
// Screen-space offset from pointer to sprite center at press time — used to
// keep the grab point tight when the piece is extracted into world-space.
let trayPointerDownSpriteDX = 0;
let trayPointerDownSpriteDY = 0;

// Scroll drag state
let _scrollDragActive = false;
let _scrollDragPointerId: number | null = null;
let _scrollDragStartX = 0;
let _scrollDragStartScrollX = 0;

// Scroll position
let _scrollX = 0;
let _totalGridWidth = 0;

// Spiral placement state
let spiralIndex = 0;
let spiralOriginX = 0;
let spiralOriginY = 0;
let spiralOriginLocked = false;

// Loading spinner state — hides pieces until cuts are applied
let _loadingSpinner: Container | null = null;
let _loadingTickerFn: (() => void) | null = null;

// HC store subscription — unsubscribed on teardown, replaced on re-init (AC-2)
let _unsubscribeHC: (() => void) | null = null;

// Glow state — whether the bench uplight glow is currently active (Story 47a)
let _glowEnabled  = false;
let _glowGradient: FillGradient | null = null;

// DOM bench strip handle — focusable element for keyboard open, focus handoff on close
let _benchStripHandle: HTMLButtonElement | null = null;

// Smooth scroll animation target — null when no animation in flight
let _scrollTarget: number | null = null;

// Greyscale store subscription — unsubscribed on teardown (Story 37e)
let _unsubscribeGreyscale: (() => void) | null = null;

// Zone swatch containers — rebuilt on each renderFilterStrip call (Story 37e)
const _swatchContainers: Container[] = [];

// Zoom-to-place animation state (Story 36)
let _zoomInFlight = false;
let _zoomFlightPieceId: string | null = null;
let _zoomTickerFn: (() => void) | null = null;

// DOM element for zoom toggle — removed when Story 52 ships
let _zoomLabel: HTMLLabelElement | null = null;

// DOM elements for preference checkboxes — moved to settings panel in Story 52
let _prefLabels: HTMLLabelElement[] = [];
let _bgPresetLabel: HTMLElement | null = null;

// Bench collapse callback — registered by scene.ts after initLandmarks.
// Avoids a circular import: bench.ts cannot import from scene.ts.
// Called once when the last piece leaves the bench.
let _onBenchCollapse: () => void = () => {};

// Idempotency guard for applyBenchCollapseEffects — reset on new puzzle load.
// Prevents double-firing during bulk extraction (each piece goes through extractPieceFromBench).
let _benchCollapsed = false;

export function registerBenchCollapseHandler(fn: () => void): void {
  _onBenchCollapse = fn;
}

// ─── Deterministic PRNG + bench order ────────────────────────────────────────

/**
 * Mulberry32 — fast, high-quality 32-bit seeded PRNG.
 * Returns a closure that produces a new float in [0, 1) on each call.
 * Internal to bench.ts — not exported.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/**
 * djb2 hash — maps an arbitrary string to an unsigned 32-bit integer.
 * Used to derive a stable seed from the session URI.
 * Internal to bench.ts — not exported.
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash;
}

/**
 * Derive the master bench display order from the session URI.
 * Called once at puzzle load — result stored in _trayDisplayOrder.
 * Never called again on filter change.
 *
 * Order seed: hash(sessionUri)
 */
function deriveBenchOrder(pieces: Piece[], sessionUri: string): string[] {
  const seed = hashString(sessionUri);
  const rng  = mulberry32(seed);

  const ids = pieces.filter(isInBench).map((p) => p.id);

  // Fisher-Yates with seeded RNG — deterministic
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }

  return ids; // master order — stored once, never recomputed on filter change
}

/**
 * Return a cardinal rotation (0 / 90 / 180 / 270) for a bench piece.
 * Derived from a piece-specific suffix on the session URI so it is
 * completely independent of the order derivation.
 *
 * Rotation seed: hash(sessionUri + ':rot:' + pieceId)
 */
function seededPieceRotation(
  pieceId: string,
  sessionUri: string,
): 0 | 90 | 180 | 270 {
  const seed     = hashString(`${sessionUri}:rot:${pieceId}`);
  const rng      = mulberry32(seed);
  const cardinals = [0, 90, 180, 270] as const;
  return cardinals[Math.floor(rng() * 4)];
}

/**
 * Filter view over the master bench order.
 * Called by layoutTrayPieces, syncButtonDOMOrder, and scrollBenchToId.
 * Exported for aria.ts nav helper registration (keyboard focus continuation).
 * Never reorders — only filters pieces that match `filter` and are still in bench.
 */
export function getVisibleBenchOrder(filter: TrayFilter): string[] {
  const { piecesById } = usePuzzleStore.getState();
  const all = _trayDisplayOrder.filter((id) => {
    const piece = piecesById[id];
    return piece !== undefined && isInBench(piece);
  });
  if (filter === 'all') return all;
  if (filter.startsWith('palette-')) {
    const zone = parseInt(filter.slice(8), 10);
    return all.filter((id) => piecesById[id]?.paletteIndex === zone);
  }
  return all.filter((id) => piecesById[id]?.edgeType === filter);
}

// ─── Bench glow helpers (Story 47a) ──────────────────────────────────────────

function getGlowGradient(): FillGradient {
  if (!_glowGradient) {
    const r = ((BENCH_GLOW_COLOR >> 16) & 0xff) / 255;
    const g = ((BENCH_GLOW_COLOR >> 8)  & 0xff) / 255;
    const b = (BENCH_GLOW_COLOR         & 0xff) / 255;
    _glowGradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end:   { x: 0, y: 1 },   // 'local' textureSpace: 0–1 maps to bounding-box top–bottom
      textureSpace: 'local',
    });
    // top 40% of slot: fully transparent; bottom 60%: linear ramp to BENCH_GLOW_ALPHA_MAX
    _glowGradient.addColorStop(0,                         [r, g, b, 0]);
    _glowGradient.addColorStop(1 - BENCH_GLOW_FADE_STOP,  [r, g, b, 0]);
    _glowGradient.addColorStop(1,                         [r, g, b, BENCH_GLOW_ALPHA_MAX]);
  }
  return _glowGradient;
}

function addBenchGlowToContainer(container: Container): void {
  if (container.getChildByLabel(BENCH_GLOW_TAG)) return;
  const glow = new Graphics();
  glow.label = BENCH_GLOW_TAG;
  container.addChildAt(glow, 0); // index 0 → behind the sprite at index 1
}

function removeBenchGlowFromContainer(container: Container): void {
  const glow = container.getChildByLabel(BENCH_GLOW_TAG) as Graphics | null;
  if (!glow) return;
  container.removeChild(glow);
  glow.destroy();
}

/** Strip all bench-only chrome before reparenting a container to the canvas. */
export function prepareContainerForCanvas(container: Container): void {
  removeBenchGlowFromContainer(container);
  // Future: any other bench-only chrome cleanup goes here
}

function addAllBenchGlows(): void {
  if (!_containerMap) return;
  const { piecesById } = usePuzzleStore.getState();
  for (const [id, container] of _containerMap) {
    const piece = piecesById[id];
    if (!piece || !isInBench(piece)) continue;
    addBenchGlowToContainer(container);
  }
  _glowEnabled = true;
}

function removeAllBenchGlows(): void {
  if (!_containerMap) return;
  for (const container of _containerMap.values()) {
    removeBenchGlowFromContainer(container);
  }
  _glowEnabled = false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function screenW(): number {
  return _app ? Math.max(_app.screen.width, window.innerWidth) : window.innerWidth;
}

function maxScroll(): number {
  return Math.max(0, _totalGridWidth - screenW());
}

function clampScroll(v: number): number {
  return Math.max(0, Math.min(v, maxScroll()));
}

// ─── Scroll animation ─────────────────────────────────────────────────────────

function animateScrollTo(targetX: number): void {
  _scrollTarget = targetX;
}

/**
 * Scroll the bench to reveal the piece at `pieceId`.
 * No-op if the piece is already fully visible.
 * Respects reducedMotion: snaps immediately when active, otherwise lerps via ticker.
 * Exported for aria.ts focus handler wiring in scene.ts.
 */
export function scrollBenchToId(pieceId: string): void {
  const inTray = visibleInTray();
  const idx = inTray.indexOf(pieceId);
  if (idx === -1) return;

  const availH = TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED - FILTER_STRIP_HEIGHT - PADDING;
  const rows   = Math.max(1, Math.floor(availH / (THUMBNAIL_SIZE + PADDING)));
  const col    = Math.floor(idx / rows);

  const targetScrollX = PADDING + col * (THUMBNAIL_SIZE + PADDING);
  const pieceScreenX  = targetScrollX - _scrollX;
  const visibleWidth  = screenW();

  const alreadyVisible =
    pieceScreenX >= 0 && pieceScreenX + THUMBNAIL_SIZE <= visibleWidth;
  if (alreadyVisible) return;

  const newScrollX = Math.max(
    0,
    Math.min(
      targetScrollX - visibleWidth / 2 + THUMBNAIL_SIZE / 2,
      maxScroll(),
    ),
  );

  if (usePuzzleStore.getState().reducedMotion) {
    _scrollX = newScrollX;
    _scrollTarget = null;
    if (_gridContainer) _gridContainer.x = -_scrollX;
  } else {
    animateScrollTo(newScrollX);
  }
}

// ─── Bench reconciliation ─────────────────────────────────────────────────────

function isBenchEmpty(): boolean {
  return usePuzzleStore.getState().pieces.every((p) => !isInBench(p));
}

/**
 * Single-event bench collapse: inert, keyboard mode, and close all fire together.
 * Idempotent — _benchCollapsed guard prevents double-firing during bulk extraction.
 * Terminal transition — never reversed until next puzzle load.
 */
function applyBenchCollapseEffects(): void {
  if (_benchCollapsed) return;
  _benchCollapsed = true;

  // Guard focus BEFORE mutating DOM — prevents focus falling to <body> when the
  // strip handle is hidden while it is the active element (e.g. last piece dragged
  // out while strip handle held keyboard focus).
  if (_benchStripHandle) {
    const tableLandmark = document.getElementById(LANDMARK_TABLE_ID) as HTMLElement | null;
    if (tableLandmark) redirectFocusIfActive(_benchStripHandle, tableLandmark);
  }

  const benchLandmark = document.getElementById(LANDMARK_BENCH_ID) as HTMLElement | null;
  if (benchLandmark) benchLandmark.inert = true;

  _onBenchCollapse(); // fires setKeyboardMode('table') + setBenchCollapsed() in scene.ts
  setTrayOpen(false);

  // Hide strip handle permanently — bench can never reopen after collapse.
  // tabIndex=-1 removes it from tab order; display:none removes it visually and from AT.
  if (_benchStripHandle) {
    _benchStripHandle.style.display = 'none';
    _benchStripHandle.tabIndex = -1;
  }
}

function reconcileBenchState(): void {
  if (!isBenchEmpty()) return;
  applyBenchCollapseEffects();
}

/**
 * Shared extraction tail — called at the end of every extraction path.
 * Owns: ARIA button removal, focus tracking clear, tray order update,
 * reconciliation, and grid reflow.
 *
 * Does NOT own keyboard focus continuation — that lives in the keydown handler
 * in aria.ts so mouse and drag extraction never touch keyboard focus.
 *
 * Lives here (not at call sites) so no new extraction path can forget reconciliation.
 */
function extractPieceFromBench(pieceId: string): void {
  clearFocusedPieceId(); // always clear — extracted piece is leaving the bench
  removeButton(pieceId); // remove bench button from DOM and _buttonMap

  // Piece is already STAGE_TABLE (extractPieceToCanvas was called before this).
  // Create table button immediately — _buttonMap now holds the table button.
  const piece = usePuzzleStore.getState().piecesById[pieceId];
  if (piece) createTableButton(piece);

  // Glow lives with the bench slot — remove it from the container before the
  // container moves to the canvas (AC-6: canvas pieces must have no glow).
  const extractedContainer = _containerMap?.get(pieceId);
  if (extractedContainer) removeBenchGlowFromContainer(extractedContainer);

  _trayDisplayOrder = _trayDisplayOrder.filter((id) => id !== pieceId);
  // Reconcile after mutation — unconditional. Idempotent if bench is still non-empty.
  reconcileBenchState();
  layoutTrayPieces();
}

/**
 * After a filter change, resolve keyboard focus to the right bench piece.
 * Called after layoutTrayPieces — always jumps to the first visible piece.
 */
function handleFilterChangeFocus(): void {
  clearFocusedPieceId();
  const firstId = getFirstVisibleBenchPieceId();
  if (firstId) {
    focusButton(firstId);
    scrollBenchToId(firstId);
  } else {
    document.getElementById(LANDMARK_BENCH_ID)?.focus();
  }
}

/**
 * Apply a filter change and resolve keyboard focus.
 * tabIndex values are updated by layoutTrayPieces, then handleFilterChangeFocus
 * jumps focus to the first visible piece in the new filter.
 */
export function applyBenchFilter(filter: TrayFilter): void {
  // Apply the filter and reset scroll
  usePuzzleStore.getState().setActiveFilter(filter);
  _scrollX = 0;
  if (_gridContainer) _gridContainer.x = 0;
  _scrollTarget = null;

  // layoutTrayPieces syncs tabIndices for all bench buttons
  layoutTrayPieces();

  // Sync ARIA radio state to reflect the active filter
  setActiveFilterButton(filter);

  // Resolve focus after tabIndex values have settled
  handleFilterChangeFocus();

  // Announce filter name to screen readers — filter name only, no sentence (Story 42a).
  const name = FILTER_ANNOUNCE[filter as string]
    ?? `Palette ${parseInt((filter as string).slice(8), 10) + 1}`;
  announce(name);
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function updateEmptyState(isEmpty: boolean): void {
  if (!_piecesContainer) return;
  if (isEmpty) {
    if (!_emptyText) {
      _emptyText = new Text({
        text: 'All pieces placed',
        resolution: window.devicePixelRatio,
        style: { fill: 0x888899, fontSize: 16, fontFamily: 'sans-serif' },
      });
      _emptyText.anchor.set(0.5);
      _piecesContainer.addChild(_emptyText);
    }
    const availH = TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED;
    _emptyText.x = screenW() / 2;
    _emptyText.y = availH / 2;
    _emptyText.visible = true;
  } else if (_emptyText) {
    _emptyText.visible = false;
  }
}

// ─── Background + handle drawing ──────────────────────────────────────────────

function redrawBackground(): void {
  if (!_bg || !_handle) return;
  const w = screenW();
  const h = currentTrayHeight;
  const { trayOpen, highContrast } = usePuzzleStore.getState();
  const open = trayOpen;

  // AC-2: solid pure black at α 1.0 in HC mode — no canvas bleed-through.
  // Normal mode: glass tray at α 0.85.
  const bgColor = highContrast ? TRAY_BG_HC_COLOR : TRAY_BG_DEFAULT_COLOR;
  const bgAlpha = highContrast ? TRAY_BG_HC_ALPHA : TRAY_BG_DEFAULT_ALPHA;
  _bg.clear();
  _bg.rect(0, 0, w, h).fill({ color: bgColor, alpha: bgAlpha });

  // Chevron — purely decorative; strip hit area handles interaction
  _handle.clear();
  const cx = w / 2;
  const cy = TRAY_HEIGHT_CLOSED / 2;
  _handle.moveTo(cx - 14, cy + (open ? 5 : -5))
         .lineTo(cx,      cy + (open ? -5 : 5))
         .lineTo(cx + 14, cy + (open ? 5 : -5));
  _handle.stroke({ color: TRAY_HANDLE_COLOR, width: 2 });

  if (_stripHitArea) {
    _stripHitArea.clear();
    _stripHitArea.rect(0, 0, w, TRAY_HEIGHT_CLOSED).fill({ color: 0x000000, alpha: 0 });
  }
}

// ─── Filter strip ─────────────────────────────────────────────────────────────

/**
 * Returns the subset of in-tray piece IDs that match the active filter.
 * Delegates to getVisibleBenchOrder — filter is a view, never a reshuffle.
 */
function visibleInTray(): string[] {
  return getVisibleBenchOrder(usePuzzleStore.getState().activeFilter);
}

// Color swatch constants
const SWATCH_RADIUS        = 10;     // px — inactive filled circle radius
const SWATCH_RADIUS_ACTIVE = 13;     // px — HC active: "pops" toward user
const SWATCH_SPACING       = 32;     // px — centre-to-centre horizontal spacing
const SWATCH_GLOW_R        = 2;      // px — white inner-glow dot radius (HC active)
const SWATCH_HC_ACTIVE_CLR = 0xff00ff; // neon magenta — matches snap-highlight language
const NUM_ZONES      = 5;
const SWATCH_AREA_W  = NUM_ZONES * SWATCH_SPACING + 8; // right-side reserved width

// ─── Zone label constants (Story 37e) ────────────────────────────────────────

const ZONE_LABEL_FONT_SIZE_DEFAULT = 10;
const ZONE_LABEL_FONT_SIZE_ACTIVE  = 13;
const ZONE_LABEL_FILL              = 0xffffff;
const ZONE_LABEL_STROKE            = 0x000000;
const ZONE_LABEL_STROKE_THICK      = 2;
const ZONE_LABEL_NAME              = 'zoneLabel';

/**
 * Add a centred palette index label (P1–P5) to a swatch container.
 * Idempotent — removes any existing label first.
 * Also hides the glowDot on the active swatch to avoid clash with text.
 */
function addZoneLabel(swatchContainer: Container, zoneIndex: number, active: boolean): void {
  removeZoneLabel(swatchContainer);

  const fontSize = active ? ZONE_LABEL_FONT_SIZE_ACTIVE : ZONE_LABEL_FONT_SIZE_DEFAULT;
  const label = new Text({
    text: `P${zoneIndex + 1}`,
    style: {
      fontSize,
      fontWeight: 'bold',
      fill: ZONE_LABEL_FILL,
      stroke: { color: ZONE_LABEL_STROKE, width: ZONE_LABEL_STROKE_THICK },
    },
  });
  label.name = ZONE_LABEL_NAME;
  label.anchor.set(0.5);
  // Swatch containers are positioned at circle center (0,0 local) — label sits at origin.
  label.position.set(0, 0);
  swatchContainer.addChild(label);

  // Always hide the glow dot when a zone label is present — they clash visually
  const glowDot = swatchContainer.getChildByName('glowDot');
  if (glowDot) glowDot.visible = false;
}

/**
 * Remove zone label from a swatch container and restore glow dot visibility.
 */
function removeZoneLabel(swatchContainer: Container): void {
  const existing = swatchContainer.getChildByName(ZONE_LABEL_NAME);
  if (existing) swatchContainer.removeChild(existing);

  // Restore glow dot visibility
  const glowDot = swatchContainer.getChildByName('glowDot');
  if (glowDot) glowDot.visible = true;
}

/**
 * Compute the mean RGB of all pieces (all states) in each palette group.
 * Used as the swatch fill colour — stable regardless of bench state.
 */
function paletteMeanColors(): [number, number, number][] {
  const { pieces } = usePuzzleStore.getState();
  const sums: [number, number, number][] = Array.from({ length: NUM_ZONES }, () => [0, 0, 0]);
  const counts = new Array<number>(NUM_ZONES).fill(0);
  for (const p of pieces) {
    const z = p.paletteIndex;
    if (z >= 0 && z < NUM_ZONES) {
      const [r, g, b] = hexToRgb(p.meanColor);
      sums[z][0] += r;
      sums[z][1] += g;
      sums[z][2] += b;
      counts[z]++;
    }
  }
  return sums.map((s, z) =>
    counts[z] > 0
      ? [Math.round(s[0] / counts[z]), Math.round(s[1] / counts[z]), Math.round(s[2] / counts[z])]
      : [128, 128, 128],
  ) as [number, number, number][];
}

/**
 * Single-pass count of in-bench pieces per filter.
 * Called fresh inside renderFilterStrip on every layout pass — never cached.
 */
function getBenchFilterCounts(): Record<TrayFilter, number> {
  const { piecesById } = usePuzzleStore.getState();
  const counts: Record<string, number> = {
    all: 0, corner: 0, edge: 0, interior: 0,
    'palette-0': 0, 'palette-1': 0, 'palette-2': 0,
    'palette-3': 0, 'palette-4': 0,
  };
  for (const id of _trayDisplayOrder) {
    const p = piecesById[id];
    if (!p || !isInBench(p)) continue;
    counts.all++;
    counts[p.edgeType]++;
    counts[`palette-${p.paletteIndex}`]++;
  }
  return counts as Record<TrayFilter, number>;
}

/**
 * Redraw the filter strip buttons with current counts and active state.
 * Called from layoutTrayPieces so counts stay in sync with tray state.
 * getBenchFilterCounts() called fresh here — not cached from a previous layout.
 */
function renderFilterStrip(): void {
  if (!_filterContainer) return;

  _filterContainer.removeChildren();

  const { activeFilter } = usePuzzleStore.getState();
  const counts = getBenchFilterCounts();
  const w    = screenW();
  const btnH = 26;
  const btnY = (FILTER_STRIP_HEIGHT - btnH) / 2;

  // Text buttons occupy space left of the swatch area
  const textAreaW = w - SWATCH_AREA_W;
  const btnW = Math.floor(textAreaW / FILTER_OPTIONS.length);

  // ── Edge type buttons ────────────────────────────────────────────────────
  // All filters follow the same empty-state rules — no special cases.
  for (let i = 0; i < FILTER_OPTIONS.length; i++) {
    const { key, label } = FILTER_OPTIONS[i];
    const isActive = activeFilter === key;
    const count    = counts[key as TrayFilter];
    const isEmpty  = count === 0;

    const btn = new Container();
    // Empty inactive = non-interactive. Empty active = still interactive (no-op click).
    btn.eventMode = (isEmpty && !isActive) ? 'none' : 'static';
    btn.cursor    = 'pointer';
    // Dim empty buttons: active+empty → 55%, inactive+empty → 35%.
    btn.alpha = isEmpty ? (isActive ? 0.55 : 0.35) : 1.0;

    const bg = new Graphics();
    bg.rect(i * btnW + 2, btnY, btnW - 4, btnH)
      .fill({ color: isActive ? 0x4a90d9 : 0x252545 });
    btn.addChild(bg);

    const txt = new Text({
      text: `${label} (${count})`,
      resolution: window.devicePixelRatio,
      style: {
        fill:       isActive ? 0xffffff : 0xddddf0,
        fontSize:   14,
        fontFamily: 'sans-serif',
        fontWeight: isActive ? 'bold' : 'normal',
      },
    });
    txt.anchor.set(0.5, 0.5);
    txt.x = i * btnW + btnW / 2;
    txt.y = btnY + btnH / 2;
    btn.addChild(txt);

    const capturedKey = key;
    btn.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation();
      applyBenchFilter(capturedKey);
    });

    _filterContainer.addChild(btn);
  }

  // ── Color zone swatches ──────────────────────────────────────────────────
  const meanColors  = paletteMeanColors();
  const swatchCY    = FILTER_STRIP_HEIGHT / 2;
  const { highContrast: hcSwatches, greyscale } = usePuzzleStore.getState();
  // Place swatches starting from right of text area, centred in strip
  const swatchStartX = textAreaW + (SWATCH_AREA_W - NUM_ZONES * SWATCH_SPACING) / 2 + SWATCH_RADIUS;

  // TODO: Story 52 — add palette index labels to preferences palette buttons
  // when greyscale active (AC-3). The filter strip swatches below receive P1–P5
  // labels via addZoneLabel, but a future settings panel (Story 52) must also
  // propagate palette indices to any DOM palette filter buttons it introduces.

  for (let z = 0; z < NUM_ZONES; z++) {
    const filterKey   = `palette-${z}` as TrayFilter;
    const isActive    = activeFilter === filterKey;
    const inTrayCount = counts[filterKey];
    const isEmpty     = inTrayCount === 0;
    const [mr, mg, mb] = meanColors[z];
    // Empty swatches show grey — color only when pieces are present.
    const fillColor = isEmpty ? 0x888888 : (mr << 16) | (mg << 8) | mb;

    const cx = swatchStartX + z * SWATCH_SPACING;

    // Swatch container positioned at circle center — children draw at (0, 0).
    // This allows zone labels to be placed at (0, 0) with anchor (0.5).
    const swatch = new Container();
    // Empty inactive = non-interactive. Empty active = still interactive (no-op click).
    swatch.eventMode = (isEmpty && !isActive) ? 'none' : 'static';
    swatch.cursor    = 'pointer';
    // Dim empty swatches: active+empty → 55%, inactive+empty → 40%.
    swatch.alpha = isEmpty ? (isActive ? 0.55 : 0.4) : 1.0;
    swatch.position.set(cx, swatchCY);

    const g = new Graphics();
    // Active swatches always scale up — pops toward the user regardless of HC.
    // Empty swatches use inactive radius (no pop — no pieces to filter to).
    const drawRadius = (isActive && !isEmpty) ? SWATCH_RADIUS_ACTIVE : SWATCH_RADIUS;

    // ── Non-HC active ring ───────────────────────────────────────────────────
    // White selection ring 3 px outside the fill — normal mode only.
    // Retained at reduced opacity via swatch.alpha when empty+active.
    if (isActive && !hcSwatches) {
      g.circle(0, 0, drawRadius + 3).stroke({ color: 0xffffff, width: 2 });
    }

    // ── HC dual-ring halo ────────────────────────────────────────────────────
    // Rings abut perfectly (touch at drawRadius + 1.5):
    //   Outer (r+2.5, w=2) → pixel-radii (r+1.5)–(r+3.5)
    //   Inner (r+1,   w=1) → pixel-radii (r+0.5)–(r+1.5)
    // Outer ring: Neon Magenta when active+HC, White otherwise.
    // Retained at reduced opacity via swatch.alpha when empty+active.
    if (hcSwatches) {
      const outerColor = isActive ? SWATCH_HC_ACTIVE_CLR : 0xffffff;
      g.circle(0, 0, drawRadius + 2.5).stroke({ color: outerColor, width: 2 });
      g.circle(0, 0, drawRadius + 1  ).stroke({ color: 0x000000,   width: 1 });
    }

    // ── Filled swatch circle ─────────────────────────────────────────────────
    g.circle(0, 0, drawRadius).fill({ color: fillColor });

    swatch.addChild(g);

    // ── Diagonal slash — shown when empty ────────────────────────────────────
    // Slightly darker than grey fill, 1.4px — readable but not aggressive.
    // Signal: "temporarily empty container". Not a checkmark, not strikethrough.
    if (isEmpty) {
      const slash = new Graphics();
      const r = SWATCH_RADIUS;
      slash
        .moveTo(r * 0.85, -r * 0.85)
        .lineTo(-r * 0.85, r * 0.85)
        .stroke({ color: 0x333333, width: 1.8, alpha: 1.0 });
      swatch.addChild(slash);
    }

    // ── Active inner glow dot — separate named child for visibility toggle ───
    // White dot at centre — always created, hidden when empty or when zone label present.
    const glowDot = new Graphics();
    glowDot.name = 'glowDot';
    glowDot.circle(0, 0, SWATCH_GLOW_R).fill({ color: 0xffffff });
    glowDot.visible = isActive && !isEmpty;
    swatch.addChild(glowDot);

    // ── Zone label — shown when greyscale active ─────────────────────────────
    if (greyscale) {
      addZoneLabel(swatch, z, isActive);
    }

    // Track swatch containers so greyscale toggle can add/remove labels
    _swatchContainers[z] = swatch;

    const capturedZ = z;
    swatch.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation();
      applyBenchFilter(`palette-${capturedZ}` as TrayFilter);
    });

    _filterContainer.addChild(swatch);
  }
}

// ─── Grid layout ──────────────────────────────────────────────────────────────

/**
 * Calculate scale to fit an expanded sprite frame (piece + tab padding)
 * uniformly within THUMBNAIL_SIZE.
 */
function thumbScale(): number {
  const tabPad   = Math.ceil(Math.max(_piecePixelW, _piecePixelH) * 0.4);
  const expandedW = _piecePixelW + 2 * tabPad;
  const expandedH = _piecePixelH + 2 * tabPad;
  return Math.min(THUMBNAIL_SIZE / expandedW, THUMBNAIL_SIZE / expandedH);
}

/**
 * Lay out in-tray pieces in a responsive grid.
 *
 * Layout is column-first: pieces fill top-to-bottom within each column, then
 * expand right. This naturally produces a horizontally-scrollable band.
 *
 * The number of rows that fit is derived from the fixed tray height. The total
 * grid width (all columns × THUMBNAIL_SIZE + PADDING) is computed and stored in
 * _totalGridWidth for scroll clamping.
 *
 * Reflow happens within the same call — no deferred updates.
 */
function layoutTrayPieces(): void {
  if (!_spriteMap || !_containerMap || !_gridContainer || !_piecesContainer) return;
  const { piecesById } = usePuzzleStore.getState();

  // All in-tray pieces (for empty state + hide pass)
  const allInTray = _trayDisplayOrder.filter((id) => isInBench(piecesById[id]!));
  // Filtered subset — only these are shown in the grid
  const inTray    = visibleInTray();

  // Hide all in-tray containers; the loop below will re-show visible ones
  for (const id of allInTray) {
    const container = _containerMap.get(id);
    if (container) container.visible = false;
  }

  // Rows that fit in the available height (below the filter strip)
  const availH = TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED - FILTER_STRIP_HEIGHT - PADDING;
  const rows   = Math.max(1, Math.floor(availH / (THUMBNAIL_SIZE + PADDING)));
  const scale  = thumbScale();

  const tabPad    = Math.ceil(Math.max(_piecePixelW, _piecePixelH) * 0.4);
  const expandedW = _piecePixelW + 2 * tabPad;
  const expandedH = _piecePixelH + 2 * tabPad;
  const scaledW   = expandedW * scale;
  const scaledH   = expandedH * scale;

  inTray.forEach((id, i) => {
    const sprite    = _spriteMap!.get(id);
    const container = _containerMap!.get(id);
    if (!sprite || !container) return;

    const col   = Math.floor(i / rows);
    const row   = i % rows;
    const cellX = PADDING + col * (THUMBNAIL_SIZE + PADDING);
    const cellY = PADDING + row * (THUMBNAIL_SIZE + PADDING);

    // Uniform scale — maintain aspect ratio
    sprite.scale.set(scale);

    // Counter-scale label so it renders at native font size in the tray
    const trayLabel = sprite.getChildByLabel(LABEL_CONTAINER_NAME) as Container | null;
    if (trayLabel) trayLabel.scale.set(1 / scale);

    // Center within THUMBNAIL_SIZE cell
    sprite.x = cellX + (THUMBNAIL_SIZE - scaledW) / 2 + scaledW / 2;
    sprite.y = cellY + (THUMBNAIL_SIZE - scaledH) / 2 + scaledH / 2;

    container.x = 0;
    container.y = 0;
    container.visible = true;

    // Update the glow behind the sprite for this slot
    if (_glowEnabled) {
      const glow = container.getChildByLabel(BENCH_GLOW_TAG) as Graphics | null;
      if (glow) {
        glow.clear();
        glow.rect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE).fill(getGlowGradient());
        glow.position.set(cellX, cellY);
      }
    }
  });

  // Total grid dimensions
  const totalCols = inTray.length > 0 ? Math.ceil(inTray.length / rows) : 0;
  _totalGridWidth = totalCols > 0 ? PADDING + totalCols * (THUMBNAIL_SIZE + PADDING) : 0;

  // Clamp scroll and apply
  _scrollX = clampScroll(_scrollX);

  // Sync bench button tabIndex: mode + filter are both arbiters.
  // bench mode + filtered-in → 0 (Tab stays within the visible set).
  // bench mode + filtered-out → -1 (invisible pieces are not reachable via Tab).
  // table mode → -1 for all bench pieces regardless of filter.
  // Runs on every layout (filter change, extraction, load).
  const inBenchMode = getAriaKeyboardMode() === 'bench';
  const inTraySet = new Set(inTray); // inTray is the filtered-in subset
  for (const id of allInTray) {
    setButtonTabIndex(id, inBenchMode && inTraySet.has(id) ? 0 : -1);
  }

  // Sync DOM button order to match visual bench layout (left→right = _trayDisplayOrder order).
  // inTray is already in _trayDisplayOrder order filtered to the active filter set.
  syncButtonDOMOrder(inTray);
  _gridContainer.x = -_scrollX;

  // Update filter radio button labels with current piece counts.
  updateFilterButtonLabels(getFilterDefs());

  // Refresh clip mask — covers the full _piecesContainer area
  const w = screenW();
  if (_piecesMask) {
    _piecesMask.clear();
    _piecesMask.rect(0, 0, w, TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED).fill({ color: 0xffffff });
  }

  // Redraw filter strip with current counts
  renderFilterStrip();

  // Empty state — shown only when all pieces have left the tray
  updateEmptyState(allInTray.length === 0);

  // Belt-and-suspenders: enforce mode-based tabIndex on all bench buttons.
  // Guards against any code path that may have set an incorrect tabIndex
  // between layout passes (e.g. a button created just before mode switched).
  applyBenchTabState();
}

// ─── Tray open / close ────────────────────────────────────────────────────────

export function setTrayOpen(open: boolean): void {
  if (open && _benchCollapsed) return; // permanently collapsed — ignore open requests
  if (!_app || !_viewport) return;
  usePuzzleStore.getState().setTrayOpen(open);
  targetTrayHeight = open ? TRAY_HEIGHT_OPEN : TRAY_HEIGHT_CLOSED;

  // Reduced motion: snap immediately instead of lerping
  if (usePuzzleStore.getState().reducedMotion) {
    currentTrayHeight = targetTrayHeight;
    applyTrayLayout();
  }

  // Sync strip handle pointer-events only.
  // tabIndex stays -1 unconditionally — T is the keyboard mechanism for opening the bench;
  // the strip handle is mouse-only and never enters the tab order.
  if (_benchStripHandle) {
    _benchStripHandle.style.pointerEvents = open ? 'none' : 'auto';
  }

  // Focus handoff: if a bench button was focused when the bench closes,
  // move focus to the strip handle so the user can reopen with Enter/Space.
  if (!open) {
    const focusedInBench = document.activeElement?.closest(`#${LANDMARK_BENCH_ID}`);
    if (focusedInBench && _benchStripHandle) {
      _benchStripHandle.focus();
    }
  }
}

function applyTrayLayout(): void {
  if (!_app || !_viewport || !_trayContainer) return;
  const w = screenW();
  _trayContainer.y = _app.screen.height - currentTrayHeight;
  _viewport.resize(w, _app.screen.height - currentTrayHeight);
  redrawBackground();

  // Keep DOM checkboxes aligned to tray strip (strip sits at top of tray container)
  const bottomOffset = `${currentTrayHeight - TRAY_HEIGHT_CLOSED}px`;
  if (_zoomLabel) _zoomLabel.style.bottom = bottomOffset;
  for (const lbl of _prefLabels) lbl.style.bottom = bottomOffset;
  if (_bgPresetLabel) _bgPresetLabel.style.bottom = bottomOffset;
}

// ─── Easing ───────────────────────────────────────────────────────────────────

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

// ─── Spiral placement ─────────────────────────────────────────────────────────

function resetSpiralOnPan(): void {
  spiralOriginLocked = false;
  spiralIndex = 0;
}

// Keyboard Enter always triggers spiral extraction — never zoom-to-place.
// zoomToPlacePiece() is a pointer-only preview action.
// See docs/spike-keyboard-focus.md §9.9
function spiralPlace(pieceId: string, sprite: Sprite, container: Container): void {
  if (!_viewport || !_trayContainer) return;

  const piece = usePuzzleStore.getState().piecesById[pieceId];
  if (!piece) return;

  if (!spiralOriginLocked) {
    spiralOriginX = _viewport.center.x;
    spiralOriginY = _viewport.center.y;
    spiralOriginLocked = true;
    spiralIndex = 0;
  }

  const N = usePuzzleStore.getState().pieces.length;
  const maxDim  = Math.max(_piecePixelW, _piecePixelH);
  const stepSize = maxDim * _canvasScale * Math.SQRT2 * 1.3;
  const b = stepSize / (2 * Math.PI);

  const { groupsById, piecesById } = usePuzzleStore.getState();
  const hw = piece.textureRegion.w * _canvasScale / 2;
  const hh = piece.textureRegion.h * _canvasScale / 2;

  let worldX = spiralOriginX;
  let worldY = spiralOriginY;
  let found  = false;

  for (let attempt = 0; attempt < N * 4 + 20; attempt++) {
    const theta = spiralIndex * 1.5;
    const r     = b * theta;
    const cx    = spiralOriginX + r * Math.cos(theta);
    const cy    = spiralOriginY + r * Math.sin(theta);

    let occupied = false;
    for (const group of Object.values(groupsById)) {
      for (const pid of group.pieceIds) {
        const p = piecesById[pid];
        if (!p || !isOnTable(p)) continue;
        const px = group.position.x + p.pos!.x;
        const py = group.position.y + p.pos!.y;
        if (Math.abs(cx - px) < hw + p.textureRegion.w * _canvasScale / 2 &&
            Math.abs(cy - py) < hh + p.textureRegion.h * _canvasScale / 2) {
          occupied = true;
          break;
        }
      }
      if (occupied) break;
    }

    spiralIndex++;
    if (!occupied) {
      worldX = cx;
      worldY = cy;
      found  = true;
      break;
    }
  }

  if (!found) {
    worldX = spiralOriginX + spiralIndex * 10;
    worldY = spiralOriginY + spiralIndex * 10;
    spiralIndex++;
  }

  const groupId = `group-${pieceId}`;

  // Strip bench-only chrome before reparent so it never renders on the canvas even for one frame.
  prepareContainerForCanvas(container);

  (_gridContainer ?? _piecesContainer ?? _trayContainer!).removeChild(container);
  _viewport.addChild(container);
  container.x = 0;
  container.y = 0;

  // Restore original filters now that the piece is on the canvas
  sprite.filters = _originalFilters.get(pieceId) ?? [];
  // Greyscale may have been toggled after _originalFilters was saved — reapply if active
  if (usePuzzleStore.getState().greyscale) addGreyscaleFilter(sprite);

  sprite.position.set(worldX, worldY);
  sprite.scale.set(_canvasScale);
  sprite.eventMode = 'none';

  usePuzzleStore.getState().extractPieceToCanvas(pieceId, groupId, { x: worldX, y: worldY });
  insertGroupAABB(groupId, worldX - hw, worldY - hh, piece.textureRegion.w, piece.textureRegion.h);

  // Kill counter-rotation so label follows sprite's world rotation on canvas
  if (usePuzzleStore.getState().pieceLabels) {
    const label = sprite.getChildByLabel(LABEL_CONTAINER_NAME) as Container | null;
    if (label) { label.rotation = -sprite.rotation; label.scale.set(1); }
  }

  extractPieceFromBench(pieceId);
}

// ─── Pointer hit test ─────────────────────────────────────────────────────────

/**
 * Convert screen coords to grid-container local coords and find the piece at
 * that position. Hit bounds are THUMBNAIL_SIZE × THUMBNAIL_SIZE per cell.
 */
function hitTestTrayPiece(screenX: number, screenY: number): string | null {
  if (!_spriteMap || !_trayContainer || !_piecesContainer) return null;

  // Use the same filtered set that layoutTrayPieces positioned
  const inTray = visibleInTray();

  // Screen → gridContainer local:
  //   subtract tray.y, piecesContainer.y, then gridContainer.y (= FILTER_STRIP_HEIGHT)
  const gridLocalX = screenX + _scrollX;
  const gridLocalY =
    screenY -
    _trayContainer.y -
    (_piecesContainer?.y ?? TRAY_HEIGHT_CLOSED) -
    FILTER_STRIP_HEIGHT;
  const half = THUMBNAIL_SIZE / 2;

  for (let i = inTray.length - 1; i >= 0; i--) {
    const sprite = _spriteMap.get(inTray[i]);
    if (!sprite) continue;
    if (Math.abs(gridLocalX - sprite.x) <= half &&
        Math.abs(gridLocalY - sprite.y) <= half) {
      return inTray[i];
    }
  }
  return null;
}

// ─── Extraction from tray (drag) ─────────────────────────────────────────────

/**
 * Reparent the piece sprite from the tray into the viewport at world-space
 * coordinates, then hand the active pointer off to drag.ts.
 *
 * @param pointerWorldX  viewport world-space X of the pointer at the moment of
 *                       extraction (used for drag offset, NOT the sprite centre)
 * @param pointerWorldY  viewport world-space Y of the pointer
 */
function extractToCanvas(
  pieceId: string,
  pointerId: number,
  pointerWorldX: number,
  pointerWorldY: number,
): void {
  if (!_viewport || !_trayContainer || !_spriteMap || !_containerMap) return;

  const piece = usePuzzleStore.getState().piecesById[pieceId];
  if (!piece) return;

  const sprite    = _spriteMap.get(pieceId);
  const container = _containerMap.get(pieceId);
  if (!sprite || !container) return;

  // Strip bench-only chrome before reparent so it never renders on the canvas even for one frame.
  prepareContainerForCanvas(container);

  // Reparent from grid container into viewport
  (_gridContainer ?? _piecesContainer ?? _trayContainer!).removeChild(container);
  _viewport.addChild(container);
  container.x = 0;
  container.y = 0;

  // Restore original filters now that the piece is on the canvas
  sprite.filters = _originalFilters.get(pieceId) ?? [];
  // Greyscale may have been toggled after _originalFilters was saved — reapply if active
  if (usePuzzleStore.getState().greyscale) addGreyscaleFilter(sprite);

  // Place sprite so the cursor sits at the same relative position on the piece
  // as when the user pressed down (trayPointerDownSpriteDX/Y are the screen-space
  // offset from pointer to sprite center at press time).
  const vs      = _viewport.scale.x; // uniform zoom factor
  const worldX  = pointerWorldX - trayPointerDownSpriteDX / vs;
  const worldY  = pointerWorldY - trayPointerDownSpriteDY / vs;
  sprite.position.set(worldX, worldY);
  sprite.scale.set(_canvasScale);
  sprite.eventMode = 'none';

  const groupId = `group-${pieceId}`;
  usePuzzleStore.getState().extractPieceToCanvas(pieceId, groupId, { x: worldX, y: worldY });

  const hw = piece.textureRegion.w / 2;
  const hh = piece.textureRegion.h / 2;
  insertGroupAABB(groupId, worldX - hw, worldY - hh, piece.textureRegion.w, piece.textureRegion.h);

  // Kill counter-rotation so label follows sprite's world rotation on canvas
  if (usePuzzleStore.getState().pieceLabels) {
    const label = sprite.getChildByLabel(LABEL_CONTAINER_NAME) as Container | null;
    if (label) { label.rotation = -sprite.rotation; label.scale.set(1); }
  }

  // Hand off to drag.ts using POINTER world position (not sprite centre)
  startDragForPiece(pieceId, pointerId, pointerWorldX, pointerWorldY);

  extractPieceFromBench(pieceId);
}

// ─── Zoom-to-place (Story 36) ─────────────────────────────────────────────────

const LANDING_OFFSET = 35; // px world-space — within board snap radius (60px)

/** Cancel an in-flight zoom animation and return the sprite to the tray. */
function cancelZoomAnimation(): void {
  if (!_zoomInFlight) return;

  // Cancel viewport animate plugin
  _viewport?.plugins.remove('animate');

  // Cancel sprite tween
  if (_zoomTickerFn && _app) {
    _app.ticker.remove(_zoomTickerFn);
    _zoomTickerFn = null;
  }

  // Return in-flight sprite to tray grid container
  const pieceId = _zoomFlightPieceId;
  if (pieceId && _app && _spriteMap && _containerMap && _gridContainer) {
    const sprite    = _spriteMap.get(pieceId);
    const container = _containerMap.get(pieceId);
    if (sprite && container) {
      _app.stage.removeChild(container);
      _gridContainer.addChild(container);
      // Clear restored filters — tray thumbnails have no filters
      sprite.filters = [];
    }
  }

  _zoomInFlight      = false;
  _zoomFlightPieceId = null;

  layoutTrayPieces(); // reposition piece in grid
}

/** Finish zoom animation: reparent sprite to viewport and set on-canvas state. */
function completeZoomAnimation(
  pieceId: string,
  sprite: Sprite,
  container: Container,
  landX: number,
  landY: number,
): void {
  if (!_app || !_viewport) return;

  // Stop sprite tween
  if (_zoomTickerFn) {
    _app.ticker.remove(_zoomTickerFn);
    _zoomTickerFn = null;
  }

  // Strip bench-only chrome before reparent so it never renders on the canvas even for one frame.
  prepareContainerForCanvas(container);

  // Reparent from app.stage → viewport (world-space)
  _app.stage.removeChild(container);
  _viewport.addChild(container);
  container.x = 0;
  container.y = 0;

  // Land at randomised offset from canonical — preserves snap payoff moment
  sprite.position.set(landX, landY);
  sprite.scale.set(_canvasScale);
  sprite.eventMode = 'none';

  // Register in store + spatial hash
  const groupId = `group-${pieceId}`;
  usePuzzleStore.getState().extractPieceToCanvas(pieceId, groupId, { x: landX, y: landY });

  const piece = usePuzzleStore.getState().piecesById[pieceId];
  const hw    = piece ? piece.textureRegion.w / 2 : 0;
  const hh    = piece ? piece.textureRegion.h / 2 : 0;
  insertGroupAABB(groupId, landX - hw, landY - hh, piece?.textureRegion.w ?? 0, piece?.textureRegion.h ?? 0);

  // Kill counter-rotation so label follows sprite's world rotation on canvas
  if (usePuzzleStore.getState().pieceLabels) {
    const label = sprite.getChildByLabel(LABEL_CONTAINER_NAME) as Container | null;
    if (label) { label.rotation = -sprite.rotation; label.scale.set(1); }
  }

  extractPieceFromBench(pieceId);

  _zoomInFlight      = false;
  _zoomFlightPieceId = null;
}

/**
 * Zoom viewport to canonical position of `pieceId`, animate piece from tray
 * toward viewport center (visual tether), then land at randomised offset.
 *
 * Called from onStagePointerUp when zoomToPlace is enabled and movement < 4px.
 */
function zoomToPlacePiece(pieceId: string): void {
  if (!_app || !_viewport || !_spriteMap || !_containerMap || !_gridContainer) return;

  const piece     = usePuzzleStore.getState().piecesById[pieceId];
  const sprite    = _spriteMap.get(pieceId);
  const container = _containerMap.get(pieceId);
  if (!piece || !sprite || !container) return;

  // Capture tray screen position before reparenting
  const spriteScreen = sprite.getGlobalPosition();
  const startScreenX = spriteScreen.x;
  const startScreenY = spriteScreen.y;

  // Strip bench-only chrome before the container leaves the tray — the animation
  // flies on app.stage where bench chrome must not render.
  prepareContainerForCanvas(container);

  // Reparent from tray grid → app.stage (screen-space, above viewport)
  _gridContainer.removeChild(container);
  _app.stage.addChild(container);
  container.x = 0;
  container.y = 0;

  // Restore filters and switch to canvas scale
  sprite.filters   = _originalFilters.get(pieceId) ?? [];
  // Greyscale may have been toggled after _originalFilters was saved — reapply if active
  if (usePuzzleStore.getState().greyscale) addGreyscaleFilter(sprite);
  sprite.scale.set(_canvasScale);
  sprite.position.set(startScreenX, startScreenY);
  sprite.eventMode = 'none';

  // Zoom level: piece occupies ~30% of viewport height
  const pieceWorldH  = _piecePixelH * _canvasScale;
  const targetScale  = (_app.screen.height * 0.30) / pieceWorldH;
  const clampedScale = Math.min(targetScale, 8.0);

  // Landing offset — randomised angle, within board snap radius (60px)
  const angle = Math.random() * Math.PI * 2;
  const landX = piece.canonical.x + Math.cos(angle) * LANDING_OFFSET;
  const landY = piece.canonical.y + Math.sin(angle) * LANDING_OFFSET;

  _zoomInFlight      = true;
  _zoomFlightPieceId = pieceId;

  // Reduced motion: precision teleport — no animation, perfectly centred in
  // the playable area above the tray.
  if (usePuzzleStore.getState().reducedMotion) {
    // 1. Scale first so the trayOffset conversion uses the final scale.
    _viewport.scale.set(clampedScale);
    // 2. Offset accounts for tray height so the piece lands at the centre of
    //    the playable area, not the raw screen centre (which is half-occluded
    //    by the tray).  trayOffset world-units down = currentTrayHeight/2 px up.
    const trayOffset = currentTrayHeight / 2 / _viewport.scale.y;
    _viewport.moveCenter(piece.canonical.x, piece.canonical.y + trayOffset);
    // 3. Zero any leftover decelerate momentum so the board doesn't drift.
    _viewport.plugins.get('decelerate')?.reset();
    completeZoomAnimation(pieceId, sprite, container, landX, landY);
    return;
  }

  const ANIM_DURATION = 600; // ms
  const endScreenX    = _app.screen.width / 2;
  const endScreenY    = _app.screen.height / 2;
  const startTime     = performance.now();

  // Visual tether: animate sprite from tray position toward screen center.
  // Per-tick reducedMotion check: if toggled mid-flight, snap and complete.
  const tickerFn = () => {
    if (usePuzzleStore.getState().reducedMotion) {
      // Mid-flight toggle: apply same precision teleport as the initial path.
      _viewport?.plugins.remove('animate');
      if (_viewport) {
        _viewport.scale.set(clampedScale);
        const trayOffset = currentTrayHeight / 2 / _viewport.scale.y;
        _viewport.moveCenter(piece.canonical.x, piece.canonical.y + trayOffset);
        _viewport.plugins.get('decelerate')?.reset();
      }
      sprite.position.set(endScreenX, endScreenY);
      completeZoomAnimation(pieceId, sprite, container, landX, landY);
      return;
    }
    const t     = Math.min((performance.now() - startTime) / ANIM_DURATION, 1);
    const eased = easeInOutQuad(t);
    sprite.position.set(
      startScreenX + (endScreenX - startScreenX) * eased,
      startScreenY + (endScreenY - startScreenY) * eased,
    );
  };
  _zoomTickerFn = tickerFn;
  _app.ticker.add(tickerFn);

  // Animate viewport to canonical position at piece-size-derived zoom
  _viewport.animate({
    time:               ANIM_DURATION,
    position:           new Point(piece.canonical.x, piece.canonical.y),
    scale:              clampedScale,
    ease:               'easeInOutQuad',
    callbackOnComplete: () => {
      completeZoomAnimation(pieceId, sprite, container, landX, landY);
    },
  });
}

// ─── App-stage pointer handlers ───────────────────────────────────────────────

function onStagePointerMove(e: FederatedPointerEvent): void {
  // Scroll drag
  if (_scrollDragActive && e.pointerId === _scrollDragPointerId) {
    const dx = _scrollDragStartX - e.global.x;
    _scrollX = clampScroll(_scrollDragStartScrollX + dx);
    if (_gridContainer) _gridContainer.x = -_scrollX;
    return;
  }

  if (trayPointerDownId === null || e.pointerId !== trayPointerDownId) return;
  if (isDraggingCanvas()) return;
  if (trayPointerDidCross) return;
  if (!_viewport || !_app) return;

  // 4px movement threshold — same principle as drag.ts click threshold
  if (!trayPointerMovedFar) {
    const dx = e.global.x - trayPointerDownX;
    const dy = e.global.y - trayPointerDownY;
    if (dx * dx + dy * dy > 16) trayPointerMovedFar = true; // 4² = 16
  }

  const trayTop = _app.screen.height - currentTrayHeight;
  if (e.global.y < trayTop && trayPointerDownPieceId !== null) {
    trayPointerDidCross = true;
    const id  = trayPointerDownPieceId;
    const pid = e.pointerId;
    trayPointerDownId      = null;
    trayPointerDownPieceId = null;
    trayPointerMovedFar    = false;

    const pointerWorld = _viewport.toLocal(e.global);
    extractToCanvas(id, pid, pointerWorld.x, pointerWorld.y);
  }
}

function onStagePointerUp(e: FederatedPointerEvent): void {
  // Scroll drag end
  if (_scrollDragActive && e.pointerId === _scrollDragPointerId) {
    _scrollDragActive    = false;
    _scrollDragPointerId = null;
    return;
  }

  if (trayPointerDownId === null || e.pointerId !== trayPointerDownId) return;
  if (isDraggingCanvas()) return;

  const id        = trayPointerDownPieceId;
  const movedFar  = trayPointerMovedFar;
  trayPointerDownId      = null;
  trayPointerDownPieceId = null;
  trayPointerDidCross    = false;
  trayPointerMovedFar    = false;

  if (id === null) return;

  // If pointer moved >4px but didn't cross tray boundary: drag stayed in tray — ignore
  if (movedFar) return;

  const sprite    = _spriteMap?.get(id);
  const container = _containerMap?.get(id);
  if (!sprite || !container) return;

  // Dispatch: zoom-to-place or spiral extraction
  if (usePuzzleStore.getState().zoomToPlace) {
    // Rapid click: cancel in-flight animation before starting a new one
    if (_zoomInFlight) cancelZoomAnimation();
    zoomToPlacePiece(id);
  } else {
    spiralPlace(id, sprite, container);
  }
}

// ─── Zustand subscription — real-time state sync ──────────────────────────────

/**
 * Watch for pieces transitioning to 'on-canvas' or 'placed'.
 * Removes them from the display order and reflows the grid.
 * This handles cases where state changes originate outside tray.ts
 * (e.g. board snap triggers 'placed' transition).
 */
function subscribeToStore(): void {
  usePuzzleStore.subscribe((state, prevState) => {
    let changed = false;
    for (const piece of state.pieces) {
      const prev = prevState.piecesById[piece.id];
      if (!prev || (prev.stageId === piece.stageId && prev.placed === piece.placed)) continue;
      if (!isInBench(piece)) {
        const before = _trayDisplayOrder.length;
        _trayDisplayOrder = _trayDisplayOrder.filter((id) => id !== piece.id);
        if (_trayDisplayOrder.length !== before) changed = true;
        // Clear persistent focus tracking when a piece leaves the bench via placement.
        if (getFocusedPieceId() === piece.id) clearFocusedPieceId();
      }
    }
    if (changed) layoutTrayPieces();
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initTray(
  app: Application,
  viewport: Viewport,
  spriteMap: Map<string, Sprite>,
  containerMap: Map<string, Container>,
  canvasScale: number,
  piecePixelW: number,
  piecePixelH: number,
): Container {
  _app            = app;
  _viewport       = viewport;
  _spriteMap      = spriteMap;
  _containerMap   = containerMap;
  _canvasScale    = canvasScale;
  _piecePixelW    = piecePixelW;
  _piecePixelH    = piecePixelH;
  _scrollX        = 0;
  _benchCollapsed = false; // reset on each puzzle load — idempotency guard

  const { pieces } = usePuzzleStore.getState();

  // Derive deterministic master display order from session URI.
  // TODO: Story 53 — replace dev sentinel with real sessionUri from JiggGlue.uri
  const sessionUri = ((usePuzzleStore.getState() as unknown) as Record<string, unknown>).sessionUri as string | undefined
    ?? 'dev:session:hardcoded';
  _trayDisplayOrder = deriveBenchOrder(pieces, sessionUri);

  // Set up in-tray sprites: clear filters, set eventMode.
  // Scale is set in layoutTrayPieces() — no need to set here.
  for (const piece of pieces) {
    if (!isInBench(piece)) continue;
    const sprite = spriteMap.get(piece.id);
    if (!sprite) continue;
    // Save existing filters (e.g. BevelFilter applied by scene.ts) and clear them
    // for the tray thumbnail view — restored on extraction to canvas.
    _originalFilters.set(piece.id, (sprite.filters as Filter[] | null) ?? []);
    sprite.filters   = [];
    sprite.eventMode = 'static';
  }

  // Glow setup — reset gradient cache per puzzle load, add glows unconditionally.
  // Glow coexists with HC: it lifts pieces off the dark slot; HC sandwich handles
  // edge-level WCAG contrast. Removing the glow in HC left dark pieces invisible.
  _glowGradient?.destroy();
  _glowGradient  = null;
  _glowEnabled   = false;
  addAllBenchGlows();

  // Apply deterministic rotation to bench sprites.
  // TODO: Story 52 — read rotationEnabled from settings panel (PuzzleState.rotationEnabled)
  const rotationEnabled = false;
  pieces.filter(isInBench).forEach((piece) => {
    const sprite = spriteMap.get(piece.id);
    if (!sprite) return;
    const rot = rotationEnabled
      ? seededPieceRotation(piece.id, sessionUri)
      : 0;
    sprite.rotation    = (rot * Math.PI) / 180;
    piece.initialRotation = rot; // for label counter-rotation (Story 37b)
  });

  // ── Tray container ──────────────────────────────────────────────────────────
  const tray = new Container();
  tray.zIndex    = 500;
  tray.eventMode = 'static';
  tray.y = app.screen.height - TRAY_HEIGHT_OPEN;
  app.stage.addChild(tray);
  _trayContainer = tray;

  // ── Background (drawn below pieces) ────────────────────────────────────────
  _bg        = new Graphics();
  _bg.zIndex = 0;
  _bg.eventMode = 'static'; // receive wheel events
  tray.addChild(_bg);

  // ── Chevron handle (decorative only — strip handles interaction) ────────────
  _handle        = new Graphics();
  _handle.zIndex = 5;
  tray.addChild(_handle);

  // ── Clipped pieces container — sits below the strip ─────────────────────────
  _piecesContainer        = new Container();
  _piecesContainer.y      = TRAY_HEIGHT_CLOSED;
  _piecesContainer.zIndex = 10;
  _piecesContainer.eventMode = 'static';
  tray.addChild(_piecesContainer);

  _piecesMask = new Graphics();
  _piecesMask.rect(0, 0, app.screen.width, TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED).fill({ color: 0xffffff });
  _piecesContainer.addChild(_piecesMask);
  _piecesContainer.mask = _piecesMask;

  // ── Filter strip — sits at top of _piecesContainer, above the grid ─────────
  _filterContainer = new Container();
  _filterContainer.y         = 0;
  _filterContainer.eventMode = 'static';
  _filterContainer.zIndex    = 5;
  _piecesContainer.addChild(_filterContainer);

  // ── Scrollable grid container — offset below the filter strip ───────────────
  _gridContainer   = new Container();
  _gridContainer.y = FILTER_STRIP_HEIGHT;
  _piecesContainer.addChild(_gridContainer);

  // Move in-tray piece containers into _gridContainer (in display order)
  for (const id of _trayDisplayOrder) {
    const container = containerMap.get(id);
    if (container) _gridContainer.addChild(container);
  }

  // ── Strip hit area — toggles open/close ─────────────────────────────────────
  _stripHitArea           = new Graphics();
  _stripHitArea.rect(0, 0, app.screen.width, TRAY_HEIGHT_CLOSED).fill({ color: 0x000000, alpha: 0 });
  _stripHitArea.eventMode = 'static';
  _stripHitArea.zIndex    = 20;
  tray.addChild(_stripHitArea);

  _stripHitArea.on('pointerdown', (e: FederatedPointerEvent) => {
    e.stopPropagation();
    setTrayOpen(!usePuzzleStore.getState().trayOpen);
  });


  // ── Wheel scroll — horizontal scroll, no viewport propagation ───────────────
  tray.on('wheel', (e: FederatedWheelEvent) => {
    if (!usePuzzleStore.getState().trayOpen) return;
    e.stopPropagation();
    // Use horizontal delta if present, otherwise vertical
    const delta = Math.abs(e.deltaX) > 0 ? e.deltaX : e.deltaY;
    _scrollX = clampScroll(_scrollX + delta);
    if (_gridContainer) _gridContainer.x = -_scrollX;
  });

  // ── Piece pointerdown + scroll drag ────────────────────────────────────────
  tray.on('pointerdown', (e: FederatedPointerEvent) => {
    if (isDraggingCanvas()) return;
    if (!usePuzzleStore.getState().trayOpen) return;

    const localY = e.global.y - tray.y;
    if (localY < TRAY_HEIGHT_CLOSED) return; // strip toggles — handled above

    const pieceId = hitTestTrayPiece(e.global.x, e.global.y);
    if (pieceId && trayPointerDownId === null) {
      // Piece drag — track this pointer
      trayPointerDownId      = e.pointerId;
      trayPointerDownPieceId = pieceId;
      trayPointerDownX       = e.global.x;
      trayPointerDownY       = e.global.y;
      trayPointerMovedFar    = false;
      trayPointerDidCross    = false;
      // Record offset from pointer to sprite center in screen-space so drag
      // extraction can position the piece under the original grab point.
      const grabSprite = _spriteMap?.get(pieceId);
      if (grabSprite) {
        const sc = grabSprite.getGlobalPosition();
        trayPointerDownSpriteDX = e.global.x - sc.x;
        trayPointerDownSpriteDY = e.global.y - sc.y;
      } else {
        trayPointerDownSpriteDX = 0;
        trayPointerDownSpriteDY = 0;
      }
      e.stopPropagation();
    } else if (!pieceId && !_scrollDragActive) {
      // Background drag — scroll the tray
      _scrollDragActive        = true;
      _scrollDragPointerId     = e.pointerId;
      _scrollDragStartX        = e.global.x;
      _scrollDragStartScrollX  = _scrollX;
      e.stopPropagation();
    }
  });

  // ── App-stage move / up ─────────────────────────────────────────────────────
  app.stage.on('pointermove',      onStagePointerMove);
  app.stage.on('pointerup',        (e) => onStagePointerUp(e));
  app.stage.on('pointercancel',    (e) => onStagePointerUp(e));
  app.stage.on('pointerupoutside', (e) => onStagePointerUp(e));

  // ── Animation ticker (lerp / snap) ─────────────────────────────────────────
  app.ticker.add(() => {
    // Smooth scroll animation for scrollBenchToId — runs regardless of reducedMotion
    // (reducedMotion path calls animateScrollTo never; the _scrollTarget guard is
    // sufficient — no mid-animation reducedMotion toggle handling needed here).
    if (_scrollTarget !== null) {
      const diff = _scrollTarget - _scrollX;
      if (Math.abs(diff) < 0.5) {
        _scrollX = _scrollTarget;
        _scrollTarget = null;
      } else {
        _scrollX += diff * 0.15;
      }
      if (_gridContainer) _gridContainer.x = -_scrollX;
    }

    // Reduced motion: skip height lerp — snap to target on any frame where they differ.
    if (usePuzzleStore.getState().reducedMotion) {
      if (currentTrayHeight !== targetTrayHeight) {
        currentTrayHeight = targetTrayHeight;
        applyTrayLayout();
      }
      return;
    }
    if (Math.abs(currentTrayHeight - targetTrayHeight) < 0.5) {
      if (currentTrayHeight !== targetTrayHeight) {
        currentTrayHeight = targetTrayHeight;
        applyTrayLayout();
      }
      return;
    }
    currentTrayHeight += (targetTrayHeight - currentTrayHeight) * 0.2;
    applyTrayLayout();
  });

  // Reset spiral origin when viewport pans
  viewport.on('moved', resetSpiralOnPan);

  // Subscribe for real-time piece state sync
  subscribeToStore();

  // ── Zoom-to-place dev toggle (DOM element) ──────────────────────────────────
  // TODO: remove this checkbox when Story 52 ships — expose via settings panel instead
  if (_zoomLabel) _zoomLabel.remove();
  const zoomLabel = document.createElement('label');
  zoomLabel.style.cssText = [
    'position:fixed',
    'right:12px',
    `height:${TRAY_HEIGHT_CLOSED}px`,
    'display:flex',
    'align-items:center',
    'gap:4px',
    'font-size:11px',
    'font-family:sans-serif',
    'color:#aaaacc',
    'z-index:501',
    'pointer-events:auto',
    'user-select:none',
    'cursor:pointer',
  ].join(';');
  const zoomCheckbox = document.createElement('input');
  zoomCheckbox.type     = 'checkbox';
  zoomCheckbox.checked  = usePuzzleStore.getState().zoomToPlace;
  zoomCheckbox.style.margin = '0';
  zoomCheckbox.tabIndex = -1; // dev scaffold — excluded from keyboard tab flow (Story 52)
  zoomCheckbox.addEventListener('change', () => {
    usePuzzleStore.getState().setZoomToPlace(zoomCheckbox.checked);
  });
  zoomLabel.appendChild(zoomCheckbox);
  zoomLabel.appendChild(document.createTextNode('\u00a0Focus Mode'));
  document.body.appendChild(zoomLabel);
  _zoomLabel = zoomLabel;
  // Set initial bottom position
  zoomLabel.style.bottom = `${TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED}px`;

  // ── Accessibility preference checkboxes ─────────────────────────────────────
  // TODO: move these to settings panel in Story 52
  for (const lbl of _prefLabels) lbl.remove();
  _prefLabels = [];

  const prefDefs: Array<{
    key: 'highContrast' | 'greyscale' | 'pieceLabels' | 'reducedMotion';
    label: string;
  }> = [
    { key: 'highContrast',  label: 'High Contrast' },
    { key: 'greyscale',     label: 'Greyscale' },
    { key: 'pieceLabels',   label: 'Piece Labels' },
    { key: 'reducedMotion', label: 'Reduced Motion' },
  ];

  const PREF_LABEL_W = 110; // px per checkbox slot
  prefDefs.forEach(({ key, label: labelText }, i) => {
    const el = document.createElement('label');
    el.style.cssText = [
      'position:fixed',
      `right:${130 + (prefDefs.length - 1 - i) * PREF_LABEL_W}px`,
      `height:${TRAY_HEIGHT_CLOSED}px`,
      'display:flex',
      'align-items:center',
      'gap:4px',
      'font-size:11px',
      'font-family:sans-serif',
      'color:#aaaacc',
      'z-index:501',
      'pointer-events:auto',
      'user-select:none',
      'cursor:pointer',
    ].join(';');
    const cb = document.createElement('input');
    cb.type     = 'checkbox';
    cb.checked  = usePuzzleStore.getState()[key] as boolean;
    cb.style.margin = '0';
    cb.tabIndex = -1; // dev scaffold — excluded from keyboard tab flow (Story 52)
    cb.addEventListener('change', () => {
      usePuzzleStore.getState().setPreference(key, cb.checked);
    });
    // Keep checkbox in sync with store — prefs load after initTray, so initial
    // value above may be stale; subscriber updates it once the store is hydrated.
    usePuzzleStore.subscribe((state) => { cb.checked = state[key] as boolean; });
    el.appendChild(cb);
    el.appendChild(document.createTextNode(`\u00a0${labelText}`));
    document.body.appendChild(el);
    el.style.bottom = `${TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED}px`;
    _prefLabels.push(el);
  });

  // ── Background preset UI ─────────────────────────────────────────────────────
  // TODO: move to settings panel in Story 52
  if (_bgPresetLabel) _bgPresetLabel.remove();
  const bgEl = document.createElement('div');
  bgEl.style.cssText = [
    'position:fixed',
    'left:12px',
    `height:${TRAY_HEIGHT_CLOSED}px`,
    'display:flex',
    'align-items:center',
    'gap:6px',
    'font-size:11px',
    'font-family:sans-serif',
    'color:#aaaacc',
    'z-index:501',
    'user-select:none',
  ].join(';');
  bgEl.style.bottom = `${TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED}px`;

  const bgLabelText = document.createElement('span');
  bgLabelText.textContent = 'BG:';
  bgEl.appendChild(bgLabelText);

  BG_PRESETS_ORDER.forEach((preset) => {
    const btn = document.createElement('button');
    btn.dataset.preset = preset;
    btn.textContent = preset.charAt(0).toUpperCase() + preset.slice(1).replace('-', '-');
    btn.style.cssText = [
      'font-size:10px',
      'font-family:sans-serif',
      'padding:1px 5px',
      'border-radius:3px',
      'cursor:pointer',
      'border:1px solid #555577',
      'background:#252545',
      'color:#ddddf0',
    ].join(';');
    btn.tabIndex = -1; // dev scaffold — excluded from keyboard tab flow (Story 52)
    btn.addEventListener('click', () => {
      usePuzzleStore.getState().setPreference('backgroundPreset', preset);
    });
    bgEl.appendChild(btn);
  });

  document.body.appendChild(bgEl);
  _bgPresetLabel = bgEl;

  redrawBackground();
  layoutTrayPieces();

  // Hide pieces immediately — cuts aren't applied yet; setTrayLoading(false) in CUTS_COMPLETE
  _gridContainer!.visible   = false;
  _filterContainer!.visible = false;

  // ── Bench strip handle (keyboard accessibility) ────────────────────────────
  // A visually-transparent DOM button that sits over the closed-bench strip.
  // Focusable — receives focus when bench closes while a bench button was active.
  // pointer-events disabled when bench is open so PixiJS _stripHitArea gets clicks.
  if (_benchStripHandle) _benchStripHandle.remove();
  const stripHandle = document.createElement('button');
  stripHandle.id = 'bench-strip-handle';
  stripHandle.setAttribute('aria-label', 'Open piece tray');
  stripHandle.tabIndex = -1; // bench starts open — not reachable via Tab until closed
  stripHandle.style.cssText = [
    'position:fixed',
    'bottom:0',
    'left:0',
    'width:100%',
    `height:${TRAY_HEIGHT_CLOSED}px`,
    'opacity:0',
    'cursor:pointer',
    `z-index:600`,
    'pointer-events:none', // bench starts open — disable until closed
  ].join(';');
  stripHandle.addEventListener('click', () => setTrayOpen(true));
  stripHandle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setTrayOpen(true);
    }
  });
  document.body.appendChild(stripHandle);
  _benchStripHandle = stripHandle;

  // Initial viewport resize to account for open tray
  viewport.resize(screenW(), app.screen.height - TRAY_HEIGHT_OPEN);

  // AC-2: Subscribe directly to highContrast changes so the tray redraws
  // immediately on toggle — not deferred via the applyFn callback chain.
  // Unsubscribe any previous subscription first — prevents duplicates if
  // initTray is called more than once (idempotent).
  _unsubscribeHC?.();
  _unsubscribeHC = usePuzzleStore.subscribe((state, prev) => {
    if (state.highContrast !== prev.highContrast) redrawBackground();
  });

  // Story 37e: Subscribe to greyscale changes — rebuild filter strip so zone
  // labels appear/disappear on toggle without waiting for the next layout call.
  _unsubscribeGreyscale?.();
  _unsubscribeGreyscale = usePuzzleStore.subscribe((state, prev) => {
    if (state.greyscale !== prev.greyscale) layoutTrayPieces();
  });

  // Wire bench navigation helpers into aria.ts for keyboard focus continuation.
  // bench.ts already imports aria.ts — no circular dep.
  // scrollBenchToId is defined in this file; getVisibleBenchOrder is exported above.
  registerBenchNavHelpers(
    () => getVisibleBenchOrder(usePuzzleStore.getState().activeFilter),
    scrollBenchToId,
  );

  return tray;
}

/** Highlight the active background preset button, dim the rest. */
function syncBgPresetUI(): void {
  if (!_bgPresetLabel) return;
  const active = usePuzzleStore.getState().backgroundPreset;
  _bgPresetLabel.querySelectorAll<HTMLButtonElement>('button[data-preset]').forEach((btn) => {
    const isActive = btn.dataset.preset === active;
    btn.style.background   = isActive ? '#4a90d9' : '#252545';
    btn.style.color        = isActive ? '#ffffff' : '#ddddf0';
    btn.style.borderColor  = isActive ? '#4a90d9' : '#555577';
  });
}

/**
 * Show/hide the tray loading spinner. Call with `true` immediately after initTray,
 * then `false` in CUTS_COMPLETE once masks are applied and pieces are ready to show.
 */
export function setTrayLoading(loading: boolean): void {
  if (!_gridContainer || !_filterContainer || !_piecesContainer || !_app) return;

  if (loading) {
    _gridContainer.visible   = false;
    _filterContainer.visible = false;

    if (!_loadingSpinner) {
      _loadingSpinner = new Container();
      _piecesContainer.addChild(_loadingSpinner);
    }
    _loadingSpinner.visible = true;

    let angle = 0;
    _loadingTickerFn = () => {
      if (!_loadingSpinner || !_piecesContainer) return;
      const w  = screenW();
      const availH = TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED - FILTER_STRIP_HEIGHT;
      _loadingSpinner.x = w / 2;
      _loadingSpinner.y = FILTER_STRIP_HEIGHT + availH / 2;
      angle += 0.06;

      const g = _loadingSpinner.children[0] as Graphics | undefined;
      const arc = g ?? new Graphics();
      if (!g) _loadingSpinner.addChild(arc);
      arc.clear();
      arc.arc(0, 0, 14, angle, angle + Math.PI * 1.4)
         .stroke({ color: 0x4a90d9, width: 3 });
    };
    _app.ticker.add(_loadingTickerFn);

  } else {
    if (_loadingTickerFn) {
      _app.ticker.remove(_loadingTickerFn);
      _loadingTickerFn = null;
    }
    if (_loadingSpinner) {
      _loadingSpinner.visible = false;
    }
    _gridContainer.visible   = true;
    _filterContainer.visible = true;
    layoutTrayPieces();
  }
}

/** Redraw tray visuals after a preference change. Called from scene.ts apply callback. */
export function applyTrayPreferences(): void {
  redrawBackground();
  renderFilterStrip();
  syncBgPresetUI();
}

/**
 * Clean up the HC store subscription. Call if the tray is ever torn down
 * (e.g. new puzzle load that reinitialises the tray). Idempotent.
 */
export function teardownTray(): void {
  _unsubscribeHC?.();
  _unsubscribeHC = null;
  _unsubscribeGreyscale?.();
  _unsubscribeGreyscale = null;
}

/**
 * Return a copy of the current bench display order (the shuffled visual layout).
 * Used by scene.ts to pass ordered IDs to syncButtonDOMOrder after initBenchButtons,
 * ensuring initial DOM button order matches visual layout order.
 */
export function getTrayDisplayOrder(): string[] {
  return [..._trayDisplayOrder];
}

/**
 * Compute filter definitions with live counts of matching in-bench pieces.
 * Always returns all 9 entries (4 text + 5 palette) — empty filters included.
 * Includes count and isActive so aria.ts can derive disabled state and aria-label.
 * Label format: "All (16)", "Corners (4)", "Edges (8)", etc.
 */
export function getFilterDefs(): FilterDef[] {
  const { activeFilter } = usePuzzleStore.getState();
  const counts = getBenchFilterCounts();

  const defs: FilterDef[] = [
    { id: 'all',      label: `All (${counts.all})`,           count: counts.all,           isActive: activeFilter === 'all' },
    { id: 'corner',   label: `Corners (${counts.corner})`,   count: counts.corner,         isActive: activeFilter === 'corner' },
    { id: 'edge',     label: `Edges (${counts.edge})`,       count: counts.edge,           isActive: activeFilter === 'edge' },
    { id: 'interior', label: `Interior (${counts.interior})`, count: counts.interior,       isActive: activeFilter === 'interior' },
  ];

  for (let z = 0; z < 5; z++) {
    const key = `palette-${z}` as TrayFilter;
    const zCount = counts[key];
    defs.push({ id: key, label: `Zone ${z + 1} (${zCount})`, count: zCount, isActive: activeFilter === key });
  }

  return defs;
}

/**
 * Return the first currently-visible bench piece ID, or null if the bench is empty.
 * Used by scene.ts for focus handoff on T key open.
 */
export function getFirstVisibleBenchPieceId(): string | null {
  return visibleInTray()[0] ?? null;
}

/**
 * Cycle the active bench filter by `direction` (+1 = next, -1 = prev).
 * Steps through the full canonical filter order, skipping empty filters.
 * Spatial position is preserved — pressing ] from Corners (empty) lands on
 * Edges, not whatever happens to be first in a compressed list.
 * If all filters are empty, does nothing.
 */
export function cycleFilter(direction: 1 | -1): void {
  const counts = getBenchFilterCounts();
  const allFilters: TrayFilter[] = [
    'all', 'corner', 'edge', 'interior',
    'palette-0', 'palette-1', 'palette-2', 'palette-3', 'palette-4',
  ];

  const { activeFilter } = usePuzzleStore.getState();
  let idx = allFilters.indexOf(activeFilter);
  if (idx === -1) idx = 0;

  for (let i = 0; i < allFilters.length; i++) {
    idx = (idx + direction + allFilters.length) % allFilters.length;
    if (counts[allFilters[idx]] > 0) {
      applyBenchFilter(allFilters[idx]);
      return;
    }
  }
  // All filters empty — do nothing.
}

/** Call from both window resize and renderer resize events in scene.ts. */
export function onTrayResize(_app: Application): void {
  if (!_trayContainer) return;
  applyTrayLayout();
  layoutTrayPieces();
}

/**
 * Keyboard Enter extraction — trigger spiral placement for an in-bench piece.
 * Same code path as pointer click (spiralPlace). zoomToPlacePiece() is never
 * called from keyboard handlers. See docs/spike-keyboard-focus.md §9.9.
 */
export function spiralExtractPiece(pieceId: string): void {
  const sprite    = _spriteMap?.get(pieceId);
  const container = _containerMap?.get(pieceId);
  if (!sprite || !container) return;
  spiralPlace(pieceId, sprite, container);
}
