import type { RenderSpec } from '../../types'

/**
 * PixiJS executor. The only place PixiJS is touched in the codebase.
 * Builds the scene from `RenderSpec` and reacts to Store changes during runtime.
 */
export async function runPlatePixi(_spec: RenderSpec): Promise<void> {
  throw new Error('not implemented')
}
