/**
 * Sample the perceived luminance of an image via a 1×1 offscreen canvas.
 *
 * CORS note:
 * - Static/curated assets: no CORS risk.
 * - Local file picker uploads: no CORS risk.
 * - Future URL import: may hit non-CORS sources — try/catch returns 128 silently.
 *
 * Returns 128 (neutral mid-gray) on any failure — never throws.
 */
export async function sampleImageLuminance(imageUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width  = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        // Perceived luminance (ITU-R BT.601)
        resolve(0.299 * r + 0.587 * g + 0.114 * b);
      } catch {
        resolve(128);
      }
    };
    img.onerror = () => resolve(128);
    img.src = imageUrl;
  });
}
