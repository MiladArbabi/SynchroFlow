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
  external_customer_id: string | null;
  email: string | null;
  first_name?: string | null;
  last_name?: string | null;
  total_orders: number;
  total_spent: number;
  created_at: Date;
  updated_at: Date;
}
 
export class CustomersService {
  /**
   * Get list of customers for a shop from database
   */
  static async getCustomerList(shopId: number): Promise<DatabaseCustomer[]> {
    try {
      // Join orders to derive real metrics per customer
      // Links via customers.external_customer_id = orders.customer_hashed_id
      const customers = await db('customers as c')
        .where('c.shop_id', shopId)
        .leftJoin('orders as o', function () {
          this.on('o.customer_hashed_id', 'c.external_customer_id')
              .andOn('o.shop_id', db.raw('?', [shopId]));
        })
        .groupBy('c.id')
        .orderBy('c.created_at', 'desc')
        .select(
          'c.id',
          'c.external_customer_id',
          'c.email',
          'c.first_name',
          'c.last_name',
          'c.created_at',
          'c.updated_at',
          db.raw('COUNT(o.lasyncro_order_id) as total_orders'),
          db.raw('COALESCE(SUM(o.total_price), 0) as total_spent'),
        );

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
      const customer = await db
        .select('*')
        .from('customers')
        .where({ id: customerId, shop_id: shopId })
        .first();

      if (!customer) return null;

      // --- Fetch orders via external_customer_id = orders.customer_hashed_id ---
      const orders = await db('orders as o')
        .leftJoin('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
        .where({ 'o.shop_id': shopId })
        .where('o.customer_hashed_id', customer.external_customer_id)
        .orderBy('o.order_created_at', 'desc')
        .limit(20)
        .select(
          'o.lasyncro_order_id',
          'o.total_price',
          'o.currency',
          'o.payment_state',
          'o.order_created_at',
          'ofs.status as fulfillment_status',
        );

      // --- Derive metrics from orders ---
      const totalRevenue = orders.reduce((sum: number, o: any) => sum + Number(o.total_price ?? 0), 0);
      const totalOrders = orders.length;
      const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      // --- Identity resolution (best-effort) ---
      let resolution: UnifiedCustomerProfile | null | undefined = undefined;
      if (customer.email) {
        try {
          resolution = await CustomerResolutionService.findCustomersByEmail(shopId, customer.email);
        } catch {
          // non-fatal — resolution data is enrichment only
        }
      }

      return {
        id: customer.id,
        profile: {
          name: `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || 'Unknown Customer',
          email: customer.email ?? '',
          phone: '',       // Not stored — Shopify PII not ingested
          location: '',    // Not stored — Shopify PII not ingested
          joined_date: new Date(customer.created_at).toISOString(),
          tags: [],
        },
        metrics: {
          total_revenue: parseFloat(totalRevenue.toFixed(2)),
          total_orders: totalOrders,
          aov: parseFloat(aov.toFixed(2)),
          ltv: parseFloat((totalRevenue * 1.2).toFixed(2)), // simple 1.2x projection
        },
        resolution,
        orders: orders.map((o: any) => ({
          id: o.lasyncro_order_id,
          orderDate: new Date(o.order_created_at).toISOString(),
          status: o.payment_state ?? 'unknown',
          fulfillmentStatus: o.fulfillment_status ?? 'pending',
          total: Number(o.total_price),
          currency: o.currency ?? 'USD',
          paymentState: o.payment_state ?? 'unknown',
        })),
        tickets: [], // No support ticket system — intentionally empty
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