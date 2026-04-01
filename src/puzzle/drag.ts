import type { Application, Container, Sprite } from 'pixi.js';
import { FederatedPointerEvent, Graphics, Point, Rectangle } from 'pixi.js';
import type { Piece, PieceGroup } from '../puzzle/types';
import { usePuzzleStore } from '../store/puzzleStore';

const DRAG_SCALE = 1.03;
const Z_IDLE = 0;
// Monotonically increasing settle counter — each drop gets a unique zIndex so
// the most-recently-placed piece is always the topmost when pieces overlap.
let settleCounter = 0;
const CELL_SIZE = 128;

// ─── Drag lift rotation ────────────────────────────────────────────────────────

const LIFT_ROT   = 0.0175; // 1° in radians
const TWEEN_MS   = 80;

/** Ease-in-out quad: smooth over [0,1] */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/** Snap a rotation to the nearest 90° increment. */
function nearestQuarter(r: number): number {
  return Math.round(r / (Math.PI / 2)) * (Math.PI / 2);
}

/**
 * Monotonically increasing tween ID. Each tweenRotation call increments this,
 * making any previously-running tween's ticker function a no-op on the next
 * tick. This prevents a snap-back tween from clobbering a rotateGroup call
 * that fires while the tween is still running (e.g. double-tap within 80ms of
 * the first tap's pointerup).
 */
let tweenId = 0;

/**
 * Tween the rotation of every sprite in `entries` from `from` to `to`
 * over TWEEN_MS using the app ticker.
 * Cancels any previously-started rotation tween automatically.
 */
function tweenRotation(
  app: Application,
  entries: GroupEntry[],
  from: number,
  to: number,
): void {
  if (Math.abs(to - from) < 1e-6) return;
  const myId = ++tweenId; // cancel any previous tween
  const start = performance.now();
  const tickerFn = () => {
    if (tweenId !== myId) { app.ticker.remove(tickerFn); return; } // stale — cancelled
    const t = Math.min((performance.now() - start) / TWEEN_MS, 1);
    const rot = from + (to - from) * easeInOut(t);
    for (const { sprite: s } of entries) s.rotation = rot;
    if (t >= 1) app.ticker.remove(tickerFn);
  };
  app.ticker.add(tickerFn);
}

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
let _worldContainer: Container | null = null;
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
let preDragRotation = 0; // rotation of the group before lift tween
let groupEntries: GroupEntry[] = [];

const _pos = new Point();
const spatialHash = new SpatialHash();

// ─── Callbacks wired by scene.ts ──────────────────────────────────────────────
let _spriteMap: Map<string, Sprite> | null = null;
let _rotateCallback: ((groupId: string) => void) | null = null;
let _dragStartCallback: ((groupId: string) => void) | null = null;
let _dragEndCallback: ((groupId: string) => void) | null = null;
let _lastTapMs = 0;
let _lastTapGroupId = '';
const DOUBLE_TAP_MS = 300;

type SnapResult = { survivorId: string; absorbedId: string };
let _snapCallback: ((groupId: string) => SnapResult | null) | null = null;

type BoardSnapResult = { groupId: string; pieceIds: string[] };
let _boardSnapCallback: ((groupId: string) => BoardSnapResult | null) | null = null;

// ─── AABB helpers ─────────────────────────────────────────────────────────────

