import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { BevelFilter, DropShadowFilter } from 'pixi-filters';
import { Viewport } from 'pixi-viewport';
import type { CutPath, WorkerMessage } from '../puzzle/types';
import { isInBench, isOnTable } from '../puzzle/types';
import { createBoard } from './board';
import { buildPieceMask, gridCut, EDGE_INFLUENCE } from '../puzzle/cutter';
import {
  createHitLayer,
  initDragListeners,
  setRotateCallback,
  setSnapCallback,
  setBoardSnapCallback,
  setDragStartCallback,
  setDragEndCallback,
} from '../puzzle/drag';
import { onComplete } from '../puzzle/completion';
import { rotateGroup } from '../puzzle/rotate';
import { checkAndApplySnap, checkAndApplyBoardSnap } from '../puzzle/snap';
import { usePuzzleStore, type TrayFilter } from '../store/puzzleStore';
import { initTray, onTrayResize, setTrayOpen, applyTrayPreferences, setTrayLoading, scrollBenchToId, spiralExtractPiece, getTrayDisplayOrder, getVisibleBenchOrder, getFilterDefs, getFirstVisibleBenchPieceId, applyBenchFilter, cycleFilter, registerBenchCollapseHandler } from './bench';
import AnalysisWorker from '../workers/analysis.worker.ts?worker';
import { sampleImageLuminance } from '../utils/luminance';
import { LANDMARK_BENCH_ID, LANDMARK_TABLE_ID, initLandmarks, initBenchButtons, registerBenchHandlers, syncButtonDOMOrder, registerFilterHandlers, initFilterButtons, focusButton, registerTableHandlers, updateTableButtonLabel, applyBenchTabState, initTableLandmarkLabel, announce } from '../utils/aria';
import {
  loadPreferences,
  applyPreferences,
  applyReducedMotion,
  initPreferencesApp,
  initPreferencesViewport,
  registerApplyFn,
  BG_PRESETS_ORDER,
} from '../utils/preferences';

const COLS = 4;
const ROWS = 4;
const WORLD_SIZE = 4000;

// ─── Snap highlight state (AC-4) ─────────────────────────────────────────────
// Module-level state read by the board-snap pulse ticker. Updated by
// updateSnapHighlight() when highContrast or reducedMotion changes.

const SNAP_HIGHLIGHT_COLOR_DEFAULT     = 0x00ff00; // green
const SNAP_HIGHLIGHT_COLOR_HC          = 0xff00ff; // neon magenta — most distinct vs natural images
const SNAP_HIGHLIGHT_ALPHA_DEFAULT     = 0.4;
const SNAP_HIGHLIGHT_ALPHA_HC          = 1.0;      // no partial opacity in HC
const SNAP_HIGHLIGHT_THICKNESS_DEFAULT = 2;
const SNAP_HIGHLIGHT_THICKNESS_HC      = 4;

let _snapHighlightColor = SNAP_HIGHLIGHT_COLOR_DEFAULT;
let _snapHighlightAlpha = SNAP_HIGHLIGHT_ALPHA_DEFAULT;

/**
 * Update snap highlight state from current HC / RM flags.
 * reducedMotion takes highest priority — maximises visibility for vestibular users.
 * Call on init and whenever highContrast or reducedMotion changes in Zustand.
 */
function updateSnapHighlight(highContrast: boolean, reducedMotion: boolean): void {
  if (reducedMotion) {
    // Reduced motion: skip animation entirely (Story 37c) but ensure highlight
    // is still maximally visible when it does appear.
    _snapHighlightColor = SNAP_HIGHLIGHT_COLOR_HC;
    _snapHighlightAlpha = SNAP_HIGHLIGHT_ALPHA_HC;
    return;
  }
  _snapHighlightColor = highContrast ? SNAP_HIGHLIGHT_COLOR_HC          : SNAP_HIGHLIGHT_COLOR_DEFAULT;
  _snapHighlightAlpha = highContrast ? SNAP_HIGHLIGHT_ALPHA_HC          : SNAP_HIGHLIGHT_ALPHA_DEFAULT;
}

// SNAP_HIGHLIGHT_THICKNESS_DEFAULT / _HC reserved for a future Graphics stroke overlay.

// ─── Focus ring state ─────────────────────────────────────────────────────────
// Single shared Graphics on app.stage, redrawn every frame at the focused piece's
// screen-space bounds. Lives above viewport and benchContainer (zIndex 1000).
// Screen-space (not inside viewport) so thickness never scales with zoom.
// See docs/spike-keyboard-focus.md §3 and docs/accessibility.md §9.6.

const FOCUS_RING_COLOR     = 0xff00ff; // neon magenta — matches SNAP_HIGHLIGHT_COLOR_HC
const FOCUS_RING_THICKNESS = 2;        // screen-space px, non-scaling
const FOCUS_RING_PADDING   = 4;        // px outside piece bounding box

// Discriminated union — ticker draws different bounds for each kind.
// 'filter' is reserved for future filter-button focus (not yet wired).
type FocusTarget =
  | { kind: 'piece';   pieceId: string }
  | { kind: 'cluster'; primaryPieceId: string; memberIds: string[] }
  | { kind: 'filter';  filterId: string }
  | null;

let _focusRing:   Graphics    | null = null;
let _focusTarget: FocusTarget        = null;

// Track whether the most recent input was keyboard or pointer.
// Focus ring and guardFocusWithinApp are suppressed after pointer events —
// the ring should only appear from keyboard navigation (Tab / arrow keys).
let _lastInputWasKeyboard = false;

