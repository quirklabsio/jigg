import { Application, Assets, Rectangle, Sprite, Texture } from 'pixi.js';
import type { WorkerMessage } from '../puzzle/types';
import { createBoard } from './board';
import { gridCut } from '../puzzle/cutter';
import { scatterPieces } from '../puzzle/scatter';
import { createHitLayer, initDragListeners, setRotateCallback, setSnapCallback } from '../puzzle/drag';
import { rotateGroup } from '../puzzle/rotate';
import { checkAndApplySnap } from '../puzzle/snap';
import { usePuzzleStore } from '../store/puzzleStore';
import AnalysisWorker from '../workers/analysis.worker.ts?worker';

const GRID_SIZE = 4;

function buildGridSprites(app: Application, texture: Texture, scale: number): Sprite[] {
  const { pieces, groups } = gridCut(texture.width, texture.height, GRID_SIZE, GRID_SIZE);

  const gridIndex = new Map<string, string>();
  pieces.forEach((p) => gridIndex.set(`${p.gridCoord.col},${p.gridCoord.row}`, p.id));

  usePuzzleStore.getState().setPieces(pieces);
  usePuzzleStore.getState().setGroups(groups);
  usePuzzleStore.getState().setGridIndex(gridIndex);

  return pieces.map((piece) => {
    const frame = new Rectangle(
      piece.textureRegion.x,
      piece.textureRegion.y,
      piece.textureRegion.w,
      piece.textureRegion.h,
    );
    const pieceTexture = new Texture({ source: texture.source, frame });
    const sprite = new Sprite(pieceTexture);
    sprite.scale.set(scale);
    sprite.anchor.set(0.5);
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
  const pieceScreenW = (texture.width / GRID_SIZE) * scale;
  const pieceScreenH = (texture.height / GRID_SIZE) * scale;

  app.stage.sortableChildren = true;
  app.stage.eventMode = 'static';

  const board = createBoard(texture.width, texture.height, GRID_SIZE, GRID_SIZE, scale, app.screen.width, app.screen.height);
  app.stage.addChild(board);

  const sprites = buildGridSprites(app, texture, scale);

  scatterPieces(app.screen.width, app.screen.height, pieceScreenW, pieceScreenH);
  applyScatterToSprites(sprites);

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

  const { width, height } = texture;
  const offscreen = new OffscreenCanvas(width, height);
  const ctx = offscreen.getContext('2d')!;
  ctx.drawImage(texture.source.resource as CanvasImageSource, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = new Uint8Array(imageData.data.buffer);

  const worker = new AnalysisWorker();
  worker.postMessage({ pixels, width, height });
  worker.addEventListener('message', (event: MessageEvent<WorkerMessage<{ pixelCount: number }>>) => {
    const { type, payload } = event.data;
    if (type === 'ANALYSIS_COMPLETE') {
      console.log(`Pipeline connected: ${width}x${height}, ${payload.pixelCount} pixels`);
      worker.terminate();
    }
  });
}
