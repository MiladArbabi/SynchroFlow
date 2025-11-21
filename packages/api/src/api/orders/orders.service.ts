// packages/api/src/api/orders/orders.service.ts
import db from "../../db";

// Real database interfaces based on ACTUAL schema
interface Order {
  id: number;
  shop_id: number;
  customer_id: number;
  platform_order_id: string;
  order_number: string;
  fulfillment_status: string;
  financial_status: string;
  total_price: number;
  currency: string;
  source_name: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface OrderList {
  id: string;
  customer_name: string;
  total: number;
  status: string;
  created_at: Date;
}

/**
 * Get all orders for a shop from database
 */
export const getAllOrders = async (): Promise<OrderList[]> => {
  try {
    // TODO: Get shopId from authenticated user/session
    // For now, using shopId 1 as placeholder
    const shopId = 1;
    
    const orders = await db('orders')
      .select(
        'platform_order_id as id',
        'order_number',
        'financial_status',
        'fulfillment_status as status',
        'total_price as total',
        'created_at'
      )
      .where('shop_id', shopId)
      .orderBy('created_at', 'desc');

    // Since we don't have shipping_address, we'll create a placeholder customer name
    return orders.map(order => ({
      ...order,
      customer_name: `Customer #${order.order_number}`
    }));
  } catch (error) {
    console.error('[OrdersService] Error fetching orders:', error);
    throw new Error('Failed to fetch orders');
  }
};

/**
 * Get order profitability by ID
 */
export const getOrderProfitabilityById = async (id: string) => {
  try {
    const shopId = 1;
    
    const order = await db('orders')
      .select('total_price')
      .where({
        shop_id: shopId,
        platform_order_id: id
      })
      .first();

    if (!order) {
      throw new Error('Order not found');
    }

    // Simplified profitability calculation using only total_price for now
    const revenue = order.total_price;
    const cogs = revenue * 0.6; // Assume 60% COGS for now
    const shippingCost = revenue * 0.1; // Assume 10% shipping cost
    const fees = revenue * 0.03; // Assume 3% fees
    const margin = revenue - cogs - shippingCost - fees;
    const marginPercent = (margin / revenue) * 100;

    return {
      orderId: id,
      revenue,
      cogs,
      shippingCost,
      fees,
      margin,
      marginPercent: Math.round(marginPercent * 10) / 10
    };
  } catch (error) {
    console.error('[OrdersService] Error calculating profitability:', error);
    throw new Error('Failed to calculate order profitability');
  }
};

/**
 * Get comprehensive order details for Order360 page
 */
export const getOrderDetailsById = async (id: string) => {
  try {
    const shopId = 1;
    
    const order = await db('orders')
      .select('*')
      .where({
        shop_id: shopId,
        platform_order_id: id
      })
      .first();

    if (!order) {
      return null;
    }

    const profitability = await getOrderProfitabilityById(id);

    return {
      id: order.platform_order_id,
      status: mapFulfillmentStatus(order.fulfillment_status),
      customer: {
        profile: {
          name: `Customer #${order.order_number}`,
          email: 'customer@example.com', // Placeholder since we don't have email
          phone: '',
          tags: [],
          shippingAddress: {}, // Empty since we don't have shipping_address
          billingAddress: {},
          accountCreated: order.created_at,
          source: order.source_name || 'Unknown'
        },
        metrics: {
          ltv: 0,
          aov: order.total_price,
          totalOrders: 1,
          totalMargin: profitability.margin,
          lastOrderDate: order.created_at
        }
      },
      profitability
    };
  } catch (error) {
    console.error('[OrdersService] Error fetching order details:', error);
    throw new Error('Failed to fetch order details');
  }
};

/**
 * Map fulfillment status to our OrderStatus
 */
const mapFulfillmentStatus = (fulfillmentStatus: string): string => {
  const statusMap: { [key: string]: string } = {
    'fulfilled': 'shipped',
    'partial': 'picking', 
    'pending': 'pending',
    'null': 'pending'
  };
  
  return statusMap[fulfillmentStatus] || 'pending';
};