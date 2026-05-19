import { useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { WarehouseLocationType } from '@lasyncro/shared/ui';

/**
 * useZoneManagement — CRUD mutations for warehouse_locations.
 * Invalidates grid + layout queries on success so UI refreshes automatically.
 */

interface CreateZonePayload {
  location_code: string;
  type: WarehouseLocationType;
  parent_location_code?: string;
  barcode?: string;
}

interface UpdateZonePayload {
  active?: boolean;
  barcode?: string;
  parent_location_code?: string;
  // Canvas editor fields — written on drag-end and resize-end
  position_x?: number | null;
  position_y?: number | null;
  width?: number | null;
  depth?: number | null;
  orientation?: number;
  rack_levels?: number | null;
  zone_type?: string | null;
}

export function useCreateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateZonePayload) =>
      axiosInstance.post('/api/v1/floor-planning/zones', payload).then(r => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['floor-planning'] });
    },
  });
}

export function useUpdateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ locationCode, ...payload }: UpdateZonePayload & { locationCode: string }) =>
      axiosInstance.patch(`/api/v1/floor-planning/zones/${locationCode}`, payload).then(r => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['floor-planning'] });
    },
  });
}

export function useDeleteZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (locationCode: string) =>
      axiosInstance.delete(`/api/v1/floor-planning/zones/${locationCode}`).then(r => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['floor-planning'] });
    },
  });
}

export function useUpdateProductBarcode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lasyncroVariantId, barcode }: { lasyncroVariantId: string; barcode: string }) =>
      axiosInstance.patch(`/api/v1/floor-planning/products/${lasyncroVariantId}/barcode`, { barcode }).then(r => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['floor-planning'] });
    },
  });
}