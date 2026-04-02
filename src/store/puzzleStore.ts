import { createStore } from 'zustand/vanilla';
import type { Piece, PieceGroup } from '../puzzle/types';

function toRecord<T extends { id: string }>(arr: T[]): Record<string, T> {
  const rec: Record<string, T> = {};
  for (const item of arr) rec[item.id] = item;
  return rec;
}

interface PuzzleState {
  // Arrays — used by scatter.ts / scene.ts for iteration
  pieces: Piece[];
  groups: PieceGroup[];
  // Records — O(1) keyed lookup used by drag.ts and future snap logic
  piecesById: Record<string, Piece>;
  groupsById: Record<string, PieceGroup>;
  gridIndex: Map<string, string>;
  puzzleComplete: boolean;
  setPieces: (pieces: Piece[]) => void;
  setGroups: (groups: PieceGroup[]) => void;
  setGridIndex: (index: Map<string, string>) => void;
  updatePieceRotation: (id: string, rotation: number) => void;
  moveGroup: (groupId: string, position: { x: number; y: number }) => void;
  rotateGroup: (groupId: string) => void;
  mergeGroups: (survivorId: string, absorbedId: string) => void;
  markGroupPlaced: (groupId: string) => void;
}

export const usePuzzleStore = createStore<PuzzleState>((set) => ({
  pieces: [],
  groups: [],
  piecesById: {},
  groupsById: {},
  gridIndex: new Map(),
  puzzleComplete: false,
  setPieces: (pieces) => set({ pieces, piecesById: toRecord(pieces) }),
  setGroups: (groups) => set({ groups, groupsById: toRecord(groups) }),
  setGridIndex: (gridIndex) => set({ gridIndex }),
  updatePieceRotation: (id, rotation) =>
    set((state) => {
      const pieces = state.pieces.map((p) =>
        p.id === id ? { ...p, actual: { ...p.actual, rotation } } : p,
      );
      return { pieces, piecesById: toRecord(pieces) };
    }),
  moveGroup: (groupId, position) =>
    set((state) => {
      const groups = state.groups.map((g) => (g.id === groupId ? { ...g, position } : g));
      return { groups, groupsById: toRecord(groups) };
    }),
  rotateGroup: (groupId) =>
    set((state) => {
      const HALF_PI = Math.PI / 2;
      const targetGroup = state.groupsById[groupId];
      if (!targetGroup) return state;
      const pieceIdSet = new Set(targetGroup.pieceIds);
      // Bake 90° CW into actual position: newX = -y, newY = x
      // Also increment actual.rotation so sprites rebuild correctly from store state
      const pieces = state.pieces.map((p) => {
        if (!pieceIdSet.has(p.id)) return p;
        const { x: lx, y: ly } = p.actual;
        return { ...p, actual: { ...p.actual, x: -ly, y: lx, rotation: p.actual.rotation + HALF_PI } };
      });
      const groups = state.groups.map((g) =>
        g.id === groupId ? { ...g, rotation: g.rotation + HALF_PI } : g,
      );
      return { pieces, groups, piecesById: toRecord(pieces), groupsById: toRecord(groups) };
    }),
  markGroupPlaced: (groupId) =>
    set((state) => {
      const group = state.groupsById[groupId];
      if (!group) return state;
      const pieceIdSet = new Set(group.pieceIds);
      const pieces = state.pieces.map((p) =>
        pieceIdSet.has(p.id) ? { ...p, placed: true } : p,
      );
      const piecesById = toRecord(pieces);
      let puzzleComplete = false;
      if (!state.puzzleComplete) {
        puzzleComplete = true;
        for (const piece of Object.values(piecesById)) {
          if (!piece.placed) { puzzleComplete = false; break; }
        }
      }
      return { pieces, piecesById, puzzleComplete: state.puzzleComplete || puzzleComplete };
    }),
  mergeGroups: (survivorId, absorbedId) =>
    set((state) => {
      const survivor = state.groupsById[survivorId];
      const absorbed = state.groupsById[absorbedId];
      if (!survivor || !absorbed) return state;
      // Re-express absorbed pieces' actual positions relative to survivor's origin
      const pieces = state.pieces.map((p) => {
        if (p.groupId !== absorbedId) return p;
        return {
          ...p,
          groupId: survivorId,
          actual: {
            ...p.actual,
            x: absorbed.position.x + p.actual.x - survivor.position.x,
            y: absorbed.position.y + p.actual.y - survivor.position.y,
          },
        };
      });
      const mergedPieceIds = [...survivor.pieceIds, ...absorbed.pieceIds];
      const groups = state.groups
        .filter((g) => g.id !== absorbedId)
        .map((g) => (g.id === survivorId ? { ...g, pieceIds: mergedPieceIds } : g));
      return { pieces, groups, piecesById: toRecord(pieces), groupsById: toRecord(groups) };
    }),
}));
