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
export const getAllOrders = async (): Promise<OrderList[]> => {
  const shopId = 1; // TODO: derive from auth context

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
 * Get order profitability by sovereign ID
 */
export const getOrderProfitabilityById = async (lasyncroOrderId: string) => {
  const shopId = 1;

  const order = await db('orders')
    .select('total_price')
    .where({
      shop_id: shopId,
      lasyncro_order_id: lasyncroOrderId,
    })
    .first();

  if (!order) {
    throw new Error('Order not found');
  }

  const revenue = Number(order.total_price);
  const cogs = revenue * 0.6;
  const shippingCost = revenue * 0.1;
  const fees = revenue * 0.03;
  const margin = revenue - cogs - shippingCost - fees;
  const marginPercent = (margin / revenue) * 100;

  return {
    orderId: lasyncroOrderId,
    revenue,
    cogs,
    shippingCost,
    fees,
    margin,
    marginPercent: Math.round(marginPercent * 10) / 10
  };
};

/**
 * Get order details by sovereign ID
 */
export const getOrderDetailsById = async (lasyncroOrderId: string) => {
  const shopId = 1;

  const order = await db('orders')
    .where({
      shop_id: shopId,
      lasyncro_order_id: lasyncroOrderId,
    })
    .first();

  if (!order) return null;

  const profitability = await getOrderProfitabilityById(lasyncroOrderId);

  return {
    id: order.lasyncro_order_id,
    total: order.total_price,
    currency: order.currency,
    payment_state: order.payment_state,
    created_at: order.order_created_at,
    profitability,
  };
};