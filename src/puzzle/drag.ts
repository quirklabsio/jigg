import type { Application, Sprite } from 'pixi.js';
import { FederatedPointerEvent } from 'pixi.js';
import { usePuzzleStore } from '../store/puzzleStore';

const DRAG_SCALE = 1.03;
const Z_IDLE = 0;
const Z_SETTLED = 1;
const Z_DRAGGING = 2;

export function attachDrag(app: Application, sprite: Sprite, pieceId: string): void {
  sprite.eventMode = 'static';
  sprite.cursor = 'grab';

  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  const baseScale = sprite.scale.x;

  function onMove(e: FederatedPointerEvent): void {
    if (!dragging || !sprite.parent) return;
    const pos = sprite.parent.toLocal(e.global);
    sprite.x = pos.x + dragOffsetX;
    sprite.y = pos.y + dragOffsetY;
  }

  function onUp(): void {
    if (!dragging) return;
    dragging = false;
    sprite.scale.set(baseScale);
    sprite.zIndex = Z_SETTLED;
    sprite.cursor = 'grab';
    app.stage.off('pointermove', onMove);
    usePuzzleStore.getState().updatePiecePosition(pieceId, { x: sprite.x, y: sprite.y });
  }

  sprite.on('pointerdown', (e: FederatedPointerEvent) => {
    if (!sprite.parent) return;
    dragging = true;
    sprite.scale.set(baseScale * DRAG_SCALE);
    sprite.zIndex = Z_DRAGGING;
    sprite.cursor = 'grabbing';
    const pos = sprite.parent.toLocal(e.global);
    dragOffsetX = sprite.x - pos.x;
    dragOffsetY = sprite.y - pos.y;
    app.stage.on('pointermove', onMove);
    e.stopPropagation();
  });

  app.stage.on('pointerup', onUp);
  app.stage.on('pointercancel', onUp);
}

export { Z_IDLE };
