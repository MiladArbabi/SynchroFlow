// modules/wms/src/ui/pages/PackSessionPage.tsx
import { useState, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Alert,
  Chip,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  useTheme,
} from '@mui/material';
import {
  CheckCircle,
  XCircle,
  Package,
  PackageCheck,
  AlertTriangle,
  Printer,
} from 'lucide-react';
import { BarcodeScanSurface } from '../components/BarcodeScanSurface.js';

/**
 * PACK SESSION PAGE
 * -----------------
 * Per-order pack verification interface.
 *
 * Flow per order:
 * 1. Show order summary (external_order_id, line items)
 * 2. Packer scans each line item barcode
 * 3. System resolves barcode → variant
 * 4. Match → confirmed (green signal)
 * 5. No match → red signal, re-prompt
 * 6. All items confirmed → print invoice + shipping label
 * 7. Advance to next order
 *
 * Exception flows:
 * - Missing item at pack → report exception, partial shipment option
 * - Defect found at pack → report to SKU Gaps module
 *
 * Completion:
 * - All orders packed → pack complete acknowledgement
 *
 * Theme-aware: Paper, theme.palette tokens, no hardcoded colors.
 * API calls injected via props — module decoupled from frontend HTTP layer.
 */

export interface PackLineItem {
  lasyncro_line_item_id: string;
  lasyncro_order_id: string;
  lasyncro_variant_id: string;
  sku: string | null;
  title: string;
  quantity: number;
  pack_scanned: boolean;
}

export interface PackOrder {
  lasyncro_order_id: string;
  external_order_id: string;
  total_price: number;
  currency: string;
  warehouse_status: string;
  line_items: PackLineItem[];
}

export interface PackSessionPageProps {
  pickBatchId: string;
  orders: PackOrder[];
  onComplete: () => void;
  onResolveBarcode: (scannedValue: string) => Promise<{ lasyncro_variant_id: string } | null>;
  onConfirmPackScan: (params: {
    lasyncro_order_id: string;
    lasyncro_line_item_id: string;
    lasyncro_variant_id: string;
    quantity_confirmed: number;
  }) => Promise<{ order_complete: boolean }>;
  onReportException: (params: {
    lasyncro_line_item_id: string;
    lasyncro_variant_id: string;
    exception_type: string;
    quantity_required: number;
    quantity_found: number;
  }) => Promise<void>;
  onPrintLabel: (orderId: string) => Promise<void>;
  onPackComplete: () => Promise<void>;
}

type ScanState = 'scanning' | 'wrong_item' | 'accepted' | 'processing';

