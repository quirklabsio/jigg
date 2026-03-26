import { createStore } from 'zustand/vanilla';
import type { Piece } from '../puzzle/types';

interface PuzzleState {
  pieces: Piece[];
  setPieces: (pieces: Piece[]) => void;
}

export const usePuzzleStore = createStore<PuzzleState>((set) => ({
  pieces: [],
  setPieces: (pieces) => set({ pieces }),
}));
