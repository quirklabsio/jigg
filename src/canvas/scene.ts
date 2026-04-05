import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { BevelFilter, DropShadowFilter } from 'pixi-filters';
import { Viewport } from 'pixi-viewport';
import type { CutPath, WorkerMessage } from '../puzzle/types';
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
import { usePuzzleStore } from '../store/puzzleStore';
import { initTray, onTrayResize, setTrayOpen, applyTrayPreferences, setTrayLoading } from './tray';
import AnalysisWorker from '../workers/analysis.worker.ts?worker';
import { sampleImageLuminance } from '../utils/luminance';
import { initAriaLabels } from '../utils/aria';
import {
  loadPreferences,
  applyPreferences,
  initPreferencesApp,
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
    .decelerate({ friction: 0.95 });

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

  setBoardSnapCallback((groupId) => {
    const result = checkAndApplyBoardSnap(groupId, spriteMap);
    if (result) {
      const startTime = performance.now();
      const DURATION_MS = 150;
      // Snapshot HC state at snap time — reads module-level vars set by updateSnapHighlight.
      const pulseColor = _snapHighlightColor;
      const pulseAlpha = _snapHighlightAlpha;
      const tickerFn = () => {
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

      for (const pid of result.pieceIds) {
        const f = shadowMap.get(pid);
        if (f) applyShadowPlaced(f);
      }

      if (usePuzzleStore.getState().puzzleComplete) {
        onComplete(app, hitLayer, usePuzzleStore.getState().pieces.length);
      }
    }
    return result;
  });

  // ── Tray ───────────────────────────────────────────────────────────────────
  // initTray moves all in-tray containers into the tray container, applies
  // tray scale and eventMode, sets up open/close animation and pointer events,
  // and issues the initial viewport.resize to account for the open tray.
  initTray(app, viewport, spriteMap, containerMap, scale, piecePixelW, piecePixelH);
  setTrayLoading(true);

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
  initAriaLabels(usePuzzleStore.getState().pieces);

  // AC-4: Initialise snap highlight state from loaded prefs, then subscribe
  // so it stays in sync whenever highContrast or reducedMotion changes.
  updateSnapHighlight(prefs.highContrast, prefs.reducedMotion);
  usePuzzleStore.subscribe((state, prev) => {
    if (state.highContrast !== prev.highContrast || state.reducedMotion !== prev.reducedMotion) {
      updateSnapHighlight(state.highContrast, state.reducedMotion);
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
      setTrayOpen(!usePuzzleStore.getState().trayOpen);
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
