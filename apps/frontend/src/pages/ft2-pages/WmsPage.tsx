/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/WmsPage.tsx
import { useCallback } from 'react';
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

/**
 * WMS GATE PAGE
 * -------------
 * Thin wrapper — data fetching via useWms hook,
 * API callbacks wired here and injected into WmsModuleFT2.
 *
 * All HTTP calls live here — module stays decoupled.
 */

export default function WmsPage() {
  const { data, isLoading, isError, refetch } = useWms();

  const httpPost = useCallback(async (url: string, body: Record<string, unknown>) => {
    await axiosInstance.post(url, body);
  }, []);

  const { isOnline, queuedCount, submitScan } = useOfflineScanQueue({ httpPost });

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
      body: { pick_batch_id: batchId, ...params },
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
     * PRINT LABEL
     * -----------
     * Triggers server-side label generation.
     * Currently a stub — label printing integration (thermal printer
     * or PDF download) to be implemented in shipping sprint.
     */
    console.info('[WMS] Print label requested for order:', orderId);
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

  return (
    <WmsModuleFT2
      data={data ?? null}
      isLoading={isLoading}
      isError={isError}
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
      isOnline={isOnline}
      queuedCount={queuedCount}
    />
  );
}