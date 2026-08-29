/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/alerts/useAlerts.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

/**
 * CONSEQUENCE TAXONOMY CATEGORIES (blueprint §6)
 * -----------------------------------------------
 * Maps to AlertCategoryGroup labels + icons in the UI.
 */
export type AlertCategory =
  | 'revenue_at_risk'
  | 'stock_reorder'
  | 'money_margin'
  | 'supplier_inbound'
  | 'warehouse_floor'
  | 'data_trust';

export type AlertAudience = 'operator' | 'owner' | 'all';

export type Alert = {
  id: string;
  alert_key: string;
  source: string;
  alert_type: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  entity_id: string | null;
  entity_type: string | null;
  revenue_impact: string | null;
  // Consequence taxonomy — optional until backend backfill completes
  category: AlertCategory | null;
  audience: AlertAudience;
  // Lifecycle
  is_active: boolean;
  dismissed_at: string | null;
  resolved_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: number | null;
  snoozed_until: string | null;
  escalated_at: string | null;
  rule_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AlertsResponse = {
  data: Alert[];
  meta: {
    total: number;
    status: string;
  };
};

/**
 * Tab status values — mirror ModuleTabBar tabs (blueprint §3)
 * inbox    : active, not currently snoozed (default)
 * snoozed  : parked until snoozed_until expires
 * resolved : auto or owner-resolved history
 */
export type AlertStatus = 'inbox' | 'snoozed' | 'resolved';

export type AlertFilters = {
  status?: AlertStatus;
  category?: AlertCategory;
  severity?: Alert['severity'];
  source?: string;
};

/** Filters after canonicalization — `status` always present, no `undefined` keys. */
export type NormalizedAlertFilters = {
  status: AlertStatus;
  category?: AlertCategory;
  severity?: Alert['severity'];
  source?: string;
};

// ─── QUERIES ──────────────────────────────────────────────────────────────────

/**
 * normalizeAlertFilters
 * ---------------------
 * Collapse equivalent filter inputs to one canonical shape so query-cache
 * identity and request identity cannot drift:
 *
 *   normalizeAlertFilters({})                 => { status: 'inbox' }
 *   normalizeAlertFilters({ status: 'inbox' })=> { status: 'inbox' }
 *
 * `undefined` properties are dropped, so `useAlerts()` and
 * `useAlerts({ status: 'inbox' })` produce the SAME queryKey
 * (`['alerts', { status: 'inbox' }]`) and the SAME URL
 * (`/api/v1/alerts?status=inbox`) — one cache entry, one request.
 */
export function normalizeAlertFilters(
  filters: AlertFilters = {},
): NormalizedAlertFilters {
  const normalized: NormalizedAlertFilters = { status: filters.status ?? 'inbox' };
  if (filters.category) normalized.category = filters.category;
  if (filters.severity) normalized.severity = filters.severity;
  if (filters.source)   normalized.source = filters.source;
  return normalized;
}

export type UseAlertsOptions = {
  /**
   * Lifecycle-neutral query gate. Defaults to `true` so every existing caller
   * keeps its current behaviour. Callers mounted in the always-on application
   * shell (e.g. the topnav bell) pass `false` until the merchant has confirmed
   * FT2, so no request/retry/poll/focus-refetch hits the FT2-protected
   * `/api/v1/alerts` endpoint while the shop is still FT1.
   */
  enabled?: boolean;
  /**
   * Opt-in ownership of the recurring 30s live-inbox refetch. Defaults to
   * `false`: an unspecified caller is a passive cache reader (it still fetches
   * on mount/focus where React Query requires it, but schedules no interval).
   * Exactly one persistent shell observer (the topnav) passes `true` so the
   * live cadence has a single owner instead of one timer per call site.
   */
  poll?: boolean;
};

/**
 * useAlerts
 * ---------
 * Fetches ranked alert inbox with tab + filter support.
 *
 * Live inbox polling is opt-in via `{ poll: true }` — only one persistent
 * shell observer owns the 30s cadence; every other caller is a passive cache
 * reader. Historical tabs (`snoozed` / `resolved`) never poll even with
 * `poll: true`. Filters are canonicalized (`normalizeAlertFilters`) so
 * equivalent calls share one cache entry and one request.
 */
export function useAlerts(
  filters: AlertFilters = {},
  options: UseAlertsOptions = {},
) {
  const normalized = normalizeAlertFilters(filters);
  const { status, category, severity, source } = normalized;
  const enabled = options.enabled ?? true;
  const poll = options.poll ?? false;

  return useQuery<AlertsResponse>({
    queryKey: ['alerts', normalized],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('status', status);
      if (category) params.set('category', category);
      if (severity) params.set('severity', severity);
      if (source)   params.set('source', source);

      const { data } = await axiosInstance.get(`/api/v1/alerts?${params.toString()}`);
      return data;
    },
    enabled,
    // Recurring interval is owned by a single opt-in caller; only the live
    // inbox is eligible — snoozed/resolved are historical.
    refetchInterval: enabled && poll && status === 'inbox' ? 30_000 : false,
    placeholderData: (prev) => prev,
  });
}

