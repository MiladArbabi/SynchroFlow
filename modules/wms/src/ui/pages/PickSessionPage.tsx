// modules/wms/src/ui/pages/PickSessionPage.tsx
import { useState, useCallback } from 'react';
import {
  Box,
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
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  PackageX,
  ChevronRight,
} from 'lucide-react';
import { BarcodeScanSurface } from '../components/BarcodeScanSurface.js';

/**
 * PICK SESSION PAGE
 * -----------------
 * Active picking interface for a claimed batch.
 *
 * Flow per line item:
 * 1. Show destination (location_code) + expected product
 * 2. Operator navigates to location
 * 3. Operator scans barcode
 * 4. System resolves barcode → variant
 * 5. If match → quantity confirmation
 * 6. If no match → red signal, re-prompt
 * 7. On quantity confirm → write scan + inventory movement
 * 8. Advance to next line item
 *
 * Exception flows:
 * - Item missing → report exception, advance
 * - Short pick → report with quantity_found, advance
 * - Defect → report exception type, advance
 *
 * Completion:
 * - All items scanned (or excepted) → pick complete prompt
 * - Operator acknowledges → POST pick-complete
 *
 * API calls are injected via props — module stays decoupled
 * from apps/frontend HTTP layer.
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
  | 'scanning'
  | 'wrong_item'
  | 'confirming_quantity'
  | 'submitting'
  | 'accepted';

type ExceptionType = 'item_missing' | 'short_pick' | 'product_defect' | 'packaging_defect';

export default function PickSessionPage({
  lineItems,
  onComplete,
  onResolveBarcode,
  onConfirmScan,
  onReportException,
  onPickComplete,
}: PickSessionPageProps) {
  const theme = useTheme();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [scanState, setScanState] = useState<ScanState>('scanning');
  const [quantityInput, setQuantityInput] = useState('');
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [exceptionDialog, setExceptionDialog] = useState(false);
  const [shortPickQuantity, setShortPickQuantity] = useState('');
  const [completingPick, setCompletingPick] = useState(false);

  const currentItem = lineItems[currentIndex];
  const isLastItem = currentIndex === lineItems.length - 1;
  const progress = (currentIndex / lineItems.length) * 100;

  const handlePickComplete = useCallback(async () => {
    setCompletingPick(true);
    try {
      await onPickComplete();
      onComplete();
    } catch {
      setSubmitError('Pick complete failed.');
      setCompletingPick(false);
    }
  }, [onPickComplete, onComplete]);

  const advanceToNext = useCallback(() => {
    setScanState('scanning');
    setQuantityInput('');
    setQuantityError(null);
    setSubmitError(null);
    setShortPickQuantity('');

    if (isLastItem) {
      handlePickComplete();
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }, [isLastItem, handlePickComplete]);

  const handleScan = useCallback(async (scannedValue: string) => {
    if (scanState !== 'scanning') return;
    if (!currentItem) return;

    try {
      const data = await onResolveBarcode(scannedValue);

      if (!data || data.lasyncro_variant_id !== currentItem.lasyncro_variant_id) {
        setScanState('wrong_item');
        setTimeout(() => setScanState('scanning'), 2500);
        return;
      }

      setQuantityInput(String(currentItem.quantity));
      setScanState('confirming_quantity');
    } catch {
      setScanState('wrong_item');
      setTimeout(() => setScanState('scanning'), 2500);
    }
  }, [scanState, currentItem, onResolveBarcode]);

  const handleQuantityConfirm = useCallback(async () => {
    if (!currentItem) return;

    const qty = parseInt(quantityInput, 10);

    if (isNaN(qty) || qty <= 0) {
      setQuantityError('Enter a valid quantity');
      return;
    }

    if (qty > currentItem.quantity) {
      setQuantityError(`Max quantity is ${currentItem.quantity}`);
      return;
    }

    setQuantityError(null);
    setScanState('submitting');
    setSubmitError(null);

    try {
      await onConfirmScan({
        lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
        lasyncro_variant_id: currentItem.lasyncro_variant_id,
        location_code: currentItem.location_code,
        quantity_confirmed: qty,
      });

      setScanState('accepted');
      setTimeout(advanceToNext, 1200);
    } catch {
      setSubmitError('Scan failed. Try again.');
      setScanState('confirming_quantity');
    }
  }, [quantityInput, currentItem, onConfirmScan, advanceToNext]);

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
      // Exception reporting failure must not block pick flow
      console.error('[PICK_SESSION] Exception report failed', { type });
    } finally {
      setExceptionDialog(false);
      advanceToNext();
    }
  }, [currentItem, onReportException, advanceToNext]);

  if (!currentItem) return null;

  return (
    <Box sx={{ p: 2, maxWidth: 480, mx: 'auto' }}>

      {/* PROGRESS */}
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            Item {currentIndex + 1} of {lineItems.length}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {Math.round(progress)}%
          </Typography>
        </Box>
        <LinearProgress variant="determinate" value={progress} sx={{ borderRadius: 1 }} />
      </Box>

      {/* DESTINATION */}
      <Box
        sx={{
          p: 2,
          mb: 2,
          bgcolor: 'action.hover',
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box>
          <Typography variant="overline" color="text.secondary">Location</Typography>
          <Typography variant="h6" fontWeight={700} sx={{ fontFamily: 'monospace' }}>
            {currentItem.location_code}
          </Typography>
        </Box>
        <ChevronRight size={20} color={theme.palette.text.secondary} />
        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="overline" color="text.secondary">Qty needed</Typography>
          <Typography variant="h6" fontWeight={700}>
            {currentItem.quantity}
          </Typography>
        </Box>
      </Box>

      {/* PRODUCT INFO */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" fontWeight={600} noWrap>
          {currentItem.title}
        </Typography>
        {currentItem.sku && (
          <Typography variant="caption" color="text.secondary">
            SKU: {currentItem.sku}
          </Typography>
        )}
      </Box>

      {/* SCAN SURFACE */}
      {scanState === 'scanning' && (
        <BarcodeScanSurface
          onScan={handleScan}
          enabled
          hint="Scan product barcode"
        />
      )}

      {/* WRONG ITEM SIGNAL */}
      {scanState === 'wrong_item' && (
        <Box
          sx={{
            aspectRatio: '4/3',
            borderRadius: 3,
            bgcolor: theme.palette.error.main,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
          }}
        >
          <XCircle size={48} color="white" />
          <Typography variant="h6" sx={{ color: 'white', fontWeight: 700 }}>
            Wrong Item
          </Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.8)' }}>
            Scan the correct product barcode
          </Typography>
        </Box>
      )}

      {/* ACCEPTED SIGNAL */}
      {scanState === 'accepted' && (
        <Box
          sx={{
            aspectRatio: '4/3',
            borderRadius: 3,
            bgcolor: theme.palette.success.main,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
          }}
        >
          <CheckCircle size={48} color="white" />
          <Typography variant="h6" sx={{ color: 'white', fontWeight: 700 }}>
            Confirmed
          </Typography>
        </Box>
      )}

      {/* QUANTITY CONFIRMATION */}
      {(scanState === 'confirming_quantity' || scanState === 'submitting') && (
        <Box sx={{ mt: 1 }}>
          <Alert severity="success" sx={{ mb: 2 }}>
            Correct item scanned — confirm quantity
          </Alert>

          <TextField
            label="Quantity"
            type="number"
            value={quantityInput}
            onChange={(e) => setQuantityInput(e.target.value)}
            error={!!quantityError}
            helperText={quantityError ?? ''}
            fullWidth
            autoFocus
            inputProps={{ min: 1, max: currentItem.quantity }}
            sx={{ mb: 2 }}
          />

          {submitError && (
            <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>
          )}

          <Button
            variant="contained"
            fullWidth
            size="large"
            onClick={handleQuantityConfirm}
            disabled={scanState === 'submitting'}
            sx={{ borderRadius: 2, fontWeight: 700, mb: 1 }}
          >
            {scanState === 'submitting' ? 'Confirming...' : 'Confirm Pick'}
          </Button>
        </Box>
      )}

      {/* EXCEPTION ACTIONS */}
      {scanState === 'scanning' && (
        <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            color="warning"
            fullWidth
            size="small"
            startIcon={<AlertTriangle size={14} />}
            onClick={() => setExceptionDialog(true)}
          >
            Report Issue
          </Button>
        </Box>
      )}

      {/* EXCEPTION DIALOG */}
      <Dialog open={exceptionDialog} onClose={() => setExceptionDialog(false)} fullWidth>
        <DialogTitle>Report Issue</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
            <Button
              variant="outlined"
              color="error"
              fullWidth
              startIcon={<PackageX size={16} />}
              onClick={() => handleReportException('item_missing', 0)}
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
              onClick={() => void handleReportException('product_defect', 0)}
            >
              Product Defect
            </Button>

            <Button
              variant="outlined"
              fullWidth
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

      {/* PICK COMPLETE */}
      {completingPick && (
        <Alert severity="info" sx={{ mt: 2 }}>
          Completing pick session...
        </Alert>
      )}
    </Box>
  );
}