/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * deriveInitialLifecycleState
 * ---------------------------
 * STEP 2: Lifecycle authority correction
 *
 * Frontend must NOT infer lifecycle from:
 * - localStorage
 * - prior sessions
 * - readiness
 *
 * Initial lifecycle is always unknown until
 * backend /api/v1/lifecycle resolves.
 */
import { LifecycleState, initialLifecycleState } from './lifecycleTypes';

export function deriveInitialLifecycleState(
  _shopId: number | null
): LifecycleState {
  return initialLifecycleState;
}
