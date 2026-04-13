import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@jigg-spec': path.resolve(__dirname, './jigg-spec'),
    },
  },
});
