export interface Transform {
  x: number;
  y: number;
  rotation: number; // radians internally; degrees in .jigg files (convert at boundary)
  scale: number;    // 1.0 = native size
}

export interface Piece {
  id: string;
  metadata?: Record<string, unknown>;

  canonical: Readonly<Transform>; // image space, immutable, set once on creation
  actual: Transform & {
    z: number;                    // layering in play space
  };

  groupId: string | null;         // topology, not geometry

  // retained from current implementation
  gridCoord: { col: number; row: number };
  textureRegion: { x: number; y: number; w: number; h: number };
  placed: boolean;
  touched: boolean;
}

export interface PieceGroup {
  id: string;
  pieceIds: string[];
  position: { x: number; y: number };
  rotation: number; // radians, multiples of π/2, incremented on group rotate
}

export interface PuzzleConfig {
  imageUrl: string;
  pieceCount: number; // 12–200
  surface: 'matte' | 'glossy' | 'canvas' | 'wood';
  lightAngle: number; // degrees
}

export interface EdgeMap {
  data: Float32Array;
  width: number;
  height: number;
}

export interface CutPoint {
  x: number;
  y: number;
}

export interface CutPath {
  colA: number;
  rowA: number;
  colB: number;
  rowB: number;
  direction: 'horizontal' | 'vertical';
  points: CutPoint[]; // [start, cp1, cp2, end, cp1, cp2, end, ...] — 1 + 5×3 = 16 points
  hasTab: 'A' | 'B';  // which piece carries the protruding tab
}

export type WorkerMessageType =
  | 'ANALYZE_IMAGE'
  | 'ANALYSIS_COMPLETE'
  | 'GENERATE_CUTS'
  | 'CUTS_COMPLETE'
  | 'ERROR';

export interface WorkerMessage<T = unknown> {
  type: WorkerMessageType;
  payload: T;
}
