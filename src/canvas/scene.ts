import { Application, Assets, Rectangle, Sprite, Texture } from 'pixi.js';
import type { WorkerMessage } from '../puzzle/types';
import { gridCut } from '../puzzle/cutter';
import { usePuzzleStore } from '../store/puzzleStore';
import AnalysisWorker from '../workers/analysis.worker.ts?worker';

const GRID_SIZE = 4;

function buildGridSprites(app: Application, texture: Texture, scale: number, offsetX: number, offsetY: number): Sprite[] {
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
    sprite.position.set(
      offsetX + piece.position.x * scale,
      offsetY + piece.position.y * scale,
    );
    sprite.scale.set(scale);
    app.stage.addChild(sprite);
    return sprite;
  });
}

function getScaleAndOffset(texture: Texture, screenWidth: number, screenHeight: number): { scale: number; offsetX: number; offsetY: number } {
  const scale = Math.min(screenWidth / texture.width, screenHeight / texture.height);
  const offsetX = (screenWidth - texture.width * scale) / 2;
  const offsetY = (screenHeight - texture.height * scale) / 2;
  return { scale, offsetX, offsetY };
}

function repositionSprites(sprites: Sprite[], texture: Texture, screenWidth: number, screenHeight: number): void {
  const { scale, offsetX, offsetY } = getScaleAndOffset(texture, screenWidth, screenHeight);
  const pieces = usePuzzleStore.getState().pieces;
  sprites.forEach((sprite, i) => {
    sprite.scale.set(scale);
    sprite.position.set(
      offsetX + pieces[i].position.x * scale,
      offsetY + pieces[i].position.y * scale,
    );
  });
}

export async function loadScene(app: Application, imageUrl: string): Promise<void> {
  const texture = await Assets.load<Texture>(imageUrl);

  const { scale, offsetX, offsetY } = getScaleAndOffset(texture, app.screen.width, app.screen.height);
  const sprites = buildGridSprites(app, texture, scale, offsetX, offsetY);
  console.log('pieces created:', usePuzzleStore.getState().pieces.length); // should log: pieces created: 16

  app.renderer.on('resize', (width: number, height: number) => {
    repositionSprites(sprites, texture, width, height);
  });

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
