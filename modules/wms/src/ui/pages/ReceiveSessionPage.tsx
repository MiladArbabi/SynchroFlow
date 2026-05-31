// modules/wms/src/ui/pages/ReceiveSessionPage.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  useTheme,
} from '@mui/material';
import { CheckCircle, AlertTriangle, PackageX, ScanBarcode, Hash, BarChart2 } from 'lucide-react';

/**
 * RECEIVE SESSION PAGE (FEAT-004)
 * --------------------------------
 * Operator interface for processing inbound PO shipments.
 * Supports two inspection paths:
 *
 * PATH A — Count mode (always available)
 *   One variant per screen. Operator taps +/− or uses Set All.
 *   Shortfall → exception modal → Problem Center routing.
 *
 * PATH B — Scan mode (when manufacturer barcodes exist in Shopify)
 *   Free-scan: operator scans any unit in the delivery.
 *   System resolves barcode → PO line → increments count.
 *   Auto-confirms when scan count = expected qty.
 *   Overcount → confirmation dialog.
 *   Lines without barcodes → inline count fallback.
 *
 * Session phases: brief → inspect → summary → (close dialog) → done
 *
 * API calls injected via props — module stays decoupled from HTTP layer.
 */

type SessionPhase = 'brief' | 'inspect' | 'summary';
type InspectMode = 'count' | 'scan';

