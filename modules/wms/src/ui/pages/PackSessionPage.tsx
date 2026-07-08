// modules/wms/src/ui/pages/PackSessionPage.tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import type { CreateProblemTaskParams } from './PickSessionPage.js';
import type { PackFreeScanResult, PackFreeScanApiResponse } from './WmsModuleFT2.js';
import {
  Box, Paper, Typography, Button, Alert, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions,
  CircularProgress, TextField, useTheme,
} from '@mui/material';
import {
  ArrowLeft, CheckCircle, AlertTriangle,
  Printer, Package,
  PrinterCheck,
} from 'lucide-react';

/**
 * PACK SESSION PAGE — WEB-PACK-02
 * --------------------------------
 * Item-centric free-scan surface. Opened by WmsModuleFT2 after the first
 * successful LSU- scan on the operations page.
 *
 * Flow:
 * 1. Mount → auto-trigger invoice + carrier label print
 * 2. Multi-item orders → scan each sibling LSU- barcode
 * 3. All items confirmed → scan LSO- invoice barcode to ship
 * 4. Shipment confirmed → onComplete (returns to pack mode listening state)
 *
 * Guards:
 * - Back-nav: warns when leaving a partially-confirmed multi-item order
 * - LSO- mismatch: rejects wrong invoice barcode with inline error
 * - Cross-order LSU-: rejects unit from a different order
 * - Print failure: non-blocking warning, operator proceeds normally
 */

// ── Legacy types — kept for WmsModuleFT2Props backwards compat ────────────────
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
  wms_barcode: string | null;
  total_price: number;
  currency: string;
  warehouse_status: string;
  line_items: PackLineItem[];
}

// ── ScanInput — same pattern as StowSessionPage ───────────────────────────────
function ScanInput({
  hint, onSubmit, disabled = false,
}: {
  hint: string;
  onSubmit: (value: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (!disabled) setTimeout(() => inputRef.current?.focus(), 50);
  }, [disabled]);

  const handleSubmit = () => {
    const val = value.trim();
    if (val && !disabled) { onSubmit(val); setValue(''); }
  };

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
      <TextField
        inputRef={inputRef} fullWidth size="small"
        placeholder={hint} value={value} disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
        helperText="Scanner auto-submits · manual entry: press Enter"
        autoComplete="off"
      />
      {value.trim() && !disabled && (
        <Button variant="contained" size="small" onClick={handleSubmit}
          sx={{ bgcolor: 'var(--accent)', borderRadius: '6px', fontWeight: 600, mt: '2px', flexShrink: 0 }}>
          Scan
        </Button>
      )}
    </Box>
  );
}

// ── PackSessionPage ───────────────────────────────────────────────────────────
export interface PackSessionPageProps {
  initialFreeScanResult: PackFreeScanResult;
  onPackFreeScan: (scannedValue: string) => Promise<PackFreeScanApiResponse>;
  onPrintInvoice: (orderId: string) => Promise<void>;
  onPrintLabel: (orderId: string) => Promise<void>;
  onCreateProblemTask: (params: CreateProblemTaskParams) => Promise<void>;
  onComplete: () => void;
}

