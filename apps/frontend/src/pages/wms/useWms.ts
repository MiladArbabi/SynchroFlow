// apps/frontend/src/pages/wms/useWms.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { WmsStowTask } from '@lasyncro/wms';
import { RECEIVE_JOB_OPEN_STATUSES } from '@lasyncro/shared';
import { usePlanEntitlement } from '../../hooks/usePlanEntitlement';

/**
 * WMS HOOK
 * --------
 * Fetches active pick batches and pending stow tasks for the current shop.
 * Polls every 10s — operators need near-realtime batch and stow status.
 */
export function useWms() {
  const { can } = usePlanEntitlement();
  const recountEntitled = can('wms.recount');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['wms', 'batches'],
    queryFn: () =>
      axiosInstance.get('/api/v1/wms/batches').then((r) => r.data),
    refetchInterval: 10_000,
  });

  const { data: stowData, refetch: refetchStow } = useQuery({
    queryKey: ['wms', 'stow-tasks'],
    queryFn: (): Promise<WmsStowTask[]> =>
      axiosInstance.get('/api/v1/wms/stow-tasks').then((r) => r.data.stow_tasks),
    refetchInterval: 10_000,
  });

    const { data: settingsData, refetch: refetchSettings } = useQuery({
    queryKey: ['wms', 'settings'],
    queryFn: () => axiosInstance.get('/api/v1/wms/settings').then((r) => r.data.settings),
    staleTime: 60_000,
  });

  /**
   * Work tally — open receive jobs. Filtered server-side to the canonical open
   * set, so the number here cannot drift from the one on the Inbound page
   * (RECEIVE-ACTIVE-UNDERCOUNT-45).
   */
  const { data: receiveJobsData, refetch: refetchReceiveJobs } = useQuery({
    queryKey: ['wms', 'receive-jobs', 'open'],
    queryFn: () =>
      axiosInstance
        .get('/api/v1/suppliers/receive-jobs', {
          params: { status: RECEIVE_JOB_OPEN_STATUSES.join(',') },
        })
        .then((r) => r.data.receive_jobs),
    refetchInterval: 10_000,
  });

  /**
   * Work tally — counting tasks. Every recount route is requireTier('core'),
   * so Starter tenants are locked immediately instead of probing the backend.
   * Runtime errors still lock the tally for entitled merchants.
   */
  const {
    data: recountTasksData,
    isError: recountIsError,
    refetch: refetchRecountTasks,
  } = useQuery({
    queryKey: ['wms', 'recount-tasks'],
    queryFn: () =>
      axiosInstance.get('/api/v1/wms/recount-tasks').then((r) => r.data.tasks),
    enabled: recountEntitled,
    refetchInterval: 10_000,
    retry: false,
  });

  return {
    data, isLoading, isError,
    stowTasks: stowData ?? [],
    settings: settingsData ?? null,
    openReceiveJobs: receiveJobsData ?? [],
    recountTasks: recountTasksData ?? [],
    recountLocked: !recountEntitled || recountIsError,
    refetch: () => {
      void refetch();
      void refetchStow();
      void refetchSettings();
      void refetchReceiveJobs();
      if (recountEntitled) void refetchRecountTasks();
    },
  };
}
