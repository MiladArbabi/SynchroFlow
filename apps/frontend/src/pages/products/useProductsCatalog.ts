// apps/frontend/src/pages/products/useProductsCatalog.ts
//
// Fetches per-variant catalog list with image_url from the backend.
// Used by ProductsCatalogPage to render the product image grid.

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export interface CatalogVariant {
  lasyncro_variant_id: string;
  sku: string | null;
  variant_title: string | null;
  image_url: string | null;
  status: string;
  product_title: string | null;
  lasyncro_product_id: string;
  /** physical | gift_card | digital — gift_card filtered at backend (INV-05) */
  product_type: string;
  sellable_quantity: number;
}

export function useProductsCatalog() {
  return useQuery<{ variants: CatalogVariant[] }>({
    queryKey: ['products', 'catalog'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/modules/products/catalog');
      return data;
    },
    staleTime: 60_000,
  });
}