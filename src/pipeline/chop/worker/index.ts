import type { CutsReady } from '../../types'

/**
 * Chop worker entry point. Runs WASM cut + palette derivation off the main
 * thread. Output crosses the worker boundary as `CutsReady`.
 */
export async function runChopWorker(): Promise<CutsReady> {
  throw new Error('not implemented')
}
