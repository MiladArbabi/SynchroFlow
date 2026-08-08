// modules/wms/src/ui/pages/PickSessionPage.tsx
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
  useTheme,
} from '@mui/material';
import { CheckCircle, AlertTriangle, MapPin, Package, Hash } from 'lucide-react';
import { useScanSourceDetector } from '../hooks/useScanSourceDetector.js';

/**
 * PICK SESSION PAGE — WEBAPP
 * --------------------------
 * Playbook contract: Brief → location_scan → product_scan → summary → done
 *
 * Per line item — two-scan confirm pattern:
 * 1. Brief        — batch summary (items, units), Start Picking CTA
 * 2. location_scan — ScanInput for bin barcode, client-side match against location_code
 * 3. product_scan  — ScanInput for product barcode, resolved via onResolveBarcode
 * 4. summary       — per-line results (picked vs exception), Pick Complete CTA
 * 5. done          — success state
 *
 * Line items are pre-sorted by optimized pick route — iterate in order.
 * No camera. ScanInput pattern only (USB/BT scanner or manual + Enter).
 * Problem Center called on every exception alongside workflow exception endpoint.
 * Session persistence: ?batchId= URL param managed by WmsModuleFT2 (pendingPickBatchId prop).
 *
 * PICK-AUD-01/02 — BarcodeScanSurface + Camera removed entirely
 * PICK-AUD-03    — Brief screen added
 * PICK-AUD-04    — location_scan phase added (two-scan track per item)
 * PICK-AUD-05    — Summary screen added
 * PICK-AUD-06    — Session persistence via WmsModuleFT2 URL param (pendingPickBatchId)
 * PICK-AUD-07    — All async callbacks use .catch(), no void handler()
 * PICK-AUD-08    — No MUI color= props, sx with var(--accent) tokens throughout
 * PICK-AUD-09    — fontWeight max 600
 * PICK-AUD-10    — Full exception taxonomy from Playbook §3
 * PICK-AUD-11    — onCreateProblemTask called on every exception
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LineItem {
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  lasyncro_order_id: string;
  sku: string | null;
  product_title: string;
  variant_title: string | null;
  quantity: number;
  location_code: string;
  /** WEB-PICK-UNIT-01: variant image from Shopify sync; null when not synced. */
  image_url: string | null;
  /** WEB-PICK-UNIT-01: stowed LSU- unit IDs for this variant; null on legacy path. */
  unit_ids: string[] | null;
}

export interface ConfirmScanParams {
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  location_code: string;
  quantity_confirmed: number;
  scan_source?: 'camera' | 'nfc' | 'usb' | 'bt' | 'manual';
  /** WEB-PICK-UNIT-01: LSU- unit ID from resolver; undefined on legacy barcode path. */
  lasyncro_unit_id?: string;
}

export interface ReportExceptionParams {
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  exception_type: string;
  quantity_required: number;
  quantity_found: number;
  notes?: string;
}

export interface CreateProblemTaskParams {
  lasyncro_variant_id: string;
  quantity: number;
  exception_type: string;
  source: 'pick' | 'pack';
  /**
   * BL-05 — links the task to the pick_exceptions row it came from.
   * Without it httpResolveProblemTask cannot resolve back to the exception
   * and the batch alert never clears. Optional: PackSessionPage reports
   * standalone problems that have no pick_exception.
   */
  source_exception_id?: string;
}

export interface PickSessionPageProps {
  pickBatchId: string;
  lineItems: LineItem[];
  onComplete: () => void;
  onResolveBarcode: (scannedValue: string) => Promise<{ lasyncro_variant_id: string; lasyncro_unit_id?: string } | null>;
  onConfirmScan: (params: ConfirmScanParams) => Promise<void>;
  onReportException: (params: ReportExceptionParams) => Promise<{ pick_exception_id: string }>;
  onCreateProblemTask: (params: CreateProblemTaskParams) => Promise<void>;
  onPickComplete: () => Promise<void>;
}

type SessionPhase = 'brief' | 'location_scan' | 'product_scan' | 'qty_confirm' | 'summary' | 'done';

type ExceptionType =
  | 'item_missing'
  | 'short_pick'
  | 'defect'
  | 'packaging_damage'
  | 'wrong_item'
  | 'wrong_variant'
  | 'wrong_quantity'
  | 'barcode_mismatch'
  | 'other';

