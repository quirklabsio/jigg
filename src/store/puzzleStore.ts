import { createStore } from 'zustand/vanilla';
import type { EdgeType, Piece, PieceGroup } from '../puzzle/types';
import {
  savePreferences,
  fireApplyPreferences,
  type Preferences,
  type BackgroundPreset,
} from '../utils/preferences';

export type TrayFilter = 'all' | EdgeType | 'zone-0' | 'zone-1' | 'zone-2' | 'zone-3' | 'zone-4';

type PieceLifecycle = Piece['state'];

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
  trayOpen: boolean;
  activeFilter: TrayFilter;
  zoomToPlace: boolean;
  // Preferences
  highContrast: boolean;
  greyscale: boolean;
  pieceLabels: boolean;
  reducedMotion: boolean;
  backgroundPreset: BackgroundPreset | null;
  imageLuminance: number; // sampled on puzzle load; default neutral mid
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  setPieces: (pieces: Piece[]) => void;
  setGroups: (groups: PieceGroup[]) => void;
  setGridIndex: (index: Map<string, string>) => void;
  updatePieceRotation: (id: string, rotation: number) => void;
  moveGroup: (groupId: string, position: { x: number; y: number }) => void;
  rotateGroup: (groupId: string) => void;
  mergeGroups: (survivorId: string, absorbedId: string) => void;
  markGroupPlaced: (groupId: string) => void;
  setTrayOpen: (open: boolean) => void;
  setActiveFilter: (filter: TrayFilter) => void;
  setZoomToPlace: (value: boolean) => void;
  /** Move a piece from tray to canvas: sets state, assigns groupId, adds PieceGroup. */
  extractPieceToCanvas: (
    pieceId: string,
    groupId: string,
    groupPosition: { x: number; y: number },
  ) => void;
}

export const usePuzzleStore = createStore<PuzzleState>((set) => ({
  pieces: [],
  groups: [],
  piecesById: {},
  groupsById: {},
  gridIndex: new Map(),
  puzzleComplete: false,
  trayOpen: true,
  activeFilter: 'all',
  zoomToPlace: false,
  highContrast: false,
  greyscale: false,
  pieceLabels: false,
  reducedMotion: false,
  backgroundPreset: null,
  imageLuminance: 128,
  setPieces: (pieces) => set({ pieces, piecesById: toRecord(pieces), activeFilter: 'all' }),
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
        pieceIdSet.has(p.id) ? { ...p, placed: true, state: 'placed' as PieceLifecycle } : p,
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
  setTrayOpen: (open) => set({ trayOpen: open }),
  setActiveFilter: (filter) => set({ activeFilter: filter }),
  setZoomToPlace: (value) => set({ zoomToPlace: value }),
  setPreference: (key, value) => {
    // Build newPrefs inside set (has access to current state), but fire the
    // apply callback AFTER set returns — getState() inside syncBgPresetUI etc.
    // must read the already-committed new state, not the pre-commit old state.
    let newPrefs!: Preferences;
    set((state) => {
      newPrefs = {
        highContrast:     key === 'highContrast'     ? (value as boolean)                 : state.highContrast,
        greyscale:        key === 'greyscale'        ? (value as boolean)                 : state.greyscale,
        pieceLabels:      key === 'pieceLabels'      ? (value as boolean)                 : state.pieceLabels,
        reducedMotion:    key === 'reducedMotion'    ? (value as boolean)                 : state.reducedMotion,
        backgroundPreset: key === 'backgroundPreset' ? (value as BackgroundPreset | null) : state.backgroundPreset,
      };
      savePreferences(newPrefs);
      return { [key]: value };
    });
    fireApplyPreferences(newPrefs);
  },
  extractPieceToCanvas: (pieceId, groupId, groupPosition) =>
    set((state) => {
      const pieces = state.pieces.map((p) =>
        p.id === pieceId
          ? { ...p, groupId, state: 'on-canvas' as PieceLifecycle }
          : p,
      );
      const newGroup: PieceGroup = {
        id: groupId,
        pieceIds: [pieceId],
        position: groupPosition,
        rotation: 0,
      };
      const groups = [...state.groups, newGroup];
      return {
        pieces,
        piecesById: toRecord(pieces),
        groups,
        groupsById: toRecord(groups),
      };
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
