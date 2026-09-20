// apps/frontend/src/pages/operations/useHistory.ts
//
// OPS-CONSOLE-HISTORY-01 — canonical shop-wide HISTORY V1 feed query hook.
//
// Follows the same conventions as useWaiting.ts: an authenticated
// axiosInstance read, react-query caching, a typed response matching the
// real backend contract verbatim. This type is the ONLY place the frontend
// declares the shape of a HISTORY item — consumers must read
// `presentation`/`routing` as-is and must never re-derive copy, a route, or
// business meaning from `treatment`, `constraintType` or `blockType`.

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type HistoryItem = {
  interventionId: string;
  treatment: string;
  lasyncroOrderId: string;
  externalOrderId: string | null;
  constraintId: string;
  constraintType: string | null;
  blockType: string | null;
  occurredAt: string;
  resolvedAt: string;
  outcome: 'verified_resolved';
  presentation: {
    title: string;
    subtitle: string;
    actionLabel: string;
  };
  // HISTORY-ORDER-ENTITY-01 — HISTORY's destination is always the order
  // entity modal, never a page: no `route` field. lasyncroOrderId is
  // ratified and consumed verbatim (opsConsoleModel.ts's buildHistoryRows).
  routing: {
    kind: 'order_entity';
    lasyncroOrderId: string;
  };
};

export type HistoryResponse = {
  items: HistoryItem[];
};

export type UseHistoryOptions = {
  /** Lifecycle-neutral query gate, mirroring useWaiting's `enabled`. Defaults to `true`. */
  enabled?: boolean;
};

/**
 * useHistory
 * ----------
 * Fetches the canonical shop-wide HISTORY V1 feed (GET /api/v1/operations/history).
 * No client-side filtering or re-classification: the backend already
 * restricts to the V1 treatment/constraint pairing allowlist, verified_resolved
 * outcomes only, one row per resolved episode, 30-day retention, and
 * newest-resolvedAt-first ordering.
 *
 * No polling: HISTORY is a fixed record of what already resolved, not a live
 * attention surface — fetched only while the console/tab is open, mirroring
 * the prior alert-history read's own no-poll precedent.
 */
export function useHistory(options: UseHistoryOptions = {}) {
  const enabled = options.enabled ?? true;

  return useQuery<HistoryResponse>({
    queryKey: ['operations', 'history'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/operations/history');
      return data;
    },
    enabled,
    refetchInterval: false,
    placeholderData: (prev) => prev,
  });
}
