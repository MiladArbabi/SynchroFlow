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
  /** physical only — non-physical excluded at backend (INV-006) */
  product_type: string;
  on_hand_quantity: number;
  available_quantity: number;
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