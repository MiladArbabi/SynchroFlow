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