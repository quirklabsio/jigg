import type { Application, Sprite } from 'pixi.js';
import { FederatedPointerEvent, Graphics, Point } from 'pixi.js';
import type { Piece, PieceGroup } from '../puzzle/types';
import { usePuzzleStore } from '../store/puzzleStore';

const DRAG_SCALE = 1.03;
const Z_IDLE = 0;
// Monotonically increasing settle counter — each drop gets a unique zIndex so
// the most-recently-placed piece is always the topmost when pieces overlap.
// Z_SETTLED/Z_DRAGGING constants removed: both are now derived from this counter.
let settleCounter = 0;
const CELL_SIZE = 128;

// ─── Spatial hash ─────────────────────────────────────────────────────────────

class SpatialHash {
  private readonly cells = new Map<string, Set<string>>();
  private readonly groupCells = new Map<string, string[]>();

  private key(cx: number, cy: number): string { return `${cx},${cy}`; }

  private keysForAABB(x: number, y: number, w: number, h: number): string[] {
    const x0 = Math.floor(x / CELL_SIZE);
    const y0 = Math.floor(y / CELL_SIZE);
    const x1 = Math.floor((x + w) / CELL_SIZE);
    const y1 = Math.floor((y + h) / CELL_SIZE);
    const keys: string[] = [];
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++)
        keys.push(this.key(cx, cy));
    return keys;
  }

  insert(groupId: string, x: number, y: number, w: number, h: number): void {
    const keys = this.keysForAABB(x, y, w, h);
    this.groupCells.set(groupId, keys);
    for (const k of keys) {
      let cell = this.cells.get(k);
      if (!cell) { cell = new Set<string>(); this.cells.set(k, cell); }
      cell.add(groupId);
    }
  }

  remove(groupId: string): void {
    const keys = this.groupCells.get(groupId);
    if (!keys) return;
    for (const k of keys) this.cells.get(k)?.delete(groupId);
    this.groupCells.delete(groupId);
  }

  update(groupId: string, x: number, y: number, w: number, h: number): void {
    this.remove(groupId);
    this.insert(groupId, x, y, w, h);
  }

  query(px: number, py: number): Set<string> {
    const k = this.key(Math.floor(px / CELL_SIZE), Math.floor(py / CELL_SIZE));
    return this.cells.get(k) ?? new Set<string>();
  }

  clear(): void { this.cells.clear(); this.groupCells.clear(); }
}

// ─── Module-level drag state ──────────────────────────────────────────────────

type GroupEntry = { sprite: Sprite; localX: number; localY: number };

let _app: Application | null = null;
let _hitLayer: Graphics | null = null;
let activePointerId: number | null = null;
let dragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let activeGroupId = '';
let anchorLocalX = 0;
let anchorLocalY = 0;
let anchorSprite: Sprite | null = null;
let baseScale = 1;
let groupEntries: GroupEntry[] = [];

const _pos = new Point();
const spatialHash = new SpatialHash();

// ─── Rotate callback (wired by scene.ts) ──────────────────────────────────────
let _rotateCallback: ((groupId: string) => void) | null = null;
let _lastTapMs = 0;
let _lastTapGroupId = '';
const DOUBLE_TAP_MS = 300;

// ─── AABB helpers ─────────────────────────────────────────────────────────────

