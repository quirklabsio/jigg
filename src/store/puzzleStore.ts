import { createStore } from 'zustand/vanilla';
import type { EdgeType, Piece, PieceGroup } from '../puzzle/types';
import { STAGE_TABLE } from '../puzzle/types';
import {
  savePreferences,
  fireApplyPreferences,
  type Preferences,
  type BackgroundPreset,
} from '../utils/preferences';

export type TrayFilter =
  | 'all'
  | EdgeType
  | 'palette-0'
  | 'palette-1'
  | 'palette-2'
  | 'palette-3'
  | 'palette-4';

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
  /** Update a piece's rot (degrees) in the store — kept for future use. */
  updatePieceRotation: (id: string, rot: number) => void;
  moveGroup: (groupId: string, position: { x: number; y: number }) => void;
  rotateGroup: (groupId: string) => void;
  mergeGroups: (survivorId: string, absorbedId: string) => void;
  markGroupPlaced: (groupId: string) => void;
  setTrayOpen: (open: boolean) => void;
  setActiveFilter: (filter: TrayFilter) => void;
  setZoomToPlace: (value: boolean) => void;
  /** Move a piece from bench to table: sets stageId, assigns clusterId, adds PieceGroup. */
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
  updatePieceRotation: (id, rot) =>
    set((state) => {
      const pieces = state.pieces.map((p) =>
        p.id === id ? { ...p, rot } : p,
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
      // Bake 90° CW into pos: newX = -y, newY = x
      // Also increment rot (degrees) so rotate.ts can rebuild sprites from store state
      const pieces = state.pieces.map((p) => {
        if (!pieceIdSet.has(p.id)) return p;
        const lx = p.pos!.x;
        const ly = p.pos!.y;
        return { ...p, pos: { x: -ly, y: lx }, rot: p.rot + 90 };
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
      // placed === true implies clusterId absent — spec invariant enforced here
      const pieces = state.pieces.map((p) =>
        pieceIdSet.has(p.id) ? { ...p, placed: true, clusterId: undefined } : p,
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
      // pos: {x:0, y:0} = local offset within group (zero at extraction time)
      // Spec note: pos will become global coords when persistence epic lands.
      const pieces = state.pieces.map((p) =>
        p.id === pieceId
          ? { ...p, clusterId: groupId, stageId: STAGE_TABLE, pos: { x: 0, y: 0 } }
          : p,
      );
      const newGroup: PieceGroup = {
        id:       groupId,
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
      // Re-express absorbed pieces' pos (local offset) relative to survivor's origin
      const pieces = state.pieces.map((p) => {
        if (p.clusterId !== absorbedId) return p;
        return {
          ...p,
          clusterId: survivorId,
          pos: {
            x: absorbed.position.x + p.pos!.x - survivor.position.x,
            y: absorbed.position.y + p.pos!.y - survivor.position.y,
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
