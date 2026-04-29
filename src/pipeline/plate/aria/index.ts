import type { RenderSpec } from '../../types'

/**
 * Static ARIA mirror. Builds the accessible DOM structure from `RenderSpec`.
 * Runtime behavior (focus, keyboard, announcements) lives in `./runtime/`.
 */
export async function runPlateAria(_spec: RenderSpec): Promise<void> {
  throw new Error('not implemented')
}
