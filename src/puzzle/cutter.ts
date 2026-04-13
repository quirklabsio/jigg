import { Graphics } from 'pixi.js';
import type { Point, HexCode } from '@jigg-spec/types';
import { STAGE_BENCH } from '@jigg-spec/types';
import type { CutPath, EdgeType, Piece } from './types';

/**
 * Edge influence for cut routing: 0.0 = classic seeded variation only,
 * 1.0 = fully contour-driven with variation reduced to ±5%.
 *
 * This is the single partition point for cut style configuration.
 * Wire up future config UI or presets by changing only this value.
 */
export const EDGE_INFLUENCE = 0.5;

// ─── Color helpers ────────────────────────────────────────────────────────────

/** Arithmetic mean of sampled pixels in a rectangular region (every 4th pixel). */
function dominantColor(
  data: Uint8ClampedArray,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  stride: number,
): [number, number, number] {
  let r = 0, g = 0, b = 0, count = 0;
  for (let y = ry; y < ry + rh; y += 4) {
    for (let x = rx; x < rx + rw; x += 4) {
      const i = (y * stride + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
  }
  if (count === 0) return [128, 128, 128];
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

function rgbToHex(r: number, g: number, b: number): HexCode {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function hexToRgb(hex: HexCode): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * K-means clustering on piece meanColors.
 * Returns a paletteIndex (0–k-1) for each piece.
 * Max 20 iterations, random initialisation.
 */
function clusterPieces(pieces: Piece[], k: number): number[] {
  const n = pieces.length;
  if (n === 0) return [];

  // Parse meanColor hex → RGB once for all pieces
  const rgbValues = pieces.map((p) => hexToRgb(p.meanColor));

  // Random init — pick k random pieces as initial centroids
  const shuffled = Array.from({ length: n }, (_, i) => i);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const centroids: [number, number, number][] = [];
  for (let i = 0; i < k; i++) {
    const src = rgbValues[shuffled[i % n]];
    centroids.push([src[0], src[1], src[2]]);
  }

  const indices = new Array<number>(n).fill(0);

  for (let iter = 0; iter < 20; iter++) {
    let changed = false;

    // Assignment step
    for (let i = 0; i < n; i++) {
      const [pr, pg, pb] = rgbValues[i];
      let bestDist = Infinity;
      let bestIdx  = 0;
      for (let z = 0; z < k; z++) {
        const [cr, cg, cb] = centroids[z];
        const d = (pr - cr) ** 2 + (pg - cg) ** 2 + (pb - cb) ** 2;
        if (d < bestDist) { bestDist = d; bestIdx = z; }
      }
      if (indices[i] !== bestIdx) { indices[i] = bestIdx; changed = true; }
    }

    if (!changed) break;

    // Update step — recompute centroids as mean of assigned pieces
    for (let z = 0; z < k; z++) {
      let sr = 0, sg = 0, sb = 0, count = 0;
      for (let i = 0; i < n; i++) {
        if (indices[i] !== z) continue;
        sr += rgbValues[i][0];
        sg += rgbValues[i][1];
        sb += rgbValues[i][2];
        count++;
      }
      if (count > 0) centroids[z] = [Math.round(sr / count), Math.round(sg / count), Math.round(sb / count)];
    }
  }

  return indices;
}

// ─── Grid cut ─────────────────────────────────────────────────────────────────

export function gridCut(
  imageWidth: number,
  imageHeight: number,
  cols: number,
  rows: number,
  pixelData?: Uint8ClampedArray,
): { pieces: Piece[] } {
  const pieceW = Math.floor(imageWidth / cols);
  const pieceH = Math.floor(imageHeight / rows);
  const pieces: Piece[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x  = col * pieceW;
      const y  = row * pieceH;
      const id = `piece-${row}-${col}`;

      const flatSides =
        (row === 0           ? 1 : 0) +
        (row === rows - 1    ? 1 : 0) +
        (col === 0           ? 1 : 0) +
        (col === cols - 1    ? 1 : 0);
      const edgeType: EdgeType =
        flatSides >= 2 ? 'corner' : flatSides === 1 ? 'edge' : 'interior';

      const rgb      = pixelData ? dominantColor(pixelData, x, y, pieceW, pieceH, imageWidth) : [128, 128, 128] as [number, number, number];
      const meanColor = rgbToHex(rgb[0], rgb[1], rgb[2]);

      // PieceGroup creation is deferred to extraction time.
      // clusterId is absent until the piece is extracted — spec invariant.
      pieces.push({
        // ── PieceDefinition fields ──
        id,
        templateId:   id,    // placeholder — real templates come with dissection format
        edgeType,
        canonical:    { x, y, rot: 0 },
        index:        row * cols + col + 1,
        meanColor,
        // ── PieceState fields ──
        stageId:      STAGE_BENCH,
        // pos absent for STAGE_BENCH — spec invariant
        rot:          0,     // degrees; random cardinal assigned at game creation (persistence epic)
        placed:       false,
        // clusterId absent — spec invariant at game creation
        // ── Implementation-only fields ──
        paletteIndex:    0,  // assigned below after k-means
        initialRotation: 0,  // degrees; set equal to rot at game creation
        textureRegion: { x, y, w: pieceW, h: pieceH },
        gridCoord:     { col, row },
      });
    }
  }

  // Assign palette indices via k-means (k=5) when pixel data is available
  if (pixelData && pieces.length > 0) {
    const indices = clusterPieces(pieces, 5);
    for (let i = 0; i < pieces.length; i++) {
      pieces[i].paletteIndex = indices[i];
    }
  }

  return { pieces };
}

// ─── Mask building ────────────────────────────────────────────────────────────

/** Reverse a Bezier path stored as [start, cp1, cp2, end, cp1, cp2, end, ...]. */
function reversePoints(pts: Point[]): Point[] {
  // Number of segments = (pts.length - 1) / 3
  const result: Point[] = [pts[pts.length - 1]];
  for (let i = pts.length - 4; i >= 0; i -= 3) {
    result.push(pts[i + 2]); // cp2 → cp1 in reverse
    result.push(pts[i + 1]); // cp1 → cp2 in reverse
    result.push(pts[i]);     // previous endpoint
  }
  return result;
}

/** Convert an image-space Point to sprite-local coordinates.
 *  Sprite anchor is 0.5, so local origin = centre of piece. */
function toLocal(pt: Point, col: number, row: number, pw: number, ph: number): [number, number] {
  return [pt.x - col * pw - pw / 2, pt.y - row * ph - ph / 2];
}

function drawCutSegments(
  g: Graphics,
  pts: Point[],
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
    const revBottom = reversePoints(bottomCut.points);
    const [b0x, b0y] = toLocal(revBottom[0], col, row, pw, ph);
    g.lineTo(b0x, b0y);
    drawCutSegments(g, revBottom, col, row, pw, ph);
  } else {
    g.lineTo(-hw, hh);
  }

  // ── Left edge: bottom → top (reversed) ─────────────────────────────────
  const leftCut = col > 0 ? vCut.get(`${col - 1},${row}`) : undefined;
  if (leftCut) {
    const revLeft = reversePoints(leftCut.points);
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
