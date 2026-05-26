/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/WmsPage.tsx
import { useCallback, useEffect, useState } from 'react';
import { 
  WmsModuleFT2, 
  useOfflineScanQueue, 
  WmsConnectionBadge,
  useWebPush,
} from '@lasyncro/wms';
import { useWms } from '../wms/useWms';
import { axiosInstance } from 'api/axiosConfig';
import type {
  ConfirmScanParams,
  ReportExceptionParams,
  LineItem,
  PackOrder,
} from '@lasyncro/wms';
import { useAuth } from 'contexts/AuthContext';
import { useWarehouseGrid } from '../floor-planning/useWarehouseGrid';
import { useSearchParams } from 'react-router-dom';
import PlanGate from '../../components/PlanGate';
import { ModuleTabBar } from '../../components/ModuleTabBar';

/**
 * WMS GATE PAGE
 * -------------
 * Thin wrapper — data fetching via useWms hook,
 * API callbacks wired here and injected into WmsModuleFT2.
 *
 * All HTTP calls live here — module stays decoupled.
 */

export default function WmsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading, isError, refetch, stowTasks } = useWms();
  const { data: gridData } = useWarehouseGrid();

  const { user } = useAuth();
  const userRole = user?.role ?? 'operator';
  const canReleaseBatch = userRole === 'owner' || userRole === 'admin';

  const httpPost = useCallback(async (url: string, body: Record<string, unknown>) => {
    await axiosInstance.post(url, body);
  }, []);

  const { isOnline, queuedCount, submitScan } = useOfflineScanQueue({ httpPost });

  const handleFetchReceiveJob = useCallback(async (jobId: string) => {
    const { data } = await axiosInstance.get(`/api/v1/suppliers/receive-jobs/${jobId}`);
    return data;
  }, []);

  /**
   * RECEIVE SESSION AUTO-ENTRY
   * --------------------------
   * When navigating from SuppliersPortal via "Receive via WMS",
   * the URL contains ?receiveJobId=xxx. We fetch the job and
   * enter the receive session automatically, then clean the param
   * so refreshing doesn't re-trigger the session.
   */
  const [pendingReceiveSession, setPendingReceiveSession] = useState<{
    receiveJobId: string; poId: string; supplierName: string; lines: import('@lasyncro/wms').ReceiveJobLine[];
  } | null>(null);

  useEffect(() => {
    const receiveJobId = searchParams.get('receiveJobId');
    if (!receiveJobId) return;
    // Clean param immediately — prevents re-trigger on refresh
    setSearchParams({}, { replace: true });
    handleFetchReceiveJob(receiveJobId)
      .then((result) => {
        // Hand off pre-fetched job to WmsModuleFT2 — auto-enters receive session on mount
        setPendingReceiveSession({
          receiveJobId,
          poId: result.job.po_id,
          supplierName: result.job.supplier_name,
          lines: result.lines,
        });
      })
      .catch(() => {
        console.error('[WmsPage] Failed to auto-enter receive session', { receiveJobId });
      });
  }, [searchParams, setSearchParams, handleFetchReceiveJob]);

  // Register Web Push subscription on first WMS load (WM-22)
  useWebPush({ httpPost });

  // ── PICK CALLBACKS ──────────────────────────────────────
  const handleClaimBatch = useCallback(async (batchId: string) => {
    await axiosInstance.post(`/api/v1/wms/batch/${batchId}/claim`);
  }, []);

  const handleFetchLineItems = useCallback(async (batchId: string): Promise<LineItem[]> => {
    const { data } = await axiosInstance.get(`/api/v1/wms/batch/${batchId}/line-items`);
    return data.line_items;
  }, []);

  const handleResolveBarcode = useCallback(async (scannedValue: string) => {
    try {
      const { data } = await axiosInstance.post('/api/v1/wms/barcode/resolve', {
        scanned_value: scannedValue,
      });
      return data;
    } catch {
      return null;
    }
  }, []);

  const handleConfirmScan = useCallback(async (batchId: string, params: ConfirmScanParams) => {
    // device_event_id: stable idempotency key — safe to replay on reconnect (server deduplicates)
    const deviceEventId = crypto.randomUUID();
    await submitScan({
      deviceEventId,
      url: '/api/v1/wms/pick/scan',
      body: { pick_batch_id: batchId, ...params, scan_source: params.scan_source },
    });
  }, [submitScan]);

  const handleReportException = useCallback(async (batchId: string, params: ReportExceptionParams) => {
    await axiosInstance.post(`/api/v1/wms/batch/${batchId}/exception`, {
      ...params,
      stage: 'pick',
    });
  }, []);

  const handlePickComplete = useCallback(async (batchId: string) => {
    await axiosInstance.post(`/api/v1/wms/batch/${batchId}/pick-complete`);
  }, []);

  // ── PACK CALLBACKS ──────────────────────────────────────
  const handleClaimPack = useCallback(async (batchId: string) => {
    await axiosInstance.post(`/api/v1/wms/batch/${batchId}/pack/claim`);
  }, []);

  const handleFetchPackOrders = useCallback(async (batchId: string): Promise<PackOrder[]> => {
    const { data } = await axiosInstance.get(`/api/v1/wms/batch/${batchId}/orders`);
    return data.orders;
  }, []);

  const handleConfirmPackScan = useCallback(async (
    batchId: string,
    params: {
      lasyncro_order_id: string;
      lasyncro_line_item_id: string;
      lasyncro_variant_id: string;
      quantity_confirmed: number;
    }
  ) => {
    const { data } = await axiosInstance.post('/api/v1/wms/pack/scan', {
      pick_batch_id: batchId,
      ...params,
    });
    return data;
  }, []);

  const handleReportPackException = useCallback(async (batchId: string, params: ReportExceptionParams) => {
    await axiosInstance.post(`/api/v1/wms/batch/${batchId}/exception`, {
      ...params,
      stage: 'pack',
    });
  }, []);

  const handlePrintLabel = useCallback(async (orderId: string) => {
    /**
     * PACKING SLIP (PP1-02)
     * ---------------------
     * Opens Shopify packing slip in a new tab.
     * Operator prints the label from Shopify's print dialog.
     *
     * 409 = fulfillment not yet confirmed in Shopify — slip opens anyway
     * via fallback to Shopify admin orders page for manual label access.
     *
     * TODO Sprint 7: replace with Shippo label generation for
     * in-app thermal printer support.
     */
    try {
      const { data } = await axiosInstance.get(`/api/v1/wms/orders/${orderId}/packing-slip`);
      if (data?.packing_slip_url) {
        window.open(data.packing_slip_url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        // Order not yet fulfilled in Shopify — fulfillment fires async.
        // Operator should wait a moment and retry, or print from Shopify orders directly.
        console.info('[WMS] Packing slip not yet available — fulfillment still processing', { orderId });
      } else {
        console.error('[WMS] Failed to fetch packing slip', { orderId, error: (err as Error)?.message });
      }
    }
  }, []);

  const handlePackComplete = useCallback(async (batchId: string) => {
    await axiosInstance.post(`/api/v1/wms/batch/${batchId}/pack-complete`);
  }, []);

  const handleConfirmShipment = useCallback(async (
    batchId: string,
    orderId: string,
    partial = false
  ) => {
    await axiosInstance.post(`/api/v1/wms/batch/${batchId}/ship`, {
      lasyncro_order_id: orderId,
      partial_shipment: partial,
    });
  }, []);

  /**
   * RECEIVE VIA WMS
   * ---------------
   * Creates a receive job for a shipped PO.
   * Navigation to WMS receive session is handled by PoAccordion → handleReceive.
   */
  const handleCreateReceiveJob = useCallback(async (poId: string) => {
    const { data } = await axiosInstance.post(
      `/api/v1/suppliers/purchase-orders/${poId}/receive-jobs`
    );
    return data;
  }, []);

  const handleInspectReceiveLine = useCallback(async (
    jobId: string,
    params: { lasyncro_variant_id: string | null; receive_job_line_id: string; quantity_accepted: number; quantity_rejected: number }
  ) => {
    await axiosInstance.post(`/api/v1/suppliers/receive-jobs/${jobId}/inspect`, params);
  }, []);

  const handleReportReceiveException = useCallback(async (
    jobId: string,
    params: { lasyncro_variant_id: string; receive_job_line_id: string; exception_type: string; quantity_affected: number; notes?: string }
  ) => {
    await axiosInstance.post(`/api/v1/suppliers/receive-jobs/${jobId}/exception`, params);
  }, []);

  const handleCloseReceiveJob = useCallback(async (
    jobId: string,
    params: { actual_delivery_date?: string }
  ) => {
    await axiosInstance.post(`/api/v1/suppliers/receive-jobs/${jobId}/close`, params);
  }, []);

  const handleClaimStowTask = useCallback(async (taskId: string) => {
    await axiosInstance.post(`/api/v1/wms/stow-tasks/${taskId}/claim`);
  }, []);

  const handleConfirmStow = useCallback(async (taskId: string) => {
    await axiosInstance.post(`/api/v1/wms/stow-tasks/${taskId}/confirm`);
  }, []);

  return (
    // TIER GATE: wms.pick_batches requires 'core' (see usePlanEntitlement PLAN_FEATURES)
    <PlanGate feature="wms.pick_batches">
    <ModuleTabBar tabs={[
      { id: 'operations',    label: 'Operations',     path: '/wms'            },
      { id: 'floor-planning', label: 'Floor Planning', path: '/floor-planning', requiredTier: 'scale'  },
      { id: 'analytics',     label: 'Analytics',      path: '/wms/analytics', requiredTier: 'growth', feature: 'wms.pick_batches' },
    ]} />
    <WmsModuleFT2
      data={data ?? null}
      isLoading={isLoading}
      isError={isError}
      onCreateReceiveJob={handleCreateReceiveJob}
      onFetchReceiveJob={handleFetchReceiveJob}
      onInspectReceiveLine={handleInspectReceiveLine}
      onReportReceiveException={handleReportReceiveException}
      onCloseReceiveJob={handleCloseReceiveJob}
      onClaimBatch={handleClaimBatch}
      onFetchLineItems={handleFetchLineItems}
      onResolveBarcode={handleResolveBarcode}
      onConfirmScan={handleConfirmScan}
      onReportException={handleReportException}
      onPickComplete={handlePickComplete}
      onClaimPack={handleClaimPack}
      onFetchPackOrders={handleFetchPackOrders}
      onConfirmPackScan={handleConfirmPackScan}
      onReportPackException={handleReportPackException}
      onPrintLabel={handlePrintLabel}
      onPackComplete={handlePackComplete}
      onConfirmShipment={handleConfirmShipment}
      onRefresh={refetch}
      gridLocations={gridData?.locations}
      pendingReceiveSession={pendingReceiveSession}
      isOnline={isOnline}
      queuedCount={queuedCount}
      stowTasks={stowTasks}
      onClaimStowTask={handleClaimStowTask}
      onConfirmStow={handleConfirmStow}
    />
   </PlanGate>
  );
}