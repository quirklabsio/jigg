import { Application, Container, FederatedPointerEvent, Graphics, Point, Sprite } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { usePuzzleStore } from '../store/puzzleStore';
import {
  isDraggingCanvas,
  insertGroupAABB,
  startDragForPiece,
} from '../puzzle/drag';

// ─── Constants ────────────────────────────────────────────────────────────────

export const TRAY_HEIGHT_OPEN   = 220; // px — tunable
export const TRAY_HEIGHT_CLOSED =  40; // collapsed strip height

const TRAY_BG_COLOR     = 0x1a1a2e;
const TRAY_STRIP_COLOR  = 0x16213e;
const TRAY_HANDLE_COLOR = 0x888899;
const PAD               = 10; // piece spacing in tray
const TRAY_ROWS         = 2;  // wrap into two rows; Story 33 owns proper layout

// ─── Module state ─────────────────────────────────────────────────────────────

let _app: Application | null = null;
let _viewport: Viewport | null = null;
let _trayContainer: Container | null = null;
let _bg: Graphics | null = null;
let _handle: Graphics | null = null;
let _stripHitArea: Graphics | null = null; // stored ref for resize
let _piecesContainer: Container | null = null; // clips piece overflow
let _piecesMask: Graphics | null = null;        // mask on _piecesContainer
let _spriteMap: Map<string, Sprite> | null = null;
let _containerMap: Map<string, Container> | null = null;
let _canvasScale = 1;
let _trayScale = 1;
let _piecePixelW = 0;
let _piecePixelH = 0;

// Shuffled display order — randomised once on init, updated as pieces extract
let _trayDisplayOrder: string[] = [];

// Animation state
let currentTrayHeight = TRAY_HEIGHT_OPEN;
let targetTrayHeight  = TRAY_HEIGHT_OPEN;

// Tray pointer state
let trayPointerDownId: number | null = null;
let trayPointerDownPieceId: string | null = null;
let trayPointerDidCross = false;

// Spiral placement state
let spiralIndex = 0;
let spiralOriginX = 0;
let spiralOriginY = 0;
let spiralOriginLocked = false;

// ─── Fisher-Yates shuffle ─────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Background + handle drawing ──────────────────────────────────────────────

function screenW(): number {
  // Use window.innerWidth as the source of truth — app.screen.width can lag
  // one frame behind when the renderer resize event fires before the DOM reports.
  return _app ? Math.max(_app.screen.width, window.innerWidth) : window.innerWidth;
}

function redrawBackground(): void {
  if (!_bg || !_handle) return;
  const w = screenW();
  const h = currentTrayHeight;
  const open = usePuzzleStore.getState().trayOpen;

  _bg.clear();
  _bg.rect(0, 0, w, h).fill({ color: TRAY_BG_COLOR });
  _bg.rect(0, 0, w, TRAY_HEIGHT_CLOSED).fill({ color: TRAY_STRIP_COLOR });

  // Chevron — purely decorative; the strip hit area handles interaction
  _handle.clear();
  const cx = w / 2;
  const cy = TRAY_HEIGHT_CLOSED / 2;
  _handle.moveTo(cx - 14, cy + (open ? 5 : -5))
         .lineTo(cx,      cy + (open ? -5 : 5))
         .lineTo(cx + 14, cy + (open ? 5 : -5));
  _handle.stroke({ color: TRAY_HANDLE_COLOR, width: 2 });

  // Resize the strip hit area to match new width
  if (_stripHitArea) {
    _stripHitArea.clear();
    _stripHitArea.rect(0, 0, w, TRAY_HEIGHT_CLOSED).fill({ color: 0x000000, alpha: 0 });
  }
}

// ─── Piece layout (2-row wrap, shuffled) ──────────────────────────────────────

/**
 * Position in-tray pieces in a two-row wrap layout using _trayDisplayOrder.
 * Story 33 owns proper scrollable grid layout — this is the placeholder.
 */
