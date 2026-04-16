// apps/frontend/src/pages/suppliers-portal/useSuppliersPortal.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

/**
 * SUPPLIERS PORTAL HOOK
 * ----------------------
 * Fetches purchase orders, supplier ratings, and ETA data
 * for the current shop.
 *
 * No polling — PO data is not realtime. Refetch on demand via refetch().
 */
export function useSuppliersPortal() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['suppliers-portal', 'purchase-orders'],
    queryFn: () =>
      axiosInstance.get('/api/v1/suppliers/purchase-orders').then((r) => r.data),
  });

  return { data, isLoading, isError, refetch };
}