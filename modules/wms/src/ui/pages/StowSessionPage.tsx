// modules/wms/src/ui/pages/StowSessionPage.tsx

import { useState, useCallback, useEffect } from 'react';
import {
  Box, Paper, Typography, Button, Alert, Chip, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, useTheme, CircularProgress, IconButton,
} from '@mui/material';
import {
  CheckCircle, MapPin, Package, ArrowLeft, RotateCcw,
} from 'lucide-react';
import { BarcodeScanSurface } from '../components/BarcodeScanSurface.js';
import type { WmsStowTask } from './WmsModuleFT2.js';

/**
 * STOW SESSION PAGE
 * -----------------
 * Web equivalent of mobile StowScreen. Five phases:
 *
 *   summary      → task list overview, start button
 *   location_scan → scan/type bin barcode to confirm destination
 *   product_scan  → scan product barcode to verify correct item
 *   qty_confirm   → enter quantity placed; shortfall triggers exception dialog
 *   complete      → all tasks stowed
 *
 * Partial stow: if qty placed < remaining, operator can file exceptions
 * for the shortfall before continuing.
 *
 * API calls injected via props — module decoupled from HTTP layer.
 */

export type StowExceptionResult = {
  prob_label?: string;
  problem_bin?: string;
};

export interface StowSessionPageProps {
  initialTaskId: string;
  onComplete: () => void;
  onFetchTasks: () => Promise<WmsStowTask[]>;
  onResolveLocation: (scannedValue: string) => Promise<{ location_code: string } | null>;
  onAssignLocation: (taskId: string, locationCode: string) => Promise<void>;
  onClaimTask: (taskId: string) => Promise<void>;
  onResolveBarcode: (scannedValue: string) => Promise<{ lasyncro_variant_id: string } | null>;
  onConfirmStow: (taskId: string, quantityPlaced: number) => Promise<void>;
  onReportException: (taskId: string, params: {
    exception_type: string;
    quantity: number;
    notes?: string;
  }) => Promise<StowExceptionResult>;
}

type Phase = 'summary' | 'location_scan' | 'product_scan' | 'qty_confirm' | 'complete';

const STOW_EXCEPTIONS = [
  { type: 'item_missing',     label: 'Item missing' },
  { type: 'product_defect',   label: 'Damaged' },
  { type: 'packaging_defect', label: 'Packaging issue' },
];

