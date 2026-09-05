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
 *
 * COMMERCIAL-ACCESS-ARCH-01 P0-A3-2: `enabled` lets a commercially gated
 * surface stop ACQUIRING floor geometry, not merely stop rendering it. Defaults
 * to true so existing ungated callers (FloorPlanningPage) are unchanged.
 */
export function useFloorPlanning(enabled = true) {
  const { data, isLoading, isError, refetch } = useQuery({
    enabled,
    // OV-01-TS: The stable key restores query typing and allows floor-planning
    // mutations to invalidate this layout through the shared prefix.
    queryKey: ['floor-planning', 'layout'],
    queryFn: () =>
      // OV-01: Hard 9s timeout — prevents indefinite hang when floor service is slow or dead.
      // axios default is no timeout; without this isLoading never resolves on a hung request.
      axiosInstance.get('/api/v1/floor-planning/layout', { timeout: 9_000 }).then((r) => r.data),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    // OV-01: Single retry — avoids 3x default retry compounding a 9s hang into a 27s dead screen.
    retry: 1,
    retryDelay: 1_000,
  });

  return { data, isLoading, isError, refetch };
}