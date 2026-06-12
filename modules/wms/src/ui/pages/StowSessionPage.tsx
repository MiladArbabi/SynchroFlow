// modules/wms/src/ui/pages/StowSessionPage.tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Box, Paper, Typography, Button, Alert, Chip, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, useTheme, CircularProgress, IconButton,
  LinearProgress, alpha,
} from '@mui/material';
import { CheckCircle, MapPin, Package, ArrowLeft, RotateCcw, Hash } from 'lucide-react';
import type { WmsStowTask } from './WmsModuleFT2.js';

/**
 * STOW SESSION PAGE — WEB-STOW-UNIT-01
 * --------------------------------------
 * Option B flow — item-first, system-guided location:
 *
 *   brief → item_scan → location_scan → qty_confirm → summary → complete
 *
 * Node 1 (item_scan): Operator scans LSU- barcode. Resolver confirms variant
 *   match. Product image + details shown for visual confirmation.
 *
 * Node 2 (location_scan): System shows suggested bin from stow task.
 *   Operator walks there and scans bin barcode to confirm. Claim fires here.
 *
 * Node 3 (qty_confirm): Operator confirms quantity placed. Shortfall triggers
 *   exception dialog before summary.
 *
 * Bulk stow: scanning one LSU- and confirming qty=N updates all N matching
 * received units (same variant + job line) to stowed in one backend pass.
 *
 * Legacy path: if no LSU- available, legacy EAN/UPC resolves via
 * legacy_barcode_fallback_enabled. lasyncroUnitId will be undefined —
 * backend handles gracefully.
 */

export type StowExceptionResult = {
  prob_label?: string;
  problem_bin?: string;
};

export type BarcodeResolveResult = {
  lasyncro_variant_id: string;
  lasyncro_unit_id?: string;
  unit_status?: string;
};

export interface StowSessionPageProps {
  initialTaskId: string;
  onComplete: () => void;
  onFetchTasks: () => Promise<WmsStowTask[]>;
  onResolveLocation: (scannedValue: string) => Promise<{ location_code: string } | null>;
  onAssignLocation: (taskId: string, locationCode: string) => Promise<void>;
  onClaimTask: (taskId: string) => Promise<void>;
  onResolveBarcode: (scannedValue: string) => Promise<BarcodeResolveResult | null>;
  onConfirmStow: (taskId: string, quantityPlaced: number, lasyncroUnitId?: string) => Promise<void>;
  onReportException: (taskId: string, params: {
    exception_type: string;
    quantity: number;
    notes?: string;
    lasyncro_unit_id?: string;
  }) => Promise<StowExceptionResult>;
}

type Phase = 'brief' | 'item_scan' | 'location_scan' | 'qty_confirm' | 'summary' | 'complete';
type NodeState = 'pending' | 'active' | 'confirmed';

const STOW_EXCEPTIONS = [
  { type: 'item_missing',     label: 'Item missing' },
  { type: 'product_defect',   label: 'Damaged' },
  { type: 'packaging_defect', label: 'Packaging issue' },
];

// ── Node track (matches pick UI pattern) ─────────────────────────────────────
function NodeTrack({ nodes }: {
  nodes: { label: string; sublabel?: string; state: NodeState; icon: React.ReactNode }[]
}) {
  const theme = useTheme();
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 3 }}>
      {nodes.map((node, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', flex: i < nodes.length - 1 ? 1 : 'none' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 72 }}>
            <Box sx={{
              width: 40, height: 40, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: node.state === 'confirmed'
                ? theme.palette.success.main
                : node.state === 'active'
                  ? 'var(--accent)'
                  : theme.palette.action.disabledBackground,
              color: node.state === 'pending' ? theme.palette.text.disabled : '#fff',
              ...(node.state === 'active' && {
                '@keyframes stowNodePulse': {
                  '0%':   { boxShadow: '0 0 0 0 rgba(255,107,43,0.55)' },
                  '70%':  { boxShadow: '0 0 0 10px rgba(255,107,43,0)' },
                  '100%': { boxShadow: '0 0 0 0 rgba(255,107,43,0)' },
                },
                animation: 'stowNodePulse 1.3s ease-out infinite',
              }),
              transition: 'all 0.2s',
            }}>
              {node.state === 'confirmed' ? <CheckCircle size={18} /> : node.icon}
            </Box>
            <Typography variant="caption" sx={{
              mt: 0.5, fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: node.state === 'pending' ? 'text.disabled'
                : node.state === 'active' ? 'var(--accent)'
                  : 'success.main',
            }}>
              {node.state === 'confirmed' ? '✓ ' : ''}{node.label}
            </Typography>
            {node.sublabel && (
              <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary', textAlign: 'center', maxWidth: 72 }} noWrap>
                {node.sublabel}
              </Typography>
            )}
          </Box>
          {i < nodes.length - 1 && (
            <Box sx={{
              flex: 1, height: 2, mx: 0.5, mb: 3,
              bgcolor: node.state === 'confirmed'
                ? theme.palette.success.main
                : theme.palette.divider,
              transition: 'background-color 0.2s',
            }} />
          )}
        </Box>
      ))}
    </Box>
  );
}

