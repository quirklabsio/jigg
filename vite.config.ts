import { defineConfig } from 'vite';

export default defineConfig({
  worker: {
    // Use iife format so workers run as classic scripts — required for
    // importScripts() which loads the wasm-pack --target no-modules output.
    format: 'iife',
  },
});
