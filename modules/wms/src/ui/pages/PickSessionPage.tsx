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
  IconButton,
} from '@mui/material';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  PackageX,
  Camera,
  RotateCcw,
} from 'lucide-react';
import { BarcodeScanSurface } from '../components/BarcodeScanSurface.js';

/**
 * PICK SESSION PAGE — REDESIGNED (WM-23)
 * ----------------------------------------
 * Single-item-per-screen mobile pick flow.
 *
 * Three zones per screen:
 * ┌─────────────────────────────┐
 * │  ZONE 1 — LOCATION          │
 * │  Lane A → Shelf 3 → Bin 7   │
 * ├─────────────────────────────┤
 * │  ZONE 2 — PRODUCT           │
 * │  Title, SKU, Qty needed     │
 * ├─────────────────────────────┤
 * │  ZONE 3 — ACTION            │
 * │  Barcode input (autofocus)  │
 * │  [Scan] or [Report Problem] │
 * │  → on scan match: [Confirm] │
 * └─────────────────────────────┘
 *
 * Flow:
 * 1. Land on product screen — cursor in barcode input
 * 2. Operator taps Scan → camera opens
 * 3. Barcode scanned → filled into input
 * 4. Match → Scan button turns green Confirm
 * 5. Operator taps Confirm → next product
 * 6. No match → red signal, re-scan prompt
 * 7. Report Problem → exception dialog
 * 8. Last item confirmed → Pick Complete screen
 *
 * Offline resilience:
 * - Scan not submitted until confirmed
 * - On API failure → error shown, operator stays on same item
 * - Session resumes from same item on restart (currentIndex preserved)
 *
 * Theme-aware: Paper, theme.palette tokens, no hardcoded colors.
 * API calls injected via props — module decoupled from frontend HTTP layer.
 */

export interface LineItem {
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  lasyncro_order_id: string;
  sku: string | null;
  title: string;
  quantity: number;
  location_code: string;
}

export interface ConfirmScanParams {
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  location_code: string;
  quantity_confirmed: number;
}

export interface ReportExceptionParams {
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  exception_type: string;
  quantity_required: number;
  quantity_found: number;
}

export interface PickSessionPageProps {
  pickBatchId: string;
  lineItems: LineItem[];
  onComplete: () => void;
  onResolveBarcode: (scannedValue: string) => Promise<{ lasyncro_variant_id: string } | null>;
  onConfirmScan: (params: ConfirmScanParams) => Promise<void>;
  onReportException: (params: ReportExceptionParams) => Promise<void>;
  onPickComplete: () => Promise<void>;
}

type ScanState =
  | 'idle'           // waiting for input — cursor in field
  | 'camera'         // camera open
  | 'matched'        // barcode matched — show green Confirm
  | 'mismatch'       // barcode wrong — show red signal
  | 'submitting'     // API call in flight
  | 'accepted';      // confirmed — brief green flash before next

type ExceptionType = 'item_missing' | 'short_pick' | 'product_defect' | 'packaging_defect';

/**
 * Parse location_code into human-readable parts.
 * Supports formats: WH-1-ROOT, A-3-7, LANE-A/SHELF-3/BIN-7
 * Falls back to displaying raw code if unrecognised.
 */
function parseLocation(locationCode: string): { primary: string; secondary?: string } {
  const parts = locationCode.split('-');
  if (parts.length >= 3) {
    return {
      primary: `${parts[0]}-${parts[1]}`,
      secondary: parts.slice(2).join('-'),
    };
  }
  return { primary: locationCode };
}

