export interface Piece {
  id: string;
  groupId: string;
  localPosition: { x: number; y: number };
  correctPosition: { x: number; y: number };
  gridCoord: { col: number; row: number };
  rotation: number;
  placed: boolean;
  touched: boolean;
  stackIndex: number;
  textureRegion: { x: number; y: number; w: number; h: number };
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

export type WorkerMessageType =
  | 'ANALYZE_IMAGE'
  | 'ANALYSIS_COMPLETE'
  | 'ERROR';

export interface WorkerMessage<T = unknown> {
  type: WorkerMessageType;
  payload: T;
}
