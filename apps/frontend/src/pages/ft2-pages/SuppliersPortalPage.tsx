// apps/frontend/src/pages/ft2-pages/SuppliersPortalPage.tsx
import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const autoOpenRef = useRef(false);

  // Read demand module handoff params — pre-open PO dialog with variant pre-filled
  const demandAction = searchParams.get('action');
  const demandVariantId = searchParams.get('variantId');
  const demandSku = searchParams.get('sku');
  const demandQty = searchParams.get('qty');
  const demandDescription = searchParams.get('description');

  // Clear params after reading — prevent re-trigger on refresh
  useEffect(() => {
    if (demandAction === 'create-po' && !autoOpenRef.current) {
      autoOpenRef.current = true;
      setSearchParams({}, { replace: true });
    }
  }, [demandAction, setSearchParams]);

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
    refetch();
    return data.supplier;
  }, [refetch]);

  const handleUpdateSupplier = useCallback(async (id: number, input: CreateSupplierInput): Promise<Supplier> => {
    const { data } = await axiosInstance.patch(`/api/v1/suppliers/${id}`, input);
    refetch();
    return data.supplier;
  }, [refetch]);

  const handleDeleteSupplier = useCallback(async (id: number): Promise<void> => {
    await axiosInstance.delete(`/api/v1/suppliers/${id}`);
    refetch();
  }, [refetch]);

  const handleCreatePo = useCallback(async (input: CreatePoInput): Promise<void> => {
    await axiosInstance.post('/api/v1/suppliers/purchase-orders', input);
    refetch();
  }, [refetch]);

  const handleSearchVariants = useCallback(async (q: string) => {
    const { data } = await axiosInstance.get(`/api/v1/suppliers/variants/search?q=${encodeURIComponent(q)}`);
    return data.variants ?? [];
  }, []);

  /**
   * RECEIVE VIA WMS
   * ---------------
   * Creates a receive job for a shipped PO.
   * Navigation to WMS receive session is handled by PoAccordion → handleReceive.
   */
  const handleCreateReceiveJob = useCallback(async (poId: string) => {
    try {
      const { data } = await axiosInstance.post(
        `/api/v1/suppliers/purchase-orders/${poId}/receive-jobs`
      );
      return data;
    } catch (err: unknown) {
      // 409 = active job already exists — treat as success, navigate to existing job
      const status = (err as { response?: { status?: number; data?: { receive_job_id?: string } } })?.response?.status;
      const existingJobId = (err as { response?: { data?: { receive_job_id?: string } } })?.response?.data?.receive_job_id;
      if (status === 409 && existingJobId) {
        return { receive_job_id: existingJobId };
      }
      throw err;
    }
  }, []);

  return (
    <SuppliersPortalModuleFT2
      data={data}
      isLoading={isLoading}
      isError={isError}
      onRefresh={refetch}
      onFetchLineItems={handleFetchLineItems}
      onUpdatePoStatus={handleUpdatePoStatus}
      onCreateSupplier={handleCreateSupplier}
      onUpdateSupplier={handleUpdateSupplier}
      onDeleteSupplier={handleDeleteSupplier}
      onCreatePo={handleCreatePo}
      onCreateReceiveJob={handleCreateReceiveJob}
      onSearchVariants={handleSearchVariants}
      autoOpenCreatePo={demandAction === 'create-po'}
      prefilledLineItem={demandAction === 'create-po' && (demandDescription ?? demandSku) ? {
        description: demandDescription ?? demandSku ?? '',
        quantity_ordered: demandQty ? parseInt(demandQty, 10) : 1,
        lasyncro_variant_id: demandVariantId ?? undefined,
      } : undefined}
    />
  );
}