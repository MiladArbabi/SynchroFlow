// modules/wms/src/ui/pages/PackSessionPage.tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Box, Paper, Typography, Button, Alert, Chip, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions,
  CircularProgress, TextField, useTheme,
} from '@mui/material';
import {
  CheckCircle, XCircle, Package, PackageCheck,
  AlertTriangle, Printer, Clock,
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
 * NON-BLOCKING (product_defect, packaging_defect):
 *   → report to Problem Center, advance immediately
 * BLOCKING (item_missing, short_pick):
 *   → raise PackDecisionRequest, enter awaiting_decision phase
 *   → poll every 4s until owner approves/rejects
 *   → approved: advance with partial_shipment flag
 *   → rejected: skip order (held + re-queued)
 *
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
  onConfirmShipment: (orderId: string, partial?: boolean) => Promise<void>;
  /**
   * BLOCKING EXCEPTION CALLBACKS
   * Raise a PackDecisionRequest and poll for resolution.
   * Injected from WmsPage — keeps module decoupled from HTTP layer.
   */
  onRaiseDecision: (params: {
    pick_batch_id: string;
    lasyncro_order_id: string;
    lasyncro_line_item_id: string;
    exception_type: 'item_missing' | 'short_pick';
    question: 'ship_partial';
  }) => Promise<{ id: string }>;
  onPollDecision: (requestId: string) => Promise<{
    status: 'pending' | 'approved' | 'rejected';
    partial_shipment: boolean | null;
    note: string | null;
  }>;
}

type ScanState = 'scanning' | 'wrong_item' | 'accepted' | 'processing' | 'awaiting_decision';

const DECISION_POLL_MS = 4_000;

