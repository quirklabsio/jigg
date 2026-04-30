import type { A11yStatic, A11ySpec } from '../types'

/**
 * Derives the accessibility spec for RenderSpec from Cook inputs.
 *
 * Pure function. Deterministic. No store access. No runtime awareness.
 * If a concern changes during gameplay → it does NOT belong here.
 */
export function deriveA11ySpec(_input: A11yStatic): A11ySpec {
  throw new Error('not implemented')
}
