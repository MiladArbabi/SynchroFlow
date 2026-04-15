// apps/frontend/src/pages/orders/useOrdersFt2Snapshot.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import { OrdersModuleFT2DataProps } from '@lasyncro/order-nexus';

export type OrdersFt2Snapshot = {

  orders?: {
    total?: number | null;
    fulfilled?: number | null;
    unfulfilled?: number | null;
    constrained?: number | null;
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
  };

  /**
   * ─────────────────────────────────────────
   * DECISION SURFACE (FT2)
   * Backend authoritative signals.
   * ─────────────────────────────────────────
   *
   * Contract:
   * - Produced by reconciliation projections
   * - Embedded in FT2 snapshot
   * - UI must not recompute or refetch
   *
   * NOTE:
   * Legacy `priorityStack` removed.
   * Operations execution now driven by
   * operationalControl snapshot signals.
   */
  decision?: {
    brief: {
      ready_to_ship: number;
      awaiting_customer: number;
      inventory_blocked_revenue: number;
      manual_review: number | string;
    } | null;
  };

  operationalControl?: OrdersModuleFT2DataProps['operationalControl'];

  /**
   * ─────────────────────────────────────────
   * Obligation Overview (FT2)
   * Downgraded, read-only.
   * ─────────────────────────────────────────
   */
  obligations?: {
    totalBlockedValue: number | null;
    /**
     * blockedBy breakdown is NOT produced by the backend FTEP layer.
     * Do not add attribution fields here — FT2 obligations are aggregate-only.
     * See: orderFtep.types.ts FT2ObligationsExposure
     */
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
export function useOrdersFt2Snapshot() {
  return useQuery<OrdersFt2Snapshot>({
    queryKey: ['order-nexus', 'ft2'],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/order-nexus/ft2');
      return data;
    },
  });
}
