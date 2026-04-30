import type { RenderSpec } from '../types'

/**
 * Plate stage entry point.
 * One-shot initialization: `RenderSpec` → PixiJS scene + ARIA DOM.
 * After init, runtime behavior is driven by Store reactivity, not by Plate
 * deriving anything new.
 */
export async function runPlate(_spec: RenderSpec): Promise<void> {
  throw new Error('not implemented')
}
