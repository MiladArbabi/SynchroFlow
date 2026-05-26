// modules/wms/src/ui/pages/ReceiveSessionPage.tsx
import { useState, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  LinearProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  useTheme,
} from '@mui/material';
import { CheckCircle, AlertTriangle, PackageX, ScanBarcode } from 'lucide-react';

/**
 * RECEIVE SESSION PAGE (FEAT-004)
 * --------------------------------
 * Mobile-first operator interface for processing inbound PO shipments.
 *
 * Three zones per variant screen:
 * ┌─────────────────────────────────────┐
 * │  ZONE 1 — VARIANT IDENTITY          │
 * │  Product title, SKU, expected qty   │
 * ├─────────────────────────────────────┤
 * │  ZONE 2 — INSPECTION COUNTER        │
 * │  [✓ Accepted: 0] [✗ Rejected: 0]   │
 * │  Tap + for each accepted unit       │
 * ├─────────────────────────────────────┤
 * │  ZONE 3 — ACTION                    │
 * │  [Report Problem] [Confirm Batch]   │
 * └─────────────────────────────────────┘
 *
 * Flow:
 * 1. One variant per screen — operator taps + for each accepted unit
 * 2. Report Problem → exception dialog (defect, wrong item, barcode mismatch, etc.)
 * 3. Confirm Batch → inspectLine API called → advance to next variant
 * 4. Last variant confirmed → closeJob API called → done
 *
 * API calls injected via props — module stays decoupled from HTTP layer.
 */

export interface ReceiveJobLine {
  receive_job_line_id: string;
  lasyncro_variant_id: string | null;
  sku: string | null;
  variant_title: string | null;
  quantity_expected: number;
}

export interface ReceiveSessionPageProps {
  receiveJobId: string;
  poId: string;
  supplierName: string;
  lines: ReceiveJobLine[];
  onInspectLine: (params: {
    lasyncro_variant_id: string | null;
    receive_job_line_id: string;
    quantity_accepted: number;
    quantity_rejected: number;
  }) => Promise<void>;
  onReportException: (params: {
    lasyncro_variant_id: string | null;
    receive_job_line_id: string;
    exception_type: string;
    quantity_affected: number;
    notes?: string;
  }) => Promise<void>;
  onCloseJob: (params: { actual_delivery_date?: string }) => Promise<void>;
  onComplete: () => void;
}

type ExceptionType = 'defect' | 'packaging_damage' | 'wrong_item' | 'wrong_variant' | 'wrong_quantity' | 'barcode_mismatch' | 'other';

const EXCEPTION_LABELS: Record<ExceptionType, string> = {
  defect: 'Unit defect',
  packaging_damage: 'Packaging damaged',
  wrong_item: 'Wrong product',
  wrong_variant: 'Wrong variant',
  wrong_quantity: 'Wrong quantity',
  barcode_mismatch: 'Barcode mismatch',
  other: 'Other',
};

