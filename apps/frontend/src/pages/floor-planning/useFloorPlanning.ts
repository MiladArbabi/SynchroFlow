// apps/frontend/src/pages/floor-planning/useFloorPlanning.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

/**
 * FLOOR PLANNING HOOK
 * --------------------
 * Fetches warehouse zones (from warehouse_locations table)
 * and product barcode assignments for the current shop.
 *
 * No polling — layout data changes infrequently. Refetch on demand via refetch().
 */
export function useFloorPlanning() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['floor-planning', 'layout'],
    queryFn: () =>
      axiosInstance.get('/api/v1/floor-planning/layout').then((r) => r.data),
  });

  return { data, isLoading, isError, refetch };
}