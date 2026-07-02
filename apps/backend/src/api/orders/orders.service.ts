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
  /**
   * RLS CONTEXT (VO-09, 2026-07-01)
   * --------------------------------
   * Previously ran against the global `db` client with no
   * SET LOCAL "app.current_tenant" — under strict RLS (orders policy has
   * no NULL/0 bypass, unlike `shops`), this silently returned 0 rows for
   * every request, even with a correct shop_id in the WHERE clause.
   * Confirmed live: order existed in DB, matched shop_id, still 404'd.
   * Pattern copied from orders.constrained.controller.ts.
   */
  return db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    const order = await trx('orders')
      .where({ shop_id: shopId, lasyncro_order_id: lasyncroOrderId })
      .first();

    if (!order) return null;

    // Line items joined to variants for image_url
    const lineItems = await trx('order_line_items as oli')
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
    const fulfillment = await trx('order_fulfillment_status')
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
    const warehouseStatus = await trx('order_warehouse_status')
      .where('lasyncro_order_id', lasyncroOrderId)
      .select('status', 'status_updated_at')
      .first();

    // Carrier tracking — most recent shipment for this order
    const shipmentTracking = await trx('order_shipment_tracking')
      .where('lasyncro_order_id', lasyncroOrderId)
      .orderBy('created_at', 'desc')
      .select('tracking_number', 'tracking_url', 'carrier_code')
      .first();

    // Timeline — append-only history, ascending chronological order
    const historyEvents = await trx('order_fulfillment_history')
      .where('lasyncro_order_id', lasyncroOrderId)
      .orderBy('event_occurred_at', 'asc')
      .select(
        'lasyncro_fulfillment_event_id as id',
        'status',
        'event_occurred_at',
      );

    /**
     * TIMELINE MERGE (VO-02, 2026-07-02)
     * ------------------------------------
     * order_fulfillment_history only ever records 2 real statuses
     * (pending/fulfilled — confirmed live) — far short of the target
     * design's multi-stage flow. Rather than fabricate stages with no
     * backing data, this merges in two OTHER real, already-populated
     * timestamps that live on separate tables for good architectural
     * reasons (payment timing vs. warehouse pipeline are different
     * domains — see GH-1034 for the case to eventually make
     * order_fulfillment_history the single writer instead):
     *   - orders.paid_at (real payment-capture timestamp, reliably
     *     populated — 23/26 orders in dev)
     *   - order_warehouse_status.status_updated_at (real "released to
     *     pick batch" moment, only present once an order leaves the pool)
     * This is a query-side, read-only merge — no new writes, no schema
     * change. See GH-1034 for the deferred write-path alternative.
     */
    const synthesizedEvents: { id: string; status: string; event_occurred_at: Date }[] = [];
    if (order.paid_at) {
      synthesizedEvents.push({
        id: `synthetic-paid-${lasyncroOrderId}`,
        status: 'payment_captured',
        event_occurred_at: order.paid_at,
      });
    }
    if (warehouseStatus?.status_updated_at) {
      synthesizedEvents.push({
        id: `synthetic-warehouse-${lasyncroOrderId}`,
        status: 'in_release_pool',
        event_occurred_at: warehouseStatus.status_updated_at,
      });
    }
    const timeline = [...historyEvents, ...synthesizedEvents].sort(
      (a, b) => new Date(a.event_occurred_at).getTime() - new Date(b.event_occurred_at).getTime()
    );

    /**
     * External order identity is canonicalized outside `orders`.
     * Do not read `orders.external_order_id`; that column is not part of
     * the sovereign orders schema.
     */
    const externalIdentity = await trx('external_order_identity_map')
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
      /**
       * SUBTOTAL/TAX (VO-11, 2026-07-01)
       * ---------------------------------
       * subtotal_price/total_tax exist on `orders` and populate
       * correctly (confirmed live) but were never selected here.
       *
       * Deliberately NOT including a derived shippingCost field
       * (total - subtotal - tax) — flagged live as unreliable (see
       * GH-1032): no real shipping_line/carrier-rate data backs it,
       * and the arithmetic silently hides cases where total_price
       * already nets out a merchant-absorbed cost or promo. Do not
       * re-add a derived shipping figure without GH-1032's carrier
       * data audit first.
       */
      subtotal: order.subtotal_price,
      tax: order.total_tax,
      currency: order.currency,
      paymentState: order.payment_state,
      createdAt: order.order_created_at,
      lineItems,
      fulfillment: fulfillment ?? null,
      warehouseStatus: warehouseStatus?.status ?? null,
      timeline,
      tracking: shipmentTracking ?? null,
      /**
       * SHIPPING IDENTITY (VO-01, 2026-07-01)
       * --------------------------------------
       * Deliberately NOT sourced from `customers.email`/`first_name` —
       * confirmed live (audit VO-07) that Shopify's Protected Customer
       * Data scope means customers.email/first_name/last_name are
       * essentially always blank (0/2 populated in dev). orders.shipping_*
       * is the reliable identity/address source and is what the Order
       * Detail modal's customer card renders from. Do not swap this for
       * a customers-table join without re-verifying PCD scope approval.
       */
      shipping: {
        name: order.shipping_name,
        address1: order.shipping_address1,
        address2: order.shipping_address2,
        city: order.shipping_city,
        zip: order.shipping_zip,
        phone: order.shipping_phone,
        province: order.shipping_province,
        countryCode: order.shipping_country_code,
      },
    };
  });
};