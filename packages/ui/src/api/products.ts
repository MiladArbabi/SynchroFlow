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
}

export const useProducts = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

   useEffect(() => {
    const fetchProducts = async () => {
      try {
        setIsLoading(true);
        console.log('[DEBUG] Frontend: Starting products API call to /api/v1/products');
        const token = localStorage.getItem('accessToken');
        console.log('[DEBUG] Frontend: Using token from localStorage:', !!token);
        
        const response = await axios.get<Product[]>('/api/v1/products', {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        console.log(`[DEBUG] Frontend: Received ${response.data.length} products from API`);
        setProducts(response.data);
        setIsError(false);
      } catch (error: any) {
        console.error('[DEBUG] Frontend: Products API call failed:', error.response?.status, error.message);
        setIsError(true);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProducts();
  }, []);

  return {
    products,
    isLoading,
    isError,
  };
};