import { usePuzzleStore } from '../store/puzzleStore';

const DEG_TO_RAD = Math.PI / 180;
const PAD = 12;
const MAX_ATTEMPTS = 300;

export function scatterPieces(
  viewportWidth: number,
  viewportHeight: number,
  pieceScreenW: number,
  pieceScreenH: number,
): void {
  const { pieces, groups } = usePuzzleStore.getState();

  // Central reserved zone — 50% of viewport, centred
  const cx0 = viewportWidth * 0.25;
  const cy0 = viewportHeight * 0.25;
  const cx1 = viewportWidth * 0.75;
  const cy1 = viewportHeight * 0.75;

  function overlapsCenter(x: number, y: number): boolean {
    return x < cx1 && x + pieceScreenW > cx0 && y < cy1 && y + pieceScreenH > cy0;
  }

  const maxX = viewportWidth - pieceScreenW - PAD;
  const maxY = viewportHeight - pieceScreenH - PAD;

  const scatteredGroups = groups.map((group) => {
    let px = PAD;
    let py = PAD;
    let attempts = 0;

    do {
      px = PAD + Math.random() * (maxX - PAD);
      py = PAD + Math.random() * (maxY - PAD);
      attempts++;
    } while (overlapsCenter(px, py) && attempts < MAX_ATTEMPTS);

    return { ...group, position: { x: px, y: py } };
  });

  const scatteredPieces = pieces.map((piece) => ({
    ...piece,
    rotation: (Math.random() * 90 - 45) * DEG_TO_RAD,
  }));

  usePuzzleStore.getState().setGroups(scatteredGroups);
  usePuzzleStore.getState().setPieces(scatteredPieces);
}
