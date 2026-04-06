import {
  Application,
  Container,
  FederatedPointerEvent,
  FederatedWheelEvent,
  Filter,
  Graphics,
  Point,
  Sprite,
  Text,
} from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { usePuzzleStore, type TrayFilter } from '../store/puzzleStore';
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

// Grid layout constants — Story 33
const THUMBNAIL_SIZE      = TRAY_HEIGHT_OPEN * 0.7; // ~154px — tunable
const PADDING             = 8;                       // px between thumbnails

// Filter strip — Story 34
const FILTER_STRIP_HEIGHT = 36; // px — above the piece grid

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

// Shuffled display order — randomised once on init, updated as pieces extract
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

// ─── Fisher-Yates shuffle ─────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

/** Returns the subset of in-tray piece IDs that match the active filter. */
function visibleInTray(): string[] {
  const { piecesById, activeFilter } = usePuzzleStore.getState();
  const all = _trayDisplayOrder.filter((id) => piecesById[id]?.state === 'in-tray');
  if (activeFilter === 'all') return all;
  if (activeFilter.startsWith('zone-')) {
    const zone = parseInt(activeFilter.slice(5), 10);
    return all.filter((id) => piecesById[id]?.colorZone === zone);
  }
  return all.filter((id) => piecesById[id]?.edgeType === activeFilter);
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
 * Add a centred zone index label (Z1–Z5) to a swatch container.
 * Idempotent — removes any existing label first.
 * Also hides the glowDot on the active swatch to avoid clash with text.
 */
function addZoneLabel(swatchContainer: Container, zoneIndex: number, active: boolean): void {
  removeZoneLabel(swatchContainer);

  const fontSize = active ? ZONE_LABEL_FONT_SIZE_ACTIVE : ZONE_LABEL_FONT_SIZE_DEFAULT;
  const label = new Text({
    text: `Z${zoneIndex + 1}`,
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
 * Compute the mean colorVector of all pieces (all states) in each zone.
 * Used as the swatch fill colour — stable regardless of tray state.
 */
function zoneMeanColors(): [number, number, number][] {
  const { pieces } = usePuzzleStore.getState();
  const sums: [number, number, number][] = Array.from({ length: NUM_ZONES }, () => [0, 0, 0]);
  const counts = new Array<number>(NUM_ZONES).fill(0);
  for (const p of pieces) {
    const z = p.colorZone;
    if (z >= 0 && z < NUM_ZONES) {
      sums[z][0] += p.colorVector[0];
      sums[z][1] += p.colorVector[1];
      sums[z][2] += p.colorVector[2];
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
 * Redraw the filter strip buttons with current counts and active state.
 * Called from layoutTrayPieces so counts stay in sync with tray state.
 */
function renderFilterStrip(): void {
  if (!_filterContainer) return;

  _filterContainer.removeChildren();

  const { piecesById, activeFilter } = usePuzzleStore.getState();
  const w    = screenW();
  const btnH = 26;
  const btnY = (FILTER_STRIP_HEIGHT - btnH) / 2;

  // Text buttons occupy space left of the swatch area
  const textAreaW = w - SWATCH_AREA_W;
  const btnW = Math.floor(textAreaW / FILTER_OPTIONS.length);

  // Count in-tray pieces per edge type
  const edgeCounts: Record<'all' | 'corner' | 'edge' | 'interior', number> =
    { all: 0, corner: 0, edge: 0, interior: 0 };
  const zoneCounts = new Array<number>(NUM_ZONES).fill(0);
  for (const id of _trayDisplayOrder) {
    const p = piecesById[id];
    if (!p || p.state !== 'in-tray') continue;
    edgeCounts.all++;
    edgeCounts[p.edgeType]++;
    const z = p.colorZone;
    if (z >= 0 && z < NUM_ZONES) zoneCounts[z]++;
  }

  // ── Edge type buttons ────────────────────────────────────────────────────
  for (let i = 0; i < FILTER_OPTIONS.length; i++) {
    const { key, label } = FILTER_OPTIONS[i];
    const isActive = activeFilter === key;
    const count    = edgeCounts[key as keyof typeof edgeCounts];
    const dimmed   = count === 0;

    const btn = new Container();
    btn.eventMode = 'static';
    btn.cursor    = 'pointer';

    const bg = new Graphics();
    bg.rect(i * btnW + 2, btnY, btnW - 4, btnH)
      .fill({ color: isActive ? 0x4a90d9 : 0x252545 });
    btn.addChild(bg);

    const txt = new Text({
      text: `${label} (${count})`,
      resolution: window.devicePixelRatio,
      style: {
        fill:       dimmed ? 0x777799 : isActive ? 0xffffff : 0xddddf0,
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
      usePuzzleStore.getState().setActiveFilter(capturedKey);
      _scrollX = 0;
      if (_gridContainer) _gridContainer.x = 0;
      layoutTrayPieces();
    });

    _filterContainer.addChild(btn);
  }

  // ── Color zone swatches ──────────────────────────────────────────────────
  const meanColors  = zoneMeanColors();
  const swatchCY    = FILTER_STRIP_HEIGHT / 2;
  const { highContrast: hcSwatches, greyscale } = usePuzzleStore.getState();
  // Place swatches starting from right of text area, centred in strip
  const swatchStartX = textAreaW + (SWATCH_AREA_W - NUM_ZONES * SWATCH_SPACING) / 2 + SWATCH_RADIUS;

  // TODO: Story 52 — add zone index labels to preferences color zone buttons
  // when greyscale active (AC-3). The filter strip swatches below receive Z1–Z5
  // labels via addZoneLabel, but a future settings panel (Story 52) must also
  // propagate zone indices to any DOM color zone filter buttons it introduces.

  for (let z = 0; z < NUM_ZONES; z++) {
    const filterKey = `zone-${z}` as TrayFilter;
    const isActive  = activeFilter === filterKey;
    const inTrayCount = zoneCounts[z];
    const dimmed    = inTrayCount === 0;
    const [mr, mg, mb] = meanColors[z];
    const fillColor = (mr << 16) | (mg << 8) | mb;

    const cx = swatchStartX + z * SWATCH_SPACING;

    // Swatch container positioned at circle center — children draw at (0, 0).
    // This allows zone labels to be placed at (0, 0) with anchor (0.5).
    const swatch = new Container();
    swatch.eventMode = 'static';
    swatch.cursor    = 'pointer';
    swatch.position.set(cx, swatchCY);

    const g = new Graphics();
    // Active swatches always scale up — pops toward the user regardless of HC.
    const drawRadius = isActive ? SWATCH_RADIUS_ACTIVE : SWATCH_RADIUS;

    // ── Non-HC active ring ───────────────────────────────────────────────────
    // White selection ring 3 px outside the fill — normal mode only.
    if (isActive && !hcSwatches) {
      g.circle(0, 0, drawRadius + 3).stroke({ color: 0xffffff, width: 2 });
    }

    // ── HC dual-ring halo ────────────────────────────────────────────────────
    // Rings abut perfectly (touch at drawRadius + 1.5):
    //   Outer (r+2.5, w=2) → pixel-radii (r+1.5)–(r+3.5)
    //   Inner (r+1,   w=1) → pixel-radii (r+0.5)–(r+1.5)
    // Outer ring: Neon Magenta when active+HC, White otherwise.
    if (hcSwatches) {
      const outerColor = (isActive) ? SWATCH_HC_ACTIVE_CLR : 0xffffff;
      g.circle(0, 0, drawRadius + 2.5).stroke({ color: outerColor, width: 2 });
      g.circle(0, 0, drawRadius + 1  ).stroke({ color: 0x000000,   width: 1 });
    }

    // ── Filled swatch circle ─────────────────────────────────────────────────
    g.circle(0, 0, drawRadius).fill({ color: fillColor, alpha: dimmed ? 0.35 : 1.0 });

    swatch.addChild(g);

    // ── Active inner glow dot — separate named child for visibility toggle ───
    // White dot at centre — always created, visible only when active.
    const glowDot = new Graphics();
    glowDot.name = 'glowDot';
    glowDot.circle(0, 0, SWATCH_GLOW_R).fill({ color: 0xffffff });
    glowDot.visible = isActive;
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
      usePuzzleStore.getState().setActiveFilter(`zone-${capturedZ}` as TrayFilter);
      _scrollX = 0;
      if (_gridContainer) _gridContainer.x = 0;
      layoutTrayPieces();
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
  const allInTray = _trayDisplayOrder.filter((id) => piecesById[id]?.state === 'in-tray');
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
  });

  // Total grid dimensions
  const totalCols = inTray.length > 0 ? Math.ceil(inTray.length / rows) : 0;
  _totalGridWidth = totalCols > 0 ? PADDING + totalCols * (THUMBNAIL_SIZE + PADDING) : 0;

  // Clamp scroll and apply
  _scrollX = clampScroll(_scrollX);
  _gridContainer.x = -_scrollX;

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
}

// ─── Tray open / close ────────────────────────────────────────────────────────

export function setTrayOpen(open: boolean): void {
  if (!_app || !_viewport) return;
  usePuzzleStore.getState().setTrayOpen(open);
  targetTrayHeight = open ? TRAY_HEIGHT_OPEN : TRAY_HEIGHT_CLOSED;

  // Reduced motion: snap immediately instead of lerping
  if (usePuzzleStore.getState().reducedMotion) {
    currentTrayHeight = targetTrayHeight;
    applyTrayLayout();
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
  const stepSize = maxDim * Math.SQRT2 * 1.3;
  const b = stepSize / (2 * Math.PI);

  const { groupsById, piecesById } = usePuzzleStore.getState();
  const hw = piece.textureRegion.w / 2;
  const hh = piece.textureRegion.h / 2;

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
        if (!p || p.state !== 'on-canvas') continue;
        const px = group.position.x + p.actual.x;
        const py = group.position.y + p.actual.y;
        if (Math.abs(cx - px) < hw + p.textureRegion.w / 2 &&
            Math.abs(cy - py) < hh + p.textureRegion.h / 2) {
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

  // Remove from display order and reflow grid
  _trayDisplayOrder = _trayDisplayOrder.filter((id) => id !== pieceId);
  layoutTrayPieces();
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

  // Remove from display order and reflow grid
  _trayDisplayOrder = _trayDisplayOrder.filter((id) => id !== pieceId);
  layoutTrayPieces();
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

  // Remove from display order and reflow
  _trayDisplayOrder = _trayDisplayOrder.filter((id) => id !== pieceId);
  layoutTrayPieces();

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
      if (!prev || prev.state === piece.state) continue;
      if (piece.state === 'on-canvas' || piece.state === 'placed') {
        const before = _trayDisplayOrder.length;
        _trayDisplayOrder = _trayDisplayOrder.filter((id) => id !== piece.id);
        if (_trayDisplayOrder.length !== before) changed = true;
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
  _app          = app;
  _viewport     = viewport;
  _spriteMap    = spriteMap;
  _containerMap = containerMap;
  _canvasScale  = canvasScale;
  _piecePixelW  = piecePixelW;
  _piecePixelH  = piecePixelH;
  _scrollX      = 0;

  const { pieces } = usePuzzleStore.getState();

  // Randomise display order for the tray
  _trayDisplayOrder = shuffle(pieces.filter((p) => p.state === 'in-tray').map((p) => p.id));

  // Set up in-tray sprites: clear filters, set eventMode.
  // Scale is set in layoutTrayPieces() — no need to set here.
  for (const piece of pieces) {
    if (piece.state !== 'in-tray') continue;
    const sprite = spriteMap.get(piece.id);
    if (!sprite) continue;
    // Save existing filters (e.g. BevelFilter applied by scene.ts) and clear them
    // for the tray thumbnail view — restored on extraction to canvas.
    _originalFilters.set(piece.id, (sprite.filters as Filter[] | null) ?? []);
    sprite.filters   = [];
    sprite.eventMode = 'static';
  }

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
    // Reduced motion: skip lerp — snap to target on any frame where they differ.
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
  zoomCheckbox.type    = 'checkbox';
  zoomCheckbox.checked = usePuzzleStore.getState().zoomToPlace;
  zoomCheckbox.style.margin = '0';
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
    cb.type    = 'checkbox';
    cb.checked = usePuzzleStore.getState()[key] as boolean;
    cb.style.margin = '0';
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

/** Call from both window resize and renderer resize events in scene.ts. */
export function onTrayResize(_app: Application): void {
  if (!_trayContainer) return;
  applyTrayLayout();
  layoutTrayPieces();
}
