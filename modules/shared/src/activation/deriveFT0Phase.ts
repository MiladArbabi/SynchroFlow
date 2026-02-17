/**
 * ⚠️ DEPRECATED FOR USER LIFECYCLE DECISIONS
 *
 * This module ONLY describes *integration-level FT0 technical state*.
 * It MUST NOT be used to determine:
 *  - User lifecycle phase
 *  - UI gating
 *  - Pricing / entitlements
 *
 * Canonical user lifecycle lives in:
 *   services/lifecycle.service.ts
 */

import { FT0Phase, IntegrationSnapshot } from './types.js';

export function deriveFT0Phase(
  integrations: IntegrationSnapshot[],
  ft0Completed: boolean
): FT0Phase {
  if (integrations.length === 0) {
    return 'PRE_INTEGRATION';
  }

  if (ft0Completed) {
    return 'COMPLETED'; 
  }

  return 'SYNCING';
}
