// ── Re-export spec types used across the pipeline ────────
export type {
  JiggDissection,
  JiggAssembly,
  JiggState,
  JiggGlue,
  PieceDefinition,
  PieceTemplate,
  PieceState,
  StageId,
  JiggUri,
  HexCode,
} from '@jigg-spec/types'

export {
  STAGE_TABLE,
  STAGE_BENCH,
} from '@jigg-spec/types'

import type { JiggDissection, JiggAssembly, HexCode } from '@jigg-spec/types'

// ── Intake ───────────────────────────────────────────────

export interface IntakePayload {
  imageData: ArrayBuffer
  width: number
  height: number
  mimeType: string
}

export type IntakeResult =
  | { kind: 'new-image'; payload: IntakePayload }
  | { kind: 'new-jigg'; payload: IntakePayload; hasDissection: boolean }
  | { kind: 'resume'; dissection: JiggDissection; assembly: JiggAssembly }

// ── Chop ─────────────────────────────────────────────────
// CutParams intentionally open-ended — do not over-specify early

export interface CutParams {
  pieceCount?: number
  cutStyle?: string
  seed?: number
  [key: string]: unknown
}

export interface CutGeometry {
  [key: string]: unknown // defined during Chop migration
}

export interface DerivedPalette {
  centroids: HexCode[]
}

export interface CutsReady {
  type: 'CutsReady'
  cuts: CutGeometry[]
  palette: DerivedPalette
}

// ── Cook — accessibility types ────────────────────────────
// These are Cook inputs/outputs, not an a11y subsystem.
// A11yPrefs is a snapshot of store state passed into the pipeline.
// A11ySpec is the resolved output that lives in RenderSpec.

export interface A11yDefaults {
  boardColor: HexCode // adaptive — derived from puzzle palette
}

export interface A11yPrefs {
  contrastMode: 'normal' | 'high'
  reduceMotion: boolean
}

export interface A11yStatic {
  defaults: A11yDefaults
  prefs: A11yPrefs // snapshot only — never live store reference
}

export interface A11ySpec {
  boardColor: HexCode
  contrastMode: 'normal' | 'high'
  reduceMotion: boolean
}

// A11ySpec must NOT include runtime-only state (focusMode, selection, etc.)
// Those live in the store and are consumed by plate/aria/runtime/ directly.

// ── Cook — render output ──────────────────────────────────

export interface BoardSpec {
  [key: string]: unknown // defined during Cook migration
}

export interface PieceSpec {
  [key: string]: unknown // defined during Cook migration
}

export interface RenderSpec {
  version: 1
  board: BoardSpec
  pieces: PieceSpec[]
  a11y: A11ySpec
  meta: {
    generatedAt: number
    source: 'fresh' | 'resume'
  }
}

// ── Stage contract ────────────────────────────────────────

export type Stage<I, O> = (input: I) => Promise<O>
