import { Graphics } from 'pixi.js';
import type { CutPath, CutPoint, Piece } from './types';

/**
 * Edge influence for cut routing: 0.0 = classic seeded variation only,
 * 1.0 = fully contour-driven with variation reduced to ±5%.
 *
 * This is the single partition point for cut style configuration.
 * Wire up future config UI or presets by changing only this value.
 */
export const EDGE_INFLUENCE = 0.5;

export function gridCut(
  imageWidth: number,
  imageHeight: number,
  cols: number,
  rows: number,
): { pieces: Piece[] } {
  const pieceW = Math.floor(imageWidth / cols);
  const pieceH = Math.floor(imageHeight / rows);
  const pieces: Piece[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * pieceW;
      const y = row * pieceH;
      const id = `piece-${row}-${col}`;

      // PieceGroup creation is deferred to extraction time (Story 32).
      // groupId is null until the piece is pulled out of the tray.
      pieces.push({
        id,
        groupId: null,
        state: 'in-tray',
        canonical: { x, y, rotation: 0, scale: 1.0 },
        actual: { x: 0, y: 0, rotation: 0, scale: 1.0, z: 0 },
        gridCoord: { col, row },
        textureRegion: { x, y, w: pieceW, h: pieceH },
        placed: false,
        touched: false,
      });
    }
  }

  return { pieces };
}

// ─── Mask building ────────────────────────────────────────────────────────────

/** Reverse a Bezier path stored as [start, cp1, cp2, end, cp1, cp2, end, ...]. */
function reverseCutPoints(pts: CutPoint[]): CutPoint[] {
  // Number of segments = (pts.length - 1) / 3
  const result: CutPoint[] = [pts[pts.length - 1]];
  for (let i = pts.length - 4; i >= 0; i -= 3) {
    result.push(pts[i + 2]); // cp2 → cp1 in reverse
    result.push(pts[i + 1]); // cp1 → cp2 in reverse
    result.push(pts[i]);     // previous endpoint
  }
  return result;
}

/** Convert an image-space CutPoint to sprite-local coordinates.
 *  Sprite anchor is 0.5, so local origin = centre of piece. */
function toLocal(pt: CutPoint, col: number, row: number, pw: number, ph: number): [number, number] {
  return [pt.x - col * pw - pw / 2, pt.y - row * ph - ph / 2];
}

function drawCutSegments(
  g: Graphics,
  pts: CutPoint[],
  col: number,
  row: number,
  pw: number,
  ph: number,
): void {
  // pts[0] is the start (already at cursor), then groups of 3: cp1, cp2, end
  for (let i = 1; i < pts.length; i += 3) {
    const [c1x, c1y] = toLocal(pts[i],     col, row, pw, ph);
    const [c2x, c2y] = toLocal(pts[i + 1], col, row, pw, ph);
    const [ex,  ey]  = toLocal(pts[i + 2], col, row, pw, ph);
    g.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey);
  }
}

/**
 * Build a PixiJS Graphics mask for a piece, stitching its four edges from the
 * global cut-path list.  The Graphics is in the sprite's local coordinate
 * space (anchor = 0.5, so origin = centre of piece in pixel units before scale).
 *
 * Traversal order (clockwise):
 *   top: left → right  (piece is rowB → FORWARD)
 *   right: top → bottom  (piece is colA → FORWARD)
 *   bottom: right → left  (piece is rowA → REVERSE)
 *   left: bottom → top  (piece is colB → REVERSE)
 */
export function buildPieceMask(
  piece: Piece,
  cutPaths: CutPath[],
  cols: number,
  rows: number,
  pw: number, // piece pixel width
  ph: number, // piece pixel height
): Graphics {
  const { col, row } = piece.gridCoord;

  // Index cuts for fast lookup
  // horizontal key: `h,${col},${rowA}`  (rowA = row above the cut)
  // vertical   key: `v,${colA},${row}`  (colA = col to the left of the cut)
  const hCut = new Map<string, CutPath>();
  const vCut = new Map<string, CutPath>();
  for (const c of cutPaths) {
    if (c.direction === 'horizontal') hCut.set(`${c.colA},${c.rowA}`, c);
    else                              vCut.set(`${c.colA},${c.rowA}`, c);
  }

  const hw = pw / 2;
  const hh = ph / 2;

  // roundPixels snaps the mask's rendered vertices to integer device pixels,
  // preventing the sub-pixel gap that appears at shared stencil boundaries.
  const g = new Graphics({ roundPixels: true });
  g.moveTo(-hw, -hh); // top-left

  // ── Top edge: left → right ──────────────────────────────────────────────
  const topCut = row > 0 ? hCut.get(`${col},${row - 1}`) : undefined;
  if (topCut) {
    // lineTo pts[0] first: guarantees the cursor is at the exact cut start
    // before the bezier segments are drawn (pts[0] is skipped by drawCutSegments).
    const [t0x, t0y] = toLocal(topCut.points[0], col, row, pw, ph);
    g.lineTo(t0x, t0y);
    drawCutSegments(g, topCut.points, col, row, pw, ph);
  } else {
    g.lineTo(hw, -hh);
  }

  // ── Right edge: top → bottom ────────────────────────────────────────────
  const rightCut = col < cols - 1 ? vCut.get(`${col},${row}`) : undefined;
  if (rightCut) {
    const [r0x, r0y] = toLocal(rightCut.points[0], col, row, pw, ph);
    g.lineTo(r0x, r0y);
    drawCutSegments(g, rightCut.points, col, row, pw, ph);
  } else {
    g.lineTo(hw, hh);
  }

  // ── Bottom edge: right → left (reversed) ───────────────────────────────
  const bottomCut = row < rows - 1 ? hCut.get(`${col},${row}`) : undefined;
  if (bottomCut) {
    const revBottom = reverseCutPoints(bottomCut.points);
    const [b0x, b0y] = toLocal(revBottom[0], col, row, pw, ph);
    g.lineTo(b0x, b0y);
    drawCutSegments(g, revBottom, col, row, pw, ph);
  } else {
    g.lineTo(-hw, hh);
  }

  // ── Left edge: bottom → top (reversed) ─────────────────────────────────
  const leftCut = col > 0 ? vCut.get(`${col - 1},${row}`) : undefined;
  if (leftCut) {
    const revLeft = reverseCutPoints(leftCut.points);
    const [l0x, l0y] = toLocal(revLeft[0], col, row, pw, ph);
    g.lineTo(l0x, l0y);
    drawCutSegments(g, revLeft, col, row, pw, ph);
  } else {
    g.lineTo(-hw, -hh);
  }

  g.closePath();
  g.fill({ color: 0xffffff });

  return g;
}
