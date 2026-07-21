// apps/frontend/src/hooks/useIdleAlerts.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from '../api/axiosConfig';

export interface IdleAlert {
  id: string;
  alert_key: string;
  severity: string;
  title: string;
  message: string;
  entity_id: string | null;
  entity_type: string | null;
  created_at: string;
}

/**
 * OV-09: Idle-pick/pack alerts for the live-map rail.
 * Reuses the general alerts inbox (GET /api/v1/alerts), filtered to
 * wms_operator_idle via the alert_type param (see alerts.controller.ts).
 * Polled at 30s — same order of magnitude as useWmsLiveActivity's 15s,
 * but idle state changes slower than picker position, so a longer
 * interval avoids redundant load.
 */
export function useIdleAlerts(enabled: boolean) {
  const { data, isLoading, isError } = useQuery<{ data: IdleAlert[]; meta: { total: number } }>({
    queryKey: ['alerts', 'wms_operator_idle'],
    queryFn: () =>
      axiosInstance
        .get('/api/v1/alerts', { params: { alert_type: 'wms_operator_idle' } })
        .then((r) => r.data),
    enabled,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  return { alerts: data?.data ?? [], isLoading, isError };
}