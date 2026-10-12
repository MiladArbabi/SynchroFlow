/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/WmsOperationsPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { 
  WmsModuleFT2, 
  useOfflineScanQueue, 
  WmsConnectionBadge,
  useWebPush,
} from '@lasyncro/wms';
import { useWms } from '../wms/useWms';
import { useSpotlight } from '../../hooks/useSpotlight';
import useConfig from 'hooks/useConfig';
import { useReadyToPack } from '../wms/useReadyToPack';
import { axiosInstance } from 'api/axiosConfig';
import type {
  ConfirmScanParams,
  ReportExceptionParams,
  ReportPackExceptionParams,
  CreateProblemTaskParams,
  LineItem,
  PackOrder,
  CountingLine,
  CountingSkipReason,
  CountingFinding,
  CountingFindingType,
} from '@lasyncro/wms';
import { useAuth } from 'contexts/AuthContext';
import { useWarehouseGrid } from '../floor-planning/useWarehouseGrid';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Typography } from '@mui/material';
import { printViaQz } from 'utils/qzPrint';
import { QzTrayOnboardingPrompt } from '../../components/QzTrayOnboardingPrompt';
import { hasQzPromptBeenDismissed, dismissQzPrompt } from 'utils/qzPrompt';
import { UpgradePrompt } from '../../components/UpgradePrompt';
import { useAlerts } from '../alerts/useAlerts';
import { alertDeepLink } from '../alerts/alertDeepLink';
import { buildHistoryRows, buildNowRows } from '../../components/OpsConsole/opsConsoleModel';
import { useHistory } from '../operations/useHistory';
import { EntityDetailModal } from '@lasyncro/shared/ui';

/** WMS-OPS-NEEDS-ATTENTION-01 — Operations shows a bounded slice of Ops Console NOW. */
const NEEDS_ATTENTION_VISIBLE_LIMIT = 3;
/** WMS-OPS-MODAL-PARITY-01 — each repeated modal row is its own bounded raised surface. */
const MODAL_LIST_ITEM_SX = {
  minWidth: 0,
  bgcolor: 'var(--surface)',
  border: '1px solid var(--rule)',
  borderRadius: '10px',
  px: 1.5,
  py: 1.25,
} as const;

/**
 * WMS GATE PAGE
 * -------------
 * Thin wrapper — data fetching via useWms hook,
 * API callbacks wired here and injected into WmsModuleFT2.
 *
 * All HTTP calls live here — module stays decoupled.
 */

