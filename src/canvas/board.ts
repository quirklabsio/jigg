import { Graphics } from 'pixi.js';

// ─── Visual constants ──────────────────────────────────────────────────────────
const BORDER_ALPHA = 0.15; // outer border
const GRID_ALPHA   = 0.08; // dashed interior lines
const DOT_ALPHA    = 0.04; // corner intersection markers
const FILL_ALPHA   = 0.05; // background tint
const LINE_W       = 1;
const DASH         = 4;
const GAP          = 4;
const DOT_R        = 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Append dash segments to an open PixiJS Graphics path (no stroke call).
 * Caller is responsible for calling g.stroke() when all segments are queued.
 */
function addDashes(
  g: Graphics,
  x1: number, y1: number,
  x2: number, y2: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  let pos = 0;
  let on = true;
  while (pos < len) {
    const seg = Math.min(on ? DASH : GAP, len - pos);
    if (on) {
      g.moveTo(x1 + ux * pos,         y1 + uy * pos);
      g.lineTo(x1 + ux * (pos + seg), y1 + uy * (pos + seg));
    }
    pos += seg;
    on = !on;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create the static board overlay: background tint, outer border, dashed
 * interior grid lines, and corner dot markers.
 *
 * The board is centred in screen space.  Its dimensions in world units are
 * imageWidth*scale × imageHeight*scale so piece slots exactly match the
 * scaled piece textures.
 *
 * zIndex = -1 — always below all piece sprites.
 */
export function createBoard(
  imageWidth:   number,
  imageHeight:  number,
  cols:         number,
  rows:         number,
  scale:        number,
  screenWidth:  number,
  screenHeight: number,
): Graphics {
  const bw   = imageWidth  * scale;
  const bh   = imageHeight * scale;
  const left = (screenWidth  - bw) / 2;
  const top  = (screenHeight - bh) / 2;
  const sw   = bw / cols;   // slot width
  const sh   = bh / rows;   // slot height

  const g = new Graphics();

  // 1 — Background tint (filled rect, resets path)
  g.rect(left, top, bw, bh);
  g.fill({ color: 0x000000, alpha: FILL_ALPHA });

  // 2 — Outer border (stroked rect, resets path)
  g.rect(left, top, bw, bh);
  g.stroke({ color: 0xffffff, alpha: BORDER_ALPHA, width: LINE_W });

  // 3 — Dashed interior grid lines (batched, one stroke call)
  for (let c = 1; c < cols; c++) {
    addDashes(g, left + c * sw, top, left + c * sw, top + bh);
  }
  for (let r = 1; r < rows; r++) {
    addDashes(g, left, top + r * sh, left + bw, top + r * sh);
  }
  g.stroke({ color: 0xffffff, alpha: GRID_ALPHA, width: LINE_W });

  // 4 — Corner dot markers (batched circles, one fill call)
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r <= rows; r++) {
      g.circle(left + c * sw, top + r * sh, DOT_R);
    }
  }
  g.fill({ color: 0xffffff, alpha: DOT_ALPHA });

  g.zIndex = -1; // below all piece sprites (which start at zIndex = 0..n)
  return g;
}
