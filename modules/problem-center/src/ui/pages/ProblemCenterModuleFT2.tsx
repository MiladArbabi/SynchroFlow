// modules/problem-center/src/ui/pages/ProblemCenterModuleFT2.tsx
//
// PROBLEM CENTER — FT2 OPERATOR SURFACE
// Supervisor surface for pick/pack/stow/receive exceptions.
//
// DESIGN CONTRACT:
// - Table layout matching Returns — same mental model, different domain
// - FT2 pattern: CSS vars, 0.5px borders, fontWeight max 500
// - Pagination: 10 rows per page
// - Resolve dialog — inline action, same as before
// - No hardcoded hex, no Paper/outlined, no fontWeight 700
import { useState } from 'react';
import {
  Box, Typography, Chip, Button, Alert,
  TextField, Dialog, DialogTitle, DialogContent,
  DialogActions, Divider, useTheme,
} from '@mui/material';
import { PackageX, Filter, CheckCircle } from 'lucide-react';
import { ModuleErrorBoundary, ModuleLoadingSkeleton } from '@lasyncro/shared/ui';

export type PickException = {
  pick_exception_id: string;
  pick_batch_id: string;
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  exception_type: string;
  stage: 'pick' | 'pack' | 'stow' | 'receive';
  quantity_required: number;
  quantity_found: number;
  raised_by: number;
  raised_at: string;
  resolved: boolean;
  resolved_by: number | null;
  resolved_at: string | null;
  resolution_note: string | null;
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
  stow_failure:      { label: 'Stow Failure',        color: 'warning' },
  receive_rejection: { label: 'Receive Rejection',   color: 'warning' },
};

const STAGE_LABELS: Record<string, string> = {
  pick: 'Pick', pack: 'Pack', stow: 'Stow', receive: 'Receive',
};

const STAGE_COLORS: Record<string, string> = {
  pick:    '#14B8A6',
  pack:    '#3B82F6',
  stow:    '#8B5CF6',
  receive: '#F59E0B',
};

const PER_PAGE = 10;

