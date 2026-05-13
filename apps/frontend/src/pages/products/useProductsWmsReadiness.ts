// apps/frontend/src/pages/products/useProductsWmsReadiness.ts
//
// useProductsWmsReadiness
// -----------------------
// Fetches WMS operability signals for the Products module.
//
// Rules:
// - Period-independent — warehouse state is not time-ranged
// - Read-only
// - Null fields = no WMS activity yet for this shop

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type ProductsWmsReadiness = {
  not_pickable_count:                  number | null;
  no_bin_location_count:               number | null;
  variance_count:                      number | null;
  total_variance_units:                number | null;
  open_receive_jobs_with_rejections:   number | null;
  total_rejected_units:                number | null;
  oldest_inventory_evaluated_at:       string | null;
};

export function useProductsWmsReadiness() {
  return useQuery<ProductsWmsReadiness>({
    queryKey: ['products', 'wms-readiness'],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/products/wms-readiness'
      );
      return data;
    },
    // WMS state changes infrequently — 5 min stale time is appropriate
    staleTime: 5 * 60 * 1000,
  });
}