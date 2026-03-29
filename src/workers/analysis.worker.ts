/// <reference no-default-lib="true"/>
/// <reference lib="ESNext" />
/// <reference lib="WebWorker" />

import type { WorkerMessage } from '../puzzle/types';
import init, { analyze_image, generate_cuts } from '../wasm-pkg/jigg_analysis.js';

// Initialise WASM once; Vite resolves the .wasm asset URL via import.meta.url
// inside the generated jigg_analysis.js glue.
const initPromise = init();

// Edge map stored after ANALYZE_IMAGE so GENERATE_CUTS can reuse it without
// re-running Canny.  A copy is kept here; the original buffer is transferred
// to the main thread via postMessage so it has zero-copy access.
let storedEdgeMap: Uint8Array = new Uint8Array(0);
let storedImageWidth = 0;
let storedImageHeight = 0;

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
    // Keep a copy before the buffer is transferred to the main thread.
    storedEdgeMap = edgeMap.slice();
    storedImageWidth = width;
    storedImageHeight = height;
    const response: WorkerMessage<{ edgeMap: Uint8Array; width: number; height: number }> = {
      type: 'ANALYSIS_COMPLETE',
      payload: { edgeMap, width, height },
    };
    self.postMessage(response, [edgeMap.buffer]);
    return;
  }

  if (type === 'GENERATE_CUTS') {
    const { cols, rows, pieceWidth, pieceHeight, seed, edgeInfluence } = payload as {
      cols: number;
      rows: number;
      pieceWidth: number;
      pieceHeight: number;
      seed: number;
      edgeInfluence: number;
    };
    const json = generate_cuts(
      cols, rows, pieceWidth, pieceHeight, seed,
      storedEdgeMap, storedImageWidth, storedImageHeight,
      edgeInfluence,
    );
    const cuts = JSON.parse(json);
    const response: WorkerMessage<{ cuts: unknown }> = {
      type: 'CUTS_COMPLETE',
      payload: { cuts },
    };
    self.postMessage(response);
  }
});
