// apps/frontend/src/pages/wms/useReadyToPack.ts
//
// READY TO PACK HOOK
// -------------------
// Polls GET /api/v1/wms/batches/ready-to-pack.
// Every order sitting in a pick_complete batch (picked, no pack claim yet),
// with the LSU- unit barcode to scan per line item. Powers the
// "X orders ready to be packed" summary + expandable list in WMS
// Operations — previously there was no on-screen way to see which
// barcodes belonged to a ready batch. See wms_qa_findings_2026_07_24.md.

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export interface ReadyToPackLineItem {
  lasyncro_line_item_id: string;
  lasyncro_order_id: string;
  sku: string | null;
  product_title: string;
  variant_title: string | null;
  quantity: number;
  /** The literal LSU- barcode string to scan. Null if this line has no tracked unit. */
  unit_barcode: string | null;
}

export interface ReadyToPackOrder {
  pick_batch_id: string;
  lasyncro_order_id: string;
  external_order_id: string;
  /** LSO- invoice barcode. */
  wms_barcode: string | null;
  line_items: ReadyToPackLineItem[];
}

export interface ReadyToPackResponse {
  orderCount: number;
  orders: ReadyToPackOrder[];
}

export function useReadyToPack(enabled = true) {
  return useQuery<ReadyToPackResponse>({
    queryKey: ['wms', 'ready-to-pack'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/batches/ready-to-pack');
      return data;
    },
    refetchInterval: 15_000,
    staleTime: 0,
    enabled,
  });
}