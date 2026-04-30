import type { CutsReady } from '../../types'

/**
 * Chop host-side entry point. Drives the Web Worker, marshals input/output.
 * No WASM or geometry work runs here — only message coordination.
 */
export async function runChopHost(): Promise<CutsReady> {
  throw new Error('not implemented')
}
