/// <reference types="vite/client" />
import { initApp } from './canvas/app';
import { loadScene } from './canvas/scene';
import { activateDrag } from './puzzle/drag';
import { normalizeImage } from './imageNormalize';
import { CURATED_IMAGES } from './curated/images';

const SESSION_KEY       = 'jigg:pendingImageUrl';
const SESSION_GRID_KEY  = 'jigg:forceGrid';
const TEST_IMAGE_URL    = '/test-image.jpg';

const stored = sessionStorage.getItem(SESSION_KEY);
// Blob URLs don't survive page reloads — discard any stale entry.
const imageUrl = stored && !stored.startsWith('blob:') ? stored : TEST_IMAGE_URL;

const storedGrid = sessionStorage.getItem(SESSION_GRID_KEY);
const forceGrid = storedGrid
  ? (JSON.parse(storedGrid) as { cols: number; rows: number })
  : undefined;

const container = document.getElementById('app')!;
const app = await initApp(container);
await loadScene(app, imageUrl, forceGrid);

// Enable the hit layer — sprites and drag wiring are set up inside loadScene.
activateDrag();

// ── File input (shared by drag-and-drop and "Upload your own…") ───────────
// Pre-created and kept in the DOM so browsers open the picker without delay.
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

// ── Image picker dialog ───────────────────────────────────────────────────
const dialog    = document.getElementById('image-picker-dialog') as HTMLDialogElement;
const grid      = document.getElementById('image-picker-grid')!;
const closeBtn  = document.getElementById('image-picker-close') as HTMLButtonElement;
const uploadBtn = document.getElementById('image-picker-upload') as HTMLButtonElement;
const chooseBtn = document.getElementById('choose-image-btn') as HTMLButtonElement;

// Populate thumbnail grid from CURATED_IMAGES.
CURATED_IMAGES.forEach((img) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'curated-thumb';
  btn.setAttribute('aria-label', img.label);
  if (img.forceGrid) {
    btn.dataset.forceGrid = JSON.stringify(img.forceGrid);
  }

  const thumbnail = document.createElement('img');
  thumbnail.src = img.src;
  thumbnail.alt = '';
  thumbnail.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.textContent = img.label;

  btn.appendChild(thumbnail);
  btn.appendChild(label);
  btn.addEventListener('click', () => {
    const fg = btn.dataset.forceGrid
      ? (JSON.parse(btn.dataset.forceGrid) as { cols: number; rows: number })
      : undefined;
    loadImageUrl(img.src, fg);
  });
  grid.appendChild(btn);
});

// Arrow-key navigation within the thumbnail grid.
grid.addEventListener('keydown', (e) => {
  const thumbs = Array.from(grid.querySelectorAll<HTMLButtonElement>('.curated-thumb'));
  const idx = thumbs.indexOf(document.activeElement as HTMLButtonElement);
  if (idx === -1) return;
  const cols = 3;
  let next = -1;
  if (e.key === 'ArrowRight') next = Math.min(idx + 1, thumbs.length - 1);
  if (e.key === 'ArrowLeft')  next = Math.max(idx - 1, 0);
  if (e.key === 'ArrowDown')  next = Math.min(idx + cols, thumbs.length - 1);
  if (e.key === 'ArrowUp')    next = Math.max(idx - cols, 0);
  if (next !== -1) {
    e.preventDefault();
    thumbs[next].focus();
  }
});

function openPicker(): void {
  dialog.showModal();
  // Move focus to first thumbnail.
  const first = grid.querySelector<HTMLButtonElement>('.curated-thumb');
  first?.focus();
}

function closePicker(): void {
  dialog.close();
  chooseBtn.focus();
}

chooseBtn.addEventListener('click', openPicker);
closeBtn.addEventListener('click', closePicker);
uploadBtn.addEventListener('click', () => {
  closePicker();
  fileInput.click();
});

// Close on Escape (browser handles this for <dialog>, but we need focus return).
dialog.addEventListener('cancel', (e) => {
  e.preventDefault();
  closePicker();
});

// Close on backdrop click (click outside the dialog content).
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) closePicker();
});

// Focus trap: Tab/Shift+Tab within dialog.
dialog.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>('button:not([disabled])'),
  ).filter(el => el.offsetParent !== null);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
  } else {
    if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
  }
});

// ── Drag-and-drop image replacement ──────────────────────────────────────
container.addEventListener('dragover', (e) => {
  e.preventDefault();
});

container.addEventListener('drop', (e) => {
  e.preventDefault();

  const file = e.dataTransfer?.files[0];
  if (file && file.type.startsWith('image/')) {
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

// ── Image load helpers ────────────────────────────────────────────────────

function loadImageUrl(url: string, fg?: { cols: number; rows: number }): void {
  try {
    sessionStorage.setItem(SESSION_KEY, url);
    if (fg) {
      sessionStorage.setItem(SESSION_GRID_KEY, JSON.stringify(fg));
    } else {
      sessionStorage.removeItem(SESSION_GRID_KEY);
    }
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_GRID_KEY);
  }
  window.location.reload();
}

function handleImageFile(file: File): void {
  normalizeImage(file).then((dataUrl) => {
    try {
      sessionStorage.setItem(SESSION_KEY, dataUrl);
      sessionStorage.removeItem(SESSION_GRID_KEY);
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_GRID_KEY);
    }
    window.location.reload();
  }).catch((err) => {
    console.warn('normalizeImage failed:', err);
  });
}
