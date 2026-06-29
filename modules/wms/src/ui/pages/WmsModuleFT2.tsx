// modules/wms/src/ui/pages/WmsModuleFT2.tsx
import { useState, memo, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  TextField,
} from '@mui/material';
import { ScanBarcode, Package } from 'lucide-react';
import { WmsConnectionBadge } from '../components/WmsConnectionBadge.js';
import PickSessionPage, {
  type LineItem,
  type ConfirmScanParams,
  type ReportExceptionParams,
  type CreateProblemTaskParams,
} from './PickSessionPage.js';
import PackSessionPage, {
  type PackOrder,
} from './PackSessionPage.js';
import ReceiveSessionPage, {
type ReceiveJobLine,
} from './ReceiveSessionPage.js';
import StowSessionPage from './StowSessionPage.js';
import { ModuleErrorBoundary, WarehouseGrid } from '@lasyncro/shared/ui';
import type { WarehouseLocation } from '@lasyncro/shared/ui';

/**
 * WMS MODULE — FT2 SURFACE
 * -------------------------
 * Mobile-optimized pick/pack operator interface.
 *
 * Zones:
 * - Active pick session → PickSessionPage
 * - Active pack session → PackSessionPage
 * - Available/pick_complete batches → action buttons
 * - Empty state → no batches released
 *
 * All API callbacks injected via props — module stays decoupled
 * from apps/frontend HTTP layer.
 *
 * Theme-aware: Paper, theme.palette tokens, no hardcoded colors.
 */

export type WmsBatch = {
  pick_batch_id: string;
  status: string;
  total_line_items: number;
  total_units: number;
  units_picked: number;
  units_packed: number;
  picked_by: number | null;
  packed_by: number | null;
  released_at: string;
};

export type WmsData = {
  batches: WmsBatch[];
} | null;

export type WmsStowTask = {
  stow_task_id: string;
  lasyncro_variant_id: string;
  quantity: number;
  location_code: string | null;
  status: 'pending' | 'in_progress';
  trigger: string;
  claimed_by: number | null;
  claimed_at: string | null;
  created_at: string;
  variant_title: string | null;
  sku: string | null;
  product_title: string | null;
  image_url: string | null;       // WEB-STOW-UNIT-01: product image for item scan confirmation
  unit_ids: string[] | null;      // WEB-STOW-UNIT-01: LSU- IDs for units assigned to this task
};

