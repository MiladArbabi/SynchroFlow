// apps/frontend/src/pages/ft2-pages/SuppliersPortalPage.tsx
import { useCallback } from 'react';
import { SuppliersPortalModuleFT2 } from '@lasyncro/suppliers-portal';
import type { 
  PurchaseOrderStatus, 
  PoLineItem, 
  CreateSupplierInput, 
  CreatePoInput, 
  Supplier 
} from '@lasyncro/suppliers-portal';
import { useSuppliersPortal } from '../suppliers-portal/useSuppliersPortal';
import { axiosInstance } from 'api/axiosConfig';

/**
 * SUPPLIERS PORTAL GATE PAGE
 * ---------------------------
 * Thin wrapper — data fetching via useSuppliersPortal hook,
 * API callbacks wired here and injected into SuppliersPortalModuleFT2.
 *
 * All HTTP calls live here — module stays decoupled.
 */
export default function SuppliersPortalPage() {
  const { data, isLoading, isError, refetch } = useSuppliersPortal();

  const handleFetchLineItems = useCallback(async (poId: string): Promise<PoLineItem[]> => {
    const { data } = await axiosInstance.get(`/api/v1/suppliers/purchase-orders/${poId}/line-items`);
    return data.line_items;
  }, []);

  const handleUpdatePoStatus = useCallback(async (
    poId: string,
    status: PurchaseOrderStatus,
    actualDeliveryDate?: string
  ) => {
    await axiosInstance.patch(`/api/v1/suppliers/purchase-orders/${poId}/status`, {
      status,
      actual_delivery_date: actualDeliveryDate,
    });
    refetch();
  }, [refetch]);

  const handleCreateSupplier = useCallback(async (input: CreateSupplierInput): Promise<Supplier> => {
    const { data } = await axiosInstance.post('/api/v1/suppliers', input);
    return data.supplier;
  }, []);

  const handleCreatePo = useCallback(async (input: CreatePoInput): Promise<void> => {
    await axiosInstance.post('/api/v1/suppliers/purchase-orders', input);
    refetch();
  }, [refetch]);

  return (
    <SuppliersPortalModuleFT2
      data={data}
      isLoading={isLoading}
      isError={isError}
      onRefresh={refetch}
      onFetchLineItems={handleFetchLineItems}
      onUpdatePoStatus={handleUpdatePoStatus}
      onCreateSupplier={handleCreateSupplier}
      onCreatePo={handleCreatePo}
    />
  );
}