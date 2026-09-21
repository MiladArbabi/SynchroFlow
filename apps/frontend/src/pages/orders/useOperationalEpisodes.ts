// apps/frontend/src/pages/orders/useOperationalEpisodes.ts
//
// SLICE D1 — typed read hook for GET /api/v1/operations/episodes.
// SLICE D3A — widened lifecycle union to match the backend contract.
//
// This hook performs NO lifecycle inference. lifecycle ('attention' |
// 'verifying' | 'just_resolved') is canonical backend truth — composed from
// order_constraints and readCurrentWaitingV1Records() by
// apps/backend/src/services/operations/operationalEpisodeRead.service.ts
// (SLICE D0, widened in D3A) — and is returned here exactly as the backend
// sent it.
//
// D3A NOTE: the production endpoint (operations.controller.ts) is
// untouched in D3A and never supplies the backend's opt-in `justResolved`
// policy, so GET /api/v1/operations/episodes still only ever returns
// 'attention' | 'verifying' today. The union is widened here now so the
// frontend contract does not need a second migration when D3B ratifies a
// recovery window and the endpoint begins emitting 'just_resolved'.
//
// D2B NOTE: refetchInterval/staleTime below lock the Orders live-refresh
// cadence (matches the existing Orders live-activity surface). No
// Date.now()/timer/lifecycle inference is added here — lifecycle remains
// exactly what the backend sent (D3B's ratified 5-minute recovery window is
// backend-owned, see operations.controller.ts).

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type OperationalEpisodeLifecycleV1 = 'attention' | 'verifying' | 'just_resolved';

export type OperationalEpisodeTreatmentV1 = 'address_correction' | 'inventory_reorder_intent';

/**
 * Exact field-for-field match of D0's GET /api/v1/operations/episodes item
 * shape (operations.controller.ts's OperationalEpisodeItem). No field is
 * renamed, reshaped, or derived here.
 */
export interface OperationalEpisodeItem {
  episodeId: string;
  constraintId: string;
  constraintStartedAt: string;
  lasyncroOrderId: string;
  constraintType: string;
  blockType: string;
  targetId: string | null;
  lifecycle: OperationalEpisodeLifecycleV1;
  occurredAt: string;
  treatment: OperationalEpisodeTreatmentV1;
  interventionId: string | null;
}

interface OperationalEpisodesResponse {
  items: OperationalEpisodeItem[];
}

export const OPERATIONAL_EPISODES_QUERY_KEY = ['operations', 'episodes'] as const;

/**
 * useOperationalEpisodes
 * -----------------------
 * Reads the shop-wide canonical operational-episode V1 list. Returns the
 * raw item array — projection into the shared OperationalEpisodeProjection
 * contract happens separately in ordersOperationalEpisodeProjection.ts, and
 * this hook has no opinion on it.
 */
export function useOperationalEpisodes() {
  return useQuery<OperationalEpisodeItem[]>({
    queryKey: OPERATIONAL_EPISODES_QUERY_KEY,
    queryFn: async () => {
      const { data } = await axiosInstance.get<OperationalEpisodesResponse>(
        '/api/v1/operations/episodes'
      );
      return data.items;
    },
    staleTime: 0,
    refetchInterval: 15_000,
  });
}
