import type { RenderSpec } from '../types'

/**
 * Cook stage entry point.
 * Pure transformation: `JiggDissection` + `A11yStatic` → `RenderSpec`.
 * Deterministic. No store reads. No randomness, time, or external state.
 */
export async function runCook(): Promise<RenderSpec> {
  throw new Error('not implemented')
}
