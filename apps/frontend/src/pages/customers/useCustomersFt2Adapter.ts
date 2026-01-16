// apps/frontend/src/pages/customers/useCustomersFt2Adapter.ts

import type { CustomersModuleFT2Props } from '@lasyncro/customers';

/**
 * Customers FT2 Snapshot
 * ---------------------
 * Raw backend payload for FT2 observability.
 *
 * Rules:
 * - All fields optional
 * - Undefined MUST normalize to null
 * - Adapter must never invent meaning
 */
type CustomersFt2Snapshot = {
  period?: {
    from: string;
    to: string;
  };

  /**
   * Count of anonymous sessions observed by Specter.
   */
  sessionsObserved?: number | null;

  /**
   * Backend-derived system health indicator.
   */
  systemState?: {
    status: 'healthy' | 'degraded' | 'partial' | 'unknown';
    confidence: 'high' | 'medium' | 'low';
    reason?: string;
  } | null;

  /**
   * Backend-derived trend signal.
   */
  timeSignal?: {
    trend:
      | 'improving'
      | 'deteriorating'
      | 'stable'
      | 'volatile'
      | 'unknown';
    comparedPeriod?: {
      from: string;
      to: string;
    };
  } | null;
};

/**
 * mapCustomersFt2Props
 * -------------------
 * Pure, side-effect-free adapter.
 *
 * Invariants:
 * - No inference
 * - No computed fields
 * - Undefined → null normalization only
 * - Shape-stable output
 */
export function mapCustomersFt2Props(
  snapshot: CustomersFt2Snapshot
): CustomersModuleFT2Props {
  return {
    context: {
      period: snapshot.period ?? { from: null, to: null },

      sessionsObserved:
        snapshot.sessionsObserved === undefined
          ? null
          : snapshot.sessionsObserved,
    },

    systemState:
      snapshot.systemState === undefined
        ? null
        : snapshot.systemState,

    timeSignal:
      snapshot.timeSignal === undefined
        ? null
        : snapshot.timeSignal,
  };
}
