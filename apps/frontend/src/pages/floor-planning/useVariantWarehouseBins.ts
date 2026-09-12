import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export interface VariantWarehouseBin {
  location_code: string;
  available_quantity: number;
}

export interface VariantWarehouseBinsResponse {
  variant_id: string;
  bins: VariantWarehouseBin[];
}

export function useVariantWarehouseBins(
  variantId: string | null | undefined,
  enabled = true,
) {
  return useQuery<VariantWarehouseBinsResponse>({
    queryKey: ['floor-planning', 'variant-bins', variantId],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        `/api/v1/floor-planning/variant/${variantId}/bins`,
      );
      return data;
    },
    enabled: enabled === true && Boolean(variantId),
  });
}