function layoutTrayPieces(): void {
  if (!_spriteMap || !_containerMap) return;
  const { piecesById } = usePuzzleStore.getState();

  // Only keep IDs still in tray
  const inTray = _trayDisplayOrder.filter((id) => piecesById[id]?.state === 'in-tray');

  // Use expanded frame dimensions (piece + tab padding) for slot spacing.
  // This matches the scale calculation in initTray so pieces don't overlap.
  const tabPad   = Math.ceil(Math.max(_piecePixelW, _piecePixelH) * 0.4);
  const scaledW  = (_piecePixelW + 2 * tabPad) * _trayScale;
  const scaledH  = (_piecePixelH + 2 * tabPad) * _trayScale;
  const slotW    = scaledW + PAD;

  // Wrap based on available width so layout adapts to any viewport width
  const w = screenW();
  const piecesPerRow = Math.max(1, Math.floor((w - PAD) / slotW));
  const rowH = (TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED - PAD * (TRAY_ROWS + 1)) / TRAY_ROWS;

  inTray.forEach((id, i) => {
    const sprite = _spriteMap!.get(id);
    const container = _containerMap!.get(id);
    if (!sprite || !container) return;

    const col = i % piecesPerRow;
    const row = Math.floor(i / piecesPerRow);
    const x = PAD + col * slotW + scaledW / 2;
    const y = PAD + row * (scaledH + PAD) + scaledH / 2; // local to _piecesContainer

    sprite.x = x;
    sprite.y = y;
    container.x = 0;
    container.y = 0;
    container.visible = true;
  });

  // Refresh clip mask width
  if (_piecesMask) {
    _piecesMask.clear();
    _piecesMask.rect(0, 0, w, TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED).fill({ color: 0xffffff });
  }
}

// ─── Tray open / close ────────────────────────────────────────────────────────

export function setTrayOpen(open: boolean): void {
  if (!_app || !_viewport) return;
  usePuzzleStore.getState().setTrayOpen(open);
  targetTrayHeight = open ? TRAY_HEIGHT_OPEN : TRAY_HEIGHT_CLOSED;

  // Reduced motion: snap immediately
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
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
  const maxDim = Math.max(_piecePixelW, _piecePixelH);
  const stepSize = maxDim * Math.SQRT2 * 1.3;
  const b = stepSize / (2 * Math.PI);

  const { groupsById, piecesById } = usePuzzleStore.getState();
  const hw = piece.textureRegion.w / 2;
  const hh = piece.textureRegion.h / 2;

  let worldX = spiralOriginX;
  let worldY = spiralOriginY;
  let found = false;

  for (let attempt = 0; attempt < N * 4 + 20; attempt++) {
    const theta = spiralIndex * 1.5;
    const r = b * theta;
    const cx = spiralOriginX + r * Math.cos(theta);
    const cy = spiralOriginY + r * Math.sin(theta);

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
      found = true;
      break;
    }
  }

  if (!found) {
    worldX = spiralOriginX + spiralIndex * 10;
    worldY = spiralOriginY + spiralIndex * 10;
    spiralIndex++;
  }

  const groupId = `group-${pieceId}`;

  (_piecesContainer ?? _trayContainer!).removeChild(container);
  _viewport.addChild(container);
  container.x = 0;
  container.y = 0;

  sprite.position.set(worldX, worldY);
  sprite.scale.set(_canvasScale);
  sprite.eventMode = 'none';

  usePuzzleStore.getState().extractPieceToCanvas(pieceId, groupId, { x: worldX, y: worldY });
  insertGroupAABB(groupId, worldX - hw, worldY - hh, piece.textureRegion.w, piece.textureRegion.h);

  // Remove from display order
  _trayDisplayOrder = _trayDisplayOrder.filter((id) => id !== pieceId);
}

// ─── Pointer hit test ─────────────────────────────────────────────────────────

function hitTestTrayPiece(screenX: number, screenY: number): string | null {
  if (!_spriteMap || !_trayContainer || !_piecesContainer) return null;
  const { piecesById } = usePuzzleStore.getState();
  const inTray = _trayDisplayOrder.filter((id) => piecesById[id]?.state === 'in-tray');

  const tabPad = Math.ceil(Math.max(_piecePixelW, _piecePixelH) * 0.4);
  const hw = ((_piecePixelW + 2 * tabPad) / 2) * _trayScale;
  const hh = ((_piecePixelH + 2 * tabPad) / 2) * _trayScale;

  // Convert screen coords to _piecesContainer local space
  const pcLocalX = screenX - _trayContainer.x; // tray.x is always 0
  const pcLocalY = screenY - _trayContainer.y - _piecesContainer.y;

  for (let i = inTray.length - 1; i >= 0; i--) {
    const sprite = _spriteMap.get(inTray[i]);
    if (!sprite) continue;
    if (Math.abs(pcLocalX - sprite.x) <= hw && Math.abs(pcLocalY - sprite.y) <= hh) {
      return inTray[i];
    }
  }
  return null;
}

