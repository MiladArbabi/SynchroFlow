// apps/frontend/src/pages/wms/useWms.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

/**
 * WMS HOOK
 * --------
 * Fetches active pick batches and WMS state for the current shop.
 * Polls every 10s — operators need near-realtime batch status.
 */

export function useWms() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['wms', 'batches'],
    queryFn: () =>
      axiosInstance.get('/api/v1/wms/batches').then((r) => r.data),
    refetchInterval: 10_000,
  });

  return {
    data,
    isLoading,
    isError,
    refetch,
  };
}