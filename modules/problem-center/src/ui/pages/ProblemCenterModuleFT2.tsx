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

export type ProblemTask = {
  problem_task_id: string;
  lasyncro_variant_id: string;
  exception_type: string;
  source: 'pick' | 'pack' | 'stow' | 'receive' | 'returns';
  quantity: number;
  prob_label: string | null;
  problem_bin_location: string | null;
  status: 'open' | 'investigating' | 'resolved' | 'discarded' | 'returned_to_supplier';
  created_at: string;
  variant_title?: string | null;
  sku?: string | null;
};

export type ProblemCenterData = {
  tasks: ProblemTask[];
  total_unresolved: number;
} | null;

export type ProblemCenterModuleFT2Props = {
  data: ProblemCenterData;
  isLoading: boolean;
  isError: boolean;
  onResolve: (taskId: string, action: string, note: string) => Promise<void>;
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

// Maps exception type → sensible default resolution action
const DEFAULT_ACTION: Record<string, string> = {
  item_missing:         'write_off',
  short_pick:           'write_off',
  product_defect:       'discard',
  packaging_defect:     're_stow',
  wrong_item:           'find_replacement',
  order_cancelled:      'write_off',
  stow_failure:         're_stow',
  receive_rejection:    'quarantine',
  repackaging_required: 're_stow',
  return_shortfall:     'write_off',
};

// Resolution options shown in dialog
// forTypes: if set, only shown when exception matches one of those types
const RESOLUTION_OPTIONS: { action: string; label: string; description: string; forTypes?: string[] }[] = [
  {
    action: 're_stow',
    label: 'Re-stow',
    description: 'Item is fine — place it back into the correct bin location.',
    forTypes: ['packaging_defect', 'stow_failure', 'wrong_item', 'repackaging_required'],
  },
  {
    action: 'find_replacement',
    label: 'Find Replacement',
    description: 'Locate same SKU at an alternate bin and fulfil the order from there.',
    forTypes: ['wrong_item', 'item_missing', 'short_pick'],
  },
  {
    action: 'discard',
    label: 'Discard',
    description: 'Item is damaged beyond use. Removes from inventory permanently.',
    forTypes: ['product_defect', 'packaging_defect', 'receive_rejection'],
  },
  {
    action: 'write_off',
    label: 'Write Off',
    description: 'Item is unaccounted for. Records as shrinkage and removes from inventory.',
    forTypes: ['item_missing', 'short_pick', 'order_cancelled', 'return_shortfall'],
  },
  {
    action: 'quarantine',
    label: 'Quarantine',
    description: 'Hold item for further investigation. No inventory change.',
  },
];

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
  const [resolveDialog, setResolveDialog] = useState<{ id: string; exceptionType: string } | null>(null);
  const [resolutionAction, setResolutionAction] = useState('write_off');
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const tasks = data?.tasks ?? [];

  const filtered = tasks.filter((t) => {
    const isResolved = t.status === 'resolved' || t.status === 'discarded' || t.status === 'returned_to_supplier';
    if (!showResolved && isResolved) return false;
    if (stageFilter !== 'all' && t.source !== stageFilter) return false;
    if (typeFilter !== 'all' && t.exception_type !== typeFilter) return false;
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
      await onResolve(resolveDialog.id, resolutionAction, resolutionNote);
      setResolveDialog(null);
      setResolutionNote('');
      setResolutionAction('write_off');
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
            <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 80px 140px 80px 120px 100px 80px 100px', gap: 0, px: 2, py: 1.25, borderBottom: '0.5px solid var(--rule)', bgcolor: 'var(--bg)' }}>
              <ColHeader label="Exception" />
              <ColHeader label="Stage" />
              <ColHeader label="Type" />
              <ColHeader label="Qty" />
              <ColHeader label="Prob Label" />
              <ColHeader label="Bin" />
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
            {paged.map((t, idx) => {
              const typeInfo = EXCEPTION_TYPE_LABELS[t.exception_type] ?? { label: t.exception_type, color: 'default' as const };
              const stageColor = STAGE_COLORS[t.source] ?? 'var(--ink-4)';
              const label = t.variant_title && t.variant_title !== 'Default Title' ? t.variant_title : t.sku ?? t.lasyncro_variant_id.slice(0, 8).toUpperCase();
              const isResolved = t.status === 'resolved' || t.status === 'discarded' || t.status === 'returned_to_supplier';

              return (
                <Box key={t.problem_task_id}>
                  {idx > 0 && <Divider sx={{ borderColor: 'var(--rule)' }} />}
                  <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 80px 140px 80px 120px 100px 80px 100px',
                    gap: 0, px: 2, py: 1.25,
                    alignItems: 'center',
                    opacity: isResolved ? 0.5 : 1,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}>
                    {/* Exception — SKU + product context */}
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{label}</Typography>
                        {isResolved && <CheckCircle size={12} color={theme.palette.success.main} />}
                      </Box>
                      {t.sku && t.sku !== t.variant_title && (
                        <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'monospace' }}>{t.sku}</Typography>
                      )}
                    </Box>
                    {/* Stage */}
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', px: 1, py: 0.25, borderRadius: '4px', bgcolor: `${stageColor}22`, border: `0.5px solid ${stageColor}55`, width: 'fit-content' }}>
                      <Typography sx={{ fontSize: 11, fontWeight: 500, color: stageColor }}>{STAGE_LABELS[t.source] ?? t.source}</Typography>
                    </Box>
                    {/* Type */}
                    <Chip label={typeInfo.label} color={typeInfo.color} size="small" sx={{ width: 'fit-content' }} />
                    {/* Qty */}
                    <Typography sx={{ fontSize: 13, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{t.quantity}</Typography>
                    {/* Prob label */}
                    <Typography sx={{ fontSize: 12, color: 'var(--ink-4)', fontFamily: 'monospace' }}>{t.prob_label ?? '—'}</Typography>
                    {/* Bin */}
                    <Typography sx={{ fontSize: 12, color: 'var(--ink-4)', fontFamily: 'monospace' }}>{t.problem_bin_location ?? '—'}</Typography>
                    {/* Age */}
                    <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>{fmtAge(t.created_at)}</Typography>
                    {/* Action */}
                    {isResolved ? (
                      <Typography sx={{ fontSize: 11, color: theme.palette.success.main, fontWeight: 500 }}>Resolved</Typography>
                    ) : (
                      <Box
                        onClick={() => { setResolveDialog({ id: t.problem_task_id, exceptionType: t.exception_type }); setResolutionNote(''); setResolutionAction(DEFAULT_ACTION[t.exception_type] ?? 'write_off'); setResolveError(null); }}
                        sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 12, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.88 } }}
                      >
                        Resolve →
                      </Box>
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
      <Dialog open={!!resolveDialog} onClose={() => setResolveDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontSize: 16, fontWeight: 500 }}>Resolve Exception</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>

          {/* Action selector */}
          <Box>
            <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-4)', mb: 1 }}>RESOLUTION ACTION</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {RESOLUTION_OPTIONS.filter(o =>
                !o.forTypes || o.forTypes.includes(resolveDialog?.exceptionType ?? '')
              ).map((opt) => (
                <Box
                  key={opt.action}
                  onClick={() => setResolutionAction(opt.action)}
                  sx={{
                    display: 'flex', flexDirection: 'column', px: 1.5, py: 1,
                    borderRadius: '6px', cursor: 'pointer',
                    border: resolutionAction === opt.action
                      ? '0.5px solid var(--accent)'
                      : '0.5px solid var(--rule)',
                    bgcolor: resolutionAction === opt.action
                      ? 'var(--accent-subtle, rgba(99,102,241,0.06))'
                      : 'transparent',
                    transition: 'border-color 0.15s, background-color 0.15s',
                  }}
                >
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: resolutionAction === opt.action ? 'var(--accent)' : 'var(--ink)' }}>
                    {opt.label}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>{opt.description}</Typography>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Optional note */}
          <TextField
            label="Note (optional)" multiline rows={2} fullWidth size="small"
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
            placeholder="e.g. Moved to problem bin A-3, awaiting supplier collection"
            InputProps={{ sx: { fontSize: 13 } }}
          />

          {resolveError && <Alert severity="error">{resolveError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResolveDialog(null)} sx={{ fontSize: 13 }}>Cancel</Button>
          <Button variant="contained" onClick={() => void handleResolve()} disabled={resolving} sx={{ fontSize: 13 }}>
            {resolving ? 'Resolving…' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}

export default function ProblemCenterModuleFT2(props: ProblemCenterModuleFT2Props) {
  return <ModuleErrorBoundary moduleName="problem-center"><ProblemCenterModuleFT2Inner {...props} /></ModuleErrorBoundary>;
}