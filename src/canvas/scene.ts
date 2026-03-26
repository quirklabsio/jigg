import { Application, Assets, Sprite, Texture } from 'pixi.js';
import type { WorkerMessage } from '../puzzle/types';
import AnalysisWorker from '../workers/analysis.worker.ts?worker';

function fitSprite(sprite: Sprite, screenWidth: number, screenHeight: number): void {
  const scale = Math.min(
    screenWidth / sprite.texture.width,
    screenHeight / sprite.texture.height,
  );
  sprite.scale.set(scale);
  sprite.position.set(screenWidth / 2, screenHeight / 2);
}

export async function loadScene(app: Application, imageUrl: string): Promise<void> {
  const texture = await Assets.load<Texture>(imageUrl);
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  fitSprite(sprite, app.screen.width, app.screen.height);
  app.stage.addChild(sprite);

  app.renderer.on('resize', (width: number, height: number) => {
    fitSprite(sprite, width, height);
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