export interface ReceiveJobLine {
  receive_job_line_id: string;
  lasyncro_variant_id: string | null;
  sku: string | null;
  variant_title: string | null;
  description: string | null;
  quantity_expected: number;
  inspection_complete?: boolean;
  quantity_accepted?: number;
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
  onResolveBarcode?: (scannedValue: string) => Promise<{ lasyncro_variant_id: string } | null>;
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
  onResolveBarcode,
}: ReceiveSessionPageProps) {
  const theme = useTheme();

  // ── Count mode state ───────────────────────────────────────────────────────
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

  // ── Scan mode state ────────────────────────────────────────────────────────
  // Initialise from backend state — supports session resume after refresh
  const initialScanCounts: Record<string, number> = {};
  const initialConfirmedLines = new Set<string>();
  for (const line of lines) {
    if (line.inspection_complete) {
      initialConfirmedLines.add(line.receive_job_line_id);
      initialScanCounts[line.receive_job_line_id] = line.quantity_accepted ?? line.quantity_expected;
    }
  }
  // scanCounts: { [receive_job_line_id]: number } — units scanned per line
  const [scanCounts, setScanCounts] = useState<Record<string, number>>(initialScanCounts);
  // confirmedLines: set of receive_job_line_ids that have been inspected
  const [confirmedLines, setConfirmedLines] = useState<Set<string>>(initialConfirmedLines);
  // Resume brief screen only if no lines are already confirmed — otherwise go straight to inspect
  const hasPartialProgress = initialConfirmedLines.size > 0;
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanProcessing, setScanProcessing] = useState(false);
  // overcountLine: holds line that was scanned over expected qty — triggers dialog
  const [overcountLine, setOvercountLine] = useState<ReceiveJobLine | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [flashLine, setFlashLine] = useState<string | null>(null);
  const [scanInputValue, setScanInputValue] = useState('');

  // ── Session phase + mode ───────────────────────────────────────────────────
  // Persist inspect mode in sessionStorage — survives refresh within the same tab
  const storedMode = sessionStorage.getItem(`receive-mode-${receiveJobId}`);
  const [inspectMode, setInspectMode] = useState<InspectMode>(
    storedMode === 'scan' && onResolveBarcode ? 'scan'
    : hasPartialProgress && onResolveBarcode ? 'scan'
    : 'count'
  );
  
  // Skip brief screen if resuming a partially-completed session
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>(
    hasPartialProgress || storedMode ? 'inspect' : 'brief'
  );
  
  // Auto-focus scan input when in scan mode
  useEffect(() => {
    if (sessionPhase === 'inspect' && inspectMode === 'scan') {
      scanInputRef.current?.focus();
    }
  }, [sessionPhase, inspectMode]);

  // Re-focus after error — error Alert renders and steals focus
  useEffect(() => {
    if (sessionPhase === 'inspect' && inspectMode === 'scan') {
      setTimeout(() => scanInputRef.current?.focus(), 50);
    }
  }, [scanError, sessionPhase, inspectMode]);

  // ── Scan handler — free-scan: resolves barcode against all PO lines ────────
  const handleScan = useCallback(async (scannedValue: string) => {
    if (!onResolveBarcode || scanProcessing) return;
    setScanProcessing(true);
    setScanError(null);
    try {
      const resolved = await onResolveBarcode(scannedValue);
      if (!resolved?.lasyncro_variant_id) {
        setScanError(`Not recognised — no product matched for "${scannedValue}"`);
        return;
      }
      const matchedLine = lines.find(
        (l) => l.lasyncro_variant_id === resolved.lasyncro_variant_id
      );
      if (!matchedLine) {
        setScanError(`Not in this PO — scanned barcode matches a different product`);
        return;
      }
      if (confirmedLines.has(matchedLine.receive_job_line_id)) {
        setScanError(`Already confirmed — ${matchedLine.sku ?? matchedLine.variant_title ?? 'this item'} is fully received`);
        return;
      }
      const current = scanCounts[matchedLine.receive_job_line_id] ?? 0;
      const next = current + 1;
      if (next > matchedLine.quantity_expected) {
        // Overcount — pause and confirm with operator
        setOvercountLine(matchedLine);
        return;
      }
      setScanCounts((prev) => ({ ...prev, [matchedLine.receive_job_line_id]: next }));
      // Flash the matched line green briefly as scan confirmation
      setFlashLine(matchedLine.receive_job_line_id);
      setTimeout(() => {
        setFlashLine(null);
        scanInputRef.current?.focus();
      }, 600);
      if (next === matchedLine.quantity_expected) {
        // Auto-confirm this line
        setScanProcessing(true);
        try {
          await onInspectLine({
            lasyncro_variant_id: matchedLine.lasyncro_variant_id,
            receive_job_line_id: matchedLine.receive_job_line_id,
            quantity_accepted: next,
            quantity_rejected: 0,
          });
        } catch (inspectErr: any) {
          // 409 = already inspected — treat as confirmed, not an error
          if (inspectErr?.response?.status !== 409) throw inspectErr;
        }
        setConfirmedLines((prev) => new Set([...prev, matchedLine.receive_job_line_id]));
        setScanError(null);
        // Check if all lines confirmed
        const newConfirmed = new Set([...confirmedLines, matchedLine.receive_job_line_id]);
        if (newConfirmed.size === lines.length) {
          setSessionPhase('summary');
        } else {
          setTimeout(() => scanInputRef.current?.focus(), 50);
        }
      }
    } catch {
      setScanError('Scan failed — check connection and try again');
    } finally {
      setScanProcessing(false);
      scanInputRef.current?.focus();
    }
  }, [onResolveBarcode, scanProcessing, lines, confirmedLines, scanCounts, onInspectLine]);

  // ── Overcount confirm — add one more unit ──────────────────────────────────
  const handleOvercountAccept = useCallback(async () => {
    if (!overcountLine) return;
    const next = (scanCounts[overcountLine.receive_job_line_id] ?? 0) + 1;
    setScanCounts((prev) => ({ ...prev, [overcountLine.receive_job_line_id]: next }));
    setOvercountLine(null);
    scanInputRef.current?.focus();
  }, [overcountLine, scanCounts]);

  const handleOvercountReject = useCallback(() => {
    setOvercountLine(null);
    scanInputRef.current?.focus();
  }, []);

  // ── Shortfall modal state ──────────────────────────────────────────────────
  const [shortfallModal, setShortfallModal] = useState<{
    line: ReceiveJobLine;
    accepted: number;
    totalShortfall: number;
    remainingShortfall: number;
  } | null>(null);
  const [shortfallExceptionType, setShortfallExceptionType] = useState<ExceptionType | null>(null);
  const [shortfallExceptionQty, setShortfallExceptionQty] = useState('');
  const [shortfallExceptionNotes, setShortfallExceptionNotes] = useState('');
  const [shortfallSubmitting, setShortfallSubmitting] = useState(false);
  const [shortfallQtyError, setShortfallQtyError] = useState<string | null>(null);

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

    // In scan mode — Confirm Batch advances to summary if all lines confirmed
    if (inspectMode === 'scan') {
      if (confirmedLines.size === lines.length) {
        setSessionPhase('summary');
      } else {
        setSubmitError(`${lines.length - confirmedLines.size} line${lines.length - confirmedLines.size > 1 ? 's' : ''} still need scanning before you can continue.`);
      }
      return;
    }

    const shortfall = currentLine.quantity_expected - accepted;

    // Shortfall detected — force exception reporting before allowing confirmation
    if (shortfall > 0) {
      setShortfallModal({
        line: currentLine,
        accepted,
        totalShortfall: shortfall,
        remainingShortfall: shortfall,
      });
      setShortfallExceptionType(null);
      setShortfallExceptionQty('');
      setShortfallExceptionNotes('');
      return;
    }

    // All units accounted — submit directly
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onInspectLine({
        lasyncro_variant_id: currentLine.lasyncro_variant_id,
        receive_job_line_id: currentLine.receive_job_line_id,
        quantity_accepted: accepted,
        quantity_rejected: 0,
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
  }, [currentLine, accepted, isLastLine, onInspectLine, resetForNext]);

  // ── Submit inspection after all shortfall exceptions accounted for ─────────
  const submitInspectionAfterShortfall = useCallback(async (
    line: ReceiveJobLine,
    acceptedQty: number,
    totalShortfall: number,
  ) => {
    setShortfallSubmitting(true);
    try {
      await onInspectLine({
        lasyncro_variant_id: line.lasyncro_variant_id,
        receive_job_line_id: line.receive_job_line_id,
        quantity_accepted: acceptedQty,
        quantity_rejected: totalShortfall,
      });
      setShortfallModal(null);
      setShortfallExceptionType(null);
      setShortfallExceptionQty('');
      setShortfallExceptionNotes('');
      setShortfallQtyError(null);
      resetForNext();
      if (isLastLine) {
        setCloseDialog(true);
      } else {
        setCurrentIndex((i) => i + 1);
      }
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Failed to submit inspection.');
    } finally {
      setShortfallSubmitting(false);
    }
  }, [onInspectLine, resetForNext, isLastLine]);

  // ── Shortfall modal confirm — report one exception chunk ───────────────────
  const handleShortfallConfirm = useCallback(async () => {
    if (!shortfallModal || !shortfallExceptionType) return;
    const qty = parseInt(shortfallExceptionQty, 10);
    if (!shortfallExceptionQty.trim() || isNaN(qty) || qty <= 0) {
      setShortfallQtyError('Enter a quantity to continue.');
      return;
    }
    if (qty > shortfallModal.remainingShortfall) {
      setShortfallQtyError(`Maximum is ${shortfallModal.remainingShortfall}.`);
      return;
    }
    setShortfallQtyError(null);

    const needsNotes = shortfallExceptionType === 'barcode_mismatch' || shortfallExceptionType === 'other';
    if (needsNotes && !shortfallExceptionNotes.trim()) return;

    setShortfallSubmitting(true);
    try {
      await onReportException({
        lasyncro_variant_id: shortfallModal.line.lasyncro_variant_id,
        receive_job_line_id: shortfallModal.line.receive_job_line_id,
        exception_type: shortfallExceptionType,
        quantity_affected: qty,
        notes: shortfallExceptionNotes.trim() || `${qty} unit${qty > 1 ? 's' : ''} unaccounted during receive`,
      });

      const newRemaining = shortfallModal.remainingShortfall - qty;

      if (newRemaining > 0) {
        // More shortfall to account for — loop
        setShortfallModal((prev) => prev ? { ...prev, remainingShortfall: newRemaining } : null);
        setShortfallExceptionType(null);
        setShortfallExceptionQty('');
        setShortfallExceptionNotes('');
      } else {
        // All accounted — submit inspection
        await submitInspectionAfterShortfall(
          shortfallModal.line,
          shortfallModal.accepted,
          shortfallModal.totalShortfall,
        );
      }
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Failed to report exception.');
    } finally {
      setShortfallSubmitting(false);
    }
  }, [shortfallModal, shortfallExceptionType, shortfallExceptionQty, shortfallExceptionNotes, onReportException, submitInspectionAfterShortfall]);

  // ── Miscount escape hatch — accept full expected, no exception ─────────────
  const handleMiscount = useCallback(async () => {
    if (!shortfallModal) return;
    setShortfallModal(null);
    setAccepted(shortfallModal.line.quantity_expected);
    setShortfallSubmitting(true);
    try {
      await onInspectLine({
        lasyncro_variant_id: shortfallModal.line.lasyncro_variant_id,
        receive_job_line_id: shortfallModal.line.receive_job_line_id,
        quantity_accepted: shortfallModal.line.quantity_expected,
        quantity_rejected: 0,
      });
      resetForNext();
      if (isLastLine) {
        setCloseDialog(true);
      } else {
        setCurrentIndex((i) => i + 1);
      }
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Failed to submit inspection.');
    } finally {
      setShortfallSubmitting(false);
    }
  }, [shortfallModal, onInspectLine, resetForNext, isLastLine]);

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

  const totalUnits = lines.reduce((s, l) => s + l.quantity_expected, 0);

  // ── BRIEF SCREEN ──────────────────────────────────────────────────────────
  if (sessionPhase === 'brief') {
    return (
      <Box sx={{ p: 3, maxWidth: 560, mx: 'auto' }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>Receive from {supplierName}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {lines.length} variant{lines.length !== 1 ? 's' : ''} · {totalUnits} units expected
        </Typography>

        {/* LINE ITEM SUMMARY */}
        <Paper variant="outlined" sx={{ mb: 3, borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, fontSize: 11 }}>Product</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, fontSize: 11 }}>Expected</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.receive_job_line_id}>
                  <TableCell sx={{ fontSize: 12 }}>
                    <Typography variant="body2" fontWeight={500} noWrap>
                      {line.variant_title && line.variant_title !== 'Default Title'
                        ? line.variant_title
                        : line.description ?? line.sku ?? '—'}
                    </Typography>
                    {line.sku && (
                      <Typography variant="caption" color="text.secondary">{line.sku}</Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ fontSize: 12 }}>{line.quantity_expected}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>

        {/* MODE SELECTOR */}
        <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 1.5, display: 'block', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          How do you want to inspect?
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
          <Paper
            variant="outlined"
            onClick={() => { setInspectMode('count'); sessionStorage.setItem(`receive-mode-${receiveJobId}`, 'count'); }}
            sx={{
              p: 2, borderRadius: 2, cursor: 'pointer',
              borderColor: inspectMode === 'count' ? 'var(--accent)' : 'divider',
              bgcolor: inspectMode === 'count' ? 'var(--accent-ghost)' : 'transparent',
              transition: 'all 0.15s',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Hash size={20} color={inspectMode === 'count' ? 'var(--accent)' : theme.palette.text.secondary} />
              <Box>
                <Typography variant="body2" fontWeight={600} color={inspectMode === 'count' ? 'var(--accent)' : 'text.primary'}>
                  Count by hand
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Tap + for each accepted unit. Always available.
                </Typography>
              </Box>
            </Box>
          </Paper>

          <Paper
            variant="outlined"
            onClick={() => { if (onResolveBarcode) { setInspectMode('scan'); sessionStorage.setItem(`receive-mode-${receiveJobId}`, 'scan'); } }}
            sx={{
              p: 2, borderRadius: 2,
              cursor: onResolveBarcode ? 'pointer' : 'not-allowed',
              opacity: onResolveBarcode ? 1 : 0.45,
              borderColor: inspectMode === 'scan' ? 'var(--accent)' : 'divider',
              bgcolor: inspectMode === 'scan' ? 'var(--accent-ghost)' : 'transparent',
              transition: 'all 0.15s',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <ScanBarcode size={20} color={inspectMode === 'scan' ? 'var(--accent)' : theme.palette.text.secondary} />
              <Box>
                <Typography variant="body2" fontWeight={600} color={inspectMode === 'scan' ? 'var(--accent)' : 'text.primary'}>
                  Scan barcodes
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Free-scan any unit — system matches it to the right PO line automatically.
                  {!onResolveBarcode && ' (Not available — barcode resolver not connected)'}
                </Typography>
              </Box>
            </Box>
          </Paper>
        </Box>

        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={() => setSessionPhase('inspect')}
          sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 600 }}
        >
          Start Receiving
        </Button>
      </Box>
    );
  }

  // ── SUMMARY SCREEN ────────────────────────────────────────────────────────
  if (sessionPhase === 'summary') {
    const totalAccepted = lines.reduce((s, l) => {
      if (inspectMode === 'scan') return s + (scanCounts[l.receive_job_line_id] ?? 0);
      return s + (confirmedLines.has(l.receive_job_line_id) ? (scanCounts[l.receive_job_line_id] ?? l.quantity_expected) : accepted);
    }, 0);
    const totalRejected = totalUnits - totalAccepted;

    return (
      <Box sx={{ p: 3, maxWidth: 560, mx: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
          <CheckCircle size={28} color={theme.palette.success.main} />
          <Typography variant="h6" fontWeight={600}>Inspection complete</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {supplierName} · {lines.length} variant{lines.length !== 1 ? 's' : ''}
        </Typography>

        {/* PER-LINE SUMMARY */}
        <Paper variant="outlined" sx={{ mb: 3, borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, fontSize: 11 }}>Product</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, fontSize: 11 }}>Expected</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, fontSize: 11 }}>Accepted</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((line) => {
                const lineAccepted = inspectMode === 'scan'
                  ? (scanCounts[line.receive_job_line_id] ?? 0)
                  : (confirmedLines.has(line.receive_job_line_id) ? line.quantity_expected : 0);
                const short = line.quantity_expected - lineAccepted;
                return (
                  <TableRow key={line.receive_job_line_id}>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="body2" fontWeight={500} noWrap>
                        {line.variant_title && line.variant_title !== 'Default Title'
                          ? line.variant_title
                          : line.description ?? line.sku ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: 12 }}>{line.quantity_expected}</TableCell>
                    <TableCell align="right" sx={{ fontSize: 12 }}>
                      <Typography variant="body2" color={short > 0 ? 'error' : 'success.main'} fontWeight={600}>
                        {lineAccepted}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow>
                <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Total</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, fontSize: 12 }}>{totalUnits}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, fontSize: 12 }}>
                  <Typography variant="body2" color={totalRejected > 0 ? 'error' : 'success.main'} fontWeight={600}>
                    {totalAccepted}
                  </Typography>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Paper>

        {totalRejected > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {totalRejected} unit{totalRejected > 1 ? 's' : ''} short — exceptions have been logged to the Problem Center.
          </Alert>
        )}

        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={() => setCloseDialog(true)}
          sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 600 }}
        >
          Close & Create Stow Tasks
        </Button>
      </Box>
    );
  }

  // ── DONE SCREEN ───────────────────────────────────────────
  if (!currentLine && !closeDialog && sessionPhase === 'inspect' && inspectMode === 'count') {
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
          {currentLine?.variant_title || currentLine?.sku || currentLine?.description || currentLine?.lasyncro_variant_id?.slice(0, 8) || 'Unknown item'}
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

      {/* ZONE 2 — SCAN MODE or COUNT MODE */}
      <Paper variant="outlined" sx={{ mx: 2, mt: 1.5, p: 2, borderRadius: 2, flex: '0 0 auto' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
            {inspectMode === 'scan' ? 'Scan mode' : 'Inspection count'}
          </Typography>
          {inspectMode === 'scan' && (
            <Box
              onClick={() => { setInspectMode('count'); sessionStorage.setItem(`receive-mode-${receiveJobId}`, 'count'); }}
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5,
                px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500,
                color: 'var(--accent)', border: '0.5px solid var(--accent-border)',
                borderRadius: '6px', cursor: 'pointer',
                '&:hover': { opacity: 0.75 },
              }}
            >
              <Hash size={12} /> Switch to count
            </Box>
          )}
          {inspectMode === 'count' && onResolveBarcode && (
            <Box
              onClick={() => { setInspectMode('scan'); sessionStorage.setItem(`receive-mode-${receiveJobId}`, 'scan'); }}
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5,
                px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500,
                color: 'var(--accent)', border: '0.5px solid var(--accent-border)',
                borderRadius: '6px', cursor: 'pointer',
                '&:hover': { opacity: 0.75 },
              }}
            >
              <ScanBarcode size={12} /> Switch to scan
            </Box>
          )}
        </Box>

        {inspectMode === 'scan' ? (
          <Box>
            {/* SCAN PROGRESS — all lines */}
            <Box sx={{ mb: 2 }}>
              {lines.map((line) => {
                const count = scanCounts[line.receive_job_line_id] ?? 0;
                const isConfirmed = confirmedLines.has(line.receive_job_line_id);
                return (
                  <Box
                    key={line.receive_job_line_id}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1, mb: 0.75,
                      px: 1, py: 0.5, borderRadius: '6px',
                      bgcolor: flashLine === line.receive_job_line_id
                        ? 'rgba(34,197,94,0.15)'
                        : 'transparent',
                      transition: 'background-color 0.4s ease',
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" noWrap color={isConfirmed ? 'success.main' : 'text.primary'} fontWeight={isConfirmed ? 600 : 400}>
                        {line.variant_title && line.variant_title !== 'Default Title'
                          ? line.variant_title
                          : line.description ?? line.sku ?? '—'}
                      </Typography>
                    </Box>
                    <Chip
                      label={`${count} / ${line.quantity_expected}`}
                      size="small"
                      color={isConfirmed ? 'success' : count > 0 ? 'primary' : 'default'}
                      variant={isConfirmed ? 'filled' : 'outlined'}
                    />
                    {isConfirmed && <CheckCircle size={14} color={theme.palette.success.main} />}
                  </Box>
                );
              })}
            </Box>

            {/* RESUME NOTICE — mid-scan progress (not yet confirmed) is lost on refresh */}
            {hasPartialProgress && lines.some(l =>
              !confirmedLines.has(l.receive_job_line_id) &&
              (scanCounts[l.receive_job_line_id] ?? 0) === 0 &&
              !l.inspection_complete
            ) && (
              <Alert severity="info" sx={{ mb: 1.5, py: 0.5, fontSize: 12 }}>
                Session resumed — fully scanned lines are restored. Any partial scans must be re-scanned.
              </Alert>
            )}

            {/* SCAN INPUT */}
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <TextField
                inputRef={scanInputRef}
                fullWidth
                size="small"
                placeholder="Scan barcode or type and press Enter"
                disabled={scanProcessing}
                value={scanInputValue}
                onChange={(e) => setScanInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = scanInputValue.trim();
                    if (val) {
                      void handleScan(val);
                      setScanInputValue('');
                    }
                  }
                }}
                helperText={scanProcessing ? 'Processing...' : 'Scanner auto-submits · manual entry: press Enter or tap Scan'}
                autoComplete="off"
              />
              {scanInputValue.trim() && (
                <Button
                  variant="contained"
                  size="small"
                  disabled={scanProcessing}
                  onClick={() => {
                    const val = scanInputValue.trim();
                    if (val) {
                      void handleScan(val);
                      setScanInputValue('');
                    }
                  }}
                  sx={{
                    bgcolor: 'var(--accent)',
                    '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                    borderRadius: '6px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    mt: 0.25,
                    minWidth: 64,
                  }}
                >
                  Scan
                </Button>
              )}
            </Box>

            {scanError && (
              <Alert severity="error" sx={{ mt: 1, py: 0.5 }} onClose={() => setScanError(null)}>
                {scanError}
              </Alert>
            )}
          </Box>
        ) : (
          <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
            Inspection count
          </Typography>
        )}
        {inspectMode === 'count' && (
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
        )}
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
          disabled={submitting || (inspectMode === 'count' && totalCounted === 0)}
          onClick={() => void handleConfirmBatch()}
          startIcon={<CheckCircle size={20} />}
          sx={{ borderRadius: 2, fontWeight: 700, py: 1.8, fontSize: 16 }}
        >
          {submitting ? 'Confirming...'
            : inspectMode === 'scan' ? 'Finish & Review'
            : isLastLine ? 'Confirm & Finish'
            : 'Confirm Batch'}
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

      {/* SHORTFALL MODAL — forces exception reporting when accepted < expected */}
      <Dialog open={!!shortfallModal} onClose={() => {
        // Only allow close if no exceptions have been committed yet
        if (shortfallModal && shortfallModal.remainingShortfall === shortfallModal.totalShortfall) {
          setShortfallModal(null);
        }
      }} fullWidth maxWidth="sm">
        <DialogTitle>
          {shortfallModal && shortfallModal.remainingShortfall < shortfallModal.totalShortfall
            ? `${shortfallModal.remainingShortfall} unit${shortfallModal.remainingShortfall > 1 ? 's' : ''} still unaccounted`
            : `${shortfallModal?.totalShortfall} unit${(shortfallModal?.totalShortfall ?? 0) > 1 ? 's' : ''} short — what happened?`
          }
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Expected {shortfallModal?.line.quantity_expected}, accepted {shortfallModal?.accepted}.
              Account for all {shortfallModal?.remainingShortfall} unit{(shortfallModal?.remainingShortfall ?? 0) > 1 ? 's' : ''} before continuing.
            </Typography>

            {(Object.keys(EXCEPTION_LABELS) as ExceptionType[]).map((type) => (
              <Button
                key={type}
                variant={shortfallExceptionType === type ? 'contained' : 'outlined'}
                color={type === 'defect' || type === 'wrong_item' ? 'error' : 'warning'}
                fullWidth
                size="large"
                onClick={() => setShortfallExceptionType(type)}
                sx={{ borderRadius: 2, justifyContent: 'flex-start' }}
              >
                {EXCEPTION_LABELS[type]}
              </Button>
            ))}

            {shortfallExceptionType && (
              <TextField
                label={`Qty affected (max ${shortfallModal?.remainingShortfall})`}
                type="number"
                size="small"
                value={shortfallExceptionQty}
                onChange={(e) => {
                  setShortfallExceptionQty(e.target.value);
                  setShortfallQtyError(null);
                }}
                inputProps={{ min: 1, max: shortfallModal?.remainingShortfall }}
                fullWidth
                error={!!shortfallQtyError}
                helperText={shortfallQtyError ?? undefined}
                placeholder={`Enter qty (max ${shortfallModal?.remainingShortfall})`}
              />
            )}

            {(shortfallExceptionType === 'barcode_mismatch' || shortfallExceptionType === 'other') && (
              <TextField
                label={shortfallExceptionType === 'barcode_mismatch' ? 'Scanned barcode value' : 'Notes'}
                value={shortfallExceptionNotes}
                onChange={(e) => setShortfallExceptionNotes(e.target.value)}
                fullWidth
                required
                multiline={shortfallExceptionType === 'other'}
                rows={shortfallExceptionType === 'other' ? 2 : 1}
                placeholder={shortfallExceptionType === 'barcode_mismatch' ? 'Enter the barcode printed on the unit' : 'Describe the problem'}
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
          {shortfallModal && shortfallModal.remainingShortfall === shortfallModal.totalShortfall && (
          <Box
            onClick={() => !shortfallSubmitting && void handleMiscount()}
            sx={{
              display: 'inline-flex', alignItems: 'center',
              px: 1.25, py: 0.5,
              fontSize: 11, fontWeight: 500,
              color: 'var(--accent)',
              border: '0.5px solid var(--accent-border)',
              borderRadius: '6px', cursor: shortfallSubmitting ? 'not-allowed' : 'pointer',
              opacity: shortfallSubmitting ? 0.4 : 1,
              '&:hover': { opacity: shortfallSubmitting ? 0.4 : 0.75 },
            }}
          >
            I miscounted — accept all {shortfallModal?.line.quantity_expected}
          </Box>
          )}
          <Button
            variant="contained"
            disabled={!shortfallExceptionType || shortfallSubmitting}
            onClick={() => void handleShortfallConfirm()}
            sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 600 }}
          >
            {shortfallSubmitting ? 'Saving...' : 'Confirm exception'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* OVERCOUNT DIALOG — scan mode: operator scanned more than expected */}
      <Dialog open={!!overcountLine} fullWidth maxWidth="sm">
        <DialogTitle>Extra unit scanned</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            You've already scanned {overcountLine ? scanCounts[overcountLine.receive_job_line_id] ?? 0 : 0} of {overcountLine?.quantity_expected} expected units
            for <strong>{overcountLine?.variant_title && overcountLine.variant_title !== 'Default Title'
              ? overcountLine.variant_title
              : overcountLine?.description ?? overcountLine?.sku ?? 'this product'}</strong>.
            Add another?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleOvercountReject} color="inherit">No — skip it</Button>
          <Button
            variant="contained"
            onClick={() => void handleOvercountAccept()}
            sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 600 }}
          >
            Yes — add it
          </Button>
        </DialogActions>
      </Dialog>

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