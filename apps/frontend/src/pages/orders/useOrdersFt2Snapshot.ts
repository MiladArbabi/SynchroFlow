// apps/frontend/src/pages/orders/useOrdersFt2Snapshot.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { FT2DateRange } from '@lasyncro/ui-ft2';

export type OrdersFt2Snapshot = {

  orders?: {
    active?: number | null;
    fulfilled?: number | null;
    added?: number | null;
  };


  /**
   * ─────────────────────────────────────────
   * REVENUE OVERVIEW (FT2)
   * Availability-based only.
   * ─────────────────────────────────────────
   *
   * Contract:
   * - Mirrors backend FT2 snapshot exactly
   * - No execution or payment semantics
   * - No inference
   */
  revenue?: {
    totalSales?: number | null;
    earned?: number | null;
    pending?: number | null;
    blocked?: number | null;
    executionCoverage?: 'sufficient' | 'insufficient';
  };

  /**
   * ─────────────────────────────────────────
   * Obligation Overview (FT2)
   * Downgraded, read-only.
   * ─────────────────────────────────────────
   */
  obligations?: {
    totalBlockedValue: number | null;

    blockedBy: {
      inventory: number | null;
      customer: number | null;
      operational: number | null;
      other: number | null;
    } | null;

    coverage: {
      status: 'sufficient' | 'insufficient';
    };
  };

  /**
   * Returns — post-execution regression
   * -----------------------------------
   * Financial only.
   * Does NOT affect eligibility or execution.
   */
  refunds?: {
    returnedRevenue: number | null;
    returnedUnits: number | null;
    affectedOrders: number | null;
  };

  comparison?: {
    orders?: {
      totalPctChange?: number | null;
      fulfilledPctChange?: number | null;
      unfulfilledPctChange?: number | null;
      incomingPctChange?: number | null;
    };
  };

  context?: {
    ordersObserved?: number | null;
  };

  totals?: {
    revenueTotal?: number | null;
    costTotal?: number | null;
    /**
     * FT2 Snapshot
     * ------------
     * Currency is intentionally absent.
     */
    // currency removed per FT2 contract
    /* currency?: string | null; */
  };

  outcome?: {
    /**
     * FT2 Outcome
     * -----------
     * Directional classification only.
     * No causation, no explanation, no recommendation.
     */
    status: 'positive' | 'negative';
  } | null;

  trend?: {
    direction: 'up' | 'down' | 'flat';
  } | null;

  dataCoverage?: {
    completenessPct?: number | null;
  };

    visibility?: {
    status: 'sufficient' | 'insufficient';
  } | null;

  /**
   * ─────────────────────────────────────────
   * 🧭 SYSTEM GROUNDING (FT2)
   * Presence & classification only.
   * ─────────────────────────────────────────
   */

  ingestion?: {
    status: 'present' | 'absent';
  } | null;

  freshness?: {
    status: 'recent' | 'stale' | 'unknown';
  } | null;

  /**
   * Revenue signal continuity (L1½).
   * Classification only. Not a trend.
   */
  revenueContinuity?: {
    status: 'isolated' | 'continuous';
  } | null;

  /**
   * ─────────────────────────────────────────
   * STRUCTURAL COHERENCE
   * ─────────────────────────────────────────
   */
  alignment?: {
    demandReality?: 'aligned' | 'divergent' | 'unknown';
    engagementRevenue?: 'aligned' | 'divergent' | 'unknown';
    operationalEconomic?: 'aligned' | 'divergent' | 'unknown';
  };
};

/**
 * useOrdersFt2Snapshot
 * -------------------
 * Fetches authoritative FT2 Order-Nexus snapshot.
 *
 * Rules:
 * - Backend-owned period
 * - No params
 * - Read-only
 * - No transformation
 */
export function useOrdersFt2Snapshot(range: FT2DateRange) {
  return useQuery<OrdersFt2Snapshot>({
    queryKey: [
      'order-nexus',
      'ft2',
      range.preset,
      range.from,
      range.to,
    ],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/order-nexus/ft2',
        {
        params:
          range.preset === 'custom'
            ? {
                preset: 'custom',
                from: range.from,
                to: range.to,
              }
            : {
                preset: range.preset,
            },
        });
      return data;
    },
  });
}
