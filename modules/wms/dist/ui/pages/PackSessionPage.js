import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// modules/wms/src/ui/pages/PackSessionPage.tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Paper, Typography, Button, Alert, Chip, Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress, TextField, useTheme, } from '@mui/material';
import { ArrowLeft, CheckCircle, AlertTriangle, Printer, Package, PrinterCheck, } from 'lucide-react';
// ── ScanInput — same pattern as StowSessionPage ───────────────────────────────
function ScanInput({ hint, onSubmit, disabled = false, }) {
    const [value, setValue] = useState('');
    const inputRef = useRef(null);
    useEffect(() => { inputRef.current?.focus(); }, []);
    useEffect(() => {
        if (!disabled)
            setTimeout(() => inputRef.current?.focus(), 50);
    }, [disabled]);
    const handleSubmit = () => {
        const val = value.trim();
        if (val && !disabled) {
            onSubmit(val);
            setValue('');
        }
    };
    return (_jsxs(Box, { sx: { display: 'flex', gap: 1, alignItems: 'flex-start' }, children: [_jsx(TextField, { inputRef: inputRef, fullWidth: true, size: "small", placeholder: hint, value: value, disabled: disabled, onChange: (e) => setValue(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                    handleSubmit(); }, helperText: "Scanner auto-submits \u00B7 manual entry: press Enter", autoComplete: "off" }), value.trim() && !disabled && (_jsx(Button, { variant: "contained", size: "small", onClick: handleSubmit, sx: { bgcolor: 'var(--accent)', borderRadius: '6px', fontWeight: 600, mt: '2px', flexShrink: 0 }, children: "Scan" }))] }));
}
export default function PackSessionPage({ initialFreeScanResult, onPackFreeScan, onPackCountConfirm, onPrintInvoice, onPrintLabel, onCreateProblemTask, onComplete, }) {
    const theme = useTheme();
    const [currentResult, setCurrentResult] = useState(initialFreeScanResult);
    const [scanLoading, setScanLoading] = useState(false);
    const [scanError, setScanError] = useState(null);
    const [printState, setPrintState] = useState('printing');
    const [backNavDialogOpen, setBackNavDialogOpen] = useState(false);
    const [problemDialogOpen, setProblemDialogOpen] = useState(false);
    const [problemType, setProblemType] = useState('missing_item');
    const [problemNotes, setProblemNotes] = useState('');
    const [problemLoading, setProblemLoading] = useState(false);
    const errorTimerRef = useRef(null);
    const scannedCount = currentResult.line_items.filter((i) => i.pack_scanned).length;
    const totalCount = currentResult.line_items.length;
    const allScanned = scannedCount >= totalCount;
    // Per-line mode: lines without a tracked LSU- unit auto-use count mode
    const currentLine = currentResult.line_items.find((i) => !i.pack_scanned) ?? null;
    const currentLineNeedsCount = currentLine ? !currentLine.has_tracked_unit : false;
    const [countQty, setCountQty] = useState(1);
    // Auto-print invoice + carrier label on mount
    useEffect(() => {
        Promise.all([
            onPrintInvoice(currentResult.lasyncro_order_id),
            onPrintLabel(currentResult.lasyncro_order_id),
        ])
            .then(() => setPrintState('printed'))
            .catch(() => setPrintState('failed'));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const handleScan = useCallback(async (scannedValue) => {
        if (scanLoading)
            return;
        if (errorTimerRef.current)
            clearTimeout(errorTimerRef.current);
        setScanLoading(true);
        setScanError(null);
        try {
            const result = await onPackFreeScan(scannedValue);
            if ('error' in result) {
                setScanError(result.message);
                errorTimerRef.current = setTimeout(() => setScanError(null), 3500);
                return;
            }
            if (result.type === 'packed') {
                // LSO mismatch guard — only the active order may close this pack session.
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
        }
        catch (err) {
            const msg = err?.response?.data?.message ?? err?.message ?? 'Scan failed — try again';
            setScanError(msg);
            errorTimerRef.current = setTimeout(() => setScanError(null), 3500);
        }
        finally {
            setScanLoading(false);
        }
    }, [scanLoading, onPackFreeScan, currentResult.lasyncro_order_id, onComplete]);
    const handleBack = () => {
        const anyScanned = currentResult.line_items.some((i) => i.pack_scanned);
        if (anyScanned && !allScanned) {
            setBackNavDialogOpen(true);
        }
        else {
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
        }
        catch { /* best-effort — problem center must never block packing */ }
        finally {
            setProblemLoading(false);
        }
    };
    const scanHint = allScanned
        ? currentResult.order?.wms_barcode
            ? `Scan invoice barcode (LSO-) to confirm shipment — code: ${currentResult.order.wms_barcode}`
            : 'Scan invoice barcode (LSO-) to confirm shipment'
        : currentLineNeedsCount
            ? `Confirm quantity · ${scannedCount} of ${totalCount} confirmed`
            : `Scan next LSU- barcode · ${scannedCount} of ${totalCount} confirmed`;
    return (_jsxs(Box, { sx: { p: 2, maxWidth: 600, mx: 'auto' }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 2 }, children: [_jsx(Button, { size: "small", startIcon: _jsx(ArrowLeft, { size: 16 }), onClick: handleBack, sx: { color: 'text.secondary', px: 1 }, children: "Pack mode" }), _jsx(Chip, { label: `#${currentResult.order?.external_order_id ?? currentResult.lasyncro_order_id.slice(0, 8).toUpperCase()}`, size: "small", variant: "outlined", sx: { ml: 'auto', fontFamily: 'monospace', fontWeight: 600 } }), _jsxs(Typography, { variant: "caption", color: "text.secondary", children: [totalCount, " ", totalCount === 1 ? 'item' : 'items'] })] }), _jsxs(Paper, { variant: "outlined", sx: { p: 2, mb: 2, borderRadius: 2 }, children: [_jsxs(Box, { sx: { display: 'flex', gap: 2 }, children: [_jsx(Box, { sx: {
                                    width: 80, height: 80, borderRadius: 1.5, flexShrink: 0,
                                    bgcolor: 'action.hover', overflow: 'hidden',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    border: '1px solid', borderColor: 'divider',
                                }, children: currentResult.variant?.image_url
                                    ? _jsx("img", { src: currentResult.variant.image_url, alt: currentResult.variant.variant_title ?? 'Product', style: { width: '100%', height: '100%', objectFit: 'cover' } })
                                    : _jsx(Package, { size: 28, style: { opacity: 0.3 } }) }), _jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsx(Typography, { variant: "body2", fontWeight: 600, noWrap: true, children: currentResult.variant?.variant_title ?? 'Unknown product' }), currentResult.variant?.sku && (_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { fontFamily: 'monospace' }, children: currentResult.variant.sku })), currentResult.order && (_jsxs(Typography, { variant: "caption", color: "text.secondary", sx: { display: 'block', mt: 0.5 }, children: [currentResult.order.shipping_name, " \u00B7 ", currentResult.order.shipping_city, ", ", currentResult.order.shipping_country_code] })), _jsxs(Typography, { variant: "caption", sx: { fontFamily: 'monospace', fontSize: 10, color: 'success.main', display: 'block', mt: 0.5 }, children: [currentResult.lasyncro_unit_id, " \u2713"] })] })] }), totalCount > 1 && (_jsx(Box, { sx: { display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }, children: currentResult.line_items.map((item) => (_jsxs(Box, { sx: { position: 'relative' }, children: [_jsx(Box, { sx: {
                                        width: 36, height: 36, borderRadius: 1,
                                        bgcolor: 'action.hover', overflow: 'hidden',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        border: '1px solid',
                                        borderColor: item.pack_scanned ? 'success.main' : 'divider',
                                        opacity: item.pack_scanned ? 1 : 0.45,
                                        transition: 'all 0.2s',
                                    }, children: item.image_url
                                        ? _jsx("img", { src: item.image_url, alt: item.product_title, style: { width: '100%', height: '100%', objectFit: 'cover' } })
                                        : _jsx(Package, { size: 14, style: { opacity: 0.5 } }) }), item.pack_scanned && (_jsx(Box, { sx: {
                                        position: 'absolute', bottom: -3, right: -3,
                                        width: 14, height: 14, borderRadius: '50%',
                                        bgcolor: 'success.main',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }, children: _jsx(CheckCircle, { size: 9, color: "#fff" }) }))] }, item.lasyncro_line_item_id))) })), totalCount > 1 && !allScanned && (_jsxs(Alert, { severity: "warning", icon: _jsx(AlertTriangle, { size: 14 }), sx: { mt: 1.5, py: 0.5, fontSize: 12 }, children: ["Scan ", totalCount - scannedCount, " more ", totalCount - scannedCount === 1 ? 'item' : 'items', " before scanning the invoice"] }))] }), _jsxs(Box, { sx: {
                    display: 'flex', alignItems: 'center', gap: 1, mb: 2,
                    p: 1.25, borderRadius: 1.5,
                    bgcolor: printState === 'failed'
                        ? theme.palette.mode === 'dark' ? 'rgba(255,152,0,0.12)' : '#fff8e1'
                        : theme.palette.mode === 'dark' ? 'rgba(76,175,80,0.12)' : '#f1f8e9',
                    border: '1px solid',
                    borderColor: printState === 'failed' ? 'warning.main' : 'success.main',
                }, children: [printState === 'printing'
                        ? _jsx(CircularProgress, { size: 14, color: "success" })
                        : printState === 'printed'
                            ? _jsx(Printer, { size: 14, color: theme.palette.success.main })
                            : _jsx(PrinterCheck, { size: 14, color: theme.palette.warning.main }), _jsxs(Typography, { variant: "caption", fontWeight: 500, color: printState === 'failed' ? 'warning.dark' : 'success.dark', children: [printState === 'printing' && 'Preparing invoice + shipping label…', printState === 'printed' && 'Invoice sent to printer · shipping label opened', printState === 'failed' &&
                                'Printing incomplete — check the invoice printer and carrier setup. You can still proceed.'] })] }), scanError && (_jsx(Alert, { severity: "error", sx: { mb: 2, py: 0.5, fontSize: 13 }, children: scanError })), _jsx(Paper, { variant: "outlined", sx: { p: 2, mb: 2, borderRadius: 2 }, children: !allScanned && currentLineNeedsCount ? (_jsxs(Box, { children: [_jsx(Typography, { variant: "overline", color: "text.secondary", sx: { fontSize: 10 }, children: "Inspection count" }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5, mt: 1 }, children: [_jsxs(Typography, { variant: "body2", sx: { flex: 1, minWidth: 0 }, noWrap: true, children: [currentLine?.product_title ?? 'Unknown product', currentLine?.sku ? ` · ${currentLine.sku}` : ''] }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 }, children: [_jsx(Button, { size: "small", variant: "outlined", onClick: () => setCountQty((q) => Math.max(1, q - 1)), sx: { minWidth: 32, px: 0.5 }, children: "\u2212" }), _jsx(Typography, { variant: "body2", fontWeight: 600, sx: { minWidth: 24, textAlign: 'center' }, children: countQty }), _jsx(Button, { size: "small", variant: "outlined", onClick: () => setCountQty((q) => q + 1), sx: { minWidth: 32, px: 0.5 }, children: "+" })] }), _jsx(Button, { size: "small", variant: "contained", disabled: scanLoading, sx: { bgcolor: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: '6px', fontWeight: 600, '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }, onClick: async () => {
                                        if (!currentLine)
                                            return;
                                        setScanLoading(true);
                                        setScanError(null);
                                        try {
                                            await onPackCountConfirm({
                                                lasyncro_line_item_id: currentLine.lasyncro_line_item_id,
                                                lasyncro_variant_id: currentLine.lasyncro_variant_id,
                                                quantity_confirmed: countQty,
                                            });
                                            setCurrentResult((prev) => ({
                                                ...prev,
                                                line_items: prev.line_items.map((li) => li.lasyncro_line_item_id === currentLine.lasyncro_line_item_id
                                                    ? { ...li, pack_scanned: true }
                                                    : li),
                                            }));
                                            setCountQty(1);
                                        }
                                        catch (err) {
                                            const msg = err?.response?.data?.message ?? err?.message ?? 'Confirm failed — try again';
                                            setScanError(msg);
                                            errorTimerRef.current = setTimeout(() => setScanError(null), 3500);
                                        }
                                        finally {
                                            setScanLoading(false);
                                        }
                                    }, children: "Confirm" })] }), scanError && (_jsx(Alert, { severity: "error", sx: { mt: 1, py: 0.5, fontSize: 12 }, children: scanError }))] })) : (_jsx(ScanInput, { hint: scanHint, onSubmit: handleScan, disabled: scanLoading })) }), _jsx(Button, { size: "small", startIcon: _jsx(AlertTriangle, { size: 14 }), onClick: () => setProblemDialogOpen(true), sx: { color: 'text.secondary', fontSize: 12 }, children: "Report a problem" }), _jsxs(Dialog, { open: backNavDialogOpen, onClose: () => setBackNavDialogOpen(false), children: [_jsx(DialogTitle, { children: "Abandon pack session?" }), _jsx(DialogContent, { children: _jsxs(Typography, { variant: "body2", children: [scannedCount, " of ", totalCount, " items confirmed for this order. Leaving now requires re-scanning all items on return."] }) }), _jsxs(DialogActions, { children: [_jsx(Button, { onClick: () => setBackNavDialogOpen(false), children: "Stay" }), _jsx(Button, { color: "error", onClick: onComplete, children: "Abandon" })] })] }), _jsxs(Dialog, { open: problemDialogOpen, onClose: () => setProblemDialogOpen(false), fullWidth: true, maxWidth: "xs", children: [_jsx(DialogTitle, { children: "Report a problem" }), _jsx(DialogContent, { children: _jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }, children: [[
                                    { value: 'missing_item', label: 'Item missing at pack' },
                                    { value: 'product_defect', label: 'Product defect' },
                                    { value: 'packaging_defect', label: 'Packaging defect' },
                                ].map((opt) => (_jsx(Button, { variant: problemType === opt.value ? 'contained' : 'outlined', size: "small", onClick: () => setProblemType(opt.value), sx: { justifyContent: 'flex-start', borderRadius: 1.5,
                                        ...(problemType === opt.value && { bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)' } }) }, children: opt.label }, opt.value))), _jsx(TextField, { label: "Notes (optional)", size: "small", multiline: true, rows: 2, value: problemNotes, onChange: (e) => setProblemNotes(e.target.value) })] }) }), _jsxs(DialogActions, { children: [_jsx(Button, { onClick: () => setProblemDialogOpen(false), children: "Cancel" }), _jsx(Button, { variant: "contained", disabled: problemLoading, onClick: () => void handleReportProblem(), sx: { bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)' } }, children: problemLoading ? _jsx(CircularProgress, { size: 16 }) : 'Report' })] })] })] }));
}
//# sourceMappingURL=PackSessionPage.js.map