export default function WmsOperationsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // WMS-OPS-LIFECYCLE-IA-01 / WMS-OPS-NEEDS-ATTENTION-01 / PARITY-03 — app-shell
  // authority. The topnav is the sole alert polling owner and the persistent
  // Ops Console icon its only entry point; ConfigContext owns open state and
  // this page only reads it. Needs attention's trailing action is History.
  const { state: { isOpsConsoleOpen } } = useConfig();
  const [recountUpgradeOpen, setRecountUpgradeOpen] = useState(false);
  const {
    data, isLoading, isError, refetch, stowTasks,
    openReceiveJobs, recountTasks, recountLocked, recountTasksSettled,
    openingInventory = null, refetchOpeningInventory,
  } = useWms();
  const readyToPackQuery = useReadyToPack();
  const { data: gridData } = useWarehouseGrid();

  const { user } = useAuth();
  const userRole =
    (user as { role?: string } | null)?.role ?? 'operator';
  // #1164: AuthContext canonicalizes user.id to the access token's user_id.
  const currentUserId = user?.id ?? null;
  const canReleaseBatch = userRole === 'owner' || userRole === 'admin';
  // WMS-OPS-LIFECYCLE-IA-02 — AuthContext user.role is the only role input:
  // owner/admin get the pipeline overview, everyone else the operator shell.
  const operationsShell = canReleaseBatch ? 'management' : 'operator';

  // WMS-OPS-NEEDS-ATTENTION-01 — passive reader of the canonical inbox cache
  // entry (no poll: the topnav owns the cadence). Operators never query it.
  const alertsInbox = useAlerts({ status: 'inbox' }, { enabled: canReleaseBatch });
  const attentionNowRows = useMemo(
    () => (canReleaseBatch && alertsInbox.isSuccess && alertsInbox.data
      ? buildNowRows(alertsInbox.data.data ?? [], alertDeepLink)
      : []),
    [canReleaseBatch, alertsInbox.isSuccess, alertsInbox.data],
  );
  // Count is the full canonical NOW row count — never alerts meta.total.
  const needsAttention = useMemo(
    () => (attentionNowRows.length === 0 ? null : {
      total: attentionNowRows.length,
      rows: attentionNowRows.slice(0, NEEDS_ATTENTION_VISIBLE_LIMIT).map((row) => ({
        id: row.id,
        title: row.label,
        actionLabel: row.action?.label ?? '',
        tone: row.tone ?? 'warning',
        a11yLabel: row.a11yLabel,
      })),
      overflowCount: Math.max(0, attentionNowRows.length - NEEDS_ATTENTION_VISIBLE_LIMIT),
    }),
    [attentionNowRows],
  );
  // PARITY-05 — "{n} more" opens a page-owned, read-only list of ALL canonical
  // NOW rows: the same attentionNowRows (no second reader, no re-sort) and the
  // same row action handler. Never opens the Ops Console or History.
  const [attentionModalOpen, setAttentionModalOpen] = useState(false);
  const handleOpenAllAttention = useCallback(() => setAttentionModalOpen(true), []);
  // Row navigation is page-owned: no alert lifecycle write, no Console open.
  const handleNeedsAttentionAction = useCallback((rowId: string) => {
    const action = attentionNowRows.find((row) => row.id === rowId)?.action;
    if (action?.kind === 'navigate') navigate(action.route);
  }, [attentionNowRows, navigate]);
  // PARITY-03 — Needs attention "History": the canonical HISTORY V1 feed
  // (useHistory → GET /api/v1/operations/history), read-only, in a page-owned
  // dialog. Fetched only while the dialog is open (no polling); rows come from
  // the canonical buildHistoryRows mapping in backend order. Never opens or
  // touches the Ops Console.
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyQuery = useHistory({ enabled: historyOpen && canReleaseBatch });
  const historyRows = useMemo(
    () => buildHistoryRows(historyQuery.data?.items ?? []),
    [historyQuery.data],
  );
  const handleOpenHistory = useCallback(() => setHistoryOpen(true), []);
  // WMS-OPS-OWNER-1A-VISUAL-PARITY-02 — Ship's carrier-setup action; Settings
  // owns carrier configuration. Page-owned so the module stays router-free.
  const handleConnectCarrier = useCallback(() => {
    navigate('/settings/carriers');
  }, [navigate]);
  // GH-1109 residual: teaches an assigned operator that assignment reserves
  // Receive work but does not start it — claim/start is a distinct step.
  const receiveAssignedWorkSpotlight = useSpotlight('receive_assigned_work');
  // #1164: first-time Opening Inventory count coaching; shown only inside an
  // opening_inventory count session (CountingSessionPage decides).
  const openingInventorySpotlight = useSpotlight('opening_inventory_count');
  // RECOUNT-CLAIM-ABANDONED-131: advisory UI gate only — backend
  // requireAction('wms:recount:reassign') is the real authority.
  const canReassignRecount = userRole === 'owner' || userRole === 'admin';
  // GH-1222: advisory UI gate only — recount management entry ("Reconcile
  // inventory", "Set up bins"). Backend wms:recount:create/review/commit remain
  // the authority; operator claim/count execution is not gated by this.
  const canManageRecount = userRole === 'owner' || userRole === 'admin';
  // STOW-LIFECYCLE-02: advisory UI gate only — backend
  // requireAction('wms:stow:assign') is the real authority (see J).
  const canAssignStow = userRole === 'owner' || userRole === 'admin';
  // GH-1143 RECEIVE-REASSIGN-UI-01: advisory UI gate only, same pattern as
  // canAssignStow — the backend assignment PATCH remains authoritative.
  const canReassignReceive = userRole === 'owner' || userRole === 'admin';
  // 4b-2b GRILL-04: advisory UI gate only — requireAction('wms:recount:commit')
  // plus the cutover service's owner/admin membership check are the authority.
  const canApproveOpeningInventoryCutover = userRole === 'owner' || userRole === 'admin';

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
    receiveJobId: string;
    poId: string;
    poNumber?: number | null;
    supplierName: string;
    jobStatus?: string;
    assignedOperatorId?: number | null;
    closedAt?: string | null;
    actualDeliveryDate?: string | null;
    lines: import('@lasyncro/wms').ReceiveJobLine[];
  } | null>(null);
  const [showQzPrompt, setShowQzPrompt] = useState(false);
  const [finishedCountLabel, setFinishedCountLabel] = useState<string | null>(null);

  // GH-1245 — a page that ARRIVES with ?receiveJobId (Suppliers Portal
  // handoff or refresh) holds WmsModuleFT2 until that exact job resolves, so
  // the ordinary Operations board never paints first. In-module entry (the
  // module is already mounted) never holds.
  const requestedReceiveJobId = searchParams.get('receiveJobId');
  const [awaitingReceiveHandoff, setAwaitingReceiveHandoff] = useState(
    () => requestedReceiveJobId != null
  );
  const [receiveHandoffFailedJobId, setReceiveHandoffFailedJobId] = useState<string | null>(null);
  const [receiveHandoffAttempt, setReceiveHandoffAttempt] = useState(0);

  useEffect(() => {
    const receiveJobId = searchParams.get('receiveJobId');
    if (!receiveJobId) {
      // GH-1245 — destination dropped; the hold must never re-arm later.
      setAwaitingReceiveHandoff(false);
      return;
    }
    // GH-1245 — ignore responses for a job ID the URL no longer requests.
    let superseded = false;
    // Keep param in URL while session is active — enables refresh recovery
    // Param is cleaned only when session completes (exitSession below)
    handleFetchReceiveJob(receiveJobId)
      .then((result) => {
        if (superseded) return;
        setAwaitingReceiveHandoff(false);
        // Hand off pre-fetched job to WmsModuleFT2 — auto-enters receive session on mount
        setPendingReceiveSession({
          receiveJobId,
          poId: result.job.po_id,
          poNumber: result.job.po_number ?? null,
          supplierName: result.job.supplier_name,
          jobStatus: result.job.status,
          assignedOperatorId: result.job.assigned_operator_id ?? null,
          closedAt: result.job.closed_at ?? null,
          actualDeliveryDate: result.job.actual_delivery_date ?? null,
          lines: result.lines,
        });
      })
      .catch(() => {
        if (superseded) return;
        setReceiveHandoffFailedJobId(receiveJobId);
        console.error('[WmsOperationsPage] Failed to auto-enter receive session', { receiveJobId });
      });
    return () => {
      superseded = true;
    };
  }, [searchParams, setSearchParams, handleFetchReceiveJob, receiveHandoffAttempt]);

  // Register Web Push subscription on first WMS load (WM-22)
  useWebPush({ httpPost });

  // 4b-2b GRILL-04 — opening inventory cutover. The backend owns readiness,
  // acceptance, economics and idempotency; the page only reads the canonical
  // view and posts the merchant's explicit physical-truth acceptance.
  // #1164: the view comes from useWms's canonical progress query — the same
  // one the Ops Console re-reads after a start — never a page-local copy.
  const [openingCutoverSubmitting, setOpeningCutoverSubmitting] = useState(false);
  const [openingCutoverError, setOpeningCutoverError] = useState<string | null>(null);

  const fetchOpeningInventory = useCallback(async () => {
    await refetchOpeningInventory?.();
  }, [refetchOpeningInventory]);

  const handleApproveOpeningInventoryCutover = useCallback(async (acceptPhysicalTruth: boolean) => {
    setOpeningCutoverSubmitting(true);
    setOpeningCutoverError(null);
    try {
      await axiosInstance.post('/api/v1/wms/opening-inventory/cutover', {
        accept_physical_truth: acceptPhysicalTruth,
      });
      refetch();
    } catch (err) {
      const message = (err as { response?: { data?: { error?: unknown } } })
        ?.response?.data?.error;
      setOpeningCutoverError(
        typeof message === 'string' && message
          ? message
          : 'Opening inventory sync failed. Try again.'
      );
    } finally {
      setOpeningCutoverSubmitting(false);
      // Refresh after every attempt so a persisted failed/complete state shows.
      await fetchOpeningInventory();
    }
  }, [refetch, fetchOpeningInventory]);

  const handleCountFinished = useCallback((label: string) => {
    setFinishedCountLabel(label);
    void fetchOpeningInventory();
  }, [fetchOpeningInventory]);

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
    // GH-1049: PickSessionPage owns the full report payload — allocation
    // identity, stage, physical quantities and the stable device_event_id.
    const { data } = await axiosInstance.post(
      `/api/v1/wms/batch/${batchId}/exception`,
      params
    );
    return data as { pick_exception_id: string };
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

  const handlePackFreeScan = useCallback(async (scannedValue: string, expectedOrderId?: string) => {
    const { data } = await axiosInstance.post('/api/v1/wms/pack/free-scan', {
      scanned_value: scannedValue,
      ...(expectedOrderId ? { expected_lasyncro_order_id: expectedOrderId } : {}),
    });
    return data;
  }, []);

  // WMS-OPS-LIFECYCLE-IA-02 — Operations overview Quick Scan. The canonical
  // read-only resolver: identifies a product, bin or order and creates no
  // warehouse evidence. Never /pack/free-scan, which stays inside Pack.
  const handleOperationsScanResolve = useCallback(async (scannedValue: string) => {
    const { data } = await axiosInstance.post('/api/v1/wms/scan/resolve', {
      scanned_value: scannedValue,
    });
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

  const handleReportPackException = useCallback(async (batchId: string, params: ReportPackExceptionParams) => {
    const { data } = await axiosInstance.post(`/api/v1/wms/batch/${batchId}/exception`, {
      ...params,
      stage: 'pack',
    });
    return data as { pick_exception_id: string };
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
    // SHOP-REVIEW-BARCODE-PRINT-05: printViaQz now returns a structured result.
    // Behaviour here is unchanged — dispatched → done; anything else → browser tab.
    const dispatch = await printViaQz(blob, 'unit_label', axiosInstance);
    if (dispatch.status !== 'dispatched') {
      openBlobInTab(blob);
      if (!hasQzPromptBeenDismissed()) setShowQzPrompt(true);
    }
  }, [openBlobInTab]);

  /**
   * GH-1085 — records the operator's confirmation that this line's LSU- labels
   * were printed AND attached. Deliberately NOT folded into
   * handlePrintUnitLabels: fetching the PDF is not evidence the label reached
   * the box, and only this explicit action may unlock Stow.
   */
  const handleConfirmUnitLabelsPrinted = useCallback(async (receiveJobLineId: string) => {
    await axiosInstance.post(
      `/api/v1/wms/receive-job-lines/${receiveJobLineId}/unit-labels/printed`
    );
  }, []);

  const handlePrintInvoice = useCallback(async (orderId: string) => {
    const response = await axiosInstance.get(
      `/api/v1/wms/orders/${orderId}/invoice`,
      { responseType: 'blob' }
    );
    const blob = new Blob([response.data], { type: 'application/pdf' });
    const dispatch = await printViaQz(blob, 'invoice', axiosInstance);
    if (dispatch.status !== 'dispatched') {
      openBlobInTab(blob);
      if (!hasQzPromptBeenDismissed()) setShowQzPrompt(true);
    }
  }, [openBlobInTab]);

  const handlePrintLabel = useCallback(async (orderId: string) => {
    /**
     * Generate the carrier label before shipment.
     * Failure must reject so Pack Session shows a truthful, non-blocking warning.
     */
    try {
      const { data } = await axiosInstance.post(
        `/api/v1/wms/orders/${orderId}/generate-label`,
        {}
      );

      if (!data?.labelUrl) {
        throw new Error('Carrier returned no printable shipping-label URL');
      }

      window.open(data.labelUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('[WMS] Shipping label generation failed', {
        orderId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
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

  const handleClaimReceiveJob = useCallback(async (jobId: string) => {
    await axiosInstance.post(
      `/api/v1/suppliers/receive-jobs/${jobId}/claim`
    );
  }, []);

  // Keep a device event through a lost-response retry; a completed action
  // releases its key so an intentional later allocation is a new event.
  const receiveEvents = useRef(new Map<string, string>());
  const newReceiveEventId = () => {
    if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const postReceiveEvent = useCallback(async (url: string, params: object) => {
    const key = JSON.stringify([url, params]);
    const eventId = receiveEvents.current.get(key) ?? newReceiveEventId();
    receiveEvents.current.set(key, eventId);
    await axiosInstance.post(url, { ...params, device_event_id: eventId });
    receiveEvents.current.delete(key);
  }, []);

  const handleInspectReceiveLine = useCallback(async (
    jobId: string,
    params: { lasyncro_variant_id: string | null; receive_job_line_id: string; quantity_accepted: number; quantity_rejected: number; quantity_missing?: number; quantity_deferred?: number }
  ) => {
    await postReceiveEvent(`/api/v1/suppliers/receive-jobs/${jobId}/inspect`, params);
  }, [postReceiveEvent]);

  // GH-1241 S3-A1 — one pending count confirmation per line. Its event is
  // replayed only by a network retry of that same confirmation; the backend
  // permanently refuses a consumed event once it is no longer the line's
  // active count, so every new count intent needs a new event.
  const pendingCountConfirmations = useRef(new Map<string, { quantity: number; eventId: string }>());

  const handlePersistReceiveLineProgress = useCallback(async (
    jobId: string,
    lineId: string,
    params: { quantity_sellable_provisional: number; reconciliation_required?: boolean; quantity_deferred?: number }
  ) => {
    // A count-changing draft voids the confirmation server-side: a later
    // confirmation is a new intent, never a replay of the pending one.
    const pendingKey = `${jobId}:${lineId}`;
    if (pendingCountConfirmations.current.get(pendingKey)?.quantity !== params.quantity_sellable_provisional) {
      pendingCountConfirmations.current.delete(pendingKey);
    }
    await axiosInstance.patch(`/api/v1/suppliers/receive-jobs/${jobId}/lines/${lineId}/progress`, params);
  }, []);

  const handleConfirmReceiveLineCount = useCallback(async (
    jobId: string,
    lineId: string,
    params: { quantity_confirmed: number }
  ) => {
    const pendingKey = `${jobId}:${lineId}`;
    const pending = pendingCountConfirmations.current.get(pendingKey);
    const eventId = pending?.quantity === params.quantity_confirmed ? pending.eventId : newReceiveEventId();
    pendingCountConfirmations.current.set(pendingKey, { quantity: params.quantity_confirmed, eventId });
    try {
      await axiosInstance.post(`/api/v1/suppliers/receive-jobs/${jobId}/lines/${lineId}/confirm-count`, {
        ...params, device_event_id: eventId,
      });
    } catch (err: any) {
      // Only an unanswered request may still have been applied; a definitive
      // refusal ends this confirmation, so a retry is a new event.
      const status = err?.response?.status;
      if (status >= 400 && status < 500) pendingCountConfirmations.current.delete(pendingKey);
      throw err;
    }
    pendingCountConfirmations.current.delete(pendingKey);
  }, []);

  const handleReportReceiveException = useCallback(async (
    jobId: string,
    params: { lasyncro_variant_id: string | null; receive_job_line_id: string; exception_type: string; quantity_affected: number; accounting_role?: string; notes?: string }
  ) => {
    await postReceiveEvent(`/api/v1/suppliers/receive-jobs/${jobId}/exception`, params);
  }, [postReceiveEvent]);

  // Explicit overage approval is supplier delivery evidence, not recovery work.
  const handleApproveOverDelivery = useCallback(async (
    jobId: string,
    params: { lasyncro_variant_id: string | null; receive_job_line_id: string; quantity_affected: number; notes: string }
  ) => {
    await postReceiveEvent(`/api/v1/suppliers/receive-jobs/${jobId}/exception`, {
      ...params, exception_type: 'extra_item', accounting_role: 'overage',
    });
  }, [postReceiveEvent]);

  const handleCloseReceiveJob = useCallback(async (
    jobId: string,
    params: { actual_delivery_date?: string }
  ) => {
    await axiosInstance.post(`/api/v1/suppliers/receive-jobs/${jobId}/close`, params);
  }, []);

  const handleClaimStowTask = useCallback(async (taskId: string) => {
    await axiosInstance.post(`/api/v1/wms/stow-tasks/${taskId}/claim`);
  }, []);

  const handleConfirmStow = useCallback(async (
  taskId: string,
  quantityPlaced?: number,
  lasyncroUnitId?: string
) => {
  // STOW-SPLIT-01 — propagate the committed server result back to the scanner.
  // Browser-local counters must not decide whether warehouse work completed.
  const { data } = await axiosInstance.post(
      `/api/v1/wms/stow-tasks/${taskId}/confirm`,
      {
        ...(quantityPlaced !== undefined && { quantity_placed: quantityPlaced }),
        ...(lasyncroUnitId ? { lasyncro_unit_id: lasyncroUnitId } : {}),
      }
    );

    return data;
  }, []);

  const handleFetchStowTasks = useCallback(async () => {
    const { data } = await axiosInstance.get('/api/v1/wms/stow-tasks');
    return data.stow_tasks ?? [];
  }, []);

  // STOW-UX-SCAN-RAIL-01 — canonical current-bin activity trace, task-scoped.
  const handleFetchStowPlacements = useCallback(async (taskId: string) => {
    const { data } = await axiosInstance.get(`/api/v1/wms/stow-tasks/${taskId}/placements`);
    return data.placements ?? [];
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

  // STOW-LIFECYCLE-02: owner/admin optional dispatch. null clears
  // assignment ("Make first one to claim"); the existing PATCH assignment
  // route and wms:stow:assign permission are reused unchanged.
  const handleAssignStowTask = useCallback(async (taskId: string, operatorId: number | null) => {
    await axiosInstance.patch(`/api/v1/wms/stow-tasks/${taskId}/assignment`, {
      assigned_operator_id: operatorId,
    });
  }, []);

  // GH-1143 RECEIVE-REASSIGN-UI-01 — canonical Receive assignee source,
  // same endpoint SuppliersPortalPage already uses for the initial Assign
  // Receive dialog (apps/frontend/src/pages/ft2-pages/SuppliersPortalPage.tsx).
  const handleFetchReceiveAssignees = useCallback(async () => {
    const { data } = await axiosInstance.get('/api/v1/operators/receive-assignees');
    return data.operators ?? [];
  }, []);

  // GH-1143 RECEIVE-REASSIGN-UI-01 — owner/admin reassignment of a
  // pending/unstarted Receive job. Reuses the existing assignment PATCH;
  // the backend re-validates pending/unstarted state atomically regardless
  // of what this UI gate renders.
  const handleReassignReceiveJob = useCallback(async (jobId: string, operatorId: number) => {
    await axiosInstance.patch(`/api/v1/suppliers/receive-jobs/${jobId}/assignment`, {
      assigned_operator_id: operatorId,
    });
  }, []);

  // ── COUNTING CALLBACKS ──────────────────────────────────

  const handleFetchCountingLines = useCallback(
    async (taskId: string): Promise<CountingLine[]> => {
      const { data } = await axiosInstance.get(
        `/api/v1/wms/recount-tasks/${taskId}/lines`
      );
      return data.lines ?? [];
    },
    []
  );

  const handleFetchCountingFindings = useCallback(
    async (taskId: string): Promise<CountingFinding[]> => {
      const { data } = await axiosInstance.get(
        `/api/v1/wms/recount-tasks/${taskId}/findings`
      );
      return data.findings ?? [];
    },
    []
  );

  const handleFetchCountingPreview = useCallback(async () => {
    const { data } = await axiosInstance.get(
      '/api/v1/wms/recount-tasks/preview'
    );
    return data.bins ?? [];
  }, []);

  const handleFetchCountingAssignees = useCallback(async () => {
    const { data } = await axiosInstance.get('/api/v1/operators/team');
    return data.operators ?? [];
  }, []);

  const handleCreateCountingTask = useCallback(async (input: {
    scope: 'location' | 'locations' | 'suggested';
    location_code?: string;
    location_codes?: string[];
    assigned_to?: number | null;
    notes?: string;
  }) => {
    const response = await axiosInstance.post('/api/v1/wms/recount-tasks', input);
    refetch();

    // GH-1201 — a creator who may count the new task (unassigned, or assigned
    // to themselves) enters its Brief at once. Identity comes from the server;
    // the dispatch choice is the just-persisted submitted assignment (create
    // does not return it). Ordinary recount: countTaskId only — never
    // warehouseFocus. Entry never claims; Claim & Start Count stays explicit.
    const createdTaskId: unknown = response?.data?.task?.recount_task_id;
    const assignedTo = input.assigned_to ?? null;
    const creatorOwnsEntry = assignedTo === null || assignedTo === currentUserId;
    if (creatorOwnsEntry && typeof createdTaskId === 'string' && createdTaskId) {
      setSearchParams({ countTaskId: createdTaskId }, { replace: true });
    }
  }, [refetch, currentUserId, setSearchParams]);

  const handleCreateCountingFinding = useCallback(async (
    taskId: string,
    params: {
      client_event_id: string;
      recount_line_id?: string | null;
      lasyncro_variant_id: string;
      location_code: string;
      finding_type: CountingFindingType;
      quantity: number;
      notes?: string;
    }
  ): Promise<CountingFinding> => {
    const { data } = await axiosInstance.post(
      `/api/v1/wms/recount-tasks/${taskId}/findings`,
      params
    );
    return data.finding;
  }, []);

  const handleClaimCountingTask = useCallback(async (taskId: string) => {
    await axiosInstance.post(
      `/api/v1/wms/recount-tasks/${taskId}/claim`
    );
  }, []);

  // RECOUNT-FRESH-NOBINS-40 — navigation ownership stays at the page level,
  // not inside the presentational WMS module. Must use React Router's
  // useNavigate(), not runtime.navigate() — the latter only calls
  // window.history.pushState/replaceState and never notifies the active
  // <Routes> tree, so the rendered page never actually changes.
  const handleSetupBinsClick = useCallback(() => {
    navigate('/floor-planning?tab=setup&view=canvas');
  }, [navigate]);

  // RECOUNT-CLAIM-ABANDONED-131
  const handleReassignCountingTask = useCallback(async (
    taskId: string,
    targetUserId: number
  ) => {
    await axiosInstance.post(
      `/api/v1/wms/recount-tasks/${taskId}/reassign`,
      { target_user_id: targetUserId }
    );
  }, []);

  const handleRecordCountingLine = useCallback(async (
    taskId: string,
    lineId: string,
    params: {
      counted_quantity: number;
      count_method: 'unit_scan' | 'bin_quantity';
    }
  ) => {
    await axiosInstance.post(
      `/api/v1/wms/recount-tasks/${taskId}/lines/${lineId}/count`,
      params
    );
  }, []);

  const handleSkipCountingLine = useCallback(async (
    taskId: string,
    lineId: string,
    params: {
      skip_reason: CountingSkipReason;
      notes?: string;
    }
  ) => {
    await axiosInstance.post(
      `/api/v1/wms/recount-tasks/${taskId}/lines/${lineId}/skip`,
      params
    );
  }, []);

  const handleCloseCountingTask = useCallback(async (taskId: string) => {
    await axiosInstance.post(
      `/api/v1/wms/recount-tasks/${taskId}/close`
    );
  }, []);

  // #1164: opening inventory discovery — the server anchors the line to the
  // task's frozen bin, so no location is sent.
  const handleCreateOpeningLine = useCallback(async (
    taskId: string,
    params: { lasyncro_variant_id: string }
  ): Promise<Pick<CountingLine, 'recount_line_id' | 'lasyncro_variant_id' | 'location_code'>> => {
    const { data } = await axiosInstance.post(
      `/api/v1/wms/recount-tasks/${taskId}/opening-lines`,
      { lasyncro_variant_id: params.lasyncro_variant_id }
    );
    return data.line;
  }, []);

  // #1164: opening inventory bin settlement (physical-truth boundary).
  const handleCompleteOpening = useCallback(async (taskId: string) => {
    await axiosInstance.post(
      `/api/v1/wms/recount-tasks/${taskId}/opening-complete`
    );
  }, []);

  // STOW-SPLIT-01 — stow no longer reports quantity shortfalls from a separate
  // confirmation screen. Unit-placement failures remain scanner failures and
  // do not create an exception through the retired bulk-stow callback.

  const handleFetchReturnJob = async (returnJobId: string) => {
    const { data } = await axiosInstance.get(`/api/v1/modules/returns/jobs/${returnJobId}`);
    return data.data;
  };

  const handleAddReturnLine = async (returnJobId: string, input: { scannedValue: string; quantityReceived: number; itemCondition: string; conditionNotes?: string }) => {
    await axiosInstance.post(`/api/v1/modules/returns/jobs/${returnJobId}/lines`, {
      scanned_value: input.scannedValue,
      quantity_received: input.quantityReceived,
      item_condition: input.itemCondition,
      condition_notes: input.conditionNotes,
    });
  };

  const handleProcessReturnLine = async (returnJobId: string, input: { lineId: string; itemCondition: string; quantityReceived: number; conditionNotes?: string }) => {
    await axiosInstance.patch(`/api/v1/modules/returns/jobs/${returnJobId}/lines/${input.lineId}`, {
      item_condition: input.itemCondition,
      quantity_received: input.quantityReceived,
      condition_notes: input.conditionNotes,
    });
  };

  const handleCompleteReturnJob = async (returnJobId: string, input: { returnReason?: string; returnNotes?: string }) => {
    await axiosInstance.post(`/api/v1/modules/returns/jobs/${returnJobId}/complete`, {
      return_reason: input.returnReason,
      return_notes: input.returnNotes,
    });
  };

  // GH-1245 — Receive handoff hold. Rendered only before the module has ever
  // mounted for this page instance and only while the requested job is
  // unresolved; no work is created, assigned or claimed here.
  if (awaitingReceiveHandoff && requestedReceiveJobId) {
    const handoffFailed = receiveHandoffFailedJobId === requestedReceiveJobId;
    return (
      <Box
        role="status"
        aria-live="polite"
        sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 8, px: 2 }}
      >
        {handoffFailed ? (
          <>
            <Typography sx={{ fontSize: 14, color: 'var(--ink-2)' }}>
              Couldn’t open this Receive job.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                size="small"
                onClick={() => {
                  setReceiveHandoffFailedJobId(null);
                  setReceiveHandoffAttempt((attempt) => attempt + 1);
                }}
              >
                Retry
              </Button>
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  setAwaitingReceiveHandoff(false);
                  setReceiveHandoffFailedJobId(null);
                  setSearchParams({}, { replace: true });
                }}
              >
                Back to Warehouse
              </Button>
            </Box>
          </>
        ) : (
          <Typography sx={{ fontSize: 14, color: 'var(--ink-3)' }}>Opening Receive…</Typography>
        )}
      </Box>
    );
  }

  return (
    <>
    {finishedCountLabel && (
      <Alert severity="success" onClose={() => setFinishedCountLabel(null)}>
        {finishedCountLabel} counted and submitted for review.
      </Alert>
    )}
    <WmsModuleFT2
      data={data ?? null}
      isLoading={isLoading}
      isError={isError}
      isOpsConsoleOpen={isOpsConsoleOpen}
      needsAttention={needsAttention}
      onNeedsAttentionAction={handleNeedsAttentionAction}
      onOpenHistory={handleOpenHistory}
      onOpenAllAttention={handleOpenAllAttention}
      onConnectCarrier={handleConnectCarrier}
      readyToPackOrders={readyToPackQuery.data?.orders}
      readyToPackCount={readyToPackQuery.data?.orderCount}
      openReceiveJobCount={openReceiveJobs.length}
      openReceiveJobs={openReceiveJobs}
      receiveAssignedWorkSpotlight={{
        isDismissed: receiveAssignedWorkSpotlight.isDismissed,
        dismiss: receiveAssignedWorkSpotlight.dismiss,
      }}
      openingInventorySpotlight={{
        isDismissed: openingInventorySpotlight.isDismissed,
        dismiss: openingInventorySpotlight.dismiss,
      }}
      onReceiveSessionEnter={(id) =>
        setSearchParams(
          { receiveJobId: id },
          { replace: true }
        )
      }
      canReassignReceive={canReassignReceive}
      onFetchReceiveAssignees={handleFetchReceiveAssignees}
      onReassignReceiveJob={handleReassignReceiveJob}
      recountLocked={recountLocked}
      recountTasks={recountTasks}
      recountTasksSettled={recountTasksSettled}
      onRecountUpgrade={() => setRecountUpgradeOpen(true)}
      onFetchCountingPreview={handleFetchCountingPreview}
      onFetchCountingAssignees={handleFetchCountingAssignees}
      onCreateCountingTask={handleCreateCountingTask}
      onFetchCountingLines={handleFetchCountingLines}
      onFetchCountingFindings={handleFetchCountingFindings}
      onCreateCountingFinding={handleCreateCountingFinding}
      onClaimCountingTask={handleClaimCountingTask}
      onReassignCountingTask={handleReassignCountingTask}
      onRecordCountingLine={handleRecordCountingLine}
      onSkipCountingLine={handleSkipCountingLine}
      onCloseCountingTask={handleCloseCountingTask}
      onCreateOpeningLine={handleCreateOpeningLine}
      onCompleteOpening={handleCompleteOpening}
      onCountFinished={handleCountFinished}
      currentUserId={currentUserId}
      canReassignCount={canReassignRecount}
      canManageRecount={canManageRecount}
      pendingCountTaskId={searchParams.get('countTaskId')}
      // GH-1188 — URL count-focus intent; the module holds its ordinary body
      // only while this task is still resolving.
      countFocusRequested={searchParams.get('warehouseFocus') === 'count'}
      // #1164 / WAREHOUSE-FOCUS-SHELL — opening an Opening Inventory task
      // begins its protected task session at the Brief; claim/start changes
      // task ownership/phase, not shell ownership. Ordinary cycle recounts
      // keep the plain countTaskId entry, and an id that does not resolve
      // here never invents protected focus.
      onCountSessionEnter={(id) => {
        const entered = recountTasks.find(
          (task: { recount_task_id: string; purpose?: string | null }) =>
            task.recount_task_id === id
        );
        setSearchParams(
          entered?.purpose === 'opening_inventory'
            ? { countTaskId: id, warehouseFocus: 'count' }
            : { countTaskId: id },
          { replace: true }
        );
      }}
      onCountSessionFocusChange={(taskId, focused) => {
        // #1164 — idempotent: the WMS fail-open path may report the same
        // unfocused state repeatedly; only a real change touches the URL.
        if (
          searchParams.get('countTaskId') === taskId &&
          (searchParams.get('warehouseFocus') === 'count') === focused
        ) {
          return;
        }
        setSearchParams(
          focused
            ? { countTaskId: taskId, warehouseFocus: 'count' }
            : { countTaskId: taskId },
          { replace: true }
        );
      }}
      onSetupBinsClick={handleSetupBinsClick}
      onCreateReceiveJob={handleCreateReceiveJob}
      onFetchReceiveJob={handleFetchReceiveJob}
      onClaimReceiveJob={handleClaimReceiveJob}
      onInspectReceiveLine={handleInspectReceiveLine}
      onPersistReceiveLineProgress={handlePersistReceiveLineProgress}
      onConfirmReceiveLineCount={handleConfirmReceiveLineCount}
      onReportReceiveException={handleReportReceiveException}
      onApproveOverDelivery={handleApproveOverDelivery}
      onCloseReceiveJob={handleCloseReceiveJob}
      // WAREHOUSE-FOCUS-SHELL-01A — ReceiveSessionPage reports focused
      // (sessionPhase !== 'brief') for the exact job it's showing.
      // receiveJobId is never removed here — only explicit session exit
      // (onSessionExit above) clears it — so refresh recovery is preserved
      // in both the focused and unfocused state.
      onReceiveSessionFocusChange={(jobId, focused) =>
        setSearchParams(
          focused
            ? { receiveJobId: jobId, warehouseFocus: 'receive' }
            : { receiveJobId: jobId },
          { replace: true }
        )
      }
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
      onOperationsScanResolve={handleOperationsScanResolve}
      operationsShell={operationsShell}
      onPrintUnitLabels={handlePrintUnitLabels}
      onConfirmUnitLabelsPrinted={handleConfirmUnitLabelsPrinted}
      onPackComplete={handlePackComplete}
      onConfirmShipment={handleConfirmShipment}
      onRaisePackDecision={handleRaisePackDecision}
      onPollPackDecision={handlePollPackDecision}
      onRefresh={refetch}
      onSessionExit={() => setSearchParams({}, { replace: true })}
      gridLocations={gridData?.locations}
      pendingReceiveSession={pendingReceiveSession}
      pendingStowTaskId={searchParams.get('stowTaskId')}
      pendingStowStep={searchParams.get('stowStep') === 'location' ? 'location' : null}
      pendingReturnJobId={searchParams.get('returnJobId')}
      // WAREHOUSE-FOCUS-SHELL-01A — opening a task writes stowTaskId ONLY.
      // No warehouseFocus here: the Brief is pre-execution and keeps the
      // normal application shell.
      onStowSessionEnter={(id) => setSearchParams({ stowTaskId: id }, { replace: true })}
      // Any actual execution transition (reported via onActiveTaskChange in
      // StowSessionPage, forwarded here as onStowSessionStepChange) adds
      // warehouseFocus=stow so AppLayout hides topnav+sidenav. Fires on
      // every step change — including the transition INTO execution, a
      // same-task phase change, and Task A -> Task B auto-advance — so
      // focus stays continuous exactly as long as an execution phase is
      // reported, without introducing any state beyond the URL.
      onStowSessionStepChange={(id, step) =>
        setSearchParams(
          step === 'location'
            ? { stowTaskId: id, stowStep: 'location', warehouseFocus: 'stow' }
            : { stowTaskId: id, warehouseFocus: 'stow' },
          { replace: true }
        )
      }
      pendingPickBatchId={searchParams.get('batchId')}
      // WAREHOUSE-SESSION-FOCUS-02A — Pick is focused from its Brief onward:
      // entering (or restoring) a Pick session always lands on the canonical
      // focused URL and never strips warehouseFocus=pick. Only onSessionExit
      // clears batchId + focus together.
      onPickSessionEnter={(id) =>
        setSearchParams({ batchId: id, warehouseFocus: 'pick' }, { replace: true })
      }
      pendingPackBatchId={searchParams.get('packBatchId')}
      onPackSessionEnter={(id) => setSearchParams({ packBatchId: id }, { replace: true })}
      isOnline={isOnline}
      queuedCount={queuedCount}
      stowTasks={stowTasks}
      onClaimStowTask={handleClaimStowTask}
      onConfirmStow={handleConfirmStow}
      onFetchStowTasks={handleFetchStowTasks}
      onFetchStowPlacements={handleFetchStowPlacements}
      onResolveLocation={handleResolveLocation}
      onAssignStowLocation={handleAssignStowLocation}
      canAssignStow={canAssignStow}
      onFetchStowAssignees={handleFetchCountingAssignees}
      onAssignStowTask={handleAssignStowTask}
      onFetchReturnJob={handleFetchReturnJob}
      onAddReturnLine={handleAddReturnLine}
      onProcessReturnLine={handleProcessReturnLine}
      onCompleteReturnJob={handleCompleteReturnJob}
      openingInventory={openingInventory}
      canApproveOpeningInventoryCutover={canApproveOpeningInventoryCutover}
      openingInventoryCutoverSubmitting={openingCutoverSubmitting}
      openingInventoryCutoverError={openingCutoverError}
      onApproveOpeningInventoryCutover={handleApproveOpeningInventoryCutover}
    />
   <UpgradePrompt
      requiredTier="core"
      mode="modal"
      featureName="Reconcile inventory"
      open={recountUpgradeOpen}
      onClose={() => setRecountUpgradeOpen(false)}
    />
   { showQzPrompt && (
    <QzTrayOnboardingPrompt
      onDismiss={() => {
        dismissQzPrompt();
        setShowQzPrompt(false);
      }}
    />
   )}
    {/* WMS-OPS-MODAL-PARITY-01 — canonical EntityDetailModal shell (top-right X,
        no footer); body states, rows and backend order unchanged. */}
    <EntityDetailModal
      entityId={historyOpen ? 'wms-operations-history' : null}
      title="History"
      onClose={() => setHistoryOpen(false)}
      maxWidth="md"
    >
      {historyQuery.isError && !historyQuery.data ? (
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>History unavailable.</Typography>
      ) : !historyQuery.data ? (
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>Loading history…</Typography>
      ) : historyRows.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>Nothing verified resolved yet.</Typography>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1.25 }}>
          {historyRows.map((row) => (
            <Box component="li" key={row.id} data-surface="raised" sx={MODAL_LIST_ITEM_SX}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                <Typography sx={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflowWrap: 'anywhere' }}>
                  {row.label}
                </Typography>
                {row.meta && (
                  <Typography sx={{ flexShrink: 0, fontSize: 11.5, color: 'var(--ink-4)', fontVariantNumeric: 'tabular-nums' }}>
                    {row.meta}
                  </Typography>
                )}
              </Box>
              {row.subtitle && (
                <Typography sx={{ mt: 0.25, fontSize: 12, color: 'var(--ink-3)', overflowWrap: 'anywhere' }}>
                  {row.subtitle}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}
    </EntityDetailModal>
    <EntityDetailModal
      entityId={attentionModalOpen ? 'wms-needs-attention' : null}
      title="Needs attention"
      onClose={() => setAttentionModalOpen(false)}
      maxWidth="md"
    >
      <Box component="ul" role="list" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1.25 }}>
        {attentionNowRows.map((row) => (
          <Box component="li" role="listitem" key={row.id} data-surface="raised" sx={{ ...MODAL_LIST_ITEM_SX, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography sx={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflowWrap: 'anywhere' }}>
              {row.label}
            </Typography>
            {row.action && (
              <Button
                size="small"
                onClick={() => handleNeedsAttentionAction(row.id)}
                sx={{ flexShrink: 0, color: 'var(--accent)', fontWeight: 500, textTransform: 'none' }}
              >
                {row.action.label} <span aria-hidden="true">→</span>
              </Button>
            )}
          </Box>
        ))}
      </Box>
    </EntityDetailModal>
   </>
  );
}