export type WmsModuleFT2Props = {
  data: WmsData;
  isLoading: boolean;
  isError: boolean;
  gridLocations?: WarehouseLocation[];

  onCreateReceiveJob?: (poId: string) => Promise<{ receive_job_id: string }>;
  onFetchReceiveJob?: (jobId: string) => Promise<{ job: { po_id: string; supplier_name: string }; lines: ReceiveJobLine[] }>;
  onInspectReceiveLine?: (jobId: string, params: { lasyncro_variant_id: string | null; receive_job_line_id: string; quantity_accepted: number; quantity_rejected: number }) => Promise<void>;
  onReportReceiveException?: (jobId: string, params: { lasyncro_variant_id: string | null; receive_job_line_id: string; exception_type: string; quantity_affected: number; notes?: string }) => Promise<void>;
  onCloseReceiveJob?: (jobId: string, params: { actual_delivery_date?: string }) => Promise<void>;
  onPrintUnitLabels?: (receiveJobLineId: string) => Promise<void>;

  onClaimBatch: (batchId: string) => Promise<void>;
  onFetchLineItems: (batchId: string) => Promise<LineItem[]>;
  onResolveBarcode: (scannedValue: string) => Promise<{ lasyncro_variant_id: string } | null>;
  onConfirmScan: (batchId: string, params: ConfirmScanParams) => Promise<void>;
  onReportException: (batchId: string, params: ReportExceptionParams) => Promise<void>;
  onCreateProblemTask: (params: CreateProblemTaskParams) => Promise<void>;
  onPickComplete: (batchId: string) => Promise<void>;

  onClaimPack: (batchId: string) => Promise<void>;
  onFetchPackOrders: (batchId: string) => Promise<PackOrder[]>;
  onPackFreeScan: (scannedValue: string) => Promise<PackFreeScanApiResponse>;
  onConfirmPackScan: (batchId: string, params: {
    lasyncro_order_id: string;
    lasyncro_line_item_id: string;
    lasyncro_variant_id: string;
    quantity_confirmed: number;
  }) => Promise<{ order_complete: boolean }>;
  onReportPackException: (batchId: string, params: ReportExceptionParams) => Promise<void>;
  onPrintLabel: (orderId: string) => Promise<void>;
  onPrintInvoice: (orderId: string) => Promise<void>;
  onPackComplete: (batchId: string) => Promise<void>;
  /** WEB-PACK-02 — item-centric free-scan. Accepts LSU- or LSO- barcode. */

  onConfirmShipment: (batchId: string, orderId: string, partial?: boolean) => Promise<void>;
  onRaisePackDecision: (batchId: string, params: {
    pick_batch_id: string;
    lasyncro_order_id: string;
    lasyncro_line_item_id: string;
    exception_type: 'item_missing' | 'short_pick';
    question: 'ship_partial';
  }) => Promise<{ id: string }>;
  onPollPackDecision: (requestId: string) => Promise<{
    status: 'pending' | 'approved' | 'rejected';
    partial_shipment: boolean | null;
    note: string | null;
  }>;
  onRefresh: () => void;
  onSessionExit?: () => void;
  /** Stow tasks — pending stock that needs to be put away after receive or cancelled pick */
  stowTasks?: WmsStowTask[];
  onClaimStowTask?: (taskId: string) => Promise<void>;
  onConfirmStow?: (taskId: string, quantityPlaced?: number, lasyncroUnitId?: string) => Promise<void>;
  // Full stow session callbacks
  onFetchStowTasks?: () => Promise<WmsStowTask[]>;
  onResolveLocation?: (scannedValue: string) => Promise<{ location_code: string } | null>;
  onAssignStowLocation?: (taskId: string, locationCode: string) => Promise<void>;
  onReportStowException?: (taskId: string, params: { exception_type: string; quantity: number; notes?: string }) => Promise<{ prob_label?: string; problem_bin?: string }>;
  isOnline: boolean;
  queuedCount: number;
  /** Pre-fetched receive job from URL handoff (Suppliers → WMS). Auto-enters receive session on mount. */
  pendingReceiveSession?: { receiveJobId: string; poId: string; supplierName: string; lines: ReceiveJobLine[] } | null;
  /** Stow task ID from URL param — auto-enters stow session on mount. */
  pendingStowTaskId?: string | null;
  /** Called when operator claims a stow task — parent sets URL param for refresh recovery. */
  onStowSessionEnter?: (taskId: string) => void;
  /** Pick batch ID from URL param — auto-enters pick session on mount. */
  pendingPickBatchId?: string | null;
  /** Called when operator enters a pick session — parent sets URL param for refresh recovery. */
  onPickSessionEnter?: (batchId: string) => void;
  /** Pack batch ID from URL param — auto-enters pack session on mount. */
  pendingPackBatchId?: string | null;
  /** Called when operator enters a pack session — parent sets URL param for refresh recovery. */
  onPackSessionEnter?: (batchId: string) => void;
};

const STATUS_LABELS: Record<string, {
  label: string;
  color: 'default' | 'primary' | 'success' | 'warning' | 'error';
}> = {
  pending:       { label: 'Available',   color: 'primary' },
  picking:       { label: 'In Progress', color: 'warning' },
  pick_complete: { label: 'Ready to Pack', color: 'success' },
  packing:       { label: 'Packing',     color: 'warning' },
  pack_complete: { label: 'Complete',    color: 'success' },
  cancelled:     { label: 'Cancelled',   color: 'error'   },
};


