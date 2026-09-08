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

export interface OrderShipping {
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  zip: string | null;
  phone: string | null;
  province: string | null;
  countryCode: string | null;
}

export interface OrderAddressAssist {
  source: 'historical_fulfilled_orders';
  candidate: {
    address1: string;
    address2: string | null;
    city: string;
    zip: string;
    province: string | null;
    countryCode: string;
  };
  usageCount: number;
  lastUsedAt: string;
}

/**
 * INV-TREAT-01 — INVENTORY TREATMENT ASSIST.
 * Present only for ACTIVE inventory/oversell blockers. Read-only evidence plus
 * one ranked recommendation per blocked variant: rank=1 is BEST, the array is
 * ordered ascending, and treatments[0] is the primary recommendation. `action`
 * is navigation only — never a decision execution.
 */
export type InventoryTreatmentType =
  | 'wait_for_inbound'
  | 'continue_purchasing'
  | 'source_remaining'
  | 'find_supplier'
  | 'investigate_inventory';

export interface InventoryTreatment {
  type: InventoryTreatmentType;
  rank: number;
  quantity: number | null;
  reason: string;
  automationLevel: 'inform' | 'assist';
  action: {
    type: 'open_sourcing';
    variantId: string;
    orderId: string;
  } | null;
}

export interface InventoryAssistItem {
  variantId: string;
  identity: {
    productTitle: string | null;
    variantTitle: string | null;
    sku: string | null;
    imageUrl: string | null;
  };
  /** THIS order's demand against canonical pickable stock. */
  blockerEvidence: {
    orderRemainingQty: number;
    pickableAvailableQty: number;
    shortageQty: number;
  };
  /**
   * Variant-wide purchasing truth. committedInboundQty is future supply and is
   * never part of pickableAvailableQty; pendingQueueQty and draftPoQty are
   * workflow and are never supply at all.
   */
  purchasingEvidence: {
    variantOpenDemandQty: number;
    committedInboundQty: number;
    pendingQueueQty: number;
    draftPoQty: number;
    supplierOptionCount: number;
  };
  treatments: InventoryTreatment[];
}

export interface OrderInventoryAssist {
  generatedAt: string;
  items: InventoryAssistItem[];
}

export interface OrderDetail {
  id: string;
  externalOrderId: string | null;
  total: number;
  /**
   * SUBTOTAL/TAX (VO-11, 2026-07-01)
   * ---------------------------------
   * No `shippingCost` field — deliberately omitted, see GH-1032.
   * Do not derive one client-side either (total - subtotal - tax) —
   * same unreliability applies regardless of which layer computes it.
   */
  subtotal: number;
  tax: number;
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
  /**
   * SHIPPING IDENTITY (VO-01, 2026-07-01)
   * --------------------------------------
   * Source of customer identity/address for the Order Detail modal's
   * customer card. Intentionally NOT the `customers` table — Shopify's
   * Protected Customer Data scope means customers.email/first_name are
   * almost always blank in practice (confirmed live: 0/2 populated).
   * `name` here is the shipping recipient name, not a verified customer
   * identity — display it as such, don't imply it's an account name.
   */
  shipping: OrderShipping;
  addressAssist: OrderAddressAssist | null;
  inventoryAssist: OrderInventoryAssist | null;
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
    // FIX (2026-07-04): see useOrderDecision.ts — same staleTime=0 +
    // refetchOnWindowFocus flicker, same fix.
    staleTime: 30_000,
  });
}