export default function StowSessionPage({
  initialTaskId,
  onComplete,
  onFetchTasks,
  onResolveLocation,
  onAssignLocation,
  onClaimTask,
  onResolveBarcode,
  onConfirmStow,
  onReportException,
}: StowSessionPageProps) {
  const theme = useTheme();

  const [phase,            setPhase]            = useState<Phase>('summary');
  const [tasks,            setTasks]            = useState<WmsStowTask[]>([]);
  const [currentIndex,     setCurrentIndex]     = useState(0);
  const [loading,          setLoading]          = useState(true);
  const [submitting,       setSubmitting]       = useState(false);
  const [loadError,        setLoadError]        = useState<string | null>(null);
  const [submitError,      setSubmitError]      = useState<string | null>(null);

  const [confirmedLocation, setConfirmedLocation] = useState<string | null>(null);
  const [remainingQty,      setRemainingQty]      = useState(0);
  const [qtyInput,          setQtyInput]          = useState('');

  // Shortfall exception dialog
  const [shortfallDialog, setShortfallDialog] = useState<{
    qty: number;
    shortfall: number;
    reported: Array<{ type: string; qty: number; label: string }>;
  } | null>(null);
  const [exType,     setExType]     = useState('');
  const [exQtyInput, setExQtyInput] = useState('');
  const [exSubmitting, setExSubmitting] = useState(false);

  const currentTask = tasks[currentIndex] ?? null;
  const isLastTask  = currentIndex === tasks.length - 1;

  // ── Load tasks ────────────────────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const all = await onFetchTasks();
        const active = all.filter(t => t.status === 'pending' || t.status === 'in_progress');
        // Put the task that was clicked first
        const tapped = active.find(t => t.stow_task_id === initialTaskId);
        const rest   = active.filter(t => t.stow_task_id !== initialTaskId);
        const ordered = tapped ? [tapped, ...rest] : active;
        setTasks(ordered);
        if (ordered.length > 0) {
          setRemainingQty(ordered[0].quantity);
          // Resume in-progress task
          if (ordered[0].status === 'in_progress' && ordered[0].location_code) {
            setConfirmedLocation(ordered[0].location_code);
            setPhase('product_scan');
          }
        }
      } catch {
        setLoadError('Failed to load stow tasks.');
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTaskId]);

  // ── Advance to next task or complete ──────────────────────────────────────
  const advanceToNext = useCallback(() => {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= tasks.length) {
      setPhase('complete');
    } else {
      setCurrentIndex(nextIndex);
      setRemainingQty(tasks[nextIndex].quantity);
      setConfirmedLocation(null);
      setQtyInput('');
      setShortfallDialog(null);
      setPhase('location_scan');
    }
  }, [currentIndex, tasks]);

  // ── Location scan ─────────────────────────────────────────────────────────
  const handleLocationScan = useCallback(async (scannedValue: string) => {
    if (!currentTask) return;
    setSubmitError(null);

    const resolved = await onResolveLocation(scannedValue);
    if (!resolved?.location_code) {
      throw Object.assign(new Error('Location not found.'), {
        response: { data: { error: 'Location not recognised. Try scanning the bin barcode.' } },
      });
    }

    // If task has no location assigned yet, assign it; if it has one, enforce match
    if (!currentTask.location_code) {
      await onAssignLocation(currentTask.stow_task_id, resolved.location_code);
    } else if (resolved.location_code !== currentTask.location_code) {
      throw Object.assign(new Error('Wrong location.'), {
        response: { data: { error: `Wrong location. Expected: ${currentTask.location_code}` } },
      });
    }

    // Claim task (idempotent — already claimed is ok)
    try {
      await onClaimTask(currentTask.stow_task_id);
    } catch {
      // already claimed — proceed
    }

    setTasks(prev => prev.map((t, i) =>
      i === currentIndex ? { ...t, location_code: resolved.location_code, status: 'in_progress' } : t
    ));
    setConfirmedLocation(resolved.location_code);
    setPhase('product_scan');
  }, [currentTask, currentIndex, onResolveLocation, onAssignLocation, onClaimTask]);

  // ── Product scan ──────────────────────────────────────────────────────────
  const handleProductScan = useCallback(async (scannedValue: string) => {
    if (!currentTask) return;
    setSubmitError(null);

    const resolved = await onResolveBarcode(scannedValue);
    if (!resolved?.lasyncro_variant_id) {
      throw Object.assign(new Error('Barcode not recognised.'), {
        response: { data: { error: 'Barcode not recognised. Try scanning again.' } },
      });
    }
    if (resolved.lasyncro_variant_id !== currentTask.lasyncro_variant_id) {
      throw Object.assign(new Error('Wrong product.'), {
        response: { data: { error: 'Wrong product — does not match this stow task.' } },
      });
    }
    setQtyInput('');
    setPhase('qty_confirm');
  }, [currentTask, onResolveBarcode]);

  // ── Stow confirm (after qty entered) ────────────────────────────────────
  const submitStow = useCallback(async (qty: number, exceptionsFiled = false) => {
    if (!currentTask) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirmStow(currentTask.stow_task_id, qty);
      const newRemaining = remainingQty - qty;
      if (newRemaining > 0 && !exceptionsFiled) {
        // Partial — loop back for remaining units
        setRemainingQty(newRemaining);
        setConfirmedLocation(null);
        setQtyInput('');
        setShortfallDialog(null);
        setPhase('location_scan');
      } else {
        advanceToNext();
      }
    } catch {
      setSubmitError('Stow confirm failed. Try again.');
    } finally {
      setSubmitting(false);
    }
  }, [currentTask, remainingQty, advanceToNext, onConfirmStow]);

  // ── Qty confirm ───────────────────────────────────────────────────────────
  const handleQtyConfirm = useCallback(async () => {
    const qty = parseInt(qtyInput, 10);
    if (isNaN(qty) || qty <= 0) {
      setSubmitError('Enter a valid quantity.');
      return;
    }
    if (qty > remainingQty) {
      setSubmitError(`Only ${remainingQty} units remaining.`);
      return;
    }
    const shortfall = remainingQty - qty;
    if (shortfall > 0) {
      setShortfallDialog({ qty, shortfall, reported: [] });
      setExType('');
      setExQtyInput(String(shortfall));
      return;
    }
    await submitStow(qty);
  }, [qtyInput, remainingQty, submitStow]);

  // ── Shortfall exception confirm ───────────────────────────────────────────
  const handleShortfallConfirm = useCallback(async () => {
    if (!shortfallDialog || !currentTask || !exType) return;
    const exQty = parseInt(exQtyInput, 10);
    if (isNaN(exQty) || exQty <= 0 || exQty > shortfallDialog.shortfall) {
      setSubmitError(`Enter between 1 and ${shortfallDialog.shortfall}.`);
      return;
    }
    setExSubmitting(true);
    try {
      const result = await onReportException(currentTask.stow_task_id, {
        exception_type: exType,
        quantity:       exQty,
        notes:          'Reported during stow qty confirm',
      });

      const newReported = [
        ...shortfallDialog.reported,
        { type: exType, qty: exQty, label: result.prob_label ?? 'PROB-?' },
      ];
      const newShortfall = shortfallDialog.shortfall - exQty;

      if (newShortfall > 0) {
        setShortfallDialog(prev => prev
          ? { ...prev, shortfall: newShortfall, reported: newReported }
          : null
        );
        setExType('');
        setExQtyInput('');
      } else {
        setShortfallDialog(null);
        await submitStow(shortfallDialog.qty, true);
      }
    } catch {
      setSubmitError('Failed to report exception.');
    } finally {
      setExSubmitting(false);
    }
  }, [shortfallDialog, currentTask, exType, exQtyInput, onReportException, submitStow]);

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  if (phase === 'summary') {
    return (
      <Box sx={{ p: 3, maxWidth: 600, mx: 'auto' }}>
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
            {/* Summary strip */}
            <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
              {[
                { label: 'SKUs',   value: tasks.length },
                { label: 'Units',  value: tasks.reduce((s, t) => s + t.quantity, 0) },
                { label: 'Locations', value: new Set(tasks.map(t => t.location_code).filter(Boolean)).size },
              ].map(({ label, value }) => (
                <Paper key={label} variant="outlined" sx={{ flex: 1, p: 2, textAlign: 'center', borderRadius: 2 }}>
                  <Typography variant="h5" fontWeight={700} color="warning.main">{value}</Typography>
                  <Typography variant="caption" color="text.secondary">{label}</Typography>
                </Paper>
              ))}
            </Box>

            {/* Task list */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
              {tasks.map((t) => (
                <Paper key={t.stow_task_id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1 }}>
                      {t.variant_title ?? t.sku ?? t.stow_task_id.slice(0, 8).toUpperCase()}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, ml: 1 }}>
                      <Chip label={`${t.quantity} units`} size="small" />
                      {t.location_code
                        ? <Chip label={t.location_code} size="small" color="success" />
                        : <Chip label="No location" size="small" color="warning" />
                      }
                    </Box>
                  </Box>
                </Paper>
              ))}
            </Box>

            <Button
              variant="contained" size="large" fullWidth
              sx={{ borderRadius: 2, fontWeight: 700 }}
              onClick={() => setPhase('location_scan')}
            >
              Start stowing
            </Button>
          </>
        )}
      </Box>
    );
  }

  // ── COMPLETE ──────────────────────────────────────────────────────────────
  if (phase === 'complete') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4, textAlign: 'center', minHeight: 400 }}>
        <CheckCircle size={56} color={theme.palette.success.main} />
        <Typography variant="h5" fontWeight={700} sx={{ mt: 2 }}>
          Stow complete
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 4 }}>
          {tasks.length} SKU{tasks.length !== 1 ? 's' : ''} stowed. Inventory updated.
        </Typography>
        <Button variant="contained" size="large" sx={{ borderRadius: 2, fontWeight: 700 }} onClick={onComplete}>
          Back to operations
        </Button>
      </Box>
    );
  }

  if (!currentTask) return null;

  const progressLabel = `Task ${currentIndex + 1} of ${tasks.length}`;

  // ── LOCATION SCAN ─────────────────────────────────────────────────────────
  if (phase === 'location_scan') {
    return (
      <Box sx={{ p: 2, maxWidth: 560, mx: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <IconButton onClick={() => setPhase('summary')} size="small">
            <ArrowLeft size={18} />
          </IconButton>
          <Typography variant="subtitle2" color="text.secondary">{progressLabel}</Typography>
          <Chip label="Scan location" size="small" color="warning" sx={{ ml: 'auto' }} />
        </Box>

        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Package size={14} />
            <Typography variant="body2" fontWeight={600}>
              {currentTask.variant_title ?? currentTask.sku ?? '—'}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {remainingQty} of {currentTask.quantity} units remaining to stow
          </Typography>
          {currentTask.location_code && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
              <MapPin size={12} />
              <Typography variant="caption" color="success.main">
                Target: {currentTask.location_code}
              </Typography>
            </Box>
          )}
        </Paper>

        <BarcodeScanSurface
          onScan={(v) => void handleLocationScan(v)}
          hint="Scan bin barcode or type location code"
        />

        {submitError && <Alert severity="error" sx={{ mt: 2 }}>{submitError}</Alert>}
      </Box>
    );
  }

  // ── PRODUCT SCAN ──────────────────────────────────────────────────────────
  if (phase === 'product_scan') {
    return (
      <Box sx={{ p: 2, maxWidth: 560, mx: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <IconButton onClick={() => setPhase('location_scan')} size="small">
            <ArrowLeft size={18} />
          </IconButton>
          <Typography variant="subtitle2" color="text.secondary">{progressLabel}</Typography>
          <Chip label="Scan product" size="small" color="info" sx={{ ml: 'auto' }} />
        </Box>

        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, borderColor: theme.palette.success.main }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <MapPin size={13} color={theme.palette.success.main} />
            <Typography variant="caption" color="success.main" fontWeight={600}>
              Location confirmed — {confirmedLocation}
            </Typography>
          </Box>
          <Typography variant="body2" fontWeight={600}>
            {currentTask.variant_title ?? currentTask.sku ?? '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {remainingQty} units · {currentTask.sku}
          </Typography>
        </Paper>

        <BarcodeScanSurface
          onScan={(v) => void handleProductScan(v)}
          hint="Scan product barcode"
        />

        {submitError && <Alert severity="error" sx={{ mt: 2 }}>{submitError}</Alert>}
      </Box>
    );
  }

  // ── QTY CONFIRM ───────────────────────────────────────────────────────────
  if (phase === 'qty_confirm') {
    return (
      <Box sx={{ p: 2, maxWidth: 560, mx: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <IconButton onClick={() => setPhase('product_scan')} size="small">
            <ArrowLeft size={18} />
          </IconButton>
          <Typography variant="subtitle2" color="text.secondary">{progressLabel}</Typography>
          <Chip label="Confirm quantity" size="small" color="success" sx={{ ml: 'auto' }} />
        </Box>

        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            Location
          </Typography>
          <Typography variant="body1" fontWeight={700}>{confirmedLocation}</Typography>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            Product
          </Typography>
          <Typography variant="body1" fontWeight={700}>
            {currentTask.variant_title ?? currentTask.sku ?? '—'}
          </Typography>
          {currentTask.sku && (
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {currentTask.sku}
            </Typography>
          )}
        </Paper>

        <Divider sx={{ mb: 2 }} />

        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          How many units are you placing here?
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
          <TextField
            type="number"
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            placeholder={`/ ${remainingQty}`}
            autoFocus
            size="small"
            sx={{ flex: 1 }}
            inputProps={{ min: 1, max: remainingQty }}
          />
          <Typography variant="body2" color="text.secondary">of {remainingQty}</Typography>
        </Box>
        {remainingQty < currentTask.quantity && (
          <Typography variant="caption" color="info.main" sx={{ display: 'block', mb: 2 }}>
            Partial stow — {currentTask.quantity - remainingQty} units already placed
          </Typography>
        )}

        {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}

        <Button
          variant="contained" size="large" fullWidth
          disabled={submitting}
          sx={{ borderRadius: 2, fontWeight: 700 }}
          onClick={() => void handleQtyConfirm()}
        >
          {submitting ? 'Confirming…' : 'Confirm stow'}
        </Button>

        {/* Shortfall exception dialog */}
        <Dialog
          open={!!shortfallDialog}
          onClose={() => setShortfallDialog(null)}
          fullWidth maxWidth="xs"
        >
          <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>
            {shortfallDialog?.shortfall} unit{(shortfallDialog?.shortfall ?? 0) > 1 ? 's' : ''} unaccounted
          </DialogTitle>
          <DialogContent sx={{ pt: '8px !important' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {(shortfallDialog?.reported.length ?? 0) > 0
                ? `${shortfallDialog?.reported.reduce((s, e) => s + e.qty, 0)} explained. What about the rest?`
                : `You placed ${shortfallDialog?.qty} of ${remainingQty}. What happened to the rest?`
              }
            </Typography>

            {/* Already reported */}
            {shortfallDialog?.reported.map((ex, i) => (
              <Box key={i} sx={{
                mb: 1, p: 1, borderRadius: 1,
                bgcolor: 'success.main', opacity: 0.15,
              }}>
                <Typography variant="caption" color="success.main">
                  ✓ {ex.qty} × {ex.type} → {ex.label}
                </Typography>
              </Box>
            ))}

            {/* Exception type selection */}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
              {STOW_EXCEPTIONS.map(({ type, label }) => (
                <Chip
                  key={type}
                  label={label}
                  onClick={() => setExType(type)}
                  color={exType === type ? 'warning' : 'default'}
                  variant={exType === type ? 'filled' : 'outlined'}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Box>

            <TextField
              label={`Quantity (max ${shortfallDialog?.shortfall})`}
              type="number"
              value={exQtyInput}
              onChange={(e) => setExQtyInput(e.target.value)}
              size="small" fullWidth
              inputProps={{ min: 1, max: shortfallDialog?.shortfall }}
              sx={{ mb: 1 }}
            />

            {submitError && <Alert severity="error">{submitError}</Alert>}
          </DialogContent>
          <DialogActions sx={{ flexDirection: 'column', gap: 1, px: 2, pb: 2 }}>
            <Button
              variant="contained" fullWidth color="warning"
              disabled={!exType || exSubmitting}
              onClick={() => void handleShortfallConfirm()}
            >
              {exSubmitting ? 'Processing…' : 'Report & continue'}
            </Button>
            <Button
              fullWidth size="small" color="inherit"
              startIcon={<RotateCcw size={14} />}
              onClick={() => { setShortfallDialog(null); void submitStow(remainingQty); }}
              disabled={exSubmitting}
            >
              I miscounted — all {remainingQty} are here
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  }

  return null;
}
