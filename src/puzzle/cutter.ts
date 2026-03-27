import type { Piece, PieceGroup } from './types';

export function gridCut(
  imageWidth: number,
  imageHeight: number,
  cols: number,
  rows: number,
): { pieces: Piece[]; groups: PieceGroup[] } {
  const pieceW = Math.floor(imageWidth / cols);
  const pieceH = Math.floor(imageHeight / rows);
  const pieces: Piece[] = [];
  const groups: PieceGroup[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * pieceW;
      const y = row * pieceH;
      const id = `piece-${row}-${col}`;
      const groupId = `group-${row}-${col}`;

      pieces.push({
        id,
        groupId,
        localPosition: { x: 0, y: 0 },
        correctPosition: { x, y },
        gridCoord: { col, row },
        textureRegion: { x, y, w: pieceW, h: pieceH },
        rotation: 0,
        placed: false,
        touched: false,
        stackIndex: 0,
      });

      groups.push({
        id: groupId,
        pieceIds: [id],
        position: { x, y },
        rotation: 0,
      });
    }
  }

  return { pieces, groups };
}
