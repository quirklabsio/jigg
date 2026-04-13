import type { Sprite } from 'pixi.js';
import { usePuzzleStore } from '../store/puzzleStore';
import { syncLabelRotation } from '../utils/preferences';

/**
 * Rotate a group 90° clockwise in place.
 * - Bakes the new pos and rot into the store (rot in degrees, pos as local offset)
 * - Syncs sprite positions and rotations to match the updated store state
 * - Group origin (group.position) is unchanged — pieces orbit around it
 */
export function rotateGroup(groupId: string, spriteMap: Map<string, Sprite>): void {
  usePuzzleStore.getState().rotateGroup(groupId);

  // Re-read updated state and apply to sprites
  const { piecesById, groupsById } = usePuzzleStore.getState();
  const group = groupsById[groupId];
  if (!group) return;

  for (const pid of group.pieceIds) {
    const piece = piecesById[pid];
    const sprite = spriteMap.get(pid);
    if (!piece || !sprite) continue;
    sprite.x = group.position.x + piece.pos!.x;
    sprite.y = group.position.y + piece.pos!.y;
    // piece.rot is degrees; Pixi sprite.rotation is radians
    sprite.rotation = (piece.rot * Math.PI) / 180;
    syncLabelRotation(sprite);
  }
}
