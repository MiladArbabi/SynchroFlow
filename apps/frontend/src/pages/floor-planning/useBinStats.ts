import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export interface BinStats {
  location_code: string;
  picks_7d: number;
  last_pick_at: string | null;
  last_pick_by: string | null;
}

/**
 * useBinStats — fetches pick activity stats for a selected bin.
 * Enabled only when a bin is selected.
 * Stale time: 60s — pick stats change less frequently than occupancy.
 */
export function useBinStats(locationCode: string | undefined) {
  return useQuery<BinStats>({
    queryKey: ['floor-planning', 'bin-stats', locationCode],
    queryFn: () =>
      axiosInstance
        .get(`/api/v1/floor-planning/bin/${locationCode}/stats`)
        .then((r) => r.data),
    enabled: !!locationCode,
    staleTime: 60 * 1000,
  });
}