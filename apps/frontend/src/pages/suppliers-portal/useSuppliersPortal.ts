// apps/frontend/src/pages/suppliers-portal/useSuppliersPortal.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { PurchaseOrder } from '@lasyncro/suppliers-portal';

/**
 * SUPPLIERS PORTAL HOOK — CORE PURCHASING DATA ONLY
 * --------------------------------------------------
 * Fetches purchase orders and suppliers in parallel for the current shop.
 * No polling — data changes on explicit user action. Refetch on demand.
 *
 * COMMERCIAL SCOPE (COMMERCIAL-REMODEL-ALIGN-01 / P0-A3-5)
 * --------------------------------------------------------
 * This hook is the SHARED data source for the whole Purchasing page — it is
 * called once, above the routes that render Open POs, Suppliers AND Sourcing.
 * Everything it fetches is therefore fetched for a merchant sitting on Open POs
 * or Suppliers, who may hold only purchasing.core (Core+).
 *
 * ADVANCED SOURCING is purchasing.sourcing (Growth+): the worklist,
 * recommendations, never-ordered, supplier-product preferences and the
 * reorder/MOQ accumulator. None of it may be requested from here — a Core
 * merchant would be issuing Growth-only requests just by opening Purchasing.
 * The never-ordered query that used to live here now belongs to the Sourcing
 * route, behind its own purchasing.sourcing CommercialGate.
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
    /**
     * WS-UX-01 S2 — awaitable, authoritative PO re-read for mutation
     * reconciliation. Resolves only with a completed, usable response and
     * rejects otherwise; the generic refetch above stays fire-and-forget.
     */
    refetchPurchaseOrders: async (): Promise<PurchaseOrder[]> => {
      const result = await pos.refetch({ throwOnError: true });
      const purchaseOrders: unknown = result.data?.purchase_orders;
      if (
        !Array.isArray(purchaseOrders) ||
        !purchaseOrders.every((po) => typeof po?.id === 'string' && po.id.length > 0)
      ) {
        throw new Error('Purchase order response was unusable.');
      }
      return purchaseOrders as PurchaseOrder[];
    },
  };
}
