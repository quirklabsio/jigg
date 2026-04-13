import type { PieceDefinition, PieceState, HexCode, Point, EdgeType, StageId } from '@jigg-spec/types';
export type { EdgeType, Point, StageId, HexCode };
export { STAGE_BENCH, STAGE_TABLE } from '@jigg-spec/types';

// ─── Runtime Piece ────────────────────────────────────────────────────────────
//
// Extends spec interfaces directly.  All spec fields (id, templateId,
// edgeType, canonical, index, meanColor, stageId, pos, rot, z, clusterId,
// placed) are inherited — do not redeclare them here.
//
// paletteIndex: runtime mapping of this piece's meanColor to the nearest
//   centroid in JiggAssembly.palette[].  0-based.  Computed at game creation
//   via k-means, stored here for O(1) bench filter and ARIA label access.
//   Not persisted to the spec — palette mapping is recomputed on load.
//
// initialRotation: bench display rotation in degrees.  Assigned at game
//   creation alongside rot.  Carried over unchanged on extraction.
//
// textureRegion: source-image pixel rectangle for this piece.  Engine concern;
//   not in the interchange format.
//
// gridCoord: {col, row} derived at cut time from the grid layout.  Used for
//   snap neighbour lookup and sprite construction.  Not in the spec —
//   serialisation will derive row/col from piece.index + stored cols (a future
//   puzzle-store field) at hydration time.

export interface Piece extends PieceDefinition, PieceState {
  paletteIndex:  number;
  initialRotation: number;   // degrees — bench display rotation
  textureRegion: { x: number; y: number; w: number; h: number };
  gridCoord:     { col: number; row: number };
}

// ─── Stage derivation helpers ─────────────────────────────────────────────────
// Use these everywhere instead of comparing piece.stageId directly.

import { STAGE_BENCH, STAGE_TABLE } from '@jigg-spec/types';

export const isInBench = (p: Piece): boolean => p.stageId === STAGE_BENCH;
export const isOnTable = (p: Piece): boolean => p.stageId === STAGE_TABLE && !p.placed;
export const isPlaced  = (p: Piece): boolean => p.placed === true;

// ─── PieceGroup (engine concept — not a spec type) ────────────────────────────

export interface PieceGroup {
  id:       string;
  pieceIds: string[];
  position: Point;
  rotation: number; // radians, multiples of π/2 — engine-internal, not spec rot
}

// ─── Puzzle config ────────────────────────────────────────────────────────────

export interface PuzzleConfig {
  imageUrl:   string;
  pieceCount: number; // 12–200
  surface:    'matte' | 'glossy' | 'canvas' | 'wood';
  lightAngle: number; // degrees
}

// ─── Cut geometry ─────────────────────────────────────────────────────────────

export interface EdgeMap {
  data:   Float32Array;
  width:  number;
  height: number;
}

export interface CutPath {
  colA:      number;
  rowA:      number;
  colB:      number;
  rowB:      number;
  direction: 'horizontal' | 'vertical';
  points:    Point[]; // [start, cp1, cp2, end, cp1, cp2, end, …] — 1 + 5×3 = 16 points
  hasTab:    'A' | 'B';
}

// ─── Worker messages ──────────────────────────────────────────────────────────

export type WorkerMessageType =
  | 'ANALYZE_IMAGE'
  | 'ANALYSIS_COMPLETE'
  | 'GENERATE_CUTS'
  | 'CUTS_COMPLETE'
  | 'ERROR';

export interface WorkerMessage<T = unknown> {
  type:    WorkerMessageType;
  payload: T;
}
