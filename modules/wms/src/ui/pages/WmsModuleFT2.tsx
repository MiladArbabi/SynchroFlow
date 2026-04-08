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
import PickSessionPage, {
  type LineItem,
  type ConfirmScanParams,
  type ReportExceptionParams,
} from './PickSessionPage.js';

/**
 * WMS MODULE — FT2 SURFACE
 * -------------------------
 * Mobile-optimized pick/pack operator interface.
 *
 * Zones:
 * - Active batch (if claimed) → scan surface via PickSessionPage
 * - Available batches → claim button
 * - Empty state → no batches released
 *
 * All API callbacks injected via props — module stays decoupled
 * from apps/frontend HTTP layer.
 *
 * Theme-aware: uses Paper, theme.palette tokens, no hardcoded colors.
 */

export type WmsBatch = {
  pick_batch_id: string;
  status: string;
  total_line_items: number;
  total_units: number;
  units_picked: number;
  picked_by: number | null;
  released_at: string;
};

export type WmsData = {
  batches: WmsBatch[];
} | null;

export type WmsModuleFT2Props = {
  data: WmsData;
  isLoading: boolean;
  isError: boolean;
  onClaimBatch: (batchId: string) => Promise<void>;
  onFetchLineItems: (batchId: string) => Promise<LineItem[]>;
  onResolveBarcode: (scannedValue: string) => Promise<{ lasyncro_variant_id: string } | null>;
  onConfirmScan: (batchId: string, params: ConfirmScanParams) => Promise<void>;
  onReportException: (batchId: string, params: ReportExceptionParams) => Promise<void>;
  onPickComplete: (batchId: string) => Promise<void>;
  onRefresh: () => void;
};

const STATUS_LABELS: Record<string, {
  label: string;
  color: 'default' | 'primary' | 'success' | 'warning' | 'error';
}> = {
  pending:       { label: 'Available',   color: 'primary' },
  picking:       { label: 'In Progress', color: 'warning' },
  pick_complete: { label: 'Pick Done',   color: 'success' },
  packing:       { label: 'Packing',     color: 'warning' },
  pack_complete: { label: 'Complete',    color: 'success' },
  cancelled:     { label: 'Cancelled',   color: 'error'   },
};

function BatchCard({
  batch,
  onClaim,
  onContinue,
}: {
  batch: WmsBatch;
  onClaim: (batchId: string) => void;
  onContinue: (batchId: string) => void;
}) {
  const theme = useTheme();
  const status = STATUS_LABELS[batch.status] ?? { label: batch.status, color: 'default' as const };
  const releasedAt = new Date(batch.released_at).toLocaleTimeString();
  const pickProgress = batch.total_units > 0
    ? Math.round((batch.units_picked / batch.total_units) * 100)
    : 0;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        mb: 2,
        borderRadius: 2,
      }}
    >
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
            {batch.units_picked}/{batch.total_units} units
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
            <Typography variant="caption" color="text.secondary">
              Pick progress
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {pickProgress}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={pickProgress}
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
          onClick={() => onContinue(batch.pick_batch_id)}
        >
          Continue Picking
        </Button>
      )}
    </Paper>
  );
}

export default function WmsModuleFT2({
  data,
  isLoading,
  isError,
  onClaimBatch,
  onFetchLineItems,
  onResolveBarcode,
  onConfirmScan,
  onReportException,
  onPickComplete,
  onRefresh,
}: WmsModuleFT2Props) {
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const batches = data?.batches ?? [];

  const enterPickSession = async (batchId: string, claim: boolean) => {
    setLoadingSession(true);
    setSessionError(null);
    try {
      if (claim) await onClaimBatch(batchId);
      const items = await onFetchLineItems(batchId);
      setLineItems(items);
      setActiveBatchId(batchId);
    } catch (err: any) {
      setSessionError(err?.message ?? 'Failed to start pick session.');
    } finally {
      setLoadingSession(false);
    }
  };

  // Active pick session view
  if (activeBatchId && lineItems.length > 0) {
    return (
      <PickSessionPage
        pickBatchId={activeBatchId}
        lineItems={lineItems}
        onComplete={() => {
          setActiveBatchId(null);
          setLineItems([]);
          onRefresh();
        }}
        onResolveBarcode={onResolveBarcode}
        onConfirmScan={(params) => onConfirmScan(activeBatchId, params)}
        onReportException={(params) => onReportException(activeBatchId, params)}
        onPickComplete={() => onPickComplete(activeBatchId)}
      />
    );
  }

  return (
    <Box sx={{ p: 2, maxWidth: 600, mx: 'auto' }}>

      {/* PAGE HEADER */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>Warehouse</Typography>
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
          onContinue={(id) => void enterPickSession(id, false)}
        />
      ))}
    </Box>
  );
}