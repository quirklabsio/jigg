import type { Piece } from '../puzzle/types';

// ─── Hidden ARIA container ────────────────────────────────────────────────────
// Screen readers traverse this DOM tree; PixiJS canvas is invisible to AT.
// Stories 38–42 build keyboard navigation on top of this groundwork.

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
 * Call on every piece state transition (in-tray → on-canvas → placed).
 */
export function setAriaLabel(piece: Piece): void {
  let el = document.getElementById(`piece-${piece.id}`);
  if (!el) {
    el = document.createElement('div');
    el.id = `piece-${piece.id}`;
    el.setAttribute('role', 'listitem');
    ariaContainer.appendChild(el);
  }
  const stateLabel =
    piece.state === 'in-tray'  ? 'In tray'        :
    piece.state === 'placed'   ? 'Placed on board' :
                                 'On canvas';
  el.setAttribute(
    'aria-label',
    `Piece row ${piece.gridCoord.row + 1}, column ${piece.gridCoord.col + 1} — ${stateLabel}`,
  );
}

/**
 * Initialise ARIA labels for all pieces. Call on puzzle load and resume.
 */
export function initAriaLabels(pieces: Piece[]): void {
  pieces.forEach(setAriaLabel);
}