export default function PackSessionPage({
  pickBatchId,
  orders,
  onComplete,
  onResolveBarcode,
  onConfirmPackScan,
  onReportException,
  onPrintLabel,
  onPackComplete,
  onConfirmShipment,
  onRaiseDecision,
  onPollDecision,
}: PackSessionPageProps) {
  const theme = useTheme();
  const [currentOrderIndex,  setCurrentOrderIndex]  = useState(0);
  const [currentItemIndex,   setCurrentItemIndex]   = useState(0);
  const [scanState,           setScanState]           = useState<ScanState>('scanning');
  const [submitError,         setSubmitError]         = useState<string | null>(null);
  const [exceptionDialog,     setExceptionDialog]     = useState(false);
  const [orderComplete,       setOrderComplete]       = useState(false);
  const [completingPack,      setCompletingPack]      = useState(false);

  // Decision request state
  const [pendingDecisionId,   setPendingDecisionId]   = useState<string | null>(null);
  const [pendingExceptionType,setPendingExceptionType]= useState<string | null>(null);
  const [approvedPartial,     setApprovedPartial]     = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentOrder    = orders[currentOrderIndex];
  const unscannedItems  = currentOrder?.line_items.filter((li) => !li.pack_scanned) ?? [];
  const currentItem     = unscannedItems[currentItemIndex];
  const isLastOrder     = currentOrderIndex === orders.length - 1;

  // Clean up poll timer on unmount
  useEffect(() => {
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); };
  }, []);

  const advanceToNextOrder = useCallback(() => {
    setOrderComplete(false);
    setScanState('scanning');
    setCurrentItemIndex(0);
    setApprovedPartial(false);
    if (isLastOrder) {
      void (async () => {
        setCompletingPack(true);
        try {
          await onPackComplete();
          onComplete();
        } catch {
          setSubmitError('Pack complete failed.');
          setCompletingPack(false);
        }
      })();
    } else {
      setCurrentOrderIndex((i) => i + 1);
    }
  }, [isLastOrder, onPackComplete, onComplete]);

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

  const handleScan = useCallback(async (scannedValue: string) => {
    if (!currentItem || scanState !== 'scanning') return;
    setScanState('processing');
    setSubmitError(null);
    try {
      const resolved = await onResolveBarcode(scannedValue);
      if (!resolved?.lasyncro_variant_id) {
        setScanState('wrong_item');
        setTimeout(() => setScanState('scanning'), 1500);
        return;
      }
      if (resolved.lasyncro_variant_id !== currentItem.lasyncro_variant_id) {
        setScanState('wrong_item');
        setTimeout(() => setScanState('scanning'), 1500);
        return;
      }
      const result = await onConfirmPackScan({
        lasyncro_order_id:     currentItem.lasyncro_order_id,
        lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
        lasyncro_variant_id:   currentItem.lasyncro_variant_id,
        quantity_confirmed:    currentItem.quantity,
      });
      setScanState('accepted');
      setTimeout(() => {
        if (result.order_complete) {
          setOrderComplete(true);
        } else {
          setCurrentItemIndex((i) => i + 1);
          setScanState('scanning');
        }
      }, 800);
    } catch (err) {
      setScanState('scanning');
      setSubmitError('Scan failed. Try again.');
      console.error('[PACK_SESSION] Scan error', err);
    }
  }, [currentItem, scanState, onResolveBarcode, onConfirmPackScan]);

  /**
   * HANDLE REPORT EXCEPTION
   * -----------------------
   * Splits on blocking vs non-blocking:
   * - product_defect, packaging_defect → problem bin, advance
   * - item_missing, short_pick → raise decision request, poll
   */
  const handleReportException = useCallback(async (
    type: 'item_missing' | 'short_pick' | 'product_defect' | 'packaging_defect',
  ) => {
    if (!currentItem || !currentOrder) return;
    setExceptionDialog(false);

    const isBlocking = type === 'item_missing' || type === 'short_pick';

    // Report exception to WMS regardless of blocking status
    try {
      await onReportException({
        lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
        lasyncro_variant_id:   currentItem.lasyncro_variant_id,
        exception_type:        type,
        quantity_required:     currentItem.quantity,
        quantity_found:        0,
      });
    } catch {
      console.error('[PACK_SESSION] Exception report failed', { type });
    }

    if (!isBlocking) {
      // Non-blocking — advance past this item immediately
      if (currentItemIndex >= unscannedItems.length - 1) {
        setOrderComplete(true);
      } else {
        setCurrentItemIndex((i) => i + 1);
        setScanState('scanning');
      }
      return;
    }

    // BLOCKING — raise decision request, enter awaiting_decision phase
    try {
      const decision = await onRaiseDecision({
        pick_batch_id:         pickBatchId,
        lasyncro_order_id:     currentOrder.lasyncro_order_id,
        lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
        exception_type:        type,
        question:              'ship_partial',
      });

      setPendingDecisionId(decision.id);
      setPendingExceptionType(type);
      setScanState('awaiting_decision');

      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(async () => {
        try {
          const result = await onPollDecision(decision.id);

          if (result.status === 'approved') {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setPendingDecisionId(null);
            setApprovedPartial(result.partial_shipment === true);
            setScanState('scanning');

            // Mark item as processed, advance
            if (currentItemIndex >= unscannedItems.length - 1) {
              setOrderComplete(true);
            } else {
              setCurrentItemIndex((i) => i + 1);
            }

          } else if (result.status === 'rejected') {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setPendingDecisionId(null);
            setScanState('scanning');
            // Skip order — held by owner, move to next
            advanceToNextOrder();
          }
        } catch {
          // Poll failure non-fatal — retry next interval
        }
      }, DECISION_POLL_MS);

    } catch {
      setSubmitError('Failed to raise decision request. Please try again.');
      setScanState('scanning');
    }
  }, [
    currentItem, currentOrder, currentItemIndex, unscannedItems.length,
    pickBatchId, onReportException, onRaiseDecision, onPollDecision, advanceToNextOrder,
  ]);

  const handlePrintAndAdvance = useCallback(async () => {
    try {
      await onPrintLabel(currentOrder.lasyncro_order_id);
    } catch {
      console.error('[PACK_SESSION] Label print failed');
    } finally {
      advanceToNextOrder();
    }
  }, [currentOrder, onPrintLabel, advanceToNextOrder]);

  const handleShipAndAdvance = useCallback(async (partial = false) => {
    try {
      await onConfirmShipment(currentOrder.lasyncro_order_id, partial);
    } catch {
      console.error('[PACK_SESSION] Ship confirmation failed');
    } finally {
      advanceToNextOrder();
    }
  }, [currentOrder, onConfirmShipment, advanceToNextOrder]);

  if (!currentOrder) return null;

  // ── ORDER COMPLETE — print + ship ────────────────────────────────────────
  if (orderComplete) {
    return (
      <Box sx={{ p: 2, maxWidth: 480, mx: 'auto' }}>
        <Paper
          variant="outlined"
          sx={{
            p: 3, borderRadius: 2, textAlign: 'center',
            borderColor: theme.palette.success.main,
          }}
        >
          <PackageCheck size={48} color={theme.palette.success.main} />
          <Typography variant="h6" fontWeight={700} sx={{ mt: 2 }}>
            Order Complete
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 0.5 }}>
            #{currentOrder.external_order_id} — all items verified
          </Typography>
          {approvedPartial && (
            <Typography variant="caption" color="warning.main" sx={{ display: 'block', mb: 2 }}>
              ⚠ Partial shipment approved — missing item excluded
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {approvedPartial ? '' : ''}
          </Typography>
          <Button
            variant="outlined" fullWidth size="large"
            startIcon={<Printer size={18} />}
            onClick={() => void handlePrintAndAdvance()}
            sx={{ borderRadius: 2, fontWeight: 700, mb: 1 }}
          >
            Open Shopify label & {isLastOrder ? 'Complete Pack' : 'Next Order'}
          </Button>
          <Button
            variant="contained" fullWidth size="large"
            onClick={() => void handleShipAndAdvance(approvedPartial)}
            sx={{ borderRadius: 2, fontWeight: 700 }}
          >
            {isLastOrder ? 'Ship & Complete Pack' : 'Ship & Next Order'}
          </Button>
        </Paper>
      </Box>
    );
  }

  // ── AWAITING DECISION — blocked on owner ─────────────────────────────────
  if (scanState === 'awaiting_decision') {
    const exLabel = pendingExceptionType === 'item_missing' ? 'Item missing' : 'Short pick';
    return (
      <Box sx={{ p: 2, maxWidth: 480, mx: 'auto', textAlign: 'center' }}>
        <Paper variant="outlined" sx={{
          p: 3, borderRadius: 2,
          borderColor: theme.palette.warning.main,
        }}>
          <CircularProgress color="warning" size={40} />
          <Typography variant="h6" fontWeight={600} sx={{ mt: 2, mb: 0.5 }}>
            Waiting for owner decision
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {exLabel} reported on order #{currentOrder.external_order_id}.
            The owner has been notified and must approve or reject before you can continue.
          </Typography>
          <Box sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.5,
            px: 1.5, py: 0.5, borderRadius: 1,
            bgcolor: 'action.hover',
          }}>
            <Clock size={12} color={theme.palette.text.secondary} />
            <Typography variant="caption" color="text.secondary">
              Request {pendingDecisionId?.slice(0, 8).toUpperCase()} · Checking every 4s
            </Typography>
          </Box>
        </Paper>
      </Box>
    );
  }

  const totalItems   = currentOrder.line_items.length;
  const scannedCount = currentOrder.line_items.filter((li) => li.pack_scanned).length;

  // ── ACTIVE SCAN PHASE ────────────────────────────────────────────────────
  return (
    <Box sx={{ p: 2, maxWidth: 480, mx: 'auto' }}>
      {/* Order header */}
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            #{currentOrder.external_order_id}
          </Typography>
          <Chip
            label={`${scannedCount}/${totalItems} items`}
            size="small"
            color={scannedCount === totalItems ? 'success' : 'default'}
          />
        </Box>
        <Typography variant="caption" color="text.secondary">
          {currentOrder.currency} {Number(currentOrder.total_price).toFixed(2)}
        </Typography>
      </Box>

      <Divider sx={{ mb: 2 }} />

      {/* Current item */}
      {currentItem ? (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Package size={16} />
            <Typography variant="body2" fontWeight={600}>{currentItem.title}</Typography>
          </Box>
          {currentItem.sku && (
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              SKU: {currentItem.sku}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Qty: {currentItem.quantity}
          </Typography>
        </Box>
      ) : null}

      {/* Scan surface */}
      {scanState === 'scanning' && (
        <BarcodeScanSurface
          onScan={(v) => void handleScan(v)}
          hint="Scan item barcode"
        />
      )}

      {scanState === 'processing' && (
        <Paper sx={{
          aspectRatio: '4/3', borderRadius: 3,
          bgcolor: 'action.hover',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Typography variant="body2" color="text.secondary">Verifying...</Typography>
        </Paper>
      )}

      {scanState === 'wrong_item' && (
        <Paper sx={{
          aspectRatio: '4/3', borderRadius: 3,
          bgcolor: theme.palette.error.main,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 1,
        }}>
          <XCircle size={48} color={theme.palette.error.contrastText} />
          <Typography variant="h6" sx={{ color: theme.palette.error.contrastText, fontWeight: 700 }}>
            Wrong Item
          </Typography>
          <Typography variant="caption" sx={{ color: theme.palette.error.contrastText, opacity: 0.8 }}>
            Scan the correct product barcode
          </Typography>
        </Paper>
      )}

      {scanState === 'accepted' && (
        <Paper sx={{
          aspectRatio: '4/3', borderRadius: 3,
          bgcolor: theme.palette.success.main,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 1,
        }}>
          <CheckCircle size={48} color={theme.palette.success.contrastText} />
          <Typography variant="h6" sx={{ color: theme.palette.success.contrastText, fontWeight: 700 }}>
            Verified
          </Typography>
        </Paper>
      )}

      {submitError && <Alert severity="error" sx={{ mt: 2 }}>{submitError}</Alert>}

      {scanState === 'scanning' && (
        <Box sx={{ mt: 2 }}>
          <Button
            variant="outlined" color="warning" fullWidth size="small"
            startIcon={<AlertTriangle size={14} />}
            onClick={() => setExceptionDialog(true)}
          >
            Report Issue
          </Button>
        </Box>
      )}

      {completingPack && (
        <Alert severity="info" sx={{ mt: 2 }}>Completing pack session...</Alert>
      )}

      {/* EXCEPTION DIALOG */}
      <Dialog open={exceptionDialog} onClose={() => setExceptionDialog(false)} fullWidth>
        <DialogTitle>Report Issue</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
            {/* BLOCKING — requires owner decision */}
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Requires owner decision
            </Typography>
            <Button
              variant="outlined" color="warning" fullWidth
              onClick={() => void handleReportException('item_missing')}
            >
              Item Missing at Pack
            </Button>
            <Button
              variant="outlined" color="warning" fullWidth
              onClick={() => void handleReportException('short_pick')}
            >
              Short Pick
            </Button>
            <Divider />
            {/* NON-BLOCKING — problem bin, advance immediately */}
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Problem bin — advance immediately
            </Typography>
            <Button
              variant="outlined" color="error" fullWidth
              onClick={() => void handleReportException('product_defect')}
            >
              Product Defect
            </Button>
            <Button
              variant="outlined" fullWidth
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
    </Box>
  );
}