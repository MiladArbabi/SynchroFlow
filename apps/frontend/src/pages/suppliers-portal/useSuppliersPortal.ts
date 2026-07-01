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
  // SOURCING (Thread C, sourcing-recommendation-playbook.md §6) — the
  // never-ordered list, fetched once for the whole page. Per-variant
  // recommendations are fetched on demand inside the Sourcing view
  // itself (one request per expanded item, not all up front).
  const neverOrdered = useQuery({
    queryKey: ['suppliers-portal', 'never-ordered'],
    queryFn: () =>
      axiosInstance.get('/api/v1/suppliers/sourcing-recommendations/never-ordered').then((r) => r.data),
  });
  return {
    data: {
      purchase_orders: pos.data?.purchase_orders ?? [],
      suppliers: suppliers.data?.suppliers ?? [],
      never_ordered: neverOrdered.data?.variants ?? [],
      never_ordered_count: neverOrdered.data?.count ?? 0,
    },
    isLoading: pos.isLoading || suppliers.isLoading || neverOrdered.isLoading,
    isError: pos.isError || suppliers.isError || neverOrdered.isError,
    refetch: () => {
      void pos.refetch();
      void suppliers.refetch();
      void neverOrdered.refetch();
    },
  };
}