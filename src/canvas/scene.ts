import { Application, Assets, Rectangle, Sprite, Texture } from 'pixi.js';
import type { WorkerMessage } from '../puzzle/types';
import { gridCut } from '../puzzle/cutter';
import { scatterPieces } from '../puzzle/scatter';
import { usePuzzleStore } from '../store/puzzleStore';
import AnalysisWorker from '../workers/analysis.worker.ts?worker';

const GRID_SIZE = 4;

function buildGridSprites(app: Application, texture: Texture, scale: number): Sprite[] {
  const pieces = gridCut(texture.width, texture.height, GRID_SIZE, GRID_SIZE);
  usePuzzleStore.getState().setPieces(pieces);

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
  const pieces = usePuzzleStore.getState().pieces;
  sprites.forEach((sprite, i) => {
    sprite.position.set(pieces[i].position.x, pieces[i].position.y);
    sprite.rotation = pieces[i].rotation;
  });
}

export async function loadScene(app: Application, imageUrl: string): Promise<void> {
  const texture = await Assets.load<Texture>(imageUrl);

  const scale = Math.min(app.screen.width / texture.width, app.screen.height / texture.height);
  const pieceScreenW = (texture.width / GRID_SIZE) * scale;
  const pieceScreenH = (texture.height / GRID_SIZE) * scale;

  const sprites = buildGridSprites(app, texture, scale);

  scatterPieces(app.screen.width, app.screen.height, pieceScreenW, pieceScreenH);
  applyScatterToSprites(sprites);
  console.log('pieces scattered:', usePuzzleStore.getState().pieces.length);

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
