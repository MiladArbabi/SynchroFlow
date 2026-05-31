// modules/wms/src/ui/pages/WmsModuleFT2.tsx
import { useState, memo, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  CircularProgress,
  Alert,
  Button,
  Chip,
  LinearProgress,
  useTheme,
} from '@mui/material';
import { ScanBarcode, PackageCheck, Clock } from 'lucide-react';
import { WmsConnectionBadge } from '../components/WmsConnectionBadge.js';
import PickSessionPage, {
  type LineItem,
  type ConfirmScanParams,
  type ReportExceptionParams,
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

  onClaimBatch: (batchId: string) => Promise<void>;
  onFetchLineItems: (batchId: string) => Promise<LineItem[]>;
  onResolveBarcode: (scannedValue: string) => Promise<{ lasyncro_variant_id: string } | null>;
  onConfirmScan: (batchId: string, params: ConfirmScanParams) => Promise<void>;
  onReportException: (batchId: string, params: ReportExceptionParams) => Promise<void>;
  onPickComplete: (batchId: string) => Promise<void>;

  onClaimPack: (batchId: string) => Promise<void>;
  onFetchPackOrders: (batchId: string) => Promise<PackOrder[]>;
  onConfirmPackScan: (batchId: string, params: {
    lasyncro_order_id: string;
    lasyncro_line_item_id: string;
    lasyncro_variant_id: string;
    quantity_confirmed: number;
  }) => Promise<{ order_complete: boolean }>;
  onReportPackException: (batchId: string, params: ReportExceptionParams) => Promise<void>;
  onPrintLabel: (orderId: string) => Promise<void>;
  onPackComplete: (batchId: string) => Promise<void>;

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
  onConfirmStow?: (taskId: string) => Promise<void>;
  // Full stow session callbacks
  onFetchStowTasks?: () => Promise<WmsStowTask[]>;
  onResolveLocation?: (scannedValue: string) => Promise<{ location_code: string } | null>;
  onAssignStowLocation?: (taskId: string, locationCode: string) => Promise<void>;
  onReportStowException?: (taskId: string, params: { exception_type: string; quantity: number; notes?: string }) => Promise<{ prob_label?: string; problem_bin?: string }>;
  isOnline: boolean;
  queuedCount: number;
  /** Pre-fetched receive job from URL handoff (Suppliers → WMS). Auto-enters receive session on mount. */
  pendingReceiveSession?: { receiveJobId: string; poId: string; supplierName: string; lines: ReceiveJobLine[] } | null;
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
  onClaimPack,
  onContinuePack,
  gridLocations,
  onFetchLineItems,
}: {
  batch: WmsBatch;
  onClaim: (batchId: string) => void;
  onContinuePick: (batchId: string) => void;
  onClaimPack: (batchId: string) => void;
  onContinuePack: (batchId: string) => void;
  gridLocations?: WarehouseLocation[];
  onFetchLineItems?: (batchId: string) => Promise<{ location_code: string }[]>;
}) {
  const theme = useTheme();
  const status = STATUS_LABELS[batch.status] ?? { label: batch.status, color: 'default' as const };
  const releasedAt = new Date(batch.released_at).toLocaleTimeString();
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

  return (
    <Paper elevation={3} sx={{
      p: 2.5, mb: 2, borderRadius: 2,
      border: '1px solid var(--rule)',
      background: 'var(--surface)',
      boxShadow: theme.palette.mode === 'dark'
        ? '0 4px 16px rgba(0,0,0,0.45)'
        : '0 4px 16px rgba(0,0,0,0.10)',
    }}>

      {/* BATCH HEADER */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography
          variant="body2"
          fontWeight={700}
          sx={{ fontFamily: 'monospace', color: 'var(--ink)' }}
        >
          {batch.pick_batch_id.slice(0, 8).toUpperCase()}
        </Typography>
        <Chip label={status.label} color={status.color} size="small" />
      </Box>

      {/* BATCH STATS */}
      <Box sx={{ display: 'flex', gap: 3, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <PackageCheck size={14} color={theme.palette.text.secondary} />
          <Typography variant="caption" color="text.secondary">
            {batch.total_line_items} lines
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <ScanBarcode size={14} color={theme.palette.text.secondary} />
          <Typography variant="caption" color="text.secondary">
            {batch.units_picked}/{batch.total_units} picked
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Clock size={14} color={theme.palette.text.secondary} />
          <Typography variant="caption" color="text.secondary">
            {releasedAt}
          </Typography>
        </Box>
      </Box>

      {/* MAP TOGGLE */}
      {gridLocations && gridLocations.length > 0 && (
        <Box
          onClick={handleToggleMap}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.75,
            px: 1.25, py: 0.5, mb: 1.5,
            fontSize: 11, fontWeight: 500, color: 'var(--accent)',
            border: '0.5px solid var(--accent)', borderRadius: '6px',
            cursor: 'pointer', width: 'fit-content',
            '&:hover': { opacity: 0.75 },
          }}
        >
          {mapLoading ? <CircularProgress size={11} /> : null}
          {mapOpen ? 'Hide map' : 'Show pick map'}
        </Box>
      )}

      {/* PICK MAP — mini grid with pick path */}
      {mapOpen && gridLocations && (
        <Box sx={{ mb: 2, border: '1px solid var(--rule)', borderRadius: 1, p: 1, bgcolor: 'var(--bg-2)', overflowX: 'auto' }}>
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

      {/* PICK PROGRESS */}
      {batch.status === 'picking' && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">Pick progress</Typography>
            <Typography variant="caption" color="text.secondary">{pickProgress}%</Typography>
          </Box>
          <LinearProgress variant="determinate" value={pickProgress} sx={{ borderRadius: 1, height: 6 }} />
        </Box>
      )}

      {/* PACK PROGRESS */}
      {batch.status === 'packing' && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">Pack progress</Typography>
            <Typography variant="caption" color="text.secondary">{packProgress}%</Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={packProgress}
            color="success"
            sx={{ borderRadius: 1, height: 6 }}
          />
        </Box>
      )}

      {/* ACTIONS */}
      {batch.status === 'pending' && (
        <Button
          variant="contained"
          fullWidth
          size="large"
          sx={{ borderRadius: 2, fontWeight: 700 }}
          onClick={() => onClaim(batch.pick_batch_id)}
        >
          Claim & Start Picking
        </Button>
      )}

      {batch.status === 'picking' && (
        <Button
          variant="outlined"
          fullWidth
          size="large"
          sx={{ borderRadius: 2, fontWeight: 700 }}
          onClick={() => onContinuePick(batch.pick_batch_id)}
        >
          Continue Picking
        </Button>
      )}

      {batch.status === 'pick_complete' && (
        <Button
          variant="contained"
          color="success"
          fullWidth
          size="large"
          sx={{ borderRadius: 2, fontWeight: 700 }}
          onClick={() => onClaimPack(batch.pick_batch_id)}
        >
          Claim & Start Packing
        </Button>
      )}

      {batch.status === 'packing' && (
        <Button
          variant="outlined"
          color="success"
          fullWidth
          size="large"
          sx={{ borderRadius: 2, fontWeight: 700 }}
          onClick={() => onContinuePack(batch.pick_batch_id)}
        >
          Continue Packing
        </Button>
      )}
    </Paper>
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
  const theme = useTheme();
  const label = task.variant_title ?? task.sku ?? task.lasyncro_variant_id.slice(0, 8).toUpperCase();
  const triggerLabel = task.trigger === 'order_cancelled_mid_pick' ? 'Cancelled pick' : 'Inbound receive';

  return (
    <Paper variant="outlined" sx={{ p: 2.5, mb: 2, borderRadius: 2, borderColor: theme.palette.warning.light }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="body2" fontWeight={700}>{label}</Typography>
        <Chip label="Stow pending" size="small" color="warning" />
      </Box>
      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Qty: {task.quantity}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Location: {task.location_code ?? 'Unassigned'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Source: {triggerLabel}
        </Typography>
      </Box>
      {task.status === 'pending' && (
        <Button
          variant="outlined"
          color="warning"
          fullWidth
          size="large"
          sx={{ borderRadius: 2, fontWeight: 700 }}
          onClick={() => onClaim(task.stow_task_id)}
        >
          Claim & Stow
        </Button>
      )}
      {task.status === 'in_progress' && (
        <Button
          variant="contained"
          color="warning"
          fullWidth
          size="large"
          sx={{ borderRadius: 2, fontWeight: 700 }}
          onClick={() => onConfirm(task.stow_task_id)}
        >
          Confirm Stowed
        </Button>
      )}
    </Paper>
  );
});

type ActiveSession =
  | { type: 'pick'; batchId: string; lineItems: LineItem[] }
  | { type: 'pack'; batchId: string; orders: PackOrder[] }
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
  
  onClaimBatch,
  onFetchLineItems,
  onResolveBarcode,
  onConfirmScan,
  onReportException,
  onPickComplete,
  onClaimPack,
  onFetchPackOrders,
  onConfirmPackScan,
  onReportPackException,
  onPrintLabel,
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
  onRaisePackDecision,
  onPollPackDecision
}: WmsModuleFT2Props) {
  // Auto-enter receive session if handed off from Suppliers portal via URL param
  const [activeSession, setActiveSession] = useState<ActiveSession>(
    pendingReceiveSession
      ? { type: 'receive', ...pendingReceiveSession }
      : null
  );

  useEffect(() => {
    if (pendingReceiveSession) {
      setActiveSession({ type: 'receive', ...pendingReceiveSession });
    }
  }, [pendingReceiveSession]);
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
    } catch (err: any) {
      setSessionError(err?.message ?? 'Failed to start pick session.');
    } finally {
      setLoadingSession(false);
    }
  };

  const enterPackSession = async (batchId: string, claim: boolean) => {
    setLoadingSession(true);
    setSessionError(null);
    try {
      if (claim) await onClaimPack(batchId);
      const orders = await onFetchPackOrders(batchId);
      setActiveSession({ type: 'pack', batchId, orders });
    } catch (err: any) {
      setSessionError(err?.message ?? 'Failed to start pack session.');
    } finally {
      setLoadingSession(false);
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
        onPickComplete={() => onPickComplete(activeSession.batchId)}
      />
    );
  }

  // Active pack session
  if (activeSession?.type === 'pack') {
    return (
      <PackSessionPage
        pickBatchId={activeSession.batchId}
        orders={activeSession.orders}
        onComplete={exitSession}
        onResolveBarcode={onResolveBarcode}
        onConfirmPackScan={(params) => onConfirmPackScan(activeSession.batchId, params)}
        onReportException={(params) => onReportPackException(activeSession.batchId, params)}
        onPrintLabel={onPrintLabel}
        onConfirmShipment={(orderId, partial) => onConfirmShipment(activeSession.batchId, orderId, partial)}
        onPackComplete={() => onPackComplete(activeSession.batchId)}
        onRaiseDecision={(params) => onRaisePackDecision(activeSession.batchId, params)}
        onPollDecision={onPollPackDecision}
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
        onConfirmStow={(taskId, qty) => onConfirmStow?.(taskId) ?? Promise.resolve()}
        onReportException={(taskId, params) => onReportStowException?.(taskId, params) ?? Promise.resolve({})}
      />
    );
  }

  return (
    <Box sx={{ p: 2, maxWidth: 600, mx: 'auto' }}>

      {/* PAGE HEADER */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }}>
            Warehouse
          </Typography>
          <WmsConnectionBadge isOnline={isOnline} queuedCount={queuedCount} />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Pick and pack active batches.
        </Typography>
      </Box>

      {/* LOADING */}
      {(isLoading || loadingSession) && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {/* ERROR */}
      {(isError || sessionError) && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {sessionError ?? 'Failed to load warehouse data. Please refresh.'}
        </Alert>
      )}

      {/* EMPTY STATE */}
      {!isLoading && !loadingSession && !isError && batches.length === 0 && (
        <Paper
          variant="outlined"
          sx={{
            textAlign: 'center',
            py: 8,
            borderRadius: 2,
            borderStyle: 'dashed',
          }}
        >
          <ScanBarcode size={40} style={{ opacity: 0.3 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            No active batches. Waiting for release.
          </Typography>
        </Paper>
      )}

      {/* BATCH LIST */}
      {!isLoading && !loadingSession && batches.map((batch) => (
        <BatchCard
          key={batch.pick_batch_id}
          batch={batch}
          onClaim={(id) => void enterPickSession(id, true)}
          onContinuePick={(id) => void enterPickSession(id, false)}
          onClaimPack={(id) => void enterPackSession(id, true)}
          onContinuePack={(id) => void enterPackSession(id, false)}
          gridLocations={gridLocations}
          onFetchLineItems={onFetchLineItems}
        />
      ))}

      {/* STOW TASKS */}
      {!isLoading && !loadingSession && (stowTasks ?? []).length > 0 && (
        <Box sx={{ mt: batches.length > 0 ? 3 : 0 }}>
          <Typography variant="overline" color="warning.main" sx={{ mb: 1.5, display: 'block' }}>
            Stow tasks — {(stowTasks ?? []).length} pending
          </Typography>
          {(stowTasks ?? []).map((task) => (
            <StowTaskCard
              key={task.stow_task_id}
              task={task}
              onClaim={(id) => setActiveSession({ type: 'stow', taskId: id })}
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