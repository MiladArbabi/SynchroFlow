/**
 * FT0 Phase & Readiness Derivation
 * --------------------------------
 *
 * This function defines the **single source of truth** for FT0 state.
 *
 * Principles (HARD INVARIANTS):
 * 1. FT0 readiness is backend-derived — never inferred by UI.
 * 2. Integration completion is necessary but NOT sufficient.
 * 3. A first FT0 insight execution is required to declare readiness.
 * 4. FAILED insight execution blocks FT0 readiness.
 * 5. EMPTY and DEGRADED executions are valid readiness outcomes.
 *
 * This logic is intentionally strict to prevent:
 * - premature dashboard exposure
 * - UI-driven state divergence
 * - non-reproducible onboarding behavior
 *
 * Any change here MUST be accompanied by test changes.
 */

import { FT0Phase, IntegrationSnapshot, SyncStatus } from './types';

/**
 * FT0 insight execution snapshot required to declare readiness.
 * This is intentionally minimal and audit-friendly.
 */
export type FT0InsightExecutionSnapshot = {
  attempted: boolean;
  status: 'SUCCESS' | 'EMPTY' | 'DEGRADED' | 'FAILED' | null;
};

/**
 * Input contract for FT0 derivation.
 * All inputs are factual, backend-derived signals.
 */
export type DeriveFT0PhaseInput = {
  integrations: IntegrationSnapshot[];
  ft0InsightExecution: FT0InsightExecutionSnapshot;
};

/**
 * Output contract.
 * Phase and readiness are intentionally separated.
 */
export type DeriveFT0PhaseResult = {
  phase: FT0Phase;
  ready: boolean;
};

/**
 * deriveFT0Phase
 * --------------
 * Determines FT0 phase AND readiness deterministically.
 */
export function deriveFT0Phase(
  input: DeriveFT0PhaseInput
): DeriveFT0PhaseResult {
  const { integrations, ft0InsightExecution } = input;

  // ─────────────────────────────────────────────
  // 1. No integrations → PRE_INTEGRATION
  // ─────────────────────────────────────────────
  if (integrations.length === 0) {
    return {
      phase: 'PRE_INTEGRATION',
      ready: false,
    };
  }

  // ─────────────────────────────────────────────
  // 2. Integration exists but none completed → SYNCING
  // ─────────────────────────────────────────────
  const hasCompletedIntegration = integrations.some(
    i => i.syncStatus === 'COMPLETED'
  );

  if (!hasCompletedIntegration) {
    return {
      phase: 'SYNCING',
      ready: false,
    };
  }

  // ─────────────────────────────────────────────
  // 3. Integration completed → RESOLVED phase
  //    Readiness depends on FT0 insight execution
  // ─────────────────────────────────────────────
  if (!ft0InsightExecution.attempted) {
    return {
      phase: 'RESOLVED',
      ready: false,
    };
  }

  // ─────────────────────────────────────────────
  // 4. Insight execution attempted → evaluate outcome
  // ─────────────────────────────────────────────
  switch (ft0InsightExecution.status) {
    case 'SUCCESS':
    case 'EMPTY':
    case 'DEGRADED':
      return {
        phase: 'RESOLVED',
        ready: true,
      };

    case 'FAILED':
    default:
      return {
        phase: 'RESOLVED',
        ready: false,
      };
  }
}
