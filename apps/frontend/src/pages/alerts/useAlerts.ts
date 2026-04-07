// apps/frontend/src/pages/alerts/useAlerts.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

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
  is_active: boolean;
  dismissed_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AlertsResponse = {
  data: Alert[];
  meta: {
    total: number;
    active_only: boolean;
  };
};

/**
 * useAlerts
 * ---------
 * Fetches ranked operator alert inbox.
 * Polls every 30s — matches snapshot cycle cadence.
 */
export function useAlerts() {
  return useQuery<AlertsResponse>({
    queryKey: ['alerts'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/alerts');
      return data;
    },
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}

/**
 * useDismissAlert
 * ---------------
 * Operator dismisses an alert — optimistically removes from inbox.
 */
export function useDismissAlert() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (alertId: string) => {
      await axiosInstance.post(`/api/v1/alerts/${alertId}/dismiss`);
    },

    onMutate: async (alertId) => {
      await queryClient.cancelQueries({ queryKey: ['alerts'] });
      const previous = queryClient.getQueryData<AlertsResponse>(['alerts']);

      queryClient.setQueryData<AlertsResponse>(['alerts'], (old) => {
        if (!old) return old;
        return {
          ...old,
          data: old.data.filter(a => a.id !== alertId),
          meta: { ...old.meta, total: old.meta.total - 1 },
        };
      });

      return { previous };
    },

    onError: (_err, _alertId, context: { previous: AlertsResponse | undefined } | undefined) => {
      if (context?.previous) {
        queryClient.setQueryData(['alerts'], context.previous);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

/**
 * useAlertCount
 * -------------
 * Returns count of active alerts for sidenav health dot.
 */
export function useAlertCount(): number {
  const { data } = useAlerts();
  return data?.meta?.total ?? 0;
}