// ─── Extraction from tray (drag) ─────────────────────────────────────────────

const _tmpPoint = new Point();

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

  const sprite = _spriteMap.get(pieceId);
  const container = _containerMap.get(pieceId);
  if (!sprite || !container) return;

  // Snapshot sprite's screen position BEFORE reparenting
  sprite.getGlobalPosition(_tmpPoint);
  const spriteWorld = _viewport.toLocal(_tmpPoint);

  // Reparent container from pieces container into viewport (sprite is never destroyed)
  (_piecesContainer ?? _trayContainer!).removeChild(container);
  _viewport.addChild(container);
  container.x = 0;
  container.y = 0;

  // Restore canvas scale and world position
  sprite.position.set(spriteWorld.x, spriteWorld.y);
  sprite.scale.set(_canvasScale);
  sprite.eventMode = 'none';

  const groupId = `group-${pieceId}`;
  usePuzzleStore.getState().extractPieceToCanvas(pieceId, groupId, { x: spriteWorld.x, y: spriteWorld.y });

  const hw = piece.textureRegion.w / 2;
  const hh = piece.textureRegion.h / 2;
  insertGroupAABB(groupId, spriteWorld.x - hw, spriteWorld.y - hh, piece.textureRegion.w, piece.textureRegion.h);

  // Hand off to drag.ts using the POINTER world position (not sprite centre).
  // drag.ts computes dragOffset = spritePos - pointerPos, preserving the finger's
  // position on the piece rather than snapping the piece centre to the cursor.
  startDragForPiece(pieceId, pointerId, pointerWorldX, pointerWorldY);

  // Remove from tray display order
  _trayDisplayOrder = _trayDisplayOrder.filter((id) => id !== pieceId);
}

// ─── App-stage pointer handlers ───────────────────────────────────────────────

function onStagePointerMove(e: FederatedPointerEvent): void {
  if (trayPointerDownId === null || e.pointerId !== trayPointerDownId) return;
  if (isDraggingCanvas()) return;
  if (trayPointerDidCross) return;
  if (!_viewport || !_app) return;

  const trayTop = _app.screen.height - currentTrayHeight;
  if (e.global.y < trayTop && trayPointerDownPieceId !== null) {
    trayPointerDidCross = true;
    const id = trayPointerDownPieceId;
    const pid = e.pointerId;
    trayPointerDownId = null;
    trayPointerDownPieceId = null;

    // Convert pointer screen position → viewport world position for drag offset
    const pointerWorld = _viewport.toLocal(e.global);
    extractToCanvas(id, pid, pointerWorld.x, pointerWorld.y);
  }
}

