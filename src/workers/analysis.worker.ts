/// <reference no-default-lib="true"/>
/// <reference lib="ESNext" />
/// <reference lib="WebWorker" />

import type { WorkerMessage } from '../puzzle/types';

// wasm-pack --target no-modules sets self.wasm_bindgen to an async init function
// with the exported WASM functions attached as properties after initialisation.
declare const wasm_bindgen: {
  (wasmPath: string): Promise<void>;
  analyze_image(pixels: Uint8Array, width: number, height: number): number;
};

// Load the wasm-pack no-modules glue script. Must be built first via:
//   npm run wasm:build
// which copies pkg/jigg_analysis.js and pkg/jigg_analysis_bg.wasm → public/wasm/
importScripts('/wasm/jigg_analysis.js');

const initPromise = wasm_bindgen('/wasm/jigg_analysis_bg.wasm');

self.addEventListener(
  'message',
  async (event: MessageEvent<{ pixels: Uint8Array; width: number; height: number }>) => {
    await initPromise;

    const { pixels, width, height } = event.data;
    const pixelCount = wasm_bindgen.analyze_image(pixels, width, height);

    const response: WorkerMessage<{ pixelCount: number }> = {
      type: 'ANALYSIS_COMPLETE',
      payload: { pixelCount },
    };

    self.postMessage(response);
  },
);
