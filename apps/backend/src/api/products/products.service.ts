// apps/backend/src/api/products/products.service.ts
import db from "@lasyncro/backend-core/db.js";

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

export interface ProductsResponse {
  products: Product[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * TENANT IDENTITY CONTRACT
 * ------------------------
 * Service layer must never infer tenant identity.
 * shopId must be injected by controller auth context.
 */
export const getProducts = async (
  shopId: number,
  page: number = 1,
  limit: number = 20,
  search?: string
): Promise<ProductsResponse> => {
  
  // Build query with search
  let query = db('shopify_products')
    .where('shop_id', shopId);

  // Add search functionality
  if (search) {
    query = query.andWhere(function() {
      this.where('title', 'ilike', `%${search}%`)
          .orWhere('vendor', 'ilike', `%${search}%`)
          .orWhere('product_type', 'ilike', `%${search}%`);
    });
  }

  // Get total count for pagination
  const totalResult = await query.clone().count('* as count').first();
  const total = parseInt(totalResult?.count as string) || 0;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;

  // Get paginated results
  const products = await query
    .select('*')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);

  return {
    products,
    pagination: {
      page,
      limit,
      total,
      totalPages
    }
  };
};