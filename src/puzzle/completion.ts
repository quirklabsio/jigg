import type { Application } from 'pixi.js';
import type { Graphics } from 'pixi.js';
import type { Piece } from './types';
import { showCompletionMessage } from '../canvas/ui';

export function isComplete(piecesById: Record<string, Piece>): boolean {
  for (const piece of Object.values(piecesById)) {
    if (!piece.placed) return false;
  }
  return true;
}

export function onComplete(app: Application, hitLayer: Graphics, totalCount: number): void {
  hitLayer.eventMode = 'none';
  console.log('PUZZLE COMPLETE — pieces:', totalCount);
  showCompletionMessage(app);
}