interface PickResult {
  lineItem: LineItem;
  status: 'picked' | 'exception';
  exceptionType?: ExceptionType;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const EXCEPTION_LABELS: Record<ExceptionType, string> = {
  item_missing:      'Item not found at location',
  short_pick:        'Short pick — fewer units than required',
  defect:            'Product defect',
  packaging_damage:  'Packaging damaged',
  wrong_item:        'Wrong item entirely',
  wrong_variant:     'Wrong variant (size / colour)',
  wrong_quantity:    'Wrong quantity on label',
  barcode_mismatch:  'Barcode mismatch',
  other:             'Other',
};

const NOTES_REQUIRED: ExceptionType[] = ['barcode_mismatch', 'other'];
const QTY_REQUIRED: ExceptionType[] = ['short_pick'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Accept LOC-A-1-3-7 or A-1-3-7 against location_code A-1-3-7 */
function locationMatches(scanned: string, locationCode: string): boolean {
  const n = scanned.trim().toUpperCase();
  const c = locationCode.trim().toUpperCase();
  return n === c || n === `LOC-${c}`;
}

/** "A-1-3-7" → "Lane A · Bin 7" */
function parseLocationLabel(code: string): string {
  const parts = code.split('-');
  if (parts.length >= 2) return `Lane ${parts[0]} · Bin ${parts[parts.length - 1]}`;
  return code;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PickSessionPage({
  pickBatchId,
  lineItems,
  onComplete,
  onResolveBarcode,
  onConfirmScan,
  onReportException,
  onCreateProblemTask,
  onPickComplete,
}: PickSessionPageProps) {
  const theme = useTheme();
  const { onInputChange, detectSourceAndReset, reset: resetScanDetector } = useScanSourceDetector();

  const locationInputRef  = useRef<HTMLInputElement>(null);
  const productInputRef   = useRef<HTMLInputElement>(null);
  const qtyInputRef       = useRef<HTMLInputElement>(null);
  // WEB-PICK-UNIT-01: carries LSU- unit ID from product_scan into qty_confirm path.
  const resolvedUnitIdRef = useRef<string | undefined>(undefined);

  const [phase, setPhase]               = useState<SessionPhase>('brief');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [locationInput, setLocationInput] = useState('');
  const [productInput,  setProductInput]  = useState('');
  const [qtyInput,       setQtyInput]      = useState('');
  const [scanError,      setScanError]     = useState<string | null>(null);
  const [scanProcessing, setScanProcessing] = useState(false);

  const [exceptionDialog,     setExceptionDialog]     = useState(false);
  const [exceptionType,       setExceptionType]       = useState<ExceptionType | null>(null);
  const [exceptionQty,        setExceptionQty]        = useState('');
  const [exceptionNotes,      setExceptionNotes]      = useState('');
  const [exceptionError,      setExceptionError]      = useState<string | null>(null);
  const [exceptionProcessing, setExceptionProcessing] = useState(false);

  const [pickResults,    setPickResults]    = useState<PickResult[]>([]);
  const [completingPick, setCompletingPick] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);

  const currentItem = lineItems[currentIndex];
  const totalUnits  = lineItems.reduce((sum, li) => sum + li.quantity, 0);
  const progress    = lineItems.length > 0 ? Math.round((currentIndex / lineItems.length) * 100) : 0;
  const isLocationPhase = phase === 'location_scan';
  const isProductPhase  = phase === 'product_scan';
  const isQtyPhase      = phase === 'qty_confirm';
  const needsQtyConfirm = (currentItem?.quantity ?? 1) > 1;

  // ── Focus management ───────────────────────────────────────
  useEffect(() => {
    if (phase === 'location_scan') setTimeout(() => locationInputRef.current?.focus(), 50);
    if (phase === 'product_scan')  setTimeout(() => productInputRef.current?.focus(),  50);
    if (phase === 'qty_confirm')   setTimeout(() => qtyInputRef.current?.focus(),      50);
  }, [phase, currentIndex]);

  useEffect(() => {
    if (!scanError) return;
    if (phase === 'location_scan') setTimeout(() => locationInputRef.current?.focus(), 50);
    if (phase === 'product_scan')  setTimeout(() => productInputRef.current?.focus(),  50);
    if (phase === 'qty_confirm')   setTimeout(() => qtyInputRef.current?.focus(),      50);
  }, [scanError, phase]);

  // ── Advance / summary ──────────────────────────────────────
  const advanceOrSummary = useCallback(() => {
    if (currentIndex >= lineItems.length - 1) {
      setPhase('summary');
    } else {
      setCurrentIndex(i => i + 1);
      setLocationInput('');
      setProductInput('');
      setQtyInput('');
      setScanError(null);
      resetScanDetector();
      resolvedUnitIdRef.current = undefined; // WEB-PICK-UNIT-01: clear between items
      setPhase('location_scan');
    }
  }, [currentIndex, lineItems.length, resetScanDetector]);

  // ── Location scan ──────────────────────────────────────────
  const handleLocationScan = useCallback((value: string) => {
    if (!currentItem) return;
    setScanError(null);
    if (locationMatches(value, currentItem.location_code)) {
      setPhase('product_scan');
    } else {
      setScanError(`Wrong location. Expected ${currentItem.location_code} — try again.`);
    }
  }, [currentItem]);

  // ── Product scan ───────────────────────────────────────────
  const handleProductScan = useCallback(async (value: string) => {
    if (!currentItem) return;
    setScanProcessing(true);
    setScanError(null);
    try {
      const result = await onResolveBarcode(value.trim());
      if (result?.lasyncro_variant_id === currentItem.lasyncro_variant_id) {
        resolvedUnitIdRef.current = result.lasyncro_unit_id;
        if (currentItem.quantity > 1) {
          setPhase('qty_confirm');
        } else {
          await onConfirmScan({
            lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
            lasyncro_variant_id:   currentItem.lasyncro_variant_id,
            location_code:         currentItem.location_code,
            quantity_confirmed:    currentItem.quantity,
            scan_source:           detectSourceAndReset(),
            lasyncro_unit_id:      result.lasyncro_unit_id,
          });
          setPickResults(prev => [...prev, { lineItem: currentItem, status: 'picked' }]);
          setTimeout(advanceOrSummary, 400);
        }
      } else {
        setScanError('Wrong item — barcode does not match. Check you are at the right bin.');
      }
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Scan failed. Try again.');
      setScanError(msg);
    } finally {
      setScanProcessing(false);
    }
  }, [currentItem, onResolveBarcode, onConfirmScan, detectSourceAndReset, advanceOrSummary]);

  const handleQtyConfirm = useCallback(() => {
    if (!currentItem) return;
    const entered = parseInt(qtyInput, 10);
    if (isNaN(entered) || entered <= 0) {
      setScanError('Enter a valid quantity.');
      return;
    }
    if (entered !== currentItem.quantity) {
      setScanError(`Expected ${currentItem.quantity} units — recount and try again.`);
      return;
    }
    setScanProcessing(true);
    setScanError(null);
    onConfirmScan({
      lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
      lasyncro_variant_id:   currentItem.lasyncro_variant_id,
      location_code:         currentItem.location_code,
      quantity_confirmed:    currentItem.quantity,
      scan_source:           detectSourceAndReset(),
      lasyncro_unit_id:      resolvedUnitIdRef.current,
    })
      .then(() => {
        setPickResults(prev => [...prev, { lineItem: currentItem, status: 'picked' }]);
        setQtyInput('');
        setTimeout(advanceOrSummary, 400);
      })
      .catch((err: unknown) => {
        const msg = (err as any)?.response?.data?.error ?? 'Confirm failed. Try again.';
        setScanError(msg);
      })
      .finally(() => setScanProcessing(false));
  }, [currentItem, qtyInput, onConfirmScan, detectSourceAndReset, advanceOrSummary]);

  // ── Exception report ───────────────────────────────────────
  const handleReportException = useCallback(() => {
    if (!currentItem || !exceptionType) return;
    if (QTY_REQUIRED.includes(exceptionType) && !exceptionQty.trim()) {
      setExceptionError('Enter the quantity found.');
      return;
    }
    if (NOTES_REQUIRED.includes(exceptionType) && !exceptionNotes.trim()) {
      setExceptionError('Notes are required for this exception type.');
      return;
    }
    setExceptionProcessing(true);
    setExceptionError(null);
    const qtyFound = exceptionType === 'short_pick' ? (parseInt(exceptionQty, 10) || 0) : 0;

    onReportException({
      lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
      lasyncro_variant_id:   currentItem.lasyncro_variant_id,
      exception_type:        exceptionType,
      quantity_required:     currentItem.quantity,
      quantity_found:        qtyFound,
      notes:                 exceptionNotes.trim() || undefined,
    })
      .then((reported) =>
        onCreateProblemTask({
          lasyncro_variant_id: currentItem.lasyncro_variant_id,
          quantity:            currentItem.quantity - qtyFound,
          exception_type:      exceptionType,
          source:              'pick',
          source_exception_id: reported?.pick_exception_id,
        })
      )
      .then(() => {
        setPickResults(prev => [...prev, { lineItem: currentItem, status: 'exception', exceptionType }]);
        setExceptionDialog(false);
        setExceptionType(null);
        setExceptionQty('');
        setExceptionNotes('');
        advanceOrSummary();
      })
      .catch((err: unknown) => {
        const msg = (err as any)?.response?.data?.error ?? 'Exception report failed. Try again.';
        setExceptionError(msg);
      })
      .finally(() => setExceptionProcessing(false));
  }, [currentItem, exceptionType, exceptionQty, exceptionNotes, onReportException, onCreateProblemTask, advanceOrSummary]);

  // ── Pick complete ──────────────────────────────────────────
  const handlePickComplete = useCallback(() => {
    setCompletingPick(true);
    setCompletionError(null);
    onPickComplete()
      .then(() => {
        setPhase('done');
        setTimeout(onComplete, 1200);
      })
      .catch((err: unknown) => {
        const msg = (err as any)?.response?.data?.error ?? 'Pick complete failed. Retry when connection is restored.';
        setCompletionError(msg);
        setCompletingPick(false);
      });
  }, [onPickComplete, onComplete]);

  const openExceptionDialog = useCallback(() => {
    setExceptionType(null);
    setExceptionQty('');
    setExceptionNotes('');
    setExceptionError(null);
    setExceptionDialog(true);
  }, []);

  // ── BRIEF ──────────────────────────────────────────────────
  if (phase === 'brief') {
    return (
      <Box sx={{ p: 2, maxWidth: 480, mx: 'auto' }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>
          Pick Session
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Batch {pickBatchId.slice(-6).toUpperCase()}
        </Typography>

        <Paper variant="outlined" sx={{ borderRadius: 2, p: 2, mb: 2, display: 'flex', gap: 2 }}>
          <Box sx={{ flex: 1, textAlign: 'center' }}>
            <Typography variant="h4" fontWeight={600}>{lineItems.length}</Typography>
            <Typography variant="caption" color="text.secondary">Line items</Typography>
          </Box>
          <Box sx={{ flex: 1, textAlign: 'center' }}>
            <Typography variant="h4" fontWeight={600}>{totalUnits}</Typography>
            <Typography variant="caption" color="text.secondary">Total units</Typography>
          </Box>
        </Paper>

        <Alert icon={false} sx={{ mb: 3, borderRadius: 2 }}>
          Items are sorted by optimized pick route. For each item: scan the bin barcode first, then scan the product barcode to confirm.
        </Alert>

        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={() => setPhase('location_scan')}
          sx={{
            borderRadius: '6px',
            fontWeight: 600,
            bgcolor: 'var(--accent)',
            '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
          }}
        >
          Start Picking
        </Button>
      </Box>
    );
  }

  // ── SUMMARY ────────────────────────────────────────────────
  if (phase === 'summary') {
    const pickedCount    = pickResults.filter(r => r.status === 'picked').length;
    const exceptionCount = pickResults.filter(r => r.status === 'exception').length;

    return (
      <Box sx={{ p: 2, maxWidth: 480, mx: 'auto' }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>
          Pick Summary
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Review before confirming
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
          <Paper variant="outlined" sx={{ flex: 1, borderRadius: 2, p: 1.5, textAlign: 'center' }}>
            <Typography variant="h5" fontWeight={600} color="success.main">{pickedCount}</Typography>
            <Typography variant="caption" color="text.secondary">Picked</Typography>
          </Paper>
          {exceptionCount > 0 && (
            <Paper variant="outlined" sx={{ flex: 1, borderRadius: 2, p: 1.5, textAlign: 'center' }}>
              <Typography variant="h5" fontWeight={600} color="warning.main">{exceptionCount}</Typography>
              <Typography variant="caption" color="text.secondary">Exceptions</Typography>
            </Paper>
          )}
        </Box>

        {exceptionCount > 0 && (
          <Alert icon={false} severity="warning" sx={{ mb: 2, borderRadius: 2 }}>
            {exceptionCount} item{exceptionCount > 1 ? 's' : ''} reported as exceptions — routed to Problem Center.
          </Alert>
        )}

        <Box sx={{ mb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {pickResults.map(({ lineItem, status, exceptionType: et }) => (
            <Paper
              key={lineItem.lasyncro_line_item_id}
              variant="outlined"
              sx={{ borderRadius: 2, p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}
            >
              {status === 'picked' ? (
                <CheckCircle size={18} color={theme.palette.success.main} />
              ) : (
                <AlertTriangle size={18} color={theme.palette.warning.main} />
              )}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={500} noWrap>{lineItem.product_title}</Typography>
                {lineItem.variant_title && (
                  <Typography variant="caption" color="text.secondary">{lineItem.variant_title}</Typography>
                )}
              </Box>
              <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', display: 'block' }}>
                  {lineItem.location_code}
                </Typography>
                {status === 'exception' && et && (
                  <Typography variant="caption" color="warning.main" display="block">
                    {EXCEPTION_LABELS[et]}
                  </Typography>
                )}
              </Box>
            </Paper>
          ))}
        </Box>

        {completionError && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{completionError}</Alert>
        )}

        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={handlePickComplete}
          disabled={completingPick}
          sx={{
            borderRadius: '6px',
            fontWeight: 600,
            bgcolor: 'var(--accent)',
            '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
          }}
        >
          {completingPick ? 'Confirming…' : 'Confirm Pick Complete'}
        </Button>
      </Box>
    );
  }

  // ── DONE ───────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <Box sx={{
        height: '100dvh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        p: 3,
      }}>
        <CheckCircle size={56} color={theme.palette.success.main} />
        <Typography variant="h6" fontWeight={600} sx={{ mt: 2 }}>Pick Complete</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>
          {lineItems.length} items processed. Batch ready for pack.
        </Typography>
      </Box>
    );
  }

  // ── INSPECT PHASES (location_scan + product_scan) ──────────
  if (!currentItem) return null;

  const variantPills = currentItem.variant_title
    ? currentItem.variant_title.split('/').map(s => s.trim()).filter(Boolean)
    : [];

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* PROGRESS */}
      <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            Item {currentIndex + 1} of {lineItems.length}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Batch {pickBatchId.slice(-6).toUpperCase()}
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{
            borderRadius: 1, height: 3,
            bgcolor: 'action.hover',
            '& .MuiLinearProgress-bar': { bgcolor: 'var(--accent)' },
          }}
        />
      </Box>

