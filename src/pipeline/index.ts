import type { IntakeResult, RenderSpec } from './types'

/**
 * Pipeline orchestrator.
 * Routes IntakeResult through the appropriate stages → RenderSpec.
 *
 * May:  decide which stages to run, pass outputs to inputs
 * MUST NOT: transform data, derive structures, contain business logic
 */
export async function runPipeline(_intake: IntakeResult): Promise<RenderSpec> {
  throw new Error('not implemented')
}
