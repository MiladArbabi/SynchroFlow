// packages/api/src/api/products/products.service.ts
import db from "../../db";

export interface Product {
  id: number;
  shop_id: number;
  platform_product_id: string;
  title: string;
  vendor: string;
  product_type: string;
  status: string;
  total_inventory: number;
  created_at: string;
  updated_at: string;
}

export const getProducts = async (): Promise<Product[]> => {
  console.log('[DEBUG] getProducts service called');
  // TODO: Get shopId from authenticated user/session
  // For now, using shopId 1 as placeholder to match orders service pattern
  const shopId = 1;
  console.log(`[DEBUG] Querying products for shopId: ${shopId}`);
  
  const products = await db('shopify_products')
    .select('*')
    .where('shop_id', shopId)
    .orderBy('created_at', 'desc');

  console.log(`[DEBUG] Found ${products.length} products in database`);
  return products;
};