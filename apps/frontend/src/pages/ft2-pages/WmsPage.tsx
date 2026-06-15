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
  CreateProblemTaskParams,
  LineItem,
  PackOrder,
} from '@lasyncro/wms';
import { useAuth } from 'contexts/AuthContext';
import { useWarehouseGrid } from '../floor-planning/useWarehouseGrid';
import { useSearchParams } from 'react-router-dom';
import PlanGate from '../../components/PlanGate';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { Box, Typography, TextField } from '@mui/material';
import { AlertTriangle } from 'lucide-react';
import { printViaQz } from 'utils/qzPrint';
import { QzTrayOnboardingPrompt } from '../../components/QzTrayOnboardingPrompt';
import { hasQzPromptBeenDismissed, dismissQzPrompt } from 'utils/qzPrompt';

/**
 * ProblemBinPrompt
 * ----------------
 * Inline banner shown when problem_bin_location is not configured.
 * Exceptions cannot be meaningfully routed without a physical bin location.
 * Owner must set this before any exception workflows are used.
 */
function ProblemBinPrompt({ binInput, setBinInput, binSaving, binError, onSave }: {
  binInput: string;
  setBinInput: (v: string) => void;
  binSaving: boolean;
  binError: string | null;
  onSave: () => void;
}) {
  return (
    <Box sx={{
      mx: 3, mt: 2, mb: 0,
      border: '1px solid var(--accent-border)',
      borderRadius: '12px', bgcolor: 'var(--accent-ghost)',
      p: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
    }}>
      <AlertTriangle size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 200 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
          Problem bin not configured
        </Typography>
        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
          Set a physical bin code so operators know where to route exception items.
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexShrink: 0 }}>
        <TextField
          size="small"
          value={binInput}
          onChange={(e) => setBinInput(e.target.value.toUpperCase())}
          placeholder="e.g. PROB-BIN-A"
          sx={{ width: 160, '& input': { fontSize: 13 } }}
          onKeyDown={(e) => e.key === 'Enter' && onSave()}
        />
        <Box
          component="button"
          disabled={!binInput.trim() || binSaving}
          onClick={onSave}
          sx={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            px: 1.5, py: 0.75, borderRadius: '8px',
            bgcolor: 'var(--accent)', color: '#10151E',
            border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 600,
            '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
            '&:hover:not(:disabled)': { opacity: 0.88 },
            transition: 'opacity 0.1s',
          }}
        >
          {binSaving ? 'Saving…' : 'Save'}
        </Box>
      </Box>
      {binError && (
        <Box sx={{ width: '100%', px: 1.25, py: 0.75, borderRadius: '8px', bgcolor: 'rgba(229,72,77,0.08)', border: '1px solid rgba(229,72,77,0.3)' }}>
          <Typography sx={{ fontSize: 12, color: '#E5484D' }}>{binError}</Typography>
        </Box>
      )}
    </Box>
  );
}

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
  const { data, isLoading, isError, refetch, stowTasks, settings } = useWms();
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
  const [showQzPrompt, setShowQzPrompt] = useState(false);

  useEffect(() => {
    const receiveJobId = searchParams.get('receiveJobId');
    if (!receiveJobId) return;
    // Keep param in URL while session is active — enables refresh recovery
    // Param is cleaned only when session completes (exitSession below)
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

  const handleCreateProblemTask = useCallback(async (params: CreateProblemTaskParams) => {
    await axiosInstance.post('/api/v1/wms/problem-center', params);
  }, []);

  const handlePickComplete = useCallback(async (batchId: string) => {
    await axiosInstance.post(`/api/v1/wms/batch/${batchId}/pick-complete`);
  }, []);

  const handleClaimPack = useCallback(async (batchId: string) => {
    await axiosInstance.post(`/api/v1/wms/batch/${batchId}/pack/claim`);
  }, []);

  const handlePackFreeScan = useCallback(async (scannedValue: string) => {
    const { data } = await axiosInstance.post('/api/v1/wms/pack/free-scan', { scanned_value: scannedValue });
    return data;
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

  const openBlobInTab = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) win.focus();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, []);

  const handlePrintUnitLabels = useCallback(async (receiveJobLineId: string) => {
    const response = await axiosInstance.get(
      `/api/v1/wms/receive-job-lines/${receiveJobLineId}/unit-labels`,
      { responseType: 'blob' }
    );
    const blob = new Blob([response.data], { type: 'application/pdf' });
    const dispatched = await printViaQz(blob, 'unit_label', axiosInstance);
    if (!dispatched) {
      openBlobInTab(blob);
      if (!hasQzPromptBeenDismissed()) setShowQzPrompt(true);
    }
  }, [openBlobInTab]);

  const handlePrintInvoice = useCallback(async (orderId: string) => {
    const response = await axiosInstance.get(
      `/api/v1/wms/orders/${orderId}/invoice`,
      { responseType: 'blob' }
    );
    const blob = new Blob([response.data], { type: 'application/pdf' });
    const dispatched = await printViaQz(blob, 'invoice', axiosInstance);
    if (!dispatched) {
      openBlobInTab(blob);
      if (!hasQzPromptBeenDismissed()) setShowQzPrompt(true);
    }
  }, [openBlobInTab]);

  const handlePrintLabel = useCallback(async (orderId: string) => {
    /**
     * LABEL GENERATION (WM-38)
     * ------------------------
     * 1. Call POST /orders/:orderId/generate-label — idempotent,
     *    returns existing tracking row if label already generated.
     * 2. If labelUrl returned → open carrier-hosted PDF in new tab.
     * 3. Fallback: if no carrier configured (500 / no labelUrl) →
     *    fall back to Shopify packing slip so operator is never blocked.
     */
    try {
      const { data } = await axiosInstance.post(
        `/api/v1/wms/orders/${orderId}/generate-label`,
        {}
      );
      if (data?.labelUrl) {
        window.open(data.labelUrl, '_blank', 'noopener,noreferrer');
        return;
      }
    } catch {
      // No carrier configured or label generation failed — fall through to packing slip
      console.info('[WMS] Label generation unavailable — falling back to packing slip', { orderId });
    }

    // Fallback: Shopify packing slip
    try {
      const { data } = await axiosInstance.get(`/api/v1/wms/orders/${orderId}/packing-slip`);
      if (data?.packing_slip_url) {
        window.open(data.packing_slip_url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status !== 409) {
        console.error('[WMS] Packing slip fallback failed', { orderId, error: (err as Error)?.message });
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

  const handleRaisePackDecision = useCallback(async (
    _batchId: string,
    params: {
      pick_batch_id: string;
      lasyncro_order_id: string;
      lasyncro_line_item_id: string;
      exception_type: 'item_missing' | 'short_pick';
      question: 'ship_partial';
    }
  ): Promise<{ id: string }> => {
    const { data } = await axiosInstance.post('/api/v1/wms/pack/decision-request', params);
    return data.request;
  }, []);

  const handlePollPackDecision = useCallback(async (
    requestId: string
  ): Promise<{ status: 'pending' | 'approved' | 'rejected'; partial_shipment: boolean | null; note: string | null }> => {
    const { data } = await axiosInstance.get(`/api/v1/wms/pack/decision-request/${requestId}`);
    return data.request;
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
    params: { lasyncro_variant_id: string | null; receive_job_line_id: string; exception_type: string; quantity_affected: number; notes?: string }
  ) => {
    const { data } = await axiosInstance.post(`/api/v1/suppliers/receive-jobs/${jobId}/exception`, params);
    if (params.lasyncro_variant_id) {
      await axiosInstance.post('/api/v1/wms/problem-center', {
        lasyncro_variant_id:  params.lasyncro_variant_id,
        quantity:             params.quantity_affected,
        exception_type:       params.exception_type,
        source:               'receive',
        source_exception_id:  data?.receive_exception_id ?? undefined,
      });
    }
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

  const handleConfirmStow = useCallback(async (taskId: string, quantityPlaced?: number, lasyncroUnitId?: string) => {
    await axiosInstance.post(`/api/v1/wms/stow-tasks/${taskId}/confirm`, {
      ...(quantityPlaced !== undefined && { quantity_placed: quantityPlaced }),
      ...(lasyncroUnitId ? { lasyncro_unit_id: lasyncroUnitId } : {}),
    });
  }, []);

  const handleFetchStowTasks = useCallback(async () => {
    const { data } = await axiosInstance.get('/api/v1/wms/stow-tasks');
    return data.stow_tasks ?? [];
  }, []);

  const handleResolveLocation = useCallback(async (scannedValue: string) => {
    try {
      const { data } = await axiosInstance.post('/api/v1/wms/location/resolve', {
        scanned_value: scannedValue,
      });
      return data?.location_code ? data : null;
    } catch {
      return null;
    }
  }, []);

  const handleAssignStowLocation = useCallback(async (taskId: string, locationCode: string) => {
    await axiosInstance.patch(`/api/v1/wms/stow-tasks/${taskId}/location`, {
      location_code: locationCode,
    });
  }, []);

  const handleReportStowException = useCallback(async (
    taskId: string,
    params: { exception_type: string; quantity: number; notes?: string; lasyncro_unit_id?: string }
  ) => {
    // Stow exception endpoint handles PC task creation server-side.
    // We only need to pass lasyncro_unit_id through for unit lifecycle tracking (XPLAT-02).
    const { data } = await axiosInstance.post(
      `/api/v1/wms/stow-tasks/${taskId}/exception`,
      params
    );
    return data;
  }, []);

  const problemBinMissing = settings !== null && !settings?.problem_bin_location;
  const [binInput, setBinInput]     = useState('');
  const [binSaving, setBinSaving]   = useState(false);
  const [binError,  setBinError]    = useState<string | null>(null);

  const handleSaveProblemBin = async () => {
    if (!binInput.trim()) return;
    setBinSaving(true);
    setBinError(null);
    try {
      await axiosInstance.patch('/api/v1/wms/settings', {
        problem_bin_location: binInput.trim().toUpperCase(),
      });
      refetch();
      setBinInput('');
    } catch {
      setBinError('Failed to save. Try again.');
    } finally {
      setBinSaving(false);
    }
  };

  return (
    <>
    <PlanGate feature="wms.pick_batches">
    <ModuleTabBar tabs={[
      { id: 'operations',    label: 'Operations',     path: '/wms'            },
      { id: 'floor-planning', label: 'Floor Planning', path: '/floor-planning', requiredTier: 'scale'  },
      { id: 'analytics',     label: 'Analytics',      path: '/wms/analytics', requiredTier: 'growth', feature: 'wms.pick_batches' },
    ]} />
    {problemBinMissing && <ProblemBinPrompt
      binInput={binInput}
      setBinInput={setBinInput}
      binSaving={binSaving}
      binError={binError}
      onSave={() => void handleSaveProblemBin()}
    />}
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
      onCreateProblemTask={handleCreateProblemTask}
      onPickComplete={handlePickComplete}
      onClaimPack={handleClaimPack}
      onFetchPackOrders={handleFetchPackOrders}
      onConfirmPackScan={handleConfirmPackScan}
      onReportPackException={handleReportPackException}
      onPrintLabel={handlePrintLabel}
      onPrintInvoice={handlePrintInvoice}
      onPackFreeScan={handlePackFreeScan}
      onPrintUnitLabels={handlePrintUnitLabels}
      onPackComplete={handlePackComplete}
      onConfirmShipment={handleConfirmShipment}
      onRaisePackDecision={handleRaisePackDecision}
      onPollPackDecision={handlePollPackDecision}
      onRefresh={refetch}
      onSessionExit={() => setSearchParams({}, { replace: true })}
      gridLocations={gridData?.locations}
      pendingReceiveSession={pendingReceiveSession}
      pendingStowTaskId={searchParams.get('stowTaskId')}
      onStowSessionEnter={(id) => setSearchParams({ stowTaskId: id }, { replace: true })}
      pendingPickBatchId={searchParams.get('batchId')}
      onPickSessionEnter={(id) => setSearchParams({ batchId: id }, { replace: true })}
      pendingPackBatchId={searchParams.get('packBatchId')}
      onPackSessionEnter={(id) => setSearchParams({ packBatchId: id }, { replace: true })}
      isOnline={isOnline}
      queuedCount={queuedCount}
      stowTasks={stowTasks}
      onClaimStowTask={handleClaimStowTask}
      onConfirmStow={handleConfirmStow}
      onFetchStowTasks={handleFetchStowTasks}
      onResolveLocation={handleResolveLocation}
      onAssignStowLocation={handleAssignStowLocation}
      onReportStowException={handleReportStowException}
    />
   </PlanGate>
   { showQzPrompt && (
    <QzTrayOnboardingPrompt
      onDismiss={() => {
        dismissQzPrompt();
        setShowQzPrompt(false);
      }}
    />
   )}
   </>
  );
}