// modules/wms/src/ui/pages/WmsModuleFT2.tsx
import { useState } from 'react';
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

export type WmsModuleFT2Props = {
  data: WmsData;
  isLoading: boolean;
  isError: boolean;

  onCreateReceiveJob?: (poId: string) => Promise<{ receive_job_id: string }>;
  onFetchReceiveJob?: (jobId: string) => Promise<{ job: { po_id: string; supplier_name: string }; lines: ReceiveJobLine[] }>;
  onInspectReceiveLine?: (jobId: string, params: { lasyncro_variant_id: string; quantity_accepted: number; quantity_rejected: number }) => Promise<void>;
  onReportReceiveException?: (jobId: string, params: { lasyncro_variant_id: string; receive_job_line_id: string; exception_type: string; quantity_affected: number; notes?: string }) => Promise<void>;
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
  onRefresh: () => void;
  isOnline: boolean;
  queuedCount: number;
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

function BatchCard({
  batch,
  onClaim,
  onContinuePick,
  onClaimPack,
  onContinuePack,
}: {
  batch: WmsBatch;
  onClaim: (batchId: string) => void;
  onContinuePick: (batchId: string) => void;
  onClaimPack: (batchId: string) => void;
  onContinuePack: (batchId: string) => void;
}) {
  const theme = useTheme();
  const status = STATUS_LABELS[batch.status] ?? { label: batch.status, color: 'default' as const };
  const releasedAt = new Date(batch.released_at).toLocaleTimeString();

  const pickProgress = batch.total_units > 0
    ? Math.round((batch.units_picked / batch.total_units) * 100)
    : 0;

  const packProgress = batch.total_units > 0
    ? Math.round((batch.units_packed / batch.total_units) * 100)
    : 0;

  return (
    <Paper variant="outlined" sx={{ p: 2.5, mb: 2, borderRadius: 2 }}>

      {/* BATCH HEADER */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography
          variant="body2"
          fontWeight={700}
          sx={{ fontFamily: 'monospace', color: theme.palette.text.primary }}
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
}

type ActiveSession =
  | { type: 'pick'; batchId: string; lineItems: LineItem[] }
  | { type: 'pack'; batchId: string; orders: PackOrder[] }
  | { type: 'receive'; receiveJobId: string; poId: string; supplierName: string; lines: ReceiveJobLine[] }
  | null;

export default function WmsModuleFT2({
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
  isOnline,
  queuedCount,
}: WmsModuleFT2Props) {
  const [activeSession, setActiveSession] = useState<ActiveSession>(null);
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
      />
    );
  }

  return (
    <Box sx={{ p: 2, maxWidth: 600, mx: 'auto' }}>

      {/* PAGE HEADER */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h5" fontWeight={700}>Warehouse</Typography>
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
        />
      ))}
    </Box>
  );
}