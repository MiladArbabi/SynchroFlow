// packages/api/src/api/customers/customers.service.ts
import { CustomerOrder, SupportTicket } from './customers.types';

// We can define the frontend types here, or import them from a shared package later
// For now, this keeps it simple.
// (Interfaces copied from Customer360Page.tsx)
interface CustomerProfileData {
  name: string;
  email: string;
  phone: string;
  location: string;
  joined_date: string;
  tags: string[];
}

interface CustomerMetricsData {
  total_revenue: number;
  total_orders: number;
  aov: number;
  ltv: number;
}

interface CustomerApiResponse {
  id: string;
  profile: CustomerProfileData;
  metrics: CustomerMetricsData;
  orders: CustomerOrder[];
  tickets: SupportTicket[];
}

// --- MOCK DATA ---
// We're moving the mock data from the frontend and route file here.
const mockCustomerDetails_ABC: CustomerApiResponse = {
  id: 'cust_abc',
  profile: {
    name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '+1 (555) 123-4567',
    location: 'New York, USA',
    joined_date: '2024-01-15T09:30:00Z',
    tags: ['VIP', 'Frequent Buyer'],
  },
  metrics: {
    total_revenue: 1250.75,
    total_orders: 5,
    aov: 250.15,
    ltv: 1500.00, // Projected LTV
  },
  // --- ADDING THE MISSING DATA ---
  orders: [
    { id: '1002', orderDate: '2025-10-20T14:00:00Z', status: 'Shipped', total: 75.50 },
    { id: '1001', orderDate: '2025-09-15T10:30:00Z', status: 'Delivered', total: 50.00 },
  ],
  tickets: [
    { id: 'TKT-501', subject: 'Question about Shipping', date: '2025-10-25T11:00:00Z', status: 'Pending' as const },
    { id: 'TKT-498', subject: 'Return Request - SF-TS-BLK-M', date: '2025-10-22T16:30:00Z', status: 'Resolved' as const },
  ]
};
// --- END MOCK DATA ---


/**
 * Simulates fetching detailed customer data by ID.
 * @param id The customer ID
 * @returns The complete customer data or null if not found.
 */
export const getCustomerDetailsById = async (id: string): Promise<CustomerApiResponse | null> => {
  // In a real app: await db('customers')...
  
  if (id === 'cust_abc') {
    return mockCustomerDetails_ABC;
  }
  
  // Simulate not found
  return null;
};