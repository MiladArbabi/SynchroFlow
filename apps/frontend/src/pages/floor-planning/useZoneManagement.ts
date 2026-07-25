import { useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import { useToast } from '../../contexts/ToastContext';
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
  const { show } = useToast();
  const queryKey = ['floor-planning', 'layout'];
  return useMutation({
    mutationFn: ({ locationCode, ...payload }: UpdateZonePayload & { locationCode: string }) =>
      axiosInstance.patch(`/api/v1/floor-planning/zones/${locationCode}`, payload).then(r => r.data),
    // FP-09: optimistic update. Without this, the UI showed stale values
    // (e.g. rack_levels reverting) if the user navigated away before the
    // PATCH round-trip completed and invalidateQueries refetched — the
    // cache still held pre-edit data during that window. onMutate writes
    // the change into the cache immediately; onError rolls back if the
    // save actually fails; onSuccess still invalidates as the final
    // reconciliation against real server state.
    onMutate: async ({ locationCode, ...payload }) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<{ zones: Array<Record<string, unknown>> }>(queryKey);
      if (previous) {
        qc.setQueryData(queryKey, {
          ...previous,
          zones: previous.zones.map(z =>
            z.location_code === locationCode ? { ...z, ...payload } : z
          ),
        });
      }
      return { previous };
    },
    // FP-13: surface a toast when a rollback actually happens, so a
    // failed save doesn't just silently revert with no explanation -
    // previously the value would snap back with zero indication of why.
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(queryKey, context.previous);
      show('Failed to save changes — reverted to last saved value.', 'error');
    },
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

// FP-15: responseType 'blob' is a local override for this one call —
// the backend now returns a real PDF, not JSON. Opened in a new tab so
// the browser's native print dialog handles it; printViaQz delivery-layer
// wiring is a separate, later sub-issue under #1047.
export function usePrintBarcode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (locationCode: string) =>
      axiosInstance
        .post(`/api/v1/floor-planning/zones/${locationCode}/print`, {}, { responseType: 'blob' })
        .then(r => r.data as Blob),
    onSuccess: (blob) => {
      const url = window.open(URL.createObjectURL(blob), '_blank');
      if (!url) console.warn('[FP-15] Label popup blocked — check browser popup settings');
      void qc.invalidateQueries({ queryKey: ['floor-planning'] });
    },
  });
}

// FP-16: batch print — mutationFn returns the raw Blob (no onSuccess
// side-effect here) because PrintPreviewPanel needs to open the blob
// itself via the onBatchPrint callback prop; unlike usePrintBarcode,
// there's no last_printed_at invalidation tied to a single zone here.
export function useBatchPrintBarcodes() {
  return useMutation({
    mutationFn: ({ locationCodes, formatId }: { locationCodes: string[]; formatId: string }) =>
      axiosInstance
        .post('/api/v1/floor-planning/zones/print-batch', { locationCodes, formatId }, { responseType: 'blob' })
        .then(r => r.data as Blob),
  });
}