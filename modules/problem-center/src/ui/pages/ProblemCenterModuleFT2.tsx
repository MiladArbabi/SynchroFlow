// modules/problem-center/src/ui/pages/ProblemCenterModuleFT2.tsx
import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Chip,
  Button,
  Alert,
  Divider,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  useTheme,
} from '@mui/material';
import {
  PackageX,
  CheckCircle,
  Filter,
} from 'lucide-react';
import { ModuleErrorBoundary, ModuleLoadingSkeleton } from '@lasyncro/shared/ui';


/**
 * Problem Center MODULE — FT2 SURFACE
 * ------------------------------
 * Supervisor surface for reviewing and resolving pick/pack exceptions.
 *
 * Data sources:
 * - pick_exceptions (item_missing, short_pick, product_defect,
 *   packaging_defect, order_cancelled, wrong_item)
 *
 * Actions:
 * - Filter by exception_type, stage, resolved status
 * - Resolve exception with a resolution note
 * - View batch + variant context
 *
 * Theme-aware: Paper, theme.palette tokens, no hardcoded colors.
 * API calls injected via props — module decoupled from frontend HTTP layer.
 */

export type PickException = {
  pick_exception_id: string;
  pick_batch_id: string;
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  exception_type: string;
  stage: 'pick' | 'pack';
  quantity_required: number;
  quantity_found: number;
  raised_by: number;
  raised_at: string;
  resolved: boolean;
  resolved_by: number | null;
  resolved_at: string | null;
  resolution_note: string | null;
  // joined fields
  variant_title?: string;
  sku?: string | null;
  batch_short_id?: string;
};

export type ProblemCenterData = {
  exceptions: PickException[];
  total_unresolved: number;
} | null;

export type ProblemCenterModuleFT2Props = {
  data: ProblemCenterData;
  isLoading: boolean;
  isError: boolean;
  onResolve: (exceptionId: string, note: string) => Promise<void>;
  onRefresh: () => void;
};

const EXCEPTION_TYPE_LABELS: Record<string, { label: string; color: 'error' | 'warning' | 'default' }> = {
  item_missing:      { label: 'Item Missing',       color: 'error'   },
  short_pick:        { label: 'Short Pick',          color: 'warning' },
  product_defect:    { label: 'Product Defect',      color: 'error'   },
  packaging_defect:  { label: 'Packaging Defect',    color: 'warning' },
  order_cancelled:   { label: 'Order Cancelled',     color: 'default' },
  wrong_item:        { label: 'Wrong Item',          color: 'error'   },
};

const STAGE_LABELS: Record<string, string> = {
  pick: 'Pick',
  pack: 'Pack',
};

function ExceptionCard({
  exception,
  onResolve,
}: {
  exception: PickException;
  onResolve: (id: string) => void;
}) {
  const theme = useTheme();
  const typeInfo = EXCEPTION_TYPE_LABELS[exception.exception_type] ??
    { label: exception.exception_type, color: 'default' as const };
  const raisedAt = new Date(exception.raised_at).toLocaleString();

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        mb: 2,
        borderRadius: 2,
        borderColor: exception.resolved
          ? theme.palette.divider
          : theme.palette.warning.main,
        opacity: exception.resolved ? 0.6 : 1,
      }}
    >
      {/* HEADER */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Chip
            label={typeInfo.label}
            color={typeInfo.color}
            size="small"
          />
          <Chip
            label={STAGE_LABELS[exception.stage] ?? exception.stage}
            size="small"
            variant="outlined"
          />
        </Box>
        {exception.resolved && (
          <CheckCircle size={18} color={theme.palette.success.main} />
        )}
      </Box>

      {/* VARIANT INFO */}
      <Typography variant="body2" fontWeight={600} noWrap sx={{ mb: 0.5 }}>
        {exception.variant_title ?? exception.lasyncro_variant_id.slice(0, 8)}
      </Typography>
      {exception.sku && (
        <Typography variant="caption" color="text.secondary">
          SKU: {exception.sku}
        </Typography>
      )}

      <Divider sx={{ my: 1.5 }} />

      {/* QUANTITY CONTEXT */}
      <Box sx={{ display: 'flex', gap: 3, mb: 1.5 }}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
            Required
          </Typography>
          <Typography variant="body2" fontWeight={700}>
            {exception.quantity_required}
          </Typography>
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
            Found
          </Typography>
          <Typography
            variant="body2"
            fontWeight={700}
            sx={{
              color: exception.quantity_found < exception.quantity_required
                ? theme.palette.error.main
                : theme.palette.success.main,
            }}
          >
            {exception.quantity_found}
          </Typography>
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
            Batch
          </Typography>
          <Typography variant="body2" fontWeight={700} sx={{ fontFamily: 'monospace' }}>
            {exception.batch_short_id ?? exception.pick_batch_id.slice(0, 8).toUpperCase()}
          </Typography>
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
            Raised
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {raisedAt}
          </Typography>
        </Box>
      </Box>

      {/* RESOLUTION NOTE */}
      {exception.resolved && exception.resolution_note && (
        <Alert severity="success" sx={{ mb: 1.5, py: 0.5 }}>
          {exception.resolution_note}
        </Alert>
      )}

      {/* RESOLVE ACTION */}
      {!exception.resolved && (
        <Button
          variant="outlined"
          size="small"
          fullWidth
          onClick={() => onResolve(exception.pick_exception_id)}
          sx={{ borderRadius: 2 }}
        >
          Mark Resolved
        </Button>
      )}
    </Paper>
  );
}

