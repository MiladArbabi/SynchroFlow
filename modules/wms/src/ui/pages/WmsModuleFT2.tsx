// modules/wms/src/ui/pages/WmsModuleFT2.tsx
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Button,
  Chip,
  useTheme,
} from '@mui/material';
import { ScanBarcode, PackageCheck, Clock } from 'lucide-react';

/**
 * WMS MODULE — FT2 SURFACE
 * -------------------------
 * Mobile-optimized pick/pack operator interface.
 *
 * Zones:
 * - Active batch (if claimed) → scan surface
 * - Available batches → claim button
 * - Empty state → no batches released
 *
 * Designed for single-hand mobile use:
 * - Large tap targets
 * - Minimal text
 * - Clear status signals
 */

export type WmsBatch = {
  pick_batch_id: string;
  status: string;
  total_line_items: number;
  total_units: number;
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
};

const STATUS_LABELS: Record<string, { label: string; color: 'default' | 'primary' | 'success' | 'warning' | 'error' }> = {
  pending: { label: 'Available', color: 'primary' },
  picking: { label: 'In Progress', color: 'warning' },
  pick_complete: { label: 'Pick Done', color: 'success' },
  packing: { label: 'Packing', color: 'warning' },
  pack_complete: { label: 'Complete', color: 'success' },
  cancelled: { label: 'Cancelled', color: 'error' },
};

function BatchCard({ batch }: { batch: WmsBatch }) {
  const theme = useTheme();
  const status = STATUS_LABELS[batch.status] ?? { label: batch.status, color: 'default' };
  const releasedAt = new Date(batch.released_at).toLocaleTimeString();

  return (
    <Box
      sx={{
        p: 2.5,
        mb: 2,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="body2" fontWeight={700} sx={{ fontFamily: 'monospace' }}>
          {batch.pick_batch_id.slice(0, 8).toUpperCase()}
        </Typography>
        <Chip
          label={status.label}
          color={status.color}
          size="small"
        />
      </Box>

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
            {batch.total_units} units
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Clock size={14} color={theme.palette.text.secondary} />
          <Typography variant="caption" color="text.secondary">
            {releasedAt}
          </Typography>
        </Box>
      </Box>

      {batch.status === 'pending' && (
        <Button
          variant="contained"
          fullWidth
          size="large"
          sx={{ borderRadius: 2, fontWeight: 700 }}
        >
          Claim & Start Picking
        </Button>
      )}

      {batch.status === 'picking' && batch.picked_by !== null && (
        <Button
          variant="outlined"
          fullWidth
          size="large"
          sx={{ borderRadius: 2, fontWeight: 700 }}
        >
          Continue Picking
        </Button>
      )}
    </Box>
  );
}

export default function WmsModuleFT2({ data, isLoading, isError }: WmsModuleFT2Props) {
  const batches = data?.batches ?? [];

  return (
    <Box sx={{ p: 2, maxWidth: 600, mx: 'auto' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>Warehouse</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Pick and pack active batches.
        </Typography>
      </Box>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load warehouse data. Please refresh.
        </Alert>
      )}

      {!isLoading && !isError && batches.length === 0 && (
        <Box sx={{ textAlign: 'center', pt: 6 }}>
          <ScanBarcode size={40} style={{ opacity: 0.3 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            No active batches. Waiting for release.
          </Typography>
        </Box>
      )}

      {!isLoading && !isError && batches.map((batch) => (
        <BatchCard key={batch.pick_batch_id} batch={batch} />
      ))}
    </Box>
  );
}