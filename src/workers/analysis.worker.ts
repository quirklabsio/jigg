/// <reference no-default-lib="true"/>
/// <reference lib="ESNext" />
/// <reference lib="WebWorker" />

import type { WorkerMessage } from '../puzzle/types';
import init, { analyze_image } from '../wasm-pkg/jigg_analysis.js';

// Initialise WASM once; Vite resolves the .wasm asset URL via import.meta.url
// inside the generated jigg_analysis.js glue.
const initPromise = init();

self.addEventListener(
  'message',
  async (event: MessageEvent<{ pixels: Uint8Array; width: number; height: number }>) => {
    await initPromise;

    const { pixels, width, height } = event.data;
    const edgeMap = analyze_image(pixels, width, height);

    const response: WorkerMessage<{ edgeMap: Uint8Array; width: number; height: number }> = {
      type: 'ANALYSIS_COMPLETE',
      payload: { edgeMap, width, height },
    };

    self.postMessage(response, [edgeMap.buffer]);
  },
);
