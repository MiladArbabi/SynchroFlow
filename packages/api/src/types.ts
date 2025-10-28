// packages/api/src/types.ts
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
  password_hash: string; // We'll select this only on the backend
  first_name?: string;
  last_name?: string;
  created_at: string; // Knex returns timestamps as strings by default
  updated_at: string;
}

// Optional: Define a type for user data we might send to the frontend
// (omitting the password hash)
export type PublicUser = Omit<User, 'password_hash'>;