function onStagePointerUp(e: FederatedPointerEvent): void {
  if (trayPointerDownId === null || e.pointerId !== trayPointerDownId) return;
  if (isDraggingCanvas()) return;

  const id = trayPointerDownPieceId;
  trayPointerDownId = null;
  trayPointerDownPieceId = null;
  trayPointerDidCross = false;

  if (id === null) return;

  const sprite = _spriteMap?.get(id);
  const container = _containerMap?.get(id);
  if (!sprite || !container) return;

  spiralPlace(id, sprite, container);
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

  // Tray scale: fit pieces into two rows within the open tray area.
  // Sprites have expanded frames that include tab-protrusion padding (40% of
  // piece size each side), so scale against the full expanded dimension — not
  // just the grid-cell size — to prevent overflow out of the tray.
  const tabPad     = Math.ceil(Math.max(piecePixelW, piecePixelH) * 0.4);
  const expandedW  = piecePixelW + 2 * tabPad;
  const expandedH  = piecePixelH + 2 * tabPad;
  const availH     = TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED - PAD * (TRAY_ROWS + 1);
  const rowH       = availH / TRAY_ROWS;
  _trayScale = Math.min(rowH / expandedH, rowH / expandedW, canvasScale);

  const { pieces } = usePuzzleStore.getState();

  // Randomise display order for the tray
  _trayDisplayOrder = shuffle(pieces.filter((p) => p.state === 'in-tray').map((p) => p.id));

  // Apply tray scale + eventMode to all in-tray sprites
  for (const piece of pieces) {
    if (piece.state !== 'in-tray') continue;
    const sprite = spriteMap.get(piece.id);
    if (sprite) {
      sprite.scale.set(_trayScale);
      sprite.eventMode = 'static';
    }
  }

  // ── Tray container ──────────────────────────────────────────────────────────
  const tray = new Container();
  tray.zIndex = 500;
  tray.eventMode = 'static';
  tray.y = app.screen.height - TRAY_HEIGHT_OPEN;
  app.stage.addChild(tray);
  _trayContainer = tray;

  // ── Background (drawn below pieces) ────────────────────────────────────────
  _bg = new Graphics();
  _bg.zIndex = 0;
  tray.addChild(_bg);

  // ── Chevron handle (decorative only — strip handles interaction) ────────────
  _handle = new Graphics();
  _handle.zIndex = 5;
  tray.addChild(_handle);

  // ── Clipped pieces container — sits below the strip ─────────────────────────
  // Pieces live inside _piecesContainer so a Graphics mask clips overflow cleanly.
  _piecesContainer = new Container();
  _piecesContainer.y = TRAY_HEIGHT_CLOSED; // offset below strip
  _piecesContainer.zIndex = 10;
  tray.addChild(_piecesContainer);

  _piecesMask = new Graphics();
  _piecesMask.rect(0, 0, app.screen.width, TRAY_HEIGHT_OPEN - TRAY_HEIGHT_CLOSED).fill({ color: 0xffffff });
  _piecesContainer.addChild(_piecesMask);
  _piecesContainer.mask = _piecesMask;

  // Move in-tray piece containers into _piecesContainer (in display order)
  for (const id of _trayDisplayOrder) {
    const container = containerMap.get(id);
    if (container) _piecesContainer.addChild(container);
  }

  // ── Strip hit area — toggles open/close ─────────────────────────────────────
  _stripHitArea = new Graphics();
  _stripHitArea.rect(0, 0, app.screen.width, TRAY_HEIGHT_CLOSED).fill({ color: 0x000000, alpha: 0 });
  _stripHitArea.eventMode = 'static';
  _stripHitArea.zIndex = 20;
  tray.addChild(_stripHitArea);

  _stripHitArea.on('pointerdown', (e: FederatedPointerEvent) => {
    e.stopPropagation();
    // Strip click toggles open/closed in both directions
    setTrayOpen(!usePuzzleStore.getState().trayOpen);
  });

  // ── Piece pointerdown in tray ───────────────────────────────────────────────
  tray.on('pointerdown', (e: FederatedPointerEvent) => {
    if (isDraggingCanvas()) return;
    if (trayPointerDownId !== null) return;
    if (!usePuzzleStore.getState().trayOpen) return;

    const localY = e.global.y - tray.y;
    if (localY < TRAY_HEIGHT_CLOSED) return; // strip toggles — handled above

    const pieceId = hitTestTrayPiece(e.global.x, e.global.y);
    if (!pieceId) return;

    trayPointerDownId = e.pointerId;
    trayPointerDownPieceId = pieceId;
    trayPointerDidCross = false;
    e.stopPropagation();
  });

  // ── App-stage move / up ─────────────────────────────────────────────────────
  app.stage.on('pointermove',      onStagePointerMove);
  app.stage.on('pointerup',        (e) => onStagePointerUp(e));
  app.stage.on('pointercancel',    (e) => onStagePointerUp(e));
  app.stage.on('pointerupoutside', (e) => onStagePointerUp(e));

  // ── Animation ticker (lerp) ─────────────────────────────────────────────────
  app.ticker.add(() => {
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

  redrawBackground();
  layoutTrayPieces();

  // Initial viewport resize to account for open tray
  viewport.resize(screenW(), app.screen.height - TRAY_HEIGHT_OPEN);

  return tray;
}

/** Call from both window resize and renderer resize events in scene.ts. */
export function onTrayResize(app: Application): void {
  if (!_trayContainer) return;
  applyTrayLayout();
  layoutTrayPieces();
}
