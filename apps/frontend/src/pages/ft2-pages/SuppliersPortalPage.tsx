// apps/frontend/src/pages/ft2-pages/SuppliersPortalPage.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Route, Routes, useSearchParams } from 'react-router-dom';
import { useSpotlight } from '../../hooks/useSpotlight';
import { SuppliersPortalModuleFT2 } from '@lasyncro/suppliers-portal';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { PURCHASING_SUB_TABS } from './purchasingSubTabs';
import type { 
  PurchaseOrderStatus, 
  PoLineItem, 
  CreateSupplierInput, 
  CreatePoInput, 
  Supplier,
  SourcingResult,
  PreferenceRow,
  ReorderRequest,
  SupplierAccumulation,
} from '@lasyncro/suppliers-portal';
import { useSuppliersPortal } from '../suppliers-portal/useSuppliersPortal';
import { isAxiosError } from 'axios';
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
  // §8: lives here so it survives the refetch re-render triggered by convert
  const [lastConvertedPoId, setLastConvertedPoId] = useState<string | null>(null);

  // Sourcing onboarding spotlights — per-user, permanent dismissal via user-state
  const spotlightNeverOrdered   = useSpotlight('sourcing_never_ordered');
  const spotlightAlertTriggered = useSpotlight('sourcing_alert_triggered');
  const spotlightAccumulator    = useSpotlight('sourcing_accumulator');
  const spotlightPoSendFlow     = useSpotlight('po_send_flow');
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

  // SOURCING (Thread C, sourcing-recommendation-playbook.md §6) — fetched
  // on demand per variant, not all up front (never_ordered list is the
  // only thing fetched eagerly, via useSuppliersPortal).
  // SRC-03: the `needed` param is gone — nothing ever set it, so the server
  // derives the shortfall from open demand minus availability and returns it
  // alongside the ranked candidates.
  const handleFetchSourcingRecommendations = useCallback(async (
    variantId: string
  ): Promise<SourcingResult> => {
    /**
     * SRC-L3-11A/11B Slice 1A: forward the originating order as context when
     * the merchant arrived from a blocked order. The server validates it
     * against that variant's canonical blocking orders and ignores anything
     * unrelated, so this is a hint, never a key.
     */
    const originatingOrderId = searchParams.get('orderId');
    const query = originatingOrderId
      ? `?orderId=${encodeURIComponent(originatingOrderId)}`
      : '';

    const { data } = await axiosInstance.get(
      `/api/v1/suppliers/sourcing-recommendations/${variantId}${query}`
    );
    return {
      recommendations:  data.recommendations ?? [],
      shortfall:        Number(data.shortfall ?? 0),
      shortfall_basis:  data.shortfall_basis ?? { demand: 0, available: 0 },
      // SRC-12: the trusted preventive quantity and WHY it is what it is.
      queue_qty:             Number(data.queue_qty ?? 0),
      quantity_basis:        data.quantity_basis ?? 'reactive',
      suggested_reorder_qty: data.suggested_reorder_qty ?? null,
      planning_context:      data.planning_context ?? null,
      // Slice 1A targeted block — identity plus the purchasing numbers.
      // Passed through explicitly, matching this adapter's existing style.
      image_url:            data.image_url ?? null,
      product_title:        data.product_title ?? null,
      variant_title:        data.variant_title ?? null,
      sku:                  data.sku ?? null,
      open_demand:          Number(data.open_demand ?? 0),
      available:            Number(data.available ?? 0),
      committed_inbound:    Number(data.committed_inbound ?? 0),
      short_now:            Number(data.short_now ?? 0),
      still_to_source:      Number(data.still_to_source ?? 0),
      blocking_orders:      data.blocking_orders ?? [],
      originating_order_id: data.originating_order_id ?? null,
      // Slice 1B purchasing-workflow facts. The server is the authority for
      // all four; nothing here re-derives them from other endpoints.
      pending_queue_qty:    Number(data.pending_queue_qty ?? 0),
      draft_po_qty:         Number(data.draft_po_qty ?? 0),
      in_purchasing:        Number(data.in_purchasing ?? 0),
      unplanned:            Number(data.unplanned ?? 0),
    };
  }, [searchParams]);

  const handleFetchPreferences = useCallback(async (): Promise<PreferenceRow[]> => {
  const { data } = await axiosInstance.get('/api/v1/suppliers/preferences');
  return data.preferences ?? [];
}, []);

const handleCreatePreference = useCallback(async (input: {
  supplier_id: number;
  scope_type: string;
  scope_id: string;
  priority?: number;
  note?: string;
}): Promise<PreferenceRow> => {
  const { data } = await axiosInstance.post('/api/v1/suppliers/preferences', input);
  return data.preference;
}, []);

const handleUpdatePreference = useCallback(async (
  id: string,
  input: { priority?: number; note?: string }
): Promise<PreferenceRow> => {
  const { data } = await axiosInstance.patch(`/api/v1/suppliers/preferences/${id}`, input);
  return data.preference;
}, []);

