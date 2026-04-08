// apps/frontend/src/pages/sku-gaps/useSkuGaps.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

/**
 * SKU GAPS HOOK
 * -------------
 * Fetches pick/pack exceptions for supervisor resolution.
 * Polls every 30s — exceptions change infrequently.
 */

export function useSkuGaps() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sku-gaps'],
    queryFn: () =>
      axiosInstance.get('/api/v1/wms/sku-gaps').then((r) => r.data),
    refetchInterval: 30_000,
  });

  return { data, isLoading, isError, refetch };
}