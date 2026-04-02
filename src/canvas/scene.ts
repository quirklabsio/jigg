import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { BevelFilter, DropShadowFilter } from 'pixi-filters';
import { Viewport } from 'pixi-viewport';
import type { CutPath, WorkerMessage } from '../puzzle/types';
import { createBoard } from './board';
import { buildPieceMask, gridCut, EDGE_INFLUENCE } from '../puzzle/cutter';
import { scatterPieces } from '../puzzle/scatter';
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
import AnalysisWorker from '../workers/analysis.worker.ts?worker';

const COLS = 4;
const ROWS = 4;
const WORLD_SIZE = 4000;

// ─── Shadow state helpers (mutate one persistent filter per piece) ────────────

// resolution: devicePixelRatio ensures the filter renders at device resolution,
// preventing pixelated piece edges on retina/HiDPI displays.
const DPR = window.devicePixelRatio ?? 1;

function makeShadow(): DropShadowFilter {
  const f = new DropShadowFilter({
    offset:     { x: 0, y: 3 },
    blur:       8,
    alpha:      0.06,
    color:      0x000000,
    quality:    3,
    resolution: 1, // DPR causes a thin vertical seam artifact on retina — shadows are blurry by nature so 1x is fine
  });
  f.padding = 24; // use dragging padding (largest) to avoid clipping in any state
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

function buildGridSprites(
  parent: Container,
  texture: Texture,
  scale: number,
): { sprites: Sprite[]; containers: Container[] } {
  // Expand each piece's texture frame so tab protrusions have pixel data.
  // Tab height = pieceH * 0.25 ± 15%, so 0.4 * max(pw,ph) covers worst case.
  const tabPad = Math.ceil(Math.max(
    Math.floor(texture.width  / COLS),
    Math.floor(texture.height / ROWS),
  ) * 0.4);
  const { pieces, groups } = gridCut(texture.width, texture.height, COLS, ROWS);

  const gridIndex = new Map<string, string>();
  pieces.forEach((p) => gridIndex.set(`${p.gridCoord.col},${p.gridCoord.row}`, p.id));

  usePuzzleStore.getState().setPieces(pieces);
  usePuzzleStore.getState().setGroups(groups);
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
    // Anchor at piece centre within the expanded frame so sprite.x/y stays
    // at the piece centre and the mask (drawn relative to piece centre) aligns.
    sprite.anchor.set(
      (leftPad + pw / 2) / expandedW,
      (topPad + ph / 2) / expandedH,
    );
    // Wrap sprite in a Container so filters on the container see the correctly
    // masked jigsaw-shaped sprite rather than the full rectangle. (See gotchas.md)
    const container = new Container();
    container.addChild(sprite);
    parent.addChild(container);
    sprites.push(sprite);
    containers.push(container);
  }

  return { sprites, containers };
}

function applyScatterToSprites(sprites: Sprite[]): void {
  const { pieces, groups } = usePuzzleStore.getState();
  const groupById = new Map(groups.map((g) => [g.id, g]));
  sprites.forEach((sprite, i) => {
    const piece = pieces[i];
    const group = groupById.get(piece.groupId!)!;
    sprite.position.set(
      group.position.x + piece.actual.x,
      group.position.y + piece.actual.y,
    );
    sprite.rotation = piece.actual.rotation;
  });
}

// ─── Scene entry point ────────────────────────────────────────────────────────

