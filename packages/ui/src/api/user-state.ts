//packages/ui/src/api/user-state.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from './axiosConfig';

export interface UserProductCosts {
  [platformProductId: string]: {
    productId?: string;
    platform_product_id: string;
    original_platform_product_id: string;
    purchase_price: number;
    shipping_cost: number;
    customs_duties: number;
    landed_cost_per_unit: number;
    selling_price: number;
    currency: string;
  };
}

export const fetchUserProductCosts = async (): Promise<UserProductCosts> => {
  const response = await axiosInstance.get('/api/v1/user-state/product-costs');
  return response.data;
};

export const updateUserProductCosts = async (productCosts: UserProductCosts): Promise<{ success: boolean }> => {
  const response = await axiosInstance.post('/api/v1/user-state/product-costs', { productCosts });
  return response.data;
};

export const useUserProductCosts = () => {
  return useQuery({
    queryKey: ['user-state', 'product-costs'],
    queryFn: fetchUserProductCosts,
  });
};

export const useUpdateUserProductCosts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateUserProductCosts,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-state', 'product-costs'] });
    },
  });
};