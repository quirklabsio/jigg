import { createStore } from 'zustand/vanilla';
import type { Piece } from '../puzzle/types';

interface PuzzleState {
  pieces: Piece[];
  setPieces: (pieces: Piece[]) => void;
  updatePiecePosition: (id: string, position: { x: number; y: number }) => void;
  updatePieceRotation: (id: string, rotation: number) => void;
}

export const usePuzzleStore = createStore<PuzzleState>((set) => ({
  pieces: [],
  setPieces: (pieces) => set({ pieces }),
  updatePiecePosition: (id, position) =>
    set((state) => ({
      pieces: state.pieces.map((p) => (p.id === id ? { ...p, position } : p)),
    })),
  updatePieceRotation: (id, rotation) =>
    set((state) => ({
      pieces: state.pieces.map((p) => (p.id === id ? { ...p, rotation } : p)),
    })),
}));