/**
 * useAlertCount
 * -------------
 * Active inbox count — feeds sidenav health dot (B-07 calm dot).
 */
export function useAlertCount(): number {
  const { data } = useAlerts({ status: 'inbox' });
  return data?.meta?.total ?? 0;
}

// ─── MUTATIONS ────────────────────────────────────────────────────────────────

/**
 * Shared optimistic removal helper.
 * Removes the alert from cache immediately; rolls back on error.
 */
function useOptimisticRemove(queryClient: ReturnType<typeof useQueryClient>) {
  return async (alertId: string) => {
    await queryClient.cancelQueries({ queryKey: ['alerts'] });
    const snapshots = new Map<unknown[], AlertsResponse>();

    queryClient.getQueriesData<AlertsResponse>({ queryKey: ['alerts'] })
      .forEach(([key, data]) => {
        if (data) {
          snapshots.set(key as unknown[], data);
          queryClient.setQueryData<AlertsResponse>(key as unknown[], {
            ...data,
            data: data.data.filter(a => a.id !== alertId),
            meta: { ...data.meta, total: Math.max(0, data.meta.total - 1) },
          });
        }
      });

    return { snapshots };
  };
};

type MutationRollbackContext = {
  snapshots: Map<unknown[], AlertsResponse>;
};

/**
 * useAcknowledgeAlert
 * -------------------
 * Operator marks alert as seen — stays in Inbox with muted styling.
 * Optimistic: updates cache immediately, rolls back on error.
 */
export function useAcknowledgeAlert() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (alertId: string) => {
      await axiosInstance.post(`/api/v1/alerts/${alertId}/acknowledge`);
    },
    onMutate: async (alertId) => {
      // Optimistically update acknowledged_at in all alert caches
      await queryClient.cancelQueries({ queryKey: ['alerts'] });
      const snapshots = new Map<unknown[], AlertsResponse>();

      queryClient.getQueriesData<AlertsResponse>({ queryKey: ['alerts'] })
        .forEach(([key, data]) => {
          if (data) {
            snapshots.set(key as unknown[], data);
            queryClient.setQueryData<AlertsResponse>(key as unknown[], {
              ...data,
              data: data.data.map(a =>
                a.id === alertId
                  ? { ...a, acknowledged_at: new Date().toISOString() }
                  : a
              ),
            });
          }
        });

      return { snapshots };
    },
    onError: (_err, _alertId, context: MutationRollbackContext | undefined) => {
      context?.snapshots?.forEach((data, key) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });
}

/**
 * useSnoozeAlert
 * --------------
 * Parks alert until `until` ISO timestamp — moves to Snoozed tab.
 * Optimistic: removes from current view immediately.
 */
export function useSnoozeAlert() {
  const queryClient = useQueryClient();
  const optimisticRemove = useOptimisticRemove(queryClient);

  return useMutation<void, Error, { alertId: string; until: string }>({
    mutationFn: async ({ alertId, until }) => {
      await axiosInstance.post(`/api/v1/alerts/${alertId}/snooze`, { until });
    },
    onMutate: async ({ alertId }) => optimisticRemove(alertId),
    onError: (_err, _vars, context: MutationRollbackContext | undefined) => {
      context?.snapshots?.forEach((data, key) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });
}

/**
 * useResolveAlert
 * ---------------
 * Owner/admin manual resolve — moves alert to Resolved tab.
 * Gated at UI level; backend enforces role check (403 for operators).
 * Optimistic: removes from current view immediately.
 */
export function useResolveAlert() {
  const queryClient = useQueryClient();
  const optimisticRemove = useOptimisticRemove(queryClient);

  return useMutation<void, Error, string>({
    mutationFn: async (alertId: string) => {
      await axiosInstance.post(`/api/v1/alerts/${alertId}/resolve`);
    },
    onMutate: async (alertId) => optimisticRemove(alertId),
    onError: (_err, _alertId, context: MutationRollbackContext | undefined) => {
      context?.snapshots?.forEach((data, key) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });
}

/**
 * useDismissAlert — DEPRECATED (KI-2)
 * ------------------------------------
 * Aggregator re-upserted is_active=true on every snapshot cycle,
 * making dismiss silently ineffective. Retired in favour of
 * acknowledge (operator) + auto-resolve (system) + resolve (owner).
 * Kept as a no-op stub to prevent import errors during migration.
 * Remove once all call sites are cleaned up.
 *
 * @deprecated Use useAcknowledgeAlert or useResolveAlert instead.
 */
export function useDismissAlert() {
  return {
    mutate: (_alertId: string) => {
      console.warn('[useDismissAlert] deprecated — use useAcknowledgeAlert or useResolveAlert');
    },
  };
}