// ── Scan input ────────────────────────────────────────────────────────────────
function ScanInput({ hint, onSubmit, error }: {
  hint: string; onSubmit: (value: string) => void; error?: string | null
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { if (error) setTimeout(() => inputRef.current?.focus(), 50); }, [error]);

  const handleSubmit = () => {
    const val = value.trim();
    if (val) { onSubmit(val); setValue(''); }
  };

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
      <TextField
        inputRef={inputRef} fullWidth size="small"
        placeholder={hint} value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
        helperText="Scanner auto-submits · manual entry: press Enter"
        autoComplete="off"
      />
      {value.trim() && (
        <Button variant="contained" size="small" onClick={handleSubmit}
          sx={{ bgcolor: 'var(--accent)', borderRadius: '6px', fontWeight: 600, mt: '2px', flexShrink: 0 }}>
          Scan
        </Button>
      )}
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function StowSessionPage({
  initialTaskId, onComplete, onFetchTasks, onResolveLocation,
  onAssignLocation, onClaimTask, onResolveBarcode, onConfirmStow, onReportException,
}: StowSessionPageProps) {
  const theme = useTheme();

  const [phase,            setPhase]            = useState<Phase>('brief');
  const [tasks,            setTasks]            = useState<WmsStowTask[]>([]);
  const [currentIndex,     setCurrentIndex]     = useState(0);
  const [loading,          setLoading]          = useState(true);
  const [submitting,       setSubmitting]       = useState(false);
  const [loadError,        setLoadError]        = useState<string | null>(null);
  const [submitError,      setSubmitError]      = useState<string | null>(null);

  const [scannedUnitId,     setScannedUnitId]     = useState<string | null>(null);
  const [confirmedLocation, setConfirmedLocation] = useState<string | null>(null);
  const [remainingQty,      setRemainingQty]      = useState(0);
  const [qtyInput,          setQtyInput]          = useState('');

  const [shortfallDialog, setShortfallDialog] = useState<{
    qty: number; shortfall: number;
    reported: Array<{ type: string; qty: number; label: string }>;
  } | null>(null);
  const [exType,       setExType]       = useState('');
  const [exQtyInput,   setExQtyInput]   = useState('');
  const [exSubmitting, setExSubmitting] = useState(false);
  const [pendingStow,  setPendingStow]  = useState<{ qty: number; exceptionsFiled: boolean } | null>(null);
  const [filedExceptions, setFiledExceptions] = useState<Array<{ type: string; qty: number; label: string }>>([]);

  const currentTask = tasks[currentIndex] ?? null;

  // ── Load tasks ──────────────────────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const all = await onFetchTasks();
        const active = all.filter(t => t.status === 'pending' || t.status === 'in_progress');
        const tapped = active.find(t => t.stow_task_id === initialTaskId);
        const rest   = active.filter(t => t.stow_task_id !== initialTaskId);
        const ordered = tapped ? [tapped, ...rest] : active;
        setTasks(ordered);
        if (ordered.length > 0) setRemainingQty(ordered[0].quantity);
      } catch {
        setLoadError('Failed to load stow tasks.');
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTaskId]);

  // ── Advance to next task ────────────────────────────────────────────────────
  const advanceToNext = useCallback(() => {
    const next = currentIndex + 1;
    if (next >= tasks.length) {
      setPhase('complete');
    } else {
      setCurrentIndex(next);
      setRemainingQty(tasks[next].quantity);
      setScannedUnitId(null);
      setConfirmedLocation(null);
      setQtyInput('');
      setShortfallDialog(null);
      setPendingStow(null);
      setFiledExceptions([]);
      setPhase('item_scan');
    }
  }, [currentIndex, tasks]);

  // ── Node 1: Item scan ───────────────────────────────────────────────────────
  const handleItemScan = useCallback(async (scannedValue: string) => {
    if (!currentTask) return;
    setSubmitError(null);
    const resolved = await onResolveBarcode(scannedValue);
    if (!resolved?.lasyncro_variant_id) {
      throw Object.assign(new Error('Barcode not recognised.'), {
        response: { data: { error: 'Barcode not recognised. Try scanning again or check the label.' } },
      });
    }
    if (resolved.lasyncro_variant_id !== currentTask.lasyncro_variant_id) {
      throw Object.assign(new Error('Wrong product.'), {
        response: { data: { error: 'Wrong product — does not match this stow task.' } },
      });
    }
    setScannedUnitId(resolved.lasyncro_unit_id ?? null);
    setPhase('location_scan');
  }, [currentTask, onResolveBarcode]);

  // ── Node 2: Location scan ───────────────────────────────────────────────────
  const handleLocationScan = useCallback(async (scannedValue: string) => {
    if (!currentTask) return;
    setSubmitError(null);
    const resolved = await onResolveLocation(scannedValue);
    if (!resolved?.location_code) {
      throw Object.assign(new Error('Location not found.'), {
        response: { data: { error: 'Location not recognised. Try scanning the bin barcode.' } },
      });
    }
    if (!currentTask.location_code) {
      await onAssignLocation(currentTask.stow_task_id, resolved.location_code);
    } else if (resolved.location_code !== currentTask.location_code) {
      throw Object.assign(new Error('Wrong location.'), {
        response: { data: { error: `Wrong location. Expected: ${currentTask.location_code}` } },
      });
    }
    try { await onClaimTask(currentTask.stow_task_id); } catch { /* already claimed — proceed */ }
    setTasks(prev => prev.map((t, i) =>
      i === currentIndex ? { ...t, location_code: resolved.location_code, status: 'in_progress' } : t
    ));
    setConfirmedLocation(resolved.location_code);
    setPhase('qty_confirm');
  }, [currentTask, currentIndex, onResolveLocation, onAssignLocation, onClaimTask]);

  // ── Node 3: Stow confirm ────────────────────────────────────────────────────
  const submitStow = useCallback(async (qty: number, exceptionsFiled = false) => {
    if (!currentTask) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirmStow(currentTask.stow_task_id, qty, scannedUnitId ?? undefined);
      const newRemaining = remainingQty - qty;
      if (newRemaining > 0 && !exceptionsFiled) {
        setRemainingQty(newRemaining);
        setScannedUnitId(null);
        setConfirmedLocation(null);
        setQtyInput('');
        setShortfallDialog(null);
        setPhase('item_scan');
      } else {
        advanceToNext();
      }
    } catch {
      setSubmitError('Stow confirm failed. Try again.');
    } finally {
      setSubmitting(false);
    }
  }, [currentTask, remainingQty, scannedUnitId, advanceToNext, onConfirmStow]);

  const handleQtyConfirm = useCallback(async () => {
    const qty = parseInt(qtyInput, 10);
    if (isNaN(qty) || qty <= 0) { setSubmitError('Enter a valid quantity.'); return; }
    if (qty > remainingQty) { setSubmitError(`Only ${remainingQty} units remaining.`); return; }
    const shortfall = remainingQty - qty;
    if (shortfall > 0) {
      setShortfallDialog({ qty, shortfall, reported: [] });
      setExType(''); setExQtyInput('');
      return;
    }
    setPendingStow({ qty, exceptionsFiled: false });
    setFiledExceptions([]);
    setPhase('summary');
  }, [qtyInput, remainingQty]);

  const handleShortfallConfirm = useCallback(async () => {
    if (!shortfallDialog || !currentTask || !exType) return;
    const exQty = parseInt(exQtyInput, 10);
    if (isNaN(exQty) || exQty <= 0 || exQty > shortfallDialog.shortfall) {
      setSubmitError(`Enter between 1 and ${shortfallDialog.shortfall}.`); return;
    }
    setExSubmitting(true);
    try {
      const result = await onReportException(currentTask.stow_task_id, {
        exception_type:   exType,
        quantity:         exQty,
        notes:            'Reported during stow qty confirm',
        lasyncro_unit_id: scannedUnitId ?? undefined,
      });
      const newReported = [
        ...shortfallDialog.reported,
        { type: exType, qty: exQty, label: result.prob_label ?? 'PROB-?' },
      ];
      const newShortfall = shortfallDialog.shortfall - exQty;
      if (newShortfall > 0) {
        setShortfallDialog(prev => prev ? { ...prev, shortfall: newShortfall, reported: newReported } : null);
        setExType(''); setExQtyInput('');
      } else {
        setFiledExceptions(newReported);
        setShortfallDialog(null);
        setPendingStow({ qty: shortfallDialog.qty, exceptionsFiled: true });
        setPhase('summary');
      }
    } catch {
      setSubmitError('Failed to report exception.');
    } finally {
      setExSubmitting(false);
    }
  }, [shortfallDialog, currentTask, exType, exQtyInput, onReportException]);

  // ── Shared node config ──────────────────────────────────────────────────────
  const nodeStates = {
    item: phase === 'item_scan' ? 'active'
      : phase === 'brief' ? 'pending'
        : 'confirmed',
    location: phase === 'location_scan' ? 'active'
      : ['qty_confirm', 'summary'].includes(phase) ? 'confirmed'
        : 'pending',
    qty: ['qty_confirm', 'summary'].includes(phase) ? 'active' : 'pending',
  } as const;

  const progressLabel = currentTask ? `Task ${currentIndex + 1} of ${tasks.length}` : '';

  const sharedNodes = !currentTask ? [] : [
    {
      label: 'Scan Item',
      sublabel: currentTask.sku ?? undefined,
      state: nodeStates.item,
      icon: <Package size={16} />,
    },
    {
      label: 'Scan Location',
      sublabel: confirmedLocation ?? currentTask.location_code ?? undefined,
      state: nodeStates.location,
      icon: <MapPin size={16} />,
    },
    {
      label: 'Qty',
      sublabel: undefined,
      state: nodeStates.qty,
      icon: <Hash size={16} />,
    },
  ];

  // ── BRIEF ───────────────────────────────────────────────────────────────────
  if (phase === 'brief') {
    return (
      <Box sx={{ p: 3 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
            <CircularProgress size={32} />
          </Box>
        ) : loadError ? (
          <Alert severity="error">{loadError}</Alert>
        ) : tasks.length === 0 ? (
          <Alert severity="info">No stow tasks pending.</Alert>
        ) : (
          <>
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" fontWeight={600}>Stow Session</Typography>
              <Typography variant="body2" color="text.secondary">
                Review your tasks below, then start stowing.
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
              {[
                { label: 'SKUs',      value: tasks.length },
                { label: 'Units',     value: tasks.reduce((s, t) => s + t.quantity, 0) },
                { label: 'Locations', value: new Set(tasks.map(t => t.location_code).filter(Boolean)).size },
              ].map(({ label, value }) => (
                <Paper key={label} variant="outlined" sx={{ flex: 1, p: 2, textAlign: 'center', borderRadius: 2 }}>
                  <Typography variant="h5" fontWeight={600} color="warning.main">{value}</Typography>
                  <Typography variant="caption" color="text.secondary">{label}</Typography>
                </Paper>
              ))}
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
              {tasks.map((t) => (
                <Paper key={t.stow_task_id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {t.image_url ? (
                      <Box component="img" src={t.image_url} alt={t.variant_title ?? ''}
                        sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 1, flexShrink: 0, border: `1px solid ${theme.palette.divider}` }} />
                    ) : (
                      <Box sx={{ width: 40, height: 40, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Package size={18} color={theme.palette.text.disabled} />
                      </Box>
                    )}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {t.product_title ?? t.variant_title ?? t.sku ?? t.stow_task_id.slice(0, 8).toUpperCase()}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                      <Chip label={`${t.quantity} units`} size="small" />
                      {t.location_code
                        ? <Chip label={t.location_code} size="small" color="success" />
                        : <Chip label="No location" size="small" sx={{ bgcolor: 'var(--accent-ghost)', color: 'var(--accent)', border: '0.5px solid var(--accent-border)', fontWeight: 600, fontSize: 11 }} />}
                    </Box>
                  </Box>
                </Paper>
              ))}
            </Box>
            <Button variant="contained" size="large" fullWidth
              sx={{ borderRadius: '6px', fontWeight: 600, bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
              onClick={() => setPhase('item_scan')}>
              Start Stowing
            </Button>
          </>
        )}
      </Box>
    );
  }

  // ── COMPLETE ─────────────────────────────────────────────────────────────────
  if (phase === 'complete') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4, textAlign: 'center', minHeight: 400 }}>
        <CheckCircle size={56} color={theme.palette.success.main} />
        <Typography variant="h5" fontWeight={600} sx={{ mt: 2 }}>Stow complete</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 4 }}>
          {tasks.length} SKU{tasks.length !== 1 ? 's' : ''} stowed. Inventory updated.
        </Typography>
        <Button variant="contained" size="large"
          sx={{ borderRadius: '6px', fontWeight: 600, bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
          onClick={onComplete}>
          Back to operations
        </Button>
      </Box>
    );
  }

  if (!currentTask) return null;

  // ── ITEM SCAN (Node 1) ───────────────────────────────────────────────────────
  if (phase === 'item_scan') {
    return (
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <IconButton onClick={() => setPhase('brief')} size="small"><ArrowLeft size={18} /></IconButton>
          <Typography variant="subtitle2" color="text.secondary">{progressLabel}</Typography>
        </Box>
        <LinearProgress variant="determinate" value={((currentIndex + 1) / tasks.length) * 100} sx={{ mb: 2, borderRadius: 1 }} />
        <NodeTrack nodes={sharedNodes} />

        <Alert severity="info" icon={false} sx={{ mb: 2, py: 0.5, fontSize: 13 }}>
          <strong>Step 1 of 3</strong> — Scan the item's LSU- barcode to confirm you have the right product.
        </Alert>

        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
          {currentTask.image_url ? (
            <Box component="img" src={currentTask.image_url} alt={currentTask.variant_title ?? ''}
              sx={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 1, flexShrink: 0, border: `1px solid ${theme.palette.divider}` }} />
          ) : (
            <Box sx={{ width: 64, height: 64, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Package size={28} color={theme.palette.text.disabled} />
            </Box>
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} noWrap>{currentTask.product_title ?? currentTask.variant_title ?? '—'}</Typography>
            {currentTask.sku && (
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', display: 'block' }}>
                {currentTask.sku}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              {remainingQty} unit{remainingQty !== 1 ? 's' : ''} to stow
            </Typography>
            {(currentTask.unit_ids ?? []).length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, fontSize: 10 }}>
                  LSU- codes for this task
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {(currentTask.unit_ids ?? []).map((id) => (
                    <Chip
                      key={id}
                      label={id}
                      size="small"
                      sx={{ fontFamily: 'monospace', fontSize: 11, bgcolor: alpha('#ff6b00', 0.10), color: 'var(--accent)', fontWeight: 600 }}
                    />
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        </Paper>

        <ScanInput
          hint="Scan item barcode (LSU- or product barcode)"
          error={submitError}
          onSubmit={(v) => {
            void handleItemScan(v).catch((err: unknown) => {
              const msg = (err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Item scan failed.');
              setSubmitError(msg);
            });
          }}
        />
        {submitError && <Alert severity="error" sx={{ mt: 2 }}>{submitError}</Alert>}
      </Box>
    );
  }

  // ── LOCATION SCAN (Node 2) ───────────────────────────────────────────────────
  if (phase === 'location_scan') {
    return (
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <IconButton onClick={() => setPhase('item_scan')} size="small"><ArrowLeft size={18} /></IconButton>
          <Typography variant="subtitle2" color="text.secondary">{progressLabel}</Typography>
        </Box>
        <LinearProgress variant="determinate" value={((currentIndex + 1) / tasks.length) * 100} sx={{ mb: 2, borderRadius: 1 }} />
        <NodeTrack nodes={sharedNodes} />

        <Alert severity="info" icon={false} sx={{ mb: 2, py: 0.5, fontSize: 13 }}>
          <strong>Step 2 of 3</strong> — Walk to the bin and scan its barcode to confirm the destination.
        </Alert>

        {/* Item confirmed card */}
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, borderColor: theme.palette.success.main, display: 'flex', gap: 2, alignItems: 'center' }}>
          {currentTask.image_url ? (
            <Box component="img" src={currentTask.image_url} alt={currentTask.variant_title ?? ''}
              sx={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }} />
          ) : (
            <Box sx={{ width: 48, height: 48, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Package size={22} color={theme.palette.success.main} />
            </Box>
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
              <CheckCircle size={13} color={theme.palette.success.main} />
              <Typography variant="caption" color="success.main" fontWeight={600}>Item confirmed</Typography>
            </Box>
            <Typography variant="body2" fontWeight={600} noWrap>{currentTask.product_title ?? currentTask.variant_title ?? '—'}</Typography>
            <Typography variant="caption" color="text.secondary">{remainingQty} units</Typography>
          </Box>
        </Paper>

        {/* Suggested location */}
        {currentTask.location_code && (
          <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: 'var(--accent-ghost)', borderColor: 'var(--accent-border)'}}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <MapPin size={16} color='var(--accent)' />
              <Typography variant="body2" fontWeight={600} sx={{ color: 'var(--accent)' }}>
                Suggested bin: {currentTask.location_code}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: 'block' }}>
              Walk to this bin and scan its barcode to confirm.
            </Typography>
          </Paper>
        )}

        <ScanInput
          hint="Scan bin barcode or type location code"
          error={submitError}
          onSubmit={(v) => {
            void handleLocationScan(v).catch((err: unknown) => {
              const msg = (err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Location scan failed.');
              setSubmitError(msg);
            });
          }}
        />
        {submitError && <Alert severity="error" sx={{ mt: 2 }}>{submitError}</Alert>}
      </Box>
    );
  }

  // ── QTY CONFIRM (Node 3) ─────────────────────────────────────────────────────
  if (phase === 'qty_confirm') {
    return (
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <IconButton onClick={() => setPhase('location_scan')} size="small"><ArrowLeft size={18} /></IconButton>
          <Typography variant="subtitle2" color="text.secondary">{progressLabel}</Typography>
        </Box>
        <LinearProgress variant="determinate" value={((currentIndex + 1) / tasks.length) * 100} sx={{ mb: 2, borderRadius: 1 }} />
        <NodeTrack nodes={sharedNodes} />

        <Paper variant="outlined" sx={{ p: 2, mb: 1.5, borderRadius: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Location</Typography>
          <Typography variant="body1" fontWeight={600}>{confirmedLocation}</Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Product</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.5 }}>
            {currentTask.image_url ? (
              <Box component="img" src={currentTask.image_url} alt="" sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }} />
            ) : (
              <Box sx={{ width: 40, height: 40, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Package size={18} style={{ opacity: 0.4 }} />
              </Box>
            )}
            <Box>
              <Typography variant="body1" fontWeight={600}>{currentTask.product_title ?? currentTask.variant_title ?? currentTask.sku ?? '—'}</Typography>
              {currentTask.sku && <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{currentTask.sku}</Typography>}
            </Box>
          </Box>
        </Paper>

        <Divider sx={{ mb: 2 }} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>How many units are you placing here?</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
          <TextField
            type="number" value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleQtyConfirm(); }}
            placeholder={`/ ${remainingQty}`} autoFocus size="small" sx={{ flex: 1 }}
            inputProps={{ min: 1, max: remainingQty }}
          />
          <Typography variant="body2" color="text.secondary">of {remainingQty}</Typography>
        </Box>

        {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}

        <Button variant="contained" size="large" fullWidth disabled={submitting}
          sx={{ borderRadius: '6px', fontWeight: 600, bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
          onClick={() => void handleQtyConfirm()}>
          {submitting ? 'Confirming…' : 'Confirm stow'}
        </Button>

        <Dialog open={!!shortfallDialog} onClose={() => undefined} fullWidth maxWidth="xs">
          <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>
            {shortfallDialog?.shortfall} unit{(shortfallDialog?.shortfall ?? 0) > 1 ? 's' : ''} unaccounted
          </DialogTitle>
          <DialogContent sx={{ pt: '8px !important' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {(shortfallDialog?.reported.length ?? 0) > 0
                ? `${shortfallDialog?.reported.reduce((s, e) => s + e.qty, 0)} explained. What about the rest?`
                : `You placed ${shortfallDialog?.qty} of ${remainingQty}. What happened to the rest?`}
            </Typography>
            {shortfallDialog?.reported.map((ex, i) => (
              <Box key={i} sx={{ mb: 1, p: 1, borderRadius: 1, bgcolor: alpha(theme.palette.success.main, 0.15) }}>
                <Typography variant="caption" color="success.main">✓ {ex.qty} × {ex.type} → {ex.label}</Typography>
              </Box>
            ))}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
              {STOW_EXCEPTIONS.map(({ type, label }) => (
                <Chip key={type} label={label} onClick={() => setExType(type)}
                  color={exType === type ? 'warning' : 'default'}
                  variant={exType === type ? 'filled' : 'outlined'}
                  sx={{ cursor: 'pointer' }} />
              ))}
            </Box>
            <TextField
              label={`Quantity (max ${shortfallDialog?.shortfall})`} type="number"
              value={exQtyInput} onChange={(e) => setExQtyInput(e.target.value)}
              size="small" fullWidth inputProps={{ min: 1, max: shortfallDialog?.shortfall }} sx={{ mb: 1 }} />
            {submitError && <Alert severity="error">{submitError}</Alert>}
          </DialogContent>
          <DialogActions sx={{ flexDirection: 'column', gap: 1, px: 2, pb: 2 }}>
            <Button variant="contained" fullWidth disabled={!exType || exSubmitting}
              sx={{ borderRadius: '6px', fontWeight: 600, bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
              onClick={() => void handleShortfallConfirm()}>
              {exSubmitting ? 'Processing…' : 'Report & continue'}
            </Button>
            {(shortfallDialog?.reported.length ?? 0) === 0 && (
              <Button fullWidth size="small" color="inherit" startIcon={<RotateCcw size={14} />}
                onClick={() => { setShortfallDialog(null); void submitStow(remainingQty); }}
                disabled={exSubmitting}>
                I miscounted — all {remainingQty} are here
              </Button>
            )}
          </DialogActions>
        </Dialog>
      </Box>
    );
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────────
  if (phase === 'summary' && pendingStow && currentTask) {
    return (
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <IconButton onClick={() => setPhase('qty_confirm')} size="small"><ArrowLeft size={18} /></IconButton>
          <Typography variant="subtitle2" color="text.secondary">{progressLabel}</Typography>
          <Chip label="Review & confirm" size="small" color="primary" sx={{ ml: 'auto' }} />
        </Box>
        <LinearProgress variant="determinate" value={((currentIndex + 1) / tasks.length) * 100} sx={{ mb: 2, borderRadius: 1 }} />
        <NodeTrack nodes={sharedNodes} />

        <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>Review before stowing</Typography>

        <Paper variant="outlined" sx={{ p: 2, mb: 1.5, borderRadius: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Location</Typography>
          <Typography variant="body1" fontWeight={600}>{confirmedLocation}</Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2, mb: 1.5, borderRadius: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Product</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.5 }}>
            {currentTask.image_url ? (
              <Box component="img" src={currentTask.image_url} alt="" sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }} />
            ) : (
              <Box sx={{ width: 40, height: 40, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Package size={18} style={{ opacity: 0.4 }} />
              </Box>
            )}
            <Box>
              <Typography variant="body1" fontWeight={600}>{currentTask.product_title ?? currentTask.variant_title ?? currentTask.sku ?? '—'}</Typography>
              {currentTask.sku && <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{currentTask.sku}</Typography>}
            </Box>
          </Box>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Units placing</Typography>
          <Typography variant="body1" fontWeight={600}>{pendingStow.qty} of {remainingQty}</Typography>
        </Paper>

        {filedExceptions.length > 0 && (
          <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, borderColor: 'warning.main' }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, display: 'block', mb: 1 }}>
              Exceptions filed
            </Typography>
            {filedExceptions.map((ex, i) => (
              <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2">{ex.type.replace(/_/g, ' ')}</Typography>
                <Typography variant="body2" fontWeight={600}>{ex.qty} units → {ex.label}</Typography>
              </Box>
            ))}
          </Paper>
        )}

        {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}

        <Button variant="contained" size="large" fullWidth disabled={submitting}
          sx={{ borderRadius: '6px', fontWeight: 600, bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
          onClick={() => void submitStow(pendingStow.qty, pendingStow.exceptionsFiled)}>
          {submitting ? 'Confirming…' : 'Confirm & Stow'}
        </Button>
      </Box>
    );
  }

  return null;
}