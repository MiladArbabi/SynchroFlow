/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/api/products.ts
import { useState, useEffect } from 'react';
import axios from 'axios';

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
  // Cost fields
  purchase_price?: number;
  shipping_cost?: number;
  customs_duties?: number;
  packaging_cost?: number;
  landed_cost_per_unit?: number;
  selling_price?: number;
  margin?: number;
  last_cost_update?: string;
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

export const useProducts = (page: number = 1, limit: number = 20, search?: string) => {
  const [data, setData] = useState<ProductsResponse>({
    products: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        setIsLoading(true);
        const token = localStorage.getItem('accessToken');
        
        const params = new URLSearchParams({
          page: page.toString(),
          limit: limit.toString(),
          ...(search && { search })
        });

        const response = await axios.get<ProductsResponse>(`/api/v1/products?${params}`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        setData(response.data);
        setIsError(false);
      } catch (error: any) {
        setIsError(true);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProducts();
  }, [page, limit, search]);

  return {
    products: data.products,
    pagination: data.pagination,
    isLoading,
    isError,
  };
};

export const useProduct = (productId: string) => {
  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        setIsLoading(true);
        const token = localStorage.getItem('accessToken');
        
        // For now, we'll filter from the products list since we don't have a single product endpoint
        const response = await axios.get<ProductsResponse>('/api/v1/products?limit=1000', {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        
        const foundProduct = response.data.products.find(
          p => p.id.toString() === productId || p.platform_product_id === productId
        );
        
        setProduct(foundProduct || null);
        setIsError(!foundProduct);
      } catch (error: any) {
        setIsError(true);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProduct();
  }, [productId]);

  return {
    product,
    isLoading,
    isError,
  };
};