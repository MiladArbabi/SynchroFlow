import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { WarehouseLocation, BinOccupancy } from '@lasyncro/shared/ui';

/**
 * useWarehouseGrid — fetches grid layout (locations) for WarehouseGrid.
 *
 * Separate from useFloorPlanning (zones + barcodes) — this feeds the
 * visual grid renderer. Kept distinct so non-grid consumers (barcode
 * management) don't pay for grid data and vice versa.
 *
 * Stale time: 5 min — layout changes infrequently.
 */
export function useWarehouseGrid() {
  return useQuery<{ locations: WarehouseLocation[] }>({
    queryKey: ['floor-planning', 'grid'],
    queryFn: () =>
      axiosInstance.get('/api/v1/floor-planning/grid').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * useWarehouseGridOccupancy — fetches per-bin stock data lazily.
 *
 * Loaded after grid layout renders to keep initial paint fast.
 * Polls every 60s to reflect live pick/stow activity.
 *
 * enabled prop allows callers to defer until grid is ready.
 */
export function useWarehouseGridOccupancy(enabled = true) {
  return useQuery<{ occupancy: Record<string, BinOccupancy> }>({
    queryKey: ['floor-planning', 'grid', 'occupancy'],
    queryFn: () =>
      axiosInstance.get('/api/v1/floor-planning/grid/occupancy').then((r) => r.data),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    enabled,
  });
}