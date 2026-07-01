// apps/backend/src/api/orders/orders.service.ts
import db from "@lasyncro/backend-core/db.js";
import { tierDataWindowSince } from "@lasyncro/backend-core/utils/tierDataWindow.js";
import type { Tier } from "@lasyncro/backend-core/config/tiers.js";

interface OrderList {
  id: string; // lasyncro_order_id
  total: number;
  currency: string;
  payment_state: string;
  created_at: Date;
}

/**
 * Get all orders for a shop using sovereign identity
 */
/**
 * TENANT-SCOPED ORDER LIST
 * ------------------------
 * Service layer must never hardcode tenant identity.
 * shopId must always be injected by the controller layer.
 */
export const getAllOrders = async (shopId: number, tier: Tier = 'starter'): Promise<OrderList[]> => {
  const since = tierDataWindowSince(tier);
  const query = db('orders')
    .select(
      'lasyncro_order_id as id',
      'total_price as total',
      'currency',
      'payment_state',
      'order_created_at as created_at'
    )
    .where('shop_id', shopId)
    .orderBy('order_created_at', 'desc');

  if (since) {
    query.where('order_created_at', '>=', since);
  }

  return query;
};

/**
 * TENANT-SCOPED PROFITABILITY
 * ---------------------------
 * shopId must be provided by controller auth context.
 */
export const getOrderProfitabilityById = async (
  shopId: number,
  lasyncroOrderId: string
) => {

  /**
   * PROFITABILITY SOURCE OF TRUTH
   * ------------------------------
   * Profitability must be read from order_margin_snapshot.
   * Snapshot is produced deterministically by reconciliation.
   */
  const row = await db('orders as o')
    .join(
      'order_margin_snapshot as oms',
      'oms.lasyncro_order_id',
      'o.lasyncro_order_id'
    )
    .select(
      'o.total_price',
      'oms.gross_margin'
    )
    .where({
      'o.shop_id': shopId,
      'o.lasyncro_order_id': lasyncroOrderId,
    })
    .first();

  const revenue = Number(row.total_price);
  const margin = Number(row.gross_margin ?? 0);

  /**
   * Margin percentage derived from authoritative snapshot.
   */
  const marginPercent =
    revenue === 0 ? 0 : (margin / revenue) * 100;

  return {
    orderId: lasyncroOrderId,
    revenue,
    margin,
    marginPercent: Math.round(marginPercent * 10) / 10
  };
};

/**
 * TENANT-SCOPED ORDER DETAILS — ENRICHED
 * ---------------------------------------
 * Returns full order detail for the Order Detail page (ORD-12).
 * Joins: line_items → variants (image_url), fulfillment_status, fulfillment_history.
 * shopId enforces strict tenant isolation — never omit.
 */
export const getOrderDetailsById = async (
  shopId: number,
  lasyncroOrderId: string
) => {
  const order = await db('orders')
    .where({ shop_id: shopId, lasyncro_order_id: lasyncroOrderId })
    .first();

  if (!order) return null;

  // Line items joined to variants for image_url
  const lineItems = await db('order_line_items as oli')
    .leftJoin('variants as v', 'v.lasyncro_variant_id', 'oli.lasyncro_variant_id')
    .where('oli.lasyncro_order_id', lasyncroOrderId)
    .select(
      'oli.lasyncro_line_item_id as id',
      'oli.sku',
      'oli.title',
      'oli.quantity',
      'oli.unit_price',
      'oli.line_total',
      'v.image_url',
    );

  // Current fulfillment status + block context
  const fulfillment = await db('order_fulfillment_status')
    .where('lasyncro_order_id', lasyncroOrderId)
    .select(
      'status',
      'inventory_block_type',
      'customer_block_type',
      'operational_block_type',
      'fulfilled_at',
      'status_updated_at',
    )
    .first();

  // Real warehouse pipeline stage — distinct from fulfillment.status above
  // (order_fulfillment_status = commercial layer: pending/processing/
  // fulfilled/...). Nullable: order_warehouse_status rows only exist once
  // an order is released into a pick batch (see wms.controller.ts, the
  // insert on batch-picking transition) — an order sitting unconstrained
  // in the pool legitimately has no row here yet.
  const warehouseStatus = await db('order_warehouse_status')
    .where('lasyncro_order_id', lasyncroOrderId)
    .select('status', 'status_updated_at')
    .first();

  // Carrier tracking — most recent shipment for this order
  const shipmentTracking = await db('order_shipment_tracking')
    .where('lasyncro_order_id', lasyncroOrderId)
    .orderBy('created_at', 'desc')
    .select('tracking_number', 'tracking_url', 'carrier_code')
    .first();

  // Timeline — append-only history, ascending chronological order
  const timeline = await db('order_fulfillment_history')
    .where('lasyncro_order_id', lasyncroOrderId)
    .orderBy('event_occurred_at', 'asc')
    .select(
      'lasyncro_fulfillment_event_id as id',
      'status',
      'event_occurred_at',
    );

  /**
   * External order identity is canonicalized outside `orders`.
   * Do not read `orders.external_order_id`; that column is not part of
   * the sovereign orders schema.
   */
  const externalIdentity = await db('external_order_identity_map')
    .where({
      shop_id: shopId,
      platform: 'shopify',
      lasyncro_order_id: lasyncroOrderId,
    })
    .select('external_order_id')
    .first();

  return {
    id: order.lasyncro_order_id,
    externalOrderId: externalIdentity?.external_order_id ?? null,
    total: order.total_price,
    currency: order.currency,
    paymentState: order.payment_state,
    createdAt: order.order_created_at,
    lineItems,
    fulfillment: fulfillment ?? null,
    warehouseStatus: warehouseStatus?.status ?? null,
    timeline,
    tracking: shipmentTracking ?? null,
  };
};