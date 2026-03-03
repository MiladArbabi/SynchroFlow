// apps/frontend/src/pages/orders/useOrdersControlSnapshot.ts
//
// Phase 1 — Orders Operational Control Snapshot Hook
// ---------------------------------------------------
// Contract:
// - Snapshot-backed only
// - No params
// - No transformation
// - No inference
// - Deterministic passthrough
// - Null is valid and must be preserved
//
// This hook MUST remain a pure transport layer.
// Any computation belongs to backend projection.

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

/**
 * OrdersOperationalControlSnapshot
 * --------------------------------
 * Mirrors backend table:
 * orders_operational_control_snapshot
 *
 * No optional metrics.
 * All numeric fields are non-nullable in DB.
 * API may return null (no snapshot yet).
 */
export type OrdersOperationalControlSnapshot = {
  shop_id: number;
  snapshot_date: string;
  aggregate_version: number;

  realized_revenue: number;
  at_risk_revenue: number;
  blocked_revenue: number;
  revenue_leakage: number;
  avg_contribution_margin_pct: number;

  orders_at_sla_risk: number;
  aging_24h: number;
  aging_48h: number;
  aging_72h_plus: number;
  pending_fulfillment: number;
  pending_payment: number;
  exception_orders: number;

  constrained_orders: number;
  revenue_blocked_inventory: number;
  revenue_blocked_customer: number;
  revenue_blocked_operational: number;

  queue_manual_review: number;
  queue_awaiting_inventory: number;
  queue_ready_to_ship: number;
  queue_awaiting_customer: number;

  evaluated_at: string;
};

/**
 * useOrdersControlSnapshot
 * ------------------------
 * Fetches authoritative Phase 1 Control Tower snapshot.
 *
 * MUST:
 * - Never compute
 * - Never default
 * - Never reinterpret fields
 * - Preserve null from API
 */
export function useOrdersControlSnapshot() {
  return useQuery<OrdersOperationalControlSnapshot | null>({
    queryKey: ['orders', 'operational-control'],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/orders/operational-control'
      );

      return data ?? null;
    },
  });
}