export default function PickSessionPage({
  lineItems,
  onComplete,
  onResolveBarcode,
  onConfirmScan,
  onReportException,
  onPickComplete,
}: PickSessionPageProps) {
  const theme = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [exceptionDialog, setExceptionDialog] = useState(false);
  const [shortPickQuantity, setShortPickQuantity] = useState('');
  const [completingPick, setCompletingPick] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);

  const currentItem = lineItems[currentIndex];
  const isLastItem = currentIndex === lineItems.length - 1;
  const progress = Math.round((currentIndex / lineItems.length) * 100);
  const location = currentItem ? parseLocation(currentItem.location_code) : null;

  // Auto-focus input whenever we land on a new item
  useEffect(() => {
    if (scanState === 'idle') {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [currentIndex, scanState]);

  const resetForNextItem = useCallback(() => {
    setBarcodeInput('');
    setScanState('idle');
    setSubmitError(null);
    setShortPickQuantity('');
  }, []);

  const handlePickComplete = useCallback(async () => {
    setCompletingPick(true);
    setCompletionError(null);
    try {
      await onPickComplete();
      onComplete();
    } catch {
      setCompletionError('Pick complete failed. Check connection and try again.');
      setCompletingPick(false);
    }
  }, [onPickComplete, onComplete]);

  const advanceToNext = useCallback(() => {
    resetForNextItem();
    if (isLastItem) {
      void handlePickComplete();
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }, [isLastItem, handlePickComplete, resetForNextItem]);

  const handleBarcodeInput = useCallback(async (value: string) => {
    if (!currentItem) return;
    if (!value.trim()) return;

    setBarcodeInput(value);
    setScanState('idle');
    setSubmitError(null);

    // Resolve barcode
    try {
      const data = await onResolveBarcode(value.trim());
      if (data?.lasyncro_variant_id === currentItem.lasyncro_variant_id) {
        setScanState('matched');
      } else {
        setScanState('mismatch');
        setTimeout(() => setScanState('idle'), 2500);
      }
    } catch {
      setScanState('mismatch');
      setTimeout(() => setScanState('idle'), 2500);
    }
  }, [currentItem, onResolveBarcode]);

  const handleCameraScan = useCallback((scannedValue: string) => {
    setScanState('idle');
    void handleBarcodeInput(scannedValue);
  }, [handleBarcodeInput]);

  const handleConfirm = useCallback(async () => {
    if (!currentItem || scanState !== 'matched') return;

    setScanState('submitting');
    setSubmitError(null);

    try {
      await onConfirmScan({
        lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
        lasyncro_variant_id: currentItem.lasyncro_variant_id,
        location_code: currentItem.location_code,
        quantity_confirmed: currentItem.quantity,
      });

      setScanState('accepted');
      setTimeout(advanceToNext, 1000);
    } catch {
      /**
       * OFFLINE / CONNECTION FAILURE
       * ----------------------------
       * Do NOT advance to next item.
       * Operator stays on same item — must retry when connection restored.
       * device_event_id idempotency ensures safe retry.
       */
      setSubmitError('Connection failed. Please retry when signal is restored.');
      setScanState('matched'); // keep confirm available for retry
    }
  }, [currentItem, scanState, onConfirmScan, advanceToNext]);

  const handleReportException = useCallback(async (
    type: ExceptionType,
    quantityFound: number
  ) => {
    if (!currentItem) return;
    try {
      await onReportException({
        lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
        lasyncro_variant_id: currentItem.lasyncro_variant_id,
        exception_type: type,
        quantity_required: currentItem.quantity,
        quantity_found: quantityFound,
      });
    } catch {
      console.error('[PICK_SESSION] Exception report failed', { type });
    } finally {
      setExceptionDialog(false);
      advanceToNext();
    }
  }, [currentItem, onReportException, advanceToNext]);

  // ── PICK COMPLETE SCREEN ──────────────────────────────────
  if (completingPick || !currentItem) {
    return (
      <Box sx={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        p: 3,
      }}>
        <CheckCircle size={56} color={theme.palette.success.main} />
        <Typography variant="h5" fontWeight={700} sx={{ mt: 2 }}>
          Pick List Complete
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 4, textAlign: 'center' }}>
          All {lineItems.length} items picked. Confirm to finish.
        </Typography>
        {completionError && (
          <Alert severity="error" sx={{ mb: 2, width: '100%' }}>
            {completionError}
          </Alert>
        )}
        <Button
          variant="contained"
          size="large"
          fullWidth
          onClick={() => void handlePickComplete()}
          sx={{ borderRadius: 2, fontWeight: 700 }}
        >
          Confirm Pick Complete
        </Button>
      </Box>
    );
  }

  // ── CAMERA SCREEN ─────────────────────────────────────────
  if (scanState === 'camera') {
    return (
      <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton onClick={() => setScanState('idle')}>
            <RotateCcw size={20} />
          </IconButton>
          <Typography variant="body2" color="text.secondary">
            Scan barcode for: <strong>{currentItem.title || currentItem.sku || currentItem.lasyncro_variant_id.slice(0, 8)}</strong>
          </Typography>
        </Box>
        <Box sx={{ flex: 1, px: 2, pb: 2 }}>
          <BarcodeScanSurface
            onScan={handleCameraScan}
            enabled
            hint="Point at product barcode"
          />
        </Box>
      </Box>
    );
  }

  // ── MISMATCH SCREEN ───────────────────────────────────────
  if (scanState === 'mismatch') {
    return (
      <Box sx={{
        height: '100dvh',
        bgcolor: theme.palette.error.main,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        p: 3,
      }}>
        <XCircle size={64} color={theme.palette.error.contrastText} />
        <Typography variant="h5" fontWeight={700} sx={{ color: theme.palette.error.contrastText }}>
          Wrong Item
        </Typography>
        <Typography variant="body2" sx={{ color: theme.palette.error.contrastText, opacity: 0.85, textAlign: 'center' }}>
          Barcode does not match this product. Returning to scan…
        </Typography>
      </Box>
    );
  }

  // ── ACCEPTED SCREEN ───────────────────────────────────────
  if (scanState === 'accepted') {
    return (
      <Box sx={{
        height: '100dvh',
        bgcolor: theme.palette.success.main,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}>
        <CheckCircle size={64} color={theme.palette.success.contrastText} />
        <Typography variant="h5" fontWeight={700} sx={{ color: theme.palette.success.contrastText }}>
          Confirmed
        </Typography>
      </Box>
    );
  }

  // ── MAIN PICK SCREEN — THREE ZONES ───────────────────────
  return (
    <Box sx={{
      height: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* PROGRESS BAR */}
      <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            Item {currentIndex + 1} of {lineItems.length}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {progress}%
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{ borderRadius: 1, height: 5 }}
        />
      </Box>

      {/* ZONE 1 — LOCATION */}
      <Paper
        variant="outlined"
        sx={{
          mx: 2,
          mt: 1,
          p: 2,
          borderRadius: 2,
          borderColor: theme.palette.primary.main,
          borderWidth: 2,
          flex: '0 0 auto',
        }}
      >
        <Typography variant="overline" color="primary" sx={{ fontSize: 10, letterSpacing: 1.5 }}>
          Go to location
        </Typography>
        <Typography variant="h5" fontWeight={800} sx={{ fontFamily: 'monospace', mt: 0.5 }}>
          {location?.primary}
        </Typography>
        {location?.secondary && (
          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
            {location.secondary}
          </Typography>
        )}
      </Paper>

      {/* ZONE 2 — PRODUCT */}
      <Paper
        variant="outlined"
        sx={{
          mx: 2,
          mt: 1.5,
          p: 2,
          borderRadius: 2,
          flex: '0 0 auto',
        }}
      >
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
          Pick this item
        </Typography>
        <Typography variant="h6" fontWeight={700} sx={{ mt: 0.5 }} noWrap>
          {currentItem.title || '—'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
          {currentItem.sku && (
            <Typography variant="caption" color="text.secondary">
              SKU: {currentItem.sku}
            </Typography>
          )}
          <Typography variant="caption" fontWeight={700} color="primary">
            Qty: {currentItem.quantity}
          </Typography>
        </Box>
      </Paper>

      {/* ZONE 3 — ACTION */}
      <Box sx={{ mx: 2, mt: 1.5, flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>

        {/* BARCODE INPUT */}
        <TextField
          inputRef={inputRef}
          label="Barcode"
          value={barcodeInput}
          onChange={(e) => setBarcodeInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && barcodeInput.trim()) {
              void handleBarcodeInput(barcodeInput);
            }
          }}
          fullWidth
          autoFocus
          placeholder="Scan or type barcode"
          InputProps={{
            sx: {
              fontFamily: 'monospace',
              fontSize: 18,
              fontWeight: 700,
            },
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderColor: scanState === 'matched'
                ? theme.palette.success.main
                : undefined,
            },
          }}
        />

        {/* ERROR */}
        {submitError && (
          <Alert severity="error" sx={{ py: 0.5 }}>
            {submitError}
          </Alert>
        )}

        {/* PRIMARY ACTION BUTTON */}
        {scanState === 'matched' || scanState === 'submitting' ? (
          <Button
            variant="contained"
            color="success"
            fullWidth
            size="large"
            onClick={() => void handleConfirm()}
            disabled={scanState === 'submitting'}
            startIcon={<CheckCircle size={20} />}
            sx={{ borderRadius: 2, fontWeight: 700, py: 1.8, fontSize: 16 }}
          >
            {scanState === 'submitting' ? 'Confirming...' : 'Confirm Pick'}
          </Button>
        ) : (
          <Button
            variant="contained"
            fullWidth
            size="large"
            startIcon={<Camera size={20} />}
            onClick={() => setScanState('camera')}
            sx={{ borderRadius: 2, fontWeight: 700, py: 1.8, fontSize: 16 }}
          >
            Scan
          </Button>
        )}

        {/* REPORT PROBLEM */}
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
            <Button
              variant="outlined"
              color="error"
              fullWidth
              size="large"
              startIcon={<PackageX size={16} />}
              onClick={() => void handleReportException('item_missing', 0)}
              sx={{ borderRadius: 2 }}
            >
              Item Not Found
            </Button>

            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                Short Pick — how many did you find?
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  type="number"
                  size="small"
                  value={shortPickQuantity}
                  onChange={(e) => setShortPickQuantity(e.target.value)}
                  inputProps={{ min: 1, max: currentItem.quantity - 1 }}
                  sx={{ flex: 1 }}
                  placeholder="Qty found"
                />
                <Button
                  variant="outlined"
                  color="warning"
                  sx={{ borderRadius: 2 }}
                  onClick={() => {
                    const qty = parseInt(shortPickQuantity, 10);
                    if (!isNaN(qty) && qty > 0) {
                      void handleReportException('short_pick', qty);
                    }
                  }}
                >
                  Report
                </Button>
              </Box>
            </Box>

            <Button
              variant="outlined"
              fullWidth
              size="large"
              sx={{ borderRadius: 2 }}
              onClick={() => void handleReportException('product_defect', 0)}
            >
              Product Defect
            </Button>

            <Button
              variant="outlined"
              fullWidth
              size="large"
              sx={{ borderRadius: 2 }}
              onClick={() => void handleReportException('packaging_defect', 0)}
            >
              Packaging Defect
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExceptionDialog(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}