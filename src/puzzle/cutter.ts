import type { Piece } from './types';

export function gridCut(imageWidth: number, imageHeight: number, cols: number, rows: number): Piece[] {
  const pieceW = Math.floor(imageWidth / cols);
  const pieceH = Math.floor(imageHeight / rows);
  const pieces: Piece[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * pieceW;
      const y = row * pieceH;
      pieces.push({
        id: `piece-${row}-${col}`,
        textureRegion: { x, y, w: pieceW, h: pieceH },
        position: { x, y },
        rotation: 0,
        placed: false,
        touched: false,
        stackIndex: 0,
      });
    }
  }

  return pieces;
}
