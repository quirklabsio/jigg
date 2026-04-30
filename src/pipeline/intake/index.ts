import type { IntakeResult } from '../types'

/**
 * Intake stage entry point.
 * Accepts raw input (image bytes or `.jigg` archive). Validates, normalizes,
 * and identifies which downstream path is required.
 */
export async function runIntake(): Promise<IntakeResult> {
  throw new Error('not implemented')
}
