/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/api/product-costs.ts
import { useState, useEffect } from 'react';
import axios from 'axios';

export interface ProductCost {
  productId: string;
  platform_product_id: string;
  purchase_price: number;
  landed_cost_per_unit: number;
  selling_price: number;
  currency: string;
  created_at: string;
  updated_at: string;
  // Add cost breakdown fields
  shipping_cost?: number;
  customs_duties?: number;
  packaging_cost?: number;
  additional_costs?: { name: string; amount: number }[];
}

export const useProductCosts = (platformProductId?: string) => {
  const [data, setData] = useState<ProductCost | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    const fetchProductCost = async () => {
      if (!platformProductId) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const token = localStorage.getItem('accessToken');
        
        const response = await axios.get<ProductCost>(
          `/api/v1/product-costs/${platformProductId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        );
        setData(response.data);
        setIsError(false);
      } catch (error: any) {
        // 404 is expected if no cost data exists yet
        if (error.response?.status !== 404) {
          setIsError(true);
        }
        setData(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProductCost();
  }, [platformProductId]);

  return {
    data,
    isLoading,
    isError,
  };
};

export const useUpdateProductCost = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  const updateProductCost = async (costData: Partial<ProductCost>) => {
  try {
    setIsLoading(true);
    setIsError(false);

    // REAL API CALL - Remove mock implementation
    const token = localStorage.getItem('accessToken');
    const response = await axios.post(`/api/v1/product-costs/${costData.platform_product_id}`, costData, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Cost data saved successfully via backend API:', response.data);
    return response;
    
  } catch (error) {
    setIsError(true);
    console.error('Error saving cost data to backend API:', error);
    throw error;
  } finally {
    setIsLoading(false);
  }
};

  return {
    updateProductCost,
    isLoading,
    isError,
  };
};
