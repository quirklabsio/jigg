export interface Piece {
  id: string;
  textureRegion: { x: number; y: number; w: number; h: number };
  position: { x: number; y: number };
  rotation: number;
  placed: boolean;
  touched: boolean;
  stackIndex: number;
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
