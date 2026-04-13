import type { Piece } from '../puzzle/types';
import { isInBench, isOnTable, isPlaced } from '../puzzle/types';

// ─── Hidden ARIA container ────────────────────────────────────────────────────
// Screen readers traverse this DOM tree; PixiJS canvas is invisible to AT.
// Stories 40–42 replace this placeholder with the two-landmark structure
// (role="application" × 2 — see jigg-spec/accessibility.md §1).

const ariaContainer = document.createElement('div');
ariaContainer.setAttribute('role', 'list');
ariaContainer.setAttribute('aria-label', 'Puzzle pieces');
ariaContainer.style.cssText = [
  'position:absolute',
  'width:1px',
  'height:1px',
  'overflow:hidden',
  'clip:rect(0,0,0,0)',
  'white-space:nowrap',
].join(';');
document.body.appendChild(ariaContainer);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create or update the ARIA listitem for a single piece.
 * Call on every piece state transition (bench → table → placed).
 *
 * Label format (spec — jigg-spec/accessibility.md §2):
 *   "Piece {index} — Palette {paletteIndex + 1}, row {row + 1}, column {col + 1}, {stageLabel}"
 */
export function setAriaLabel(piece: Piece): void {
  let el = document.getElementById(`piece-${piece.id}`);
  if (!el) {
    el = document.createElement('div');
    el.id = `piece-${piece.id}`;
    el.setAttribute('role', 'listitem');
    ariaContainer.appendChild(el);
  }

  const stageLabel =
    isPlaced(piece)   ? 'Placed'    :
    isOnTable(piece)  ? 'On table'  :
    isInBench(piece)  ? 'In bench'  :
                        'Unknown';

  el.setAttribute(
    'aria-label',
    `Piece ${piece.index} — Palette ${piece.paletteIndex + 1}, ` +
    `row ${piece.gridCoord.row + 1}, column ${piece.gridCoord.col + 1}, ${stageLabel}`,
  );
}

/**
 * Initialise ARIA labels for all pieces. Call on puzzle load and resume.
 */
export function initAriaLabels(pieces: Piece[]): void {
  pieces.forEach(setAriaLabel);
}