export default function PackSessionPage({
  pickBatchId,
  orders,
  onComplete,
  onResolveBarcode,
  onConfirmPackScan,
  onReportException,
  onPrintLabel,
  onPackComplete,
}: PackSessionPageProps) {
  const theme = useTheme();
  const [currentOrderIndex, setCurrentOrderIndex] = useState(0);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [scanState, setScanState] = useState<ScanState>('scanning');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [exceptionDialog, setExceptionDialog] = useState(false);
  const [orderComplete, setOrderComplete] = useState(false);
  const [completingPack, setCompletingPack] = useState(false);

  const currentOrder = orders[currentOrderIndex];
  const unscannedItems = currentOrder?.line_items.filter((li) => !li.pack_scanned) ?? [];
  const currentItem = unscannedItems[currentItemIndex];
  const isLastOrder = currentOrderIndex === orders.length - 1;

  const handlePackComplete = useCallback(async () => {
    setCompletingPack(true);
    try {
      await onPackComplete();
      onComplete();
    } catch {
      setSubmitError('Pack complete failed.');
      setCompletingPack(false);
    }
  }, [onPackComplete, onComplete]);

  const advanceToNextOrder = useCallback(() => {
    setCurrentItemIndex(0);
    setOrderComplete(false);
    setScanState('scanning');
    setSubmitError(null);

    if (isLastOrder) {
      void handlePackComplete();
    } else {
      setCurrentOrderIndex((i) => i + 1);
    }
  }, [isLastOrder, handlePackComplete]);

  const handleScan = useCallback(async (scannedValue: string) => {
    if (scanState !== 'scanning') return;
    if (!currentItem) return;

    setScanState('processing');

    try {
      const data = await onResolveBarcode(scannedValue);

      if (!data || data.lasyncro_variant_id !== currentItem.lasyncro_variant_id) {
        setScanState('wrong_item');
        setTimeout(() => setScanState('scanning'), 2500);
        return;
      }

      const result = await onConfirmPackScan({
        lasyncro_order_id: currentOrder.lasyncro_order_id,
        lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
        lasyncro_variant_id: currentItem.lasyncro_variant_id,
        quantity_confirmed: currentItem.quantity,
      });

      setScanState('accepted');

      if (result.order_complete) {
        setOrderComplete(true);
      } else {
        setTimeout(() => {
          setCurrentItemIndex((i) => i + 1);
          setScanState('scanning');
        }, 1200);
      }
    } catch {
      setSubmitError('Scan failed. Try again.');
      setScanState('scanning');
    }
  }, [scanState, currentItem, currentOrder, onResolveBarcode, onConfirmPackScan]);

  const handleReportException = useCallback(async (
    type: 'item_missing' | 'product_defect' | 'packaging_defect',
  ) => {
    if (!currentItem) return;
    try {
      await onReportException({
        lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
        lasyncro_variant_id: currentItem.lasyncro_variant_id,
        exception_type: type,
        quantity_required: currentItem.quantity,
        quantity_found: 0,
      });
    } catch {
      console.error('[PACK_SESSION] Exception report failed', { type });
    } finally {
      setExceptionDialog(false);
      // Advance past this item
      if (currentItemIndex >= unscannedItems.length - 1) {
        setOrderComplete(true);
      } else {
        setCurrentItemIndex((i) => i + 1);
        setScanState('scanning');
      }
    }
  }, [currentItem, currentItemIndex, unscannedItems.length, onReportException]);

  const handlePrintAndAdvance = useCallback(async () => {
    try {
      await onPrintLabel(currentOrder.lasyncro_order_id);
    } catch {
      console.error('[PACK_SESSION] Label print failed');
    } finally {
      advanceToNextOrder();
    }
  }, [currentOrder, onPrintLabel, advanceToNextOrder]);

  if (!currentOrder) return null;

  // Order complete — show print prompt
  if (orderComplete) {
    return (
      <Box sx={{ p: 2, maxWidth: 480, mx: 'auto' }}>
        <Paper
          variant="outlined"
          sx={{
            p: 3,
            borderRadius: 2,
            textAlign: 'center',
            borderColor: theme.palette.success.main,
          }}
        >
          <PackageCheck size={48} color={theme.palette.success.main} />
          <Typography variant="h6" fontWeight={700} sx={{ mt: 2 }}>
            Order Complete
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
            #{currentOrder.external_order_id} — all items verified
          </Typography>

          <Button
            variant="contained"
            fullWidth
            size="large"
            startIcon={<Printer size={18} />}
            onClick={() => void handlePrintAndAdvance()}
            sx={{ borderRadius: 2, fontWeight: 700, mb: 1.5 }}
          >
            Print Label & {isLastOrder ? 'Complete Pack' : 'Next Order'}
          </Button>

          <Button
            variant="text"
            fullWidth
            onClick={advanceToNextOrder}
            sx={{ color: 'text.secondary' }}
          >
            Skip Print
          </Button>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, maxWidth: 480, mx: 'auto' }}>

      {/* ORDER HEADER */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="overline" color="text.secondary">Order</Typography>
            <Typography variant="h6" fontWeight={700} sx={{ fontFamily: 'monospace' }}>
              #{currentOrder.external_order_id}
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="caption" color="text.secondary">
              {currentOrderIndex + 1} of {orders.length}
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {currentOrder.currency} {Number(currentOrder.total_price).toFixed(2)}
            </Typography>
          </Box>
        </Box>

        <Divider sx={{ my: 1.5 }} />

        {/* LINE ITEMS CHECKLIST */}
        {currentOrder.line_items.map((li) => (
          <Box
            key={li.lasyncro_line_item_id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              py: 0.5,
              opacity: li.pack_scanned ? 0.5 : 1,
            }}
          >
            {li.pack_scanned
              ? <CheckCircle size={16} color={theme.palette.success.main} />
              : <Package size={16} color={theme.palette.text.secondary} />
            }
            <Typography
              variant="caption"
              sx={{
                flex: 1,
                textDecoration: li.pack_scanned ? 'line-through' : 'none',
                color: li.pack_scanned ? theme.palette.text.secondary : theme.palette.text.primary,
              }}
              noWrap
            >
              {li.title}
            </Typography>
            <Chip label={`×${li.quantity}`} size="small" variant="outlined" />
          </Box>
        ))}
      </Paper>

      {/* CURRENT ITEM */}
      {currentItem && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
          <Typography variant="overline" color="text.secondary">Scan next</Typography>
          <Typography variant="body2" fontWeight={600} noWrap>
            {currentItem.title}
          </Typography>
          {currentItem.sku && (
            <Typography variant="caption" color="text.secondary">
              SKU: {currentItem.sku}
            </Typography>
          )}
        </Paper>
      )}

      {/* SCAN SURFACE */}
      {scanState === 'scanning' && (
        <BarcodeScanSurface
          onScan={handleScan}
          enabled
          hint="Scan item barcode to verify"
        />
      )}

      {/* PROCESSING */}
      {scanState === 'processing' && (
        <Paper
          sx={{
            aspectRatio: '4/3',
            borderRadius: 3,
            bgcolor: theme.palette.action.hover,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Typography variant="body2" color="text.secondary">Verifying...</Typography>
        </Paper>
      )}

      {/* WRONG ITEM */}
      {scanState === 'wrong_item' && (
        <Paper
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
          <XCircle size={48} color={theme.palette.error.contrastText} />
          <Typography variant="h6" sx={{ color: theme.palette.error.contrastText, fontWeight: 700 }}>
            Wrong Item
          </Typography>
          <Typography variant="caption" sx={{ color: theme.palette.error.contrastText, opacity: 0.8 }}>
            Scan the correct product barcode
          </Typography>
        </Paper>
      )}

      {/* ACCEPTED */}
      {scanState === 'accepted' && (
        <Paper
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
          <CheckCircle size={48} color={theme.palette.success.contrastText} />
          <Typography variant="h6" sx={{ color: theme.palette.success.contrastText, fontWeight: 700 }}>
            Verified
          </Typography>
        </Paper>
      )}

      {/* ERROR */}
      {submitError && (
        <Alert severity="error" sx={{ mt: 2 }}>{submitError}</Alert>
      )}

      {/* EXCEPTION */}
      {scanState === 'scanning' && (
        <Box sx={{ mt: 2 }}>
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
              onClick={() => void handleReportException('item_missing')}
            >
              Item Missing at Pack
            </Button>
            <Button
              variant="outlined"
              fullWidth
              onClick={() => void handleReportException('product_defect')}
            >
              Product Defect
            </Button>
            <Button
              variant="outlined"
              fullWidth
              onClick={() => void handleReportException('packaging_defect')}
            >
              Packaging Defect
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExceptionDialog(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      {/* COMPLETING */}
      {completingPack && (
        <Alert severity="info" sx={{ mt: 2 }}>
          Completing pack session...
        </Alert>
      )}
    </Box>
  );
}