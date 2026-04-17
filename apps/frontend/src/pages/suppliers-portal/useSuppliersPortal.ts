// apps/frontend/src/pages/suppliers-portal/useSuppliersPortal.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

/**
 * SUPPLIERS PORTAL HOOK
 * ----------------------
 * Fetches purchase orders and suppliers in parallel for the current shop.
 * No polling — data changes on explicit user action. Refetch on demand.
 */
export function useSuppliersPortal() {
  const pos = useQuery({
    queryKey: ['suppliers-portal', 'purchase-orders'],
    queryFn: () =>
      axiosInstance.get('/api/v1/suppliers/purchase-orders').then((r) => r.data),
  });

  const suppliers = useQuery({
    queryKey: ['suppliers-portal', 'suppliers'],
    queryFn: () =>
      axiosInstance.get('/api/v1/suppliers').then((r) => r.data),
  });

  return {
    data: {
      purchase_orders: pos.data?.purchase_orders ?? [],
      suppliers: suppliers.data?.suppliers ?? [],
    },
    isLoading: pos.isLoading || suppliers.isLoading,
    isError: pos.isError || suppliers.isError,
    refetch: () => {
      void pos.refetch();
      void suppliers.refetch();
    },
  };
}