function aabbFromEntries(
  gox: number, goy: number,
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const rot = usePuzzleStore.getState().groupsById[activeGroupId]?.rotation ?? 0;
  const ac = Math.abs(Math.cos(rot));
  const as = Math.abs(Math.sin(rot));
  for (const { sprite: s, localX, localY } of groupEntries) {
    const tw = s.texture.frame.width * s.scale.x;
    const th = s.texture.frame.height * s.scale.y;
    const hw = (tw * ac + th * as) / 2;
    const hh = (tw * as + th * ac) / 2;
    const cx = gox + localX; const cy = goy + localY;
    if (cx - hw < minX) minX = cx - hw;
    if (cy - hh < minY) minY = cy - hh;
    if (cx + hw > maxX) maxX = cx + hw;
    if (cy + hh > maxY) maxY = cy + hh;
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function initAABB(
  group: PieceGroup,
  piecesById: Record<string, Piece>,
  spriteMap: Map<string, Sprite>,
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ac = Math.abs(Math.cos(group.rotation));
  const as = Math.abs(Math.sin(group.rotation));
  for (const pid of group.pieceIds) {
    const piece = piecesById[pid];
    const s = spriteMap.get(pid);
    if (!piece || !s) continue;
    const tw = s.texture.frame.width * s.scale.x;
    const th = s.texture.frame.height * s.scale.y;
    const hw = (tw * ac + th * as) / 2;
    const hh = (tw * as + th * ac) / 2;
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

function getVisualGroupOrigin(
  sprite: Sprite,
  localX: number,
  localY: number,
): { x: number; y: number } {
  return { x: sprite.x - localX, y: sprite.y - localY };
}

// ─── Move / Up ────────────────────────────────────────────────────────────────

function onMove(e: FederatedPointerEvent): void {
  if (!dragging || e.pointerId !== activePointerId || !_worldContainer) return;
  _worldContainer.toLocal(e.global, undefined, _pos);
  const gx = _pos.x + dragOffsetX;
  const gy = _pos.y + dragOffsetY;
  for (const { sprite: s, localX, localY } of groupEntries) {
    s.x = gx + localX;
    s.y = gy + localY;
  }
  const aabb = aabbFromEntries(gx, gy);
  if (aabb) spatialHash.update(activeGroupId, aabb.x, aabb.y, aabb.w, aabb.h);
}

function onUp(e?: FederatedPointerEvent): void {
  if (!dragging || (e && e.pointerId !== activePointerId)) return;
  dragging = false;
  activePointerId = null;

  for (const { sprite: s } of groupEntries) s.scale.set(baseScale);
  if (_hitLayer) _hitLayer.cursor = 'grab';

  const as = anchorSprite;
  if (!as) return;

  const { x: gox, y: goy } = getVisualGroupOrigin(as, anchorLocalX, anchorLocalY);

  const aabb = aabbFromEntries(gox, goy);
  if (aabb) spatialHash.update(activeGroupId, aabb.x, aabb.y, aabb.w, aabb.h);

  usePuzzleStore.getState().moveGroup(activeGroupId, { x: gox, y: goy });

  // ── Tween rotation back to nearest 90° ──────────────────────────────────
  if (_app) {
    const snapRot = nearestQuarter(preDragRotation);
    // Snapshot current entries before async snap below mutates groupEntries
    const entriesSnapshot = [...groupEntries];
    tweenRotation(_app, entriesSnapshot, as.rotation, snapRot);
  }

  // ── Shadow: revert to resting ────────────────────────────────────────────
  _dragEndCallback?.(activeGroupId);

  // ── Piece-to-piece snap ──────────────────────────────────────────────────
  let finalGroupId = activeGroupId;
  if (_snapCallback && _spriteMap) {
    const result = _snapCallback(activeGroupId);
    if (result) {
      spatialHash.remove(result.absorbedId);
      const snapState = usePuzzleStore.getState();
      const survivorGroup = snapState.groupsById[result.survivorId];
      if (survivorGroup) {
        const saabb = initAABB(survivorGroup, snapState.piecesById, _spriteMap);
        if (saabb) spatialHash.update(result.survivorId, saabb.x, saabb.y, saabb.w, saabb.h);
      }
      finalGroupId = result.survivorId;
    }
  }

  // ── Board snap ───────────────────────────────────────────────────────────
  if (_boardSnapCallback && _spriteMap) {
    const boardResult = _boardSnapCallback(finalGroupId);
    if (boardResult) {
      spatialHash.remove(boardResult.groupId);
    }
  }

  // ── Assign settle zIndex on container (parent) ───────────────────────────
  const zIdx = ++settleCounter;
  const finalState = usePuzzleStore.getState();
  const finalGroup = finalState.groupsById[finalGroupId];
  if (finalGroup && _spriteMap) {
    for (const pid of finalGroup.pieceIds) {
      const s = _spriteMap.get(pid);
      if (s) (s.parent ?? s).zIndex = zIdx;
    }
  } else {
    for (const { sprite: s } of groupEntries) (s.parent ?? s).zIndex = zIdx;
  }
  _worldContainer?.sortChildren(); // force z-sort so settle order takes effect immediately

  activeGroupId = '';
  groupEntries = [];
  anchorSprite = null;
  anchorLocalX = 0;
  anchorLocalY = 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createHitLayer(worldContainer: Container, _worldW: number, _worldH: number): Graphics {
  const g = new Graphics();
  // Hit layer must catch events at any zoom/pan level. The world-space Rectangle
  // approach breaks when the pointer's world coord exceeds the rectangle (e.g.
  // zoomed far out). Use an infinite hitArea instead — actual piece hit-testing
  // is done manually in the pointerdown handler, so this is correct.
  g.hitArea = { contains: () => true };
  g.zIndex = 1000;
  g.eventMode = 'none';
  g.cursor = 'grab';
  worldContainer.addChild(g);
  return g;
}

export function initDragListeners(
  hl: Graphics,
  app: Application,
  spriteMap: Map<string, Sprite>,
  worldContainer?: Container,
): void {
  _app = app;
  _worldContainer = worldContainer ?? app.stage;
  _hitLayer = hl;
  _spriteMap = spriteMap;
  settleCounter = spriteMap.size;

  const state = usePuzzleStore.getState();
  for (const group of state.groups) {
    const aabb = initAABB(group, state.piecesById, spriteMap);
    if (aabb) spatialHash.insert(group.id, aabb.x, aabb.y, aabb.w, aabb.h);
  }

  app.stage.on('pointermove', onMove);
  app.stage.on('pointerup',       (e) => onUp(e));
  app.stage.on('pointercancel',   (e) => onUp(e));
  app.stage.on('pointerupoutside',(e) => onUp(e));

  hl.on('pointerdown', (e: FederatedPointerEvent) => {
    if (activePointerId !== null) return;

    _worldContainer!.toLocal(e.global, undefined, _pos);
    const px = _pos.x;
    const py = _pos.y;

    const st = usePuzzleStore.getState();
    const candidates = spatialHash.query(px, py);

    let bestGroupId: string | null = null;
    let bestZ = -Infinity;

    for (const groupId of candidates) {
      const group = st.groupsById[groupId];
      if (!group) continue;
      for (const pid of group.pieceIds) {
        const s = spriteMap.get(pid);
        const piece = st.piecesById[pid];
        if (!s || !piece) continue;
        const dx = px - s.x;
        const dy = py - s.y;
        const cos = Math.cos(-s.rotation);
        const sin = Math.sin(-s.rotation);
        const lx = (cos * dx - sin * dy) / s.scale.x;
        const ly = (sin * dx + cos * dy) / s.scale.y;
        const hw = piece.textureRegion.w / 2;
        const hh = piece.textureRegion.h / 2;
        if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) {
          // Use parent container's zIndex for correct topmost selection
          const z = s.parent?.zIndex ?? s.zIndex;
          if (z > bestZ) { bestZ = z; bestGroupId = groupId; }
          break;
        }
      }
    }

    if (!bestGroupId) return;

    // ── Double-tap detection ──────────────────────────────────────────────
    const now = performance.now();
    if (
      _rotateCallback &&
      bestGroupId === _lastTapGroupId &&
      now - _lastTapMs < DOUBLE_TAP_MS
    ) {
      tweenId++; // cancel any pending snap-back tween so it doesn't clobber rotateGroup
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
    preDragRotation = anchorRef.rotation; // store before tween

    activePointerId = e.pointerId;
    dragging = true;
    activeGroupId = bestGroupId;

    // Scale lift (solo pieces only)
    const liftScale = group.pieceIds.length === 1 ? baseScale * DRAG_SCALE : baseScale;
    for (const { sprite: s } of groupEntries) {
      s.scale.set(liftScale);
      (s.parent ?? s).zIndex = settleCounter + 1;
    }
    app.stage.sortChildren(); // force z-sort so dragged piece renders on top immediately
    hl.cursor = 'grabbing';

    const origin = getVisualGroupOrigin(anchorRef, anchorPiece.localPosition.x, anchorPiece.localPosition.y);
    dragOffsetX = origin.x - px;
    dragOffsetY = origin.y - py;

    // 1° rotation tween on pickup
    tweenRotation(app, groupEntries, preDragRotation, preDragRotation + LIFT_ROT);

    // Shadow: dragging state
    _dragStartCallback?.(bestGroupId);

    e.stopPropagation();
  });
}

export function setRotateCallback(cb: (groupId: string) => void): void {
  _rotateCallback = cb;
}

export function setDragStartCallback(cb: (groupId: string) => void): void {
  _dragStartCallback = cb;
}

export function setDragEndCallback(cb: (groupId: string) => void): void {
  _dragEndCallback = cb;
}

export function setSnapCallback(
  cb: (groupId: string) => SnapResult | null,
): void {
  _snapCallback = cb;
}

export function setBoardSnapCallback(
  cb: (groupId: string) => BoardSnapResult | null,
): void {
  _boardSnapCallback = cb;
}

export function activateDrag(): void {
  if (_hitLayer) _hitLayer.eventMode = 'static';
}

export function resetDrag(): void {
  spatialHash.clear();
  dragging = false;
  activePointerId = null;
  activeGroupId = '';
  anchorSprite = null;
  groupEntries = [];
  settleCounter = 0;
  _rotateCallback = null;
  _dragStartCallback = null;
  _dragEndCallback = null;
  _snapCallback = null;
  _boardSnapCallback = null;
  _spriteMap = null;
  _lastTapMs = 0;
  _lastTapGroupId = '';
  if (_hitLayer) { _hitLayer.eventMode = 'none'; _hitLayer = null; }
  _worldContainer = null;
  _app = null;
}

export { Z_IDLE };
