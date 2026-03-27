import type { Sprite } from 'pixi.js';
import { usePuzzleStore } from '../store/puzzleStore';

/**
 * Rotate a group 90° clockwise in place.
 * - Bakes the new localPositions and piece.rotation into the store
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
    sprite.x = group.position.x + piece.localPosition.x;
    sprite.y = group.position.y + piece.localPosition.y;
    sprite.rotation = piece.rotation;
  }
}
