/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/api/product-costs.ts
import { useState, useEffect } from 'react';
import axios from 'axios';

export interface ProductCost {
  platform_product_id: string;
  purchase_price: number;
  landed_cost_per_unit: number;
  currency: string;
  created_at: string;
  updated_at: string;
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
      
      const token = localStorage.getItem('accessToken');
      const { platform_product_id, ...updateData } = costData;

      const response = await axios.post<ProductCost>(
        `/api/v1/product-costs/${platform_product_id}`,
        updateData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error: any) {
      setIsError(true);
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
