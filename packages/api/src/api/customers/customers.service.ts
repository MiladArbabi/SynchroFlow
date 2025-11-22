// Update packages/api/src/api/customers/customers.service.ts - Replace mock with real implementation
import db from '../../db';
import { CustomerOrder, SupportTicket } from './customers.types';

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

/**
 * Get all customers for a shop from database
 */
export const getAllCustomers = async (shopId: number = 1): Promise<any[]> => {
  try {
    const customers = await db('customers')
      .select(
        'platform_customer_id as id',
        'email',
        'first_name',
        'last_name',
        'total_orders',
        'total_spent',
        'created_at'
      )
      .where('shop_id', shopId)
      .orderBy('created_at', 'desc');

    return customers.map(customer => ({
      ...customer,
      name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Unknown Customer'
    }));
  } catch (error) {
    console.error('[CustomersService] Error fetching customers:', error);
    throw new Error('Failed to fetch customers');
  }
};

/**
 * Get detailed customer data by ID from database
 */
export const getCustomerDetailsById = async (id: string): Promise<CustomerApiResponse | null> => {
  try {
    const shopId = 1; // TODO: Get from authenticated user
    
    const customer = await db('customers')
      .select('*')
      .where({
        shop_id: shopId,
        platform_customer_id: id
      })
      .first();

    if (!customer) {
      return null;
    }

    // Get customer's orders
    const orders = await db('orders')
      .select(
        'platform_order_id as id',
        'created_at as orderDate',
        'fulfillment_status as status',
        'total_price as total'
      )
      .where({
        shop_id: shopId,
        platform_customer_id: id
      })
      .orderBy('created_at', 'desc');

    // Calculate metrics
    const totalRevenue = customer.total_spent || 0;
    const totalOrders = customer.total_orders || 0;
    const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    return {
      id: customer.platform_customer_id,
      profile: {
        name: `Customer ${customer.platform_customer_id?.split('/').pop() || 'Unknown'}`, // Use last part of ID
        email: 'Email requires PCD access', // Protected data
        phone: 'Phone requires PCD access', // Protected data
        location: 'Location data requires PCD access', // Protected data
        joined_date: customer.created_at,
        tags: customer.tags ? JSON.parse(customer.tags) : []
      },
      metrics: {
        total_revenue: totalRevenue,
        total_orders: totalOrders,
        aov: Math.round(aov * 100) / 100,
        ltv: totalRevenue // Simple LTV calculation for now
      },
      orders: orders.map(order => ({
        ...order,
        status: mapOrderStatus(order.status)
      })),
      tickets: [] // TODO: Implement support tickets later
    };
  } catch (error) {
    console.error('[CustomersService] Error fetching customer details:', error);
    throw new Error('Failed to fetch customer details');
  }
};

/**
 * Map order status to frontend status
 */
const mapOrderStatus = (status: string): string => {
  const statusMap: { [key: string]: string } = {
    'fulfilled': 'Shipped',
    'partial': 'Picking', 
    'pending': 'Pending',
    'null': 'Pending'
  };
  
  return statusMap[status] || 'Pending';
};