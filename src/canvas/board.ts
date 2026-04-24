import { Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';

// Board fill presets — chosen at image-load time; never mutated during a session.
const BOARD_COLOR_LIGHT = 0xf5f5f3; // off-white (matches Story 37a workspace preset)
const BOARD_COLOR_MID   = 0x808080; // mid gray
const BOARD_COLOR_DARK  = 0x2a2a2a; // charcoal (matches Story 37a charcoal preset)

// Mesa depth — how far the edge layer is offset from the surface.
// The eye reads these pixel offsets as physical thickness instantly, with zero GPU cost.
const DEPTH_X = 5;  // right-wall thickness (px)
const DEPTH_Y = 7;  // bottom-wall thickness (px)

// Contact shadow — two disagreeing layers create directional bias without gradients.
//
// Layer interference logic:
//   top-left  → layers overlap less → lighter  (near light source)
//   bottom-right → layers stack     → darker   (weight + occlusion)
//
// Layer 1 — base anchor: slight downward nudge, general grounding
const S1_OFFSET_X = -1;  const S1_OFFSET_Y = 2;  const S1_ALPHA = 0.12;
// Layer 2 — directional bias: pushed further right+down, creates the weight differential
const S2_OFFSET_X =  1;  const S2_OFFSET_Y = 4;  const S2_ALPHA = 0.10;
// Layer 3 — contact pinning: tight dark strip right at the base
const S3_OFFSET_X =  0;  const S3_OFFSET_Y = 3;  const S3_ALPHA = 0.18;

// Highlight — resolution-aware 1 physical-pixel line on top + left edges.
// Simulates overhead light catching the rim. Must divide by DPR or it's 2px on retina.
const DPR      = window.devicePixelRatio || 1;
const HL_WIDTH = 1 / DPR;
const HL_ALPHA = 0.12;

// Noise — grayscale grain tiled over the surface at barely-visible alpha.
// Gives the board a material feel (felt / slate / MDF) vs. dead-flat digital.
const NOISE_ALPHA = 0.06;
const NOISE_SIZE  = 128; // px — small enough to be invisible as a pattern

// Center glow — radial light bias so the surface reads as a body, not just a fill.
// Applied per-puzzle (size varies); canvas created fresh each load, cheap enough.
const GLOW_ALPHA = 1.0; // full — gradient itself encodes opacity

let _noiseTexture: Texture | null = null;
function noiseTexture(): Texture {
  if (_noiseTexture) return _noiseTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = NOISE_SIZE;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(NOISE_SIZE, NOISE_SIZE);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(Math.random() * 256);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  _noiseTexture = Texture.from(canvas);
  return _noiseTexture;
}

/** Radial center-light texture — sized to the board face, not cached (size varies per puzzle). */
function centerGlowTexture(w: number, h: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width  = Math.ceil(w);
  canvas.height = Math.ceil(h);
  const ctx = canvas.getContext('2d')!;
  const cx = w / 2, cy = h / 2;
  const r  = Math.hypot(cx, cy) * 0.85;
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grd.addColorStop(0,    'rgba(255,255,255,0.018)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.006)');
  grd.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return Texture.from(canvas);
}

/**
 * Pick one of three board-fill colors from image luminance statistics.
 *
 * Sampling stride of 8 keeps this well under 1ms for a 2048×2048 image while
 * sampling ~65k pixels — more than enough statistical accuracy.
 *
 * Selection rule (WCAG relative luminance):
 *  - spread > 0.60 AND 0.3 < mean < 0.7 → mid  (image spans full range)
 *  - else mean > 0.5                    → dark  (dominant bright image)
 *  - else                               → light (dominant dark image)
 */
export function computeBoardColor(imageData: ImageData): number {
  const { data, width, height } = imageData;
  const stride = 8;
  let sumL = 0, minL = 1, maxL = 0, count = 0;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
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

function hexLuminance(hex: number): number {
  const r = srgbToLinear(((hex >> 16) & 0xff) / 255);
  const g = srgbToLinear(((hex >>  8) & 0xff) / 255);
  const b = srgbToLinear( (hex        & 0xff) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function darkenColor(hex: number, factor: number): number {
  const r = Math.round(((hex >> 16) & 0xff) * factor);
  const g = Math.round(((hex >>  8) & 0xff) * factor);
  const b = Math.round( (hex        & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

/**
 * Build the board as a deterministic layer stack:
 *
 *   Layer 1 — shadow base     : rect offset (-1, +2) α 0.12 → general grounding
 *   Layer 2 — shadow bias     : rect offset (+1, +4) α 0.10 → directional weight (bottom-right)
 *   Layer 3 — contact pin     : rect offset  (0, +3) α 0.18 → tight anchoring strip
 *   Layer 4 — edge            : darkened fill, offset (DEPTH_X, DEPTH_Y) → mesa walls
 *   Layer 5 — surface         : board fill at (left, top) → the flat top
 *   Layer 6 — center glow     : radial canvas gradient → slight body / center bias
 *   Layer 7 — noise           : tiled grain → material feel
 *   Layer 8 — highlight       : 1-physical-px top + left lines → light catch
 *
 * zIndex = -1 — always below all piece containers.
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
  const left   = (screenWidth  - bw) / 2;
  const top    = (screenHeight - bh) / 2;

  const edgeColor = darkenColor(fillColor, hexLuminance(fillColor) > 0.5 ? 0.55 : 0.45);

  const g = new Graphics();

  // Shadow footprint = full mesa (face + walls), 2px extended so tails peek onto the table.
  const sw = bw + DEPTH_X + 2;
  const sh = bh + DEPTH_Y + 2;

  // 1 — Base anchor: slight downward tilt, uniform grounding
  g.rect(left + S1_OFFSET_X, top + S1_OFFSET_Y, sw, sh);
  g.fill({ color: 0x000000, alpha: S1_ALPHA });

  // 2 — Directional bias: pushed right+down — stacks with layer 1 at bottom-right,
  //     separates at top-left; interference creates the illusion of directional light.
  g.rect(left + S2_OFFSET_X, top + S2_OFFSET_Y, sw, sh);
  g.fill({ color: 0x000000, alpha: S2_ALPHA });

  // 3 — Contact pinning: tight dark strip anchors the board to the table surface
  g.rect(left + S3_OFFSET_X, top + S3_OFFSET_Y, bw + DEPTH_X, bh + DEPTH_Y);
  g.fill({ color: 0x000000, alpha: S3_ALPHA });

  // 3 — Edge (mesa walls): same size as surface, offset right+down
  g.rect(left + DEPTH_X, top + DEPTH_Y, bw, bh);
  g.fill({ color: edgeColor });

  // 4 — Surface: the board top face
  g.rect(left, top, bw, bh);
  g.fill({ color: fillColor });

  // 5 — Highlight: top edge + left edge, 1 physical pixel
  g.moveTo(left,      top);
  g.lineTo(left + bw, top);       // top edge
  g.moveTo(left, top);
  g.lineTo(left, top + bh);       // left edge
  g.stroke({ color: 0xffffff, width: HL_WIDTH, alpha: HL_ALPHA });

  // 6 — Center glow: radial gradient Sprite — board has a body, not just a skin
  const glow  = new Sprite(centerGlowTexture(bw, bh));
  glow.x      = left;
  glow.y      = top;
  glow.alpha  = GLOW_ALPHA;

  // 7 — Noise layer — tiled over the surface face only (not the walls/shadow)
  const grain = new TilingSprite({ texture: noiseTexture(), width: bw, height: bh });
  grain.x     = left;
  grain.y     = top;
  grain.alpha = NOISE_ALPHA;

  const container = new Container();
  container.addChild(g, glow, grain);
  container.zIndex = -1;
  // Static geometry — cache to texture so the GPU draws one quad per frame.
  container.cacheAsTexture({ resolution: DPR });

  return container;
}
