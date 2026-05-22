// apps/backend/src/types.ts
// This interface defines the shape of an inventory item
// as it exists in our database and API responses.
export interface InventoryItem {
  id: number;
  shop_id: number;
  sku: string;
  description: string | null;
  quantity_available: number;
  price: string; // The 'decimal' type from the DB is often returned as a string
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
  created_at: string;
  updated_at: string;
  preferred_mode?: 'survival' | 'growth' | 'architect';
  detected_mode?: 'survival' | 'growth' | 'architect';
  shopify_connected?: boolean;
  stripe_connected?: boolean;
  // AUTH-007: email verification fields
  email_verified_at?: Date | null;
  email_verification_token?: string | null;
  email_verification_expires_at?: Date | null;
}

export interface UserMilestone {
  id: number;
  user_id: number;
  milestone: string;
  achieved_at: string;
}

// Optional: Define a type for user data we might send to the frontend
// (omitting the password hash)
export type PublicUser = Omit<User, 'password_hash'>;