/**
 * Set the focus target. Suppressed when last input was pointer (ring keyboard-only).
 * Clearing (null) always allowed — used to dismiss the ring after blur/completion.
 */
function setFocusedTarget(target: FocusTarget): void {
  if (target !== null && !_lastInputWasKeyboard) return;
  _focusTarget = target;
  if (!target) _focusRing?.clear();
}

/** Bench button focus — thin wrapper around setFocusedTarget for backward compat. */
function setFocusedPiece(pieceId: string | null): void {
  setFocusedTarget(pieceId ? { kind: 'piece', pieceId } : null);
}

/**
 * Compute the screen-space AABB that wraps all member sprites.
 * Returns null if no sprites found (e.g. cluster dissolved after board snap).
 */
function getClusterScreenAABB(
  memberIds: string[],
  spriteMap: Map<string, Sprite>,
): { x: number; y: number; width: number; height: number } | null {
  const sprites = memberIds.map((id) => spriteMap.get(id)).filter(Boolean) as Sprite[];
  if (!sprites.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const sprite of sprites) {
    const b = sprite.getBounds();
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Create the focus ring Graphics and attach it to app.stage as the topmost child.
 * Must be called AFTER initTray (which adds benchContainer at zIndex 500).
 * zIndex 1000 + sortableChildren=true guarantees ring renders above all other stage children.
 * Also registers the per-frame redraw ticker.
 */
function initFocusRing(app: Application, spriteMap: Map<string, Sprite>): void {
  _focusRing        = new Graphics();
  _focusRing.zIndex = 1000; // above benchContainer (500) and viewport (0)
  app.stage.addChild(_focusRing);

  // DRY helper — draws the ring rect from a {x,y,width,height} bounds object.
  // setFocusedTarget owns all _focusRing.clear() calls — no clear() at call sites.
  function drawRingFromBounds(b: { x: number; y: number; width: number; height: number }): void {
    _focusRing!.clear()
      .rect(
        b.x      - FOCUS_RING_PADDING,
        b.y      - FOCUS_RING_PADDING,
        b.width  + FOCUS_RING_PADDING * 2,
        b.height + FOCUS_RING_PADDING * 2,
      )
      .stroke({ color: FOCUS_RING_COLOR, width: FOCUS_RING_THICKNESS });
  }

  // PixiJS v8 removed worldVisible. Walk the parent chain to check global visibility.
  // Used to suppress the ring on filtered-out bench pieces (container.visible=false)
  // without clearing _focusTarget — so the ring returns if the filter is removed.
  function isWorldVisible(sprite: Sprite): boolean {
    let node: Sprite['parent'] = sprite;
    while (node) {
      if (!node.visible) return false;
      node = node.parent;
    }
    return true;
  }

  app.ticker.add(() => {
    if (!_focusRing || !_focusTarget) return;

    if (_focusTarget.kind === 'piece') {
      const sprite = spriteMap.get(_focusTarget.pieceId);
      // Detached guard — sprite removed from scene graph (e.g. mid-extraction).
      // Clears focus target so stale ring doesn't persist.
      if (!sprite || !sprite.parent) {
        setFocusedTarget(null); // setFocusedTarget owns the ring clear
        return;
      }
      // Visibility guard — sprite is in scene graph but hidden (e.g. filtered out in bench).
      // Keep _focusTarget alive so ring returns when filter is cleared; just don't draw.
      if (!isWorldVisible(sprite)) { _focusRing.clear(); return; }
      drawRingFromBounds(sprite.getBounds());

    } else if (_focusTarget.kind === 'cluster') {
      // All members must be present and attached — stale clusters clear immediately
      const allPresent = _focusTarget.memberIds.every((id) => {
        const s = spriteMap.get(id);
        return s && s.parent;
      });
      if (!allPresent) {
        setFocusedTarget(null);
        return;
      }
      // If any member is hidden (filtered out), suppress ring without clearing target
      const allVisible = _focusTarget.memberIds.every((id) => {
        const s = spriteMap.get(id);
        return s && isWorldVisible(s);
      });
      if (!allVisible) { _focusRing.clear(); return; }
      const bounds = getClusterScreenAABB(_focusTarget.memberIds, spriteMap);
      if (bounds) drawRingFromBounds(bounds);
      else        setFocusedTarget(null);
    }
    // kind === 'filter' — no ring for filter buttons
  });
}

// ─── Keyboard mode state ──────────────────────────────────────────────────────
// Single source of truth for which landmark is active for keyboard nav.
// `inert` is ONLY mutated via setKeyboardMode — never touched directly elsewhere.

type KeyboardMode = 'bench' | 'table';
let _keyboardMode: KeyboardMode = 'bench';
let _benchCollapsed = false;  // true once last piece leaves bench — permanent
let _tHint: HTMLElement | null = null;

/**
 * Returns the piece ID with the lowest PieceDefinition.index among all isOnTable
 * pieces that have a button in #landmark-table. Returns null if table is empty.
 * Forward-compatible: looks for [data-piece-id] buttons in #landmark-table
 * (Story 41b will populate them).
 */
function getFirstTablePiece(): string | null {
  const { pieces } = usePuzzleStore.getState();
  const tablePieces = pieces
    .filter(isOnTable)
    .sort((a, b) => a.index - b.index);
  const tableLandmark = document.getElementById(LANDMARK_TABLE_ID);
  if (!tableLandmark) return null;
  for (const p of tablePieces) {
    const btn = tableLandmark.querySelector<HTMLButtonElement>(`[data-piece-id="${p.id}"]`);
    if (btn) return p.id;
  }
  return null;
}

function updateTHint(mode: KeyboardMode, benchExists: boolean): void {
  if (!_tHint) return;
  if (!benchExists) {
    _tHint.style.display = 'none';
    return;
  }
  _tHint.textContent = mode === 'bench' ? 'T → table' : 'T → piece tray';
}

/**
 * Single control point for all keyboard mode switching.
 * The ONLY place `inert` is set on either landmark — O(1).
 */
export function setKeyboardMode(mode: KeyboardMode): void {
  _keyboardMode = mode;

  const benchLandmark = document.getElementById(LANDMARK_BENCH_ID) as HTMLElement | null;
  const tableLandmark = document.getElementById(LANDMARK_TABLE_ID) as HTMLElement | null;
  if (!benchLandmark || !tableLandmark) return;

  // Semantic signal for AT
  benchLandmark.inert = mode !== 'bench';
  tableLandmark.inert = mode !== 'table';

  // Belt-and-suspenders: inert alone is unreliable in some browser/extension
  // environments. Explicitly sweep tabIndex on every mode switch so Tab order
  // is correct regardless of environment.
  applyBenchTabState(mode);
  // Clear stale canvas focus before switching contexts.
  // Must be before requestAnimationFrame — prevents one-frame ring flash.
  setFocusedTarget(null);

  // Focus jump — single rAF so DOM has settled after inert+tabIndex changes
  requestAnimationFrame(() => {
    if (mode === 'bench') {
      const firstId = getFirstVisibleBenchPieceId();
      if (firstId) focusButton(firstId);
    } else {
      const firstId = getFirstTablePiece();
      if (firstId) {
        focusButton(firstId);
      } else {
        // Table is empty — focus the landmark itself so the user has a recovery
        // point. tabIndex=-1 ensures programmatic focus works even though the
        // landmark is not natively focusable.
        tableLandmark.tabIndex = -1;
        tableLandmark.focus();
      }
    }
  });

  const benchExists = usePuzzleStore.getState().pieces.some(isInBench);
  updateTHint(mode, benchExists);
}

export function getKeyboardMode(): KeyboardMode {
  return _keyboardMode;
}

/** Mark bench as permanently collapsed. Called once — never reversed. */
export function setBenchCollapsed(): void {
  _benchCollapsed = true;
}

// ─── Shadow state helpers (mutate one persistent filter per piece) ────────────

const DPR = window.devicePixelRatio ?? 1;

function makeShadow(): DropShadowFilter {
  const f = new DropShadowFilter({
    offset:     { x: 0, y: 3 },
    blur:       8,
    alpha:      0.06,
    color:      0x000000,
    quality:    3,
    resolution: 1,
  });
  f.padding = 24;
  return f;
}

function applyShadowResting(f: DropShadowFilter): void {
  f.offset = { x: 0, y: 3 };
  f.blur   = 8;
  f.alpha  = 0.06;
}

function applyShadowDragging(f: DropShadowFilter): void {
  f.offset = { x: 0, y: 6 };
  f.blur   = 14;
  f.alpha  = 0.10;
}

function applyShadowPlaced(f: DropShadowFilter): void {
  f.offset = { x: 0, y: 2 };
  f.blur   = 4;
  f.alpha  = 0.04;
}

// ─── Sprite builder ───────────────────────────────────────────────────────────

/**
 * Create piece sprites and containers. Containers are added to `trayParent`
 * (the tray container) — initTray handles positioning them in the tray row.
 */
function buildGridSprites(
  trayParent: Container,
  texture: Texture,
  scale: number,
  pixelData?: Uint8ClampedArray,
): { sprites: Sprite[]; containers: Container[] } {
  const tabPad = Math.ceil(Math.max(
    Math.floor(texture.width  / COLS),
    Math.floor(texture.height / ROWS),
  ) * 0.4);
  const { pieces } = gridCut(texture.width, texture.height, COLS, ROWS, pixelData);

  const gridIndex = new Map<string, string>();
  pieces.forEach((p) => gridIndex.set(`${p.gridCoord.col},${p.gridCoord.row}`, p.id));

  usePuzzleStore.getState().setPieces(pieces);
  usePuzzleStore.getState().setGroups([]); // no groups until extraction
  usePuzzleStore.getState().setGridIndex(gridIndex);

  const sprites: Sprite[] = [];
  const containers: Container[] = [];

  for (const piece of pieces) {
    const { col, row } = piece.gridCoord;
    const pw = piece.textureRegion.w;
    const ph = piece.textureRegion.h;
    const leftPad   = Math.min(tabPad, col * pw);
    const topPad    = Math.min(tabPad, row * ph);
    const rightPad  = Math.min(tabPad, (COLS - col - 1) * pw);
    const bottomPad = Math.min(tabPad, (ROWS - row - 1) * ph);
    const expandedW = pw + leftPad + rightPad;
    const expandedH = ph + topPad + bottomPad;
    const frame = new Rectangle(
      piece.textureRegion.x - leftPad,
      piece.textureRegion.y - topPad,
      expandedW,
      expandedH,
    );
    const pieceTexture = new Texture({ source: texture.source, frame });
    const sprite = new Sprite(pieceTexture);
    sprite.scale.set(scale);
    sprite.anchor.set(
      (leftPad + pw / 2) / expandedW,
      (topPad + ph / 2) / expandedH,
    );
    // eventMode set to 'static' by initTray (pieces start in tray, need pointer events)
    sprite.eventMode = 'none';

    const container = new Container();
    container.addChild(sprite);
    // Add to tray parent — initTray moves them into the tray container properly
    trayParent.addChild(container);
    sprites.push(sprite);
    containers.push(container);
  }

  return { sprites, containers };
}

// ─── Extension defence ───────────────────────────────────────────────────────

/**
 * Intercept focus landing outside app-owned elements and redirect it to the
 * first tabbable bench button. Works against any extension regardless of id or
 * class, and handles extensions that inject after load (unlike a one-shot
 * silencing pass). Add new legitimate focusable regions to `isOurs` as needed.
 * See docs/gotchas.md §Browser extension interference.
 */
function guardFocusWithinApp(): void {
  document.addEventListener('focusin', (e) => {
    if (!_lastInputWasKeyboard) return; // pointer-driven focus — never redirect
    const target = e.target as HTMLElement;
    const isOurs =
      target.closest('#landmark-bench') ||
      target.closest('#landmark-table') ||
      target.id === 'bench-strip-handle' ||
      target === document.body;
    if (!isOurs) {
      setTimeout(() => {
        const first = document.querySelector<HTMLButtonElement>(
          '#landmark-bench button[tabindex="0"]',
        );
        first?.focus();
      }, 0);
    }
  });
}

// ─── Scene entry point ────────────────────────────────────────────────────────

export async function loadScene(app: Application, imageUrl: string): Promise<void> {
  const texture = await Assets.load<Texture>(imageUrl);

  // Extract pixel data once — used for both color zone computation and WASM worker
  const { width, height } = texture;
  const offscreen = new OffscreenCanvas(width, height);
  const ctx = offscreen.getContext('2d')!;
  ctx.drawImage(texture.source.resource as CanvasImageSource, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = new Uint8Array(imageData.data.buffer);

  const scale = Math.min(app.screen.width / texture.width, app.screen.height / texture.height);
  const piecePixelW = Math.floor(texture.width  / COLS);
  const piecePixelH = Math.floor(texture.height / ROWS);

  app.stage.sortableChildren = true;
  app.stage.eventMode = 'static';

  // Track last input method — keyboard vs pointer.
  // Used to suppress the focus ring and focus guard on pointer interaction.
  document.addEventListener('keydown',     () => { _lastInputWasKeyboard = true;  }, { capture: true });
  document.addEventListener('pointerdown', () => { _lastInputWasKeyboard = false; }, { capture: true });

  // Remove the canvas from tab order — keyboard navigation uses DOM buttons in
  // #landmark-bench and #landmark-table instead of the raw canvas element.
  (app.canvas as HTMLCanvasElement).tabIndex = -1;

  // ── Viewport (infinite canvas) ─────────────────────────────────────────────
  const viewport = new Viewport({
    screenWidth:  window.innerWidth,
    screenHeight: window.innerHeight,
    worldWidth:   WORLD_SIZE,
    worldHeight:  WORLD_SIZE,
    events: app.renderer.events,
  });
  app.stage.addChild(viewport);

  viewport
    .drag()
    .pinch()
    .wheel()
    .decelerate({ friction: 0.95 }); // DECELERATE_FRICTION_DEFAULT = 0.95 — mirrored in preferences.ts

  // Give preferences.ts a reference to the viewport so applyReducedMotion
  // can adjust the decelerate plugin friction and cancel animate on toggle.
  initPreferencesViewport(viewport);

  viewport.clampZoom({
    minScale: 0.05,
    maxScale: 8.0,
  });

  viewport.sortableChildren = true;

  // ── Piece sprites + containers (added to a temp container first) ────────────
  // buildGridSprites needs a parent — we use a temporary throw-away container.
  // initTray will move the containers into the real tray container.
  const tempParent = new Container();
  const { sprites, containers } = buildGridSprites(tempParent, texture, scale, imageData.data);

  // Convert canonical positions from image-pixel space → world-screen space.
  // Pieces start in tray, but canonical positions are always world-space
  // so that spiral placement and snap logic resolve correctly.
  const pieceScreenW = piecePixelW * scale;
  const pieceScreenH = piecePixelH * scale;
  const boardLeft = (app.screen.width  - texture.width  * scale) / 2;
  const boardTop  = (app.screen.height - texture.height * scale) / 2;
  {
    const { pieces: currentPieces } = usePuzzleStore.getState();
    const worldPieces = currentPieces.map((p) => ({
      ...p,
      canonical: {
        ...p.canonical,
        x: boardLeft + p.canonical.x * scale + pieceScreenW / 2,
        y: boardTop  + p.canonical.y * scale + pieceScreenH / 2,
      },
    }));
    usePuzzleStore.getState().setPieces(worldPieces);
  }

  const pieces = usePuzzleStore.getState().pieces;
  console.log('pieces loaded into tray:', pieces.length);

  const spriteMap = new Map<string, Sprite>();
  sprites.forEach((sprite, i) => spriteMap.set(pieces[i].id, sprite));

  const containerMap = new Map<string, Container>();
  containers.forEach((container, i) => containerMap.set(pieces[i].id, container));

  // ── Drag system ────────────────────────────────────────────────────────────
  // Spatial hash starts empty — pieces in tray are not hashed.
  const hitLayer = createHitLayer(viewport, WORLD_SIZE, WORLD_SIZE);
  initDragListeners(hitLayer, app, spriteMap, viewport);
  setRotateCallback((groupId) => rotateGroup(groupId, spriteMap));
  setSnapCallback((groupId) => checkAndApplySnap(groupId, spriteMap));

  const shadowMap = new Map<string, DropShadowFilter>();

  setDragStartCallback((groupId) => {
    // Clear focus ring immediately on drag start — pointer takes over.
    setFocusedTarget(null); // setFocusedTarget owns the ring clear

    const group = usePuzzleStore.getState().groupsById[groupId];
    if (!group) return;
    for (const pid of group.pieceIds) {
      const f = shadowMap.get(pid);
      if (f) applyShadowDragging(f);
    }
  });

  setDragEndCallback((groupId) => {
    const group = usePuzzleStore.getState().groupsById[groupId];
    if (!group) return;
    for (const pid of group.pieceIds) {
      const f = shadowMap.get(pid);
      if (f) applyShadowResting(f);
    }
  });

  // ── Board snap — shared logic for both drag and keyboard put-down ─────────────
  // Extracted into a named function so checkSnapAtCurrentPosition (keyboard path)
  // reuses the same animation, shadow, completion, and reconciliation logic as drag.

  /** Clear keyboard state when all pieces are placed — puzzle is complete. */
  function reconcileTableState(_heldPieceIdRef: { value: string | null }): void {
    const allPlaced = usePuzzleStore.getState().pieces.every((p) => p.placed);
    if (!allPlaced) return;
    // All pieces placed — puzzle complete. Keyboard cleanup.
    setFocusedTarget(null);
    _heldPieceIdRef.value = null;
  }

  function applyBoardSnap(
    groupId: string,
    heldRef: { value: string | null },
  ): { groupId: string; pieceIds: string[] } | null {
    const result = checkAndApplyBoardSnap(groupId, spriteMap);
    if (result) {
      if (usePuzzleStore.getState().reducedMotion) {
        // Skip pulse entirely — snap pieces to final state immediately
        for (const pid of result.pieceIds) {
          const s = spriteMap.get(pid);
          if (s) { s.scale.set(scale); s.tint = 0xffffff; s.alpha = 1; }
        }
      } else {
        const startTime = performance.now();
        const DURATION_MS = 150;
        // Snapshot HC state at snap time — reads module-level vars set by updateSnapHighlight.
        const pulseColor = _snapHighlightColor;
        const pulseAlpha = _snapHighlightAlpha;
        const tickerFn = () => {
          // Mid-pulse reducedMotion toggle: snap to final state immediately
          if (usePuzzleStore.getState().reducedMotion) {
            for (const pid of result.pieceIds) {
              const s = spriteMap.get(pid);
              if (s) { s.scale.set(scale); s.tint = 0xffffff; s.alpha = 1; }
            }
            app.ticker.remove(tickerFn);
            return;
          }
          const t = Math.min((performance.now() - startTime) / DURATION_MS, 1);
          const pulseFactor = 1 + 0.05 * Math.sin(t * Math.PI);
          for (const pid of result.pieceIds) {
            const s = spriteMap.get(pid);
            if (s) {
              s.scale.set(scale * pulseFactor);
              s.tint  = pulseColor;
              s.alpha = pulseAlpha + (1 - pulseAlpha) * (1 - Math.sin(t * Math.PI));
            }
          }
          if (t >= 1) {
            for (const pid of result.pieceIds) {
              const s = spriteMap.get(pid);
              if (s) { s.scale.set(scale); s.tint = 0xffffff; s.alpha = 1; }
            }
            app.ticker.remove(tickerFn);
          }
        };
        app.ticker.add(tickerFn);
      }

      for (const pid of result.pieceIds) {
        const f = shadowMap.get(pid);
        if (f) applyShadowPlaced(f);
      }

      // Update ARIA labels for all placed pieces (Story 42a: placed → "Placed").
      for (const pid of result.pieceIds) {
        const p = usePuzzleStore.getState().piecesById[pid];
        if (p) updateTableButtonLabel(p);
      }

      const puzzleComplete = usePuzzleStore.getState().puzzleComplete;
      if (puzzleComplete) {
        onComplete(app, hitLayer, usePuzzleStore.getState().pieces.length);
        announce('Puzzle complete');
      } else {
        announce('Placed');
      }

      reconcileTableState(heldRef);
    }
    return result;
  }

  // Dummy held ref for the drag path — drag doesn't manage _heldPieceId.
  const _dragHeldRef = { value: null as string | null };
  setBoardSnapCallback((groupId) => applyBoardSnap(groupId, _dragHeldRef));

  // ── Tray ───────────────────────────────────────────────────────────────────
  // initTray moves all in-tray containers into the tray container, applies
  // tray scale and eventMode, sets up open/close animation and pointer events,
  // and issues the initial viewport.resize to account for the open tray.
  initTray(app, viewport, spriteMap, containerMap, scale, piecePixelW, piecePixelH);
  setTrayLoading(true);

  // ── Focus ring ─────────────────────────────────────────────────────────────
  // Stage layer order: viewport (added above) → benchContainer (added by initTray)
  // → focusRing (added here, last = topmost). Order is non-negotiable.
  // See docs/accessibility.md §9.5 and docs/spike-keyboard-focus.md §3.
  initFocusRing(app, spriteMap);

  // ── Bench keyboard handler registration ───────────────────────────────────
  // Register callbacks that bench buttons call on focus/blur/activate.
  // Must run after initFocusRing (setFocusedPiece uses _focusRing).
  // Must run before initBenchButtons (buttons created below fire these on interaction).
  registerBenchHandlers(
    (id) => { setFocusedPiece(id); scrollBenchToId(id); },
    ()   => setFocusedPiece(null),
    (id) => spiralExtractPiece(id),
  );

  // ── Preferences ───────────────────────────────────────────────────────────
  // 1. Sample image luminance for adaptive background (async; resolves quickly
  //    since the image was already loaded above via PixiJS Assets).
  // 2. Load stored prefs and hydrate Zustand.
  // 3. Register the full apply callback (captures spriteMap + imageLuminance).
  // 4. Apply immediately — bevel filters not yet attached (cuts arrive async);
  //    applyHighContrast runs again in CUTS_COMPLETE once filters exist.
  initPreferencesApp(app);
  const prefs = loadPreferences();
  const imageLuminance = await sampleImageLuminance(imageUrl);
  usePuzzleStore.setState({
    highContrast:     prefs.highContrast,
    greyscale:        prefs.greyscale,
    pieceLabels:      prefs.pieceLabels,
    reducedMotion:    prefs.reducedMotion,
    backgroundPreset: prefs.backgroundPreset,
    imageLuminance,
  });

  registerApplyFn((p) => {
    const { pieces, imageLuminance: lum } = usePuzzleStore.getState();
    applyPreferences(p, pieces, spriteMap, lum);
    applyTrayPreferences();
  });

  applyPreferences(prefs, usePuzzleStore.getState().pieces, spriteMap, imageLuminance);
  applyTrayPreferences();

  // Initialise ARIA landmark structure and bench buttons.
  // spriteMap is fully populated at this point (buildGridSprites ran above).
  // TODO: Story 55 — call initLandmarks() + initBenchButtons() after session restore.
  // Guard against browser extension elements stealing focus.
  // Intercepts at focus time — works against late-injected elements too.
  guardFocusWithinApp();

  initLandmarks();
  initBenchButtons(usePuzzleStore.getState().pieces);
  // Reactive table landmark label — subscribes to store, updates on every piece
  // state change. No manual call sites needed. Call after initLandmarks so
  // _landmarkTable is populated before the first label write.
  initTableLandmarkLabel();
  // Buttons were created in piece-index order (store order). Reorder DOM to match
  // _trayDisplayOrder (the shuffled visual layout order) so Tab follows the grid
  // left→right, top→bottom rather than creation order.
  syncButtonDOMOrder(getTrayDisplayOrder());
  // Wire filter callbacks and create the ARIA radiogroup inside #landmark-bench.
  // Must run after initBenchButtons so piece buttons are already in the DOM
  // (initFilterButtons appends the group after them).
  registerFilterHandlers(
    (id) => applyBenchFilter(id as TrayFilter),
    (dir) => cycleFilter(dir as 1 | -1),
  );
  initFilterButtons(getFilterDefs());

  // ── Table keyboard — pick-up / put-down model ─────────────────────────────
  // Mirrors the bench handler registration pattern. Closures capture app, spriteMap,
  // scale, and the heldRef so all keyboard paths share the same animation logic.

  // Held piece state — local to loadScene closure, shared by all table keyboard fns.
  const _heldRef = { value: null as string | null };

  const LIFT_ROTATION = 0.0175; // 1° in radians — visual lift cue on pick-up

  /** Simple single-sprite rotation tween for keyboard pick-up / put-down. */
  function tweenSpriteRotation(sprite: Sprite, from: number, to: number, ms: number): void {
    if (Math.abs(to - from) < 1e-6) return;
    const start = performance.now();
    const tickerFn = () => {
      if (usePuzzleStore.getState().reducedMotion) {
        sprite.rotation = to;
        app.ticker.remove(tickerFn);
        return;
      }
      const t = Math.min((performance.now() - start) / ms, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      sprite.rotation = from + (to - from) * ease;
      if (t >= 1) app.ticker.remove(tickerFn);
    };
    app.ticker.add(tickerFn);
  }

  /** Snap a radian rotation to the nearest 90° increment. */
  function snapToNearest90(r: number): number {
    return Math.round(r / (Math.PI / 2)) * (Math.PI / 2);
  }

  /** Return all Piece objects currently in a cluster (by clusterId). */
  function getClusterMembers(clusterId: string): ReturnType<typeof usePuzzleStore.getState>['pieces'] {
    const state = usePuzzleStore.getState();
    const group = state.groupsById[clusterId];
    if (!group) return [];
    return group.pieceIds.map((id) => state.piecesById[id]).filter(Boolean) as typeof state.pieces;
  }

  /** Run snap checks (piece-to-piece then board) at the piece's current position. */
  function checkSnapAtCurrentPosition(pieceId: string): void {
    const piece = usePuzzleStore.getState().piecesById[pieceId];
    if (!piece?.clusterId) return;
    let groupId = piece.clusterId;

    // Piece-to-piece snap — may merge the piece into a neighbouring cluster
    const snapResult = checkAndApplySnap(groupId, spriteMap);
    if (snapResult) groupId = snapResult.survivorId;

    // Board snap — may place the group; drives animation, completion, reconciliation
    applyBoardSnap(groupId, _heldRef);
  }

  function pickUp(pieceId: string): void {
    _heldRef.value = pieceId;
    const sprite = spriteMap.get(pieceId);
    if (!sprite) return;

    if (!usePuzzleStore.getState().reducedMotion) {
      tweenSpriteRotation(sprite, sprite.rotation, sprite.rotation + LIFT_ROTATION, 80);
    }

    // Update ARIA label to signal held state (Story 42a: state-only, no metadata)
    const btn = document.querySelector<HTMLButtonElement>(
      `#${LANDMARK_TABLE_ID} [data-piece-id="${pieceId}"]`,
    );
    if (btn) btn.setAttribute('aria-label', 'Held');
    announce('Picked up');
  }

  function putDown(pieceId: string): void {
    _heldRef.value = null;
    const sprite = spriteMap.get(pieceId);
    if (!sprite) return;

    if (!usePuzzleStore.getState().reducedMotion) {
      tweenSpriteRotation(sprite, sprite.rotation, snapToNearest90(sprite.rotation), 80);
    }

    // Run snap checks — may place piece or merge cluster
    checkSnapAtCurrentPosition(pieceId);

    // Restore label from "Held". updateTableButtonLabel is placed-aware:
    // placed → "Placed", cluster primary → "Group of N", else → "Piece".
    // applyBoardSnap also calls updateTableButtonLabel for placed pieces — idempotent.
    const piece = usePuzzleStore.getState().piecesById[pieceId];
    if (piece) updateTableButtonLabel(piece);
  }

  function dropPiece(pieceId: string): void {
    // Escape — drop without snap, return focus to button
    _heldRef.value = null;
    const piece = usePuzzleStore.getState().piecesById[pieceId];
    if (piece) updateTableButtonLabel(piece);
    focusButton(pieceId);
    announce('Dropped');
  }

  registerTableHandlers({
    onFocus: (pieceId) => {
      if (!_lastInputWasKeyboard) return;
      const piece = usePuzzleStore.getState().piecesById[pieceId];
      if (!piece) return;

      if (piece.clusterId) {
        const members = getClusterMembers(piece.clusterId);
        setFocusedTarget({
          kind:            'cluster',
          primaryPieceId:  pieceId,
          memberIds:       members.map((p) => p.id),
        });
      } else {
        setFocusedTarget({ kind: 'piece', pieceId });
      }
    },

    onBlur: () => setFocusedTarget(null),

    onActivate: (pieceId) => {
      if (_heldRef.value === pieceId) {
        putDown(pieceId);
      } else {
        // Drop any other held piece first (safety guard — only one held at a time)
        if (_heldRef.value) putDown(_heldRef.value);
        pickUp(pieceId);
      }
    },

    onEscape: (pieceId) => dropPiece(pieceId),
  });

  // ── T-key hint ─────────────────────────────────────────────────────────────
  // Small fixed overlay hinting the T key mode switch. Hidden until first
  // keyboard interaction — revealed by the { once: true } listener below.
  _tHint?.remove();
  _tHint = document.createElement('div');
  _tHint.style.cssText = [
    'position:fixed',
    'bottom:50px',
    'right:12px',
    'font-size:11px',
    'font-family:monospace',
    'color:#aaaacc',
    'z-index:601',
    'user-select:none',
    'pointer-events:none',
    'display:none',
  ].join(';');
  document.body.appendChild(_tHint);
  document.addEventListener('keydown', () => {
    if (_tHint) _tHint.style.display = 'block';
  }, { once: true });

  // ── Keyboard mode init ────────────────────────────────────────────────────
  // All pieces start in bench — keyboard mode starts as 'bench'.
  // setKeyboardMode derives inert state for both landmarks.
  setKeyboardMode('bench');

  // Bench collapse callback — wired here to avoid circular deps
  // (bench.ts cannot import from scene.ts; scene.ts imports from bench.ts).
  registerBenchCollapseHandler(() => {
    setBenchCollapsed();
    setKeyboardMode('table');
  });

  // AC-4: Initialise snap highlight state from loaded prefs, then subscribe
  // so it stays in sync whenever highContrast or reducedMotion changes.
  // Story 37c: also call applyReducedMotion on reducedMotion toggle so the
  // decelerate friction and any in-flight animate plugin update immediately.
  updateSnapHighlight(prefs.highContrast, prefs.reducedMotion);
  usePuzzleStore.subscribe((state, prev) => {
    if (state.highContrast !== prev.highContrast || state.reducedMotion !== prev.reducedMotion) {
      updateSnapHighlight(state.highContrast, state.reducedMotion);
    }
    if (state.reducedMotion !== prev.reducedMotion) {
      applyReducedMotion(state.reducedMotion);
    }
    if (state.trayOpen !== prev.trayOpen) {
      if (state.trayOpen) {
        if (!_benchCollapsed) setKeyboardMode('bench');
      } else {
        setKeyboardMode('table');
      }
    }
  });

  // ── Board (visible on empty canvas from load) ──────────────────────────────
  const board = createBoard(
    texture.width,
    texture.height,
    COLS,
    ROWS,
    scale,
    app.screen.width,
    app.screen.height,
  );
  viewport.addChild(board);

  // ── Resize handling ────────────────────────────────────────────────────────
  // onTrayResize calls viewport.resize internally (tray-height-adjusted).
  // Listen on both events: window resize fires first but app.screen may lag
  // one frame; renderer 'resize' fires after the renderer has updated screen
  // dimensions, giving correct values for background redraws.
  window.addEventListener('resize', () => onTrayResize(app));
  app.renderer.on('resize', () => onTrayResize(app));

  // ── FPS counter — press F to toggle ───────────────────────────────────────
  let fpsText: Text | null = null;
  let fpsTicker: (() => void) | null = null;

  window.addEventListener('keydown', (e) => {
    // Skip if focus is in a form element (accessibility)
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === 't' || e.key === 'T') {
      // No-op while holding a piece — no side effects, no sound, no state change.
      if (_heldRef.value) return;
      // No-op after permanent bench collapse — bench cannot reopen.
      if (_benchCollapsed) return;
      // No-op when bench has no pieces — treat as collapsed (edge case: all pieces
      // extracted via drag before the collapse callback fired).
      if (!usePuzzleStore.getState().pieces.some(isInBench)) return;
      const _trayCurrentlyOpen = usePuzzleStore.getState().trayOpen;
      setTrayOpen(!_trayCurrentlyOpen);
      announce(_trayCurrentlyOpen ? 'Puzzle table' : 'Piece tray');
      return;
    }
    // R — rotate focused table piece or cluster 90° CW.
    // Works whether piece is held or not. No-op in bench context (bench pieces are
    // not isOnTable, so the isOnTable guard prevents accidental bench rotation).
    if (e.key === 'r' || e.key === 'R') {
      if (!_lastInputWasKeyboard) return;
      if (!_focusTarget) return;
      if (_focusTarget.kind === 'filter') return; // bench context — no rotation
      const focusedPieceId = _focusTarget.kind === 'cluster'
        ? _focusTarget.primaryPieceId
        : _focusTarget.pieceId;
      const focusedPiece = usePuzzleStore.getState().piecesById[focusedPieceId];
      if (!focusedPiece || !isOnTable(focusedPiece) || !focusedPiece.clusterId) return;
      rotateGroup(focusedPiece.clusterId, spriteMap);
      return;
    }
    // [/] — cycle bench filter strip. Works whenever bench is open, regardless of focus.
    // Focus handling (keep/move/jump-to-first) is owned by applyBenchFilter in bench.ts.
    // Arrow keys are reserved for piece movement on the table (future story).
    if (e.key === '[' || e.key === ']') {
      if (!usePuzzleStore.getState().trayOpen) return;
      e.preventDefault();
      cycleFilter(e.key === ']' ? 1 : -1);
      return;
    }
    // Shift+B cycles background presets: off-white → gray → charcoal → off-white
    // Plain B avoided — conflicts with screen reader button navigation
    if (e.key === 'B' && e.shiftKey) {
      const current = usePuzzleStore.getState().backgroundPreset;
      const idx = current ? BG_PRESETS_ORDER.indexOf(current) : -1;
      const next = BG_PRESETS_ORDER[(idx + 1) % BG_PRESETS_ORDER.length];
      usePuzzleStore.getState().setPreference('backgroundPreset', next);
      return;
    }
    if (e.key === 'f' || e.key === 'F') {
      if (fpsText) {
        app.ticker.remove(fpsTicker!);
        app.stage.removeChild(fpsText);
        fpsText.destroy();
        fpsText = null;
        fpsTicker = null;
      } else {
        fpsText = new Text({
          text: 'FPS: --',
          style: { fontSize: 14, fill: 0xff0000, fontFamily: 'monospace' },
        });
        fpsText.position.set(10, 10);
        fpsText.zIndex = 99999;
        app.stage.addChild(fpsText);
        fpsTicker = () => { fpsText!.text = `FPS: ${Math.round(app.ticker.FPS)}`; };
        app.ticker.add(fpsTicker);
      }
    }
  });

  // ── Image analysis + cut generation ───────────────────────────────────────
  // `pixels` extracted from texture at load time (see top of loadScene) — reused here.
  const worker = new AnalysisWorker();

  worker.postMessage({
    type: 'ANALYZE_IMAGE',
    payload: { pixels, width, height },
  } satisfies WorkerMessage<{ pixels: Uint8Array; width: number; height: number }>);

  worker.postMessage({
    type: 'GENERATE_CUTS',
    payload: {
      cols: COLS,
      rows: ROWS,
      pieceWidth:   piecePixelW,
      pieceHeight:  piecePixelH,
      seed:         0x4a_49_47_47,
      edgeInfluence: EDGE_INFLUENCE,
      imageWidth:   width,
      imageHeight:  height,
    },
  } satisfies WorkerMessage<{
    cols: number; rows: number; pieceWidth: number; pieceHeight: number;
    seed: number; edgeInfluence: number; imageWidth: number; imageHeight: number;
  }>);

  worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    if (type === 'CUTS_COMPLETE') {
      const { cuts } = payload as { cuts: CutPath[] };
      const currentPieces = usePuzzleStore.getState().pieces;

      for (const piece of currentPieces) {
        const sprite = spriteMap.get(piece.id);
        if (!sprite) continue;

        if (sprite.mask) {
          const old = sprite.mask as Graphics;
          sprite.removeChild(old);
          old.destroy();
          sprite.mask = null;
        }

        const mask = buildPieceMask(piece, cuts, COLS, ROWS, piecePixelW, piecePixelH);
        mask.roundPixels = true;
        sprite.addChild(mask);
        sprite.mask = mask;

        sprite.filters = [new BevelFilter({
          rotation:    225,
          thickness:   2,
          lightColor:  0xffffff,
          lightAlpha:  0.2,
          shadowColor: 0x000000,
          shadowAlpha: 0.2,
        })];
      }

      console.log(`Cuts applied: ${cuts.length} cut paths, ${currentPieces.length} pieces masked`);

      // Re-apply preferences now that BevelFilters are attached to sprites.
      // highContrast and greyscale need live filter references.
      const { highContrast, greyscale, pieceLabels, reducedMotion, backgroundPreset, imageLuminance: lum } =
        usePuzzleStore.getState();
      applyPreferences(
        { highContrast, greyscale, pieceLabels, reducedMotion, backgroundPreset },
        currentPieces,
        spriteMap,
        lum,
      );

      // Reveal tray pieces now that masks and filters are applied
      setTrayLoading(false);
    }
  });
}

// Temporary debug exposure — remove after audit
;(window as any)._jiggDebug = {
  store:        () => usePuzzleStore.getState(),
  focusTarget:  () => _focusTarget,
  keyboardMode: () => _keyboardMode,
  // Bench DOM order diagnostics:
  //   displayOrder — full shuffled master order (_trayDisplayOrder); what syncButtonDOMOrder
  //                  uses on initial load. Compare against DOM button sequence.
  //   visibleOrder — filtered subset currently shown in bench; what layoutTrayPieces
  //                  passes to syncButtonDOMOrder on every layout.
  displayOrder: () => getTrayDisplayOrder(),
  visibleOrder: () => getVisibleBenchOrder(usePuzzleStore.getState().activeFilter),
};