const handleDeletePreference = useCallback(async (id: string): Promise<void> => {
    await axiosInstance.delete(`/api/v1/suppliers/preferences/${id}`);
  }, []);

  // §8 MOQ Accumulation — sourcing-recommendation-playbook.md §8
  const handleFetchReorderRequests = useCallback(async (): Promise<SupplierAccumulation[]> => {
    const { data } = await axiosInstance.get('/api/v1/suppliers/reorder-requests');
    return data.by_supplier ?? [];
  }, []);

  const handleCreateReorderRequest = useCallback(async (input: {
    lasyncro_variant_id: string;
    supplier_id: number;
    qty_requested: number;
    source: 'alert' | 'manual';
  }): Promise<ReorderRequest> => {
    const { data } = await axiosInstance.post('/api/v1/suppliers/reorder-requests', input);
    return data.request;
  }, []);

  const handleDeleteReorderRequest = useCallback(async (id: string): Promise<void> => {
    await axiosInstance.delete(`/api/v1/suppliers/reorder-requests/${id}`);
  }, []);

  const handleConvertReorderRequests = useCallback(async (supplierId: number, overrideMoq?: boolean): Promise<{ po_id: string }> => {
    // SRC-01b: a 422 carries an actionable gate reason in data.error — rethrow
    // it as a plain Error so the module can render it instead of swallowing it.
    try {
      const { data } = await axiosInstance.post('/api/v1/suppliers/reorder-requests/convert', {
        supplier_id: supplierId,
        ...(overrideMoq ? { override_moq: true } : {}),
      });
      // Set banner BEFORE refetch so it survives the re-render
      setLastConvertedPoId(data.po_id);
      refetch();
      return data;
    } catch (err: unknown) {
      // SRC-01b: the 422 gate reason lives in the response body. Narrow rather
      // than cast, so a non-HTTP failure still surfaces something meaningful.
      const gateReason = isAxiosError<{ error?: string }>(err)
        ? err.response?.data?.error
        : undefined;
      throw new Error(gateReason ?? 'Failed to create purchase order');
    }
  }, [refetch]);

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

  const sharedProps = {
    data,
    isLoading,
    isError,
    onRefresh: refetch,
    onFetchLineItems: handleFetchLineItems,
    onUpdatePoStatus: handleUpdatePoStatus,
    onCreateSupplier: handleCreateSupplier,
    onUpdateSupplier: handleUpdateSupplier,
    onDeleteSupplier: handleDeleteSupplier,
    onCreatePo: handleCreatePo,
    onCreateReceiveJob: handleCreateReceiveJob,
    onSearchVariants: handleSearchVariants,
    onFetchSourcingRecommendations: handleFetchSourcingRecommendations,
    onFetchPreferences: handleFetchPreferences,
    onCreatePreference: handleCreatePreference,
    onUpdatePreference: handleUpdatePreference,
    onDeletePreference: handleDeletePreference,
    // §8 MOQ Accumulation
    onFetchReorderRequests: handleFetchReorderRequests,
    onCreateReorderRequest: handleCreateReorderRequest,
    onDeleteReorderRequest: handleDeleteReorderRequest,
    onConvertReorderRequests: handleConvertReorderRequests,
    lastConvertedPoId,
    onDismissConvertedPo: () => setLastConvertedPoId(null),
    spotlights: {
      neverOrdered:   { isDismissed: spotlightNeverOrdered.isDismissed,   dismiss: spotlightNeverOrdered.dismiss },
      alertTriggered: { isDismissed: spotlightAlertTriggered.isDismissed, dismiss: spotlightAlertTriggered.dismiss },
      accumulator:    { isDismissed: spotlightAccumulator.isDismissed,    dismiss: spotlightAccumulator.dismiss },
      poSendFlow:     { isDismissed: spotlightPoSendFlow.isDismissed,     dismiss: spotlightPoSendFlow.dismiss },
    },
    autoOpenCreatePo: demandAction === 'create-po',
    prefilledLineItem: demandAction === 'create-po' && (demandDescription ?? demandSku) ? {
      description: demandDescription ?? demandSku ?? '',
      quantity_ordered: demandQty ? parseInt(demandQty, 10) : 1,
      lasyncro_variant_id: demandVariantId ?? undefined,
    } : undefined,
  };

  return (
    <>
      <ModuleTabBar tabs={PURCHASING_SUB_TABS} />
      <Routes>
        <Route path="/" element={<SuppliersPortalModuleFT2 view="pos" {...sharedProps} />} />
        <Route path="/suppliers" element={<SuppliersPortalModuleFT2 view="suppliers" {...sharedProps} />} />
        <Route path="/sourcing" element={<SuppliersPortalModuleFT2 view="sourcing" {...sharedProps} />} />
      </Routes>
    </>
  );
}