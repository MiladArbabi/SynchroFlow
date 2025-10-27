// packages/api/src/api/orders/orders.service.ts

// This interface can be expanded or moved to a shared types package
interface Order {
  id: string;
  customer_name: string;
  total: number;
  status: string;
  created_at: Date;
}

// --- MOCK DATA ---
const mockOrders: Order[] = [
  { id: '1001', customer_name: 'Alice Smith', total: 50.00, status: 'Pending', created_at: new Date() },
  { id: '1002', customer_name: 'Bob Johnson', total: 75.50, status: 'Shipped', created_at: new Date() },
  { id: '1003', customer_name: 'Charlie Brown', total: 120.00, status: 'Picking', created_at: new Date() },
];
// --- END MOCK DATA ---

/**
 * Simulates fetching a list of all orders.
 */
export const getAllOrders = async (): Promise<Order[]> => {
  // In v2, this will be: return db('orders').select('*');
  return mockOrders;
};

/**
 * Simulates fetching the status for a single order.
 * @param id The order ID
 */
export const getOrderStatusById = async (id: string) => {
  // In v2, this will call the C++ core
  return {
    orderId: id,
    status: 'Picking' // Hardcoded for v1
  };
};

/**
 * Simulates fetching the profitability for a single order.
 * @param id The order ID
 */
export const getOrderProfitabilityById = async (id: string) => {
  // In v2, this will be a real calculation
  return {
    orderId: id,
    revenue: 149.99,
    cogs: 62.50,
    shippingCost: 12.00,
    fees: 4.50,
    margin: 70.99,
    marginPercent: 47.3
  };
};