const MAX_DIMENSION = 2048;

export async function normalizeImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

  const { width: origW, height: origH } = bitmap;

  if (Math.max(origW, origH) / Math.min(origW, origH) > 4) {
    console.warn(`normalizeImage: extreme aspect ratio ${origW}×${origH}`);
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(origW, origH));
  const w = Math.round(origW * scale);
  const h = Math.round(origH * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