      {/* STEP ORIENTATION BANNER */}
      <Alert
        icon={false}
        sx={{ mx: 2, mt: 1, py: 0.5, borderRadius: 2, fontSize: 12 }}
      >
        {isLocationPhase
          ? `Step 1 of ${needsQtyConfirm ? 3 : 2} — Walk to the location and scan the bin barcode.`
          : isProductPhase
          ? `Step 2 of ${needsQtyConfirm ? 3 : 2} — Find the item and scan the product barcode.`
          : 'Step 3 of 3 — Count the units and confirm the quantity.'}
      </Alert>

      {/* TRACK CARD — 2 nodes (qty=1) or 3 nodes (qty>1) */}
      <Paper
        variant="outlined"
        sx={{ mx: 2, mt: 1.5, p: 2, borderRadius: 2, bgcolor: 'background.default' }}
      >
        <Box sx={{ position: 'relative', height: 100 }}>

          {/* Background line */}
          <Box sx={{
            position: 'absolute', left: 0, right: 0, top: 19,
            height: 3, bgcolor: 'action.disabledBackground', borderRadius: 1, overflow: 'hidden',
          }}>
            <Box sx={{
              height: '100%',
              width: isLocationPhase ? '0%'
                   : isProductPhase  ? (needsQtyConfirm ? '50%' : '66%')
                   : isQtyPhase      ? '75%'
                   : '100%',
              bgcolor: theme.palette.success.main,
              borderRadius: 1,
              transition: 'width 0.55s ease',
            }} />
          </Box>

