import { Container, Graphics } from 'pixi.js';
import { DropShadowFilter } from 'pixi-filters';

// Board fill presets — chosen at image-load time; never mutated during a session.
const BOARD_COLOR_LIGHT = 0xf5f5f3; // off-white (matches Story 37a workspace preset)
const BOARD_COLOR_MID   = 0x808080; // mid gray
const BOARD_COLOR_DARK  = 0x2a2a2a; // charcoal (matches Story 37a charcoal preset)

/**
 * Pick one of three board-fill colors from image luminance statistics.
 *
 * Sampling stride of 8 keeps this well under 1ms for a 2048×2048 image while
 * sampling ~65k pixels — more than enough statistical accuracy.
 *
 * Selection rule (WCAG relative luminance):
 *  - spread > 0.60 AND 0.3 < mean < 0.7 → mid  (image spans full range; binary choice sacrifices half the pieces)
 *  - else mean > 0.5                    → dark  (dominant bright image)
 *  - else                               → light (dominant dark image)
 */
export function computeBoardColor(imageData: ImageData): number {
  const { data, width, height } = imageData;
  const stride = 8; // sample every 8th pixel
  let sumL = 0, minL = 1, maxL = 0, count = 0;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      // Linearise sRGB channels
      const r = srgbToLinear(data[i]     / 255);
      const g = srgbToLinear(data[i + 1] / 255);
      const b = srgbToLinear(data[i + 2] / 255);
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sumL += L;
      if (L < minL) minL = L;
      if (L > maxL) maxL = L;
      count++;
    }
  }

  const mean   = count > 0 ? sumL / count : 0.5;
  const spread = maxL - minL;

  if (spread > 0.60 && mean > 0.3 && mean < 0.7) return BOARD_COLOR_MID;
  if (mean > 0.5) return BOARD_COLOR_DARK;
  return BOARD_COLOR_LIGHT;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Create the board card — a rectangle communicating the puzzle area, filled
 * with a system-chosen color derived from the image at load time.
 *
 * A DropShadowFilter on the Container gives it gentle lift off the background.
 * The Container is what gets added to stage; the Graphics is an internal child.
 *
 * zIndex = -1 — always below all piece containers (which start at 0..n-1).
 */
export function createBoard(
  imageWidth:   number,
  imageHeight:  number,
  cols:         number,
  rows:         number,
  scale:        number,
  screenWidth:  number,
  screenHeight: number,
  fillColor:    number,
): Container {
  const pieceW = Math.floor(imageWidth  / cols);
  const pieceH = Math.floor(imageHeight / rows);
  const bw     = pieceW * cols * scale;
  const bh     = pieceH * rows * scale;
  const left = (screenWidth  - bw) / 2;
  const top  = (screenHeight - bh) / 2;

  const g = new Graphics();
  g.rect(left, top, bw, bh);
  g.fill({ color: fillColor });

  const container = new Container();
  container.addChild(g);
  container.zIndex = -1;

  const shadow = new DropShadowFilter({
    offset:     { x: 0, y: 8 },
    blur:       24,
    alpha:      0.06,
    color:      0x000000,
    quality:    3,
    resolution: 1, // DPR causes a pixelated artifact on retina — same fix as piece shadows
  });
  container.filters = [shadow];

  return container;
}
