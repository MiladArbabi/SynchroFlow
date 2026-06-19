// apps/frontend/src/pages/wms/usePickBatches.ts
//
// Fetches active pick batches for the Fulfillment Queue surface.
// Endpoint: GET /api/v1/wms/batches
// Excludes pack_complete and cancelled — server-side filtered.

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export interface PickBatch {
  pick_batch_id: string;
  status: 'pending' | 'picking' | 'pick_complete' | 'packing' | 'pack_complete' | 'cancelled';
  release_trigger: 'auto' | 'manual';
  total_line_items: number;
  total_units: number;
  units_picked: number;
  units_packed: number;
  picked_by: number | null;
  packed_by: number | null;
  pick_claimed_at: string | null;
  pick_completed_at: string | null;
  pack_claimed_at: string | null;
  pack_completed_at: string | null;
  released_at: string;
  assigned_operator_id: number | null;
  assigned_packer_id: number | null;
  picker_name: string | null;
  packer_name: string | null;
}

export interface PickBatchLineItem {
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  lasyncro_order_id: string;
  sku: string | null;
  title: string;
  quantity: number;
  location_code: string;
}

export function usePickBatches(options?: { refetchInterval?: number }) {
  return useQuery<{ batches: PickBatch[] }>({
    queryKey: ['wms', 'batches'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/batches');
      return data;
    },
    // Default 30s; Order Flow passes a faster cadence for the live matrix/iso
    refetchInterval: options?.refetchInterval ?? 30_000,
  });
}

export function usePickBatchLineItems(batchId: string | null) {
  return useQuery<{ line_items: PickBatchLineItem[] }>({
    queryKey: ['wms', 'batch-line-items', batchId],
    queryFn: async () => {
      const { data } = await axiosInstance.get(`/api/v1/wms/batch/${batchId}/line-items`);
      return data;
    },
    enabled: !!batchId,
  });
}