          {/* Node 1 — Location */}
          <Box sx={{ position: 'absolute', left: needsQtyConfirm ? 'calc(25% - 20px)' : 'calc(33% - 20px)', top: 0, width: 40 }}>
            <Box sx={{
              width: 40, height: 40, borderRadius: '50%',
              bgcolor: isLocationPhase ? 'var(--accent)' : theme.palette.success.main,
              border: `2.5px solid ${isLocationPhase ? 'var(--accent)' : theme.palette.success.main}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.3s, border-color 0.3s',
              ...(isLocationPhase && {
                '@keyframes pickNodePulse': {
                  '0%':   { boxShadow: '0 0 0 0 rgba(255,107,43,0.55)' },
                  '70%':  { boxShadow: '0 0 0 10px rgba(255,107,43,0)' },
                  '100%': { boxShadow: '0 0 0 0 rgba(255,107,43,0)' },
                },
                animation: 'pickNodePulse 1.3s ease-out infinite',
              }),
            }}>
              {isLocationPhase ? <MapPin size={18} color="white" /> : <CheckCircle size={18} color="white" />}
            </Box>
          </Box>
          <Box sx={{ position: 'absolute', left: needsQtyConfirm ? 'calc(25% - 50px)' : 'calc(33% - 50px)', top: 48, width: 100, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: isLocationPhase ? 'var(--accent)' : theme.palette.success.main, mb: 0.5, transition: 'color 0.3s' }}>
              {isLocationPhase ? 'Scan Location' : '✓ Confirmed'}
            </Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 500, fontFamily: 'monospace', color: 'text.primary' }}>
              {currentItem.location_code}
            </Typography>
          </Box>

          {/* Node 2 — Product */}
          <Box sx={{ position: 'absolute', left: needsQtyConfirm ? 'calc(50% - 20px)' : 'calc(66% - 20px)', top: 0, width: 40 }}>
            <Box sx={{
              width: 40, height: 40, borderRadius: '50%',
              bgcolor: isLocationPhase ? 'background.paper' : isProductPhase ? 'var(--accent)' : theme.palette.success.main,
              border: `2.5px solid ${isLocationPhase ? theme.palette.divider : isProductPhase ? 'var(--accent)' : theme.palette.success.main}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.3s, border-color 0.3s',
              ...(isProductPhase && {
                '@keyframes pickNodePulse': {
                  '0%':   { boxShadow: '0 0 0 0 rgba(255,107,43,0.55)' },
                  '70%':  { boxShadow: '0 0 0 10px rgba(255,107,43,0)' },
                  '100%': { boxShadow: '0 0 0 0 rgba(255,107,43,0)' },
                },
                animation: 'pickNodePulse 1.3s ease-out infinite',
              }),
            }}>
              {isLocationPhase
                ? <Package size={18} color={theme.palette.text.disabled} />
                : isProductPhase
                ? <Package size={18} color="white" />
                : <CheckCircle size={18} color="white" />}
            </Box>
          </Box>
          <Box sx={{ position: 'absolute', left: needsQtyConfirm ? 'calc(50% - 50px)' : 'calc(66% - 50px)', top: 48, width: 100, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: isLocationPhase ? 'text.disabled' : isProductPhase ? 'var(--accent)' : theme.palette.success.main, mb: 0.5, transition: 'color 0.3s' }}>
              {isLocationPhase ? 'Up next' : isProductPhase ? 'Scan Item' : '✓ Confirmed'}
            </Typography>

