// apps/backend/src/api/orders/orders.service.ts
import db from "@lasyncro/backend-core/db.js";

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
export const getAllOrders = async (shopId: number): Promise<OrderList[]> => {

  const orders = await db('orders')
    .select(
      'lasyncro_order_id as id',
      'total_price as total',
      'currency',
      'payment_state',
      'order_created_at as created_at'
    )
    .where('shop_id', shopId)
    .orderBy('order_created_at', 'desc');

  return orders;
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
 * Get order details by sovereign ID
 */
/**
 * TENANT-SCOPED ORDER DETAILS
 * ---------------------------
 * Prevents cross-tenant order access.
 */
export const getOrderDetailsById = async (
  shopId: number,
  lasyncroOrderId: string
) => {

  const order = await db('orders')
    .where({
      shop_id: shopId,
      lasyncro_order_id: lasyncroOrderId,
    })
    .first();

  if (!order) return null;

    const profitability = await getOrderProfitabilityById(
      shopId,
      lasyncroOrderId
    );

  return {
    id: order.lasyncro_order_id,
    total: order.total_price,
    currency: order.currency,
    payment_state: order.payment_state,
    created_at: order.order_created_at,
    profitability,
  };
};