/// <reference types="vite/client" />
import AnalysisWorker from './workers/analysis.worker.ts?worker';
import type { WorkerMessage } from './puzzle/types';

// STORY 1 TEST — verify end-to-end WASM pipeline via Web Worker
const worker = new AnalysisWorker();

worker.addEventListener(
  'message',
  (event: MessageEvent<WorkerMessage<{ pixelCount: number }>>) => {
    const { type, payload } = event.data;
    if (type === 'ANALYSIS_COMPLETE') {
      console.log(`WASM pipeline OK: ${payload.pixelCount}`);
    }
  },
);

// Create a 10×10 white ImageData (10 × 10 × 4 RGBA bytes = 400)
const canvas = new OffscreenCanvas(10, 10);
const ctx = canvas.getContext('2d')!;
ctx.fillStyle = 'white';
ctx.fillRect(0, 0, 10, 10);
const imageData = ctx.getImageData(0, 0, 10, 10);

worker.postMessage({
  pixels: new Uint8Array(imageData.data.buffer),
  width: imageData.width,
  height: imageData.height,
});
// END STORY 1 TEST
