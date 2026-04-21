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

// "Choose Image" button — opens native file picker, feeds same pipeline as drag-and-drop.
// Input is pre-created and kept in the DOM so browsers open the picker without delay.
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = 'image/*';
fileInput.style.display = 'none';
document.body.appendChild(fileInput);
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file && file.type.startsWith('image/')) {
    handleImageFile(file);
  }
  fileInput.value = ''; // reset so the same file can be picked again
});
const chooseBtn = document.getElementById('choose-image-btn') as HTMLButtonElement;
chooseBtn.addEventListener('click', () => fileInput.click());

// Drag-and-drop image replacement (dev tool — no teardown path yet, so reload).
// Stores a data URL (not a blob URL) so it survives the page reload.
container.addEventListener('dragover', (e) => {
  e.preventDefault();
});

container.addEventListener('drop', (e) => {
  e.preventDefault();

  const file = e.dataTransfer?.files[0];
  if (file && file.type.startsWith('image/')) {
    // File dropped from OS file manager
    handleImageFile(file);
    return;
  }

  // Image dragged from another browser tab (e.g. test-picker.html) — arrives as a URL.
  const uriList = e.dataTransfer?.getData('text/uri-list') ?? '';
  const url = uriList.split('\n').map(u => u.trim()).find(u => u && !u.startsWith('#'));
  if (url) {
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.blob(); })
      .then(blob => new File([blob], url.split('/').pop() ?? 'image', { type: blob.type || 'image/jpeg' }))
      .then(f => handleImageFile(f))
      .catch(err => console.warn('URL drop failed:', err));
  }
});

function handleImageFile(file: File): void {
  normalizeImage(file).then((dataUrl) => {
    try {
      sessionStorage.setItem(SESSION_KEY, dataUrl);
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
    window.location.reload();
  }).catch((err) => {
    console.warn('normalizeImage failed:', err);
  });
}
