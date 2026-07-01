// apps/frontend/src/pages/orders/useOrderDetail.ts
//
// Fetches enriched single-order detail for the Order Detail page (ORD-12).
// Endpoint: GET /api/v1/orders/:id
// Enabled only when orderId is non-null — safe to mount unconditionally.

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export interface OrderLineItem {
  id: string;
  sku: string | null;
  title: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  image_url: string | null;
}

export interface OrderFulfillment {
  status: string;
  inventory_block_type: string | null;
  customer_block_type: string | null;
  operational_block_type: string | null;
  fulfilled_at: string | null;
  status_updated_at: string;
}

export interface OrderTimelineEvent {
  id: string;
  status: string;
  event_occurred_at: string;
}

export interface OrderTracking {
  tracking_number: string | null;
  tracking_url: string | null;
  carrier_code: string | null;
}

export interface OrderDetail {
  id: string;
  externalOrderId: string | null;
  total: number;
  currency: string;
  paymentState: string;
  createdAt: string;
  lineItems: OrderLineItem[];
  fulfillment: OrderFulfillment | null;
  // Real warehouse pipeline stage (order_warehouse_status_type):
  // awaiting_pick | picking | picked | packing | packed | shipped |
  // partially_shipped | cancelled. Null = order not yet released to a
  // pick batch — a real, valid state, not missing data.
  warehouseStatus: string | null;
  timeline: OrderTimelineEvent[];
  tracking: OrderTracking | null;
}

export function useOrderDetail(orderId: string | null) {
  return useQuery<OrderDetail>({
    queryKey: ['order-detail', orderId],
    queryFn: async () => {
      const { data } = await axiosInstance.get(`/api/v1/orders/${orderId}`);
      return data;
    },
    // Only fetch when an orderId is provided
    enabled: !!orderId,
  });
}