// ── Age formatter ─────────────────────────────────────────────
const fmtAge = (iso: string): string => {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return '<1h ago';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

function ProblemCenterModuleFT2Inner({
  data, isLoading, isError, onResolve, onRefresh,
}: ProblemCenterModuleFT2Props) {
  const theme = useTheme();
  const [stageFilter, setStageFilter] = useState<'all' | 'pick' | 'pack' | 'stow' | 'receive'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showResolved, setShowResolved] = useState(false);
  const [page, setPage] = useState(1);
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

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const handleFilterChange = (fn: () => void) => { fn(); setPage(1); };

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

  // Column header component
  const ColHeader = ({ label }: { label: string }) => (
    <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
      {label}
    </Typography>
  );

  return (
    <Box sx={{ p: '24px 40px', bgcolor: 'var(--bg)', minHeight: '100%' }}>

      {/* ── HEADER ───────────────────────────────────────────── */}
      <Box sx={{ mb: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.25 }}>
          <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)' }}>
            Problem Center
          </Typography>
          {(data?.total_unresolved ?? 0) > 0 && (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', px: 1.5, py: 0.375, borderRadius: '20px', bgcolor: theme.palette.mode === 'dark' ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)', border: `0.5px solid rgba(239,68,68,0.35)` }}>
              <Typography sx={{ fontSize: 11, fontWeight: 500, color: theme.palette.error.main }}>{data?.total_unresolved} unresolved</Typography>
            </Box>
          )}
        </Box>
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
          Pick, pack, stow, and receive exceptions requiring supervisor resolution.
        </Typography>
      </Box>

      {isLoading && <ModuleLoadingSkeleton />}
      {isError && <Alert severity="error" sx={{ mb: 3 }}>Failed to load Problem Center. Please refresh.</Alert>}

      {!isLoading && !isError && (
        <>
          {/* ── FILTERS ────────────────────────────────────────── */}
          <Box sx={{ bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <Filter size={12} color="var(--ink-4)" />
              <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Filters</Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
              {(['all', 'pick', 'pack', 'stow', 'receive'] as const).map((s) => (
                <Chip key={s} label={s === 'all' ? 'All stages' : STAGE_LABELS[s]} size="small"
                  variant={stageFilter === s ? 'filled' : 'outlined'}
                  onClick={() => handleFilterChange(() => setStageFilter(s))}
                  color={stageFilter === s ? 'primary' : 'default'}
                />
              ))}
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
              <Chip label="All types" size="small" variant={typeFilter === 'all' ? 'filled' : 'outlined'}
                onClick={() => handleFilterChange(() => setTypeFilter('all'))}
                color={typeFilter === 'all' ? 'primary' : 'default'}
              />
              {Object.entries(EXCEPTION_TYPE_LABELS).map(([key, { label }]) => (
                <Chip key={key} label={label} size="small"
                  variant={typeFilter === key ? 'filled' : 'outlined'}
                  onClick={() => handleFilterChange(() => setTypeFilter(key))}
                  color={typeFilter === key ? 'primary' : 'default'}
                />
              ))}
            </Box>
            <Chip label={showResolved ? 'Hiding resolved' : 'Show resolved'} size="small"
              variant={showResolved ? 'filled' : 'outlined'}
              onClick={() => handleFilterChange(() => setShowResolved(v => !v))}
            />
          </Box>

          {/* ── TABLE ──────────────────────────────────────────── */}
          <Box sx={{ bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', overflow: 'hidden' }}>

            {/* Column headers */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 80px 140px 80px 80px 100px 80px 100px', gap: 0, px: 2, py: 1.25, borderBottom: '0.5px solid var(--rule)', bgcolor: 'var(--bg)' }}>
              <ColHeader label="Exception" />
              <ColHeader label="Stage" />
              <ColHeader label="Type" />
              <ColHeader label="Req" />
              <ColHeader label="Found" />
              <ColHeader label="Batch" />
              <ColHeader label="Age" />
              <ColHeader label="Action" />
            </Box>

            {/* Empty state */}
            {filtered.length === 0 && (
              <Box sx={{ textAlign: 'center', py: 8 }}>
                <PackageX size={36} style={{ opacity: 0.25, margin: '0 auto' }} />
                <Typography sx={{ fontSize: 13, color: 'var(--ink-4)', mt: 2 }}>
                  No exceptions match the current filters.
                </Typography>
              </Box>
            )}

            {/* Rows */}
            {paged.map((e, idx) => {
              const typeInfo = EXCEPTION_TYPE_LABELS[e.exception_type] ?? { label: e.exception_type, color: 'default' as const };
              const stageColor = STAGE_COLORS[e.stage] ?? 'var(--ink-4)';
              const label = e.variant_title && e.variant_title !== 'Default Title' ? e.variant_title : e.sku ?? e.lasyncro_variant_id.slice(0, 8).toUpperCase();
              const batchRef = e.batch_short_id ?? e.pick_batch_id.slice(0, 8).toUpperCase();

              return (
                <Box key={e.pick_exception_id}>
                  {idx > 0 && <Divider sx={{ borderColor: 'var(--rule)' }} />}
                  <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 80px 140px 80px 80px 100px 80px 100px',
                    gap: 0, px: 2, py: 1.25,
                    alignItems: 'center',
                    opacity: e.resolved ? 0.5 : 1,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}>
                    {/* Exception — SKU + product context */}
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{label}</Typography>
                        {e.resolved && <CheckCircle size={12} color={theme.palette.success.main} />}
                      </Box>
                      {e.sku && e.sku !== e.variant_title && (
                        <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'monospace' }}>{e.sku}</Typography>
                      )}
                    </Box>
                    {/* Stage */}
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', px: 1, py: 0.25, borderRadius: '4px', bgcolor: `${stageColor}22`, border: `0.5px solid ${stageColor}55`, width: 'fit-content' }}>
                      <Typography sx={{ fontSize: 11, fontWeight: 500, color: stageColor }}>{STAGE_LABELS[e.stage] ?? e.stage}</Typography>
                    </Box>
                    {/* Type */}
                    <Chip label={typeInfo.label} color={typeInfo.color} size="small" sx={{ width: 'fit-content' }} />
                    {/* Qty required */}
                    <Typography sx={{ fontSize: 13, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{e.quantity_required}</Typography>
                    {/* Qty found */}
                    <Typography sx={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: e.quantity_found < e.quantity_required ? theme.palette.error.main : theme.palette.success.main }}>
                      {e.quantity_found}
                    </Typography>
                    {/* Batch */}
                    <Typography sx={{ fontSize: 12, color: 'var(--ink-4)', fontFamily: 'monospace' }}>{batchRef}</Typography>
                    {/* Age */}
                    <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>{fmtAge(e.raised_at)}</Typography>
                    {/* Action */}
                    {e.resolved ? (
                      <Typography sx={{ fontSize: 11, color: theme.palette.success.main, fontWeight: 500 }}>Resolved</Typography>
                    ) : (
                      <Typography
                        onClick={() => { setResolveDialog(e.pick_exception_id); setResolutionNote(''); setResolveError(null); }}
                        sx={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                      >
                        Resolve →
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            })}

            {/* Pagination footer */}
            {filtered.length > PER_PAGE && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, bgcolor: 'var(--bg)', borderTop: '0.5px solid var(--rule)' }}>
                <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                  {((page - 1) * PER_PAGE) + 1}–{Math.min(page * PER_PAGE, filtered.length)} of {filtered.length} exceptions
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box onClick={() => page > 1 && setPage(p => p - 1)} sx={{ px: 1.5, py: 0.5, borderRadius: '6px', cursor: page > 1 ? 'pointer' : 'not-allowed', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12, color: page > 1 ? 'var(--ink-3)' : 'var(--ink-4)', opacity: page > 1 ? 1 : 0.4 }}>← Prev</Box>
                  <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 60, textAlign: 'center' }}>Page {page} of {totalPages}</Typography>
                  <Box onClick={() => page < totalPages && setPage(p => p + 1)} sx={{ px: 1.5, py: 0.5, borderRadius: '6px', cursor: page < totalPages ? 'pointer' : 'not-allowed', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12, color: page < totalPages ? 'var(--ink-3)' : 'var(--ink-4)', opacity: page < totalPages ? 1 : 0.4 }}>Next →</Box>
                </Box>
              </Box>
            )}
          </Box>
        </>
      )}

      {/* ── RESOLVE DIALOG ───────────────────────────────────── */}
      <Dialog open={!!resolveDialog} onClose={() => setResolveDialog(null)} fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 500 }}>Resolve Exception</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'var(--ink-4)', mb: 2 }}>
            Add a note describing the corrective action taken.
          </Typography>
          <TextField
            label="Resolution note" multiline rows={3} fullWidth
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
            placeholder="e.g. Restocked from back warehouse, item located and picked"
          />
          {resolveError && <Alert severity="error" sx={{ mt: 2 }}>{resolveError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResolveDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={() => void handleResolve()}
            disabled={resolving || !resolutionNote.trim()}>
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