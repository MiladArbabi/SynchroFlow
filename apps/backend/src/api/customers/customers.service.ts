// apps/backend/src/api/customers/customers.service.ts
import { CustomerOrder, SupportTicket } from './customers.types.js';
import { CustomerResolutionService, UnifiedCustomerProfile } from '../../services/customer-resolution.service.js';
import db from '@lasyncro/backend-core/db.js';

export interface CustomerProfileData {
  name: string;
  email: string;
  phone: string;
  location: string;
  joined_date: string;
  tags: string[];
}

export interface CustomerMetricsData {
  total_revenue: number;
  total_orders: number;
  aov: number;
  ltv: number;
}

export interface CustomerApiResponse {
  id: string | number;
  profile: CustomerProfileData;
  metrics: CustomerMetricsData;
  orders: CustomerOrder[];
  tickets: SupportTicket[];
  resolution?: UnifiedCustomerProfile | null;
}

interface DatabaseCustomer {
  id: number;
  platform_customer_id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  total_orders: number;
  total_spent: number;
  state: string;
  created_at: Date;
  tags?: string;
}
 
export class CustomersService {
  /**
   * Get list of customers for a shop from database
   */
  static async getCustomerList(shopId: number): Promise<DatabaseCustomer[]> {
    try {
      const customers = await db
        .select('*')
        .from('customers')
        .where({ shop_id: shopId })
        .orderBy('created_at', 'desc');

return customers;
    } catch (error) {
      console.error('Error fetching customer list:', error);
      throw new Error('Failed to fetch customers');
    }
  }

  /**
   * Get detailed customer data with identity resolution
   */
  static async getCustomerDetailsById(customerId: string | number, shopId: number): Promise<CustomerApiResponse | null> {
    try {
      // Get customer from database
      const customer = await db
        .select('*')
        .from('customers')
        .where({ 
          id: customerId,
          shop_id: shopId 
        })
        .first();

      if (!customer) {
        return null;
      }

      // Get identity resolution data
      let resolution: UnifiedCustomerProfile | null | undefined = undefined;
      try {
        resolution = await CustomerResolutionService.findCustomersByEmail(shopId, customer.email);
      } catch (resolutionError) {
        console.warn('Customer resolution failed:', resolutionError);
        // Continue without resolution data
      }

      // Calculate metrics
      const aov = customer.total_orders > 0 ? customer.total_spent / customer.total_orders : 0;
      const ltv = customer.total_spent * 1.2; // Simple LTV projection

      // Parse tags
      const tags = customer.tags ? customer.tags.split(',').map((tag: string) => tag.trim()) : [];

      return {
        id: customer.id,
        profile: {
          name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Unknown Customer',
          email: customer.email,
          phone: customer.phone || '',
          location: '', // TODO: Extract from customer data
          joined_date: customer.created_at.toISOString(),
          tags
        },
        metrics: {
          total_revenue: parseFloat(customer.total_spent.toString()),
          total_orders: customer.total_orders,
          aov: parseFloat(aov.toFixed(2)),
          ltv: parseFloat(ltv.toFixed(2))
        },
        resolution,
        orders: [], // TODO: Fetch orders for this customer
        tickets: [] // TODO: Fetch support tickets
      };
    } catch (error) {
      console.error('Error fetching customer details:', error);
      throw new Error('Failed to fetch customer details');
    }
  }

  /**
   * Get customer by email across all platforms (for resolution)
   */
  static async getCustomerByEmail(shopId: number, email: string): Promise<DatabaseCustomer | null> {
    try {
      const customer = await db
        .select('*')
        .from('customers')
        .where({ 
          shop_id: shopId,
          email 
        })
        .first();

      return customer || null;
    } catch (error) {
      console.error('Error fetching customer by email:', error);
      throw new Error('Failed to fetch customer by email');
    }
  }
}