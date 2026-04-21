import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';

export default defineConfig({
  resolve: {
    alias: {
      '@jigg-spec': path.resolve(__dirname, './jigg-spec'),
    },
  },
  plugins: [
    {
      // Serve the gitignored qa-scratch/ directory at /qa-scratch/ during dev.
      // These files are never committed and never ship — local QA only.
      name: 'serve-qa-scratch',
      configureServer(server) {
        server.middlewares.use('/qa-scratch', (req, res, next) => {
          const filePath = path.join(__dirname, 'qa-scratch', req.url ?? '');
          if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            return next();
          }
          const ext = path.extname(filePath).toLowerCase();
          const mime: Record<string, string> = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.png': 'image/png',  '.webp': 'image/webp',
            '.gif': 'image/gif',
          };
          res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream');
          fs.createReadStream(filePath).pipe(res as NodeJS.WritableStream);
        });
      },
    },
  ],
});