              <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'text.primary', lineHeight: 1.3 }} noWrap>
                {currentItem.product_title}
              </Typography>
               {(currentItem.unit_ids ?? []).length > 0 && (
                <Box sx={{ mt: 0.5, display: 'flex', justifyContent: 'center' }}>
                  <Box sx={{ fontSize: 9, px: 0.75, py: 0.25, border: '0.5px solid', borderColor: 'var(--accent)', borderRadius: '3px', fontFamily: 'monospace', color: 'var(--accent)', bgcolor: 'background.paper' }}>
                    {currentItem.unit_ids![0]}
                  </Box>
                </Box>
              )}
            </Box>

          {/* Node 3 — Qty confirm (only when qty > 1) */}
          {needsQtyConfirm && (
            <>
              <Box sx={{ position: 'absolute', left: 'calc(75% - 20px)', top: 0, width: 40 }}>
                <Box sx={{
                  width: 40, height: 40, borderRadius: '50%',
                  bgcolor: isQtyPhase ? 'var(--accent)' : 'background.paper',
                  border: `2.5px solid ${isQtyPhase ? 'var(--accent)' : theme.palette.divider}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.3s, border-color 0.3s',
                  ...(isQtyPhase && {
                    '@keyframes pickNodePulse': {
                      '0%':   { boxShadow: '0 0 0 0 rgba(255,107,43,0.55)' },
                      '70%':  { boxShadow: '0 0 0 10px rgba(255,107,43,0)' },
                      '100%': { boxShadow: '0 0 0 0 rgba(255,107,43,0)' },
                    },
                    animation: 'pickNodePulse 1.3s ease-out infinite',
                  }),
                }}>
                  <Hash size={18} color={isQtyPhase ? 'white' : theme.palette.text.disabled} />
                </Box>
              </Box>
              <Box sx={{ position: 'absolute', left: 'calc(75% - 50px)', top: 48, width: 100, textAlign: 'center' }}>
                <Typography sx={{ fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: isQtyPhase ? 'var(--accent)' : 'text.disabled', mb: 0.5, transition: 'color 0.3s' }}>
                  {isQtyPhase ? 'Confirm Qty' : 'Up next'}
                </Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.primary' }}>
                  ×{currentItem.quantity}
                </Typography>
              </Box>
            </>
          )}
          </Box>
        </Paper>

      {/* PRODUCT INFO CARD — visible during product_scan + qty_confirm phases */}
      {(isProductPhase || isQtyPhase) && (
        <Paper variant="outlined" sx={{ mx: 2, mt: 1.5, borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ p: 1.5, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
            {currentItem.image_url ? (
              <Box
                component="img"
                src={currentItem.image_url}
                alt={currentItem.product_title}
                sx={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
              />
            ) : (
              <Box sx={{ width: 56, height: 56, borderRadius: 1, bgcolor: 'action.hover', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Package size={22} color="var(--ink3, #9ca3af)" />
              </Box>
            )}
            {/* Details */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }} noWrap>
                {currentItem.product_title}
              </Typography>
              {currentItem.variant_title && (
                <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.25 }} noWrap>
                  {currentItem.variant_title}
                </Typography>
              )}
              {/* Location */}
              <Box sx={{ mt: 0.75, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <MapPin size={11} color="var(--accent)" />
                <Typography sx={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 500 }}>
                  {currentItem.location_code}
                </Typography>
              </Box>
              {/* LSU- unit IDs */}
              {(currentItem.unit_ids ?? []).length > 0 && (
                <Box sx={{ mt: 0.75 }}>
                  <Typography sx={{ fontSize: 9, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: '0.07em', mb: 0.5 }}>
                    LSU- codes for this pick
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {(currentItem.unit_ids ?? []).slice(0, 6).map((id) => (
                      <Box key={id} sx={{ fontSize: 9, px: 0.75, py: 0.25, border: '0.5px solid', borderColor: 'divider', borderRadius: '3px', fontFamily: 'monospace', color: 'text.secondary', bgcolor: 'background.paper' }}>
                        {id}
                      </Box>
                    ))}
                    {(currentItem.unit_ids ?? []).length > 6 && (
                      <Box sx={{ fontSize: 9, px: 0.75, py: 0.25, border: '0.5px solid', borderColor: 'divider', borderRadius: '3px', color: 'text.disabled', bgcolor: 'background.paper' }}>
                        +{(currentItem.unit_ids ?? []).length - 6} more
                      </Box>
                    )}
                  </Box>
                </Box>
              )}
              {currentItem.sku && (
                <Typography sx={{ fontSize: 9, color: 'text.disabled', fontFamily: 'monospace', mt: 0.75 }}>
                  SKU: {currentItem.sku}
                </Typography>
              )}
            </Box>
          </Box>
        </Paper>
      )}
      
      {/* SCAN AREA */}
      <Box sx={{ mx: 2, mt: 1.5, flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>

        {scanError && (
          <Alert severity="error" sx={{ borderRadius: 2, py: 0.5 }}>{scanError}</Alert>
        )}

        {/* LOCATION SCAN INPUT */}
        {isLocationPhase && (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              inputRef={locationInputRef}
              fullWidth
              size="small"
              type="text"
              placeholder="Scan bin barcode or type location code"
              disabled={scanProcessing}
              value={locationInput}
              onChange={(e) => { setLocationInput(e.target.value); onInputChange(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && locationInput.trim()) {
                  const val = locationInput.trim();
                  setLocationInput('');
                  handleLocationScan(val);
                }
              }}
              helperText="Scanner auto-submits · manual entry: press Enter"
              autoComplete="off"
            />
            {locationInput.trim() && (
              <Button
                variant="contained"
                onClick={() => {
                  const val = locationInput.trim();
                  setLocationInput('');
                  handleLocationScan(val);
                }}
                sx={{
                  bgcolor: 'var(--accent)', borderRadius: '6px', fontWeight: 600,
                  '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                  flexShrink: 0,
                }}
              >
                Scan
              </Button>
            )}
          </Box>
        )}

        {/* PRODUCT SCAN INPUT */}
        {isProductPhase && (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              inputRef={productInputRef}
              fullWidth
              size="small"
              type="text"
              placeholder="Scan product barcode or type barcode value"
              disabled={scanProcessing}
              value={productInput}
              onChange={(e) => { setProductInput(e.target.value); onInputChange(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && productInput.trim()) {
                  const val = productInput.trim();
                  setProductInput('');
                  handleProductScan(val).catch((err: unknown) => {
                    const msg = (err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Scan failed.');
                    setScanError(msg);
                  });
                }
              }}
              helperText="Scanner auto-submits · manual entry: press Enter"
              autoComplete="off"
            />
            {productInput.trim() && (
              <Button
                variant="contained"
                disabled={scanProcessing}
                onClick={() => {
                  const val = productInput.trim();
                  setProductInput('');
                  handleProductScan(val).catch((err: unknown) => {
                    const msg = (err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Scan failed.');
                    setScanError(msg);
                  });
                }}
                sx={{
                  bgcolor: 'var(--accent)', borderRadius: '6px', fontWeight: 600,
                  '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                  flexShrink: 0,
                }}
              >
                {scanProcessing ? '…' : 'Scan'}
              </Button>
            )}
          </Box>
        )}

        {/* QTY CONFIRM INPUT */}
        {isQtyPhase && (
          <Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                inputRef={qtyInputRef}
                fullWidth
                size="small"
                type="number"
                placeholder={`Count and enter qty (expected: ${currentItem.quantity})`}
                disabled={scanProcessing}
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && qtyInput.trim()) handleQtyConfirm();
                }}
                inputProps={{ min: 1 }}
                helperText={`Expected ${currentItem.quantity} unit${currentItem.quantity > 1 ? 's' : ''} — count before confirming`}
                autoComplete="off"
              />
              <Button
                variant="contained"
                disabled={scanProcessing || !qtyInput.trim()}
                onClick={handleQtyConfirm}
                sx={{
                  bgcolor: 'var(--accent)', borderRadius: '6px', fontWeight: 600,
                  '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                  flexShrink: 0,
                }}
              >
                {scanProcessing ? '…' : 'Confirm'}
              </Button>
            </Box>
          </Box>
        )}

        {/* REPORT PROBLEM */}
        <Button
          variant="outlined"
          fullWidth
          size="large"
          startIcon={<AlertTriangle size={18} />}
          onClick={openExceptionDialog}
          sx={{
            borderRadius: '6px', fontWeight: 600,
            borderColor: 'var(--accent-border)', color: 'var(--accent)',
            '&:hover': { borderColor: 'var(--accent)', bgcolor: 'var(--accent-ghost)' },
          }}
        >
          Report problem
        </Button>

      </Box>

      {/* EXCEPTION DIALOG — non-dismissible (Playbook §3) */}
      <Dialog open={exceptionDialog} onClose={() => undefined} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 600, fontSize: 16 }}>Report Problem</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {currentItem?.product_title}
            {currentItem?.variant_title ? ` · ${currentItem.variant_title}` : ''}
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 2 }}>
            {(Object.keys(EXCEPTION_LABELS) as ExceptionType[]).map((type) => (
              <Button
                key={type}
                variant={exceptionType === type ? 'contained' : 'outlined'}
                fullWidth
                size="small"
                onClick={() => { setExceptionType(type); setExceptionError(null); }}
                sx={{
                  justifyContent: 'flex-start',
                  borderRadius: '6px',
                  fontWeight: exceptionType === type ? 600 : 400,
                  fontSize: 12,
                  bgcolor:     exceptionType === type ? 'var(--accent)' : 'transparent',
                  borderColor: exceptionType === type ? 'var(--accent)' : 'divider',
                  color:       exceptionType === type ? 'white' : 'text.primary',
                  '&:hover': {
                    bgcolor:     exceptionType === type ? 'var(--accent)' : 'action.hover',
                    opacity:     exceptionType === type ? 0.88 : 1,
                    borderColor: exceptionType === type ? 'var(--accent)' : 'divider',
                  },
                }}
              >
                {EXCEPTION_LABELS[type]}
              </Button>
            ))}
          </Box>

          {exceptionType && QTY_REQUIRED.includes(exceptionType) && (
            <TextField
              label="Quantity found"
              type="number"
              size="small"
              fullWidth
              value={exceptionQty}
              onChange={(e) => setExceptionQty(e.target.value)}
              inputProps={{ min: 0, max: currentItem ? currentItem.quantity - 1 : 99 }}
              sx={{ mb: 1.5 }}
            />
          )}

          {exceptionType && NOTES_REQUIRED.includes(exceptionType) && (
            <TextField
              label="Notes (required)"
              size="small"
              fullWidth
              multiline
              rows={2}
              value={exceptionNotes}
              onChange={(e) => setExceptionNotes(e.target.value)}
              sx={{ mb: 1.5 }}
            />
          )}

          {exceptionError && (
            <Alert severity="error" sx={{ borderRadius: 2 }}>{exceptionError}</Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          {/* Miscount escape hatch — ghost pill, subdued (Playbook §3) */}
          <Button
            onClick={() => setExceptionDialog(false)}
            sx={{
              color: 'text.secondary', fontWeight: 400, fontSize: 12,
              borderRadius: '6px', border: '0.5px solid var(--accent-border)',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleReportException}
            disabled={!exceptionType || exceptionProcessing}
            sx={{
              borderRadius: '6px', fontWeight: 600,
              bgcolor: 'var(--accent)',
              '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
            }}
          >
            {exceptionProcessing ? 'Reporting…' : 'Confirm Exception'}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}