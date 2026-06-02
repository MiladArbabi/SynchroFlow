// modules/wms/src/ui/pages/PackSessionPage.tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import type { CreateProblemTaskParams } from './PickSessionPage.js';
import {
  Box, Paper, Typography, Button, Alert, Chip, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions,
  CircularProgress, LinearProgress, TextField, useTheme,
} from '@mui/material';
import {
  CheckCircle, XCircle, Package, PackageCheck,
  AlertTriangle, Printer, Clock,
} from 'lucide-react';

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
  product_title: string;
  variant_title: string | null;
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
  /** Called after every exception — creates a Problem Center task. */
  onCreateProblemTask: (params: CreateProblemTaskParams) => Promise<void>;
}

type SessionPhase = 'brief' | 'active' | 'summary';
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
  onCreateProblemTask,
}: PackSessionPageProps) {
  const theme = useTheme();
  const [phase,              setPhase]              = useState<SessionPhase>('brief');
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
  const [packResults,         setPackResults]         = useState<Array<{
    orderId: string;
    externalOrderId: string;
    status: 'shipped' | 'partial' | 'skipped';
  }>>([]);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanInputRef   = useRef<HTMLInputElement>(null);
  const [scanInputValue, setScanInputValue] = useState('');

  const currentOrder    = orders[currentOrderIndex];
  const unscannedItems  = currentOrder?.line_items.filter((li) => !li.pack_scanned) ?? [];
  const currentItem     = unscannedItems[currentItemIndex];
  const isLastOrder     = currentOrderIndex === orders.length - 1;

  // Clean up poll timer on unmount
  useEffect(() => {
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); };
  }, []);

  useEffect(() => {
    if (scanState === 'scanning') setTimeout(() => scanInputRef.current?.focus(), 50);
  }, [scanState]);

  useEffect(() => {
    if (scanState === 'scanning') setTimeout(() => scanInputRef.current?.focus(), 50);
  }, [submitError, scanState]);

  const advanceToNextOrder = useCallback(() => {
    setOrderComplete(false);
    setScanState('scanning');
    setCurrentItemIndex(0);
    setApprovedPartial(false);

    if (isLastOrder) {
      setPhase('summary');
    } else {
      setCurrentOrderIndex((i) => i + 1);
    }
  }, [isLastOrder, setPhase]);

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
    type: 'item_missing' | 'short_pick' | 'product_defect' | 'packaging_defect' | 'wrong_item',
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
      await onCreateProblemTask({
        lasyncro_variant_id: currentItem.lasyncro_variant_id,
        quantity:            currentItem.quantity,
        exception_type:      type,
        source:              'pack' as any,
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
            setPackResults((prev) => [...prev, {
              orderId: currentOrder.lasyncro_order_id,
              externalOrderId: currentOrder.external_order_id,
              status: 'skipped',
            }]);
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
      setPackResults((prev) => [...prev, {
        orderId: currentOrder.lasyncro_order_id,
        externalOrderId: currentOrder.external_order_id,
        status: partial ? 'partial' : 'shipped',
      }]);
    } catch {
      console.error('[PACK_SESSION] Ship confirmation failed');
    } finally {
      advanceToNextOrder();
    }
  }, [currentOrder, onConfirmShipment, advanceToNextOrder]);

  const totalOrders    = orders.length;
  const totalLineItems = orders.reduce((acc, o) => acc + o.line_items.length, 0);
  const totalUnits     = orders.reduce((acc, o) => acc + o.line_items.reduce((a, li) => a + li.quantity, 0), 0);

  if (phase === 'brief') {
    return (
      <Box sx={{ p: 2, maxWidth: 480, mx: 'auto' }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>
          Pack Session
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Batch {pickBatchId.slice(-6).toUpperCase()}
        </Typography>
        <Paper variant="outlined" sx={{ borderRadius: '6px', p: 2, mb: 2, display: 'flex', gap: 2 }}>
          <Box sx={{ flex: 1, textAlign: 'center' }}>
            <Typography variant="h4" fontWeight={600}>{totalOrders}</Typography>
            <Typography variant="caption" color="text.secondary">Orders</Typography>
          </Box>
          <Box sx={{ flex: 1, textAlign: 'center' }}>
            <Typography variant="h4" fontWeight={600}>{totalLineItems}</Typography>
            <Typography variant="caption" color="text.secondary">Line items</Typography>
          </Box>
          <Box sx={{ flex: 1, textAlign: 'center' }}>
            <Typography variant="h4" fontWeight={600}>{totalUnits}</Typography>
            <Typography variant="caption" color="text.secondary">Total units</Typography>
          </Box>
        </Paper>
        <Alert icon={false} sx={{ mb: 3, borderRadius: '6px' }}>
          Pack order by order. Scan each item to verify it matches the order before sealing.
        </Alert>
        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={() => setPhase('active')}
          sx={{
            borderRadius: '6px',
            fontWeight: 600,
            bgcolor: 'var(--accent)',
            '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
          }}
        >
          Start Packing
        </Button>
      </Box>
    );
  }

  if (phase === 'summary') {
    const shippedCount = packResults.filter((r) => r.status === 'shipped').length;
    const partialCount = packResults.filter((r) => r.status === 'partial').length;
    const skippedCount = packResults.filter((r) => r.status === 'skipped').length;
    const STATUS_LABEL: Record<string, string> = {
      shipped: 'Shipped',
      partial: 'Partial shipment',
      skipped: 'Held — re-queued',
    };
    return (
      <Box sx={{ p: 2, maxWidth: 480, mx: 'auto' }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>Pack Summary</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Review before confirming</Typography>
        <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
          <Paper variant="outlined" sx={{ flex: 1, borderRadius: '6px', p: 1.5, textAlign: 'center' }}>
            <Typography variant="h5" fontWeight={600} color="success.main">{shippedCount}</Typography>
            <Typography variant="caption" color="text.secondary">Shipped</Typography>
          </Paper>
          {partialCount > 0 && (
            <Paper variant="outlined" sx={{ flex: 1, borderRadius: '6px', p: 1.5, textAlign: 'center' }}>
              <Typography variant="h5" fontWeight={600} color="warning.main">{partialCount}</Typography>
              <Typography variant="caption" color="text.secondary">Partial</Typography>
            </Paper>
          )}
          {skippedCount > 0 && (
            <Paper variant="outlined" sx={{ flex: 1, borderRadius: '6px', p: 1.5, textAlign: 'center' }}>
              <Typography variant="h5" fontWeight={600} color="error.main">{skippedCount}</Typography>
              <Typography variant="caption" color="text.secondary">Held</Typography>
            </Paper>
          )}
        </Box>
        {skippedCount > 0 && (
          <Alert icon={false} severity="warning" sx={{ mb: 2, borderRadius: '6px' }}>
            {skippedCount} order{skippedCount > 1 ? 's were' : ' was'} held by owner and re-queued.
          </Alert>
        )}
        <Box sx={{ mb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {packResults.map((r) => (
            <Paper
              key={r.orderId}
              variant="outlined"
              sx={{ borderRadius: '6px', p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}
            >
              {r.status === 'shipped' && <CheckCircle size={18} color={theme.palette.success.main} />}
              {r.status === 'partial' && <AlertTriangle size={18} color={theme.palette.warning.main} />}
              {r.status === 'skipped' && <XCircle size={18} color={theme.palette.error.main} />}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={500}>#{r.externalOrderId}</Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">{STATUS_LABEL[r.status]}</Typography>
            </Paper>
          ))}
        </Box>
        {submitError && <Alert severity="error" sx={{ mb: 2, borderRadius: '6px' }}>{submitError}</Alert>}
        <Button
          variant="contained"
          fullWidth
          size="large"
          disabled={completingPack}
          onClick={() => {
            setCompletingPack(true);
            onPackComplete()
              .then(() => onComplete())
              .catch(() => {
                setSubmitError('Pack complete failed. Please try again.');
                setCompletingPack(false);
              });
          }}
          sx={{
            borderRadius: '6px',
            fontWeight: 600,
            bgcolor: 'var(--accent)',
            '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
          }}
        >
          {completingPack ? 'Confirming…' : 'Confirm Pack Complete'}
        </Button>
      </Box>
    );
  }

  if (!currentOrder) return null;

  // ── ORDER COMPLETE — print + ship ────────────────────────────────────────
  if (orderComplete) {
    return (
      <Box sx={{ p: 2, maxWidth: 480, mx: 'auto' }}>
        <Paper
          variant="outlined"
          sx={{
            p: 3, borderRadius: '6px', textAlign: 'center',
            borderColor: theme.palette.success.main,
          }}
        >
          <PackageCheck size={48} color={theme.palette.success.main} />
          <Typography variant="h6" fontWeight={600} sx={{ mt: 2 }}>
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
            onClick={() => { handlePrintAndAdvance().catch((err: unknown) => { 
              setSubmitError((err as any)?.message ?? 'Print failed.'); }); }}
            sx={{ borderRadius: '6px', fontWeight: 600, mb: 1 }}
          >
            Open Shopify label & {isLastOrder ? 'Complete Pack' : 'Next Order'}
          </Button>
          <Button
            variant="contained" fullWidth size="large"
            onClick={() => { handleShipAndAdvance(approvedPartial).catch((err: unknown) => { 
              setSubmitError((err as any)?.message ?? 'Ship confirmation failed.'); }); }}
            sx={{ borderRadius: '6px', fontWeight: 600 }}
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
          p: 3, borderRadius: '6px',
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
      {/* Batch progress */}
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            Order {currentOrderIndex + 1} of {orders.length}
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={Math.round((currentOrderIndex / orders.length) * 100)}
          sx={{ borderRadius: '6px', height: 6 }}
        />
      </Box>
      {/* Order header */}
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
          <Typography variant="subtitle2" fontWeight={600}>
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
            <Typography variant="body2" fontWeight={600}>{currentItem.product_title}</Typography>
            {currentItem.variant_title && (
              <Typography variant="caption" color="text.secondary">{currentItem.variant_title}</Typography>
            )}
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

      {/* Step orientation banner */}
      {scanState === 'scanning' && (
        <Alert icon={false} sx={{ mb: 1.5, borderRadius: '6px', py: 0.5 }}>
          Scan the item barcode to verify it matches this order line.
        </Alert>
      )}
      {/* Scan surface */}
      {scanState === 'scanning' && (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            inputRef={scanInputRef}
            fullWidth
            size="small"
            type="text"
            placeholder="Scan item barcode or type barcode value"
            value={scanInputValue}
            onChange={(e) => setScanInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && scanInputValue.trim()) {
                const val = scanInputValue.trim();
                setScanInputValue('');
                handleScan(val).catch((err: unknown) => {
                  const msg = (err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Scan failed.');
                  setSubmitError(msg);
                });
              }
            }}
            helperText="Scanner auto-submits · manual entry: press Enter"
            autoComplete="off"
          />
          {scanInputValue.trim() && (
            <Button
              variant="contained"
              onClick={() => {
                const val = scanInputValue.trim();
                setScanInputValue('');
                handleScan(val).catch((err: unknown) => {
                  const msg = (err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Scan failed.');
                  setSubmitError(msg);
                });
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

      {scanState === 'processing' && (
        <Paper sx={{
          borderRadius: '6px', py: 4,
          bgcolor: 'action.hover',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Typography variant="body2" color="text.secondary">Verifying...</Typography>
        </Paper>
      )}

      {scanState === 'wrong_item' && (
        <Paper sx={{
          borderRadius: '6px', py: 4,
          bgcolor: theme.palette.error.main,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 1,
        }}>
          <XCircle size={48} color={theme.palette.error.contrastText} />
          <Typography variant="h6" sx={{ color: theme.palette.error.contrastText, fontWeight: 600 }}>
            Wrong Item
          </Typography>
          <Typography variant="caption" sx={{ color: theme.palette.error.contrastText, opacity: 0.8 }}>
            Scan the correct product barcode
          </Typography>
        </Paper>
      )}

      {scanState === 'accepted' && (
        <Paper sx={{
          borderRadius: '6px', py: 4,
          bgcolor: theme.palette.success.main,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 1,
        }}>
          <CheckCircle size={48} color={theme.palette.success.contrastText} />
          <Typography variant="h6" sx={{ color: theme.palette.success.contrastText, fontWeight: 600 }}>
            Verified
          </Typography>
        </Paper>
      )}

      {submitError && <Alert severity="error" sx={{ mt: 2 }}>{submitError}</Alert>}

      {scanState === 'scanning' && (
        <Box sx={{ mt: 2 }}>
          <Button
            variant="outlined" fullWidth size="small"
            sx={{ borderColor: 'warning.main', color: 'warning.main' }}
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
      <Dialog open={exceptionDialog} onClose={() => undefined} fullWidth maxWidth="xs">
        <DialogTitle>Report Issue</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
            {/* BLOCKING — requires owner decision */}
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Requires owner decision
            </Typography>
            <Button
              variant="outlined" fullWidth
              sx={{ borderColor: 'warning.main', color: 'warning.main' }}
              onClick={() => { handleReportException('item_missing').catch((err: unknown) => { 
                setSubmitError((err as any)?.message ?? 'Failed to report exception.'); }); }}
            >
              Item Missing at Pack
            </Button>
            <Button
              variant="outlined" fullWidth
              sx={{ borderColor: 'warning.main', color: 'warning.main' }}
              onClick={() => { handleReportException('short_pick').catch((err: unknown) => { 
                setSubmitError((err as any)?.message ?? 'Failed to report exception.'); }); }}
            >
              Short Pick
            </Button>
            <Divider />
            {/* NON-BLOCKING — problem bin, advance immediately */}
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Problem bin — advance immediately
            </Typography>
            <Button
              variant="outlined" fullWidth
              sx={{ borderColor: 'error.main', color: 'error.main' }}
              onClick={() => { handleReportException('product_defect').catch((err: unknown) => { 
                setSubmitError((err as any)?.message ?? 'Failed to report exception.'); }); }}
            >
              Product Defect
            </Button>
            <Button
              variant="outlined" fullWidth
              onClick={() => { handleReportException('packaging_defect').catch((err: unknown) => { 
                setSubmitError((err as any)?.message ?? 'Failed to report exception.'); }); }}
            >
              Packaging Defect
            </Button>
            <Button
              variant="outlined" fullWidth
              onClick={() => { handleReportException('wrong_item').catch((err: unknown) => { 
                setSubmitError((err as any)?.message ?? 'Failed to report exception.'); }); }}
            >
              Wrong Item
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