export async function loadScene(app: Application, imageUrl: string): Promise<void> {
  const texture = await Assets.load<Texture>(imageUrl);

  const scale = Math.min(app.screen.width / texture.width, app.screen.height / texture.height);
  const pieceScreenW = (texture.width / COLS) * scale;
  const pieceScreenH = (texture.height / ROWS) * scale;

  app.stage.sortableChildren = true;
  app.stage.eventMode = 'static';

  // ── Viewport (infinite canvas) ─────────────────────────────────────────────
  const viewport = new Viewport({
    screenWidth: window.innerWidth,
    screenHeight: window.innerHeight,
    worldWidth: WORLD_SIZE,
    worldHeight: WORLD_SIZE,
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

  // Resize viewport when window resizes (renderer resize handled by resizeTo: window)
  window.addEventListener('resize', () => {
    viewport.resize(window.innerWidth, window.innerHeight);
  });

  // Background: handled entirely by the WebGL clear colour in app.ts
  // (background: '#f5f5f3'). A Graphics rect produced a thin triangle-seam
  // artifact on retina/HiDPI displays — removing it eliminates the line.

  // ── Piece sprites + containers ─────────────────────────────────────────────
  const { sprites, containers } = buildGridSprites(viewport, texture, scale);

  scatterPieces(app.screen.width, app.screen.height, pieceScreenW, pieceScreenH);
  applyScatterToSprites(sprites);

  // Convert canonical positions from image-pixel space → world-screen space.
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
  console.log('pieces scattered:', pieces.length);

  const spriteMap = new Map<string, Sprite>();
  sprites.forEach((sprite, i) => spriteMap.set(pieces[i].id, sprite));

  const containerMap = new Map<string, Container>();
  containers.forEach((container, i) => containerMap.set(pieces[i].id, container));

  sprites.forEach((sprite) => {
    sprite.eventMode = 'none';
  });
  containers.forEach((container, i) => {
    container.zIndex = i;
  });

  // ── Drag system ────────────────────────────────────────────────────────────
  const hitLayer = createHitLayer(viewport, WORLD_SIZE, WORLD_SIZE);
  initDragListeners(hitLayer, app, spriteMap, viewport);
  setRotateCallback((groupId) => rotateGroup(groupId, spriteMap));
  setSnapCallback((groupId) => checkAndApplySnap(groupId, spriteMap));

  // Persistent shadow filter per container — mutated in place (never replaced).
  // Replacing `c.filters = [new DropShadowFilter()]` each state change caused
  // some pieces to disappear mid-drag (PixiJS filter teardown/setup rendering gap).
  const shadowMap = new Map<string, DropShadowFilter>();

  // Shadow state: dragging
  setDragStartCallback((groupId) => {
    const group = usePuzzleStore.getState().groupsById[groupId];
    if (!group) return;
    for (const pid of group.pieceIds) {
      const f = shadowMap.get(pid);
      if (f) applyShadowDragging(f);
    }
  });

  // Shadow state: resting (reverted on drop; board-snap overrides to placed)
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
      // Scale pulse + tint flash
      const startTime = performance.now();
      const DURATION_MS = 150;
      const tickerFn = () => {
        const t = Math.min((performance.now() - startTime) / DURATION_MS, 1);
        const pulseFactor = 1 + 0.05 * Math.sin(t * Math.PI);
        const gChannel = Math.round(255 - 17 * Math.sin(t * Math.PI));
        const tint = (0xff << 16) | (gChannel << 8) | 0xff;
        for (const pid of result.pieceIds) {
          const s = spriteMap.get(pid);
          if (s) {
            s.scale.set(scale * pulseFactor);
            s.tint = tint;
          }
        }
        if (t >= 1) {
          for (const pid of result.pieceIds) {
            const s = spriteMap.get(pid);
            if (s) { s.scale.set(scale); s.tint = 0xffffff; }
          }
          app.ticker.remove(tickerFn);
        }
      };
      app.ticker.add(tickerFn);

      // Shadow state: placed (small, tight)
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

  // ── Image analysis + cut generation ───────────────────────────────────────
  const { width, height } = texture;
  const offscreen = new OffscreenCanvas(width, height);
  const ctx = offscreen.getContext('2d')!;
  ctx.drawImage(texture.source.resource as CanvasImageSource, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = new Uint8Array(imageData.data.buffer);

  let edgeOverlay: Sprite | null = null;

  // ── FPS counter — press F to toggle ───────────────────────────────────────
  let fpsText: Text | null = null;
  let fpsTicker: (() => void) | null = null;

  window.addEventListener('keydown', (e) => {
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
    if ((e.key === 'e' || e.key === 'E') && edgeOverlay) {
      edgeOverlay.visible = !edgeOverlay.visible;
    }
  });

  const piecePixelW = Math.floor(texture.width  / COLS);
  const piecePixelH = Math.floor(texture.height / ROWS);

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

    if (type === 'ANALYSIS_COMPLETE') {
      const { edgeMap } = payload as { edgeMap: Uint8Array; width: number; height: number };

      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        if (edgeMap[i] === 255) {
          rgba[i * 4 + 0] = 0;
          rgba[i * 4 + 1] = 255;
          rgba[i * 4 + 2] = 255;
          rgba[i * 4 + 3] = 255;
        }
      }

      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.width  = width;
      overlayCanvas.height = height;
      const overlayCtx = overlayCanvas.getContext('2d')!;
      overlayCtx.putImageData(new ImageData(rgba, width, height), 0, 0);

      const overlayTexture = Texture.from(overlayCanvas);
      edgeOverlay = new Sprite(overlayTexture);
      edgeOverlay.scale.set(scale);
      edgeOverlay.position.set(boardLeft, boardTop);
      edgeOverlay.anchor.set(0, 0);
      edgeOverlay.alpha   = 0.6;
      edgeOverlay.zIndex  = 999;
      edgeOverlay.visible = false;
      viewport.addChild(edgeOverlay);

      console.log(`Edge map ready: ${width}x${height}, press E to toggle overlay`);
      return;
    }

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

        // BevelFilter on sprite: subtle edge lighting.
        sprite.filters = [new BevelFilter({
          rotation:    225,
          thickness:   2,
          lightColor:  0xffffff,
          lightAlpha:  0.2,
          shadowColor: 0x000000,
          shadowAlpha: 0.2,
        })];

        // DropShadowFilter disabled — too subtle to notice, and resolution:DPR
        // causes a retina texture seam artifact. Revisit if we want stronger shadows.
        // const container = containerMap.get(piece.id);
        // if (container) {
        //   const shadow = makeShadow();
        //   shadowMap.set(piece.id, shadow);
        //   container.filters = [shadow];
        // }
      }

      console.log(`Cuts applied: ${cuts.length} cut paths, ${currentPieces.length} pieces masked`);
    }
  });
}
