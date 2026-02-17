/**
  * RO-Overview — Render Intelligence (INTERNAL ONLY)
  *
  * ⚠️ HARD CONSTRAINTS:
  * - Used ONLY for UI render gating
  * - Must NEVER shape FT2 snapshots
  * - Must NEVER influence resolver output
  * - Must NEVER act as domain intelligence
  *
  * If this logic affects data exposure,
  * the architecture is broken.
  */

import { ROOverviewFacts } from './roOverviewFacts.service.js';

export type RORenderMode = 'renderable' | 'collapsed' | 'blocked';

export function classifyRORenderMode(
  facts: ROOverviewFacts
): RORenderMode {
  if (facts.trustSurfacePresent !== true) {
    return 'blocked';
  }

  if (facts.trustEligibleObserved !== true) {
    return 'collapsed';
  }

  return 'renderable';
}