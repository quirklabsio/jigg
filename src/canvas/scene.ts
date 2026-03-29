import { Application, Assets, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { CutPath, WorkerMessage } from '../puzzle/types';
import { createBoard } from './board';
import { buildPieceMask, gridCut, EDGE_INFLUENCE } from '../puzzle/cutter';
import { scatterPieces } from '../puzzle/scatter';
import { createHitLayer, initDragListeners, setRotateCallback, setSnapCallback, setBoardSnapCallback } from '../puzzle/drag';
import { onComplete } from '../puzzle/completion';
import { rotateGroup } from '../puzzle/rotate';
import { checkAndApplySnap, checkAndApplyBoardSnap } from '../puzzle/snap';
import { usePuzzleStore } from '../store/puzzleStore';
import AnalysisWorker from '../workers/analysis.worker.ts?worker';

const COLS = 4;
const ROWS = 4;

function buildGridSprites(app: Application, texture: Texture, scale: number): Sprite[] {
  const { pieces, groups } = gridCut(texture.width, texture.height, COLS, ROWS);

  const gridIndex = new Map<string, string>();
  pieces.forEach((p) => gridIndex.set(`${p.gridCoord.col},${p.gridCoord.row}`, p.id));

  usePuzzleStore.getState().setPieces(pieces);
  usePuzzleStore.getState().setGroups(groups);
  usePuzzleStore.getState().setGridIndex(gridIndex);

  // Expand each piece's texture frame so tab protrusions have pixel data.
  // Tab height = pieceH * 0.25 ± 15%, so 0.4 * max(pw,ph) covers worst case.
  const pw0 = pieces[0]?.textureRegion.w ?? 1;
  const ph0 = pieces[0]?.textureRegion.h ?? 1;
  const tabPad = Math.ceil(Math.max(pw0, ph0) * 0.4);

  return pieces.map((piece) => {
    const { col, row } = piece.gridCoord;
    const pw = piece.textureRegion.w;
    const ph = piece.textureRegion.h;
    // Clamp padding so we never request pixels outside the source image.
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
    app.stage.addChild(sprite);
    return sprite;
  });
}

function applyScatterToSprites(sprites: Sprite[]): void {
  const { pieces, groups } = usePuzzleStore.getState();
  const groupById = new Map(groups.map((g) => [g.id, g]));
  sprites.forEach((sprite, i) => {
    const piece = pieces[i];
    const group = groupById.get(piece.groupId)!;
    sprite.position.set(
      group.position.x + piece.localPosition.x,
      group.position.y + piece.localPosition.y,
    );
    sprite.rotation = piece.rotation;
  });
}

export async function loadScene(app: Application, imageUrl: string): Promise<void> {
  const texture = await Assets.load<Texture>(imageUrl);

  const scale = Math.min(app.screen.width / texture.width, app.screen.height / texture.height);
  const pieceScreenW = (texture.width / COLS) * scale;
  const pieceScreenH = (texture.height / ROWS) * scale;

  app.stage.sortableChildren = true;
  app.stage.eventMode = 'static';

  const board = createBoard(texture.width, texture.height, COLS, ROWS, scale, app.screen.width, app.screen.height);
  app.stage.addChild(board);

  const sprites = buildGridSprites(app, texture, scale);

  scatterPieces(app.screen.width, app.screen.height, pieceScreenW, pieceScreenH);
  applyScatterToSprites(sprites);

  // Convert correctPositions from image-pixel space → world-screen space.
  // Board is centred: left = (screenW - imageW*scale) / 2, top = (screenH - imageH*scale) / 2.
  // Piece sprites have anchor(0.5), so the correct world centre of each slot is:
  //   boardLeft + correctPosition.x * scale + pieceScreenW / 2
  const boardLeft = (app.screen.width  - texture.width  * scale) / 2;
  const boardTop  = (app.screen.height - texture.height * scale) / 2;
  {
    const { pieces: currentPieces } = usePuzzleStore.getState();
    const worldPieces = currentPieces.map((p) => ({
      ...p,
      correctPosition: {
        x: boardLeft + p.correctPosition.x * scale + pieceScreenW / 2,
        y: boardTop  + p.correctPosition.y * scale + pieceScreenH / 2,
      },
    }));
    usePuzzleStore.getState().setPieces(worldPieces);
  }

  const pieces = usePuzzleStore.getState().pieces;
  console.log('pieces scattered:', pieces.length);

  const spriteMap = new Map<string, Sprite>();
  sprites.forEach((sprite, i) => spriteMap.set(pieces[i].id, sprite));

  sprites.forEach((sprite, i) => {
    sprite.zIndex = i; // unique per piece so topmost selection works before any drag
    sprite.eventMode = 'none'; // permanently non-interactive — hitLayer handles all pointer events
  });

  const hitLayer = createHitLayer(app);
  initDragListeners(hitLayer, app, spriteMap);
  setRotateCallback((groupId) => rotateGroup(groupId, spriteMap));
  setSnapCallback((groupId) => checkAndApplySnap(groupId, spriteMap));
  setBoardSnapCallback((groupId) => {
    const result = checkAndApplyBoardSnap(groupId, spriteMap);
    if (result) {
      // 150ms scale pulse (1.0 → 1.05 → 1.0) + brightness tint (0xffffff → 0xeeeeff → 0xffffff)
      const startTime = performance.now();
      const DURATION_MS = 150;
      const tickerFn = () => {
        const t = Math.min((performance.now() - startTime) / DURATION_MS, 1);
        const pulseFactor = 1 + 0.05 * Math.sin(t * Math.PI);
        // G channel: 255 → 238 → 255 (R and B stay at 255)
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
            if (s) {
              s.scale.set(scale);
              s.tint = 0xffffff;
            }
          }
          app.ticker.remove(tickerFn);
        }
      };
      app.ticker.add(tickerFn);

      if (usePuzzleStore.getState().puzzleComplete) {
        onComplete(app, hitLayer, usePuzzleStore.getState().pieces.length);
      }
    }
    return result;
  });

  const { width, height } = texture;
  const offscreen = new OffscreenCanvas(width, height);
  const ctx = offscreen.getContext('2d')!;
  ctx.drawImage(texture.source.resource as CanvasImageSource, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = new Uint8Array(imageData.data.buffer);

  let edgeOverlay: Sprite | null = null;
  // DEBUG: current edge influence — 1/2/3 keys override this at runtime.
  let currentEdgeInfluence = EDGE_INFLUENCE;

  window.addEventListener('keydown', (e) => {
    if ((e.key === 'e' || e.key === 'E') && edgeOverlay) {
      edgeOverlay.visible = !edgeOverlay.visible;
      return;
    }
    // DEBUG key bindings — rebuild cuts with different edge influence.
    if (e.key === '1') currentEdgeInfluence = 0.0;
    else if (e.key === '2') currentEdgeInfluence = 0.5;
    else if (e.key === '3') currentEdgeInfluence = 1.0;
    else return;
    console.log(`[debug] edge_influence → ${currentEdgeInfluence}`);
    worker.postMessage({
      type: 'GENERATE_CUTS',
      payload: {
        cols: COLS,
        rows: ROWS,
        pieceWidth: piecePixelW,
        pieceHeight: piecePixelH,
        seed: 0x4a_49_47_47,
        edgeInfluence: currentEdgeInfluence,
        imageWidth: width,
        imageHeight: height,
      },
    } satisfies WorkerMessage<{
      cols: number; rows: number; pieceWidth: number; pieceHeight: number;
      seed: number; edgeInfluence: number; imageWidth: number; imageHeight: number;
    }>);
  });

  // Piece pixel dimensions (before scale)
  const piecePixelW = Math.floor(texture.width  / COLS);
  const piecePixelH = Math.floor(texture.height / ROWS);

  const worker = new AnalysisWorker();

  // Send both jobs immediately
  worker.postMessage({
    type: 'ANALYZE_IMAGE',
    payload: { pixels, width, height },
  } satisfies WorkerMessage<{ pixels: Uint8Array; width: number; height: number }>);

  worker.postMessage({
    type: 'GENERATE_CUTS',
    payload: {
      cols: COLS,
      rows: ROWS,
      pieceWidth: piecePixelW,
      pieceHeight: piecePixelH,
      seed: 0x4a_49_47_47, // "JIGG" as u32
      edgeInfluence: currentEdgeInfluence,
      imageWidth: width,
      imageHeight: height,
    },
  } satisfies WorkerMessage<{
    cols: number; rows: number; pieceWidth: number; pieceHeight: number;
    seed: number; edgeInfluence: number; imageWidth: number; imageHeight: number;
  }>);

  worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    if (type === 'ANALYSIS_COMPLETE') {
      const { edgeMap } = payload as { edgeMap: Uint8Array; width: number; height: number };

      // Build RGBA pixel data: edge pixels → cyan, non-edge → transparent
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
      overlayCanvas.width = width;
      overlayCanvas.height = height;
      const overlayCtx = overlayCanvas.getContext('2d')!;
      overlayCtx.putImageData(new ImageData(rgba, width, height), 0, 0);

      const overlayTexture = Texture.from(overlayCanvas);
      edgeOverlay = new Sprite(overlayTexture);
      edgeOverlay.scale.set(scale);
      edgeOverlay.position.set(boardLeft, boardTop);
      edgeOverlay.anchor.set(0, 0);
      edgeOverlay.alpha = 0.6;
      edgeOverlay.zIndex = 999;
      edgeOverlay.visible = false;
      app.stage.addChild(edgeOverlay);

      console.log(`Edge map ready: ${width}x${height}, press E to toggle overlay`);
      return;
    }

    if (type === 'CUTS_COMPLETE') {
      const { cuts } = payload as { cuts: CutPath[] };
      const currentPieces = usePuzzleStore.getState().pieces;

      for (const piece of currentPieces) {
        const sprite = spriteMap.get(piece.id);
        if (!sprite) continue;

        // Clear any existing mask before applying the new one (supports debug rebuild).
        if (sprite.mask) {
          const old = sprite.mask as Graphics;
          sprite.removeChild(old);
          old.destroy();
          sprite.mask = null;
        }

        const mask = buildPieceMask(piece, cuts, COLS, ROWS, piecePixelW, piecePixelH);
        // roundPixels = true: snaps stencil geometry to integer device pixels,
        // eliminating the sub-pixel fringe gap at shared mask boundaries.
        mask.roundPixels = true;
        sprite.addChild(mask);
        sprite.mask = mask;
      }

      console.log(`Cuts applied: ${cuts.length} cut paths, ${currentPieces.length} pieces masked`);
    }
  });
}
