//packages/api/src/api/product-costs/product-costs.service.ts
import db from "../../db";

export interface ProductCost {
  platform_product_id: string;
  purchase_price: number;
  landed_cost_per_unit: number;
  created_at: string;
  updated_at: string;
}

export const getProductCost = async (platformProductId: string): Promise<ProductCost | null> => {
  const cost = await db('product_costs')
    .where('platform_product_id', platformProductId)
    .first();
  
  return cost || null;
};

export const upsertProductCost = async (
  platformProductId: string, 
  purchasePrice: number, 
  landedCostPerUnit: number
): Promise<ProductCost> => {
  const now = new Date().toISOString();
  
  const [cost] = await db('product_costs')
    .insert({
      platform_product_id: platformProductId,
      purchase_price: purchasePrice,
      landed_cost_per_unit: landedCostPerUnit,
      created_at: now,
      updated_at: now
    })
    .onConflict('platform_product_id')
    .merge({
      purchase_price: purchasePrice,
      landed_cost_per_unit: landedCostPerUnit,
      updated_at: now
    })
    .returning('*');
  
  return cost;
};

export const deleteProductCost = async (platformProductId: string): Promise<boolean> => {
  const result = await db('product_costs')
    .where('platform_product_id', platformProductId)
    .delete();
  
  return result > 0;
};