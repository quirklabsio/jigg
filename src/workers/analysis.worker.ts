/// <reference no-default-lib="true"/>
/// <reference lib="ESNext" />
/// <reference lib="WebWorker" />

import type { WorkerMessage } from '../puzzle/types';
import init, { analyze_image, generate_cuts } from '../wasm-pkg/jigg_analysis.js';

// Initialise WASM once; Vite resolves the .wasm asset URL via import.meta.url
// inside the generated jigg_analysis.js glue.
const initPromise = init();

self.addEventListener('message', async (event: MessageEvent<WorkerMessage>) => {
  await initPromise;

  const { type, payload } = event.data;

  if (type === 'ANALYZE_IMAGE') {
    const { pixels, width, height } = payload as {
      pixels: Uint8Array;
      width: number;
      height: number;
    };
    const edgeMap = analyze_image(pixels, width, height);
    const response: WorkerMessage<{ edgeMap: Uint8Array; width: number; height: number }> = {
      type: 'ANALYSIS_COMPLETE',
      payload: { edgeMap, width, height },
    };
    self.postMessage(response, [edgeMap.buffer]);
    return;
  }

  if (type === 'GENERATE_CUTS') {
    const { cols, rows, pieceWidth, pieceHeight, seed } = payload as {
      cols: number;
      rows: number;
      pieceWidth: number;
      pieceHeight: number;
      seed: number;
    };
    const json = generate_cuts(cols, rows, pieceWidth, pieceHeight, seed);
    const cuts = JSON.parse(json);
    const response: WorkerMessage<{ cuts: unknown }> = {
      type: 'CUTS_COMPLETE',
      payload: { cuts },
    };
    self.postMessage(response);
  }
});
