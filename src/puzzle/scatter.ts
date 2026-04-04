// scatter.ts — random piece distribution math preserved for potential future use
// (e.g. "scatter all canvas pieces" panic button).
//
// scatter-on-load behaviour gutted in Story 32: all pieces now start in the tray.
// The function stub is retained so import sites don't need updating.

// ─── Preserved distribution math (commented out) ─────────────────────────────
//
// const ROTATIONS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
// const PAD = 12;
// const MAX_ATTEMPTS = 300;
//
// Central reserved zone — 50% of viewport, centred:
//   const cx0 = viewportWidth * 0.25;
//   const cy0 = viewportHeight * 0.25;
//   const cx1 = viewportWidth * 0.75;
//   const cy1 = viewportHeight * 0.75;
//
//   function overlapsCenter(x: number, y: number): boolean {
//     return x < cx1 && x + pieceScreenW > cx0 && y < cy1 && y + pieceScreenH > cy0;
//   }
//
//   const maxX = viewportWidth - pieceScreenW - PAD;
//   const maxY = viewportHeight - pieceScreenH - PAD;
//
//   // Random placement with center-avoidance:
//   const scatteredGroups = groups.map((group) => {
//     let px = PAD;
//     let py = PAD;
//     let attempts = 0;
//     do {
//       px = PAD + Math.random() * (maxX - PAD);
//       py = PAD + Math.random() * (maxY - PAD);
//       attempts++;
//     } while (overlapsCenter(px, py) && attempts < MAX_ATTEMPTS);
//
//     const rotation = ROTATIONS[Math.floor(Math.random() * 4)];
//     return { ...group, position: { x: px, y: py }, rotation };
//   });
//
//   // group.rotation must match piece.rotation so snap detection is correct:
//   const groupRotation = new Map(scatteredGroups.map((g) => [g.id, g.rotation]));
//   const scatteredPieces = pieces.map((piece) => ({
//     ...piece,
//     actual: {
//       ...piece.actual,
//       rotation: (piece.groupId != null ? groupRotation.get(piece.groupId) : undefined) ?? 0,
//     },
//   }));
//
//   usePuzzleStore.getState().setGroups(scatteredGroups);
//   usePuzzleStore.getState().setPieces(scatteredPieces);

// ─── Stub (scatter-on-load removed) ──────────────────────────────────────────

export function scatterPieces(
  _viewportWidth: number,
  _viewportHeight: number,
  _pieceScreenW: number,
  _pieceScreenH: number,
): void {
  // No-op: scatter-on-load removed in Story 32.
  // Pieces start in the tray; use the tray extraction mechanic instead.
}