export default function ReceiveSessionPage({
  receiveJobId,
  supplierName,
  lines,
  onInspectLine,
  onReportException,
  onCloseJob,
  onComplete,
}: ReceiveSessionPageProps) {
  const theme = useTheme();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [accepted, setAccepted] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [exceptionDialog, setExceptionDialog] = useState(false);
  const [exceptionType, setExceptionType] = useState<ExceptionType | null>(null);
  const [exceptionNotes, setExceptionNotes] = useState('');
  const [exceptionQty, setExceptionQty] = useState('1');
  const [closing, setClosing] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [closeDialog, setCloseDialog] = useState(false);

  const currentLine = lines[currentIndex];
  const isLastLine = currentIndex === lines.length - 1;
  const progress = Math.round((currentIndex / lines.length) * 100);
  const rejected = currentLine ? Math.max(0, currentLine.quantity_expected - accepted) : 0;
  const totalCounted = accepted + rejected;
  const remaining = currentLine ? currentLine.quantity_expected - totalCounted : 0;

  const resetForNext = useCallback(() => {
    setAccepted(0);
    setSubmitError(null);
  }, []);

  const handleConfirmBatch = useCallback(async () => {
    if (!currentLine) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onInspectLine({
        lasyncro_variant_id: currentLine.lasyncro_variant_id,
        receive_job_line_id: currentLine.receive_job_line_id,
        quantity_accepted: accepted,
        quantity_rejected: rejected,
      });
      resetForNext();
      if (isLastLine) {
        setCloseDialog(true);
      } else {
        setCurrentIndex((i) => i + 1);
      }
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Failed to confirm batch. Please retry.');
    } finally {
      setSubmitting(false);
    }
  }, [currentLine, accepted, rejected, isLastLine, onInspectLine, resetForNext]);

  const handleReportException = useCallback(async () => {
    if (!currentLine || !exceptionType) return;
    const needsNotes = exceptionType === 'barcode_mismatch' || exceptionType === 'other';
    if (needsNotes && !exceptionNotes.trim()) return;

    try {
      await onReportException({
        lasyncro_variant_id: currentLine.lasyncro_variant_id,
        receive_job_line_id: currentLine.receive_job_line_id,
        exception_type: exceptionType,
        quantity_affected: parseInt(exceptionQty, 10) || 1,
        notes: exceptionNotes.trim() || undefined,
      });
    } catch (err: any) {
      console.error('[RECEIVE_SESSION] Exception report failed', err?.message);
    } finally {
      setExceptionDialog(false);
      setExceptionType(null);
      setExceptionNotes('');
      setExceptionQty('1');
    }
  }, [currentLine, exceptionType, exceptionNotes, exceptionQty, onReportException]);

  const handleCloseJob = useCallback(async () => {
    setClosing(true);
    try {
      await onCloseJob({ actual_delivery_date: deliveryDate || undefined });
      onComplete();
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Failed to close receive job.');
      setClosing(false);
      setCloseDialog(false);
    }
  }, [deliveryDate, onCloseJob, onComplete]);

  // ── DONE SCREEN ───────────────────────────────────────────
  if (!currentLine && !closeDialog) {
    return (
      <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <CheckCircle size={56} color={theme.palette.success.main} />
        <Typography variant="h5" fontWeight={700} sx={{ mt: 2 }}>All variants inspected</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 4, textAlign: 'center' }}>
          {lines.length} variant{lines.length !== 1 ? 's' : ''} processed from {supplierName}.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* PROGRESS */}
      <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            Variant {currentIndex + 1} of {lines.length} — {supplierName}
          </Typography>
          <Typography variant="caption" color="text.secondary">{progress}%</Typography>
        </Box>
        <LinearProgress variant="determinate" value={progress} sx={{ borderRadius: 1, height: 5 }} />
      </Box>

      {/* ZONE 1 — VARIANT IDENTITY */}
      <Paper variant="outlined" sx={{ mx: 2, mt: 1, p: 2, borderRadius: 2, borderColor: theme.palette.primary.main, borderWidth: 2, flex: '0 0 auto' }}>
        <Typography variant="overline" color="primary" sx={{ fontSize: 10, letterSpacing: 1.5 }}>
          Inspect variant
        </Typography>
        <Typography variant="h6" fontWeight={700} sx={{ mt: 0.5 }} noWrap>
          {currentLine?.variant_title || currentLine?.sku || currentLine?.lasyncro_variant_id?.slice(0, 8) || 'Unknown item'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, mt: 0.5, alignItems: 'center' }}>
          {currentLine?.sku && (
            <Typography variant="caption" color="text.secondary">SKU: {currentLine.sku}</Typography>
          )}
          <Chip
            label={`Expected: ${currentLine?.quantity_expected}`}
            size="small"
            color="primary"
            variant="outlined"
          />
          {remaining > 0 && (
            <Chip label={`${remaining} remaining`} size="small" color="warning" variant="outlined" />
          )}
        </Box>
      </Paper>

      {/* ZONE 2 — INSPECTION COUNTER */}
      <Paper variant="outlined" sx={{ mx: 2, mt: 1.5, p: 2, borderRadius: 2, flex: '0 0 auto' }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
          Inspection count
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>

          {/* ACCEPTED */}
          <Box sx={{ flex: 1, textAlign: 'center' }}>
            <Typography variant="caption" color="success.main" fontWeight={700}>Accepted</Typography>
            <Typography variant="h3" fontWeight={800} color="success.main">{accepted}</Typography>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mt: 1, alignItems: 'center' }}>
              <Button
                variant="outlined"
                color="success"
                size="small"
                onClick={() => setAccepted((a) => Math.max(0, a - 1))}
                disabled={accepted === 0}
                sx={{ minWidth: 36, px: 1 }}
              >
                −
              </Button>
              <TextField
                size="small"
                value={accepted}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 0 && currentLine && v <= currentLine.quantity_expected) {
                    setAccepted(v);
                  }
                }}
                inputProps={{ style: { textAlign: 'center', width: 48, fontWeight: 700 } }}
                sx={{ width: 72 }}
              />
              <Button
                variant="contained"
                color="success"
                size="small"
                onClick={() => setAccepted((a) => a + 1)}
                sx={{ minWidth: 36, px: 1 }}
              >
                +
              </Button>
            </Box>
            <Button
              size="small"
              variant="text"
              color="success"
              onClick={() => currentLine && setAccepted(currentLine.quantity_expected)}
              sx={{ mt: 0.5, fontSize: 11 }}
            >
              Set all ({currentLine?.quantity_expected})
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* ZONE 3 — ACTIONS */}
      <Box sx={{ mx: 2, mt: 1.5, flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {submitError && (
          <Alert severity="error" sx={{ py: 0.5 }}>{submitError}</Alert>
        )}

        <Button
          variant="contained"
          color="success"
          fullWidth
          size="large"
          disabled={submitting || totalCounted === 0}
          onClick={() => void handleConfirmBatch()}
          startIcon={<CheckCircle size={20} />}
          sx={{ borderRadius: 2, fontWeight: 700, py: 1.8, fontSize: 16 }}
        >
          {submitting ? 'Confirming...' : isLastLine ? 'Confirm & Finish' : 'Confirm Batch'}
        </Button>

        <Button
          variant="outlined"
          color="warning"
          fullWidth
          size="large"
          startIcon={<AlertTriangle size={18} />}
          onClick={() => setExceptionDialog(true)}
          sx={{ borderRadius: 2, fontWeight: 600 }}
        >
          Report Problem
        </Button>
      </Box>

      {/* EXCEPTION DIALOG */}
      <Dialog open={exceptionDialog} onClose={() => setExceptionDialog(false)} fullWidth>
        <DialogTitle>Report Problem</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
            {(Object.keys(EXCEPTION_LABELS) as ExceptionType[]).map((type) => (
              <Button
                key={type}
                variant={exceptionType === type ? 'contained' : 'outlined'}
                color={type === 'defect' || type === 'wrong_item' ? 'error' : 'warning'}
                fullWidth
                size="large"
                startIcon={type === 'wrong_item' ? <PackageX size={16} /> : <ScanBarcode size={16} />}
                onClick={() => setExceptionType(type)}
                sx={{ borderRadius: 2, justifyContent: 'flex-start' }}
              >
                {EXCEPTION_LABELS[type]}
              </Button>
            ))}

            {exceptionType && (
              <TextField
                label="Qty affected"
                type="number"
                size="small"
                value={exceptionQty}
                onChange={(e) => setExceptionQty(e.target.value)}
                inputProps={{ min: 1 }}
                fullWidth
              />
            )}

            {(exceptionType === 'barcode_mismatch' || exceptionType === 'other') && (
              <TextField
                label={exceptionType === 'barcode_mismatch' ? 'Scanned barcode value' : 'Notes'}
                value={exceptionNotes}
                onChange={(e) => setExceptionNotes(e.target.value)}
                fullWidth
                required
                multiline={exceptionType === 'other'}
                rows={exceptionType === 'other' ? 2 : 1}
                placeholder={exceptionType === 'barcode_mismatch' ? 'Enter the barcode printed on the unit' : 'Describe the problem'}
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setExceptionDialog(false); setExceptionType(null); }}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={!exceptionType}
            onClick={() => void handleReportException()}
          >
            Report
          </Button>
        </DialogActions>
      </Dialog>

      {/* CLOSE JOB DIALOG */}
      <Dialog open={closeDialog} fullWidth>
        <DialogTitle>Close receive session</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              All variants inspected. Closing the session will write received quantities and create stow tasks automatically.
            </Typography>
            <TextField
              label="Actual delivery date (optional)"
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCloseDialog(false)} disabled={closing}>Cancel</Button>
          <Button
            variant="contained"
            color="success"
            disabled={closing}
            onClick={() => void handleCloseJob()}
          >
            {closing ? 'Closing...' : 'Close & Create Stow Tasks'}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}