const BatchCard = memo(function BatchCard({
  batch,
  onClaim,
  onContinuePick,
  gridLocations,
  onFetchLineItems,
}: {
  batch: WmsBatch;
  onClaim: (batchId: string) => void;
  onContinuePick: (batchId: string) => void;
  gridLocations?: WarehouseLocation[];
  onFetchLineItems?: (batchId: string) => Promise<{ location_code: string }[]>;
}) {
  const releasedAt = new Date(batch.released_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const [mapOpen, setMapOpen] = useState(false);
  const [pickLocations, setPickLocations] = useState<string[]>([]);
  const [mapLoading, setMapLoading] = useState(false);

  const handleToggleMap = async () => {
    if (mapOpen) { setMapOpen(false); return; }
    if (!onFetchLineItems || !gridLocations?.length) { setMapOpen(true); return; }
    setMapLoading(true);
    try {
      const items = await onFetchLineItems(batch.pick_batch_id);
      const codes = [...new Set(
        items.map((i) => i.location_code).filter(Boolean)
      )].sort() as string[];
      setPickLocations(codes);
    } catch { /* silent — grid renders with empty highlight */ }
    finally { setMapLoading(false); setMapOpen(true); }
  };

  const pickProgress = batch.total_units > 0
    ? Math.round((batch.units_picked / batch.total_units) * 100)
    : 0;

  const packProgress = batch.total_units > 0
    ? Math.round((batch.units_packed / batch.total_units) * 100)
    : 0;

  const isPending      = batch.status === 'pending';
  const isPicking      = batch.status === 'picking';
  const isPickComplete = batch.status === 'pick_complete';
  const isPacking      = batch.status === 'packing';

  const ctaLabel = isPending ? 'Claim & pick →'
    : isPicking      ? 'Continue picking →'
    : isPickComplete ? 'Ready to pack →'
    : isPacking      ? 'Continue packing →'
    : null;

  const handleCta = () => {
    if (isPending) onClaim(batch.pick_batch_id);
    else if (isPicking) onContinuePick(batch.pick_batch_id);
  };

  return (
    <Box sx={{
      bgcolor: 'var(--surface)',
      border: '1px solid var(--rule)',
      borderRadius: '14px',
      p: '18px 20px',
      mb: 1.5,
    }}>

      {/* HEADER */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <Typography sx={{
          fontFamily: '"DM Mono", "SF Mono", ui-monospace, monospace',
          fontSize: 14.5, fontWeight: 500, color: 'var(--ink)',
          letterSpacing: '0.03em',
        }}>
          {batch.pick_batch_id.slice(0, 8).toUpperCase()}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
          {batch.total_line_items} lines · {batch.total_units} units · {releasedAt}
        </Typography>
      </Box>

      {/* PICK MAP */}
      {gridLocations && gridLocations.length > 0 && (
        <Box
          onClick={handleToggleMap}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.75,
            px: 1.25, py: 0.5, mb: 1.75,
            fontSize: 11, fontWeight: 500, color: 'var(--accent)',
            border: '0.5px solid var(--accent)', borderRadius: '6px',
            cursor: 'pointer',
            '&:hover': { opacity: 0.75 },
          }}
        >
          {mapLoading ? <CircularProgress size={11} sx={{ mr: 0.5 }} /> : null}
          {mapOpen ? 'Hide map' : 'Show pick map'}
        </Box>
      )}
      {mapOpen && gridLocations && (
        <Box sx={{ mb: 2, border: '1px solid var(--rule)', borderRadius: '8px', p: 1, bgcolor: 'var(--bg-2)', overflowX: 'auto' }}>
          <WarehouseGrid
            locations={gridLocations}
            highlightedBins={pickLocations}
            pickPath={pickLocations}
            mode="pick"
            variant="mini"
          />
          {pickLocations.length > 0 && (
            <Typography sx={{ fontSize: 10, color: 'var(--ink-4)', mt: 0.5, letterSpacing: '0.06em' }}>
              Pick route: {pickLocations.join(' → ')}
            </Typography>
          )}
        </Box>
      )}

      {/* DUAL PROGRESS BARS */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2.75, mb: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.875 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>Picking</Typography>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
              {batch.units_picked}/{batch.total_units}
            </Typography>
          </Box>
          <Box sx={{ height: 7, borderRadius: '4px', bgcolor: 'var(--rule)', overflow: 'hidden' }}>
            <Box sx={{ width: `${pickProgress}%`, height: '100%', bgcolor: 'var(--ok, #4CAF7A)', borderRadius: '4px', transition: 'width 0.3s ease' }} />
          </Box>
        </Box>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.875 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>Packing</Typography>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
              {batch.units_packed}/{batch.total_units}
            </Typography>
          </Box>
          <Box sx={{ height: 7, borderRadius: '4px', bgcolor: 'var(--rule)', overflow: 'hidden' }}>
            <Box sx={{ width: `${packProgress}%`, height: '100%', bgcolor: 'var(--accent)', borderRadius: '4px', transition: 'width 0.3s ease' }} />
          </Box>
        </Box>
      </Box>

      {/* FOOTER */}
      <Box sx={{ display: 'flex', alignItems: 'center', pt: 1.75, borderTop: '1px solid var(--rule)' }}>
        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
          {isPicking ? 'Picking in progress' : isPickComplete ? 'Picking done · awaiting pack scan' : isPacking ? 'Packing in progress' : 'Available'}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {ctaLabel && (
          <Box
            component="button"
            onClick={handleCta}
            disabled={isPickComplete}
            sx={{
              fontSize: 12, fontWeight: 600,
              color: isPickComplete ? 'var(--ink-3)' : '#10151E',
              bgcolor: isPickComplete ? 'var(--rule)' : 'var(--accent)',
              border: 'none', borderRadius: '8px',
              px: 2.25, py: 1,
              cursor: isPickComplete ? 'default' : 'pointer',
              '&:hover:not(:disabled)': { opacity: 0.88 },
              transition: 'opacity 0.15s ease',
            }}
          >
            {ctaLabel}
          </Box>
        )}
      </Box>
    </Box>
  );
});

/**
 * STOW TASK CARD
 * --------------
 * Displays a pending stow task — stock that needs to be put away.
 * Triggered by: inbound receive close, cancelled order mid-pick.
 */
const StowTaskCard = memo(function StowTaskCard({
  task,
  onClaim,
  onConfirm,
}: {
  task: WmsStowTask;
  onClaim: (taskId: string) => void;
  onConfirm: (taskId: string) => void;
}) {
  const triggerLabel = task.trigger === 'order_cancelled_mid_pick' ? 'Cancelled pick' : 'Inbound receive';
  const isPending = task.status === 'pending';

  return (
    <Box sx={{
      bgcolor: 'var(--surface)',
      border: '1px solid var(--accent-border)',
      borderRadius: '14px',
      p: '18px 20px',
      mb: 1.5,
    }}>
      {/* HEADER */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.25 }}>
        {task.image_url ? (
          <Box component="img" src={task.image_url} alt="" sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }} />
        ) : (
          <Box sx={{ width: 40, height: 40, borderRadius: '8px', bgcolor: 'var(--accent-ghost)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Package size={18} color="var(--accent)" />
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {task.product_title ?? task.variant_title ?? task.sku ?? task.lasyncro_variant_id.slice(0, 8).toUpperCase()}
          </Typography>
          {task.sku && (
            <Typography sx={{ fontSize: 11.5, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }}>{task.sku}</Typography>
          )}
        </Box>
        <Box sx={{ px: 1, py: 0.375, bgcolor: 'var(--accent-ghost)', border: '0.5px solid var(--accent-border)', borderRadius: '100px', flexShrink: 0 }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 600, color: 'var(--accent)', letterSpacing: '0.04em' }}>Stow pending</Typography>
        </Box>
      </Box>

      {/* METADATA */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>Qty: {task.quantity}</Typography>
        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>Location: {task.location_code ?? 'Unassigned'}</Typography>
        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>Source: {triggerLabel}</Typography>
      </Box>

      {/* CTA */}
      <Box
        component="button"
        onClick={() => isPending ? onClaim(task.stow_task_id) : onConfirm(task.stow_task_id)}
        sx={{
          width: '100%', fontSize: 12, fontWeight: 600,
          color: 'var(--accent-ink)', bgcolor: 'var(--accent)',
          border: 'none', borderRadius: '8px',
          py: 1.25, cursor: 'pointer',
          '&:hover': { opacity: 0.88 },
          transition: 'opacity 0.15s ease',
        }}
      >
        {isPending ? 'Claim & stow →' : 'Confirm stowed →'}
      </Box>
    </Box>
  );
});

export interface PackFreeScanLineItem {
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  product_title: string;
  quantity: number;
  image_url: string | null;
  sku: string | null;
  pack_scanned: boolean;
}

/** Shape of POST /wms/pack/free-scan LSU- happy-path response (WEB-PACK-02). */
export interface PackFreeScanResult {
  type: 'unit_resolved';
  pick_batch_id: string;
  lasyncro_unit_id: string;
  lasyncro_order_id: string;
  order_complete: boolean;
  auto_claimed: boolean;
  has_carrier_label: boolean;
  variant: { variant_title: string; sku: string | null; image_url: string | null } | null;
  order: {
    lasyncro_order_id: string;
    external_order_id: string;
    wms_barcode: string | null;
    total_price: number;
    currency: string;
    shipping_name: string | null;
    shipping_address1: string | null;
    shipping_city: string | null;
    shipping_zip: string | null;
    shipping_country_code: string | null;
  } | null;
  line_items: {
    lasyncro_line_item_id: string;
    lasyncro_variant_id: string;
    product_title: string;
    quantity: number;
    image_url: string | null;
    sku: string | null;
    pack_scanned: boolean;
  }[];
}

export type PackFreeScanApiResponse =
  | PackFreeScanResult
  | { type: 'shipped'; lasyncro_order_id: string; external_order_id: string; pick_batch_id: string; batch_complete: boolean }
  | { error: string; message: string };

type ActiveSession =
  | { type: 'pick'; batchId: string; lineItems: LineItem[] }
  | { type: 'pack'; freeScanResult: PackFreeScanResult }
  | { type: 'receive'; receiveJobId: string; poId: string; supplierName: string; lines: ReceiveJobLine[] }
  | { type: 'stow'; taskId: string }
  | null;

function WmsModuleFT2Inner({
  data,
  isLoading,
  isError,

  onCreateReceiveJob,
  onFetchReceiveJob,
  onInspectReceiveLine,
  onReportReceiveException,
  onCloseReceiveJob,
  onPrintUnitLabels,

  onClaimBatch,
  onFetchLineItems,
  onResolveBarcode,
  onConfirmScan,
  onReportException,
  onCreateProblemTask,
  onPickComplete,
  onClaimPack,
  onFetchPackOrders,
  onPackFreeScan,
  onConfirmPackScan,
  onReportPackException,
  onPrintLabel,
  onPrintInvoice,
  onPackComplete,
  onConfirmShipment,
  onRefresh,
  onSessionExit,
  isOnline,
  queuedCount,
  stowTasks,
  onClaimStowTask,
  onConfirmStow,
  onFetchStowTasks,
  onResolveLocation,
  onAssignStowLocation,
  onReportStowException,
  gridLocations,
  pendingReceiveSession,
  pendingStowTaskId,
  onStowSessionEnter,
  pendingPickBatchId,
  onPickSessionEnter,
  pendingPackBatchId,
  onPackSessionEnter,
  onRaisePackDecision,
  onPollPackDecision,
}: WmsModuleFT2Props) {
  // Auto-enter receive session if handed off from Suppliers portal via URL param
  const [activeSession, setActiveSession] = useState<ActiveSession>(
    pendingReceiveSession
      ? { type: 'receive', ...pendingReceiveSession }
      : pendingStowTaskId
      ? { type: 'stow', taskId: pendingStowTaskId }
      : null
  );
  useEffect(() => {
    if (pendingReceiveSession) {
      setActiveSession({ type: 'receive', ...pendingReceiveSession });
    }
  }, [pendingReceiveSession]);

  useEffect(() => {
    if (pendingStowTaskId) {
      setActiveSession({ type: 'stow', taskId: pendingStowTaskId });
    }
  }, [pendingStowTaskId]);

  useEffect(() => {
    if (pendingPickBatchId) {
      enterPickSession(pendingPickBatchId, false).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [loadingSession, setLoadingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const batches = data?.batches ?? [];

  const enterPickSession = async (batchId: string, claim: boolean) => {
    setLoadingSession(true);
    setSessionError(null);
    try {
      if (claim) await onClaimBatch(batchId);
      const items = await onFetchLineItems(batchId);
      setActiveSession({ type: 'pick', batchId, lineItems: items });
      onPickSessionEnter?.(batchId);
    } catch (err: any) {
      setSessionError(err?.message ?? 'Failed to start pick session.');
    } finally {
      setLoadingSession(false);
    }
  };

  const [packScanLoading, setPackScanLoading] = useState(false);
  const [packScanError, setPackScanError] = useState<string | null>(null);
  const packInputRef = useRef<HTMLInputElement>(null);
  const packErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-focus pack input whenever operations page becomes active
  useEffect(() => {
    if (!activeSession) setTimeout(() => packInputRef.current?.focus(), 100);
  }, [activeSession]);

  const handlePackFreeScan = async (scannedValue: string) => {
    if (packScanLoading) return;
    if (packErrorTimerRef.current) clearTimeout(packErrorTimerRef.current);
    setPackScanLoading(true);
    setPackScanError(null);
    try {
      const result = await onPackFreeScan(scannedValue);
      if ('error' in result) {
        setPackScanError(result.message);
        packErrorTimerRef.current = setTimeout(() => setPackScanError(null), 3500);
        return;
      }
      if (result.type === 'unit_resolved') {
        setActiveSession({ type: 'pack', freeScanResult: result });
      }
    } catch (err: any) {
      const msg: string = err?.response?.data?.message ?? err?.message ?? 'Scan failed — try again';
      setPackScanError(msg);
      packErrorTimerRef.current = setTimeout(() => setPackScanError(null), 3500);
    } finally {
      setPackScanLoading(false);
      if (packInputRef.current) packInputRef.current.value = '';
    }
  };

  const exitSession = () => {
    setActiveSession(null);
    onRefresh();
    onSessionExit?.();
  };

  // Active pick session
  if (activeSession?.type === 'pick') {
    return (
      <PickSessionPage
        pickBatchId={activeSession.batchId}
        lineItems={activeSession.lineItems}
        onComplete={exitSession}
        onResolveBarcode={onResolveBarcode}
        onConfirmScan={(params) => onConfirmScan(activeSession.batchId, params)}
        onReportException={(params) => onReportException(activeSession.batchId, params)}
        onCreateProblemTask={onCreateProblemTask}
        onPickComplete={() => onPickComplete(activeSession.batchId)}
      />
    );
  }

  // Active pack session (WEB-PACK-02 — item-centric free-scan)
  if (activeSession?.type === 'pack') {
    return (
      <PackSessionPage
        initialFreeScanResult={activeSession.freeScanResult}
        onPackFreeScan={onPackFreeScan}
        onPrintInvoice={onPrintInvoice}
        onPrintLabel={onPrintLabel}
        onCreateProblemTask={onCreateProblemTask}
        onComplete={exitSession}
      />
    );
  }

  // Active receive session
  if (activeSession?.type === 'receive') {
    return (
      <ReceiveSessionPage
        receiveJobId={activeSession.receiveJobId}
        poId={activeSession.poId}
        supplierName={activeSession.supplierName}
        lines={activeSession.lines}
        onInspectLine={(params) => onInspectReceiveLine?.(activeSession.receiveJobId, params) ?? Promise.resolve()}
        onReportException={(params) => onReportReceiveException?.(activeSession.receiveJobId, params) ?? Promise.resolve()}
        onCloseJob={(params) => onCloseReceiveJob?.(activeSession.receiveJobId, params) ?? Promise.resolve()}
        onComplete={exitSession}
        onResolveBarcode={onResolveBarcode}
        onPrintUnitLabels={onPrintUnitLabels}
      />
    );
  }

  // Active stow session
  if (activeSession?.type === 'stow') {
    return (
      <StowSessionPage
        initialTaskId={activeSession.taskId}
        onComplete={exitSession}
        onFetchTasks={onFetchStowTasks ?? (() => Promise.resolve([]))}
        onResolveLocation={onResolveLocation ?? (() => Promise.resolve(null))}
        onAssignLocation={(taskId, locationCode) => onAssignStowLocation?.(taskId, locationCode) ?? Promise.resolve()}
        onClaimTask={(taskId) => onClaimStowTask?.(taskId) ?? Promise.resolve()}
        onResolveBarcode={onResolveBarcode}
        onConfirmStow={(taskId, qty, lasyncroUnitId) => onConfirmStow?.(taskId, qty, lasyncroUnitId) ?? Promise.resolve()}
        onReportException={(taskId, params) => onReportStowException?.(taskId, params) ?? Promise.resolve({})}
      />
    );
  }

  return (
    <Box sx={{ p: '30px 24px', maxWidth: 720, mx: 'auto' }}>

      {/* PAGE HEADER */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 3 }}>
        <Box>
          <Typography sx={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }}>
            Warehouse
          </Typography>
          <Typography sx={{ fontSize: 14, fontWeight: 300, color: 'var(--ink-3)', mt: 0.75 }}>
            Pick and pack active batches.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
          <WmsConnectionBadge isOnline={isOnline} queuedCount={queuedCount} />
          {isOnline && (
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 0.875,
              border: '1px solid rgba(76,175,122,0.3)',
              borderRadius: '100px', px: 1.375, py: 0.625,
            }}>
              <Box sx={{
                width: 6, height: 6, borderRadius: '50%', bgcolor: '#4CAF7A',
                '@keyframes wmsOnlinePulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } },
                animation: 'wmsOnlinePulse 2.4s ease-in-out infinite',
              }} />
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: '#4CAF7A' }}>Online</Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* LOADING */}
      {(isLoading || loadingSession) && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {/* ERROR */}
      {(isError || sessionError) && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: '10px' }}>
          {sessionError ?? 'Failed to load warehouse data. Please refresh.'}
        </Alert>
      )}

      {/* PACK MODE PANEL — always-on free-scan surface (WEB-PACK-02) */}
      <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '20px 22px', mb: 2.75 }}>

        {/* Header row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.625, mb: 2 }}>
          <Box sx={{
            width: 40, height: 40, borderRadius: '10px',
            bgcolor: packScanError ? 'rgba(229,72,77,0.12)' : 'var(--accent-ghost)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {packScanLoading
              ? <CircularProgress size={18} sx={{ color: 'var(--accent)' }} />
              : <ScanBarcode size={20} color={packScanError ? '#E5484D' : 'var(--accent)'} />}
          </Box>
          <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>Pack mode</Typography>
          <Box sx={{ flex: 1 }} />
          {/* Status pill */}
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.75,
            border: `1px solid ${packScanError ? 'rgba(229,72,77,0.35)' : 'rgba(76,175,122,0.3)'}`,
            borderRadius: '100px', px: 1.375, py: 0.5,
          }}>
            <Box sx={{
              width: 5, height: 5, borderRadius: '50%',
              bgcolor: packScanError ? '#E5484D' : '#4CAF7A',
              ...(!packScanError && !packScanLoading && {
                '@keyframes wmsListenPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } },
                animation: 'wmsListenPulse 1.6s ease-in-out infinite',
              }),
            }} />
            <Typography sx={{ fontSize: 11.5, fontWeight: 500, color: packScanError ? '#E5484D' : '#4CAF7A' }}>
              {packScanLoading ? 'Resolving…' : packScanError ? 'Hold' : 'Listening'}
            </Typography>
          </Box>
        </Box>

        {/* Error alert */}
        {packScanError && (
          <Alert severity="error" sx={{ mb: 1.5, py: 0.5, fontSize: 13, borderRadius: '8px' }}>
            {packScanError}
          </Alert>
        )}

        {/* Scan input */}
        <Box sx={{
          bgcolor: 'var(--bg)',
          border: '1.5px solid',
          borderColor: packScanError ? 'error.main' : 'rgba(255,107,43,0.45)',
          borderRadius: '10px',
          px: 2.25, py: 1.875, mb: 1.25,
        }}>
          <TextField
            inputRef={packInputRef}
            fullWidth
            variant="standard"
            placeholder="Scan any LSU- barcode to begin packing"
            disabled={packScanLoading}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const val = packInputRef.current?.value.trim();
                if (val) void handlePackFreeScan(val);
              }
            }}
            autoComplete="off"
            InputProps={{ disableUnderline: true }}
            sx={{
              '& .MuiInputBase-input': {
                fontFamily: '"DM Mono", "SF Mono", ui-monospace, monospace',
                fontSize: 15, color: 'var(--ink-3)',
                '&::placeholder': { color: 'var(--ink-4)' },
              },
            }}
          />
        </Box>
        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
          Scanner auto-submits · manual entry: press Enter
        </Typography>
      </Box>

      {/* ACTIVE BATCHES SECTION */}
      {!isLoading && !loadingSession && batches.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
            Active batches
          </Typography>
          <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
            {batches.length} in progress
          </Typography>
        </Box>
      )}

      {/* EMPTY STATE */}
      {!isLoading && !loadingSession && !isError && batches.length === 0 && (
        <Box sx={{
          textAlign: 'center', py: 8,
          bgcolor: 'var(--surface)', border: '1px dashed var(--rule)',
          borderRadius: '14px',
        }}>
          <ScanBarcode size={36} color="var(--ink-4)" />
          <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-4)', mt: 1.5 }}>
            No active batches — waiting for release.
          </Typography>
        </Box>
      )}

      {/* BATCH LIST */}
      {!isLoading && !loadingSession && batches.map((batch) => (
        <BatchCard
          key={batch.pick_batch_id}
          batch={batch}
          onClaim={(id) => void enterPickSession(id, true)}
          onContinuePick={(id) => void enterPickSession(id, false)}
          gridLocations={gridLocations}
          onFetchLineItems={onFetchLineItems}
        />
      ))}

      {/* STOW TASKS */}
      {!isLoading && !loadingSession && (stowTasks ?? []).length > 0 && (
        <Box sx={{ mt: batches.length > 0 ? 3 : 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
            <Typography sx={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              Stow tasks
            </Typography>
            <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
              {(stowTasks ?? []).length} pending
            </Typography>
          </Box>
          {(stowTasks ?? []).map((task) => (
            <StowTaskCard
              key={task.stow_task_id}
              task={task}
              onClaim={(id) => { onStowSessionEnter?.(id); setActiveSession({ type: 'stow', taskId: id }); }}
              onConfirm={(id) => void onConfirmStow?.(id).then(onRefresh)}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

export default function WmsModuleFT2(props: WmsModuleFT2Props) {
  return <ModuleErrorBoundary moduleName="wms"><WmsModuleFT2Inner {...props} /></ModuleErrorBoundary>;
}