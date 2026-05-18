import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
export type { BinLogEvent, BinLogResponse } from '@lasyncro/shared/ui';
import type { BinLogResponse } from '@lasyncro/shared/ui';

/**
 * useBinLog — fetches activity timeline for a specific bin.
 * Enabled only when a bin is selected — avoids unnecessary requests.
 * Stale time: 30s — bin activity can change frequently during active picks.
 */
export function useBinLog(locationCode: string | undefined) {
  return useQuery<BinLogResponse>({
    queryKey: ['floor-planning', 'bin-log', locationCode],
    queryFn: () =>
      axiosInstance
        .get(`/api/v1/floor-planning/bin/${locationCode}/log`)
        .then((r) => r.data),
    enabled: !!locationCode,
    staleTime: 30 * 1000,
  });
} 