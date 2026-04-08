// apps/frontend/src/pages/ft2-pages/WmsPage.tsx
import { useCallback } from 'react';
import { WmsModuleFT2 } from '@lasyncro/wms';
import { useWms } from '../wms/useWms';
import { axiosInstance } from 'api/axiosConfig';
import type { ConfirmScanParams, ReportExceptionParams, LineItem } from '@lasyncro/wms';

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
    await axiosInstance.post('/api/v1/wms/pick/scan', {
      pick_batch_id: batchId,
      ...params,
    });
  }, []);

  const handleReportException = useCallback(async (batchId: string, params: ReportExceptionParams) => {
    await axiosInstance.post(`/api/v1/wms/batch/${batchId}/exception`, {
      ...params,
      stage: 'pick',
    });
  }, []);

  const handlePickComplete = useCallback(async (batchId: string) => {
    await axiosInstance.post(`/api/v1/wms/batch/${batchId}/pick-complete`);
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
      onRefresh={refetch}
    />
  );
}