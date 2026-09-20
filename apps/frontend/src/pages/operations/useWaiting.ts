// apps/frontend/src/pages/operations/useWaiting.ts
//
// OPS-CONSOLE-WAITING-01 — canonical shop-wide WAITING feed query hook.
//
// Follows the same conventions as pages/decisions/useDecisions.ts: an
// authenticated axiosInstance read, react-query caching, a typed response
// matching the real backend contract verbatim. This type is the ONLY place
// the frontend declares the shape of a WAITING item — consumers must read
// `presentation`/`routing` as-is and must never re-derive copy, a route, or
// business meaning from `treatment`, `constraintType` or `blockType`.

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type WaitingItem = {
  interventionId: string;
  treatment: string;
  lasyncroOrderId: string;
  externalOrderId: string | null;
  constraintId: string;
  constraintType: string | null;
  blockType: string | null;
  occurredAt: string;
  outcome: 'pending_verification';
  presentation: {
    title: string;
    subtitle: string;
    actionLabel: string;
  };
  routing: {
    route: string;
  };
};

export type WaitingResponse = {
  items: WaitingItem[];
};

export type UseWaitingOptions = {
  /** Lifecycle-neutral query gate, mirroring useAlerts'/useDecisions' `enabled`. Defaults to `true`. */
  enabled?: boolean;
};

/**
 * useWaiting
 * ----------
 * Fetches the canonical shop-wide WAITING feed (GET /api/v1/operations/waiting).
 * No client-side filtering or re-classification: the backend already
 * excludes anything outside the V1 treatment allowlist and anything whose
 * outcome is not pending_verification.
 *
 * Polling: 60s, matching useDecisions.ts's cadence — this read has no
 * single-shell-owner ownership contention to arbitrate.
 */
export function useWaiting(options: UseWaitingOptions = {}) {
  const enabled = options.enabled ?? true;

  return useQuery<WaitingResponse>({
    queryKey: ['operations', 'waiting'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/operations/waiting');
      return data;
    },
    enabled,
    refetchInterval: enabled ? 60_000 : false,
    placeholderData: (prev) => prev,
  });
}
