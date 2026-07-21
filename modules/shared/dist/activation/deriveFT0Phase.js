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
export function deriveFT0Phase(integrations, ft0Completed) {
    if (integrations.length === 0) {
        return 'PRE_INTEGRATION';
    }
    if (ft0Completed) {
        return 'COMPLETED';
    }
    return 'SYNCING';
}
