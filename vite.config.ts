import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@jigg/spec': new URL('./jigg-spec/types.ts', import.meta.url).pathname,
    },
  },
});
