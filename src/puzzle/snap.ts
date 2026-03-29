import type { Sprite } from 'pixi.js';
import type { Piece } from './types';
import { usePuzzleStore } from '../store/puzzleStore';

const SNAP_THRESHOLD_SQ = 40 * 40;
const BOARD_SNAP_THRESHOLD_SQ = 60 * 60;
const TWO_PI = 2 * Math.PI;

// [dCol, dRow, ldx, ldy]
// ldx/ldy are unit scale factors — multiply by pieceW/pieceH to get local-space delta
// from P's center to N's center when the two pieces are correctly joined
const NEIGHBOURS: [number, number, number, number][] = [
  [1, 0, 1, 0],   // right
  [-1, 0, -1, 0], // left
  [0, 1, 0, 1],   // bottom
  [0, -1, 0, -1], // top
];

function normRot(r: number): number {
  return ((r % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * After a drag drop, check if any piece in draggedGroupId is close enough
 * to a logical neighbour in another group to snap. Rotations must match.
 *
 * On snap:
 *   1. Corrects dragged group position so pieces are pixel-perfect aligned
 *   2. Updates sprite positions immediately
 *   3. Commits corrected position + merge to Zustand
 *   4. Pixel-syncs all survivor sprites from store
 *
 * Returns { survivorId, absorbedId } so caller can update the spatial hash,
 * or null if no snap occurred.
 */
export function checkAndApplySnap(
  draggedGroupId: string,
  spriteMap: Map<string, Sprite>,
): { survivorId: string; absorbedId: string } | null {
  const state = usePuzzleStore.getState();
  const draggedGroup = state.groupsById[draggedGroupId];
  if (!draggedGroup) return null;

  // Use original piece dimensions (textureRegion), not the expanded frame.
  const firstSprite = spriteMap.get(draggedGroup.pieceIds[0]);
  const firstPiece = state.piecesById[draggedGroup.pieceIds[0]];
  if (!firstSprite || !firstPiece) return null;
  const pieceW = firstPiece.textureRegion.w * firstSprite.scale.x;
  const pieceH = firstPiece.textureRegion.h * firstSprite.scale.y;

  const draggedRot = normRot(draggedGroup.rotation);
  const cos = Math.cos(draggedGroup.rotation);
  const sin = Math.sin(draggedGroup.rotation);

  console.group('Snap check');
  console.log(
    'dragged group:', draggedGroupId,
    '| rotation:', draggedGroup.rotation.toFixed(3),
    '| pieces:', draggedGroup.pieceIds.map((id) => {
      const p = state.piecesById[id];
      return p ? `${id}(${p.gridCoord.col},${p.gridCoord.row})` : id;
    }),
  );

  let result: { survivorId: string; absorbedId: string } | null = null;

  outer:
  for (const pid of draggedGroup.pieceIds) {
    const piece = state.piecesById[pid];
    const pSprite = spriteMap.get(pid);
    if (!piece || !pSprite) continue;

    console.log('checking piece:', pid, 'gridCoord:', piece.gridCoord);

    for (const [dc, dr, ldx, ldy] of NEIGHBOURS) {
      const nKey = `${piece.gridCoord.col + dc},${piece.gridCoord.row + dr}`;
      const nId = state.gridIndex.get(nKey);
      if (!nId) continue; // no piece at that grid coord (edge of puzzle)

      const nPiece = state.piecesById[nId];
      if (!nPiece || nPiece.groupId === draggedGroupId) continue; // same group

      const nGroup = state.groupsById[nPiece.groupId];
      if (!nGroup) continue;

      const rotMatch = Math.abs(normRot(nGroup.rotation) - draggedRot) <= 0.01;

      // Rotate the local-space delta into world space using the shared group rotation
      const localDx = ldx * pieceW;
      const localDy = ldy * pieceH;
      const worldDx = localDx * cos - localDy * sin;
      const worldDy = localDx * sin + localDy * cos;

      const nSprite = spriteMap.get(nId);
      if (!nSprite) continue;

      // Expected world position of N vs actual — squared distance
      const ex = pSprite.x + worldDx;
      const ey = pSprite.y + worldDy;
      const dSq = (nSprite.x - ex) ** 2 + (nSprite.y - ey) ** 2;

      const nGroupPieces = nGroup.pieceIds.map((id) => {
        const p = state.piecesById[id];
        return p ? `${id}(${p.gridCoord.col},${p.gridCoord.row})` : id;
      });
      console.log(
        '  neighbour:', nId,
        `| group: ${nPiece.groupId}[${nGroupPieces.join(', ')}]`,
        '| neighbour rotation:', nGroup.rotation.toFixed(3),
        '| rotation match:', rotMatch,
        '| distSq:', Math.round(dSq),
        '| threshold:', SNAP_THRESHOLD_SQ,
        '| snap:', rotMatch && dSq <= SNAP_THRESHOLD_SQ,
      );

      if (!rotMatch || dSq > SNAP_THRESHOLD_SQ) continue;

      // ── Snap ─────────────────────────────────────────────────────────────────
      // Shift dragged group so P's side aligns exactly with N's side
      const corrX = nSprite.x - worldDx - pSprite.x;
      const corrY = nSprite.y - worldDy - pSprite.y;
      const newGroupPos = {
        x: draggedGroup.position.x + corrX,
        y: draggedGroup.position.y + corrY,
      };

      // Move dragged sprites to snapped positions immediately
      for (const dpid of draggedGroup.pieceIds) {
        const dp = state.piecesById[dpid];
        const ds = spriteMap.get(dpid);
        if (!dp || !ds) continue;
        ds.x = newGroupPos.x + dp.localPosition.x;
        ds.y = newGroupPos.y + dp.localPosition.y;
      }

      // Commit snapped position then merge
      usePuzzleStore.getState().moveGroup(draggedGroupId, newGroupPos);

      const survivorId =
        draggedGroup.pieceIds.length >= nGroup.pieceIds.length
          ? draggedGroupId
          : nPiece.groupId;
      const absorbedId = survivorId === draggedGroupId ? nPiece.groupId : draggedGroupId;

      usePuzzleStore.getState().mergeGroups(survivorId, absorbedId);

      // Pixel-perfect sync: all survivor sprites to exact store positions
      const updState = usePuzzleStore.getState();
      const survivor = updState.groupsById[survivorId];
      if (survivor) {
        for (const spid of survivor.pieceIds) {
          const sp = updState.piecesById[spid];
          const ss = spriteMap.get(spid);
          if (sp && ss) {
            ss.x = survivor.position.x + sp.localPosition.x;
            ss.y = survivor.position.y + sp.localPosition.y;
          }
        }
        console.log('MERGED:', absorbedId, '→', survivorId, 'new piece count:', survivor.pieceIds.length);
      }

      result = { survivorId, absorbedId };
      break outer;
    }
  }

  console.groupEnd();
  return result;
}

/**
 * After a drag drop (and after piece-to-piece snap), check if any piece in
 * the group is close enough to its correctPosition to board-snap the whole group.
 *
 * Only fires when group rotation is ≈ 0 — rotated groups cannot land in a slot.
 *
 * On snap:
 *   1. Computes offset from the triggering piece's worldPos → correctPosition
 *   2. Applies offset to group.position and all sprites immediately
 *   3. Commits position + markGroupPlaced to Zustand
 *
 * Returns { groupId, pieceIds } or null.
 */
export function checkAndApplyBoardSnap(
  groupId: string,
  spriteMap: Map<string, Sprite>,
): { groupId: string; pieceIds: string[] } | null {
  const state = usePuzzleStore.getState();
  const group = state.groupsById[groupId];
  if (!group) return null;

  // Rotated groups cannot board-snap — axis-aligned only
  const rot = normRot(group.rotation);
  if (rot > 0.01 && rot < TWO_PI - 0.01) return null;

  console.group('Board snap check');

  let snapPiece: Piece | null = null;

  for (const pid of group.pieceIds) {
    const piece = state.piecesById[pid];
    if (!piece) continue;
    const wx = group.position.x + piece.localPosition.x;
    const wy = group.position.y + piece.localPosition.y;
    const dSq =
      (wx - piece.correctPosition.x) ** 2 + (wy - piece.correctPosition.y) ** 2;
    const snaps = dSq < BOARD_SNAP_THRESHOLD_SQ;
    console.log(
      'piece:', pid,
      'worldPos:', { x: Math.round(wx), y: Math.round(wy) },
      'correctPos:', {
        x: Math.round(piece.correctPosition.x),
        y: Math.round(piece.correctPosition.y),
      },
      'distSq:', Math.round(dSq),
      'threshold:', BOARD_SNAP_THRESHOLD_SQ,
      'snap:', snaps,
    );
    if (snaps && !snapPiece) snapPiece = piece;
  }

  if (snapPiece) {
    const wx = group.position.x + snapPiece.localPosition.x;
    const wy = group.position.y + snapPiece.localPosition.y;
    const offsetX = snapPiece.correctPosition.x - wx;
    const offsetY = snapPiece.correctPosition.y - wy;
    const newGroupPos = {
      x: group.position.x + offsetX,
      y: group.position.y + offsetY,
    };

    // Move all sprites to snapped positions immediately
    for (const pid of group.pieceIds) {
      const p = state.piecesById[pid];
      const s = spriteMap.get(pid);
      if (!p || !s) continue;
      s.x = newGroupPos.x + p.localPosition.x;
      s.y = newGroupPos.y + p.localPosition.y;
    }

    usePuzzleStore.getState().moveGroup(groupId, newGroupPos);
    usePuzzleStore.getState().markGroupPlaced(groupId);

    const totalPlaced = usePuzzleStore.getState().pieces.filter((p) => p.placed).length;
    console.log(
      'BOARD SNAP:', groupId,
      'pieces placed:', group.pieceIds.length,
      'total placed:', totalPlaced,
    );
  }

  console.groupEnd();
  return snapPiece ? { groupId, pieceIds: [...group.pieceIds] } : null;
}
