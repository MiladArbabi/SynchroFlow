// apps/frontend/src/pages/wms/useWmsAnalytics.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

// ─── ZONE 1 — LIVE CAPACITY ───────────────────────────────────
export type LiveCapacity = {
  pipeline: {
    awaiting_pick: number;
    picking: number;
    packing: number;
    ship_ready: number;
    shipped: number;
  };
  operators_on_shift: number;
  active_operators: number;
  cpt_local: string | null;
  hours_to_cpt: number | null;
  live_uph: number | null;
  required_uph: number | null;
  standard_uph: number | null;
  on_track: 'green' | 'amber' | 'red' | null;
  shipped_today: number;
  unfulfilled_orders: number;
};

// ─── ZONE 2 — OPERATOR PERFORMANCE ───────────────────────────
export type OperatorPerf = {
  user_id: number;
  first_name: string | null;
  last_name: string | null;
  role: string;
  picks: number;
  packs: number;
  batches_picked: number;
  uph: number | null;
  accuracy_pct: number | null;
  exception_count: number;
  avg_batch_seconds: number | null;
  scan_source_mix: Record<string, number>;
};

// ─── ZONE 3 — PIPELINE VELOCITY ───────────────────────────────
export type PipelineVelocity = {
  stages: {
    released_to_picking_s: number | null;
    picking_s: number | null;
    packing_s: number | null;
    packed_to_shipped_s: number | null;
  };
  latencies: {
    receive_to_pickable_hours: number | null;
    receive_to_pickable_samples: number;
    return_to_restock_hours: number | null;
  };
};

// ─── ZONE 4 — EXCEPTION INTELLIGENCE ─────────────────────────
export type ExceptionSku = {
  lasyncro_variant_id: string;
  title: string | null;
  sku: string | null;
  exception_count: number;
  type_breakdown: Record<string, number>;
};

export type HeatGridRow = {
  user_id: number;
  name: string;
  pick_exception_rate_pct: number;
  pack_exception_rate_pct: number;
};

export type ExceptionIntelligence = {
  top_skus: ExceptionSku[];
  heat_grid: HeatGridRow[];
};

// ─── ZONE 5 — COST & THROUGHPUT ───────────────────────────────
export type CostStory = {
  unlocked: boolean;
  total_cost: number | null;
  cost_per_order: number | null;
  cost_per_unit: number | null;
  exception_cost: number | null;
  orders_shipped: number;
  editorial: string | null;
};

// ─── COMPOSITE RESPONSE ───────────────────────────────────────
export type WmsAnalyticsResponse = {
  live: LiveCapacity;
  operators: OperatorPerf[];
  pipeline: PipelineVelocity;
  exceptions: ExceptionIntelligence;
  cost: CostStory;
  days: number;
};

/**
 * useWmsAnalytics
 * ---------------
 * Composite hook — all 5 zones in one request.
 * Date-range zones (2–5): 5-minute refetch.
 * Zone 1 (live) is polled separately via useLiveCapacity (60s).
 */
export function useWmsAnalytics(days = 30) {
  return useQuery<WmsAnalyticsResponse>({
    queryKey: ['wms', 'analytics', 'full', days],
    queryFn: async () => {
      const { data } = await axiosInstance.get(`/api/v1/wms/analytics?days=${days}`);
      return data;
    },
    refetchInterval: 300_000,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });
}

/**
 * useLiveCapacity
 * ---------------
 * Zone 1 only — polls every 60 seconds.
 * Always live, ignores date toggle.
 */
export function useLiveCapacity() {
  return useQuery<LiveCapacity>({
    queryKey: ['wms', 'analytics', 'live'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/analytics/live');
      return data;
    },
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
    staleTime: 0,
  });
}