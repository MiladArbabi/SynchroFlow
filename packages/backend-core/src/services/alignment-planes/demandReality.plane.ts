import { AlignmentPlane, AlignmentResult } from './alignmentPlane.types.js';

/**
 * Demand Reality Plane
 * -------------------
 * Customers ↔ Orders
 *
 * Classifies whether customer engagement
 * manifests as economically observed orders.
 *
 * FT2-only. Deterministic. Fail-closed.
 */
export interface DemandRealityInput {
  customers: {
    engagementTrend: 'up' | 'down' | 'flat' | null;
    visibility: 'sufficient' | 'insufficient' | null;
  };
  orders: {
    trend: 'up' | 'down' | 'flat' | null;
    outcome: 'positive' | 'negative' | null;
    visibility: 'sufficient' | 'insufficient' | null;
  };
}

export const demandRealityPlane: AlignmentPlane<DemandRealityInput> = {
  planeId: 'demand-reality',

  compute(input): AlignmentResult {
    const { customers, orders } = input;

    // Visibility gate (hard)
    if (
      customers.visibility !== 'sufficient' ||
      orders.visibility !== 'sufficient'
    ) {
      return 'unknown';
    }

    const { engagementTrend } = customers;
    const { trend, outcome } = orders;

    // Missing signals
    if (!engagementTrend || !trend || !outcome) {
      return 'unknown';
    }

    // Outcome breaker
    if (outcome === 'negative') {
      return 'divergent';
    }

    // Alignment logic
    if (engagementTrend === 'up' && trend === 'up') {
      return 'aligned';
    }

    if (engagementTrend === 'flat' && trend === 'up') {
      return 'aligned';
    }

    if (engagementTrend === 'up' && trend !== 'up') {
      return 'divergent';
    }

    if (engagementTrend === 'down' && trend === 'up') {
      return 'divergent';
    }

    return 'unknown';
  },
};