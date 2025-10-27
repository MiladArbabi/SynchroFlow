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

// --- MOCK CUSTOMER DATA (for Order 360) ---
// In a real app, we'd fetch this via a relation.
const mockCustomerProfile = {
  name: 'John Doe (from Order)',
  email: 'john.doe@example.com',
  phone: '555-1234',
  tags: ['VIP'],
  shippingAddress: { street: '123 Main St', city: 'Anytown', state: 'CA', zip: '12345', country: 'USA' },
  billingAddress: { street: '123 Main St', city: 'Anytown', state: 'CA', zip: '12345', country: 'USA' },
  accountCreated: '2024-01-15T10:00:00Z',
  source: 'Shopify',
};

const mockCustomerMetrics = {
  ltv: 1204.50,
  aov: 110.40,
  totalOrders: 11,
  totalMargin: 550.25,
  lastOrderDate: '2025-10-15T09:30:00Z',
};
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

/**
 * Simulates fetching all data for the Order 360 page.
 * @param id The order ID
 */
export const getOrderDetailsById = async (id: string) => {
  // In a real app, we'd fetch the order and its relations
  // For now, we'll compose our other mock services
  
  // Find the basic order info from our list
  const orderInfo = mockOrders.find(o => o.id === id);
  if (!orderInfo) {
    return null; // Order not found
  }

  const status = await getOrderStatusById(id);
  const profitability = await getOrderProfitabilityById(id);

  return {
    id: orderInfo.id,
    customer: {
      profile: mockCustomerProfile,
      metrics: mockCustomerMetrics,
    },
    status: status.status, // Just return the status string
    profitability: profitability,
  };
};