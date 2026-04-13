/* eslint-disable */
// apps/frontend/types/backend-contracts.d.ts

// ---- Module: api-types ---------------------------------
declare module 'api-types' {
  export interface InventoryItem {
    id: number;
    shop_id: number;
    sku: string;
    description: string | null;
    quantity_available: number;
    price: string; // decimal as string
    warehouse_location: string | null;
    created_at: string;
    updated_at: string;
  }

  export interface User {
    id: number;
    email: string;
    password_hash: string;
    first_name?: string;
    last_name?: string;
    shop_id?: number;
    /**
     * Role from users.role — synced from shop_memberships.role on change (WM-31).
     * Source of truth for JWT is shop_memberships.role (via shop-resolution.service.ts).
     * Deprecated in favour of action-level entitlements in WM-19.
     */
    role?: 'owner' | 'admin' | 'operator';
    created_at: string;
    updated_at: string;
    preferred_mode?: 'survival' | 'growth' | 'architect';
    detected_mode?: 'survival' | 'growth' | 'architect';
    shopify_connected?: boolean;
    stripe_connected?: boolean;
    first_insight_delivered?: boolean;
  }

  export interface UserMilestone {
    id: number;
    user_id: number;
    milestone: string;
    achieved_at: string;
  }

  // This is what AuthContext actually uses
  export type PublicUser = Omit<User, 'password_hash'>;
}

// ---- Module: api-src/api/customers/customers.service ---
declare module 'api-src/api/customers/customers.service' {
  import type {
    CustomerOrder,
    SupportTicket,
  } from 'components/Customer360/CustomerOrderHistory';

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
    // In backend this is UnifiedCustomerProfile | null; we only need shape to compile
    resolution?: unknown | null;
  }
}