// AABB from current groupEntries and a known group origin
function aabbFromEntries(
  gox: number, goy: number,
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { sprite: s, localX, localY } of groupEntries) {
    const hw = s.width / 2; const hh = s.height / 2;
    const cx = gox + localX; const cy = goy + localY;
    if (cx - hw < minX) minX = cx - hw;
    if (cy - hh < minY) minY = cy - hh;
    if (cx + hw > maxX) maxX = cx + hw;
    if (cy + hh > maxY) maxY = cy + hh;
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// AABB for initial spatial hash population (from store positions + sprite sizes)
function initAABB(
  group: PieceGroup,
  piecesById: Record<string, Piece>,
  spriteMap: Map<string, Sprite>,
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pid of group.pieceIds) {
    const piece = piecesById[pid];
    const s = spriteMap.get(pid);
    if (!piece || !s) continue;
    const hw = s.width / 2; const hh = s.height / 2;
    const cx = group.position.x + piece.localPosition.x;
    const cy = group.position.y + piece.localPosition.y;
    if (cx - hw < minX) minX = cx - hw;
    if (cy - hh < minY) minY = cy - hh;
    if (cx + hw > maxX) maxX = cx + hw;
    if (cy + hh > maxY) maxY = cy + hh;
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ─── Group origin ─────────────────────────────────────────────────────────────

/**
 * Recover the world-space group origin from any anchor sprite + its localPosition.
 * Works correctly when localPositions have been baked (rotated groups included).
 */
function getVisualGroupOrigin(
  sprite: Sprite,
  localX: number,
  localY: number,
): { x: number; y: number } {
  return { x: sprite.x - localX, y: sprite.y - localY };
}

// ─── Move / Up (module-level, no per-sprite closures) ─────────────────────────

function onMove(e: FederatedPointerEvent): void {
  if (!dragging || e.pointerId !== activePointerId || !_app) return;
  _app.stage.toLocal(e.global, undefined, _pos);
  const gx = _pos.x + dragOffsetX;
  const gy = _pos.y + dragOffsetY;
  for (const { sprite: s, localX, localY } of groupEntries) {
    s.x = gx + localX;
    s.y = gy + localY;
  }
  // Keep hash current during drag (correctness if pointer lock is ever relaxed)
  const aabb = aabbFromEntries(gx, gy);
  if (aabb) spatialHash.update(activeGroupId, aabb.x, aabb.y, aabb.w, aabb.h);
}

function onUp(e?: FederatedPointerEvent): void {
  if (!dragging || (e && e.pointerId !== activePointerId)) return;
  dragging = false;
  activePointerId = null;

  const zIdx = ++settleCounter;
  for (const { sprite: s } of groupEntries) {
    s.scale.set(baseScale);
    s.zIndex = zIdx;
  }
  if (_hitLayer) _hitLayer.cursor = 'grab';

  const as = anchorSprite;
  if (!as) return;

  const { x: gox, y: goy } = getVisualGroupOrigin(as, anchorLocalX, anchorLocalY);

  // Final hash update — covers the case where pointer was never moved
  const aabb = aabbFromEntries(gox, goy);
  if (aabb) spatialHash.update(activeGroupId, aabb.x, aabb.y, aabb.w, aabb.h);

  usePuzzleStore.getState().moveGroup(activeGroupId, { x: gox, y: goy });

  activeGroupId = '';
  groupEntries = [];
  anchorSprite = null;
  anchorLocalX = 0;
  anchorLocalY = 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create the full-canvas transparent hit layer.
 * Must be added to stage and passed to initDragListeners.
 * eventMode stays 'none' until activateDrag() is called.
 */
export function createHitLayer(app: Application): Graphics {
  const g = new Graphics();
  g.rect(0, 0, app.screen.width, app.screen.height);
  g.fill({ color: 0x000000, alpha: 0 });
  g.zIndex = 1000;
  g.eventMode = 'none';
  g.cursor = 'grab';
  app.stage.addChild(g);
  return g;
}

/**
 * Wire up all drag event handling. Call once from scene.ts after sprites are
 * positioned and spriteMap is built. Populates the spatial hash from store state.
 */
export function initDragListeners(
  hl: Graphics,
  app: Application,
  spriteMap: Map<string, Sprite>,
): void {
  _app = app;
  _hitLayer = hl;
  settleCounter = spriteMap.size; // first drop gets zIndex > all initial per-sprite values

  // Populate spatial hash from scattered positions
  const state = usePuzzleStore.getState();
  for (const group of state.groups) {
    const aabb = initAABB(group, state.piecesById, spriteMap);
    if (aabb) spatialHash.insert(group.id, aabb.x, aabb.y, aabb.w, aabb.h);
  }

  // Stage handles move/up — catches pointer anywhere on canvas
  app.stage.on('pointermove', onMove);
  app.stage.on('pointerup', (e) => onUp(e));
  app.stage.on('pointercancel', (e) => onUp(e));
  app.stage.on('pointerupoutside', (e) => onUp(e));

  // Hit layer handles pointerdown via spatial query → find topmost group
  hl.on('pointerdown', (e: FederatedPointerEvent) => {
    if (activePointerId !== null) return;

    app.stage.toLocal(e.global, undefined, _pos);
    const px = _pos.x;
    const py = _pos.y;

    const st = usePuzzleStore.getState();
    const candidates = spatialHash.query(px, py);

    // Pick the candidate group whose piece bounds contain the pointer,
    // selecting the topmost by zIndex when pieces overlap
    let bestGroupId: string | null = null;
    let bestZ = -Infinity;

    for (const groupId of candidates) {
      const group = st.groupsById[groupId];
      if (!group) continue;
      for (const pid of group.pieceIds) {
        const s = spriteMap.get(pid);
        if (!s) continue;
        // Rotation-aware hit test: transform pointer into sprite local space
        const dx = px - s.x;
        const dy = py - s.y;
        const cos = Math.cos(-s.rotation);
        const sin = Math.sin(-s.rotation);
        const lx = (cos * dx - sin * dy) / s.scale.x;
        const ly = (sin * dx + cos * dy) / s.scale.y;
        const hw = s.texture.frame.width / 2;
        const hh = s.texture.frame.height / 2;
        if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) {
          if (s.zIndex > bestZ) { bestZ = s.zIndex; bestGroupId = groupId; }
          break; // pointer is inside this group — no need to check more pieces
        }
      }
    }

    if (!bestGroupId) return;

    // ── Double-tap detection ──────────────────────────────────────────────────
    const now = performance.now();
    if (
      _rotateCallback &&
      bestGroupId === _lastTapGroupId &&
      now - _lastTapMs < DOUBLE_TAP_MS
    ) {
      // Double-tap: rotate, update hash, reset tap state, do not start drag
      _rotateCallback(bestGroupId);
      const rst = usePuzzleStore.getState();
      const rg = rst.groupsById[bestGroupId];
      if (rg) {
        const raabb = initAABB(rg, rst.piecesById, spriteMap);
        if (raabb) spatialHash.update(bestGroupId, raabb.x, raabb.y, raabb.w, raabb.h);
      }
      _lastTapMs = 0;
      _lastTapGroupId = '';
      e.stopPropagation();
      return;
    }
    _lastTapMs = now;
    _lastTapGroupId = bestGroupId;

    const group = st.groupsById[bestGroupId];
    const anchorPieceId = group.pieceIds[0];
    const anchorPiece = st.piecesById[anchorPieceId];
    const anchorRef = spriteMap.get(anchorPieceId);
    if (!anchorPiece || !anchorRef) return;

    groupEntries = [];
    for (const pid of group.pieceIds) {
      const s = spriteMap.get(pid);
      const p = st.piecesById[pid];
      if (s && p) groupEntries.push({ sprite: s, localX: p.localPosition.x, localY: p.localPosition.y });
    }

    baseScale = anchorRef.scale.x;
    anchorLocalX = anchorPiece.localPosition.x;
    anchorLocalY = anchorPiece.localPosition.y;
    anchorSprite = anchorRef;

    activePointerId = e.pointerId;
    dragging = true;
    activeGroupId = bestGroupId;

    for (const { sprite: s } of groupEntries) {
      s.scale.set(baseScale * DRAG_SCALE);
      s.zIndex = settleCounter + 1; // above all currently settled pieces
    }
    hl.cursor = 'grabbing';

    const origin = getVisualGroupOrigin(anchorRef, anchorPiece.localPosition.x, anchorPiece.localPosition.y);
    dragOffsetX = origin.x - px;
    dragOffsetY = origin.y - py;

    e.stopPropagation();
  });
}

/**
 * Register the rotation handler. Called once from scene.ts.
 * When a double-tap is detected, drag.ts calls this with the groupId.
 */
export function setRotateCallback(cb: (groupId: string) => void): void {
  _rotateCallback = cb;
}

/** Enable the hit layer. Call from main.ts after the full load chain resolves. */
export function activateDrag(): void {
  if (_hitLayer) _hitLayer.eventMode = 'static';
}

/** Reset all drag state and clear the spatial hash. Call before puzzle reinitialisation. */
export function resetDrag(): void {
  spatialHash.clear();
  dragging = false;
  activePointerId = null;
  activeGroupId = '';
  anchorSprite = null;
  groupEntries = [];
  settleCounter = 0;
  _rotateCallback = null;
  _lastTapMs = 0;
  _lastTapGroupId = '';
  if (_hitLayer) { _hitLayer.eventMode = 'none'; _hitLayer = null; }
  _app = null;
}

export { Z_IDLE };
