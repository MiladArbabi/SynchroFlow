//apps/backend/src/api/product-costs/product-costs.service.ts
import db from "../../db";

export interface ProductCost {
  platform_product_id: string;
  purchase_price: number;
  landed_cost_per_unit: number;
  created_at: string;
  updated_at: string;
}

export const getProductCost = async (platformProductId: string) => {
  const cost = await db('product_costs')
    .where({ platform_product_id: platformProductId })
    .first();

  if (cost) {
    // Parse decimal fields to numbers
    return {
      ...cost,
      purchase_price: cost.purchase_price ? parseFloat(cost.purchase_price) : null,
      landed_cost_per_unit: cost.landed_cost_per_unit ? parseFloat(cost.landed_cost_per_unit) : null,
      shipping_cost: cost.shipping_cost ? parseFloat(cost.shipping_cost) : null,
      customs_duties: cost.customs_duties ? parseFloat(cost.customs_duties) : null,
      packaging_cost: cost.packaging_cost ? parseFloat(cost.packaging_cost) : null,
      selling_price: cost.selling_price ? parseFloat(cost.selling_price) : null,
    };
  }

  return null;
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