function ProblemCenterModuleFT2Inner({
  data,
  isLoading,
  isError,
  onResolve,
  onRefresh,
}: ProblemCenterModuleFT2Props) {
  const [stageFilter, setStageFilter] = useState<'all' | 'pick' | 'pack'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showResolved, setShowResolved] = useState(false);
  const [resolveDialog, setResolveDialog] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const exceptions = data?.exceptions ?? [];

  const filtered = exceptions.filter((e) => {
    if (!showResolved && e.resolved) return false;
    if (stageFilter !== 'all' && e.stage !== stageFilter) return false;
    if (typeFilter !== 'all' && e.exception_type !== typeFilter) return false;
    return true;
  });

  const handleResolve = async () => {
    if (!resolveDialog) return;
    setResolving(true);
    setResolveError(null);
    try {
      await onResolve(resolveDialog, resolutionNote);
      setResolveDialog(null);
      setResolutionNote('');
      onRefresh();
    } catch {
      setResolveError('Failed to resolve exception. Try again.');
    } finally {
      setResolving(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>

      {/* HEADER */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Typography variant="h5" fontWeight={700}>Problem Center</Typography>
          {(data?.total_unresolved ?? 0) > 0 && (
            <Chip
              label={data?.total_unresolved}
              color="error"
              size="small"
            />
          )}
        </Box>
        <Typography variant="body2" color="text.secondary">
          Pick and pack exceptions requiring supervisor resolution.
        </Typography>
      </Box>

      {/* LOADING */}
      {isLoading && <ModuleLoadingSkeleton />}

      {/* ERROR */}
      {isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load Problem Center. Please refresh.
        </Alert>
      )}

      {!isLoading && !isError && (
        <>
          {/* FILTERS */}
          <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <Filter size={14} />
              <Typography variant="caption" color="text.secondary">Filters</Typography>
            </Box>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
              {(['all', 'pick', 'pack'] as const).map((s) => (
                <Chip
                  key={s}
                  label={s === 'all' ? 'All stages' : STAGE_LABELS[s]}
                  size="small"
                  variant={stageFilter === s ? 'filled' : 'outlined'}
                  onClick={() => setStageFilter(s)}
                  color={stageFilter === s ? 'primary' : 'default'}
                />
              ))}
            </Box>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
              <Chip
                label="All types"
                size="small"
                variant={typeFilter === 'all' ? 'filled' : 'outlined'}
                onClick={() => setTypeFilter('all')}
                color={typeFilter === 'all' ? 'primary' : 'default'}
              />
              {Object.entries(EXCEPTION_TYPE_LABELS).map(([key, { label }]) => (
                <Chip
                  key={key}
                  label={label}
                  size="small"
                  variant={typeFilter === key ? 'filled' : 'outlined'}
                  onClick={() => setTypeFilter(key)}
                  color={typeFilter === key ? 'primary' : 'default'}
                />
              ))}
            </Box>

            <Chip
              label={showResolved ? 'Hiding resolved' : 'Show resolved'}
              size="small"
              variant={showResolved ? 'filled' : 'outlined'}
              onClick={() => setShowResolved((v) => !v)}
            />
          </Paper>

          {/* EMPTY STATE */}
          {filtered.length === 0 && (
            <Paper
              variant="outlined"
              sx={{
                textAlign: 'center',
                py: 8,
                borderRadius: 2,
                borderStyle: 'dashed',
              }}
            >
              <PackageX size={40} style={{ opacity: 0.3 }} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                No exceptions match the current filters.
              </Typography>
            </Paper>
          )}

          {/* EXCEPTION LIST */}
          {filtered.map((exception) => (
            <ExceptionCard
              key={exception.pick_exception_id}
              exception={exception}
              onResolve={(id) => {
                setResolveDialog(id);
                setResolutionNote('');
                setResolveError(null);
              }}
            />
          ))}
        </>
      )}

      {/* RESOLVE DIALOG */}
      <Dialog
        open={!!resolveDialog}
        onClose={() => setResolveDialog(null)}
        fullWidth
      >
        <DialogTitle>Resolve Exception</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Add a note describing the corrective action taken.
          </Typography>
          <TextField
            label="Resolution note"
            multiline
            rows={3}
            fullWidth
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
            placeholder="e.g. Restocked from back warehouse, item located and picked"
          />
          {resolveError && (
            <Alert severity="error" sx={{ mt: 2 }}>{resolveError}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResolveDialog(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void handleResolve()}
            disabled={resolving || !resolutionNote.trim()}
          >
            {resolving ? 'Resolving...' : 'Confirm Resolution'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default function ProblemCenterModuleFT2(props: ProblemCenterModuleFT2Props) {
  return <ModuleErrorBoundary moduleName="problem-center"><ProblemCenterModuleFT2Inner {...props} /></ModuleErrorBoundary>;
}