/// <reference types="vite/client" />
import { initApp } from './canvas/app';
import { loadScene } from './canvas/scene';
import { activateDrag } from './puzzle/drag';
import { normalizeImage } from './imageNormalize';

const SESSION_KEY = 'jigg:pendingImageUrl';
const TEST_IMAGE_URL = '/test-image.jpg';

const stored = sessionStorage.getItem(SESSION_KEY);
// Blob URLs don't survive page reloads — discard any stale entry.
const imageUrl = stored && !stored.startsWith('blob:') ? stored : TEST_IMAGE_URL;

const container = document.getElementById('app')!;
const app = await initApp(container);
await loadScene(app, imageUrl);

// Enable the hit layer — sprites and drag wiring are set up inside loadScene.
activateDrag();

// Drag-and-drop image replacement (dev tool — no teardown path yet, so reload).
// Stores a data URL (not a blob URL) so it survives the page reload.
container.addEventListener('dragover', (e) => {
  e.preventDefault();
});

container.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (!file || !file.type.startsWith('image/')) return;

  normalizeImage(file).then((dataUrl) => {
    try {
      sessionStorage.setItem(SESSION_KEY, dataUrl);
    } catch {
      // sessionStorage quota exceeded — fall back to test image on reload
      sessionStorage.removeItem(SESSION_KEY);
    }
    window.location.reload();
  }).catch((err) => {
    console.warn('normalizeImage failed:', err);
  });
});