export default function PackSessionPage({
  initialFreeScanResult,
  onPackFreeScan,
  onPrintInvoice,
  onPrintLabel,
  onCreateProblemTask,
  onComplete,
}: PackSessionPageProps) {
  const theme = useTheme();
  const [currentResult, setCurrentResult] = useState<PackFreeScanResult>(initialFreeScanResult);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [printState, setPrintState] = useState<'printing' | 'printed' | 'failed'>('printing');
  const [backNavDialogOpen, setBackNavDialogOpen] = useState(false);
  const [problemDialogOpen, setProblemDialogOpen] = useState(false);
  const [problemType, setProblemType] = useState('missing_item');
  const [problemNotes, setProblemNotes] = useState('');
  const [problemLoading, setProblemLoading] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scannedCount = currentResult.line_items.filter((i) => i.pack_scanned).length;
  const totalCount = currentResult.line_items.length;
  const allScanned = scannedCount >= totalCount;

  // Auto-print invoice + carrier label on mount
  useEffect(() => {
    Promise.all([
      onPrintInvoice(currentResult.lasyncro_order_id),
      onPrintLabel(currentResult.lasyncro_order_id),
    ])
      .then(() => setPrintState('printed'))
      .catch(() => setPrintState('failed'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScan = useCallback(async (scannedValue: string) => {
    if (scanLoading) return;
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setScanLoading(true);
    setScanError(null);
    try {
      const result = await onPackFreeScan(scannedValue);

      if ('error' in result) {
        setScanError(result.message);
        errorTimerRef.current = setTimeout(() => setScanError(null), 3500);
        return;
      }

      if (result.type === 'shipped') {
        // LSO- mismatch guard — wrong invoice scanned
        if (result.lasyncro_order_id !== currentResult.lasyncro_order_id) {
          setScanError(`Wrong invoice — this barcode belongs to order ${result.external_order_id}. Scan the correct invoice.`);
          errorTimerRef.current = setTimeout(() => setScanError(null), 3500);
          return;
        }
        onComplete();
        return;
      }

      if (result.type === 'unit_resolved') {
        // Cross-order LSU- guard — unit belongs to a different order
        if (result.lasyncro_order_id !== currentResult.lasyncro_order_id) {
          setScanError(`Wrong order — this item belongs to order ${result.order?.external_order_id ?? ''}. Finish this order first.`);
          errorTimerRef.current = setTimeout(() => setScanError(null), 3500);
          return;
        }
        setCurrentResult(result);
      }
    } catch (err: any) {
      const msg: string = err?.response?.data?.message ?? err?.message ?? 'Scan failed — try again';
      setScanError(msg);
      errorTimerRef.current = setTimeout(() => setScanError(null), 3500);
    } finally {
      setScanLoading(false);
    }
  }, [scanLoading, onPackFreeScan, currentResult.lasyncro_order_id, onComplete]);

  const handleBack = () => {
    const anyScanned = currentResult.line_items.some((i) => i.pack_scanned);
    if (anyScanned && !allScanned) {
      setBackNavDialogOpen(true);
    } else {
      onComplete();
    }
  };

  const handleReportProblem = async () => {
    setProblemLoading(true);
    try {
      await onCreateProblemTask({
        lasyncro_variant_id: currentResult.variant?.sku ?? currentResult.lasyncro_unit_id,
        quantity: 1,
        exception_type: problemType,
        source: 'pack',
      });
      setProblemDialogOpen(false);
      setProblemNotes('');
    } catch { /* best-effort — problem center must never block packing */ } finally {
      setProblemLoading(false);
    }
  };

  const scanHint = allScanned
    ? currentResult.order?.wms_barcode
      ? `Scan invoice barcode (LSO-) to confirm shipment — code: ${currentResult.order.wms_barcode}`
      : 'Scan invoice barcode (LSO-) to confirm shipment'
    : `Scan next LSU- barcode · ${scannedCount} of ${totalCount} confirmed`;

  return (
    <Box sx={{ p: 2, maxWidth: 600, mx: 'auto' }}>

      {/* HEADER */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Button size="small" startIcon={<ArrowLeft size={16} />} onClick={handleBack}
          sx={{ color: 'text.secondary', px: 1 }}>
          Pack mode
        </Button>
        <Chip
          label={`#${currentResult.order?.external_order_id ?? currentResult.lasyncro_order_id.slice(0, 8).toUpperCase()}`}
          size="small" variant="outlined"
          sx={{ ml: 'auto', fontFamily: 'monospace', fontWeight: 600 }}
        />
        <Typography variant="caption" color="text.secondary">
          {totalCount} {totalCount === 1 ? 'item' : 'items'}
        </Typography>
      </Box>

      {/* ORDER CONTEXT CARD */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Box sx={{
            width: 80, height: 80, borderRadius: 1.5, flexShrink: 0,
            bgcolor: 'action.hover', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid', borderColor: 'divider',
          }}>
            {currentResult.variant?.image_url
              ? <img src={currentResult.variant.image_url}
                  alt={currentResult.variant.variant_title ?? 'Product'}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <Package size={28} style={{ opacity: 0.3 }} />}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} noWrap>
              {currentResult.variant?.variant_title ?? 'Unknown product'}
            </Typography>
            {currentResult.variant?.sku && (
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                {currentResult.variant.sku}
              </Typography>
            )}
            {currentResult.order && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {currentResult.order.shipping_name} · {currentResult.order.shipping_city}, {currentResult.order.shipping_country_code}
              </Typography>
            )}
            <Typography variant="caption"
              sx={{ fontFamily: 'monospace', fontSize: 10, color: 'success.main', display: 'block', mt: 0.5 }}>
              {currentResult.lasyncro_unit_id} ✓
            </Typography>
          </Box>
        </Box>

        {/* SIBLING THUMBNAILS — multi-item orders only */}
        {totalCount > 1 && (
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
            {currentResult.line_items.map((item) => (
              <Box key={item.lasyncro_line_item_id} sx={{ position: 'relative' }}>
                <Box sx={{
                  width: 36, height: 36, borderRadius: 1,
                  bgcolor: 'action.hover', overflow: 'hidden',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid',
                  borderColor: item.pack_scanned ? 'success.main' : 'divider',
                  opacity: item.pack_scanned ? 1 : 0.45,
                  transition: 'all 0.2s',
                }}>
                  {item.image_url
                    ? <img src={item.image_url} alt={item.product_title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <Package size={14} style={{ opacity: 0.5 }} />}
                </Box>
                {item.pack_scanned && (
                  <Box sx={{
                    position: 'absolute', bottom: -3, right: -3,
                    width: 14, height: 14, borderRadius: '50%',
                    bgcolor: 'success.main',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <CheckCircle size={9} color="#fff" />
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}

        {/* INCOMPLETE SIBLINGS WARNING */}
        {totalCount > 1 && !allScanned && (
          <Alert severity="warning" icon={<AlertTriangle size={14} />}
            sx={{ mt: 1.5, py: 0.5, fontSize: 12 }}>
            Scan {totalCount - scannedCount} more {totalCount - scannedCount === 1 ? 'item' : 'items'} before scanning the invoice
          </Alert>
        )}
      </Paper>

      {/* PRINT STATUS */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, mb: 2,
        p: 1.25, borderRadius: 1.5,
        bgcolor: printState === 'failed'
          ? theme.palette.mode === 'dark' ? 'rgba(255,152,0,0.12)' : '#fff8e1'
          : theme.palette.mode === 'dark' ? 'rgba(76,175,80,0.12)' : '#f1f8e9',
        border: '1px solid',
        borderColor: printState === 'failed' ? 'warning.main' : 'success.main',
      }}>
        {printState === 'printing'
          ? <CircularProgress size={14} color="success" />
          : printState === 'printed'
            ? <Printer size={14} color={theme.palette.success.main} />
            : <PrinterCheck size={14} color={theme.palette.warning.main} />}
        <Typography variant="caption" fontWeight={500}
          color={printState === 'failed' ? 'warning.dark' : 'success.dark'}>
          {printState === 'printing' && 'Sending invoice + label to printer…'}
          {printState === 'printed' && 'Invoice + shipping label sent to printer'}
          {printState === 'failed' && currentResult.order?.wms_barcode &&
            `Printer offline — re-queued. Invoice code: ${currentResult.order.wms_barcode}`}
          {printState === 'failed' && !currentResult.order?.wms_barcode &&
            'Printer offline — re-queued. You can still proceed.'}
        </Typography>
      </Box>

      {/* SCAN ERROR */}
      {scanError && (
        <Alert severity="error" sx={{ mb: 2, py: 0.5, fontSize: 13 }}>
          {scanError}
        </Alert>
      )}

      {/* SCAN INPUT */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
        <ScanInput hint={scanHint} onSubmit={handleScan} disabled={scanLoading} />
      </Paper>

      {/* PROBLEM CENTER */}
      <Button size="small" startIcon={<AlertTriangle size={14} />}
        onClick={() => setProblemDialogOpen(true)}
        sx={{ color: 'text.secondary', fontSize: 12 }}>
        Report a problem
      </Button>

      {/* BACK NAV GUARD */}
      <Dialog open={backNavDialogOpen} onClose={() => setBackNavDialogOpen(false)}>
        <DialogTitle>Abandon pack session?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {scannedCount} of {totalCount} items confirmed for this order.
            Leaving now requires re-scanning all items on return.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBackNavDialogOpen(false)}>Stay</Button>
          <Button color="error" onClick={onComplete}>Abandon</Button>
        </DialogActions>
      </Dialog>

      {/* PROBLEM CENTER DIALOG */}
      <Dialog open={problemDialogOpen} onClose={() => setProblemDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Report a problem</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
            {[
              { value: 'missing_item', label: 'Item missing at pack' },
              { value: 'product_defect', label: 'Product defect' },
              { value: 'packaging_defect', label: 'Packaging defect' },
            ].map((opt) => (
              <Button key={opt.value}
                variant={problemType === opt.value ? 'contained' : 'outlined'}
                size="small" onClick={() => setProblemType(opt.value)}
                sx={{ justifyContent: 'flex-start', borderRadius: 1.5,
                  ...(problemType === opt.value && { bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)' } }) }}>
                {opt.label}
              </Button>
            ))}
            <TextField label="Notes (optional)" size="small" multiline rows={2}
              value={problemNotes} onChange={(e) => setProblemNotes(e.target.value)} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProblemDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={problemLoading}
            onClick={() => void handleReportProblem()}
            sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)' } }}>
            {problemLoading ? <CircularProgress size={16} /> : 'Report'}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}