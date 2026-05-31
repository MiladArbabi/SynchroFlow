// apps/frontend/src/pages/wms/useWms.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { WmsStowTask } from '@lasyncro/wms';

/**
 * WMS HOOK
 * --------
 * Fetches active pick batches and pending stow tasks for the current shop.
 * Polls every 10s — operators need near-realtime batch and stow status.
 */
export function useWms() {
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
    queryFn: () =>
      axiosInstance.get('/api/v1/wms/settings').then((r) => r.data.settings),
    staleTime: 60_000, // settings change rarely
  });

  return {
    data,
    isLoading,
    isError,
    stowTasks: stowData ?? [],
    settings: settingsData ?? null,
    refetch: () => {
      void refetch();
      void refetchStow();
      void refetchSettings();
    },
  };
}