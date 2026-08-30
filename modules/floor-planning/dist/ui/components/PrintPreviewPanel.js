import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// modules/floor-planning/src/ui/components/PrintPreviewPanel.tsx
/**
 * PrintPreviewPanel — Barcodes tab right panel.
 *
 * Renders a first-sheet visual preview for any printable code and owns the
 * reviewer-visible print status machine. Data-shape agnostic since
 * SHOP-REV-01m cycle 2: callers map their rows to PrintableLabel and supply
 * their own format list, so the same panel serves both the Locations and
 * Products sub-tabs without forking.
 *
 * SHOP-REVIEW-BARCODE-PRINT-05 — reviewer-safe printing:
 *   - Print sends EVERY selected id (was: first sheet only). The server PDF
 *     paginates; this panel's visual grid stays a "sheet 1 of M" preview and
 *     says so.
 *   - The caller's onBatchPrint returns a PrintSubmitResult. On a browser
 *     fallback the returned Blob is kept in panel state and rendered as
 *     durable "Open printable PDF" / "Download PDF" controls — the basic
 *     browser path never depends on a delayed window.open. A best-effort
 *     auto-open is attempted but its failure cannot strand the reviewer.
 *   - Every branch has a visible status: PREPARING / BROWSER_READY /
 *     QZ_DISPATCHED / ERROR. Console logging is supplemental only.
 *   - Empty selection disables the Print button (the handler keeps a guard).
 *
 * Barcode type is Code128 for all formats.
 *
 * PRINT-02: format geometry here is duplicated server-side in
 * warehouseLabelPdf.SHEET_FORMATS and productLabelPdf.PRODUCT_FORMATS,
 * kept in sync by comment only. Drift means the preview lies about the
 * printed sheet. (Carried DEFER for this issue.)
 */
import { useEffect, useRef, useState } from 'react';
import { Box, Typography, Paper, Radio, RadioGroup, FormControlLabel, Button, Divider, } from '@mui/material';
import { Printer, ExternalLink, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import JsBarcode from 'jsbarcode';
/** Pixels per mm at 96dpi screen resolution */
const MM_TO_PX = 96 / 25.4;
function BarcodeSVG({ value, widthMm, heightMm }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current || !value)
            return;
        try {
            JsBarcode(ref.current, value, {
                format: 'CODE128',
                width: 1.2,
                height: Math.max(20, heightMm * MM_TO_PX * 0.45),
                displayValue: true,
                fontSize: 8,
                margin: 2,
                background: 'transparent',
            });
        }
        catch (e) {
            console.warn('[PrintPreviewPanel] JsBarcode failed for value:', value, e);
        }
    }, [value, heightMm]);
    return (_jsx("svg", { ref: ref, style: { width: '100%', height: 'auto', display: 'block' } }));
}
const REASON_HINT = {
    no_default_printer: 'No printer is configured, so the labels are ready to print in your browser.',
    qz_unavailable: 'The printer app is not running, so the labels are ready to print in your browser.',
    qz_failed: 'The printer did not accept the job, so the labels are ready to print in your browser.',
};
export function PrintPreviewPanel({ items, formats, defaultFormatId, emptyMessage, onBatchPrint }) {
    const [formatId, setFormatId] = useState(defaultFormatId);
    const format = formats.find((f) => f.id === formatId) ?? formats[0];
    const [status, setStatus] = useState('idle');
    const [message, setMessage] = useState('');
    const [pdfUrl, setPdfUrl] = useState(null);
    const pdfUrlRef = useRef(null);
    const downloadName = format.paperSize === 'thermal' || format.paperSize === '1x2'
        ? 'product-labels.pdf'
        : 'warehouse-labels.pdf';
    // Object-URL lifecycle (SHOP-REVIEW-BARCODE-PRINT-05 §16): one live URL at a
    // time, revoked when replaced and on unmount — never on a timer.
    function setPdf(blob) {
        if (pdfUrlRef.current) {
            URL.revokeObjectURL(pdfUrlRef.current);
            pdfUrlRef.current = null;
        }
        if (blob) {
            const url = URL.createObjectURL(blob);
            pdfUrlRef.current = url;
            setPdfUrl(url);
        }
        else {
            setPdfUrl(null);
        }
    }
    useEffect(() => () => {
        if (pdfUrlRef.current)
            URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
    }, []);
    // Selection changed → any prior outcome is stale.
    const selectionKey = items.map((i) => i.id).join('|');
    useEffect(() => {
        setStatus('idle');
        setMessage('');
        setPdf(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectionKey]);
    const sheetCount = Math.max(1, Math.ceil(items.length / format.labelsPerSheet));
    const previewSheet = items.slice(0, format.labelsPerSheet);
    const labelPxW = format.labelWidthMm * MM_TO_PX * 0.6; // 0.6 = preview scale
    const labelPxH = format.labelHeightMm * MM_TO_PX * 0.6;
    async function handlePrint() {
        // Defense-in-depth guard — the button is also disabled when empty.
        if (items.length === 0 || !onBatchPrint || status === 'preparing')
            return;
        setStatus('preparing');
        setMessage('');
        setPdf(null);
        try {
            // Send EVERY selected id — the server PDF paginates across sheets.
            const result = await onBatchPrint(items.map((i) => i.id), formatId);
            switch (result.outcome) {
                case 'dispatched':
                    setStatus('qz_dispatched');
                    setMessage(`Sent to ${result.printerName}`);
                    break;
                case 'browser': {
                    setPdf(result.blob);
                    setStatus('browser_ready');
                    setMessage(REASON_HINT[result.reason]);
                    // Best-effort convenience open — its failure cannot strand the user
                    // because the durable Open/Download controls are rendered below.
                    try {
                        if (pdfUrlRef.current)
                            window.open(pdfUrlRef.current, '_blank');
                    }
                    catch { /* ignored — controls remain */ }
                    break;
                }
                case 'empty':
                    setStatus('error');
                    setMessage('These labels are no longer available. Refresh the barcode list and try again.');
                    break;
                case 'error':
                default:
                    setStatus('error');
                    setMessage(result.outcome === 'error' && result.message
                        ? result.message
                        : 'Could not prepare the labels. Please try again.');
                    break;
            }
        }
        catch (e) {
            console.error('[PrintPreviewPanel] batch print failed', e);
            setStatus('error');
            setMessage('Could not prepare the labels. Please try again.');
        }
    }
    const emptySelection = items.length === 0;
    return (_jsxs(Box, { sx: { width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }, children: [_jsxs(Box, { children: [_jsxs(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.5 }, children: ["Print Preview", sheetCount > 1 ? ` — sheet 1 of ${sheetCount}` : ''] }), _jsx(Typography, { sx: { fontSize: 16, fontWeight: 600, color: 'var(--ink)' }, children: format.label })] }), _jsx(Paper, { variant: "outlined", sx: {
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: 'var(--surface)',
                    display: 'grid',
                    gridTemplateColumns: `repeat(${format.columns}, 1fr)`,
                    gap: '2px',
                    maxHeight: 320,
                    overflowY: 'auto',
                }, id: "lasyncro-print-sheet", children: previewSheet.length === 0 ? (_jsx(Box, { sx: { gridColumn: `1 / -1`, py: 4, textAlign: 'center' }, children: _jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)' }, children: emptyMessage }) })) : (previewSheet.map((item) => (_jsxs(Box, { className: "lsy-label", sx: {
                        width: labelPxW,
                        height: labelPxH,
                        border: '1px solid var(--rule)',
                        borderRadius: 0.5,
                        p: 0.5,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        bgcolor: '#fff',
                    }, children: [_jsx(BarcodeSVG, { value: item.code, widthMm: format.labelWidthMm, heightMm: format.labelHeightMm }), _jsx(Typography, { sx: { fontSize: 7, fontFamily: 'monospace', color: '#000', mt: 0.25, textAlign: 'center', lineHeight: 1.2 }, children: item.caption })] }, item.id)))) }), _jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)' }, children: [items.length, " label", items.length !== 1 ? 's' : '', " \u00B7 ", sheetCount, " sheet", sheetCount !== 1 ? 's' : '', " \u00B7 CODE128 \u00B7 ", format.paperSize === 'A4' ? 'A4' : format.paperSize] }), _jsx(Divider, {}), _jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }, children: "Format" }), _jsx(RadioGroup, { value: formatId, onChange: (_, v) => setFormatId(v), children: formats.map((f) => (_jsx(FormControlLabel, { value: f.id, control: _jsx(Radio, { size: "small", sx: { color: 'var(--ink-4)', '&.Mui-checked': { color: 'var(--accent)' }, py: 0.25 } }), label: _jsx(Typography, { sx: { fontSize: 12, color: 'var(--ink-3)' }, children: f.label }) }, f.id))) })] }), _jsx(Divider, {}), _jsx(Button, { fullWidth: true, onClick: handlePrint, disabled: emptySelection || status === 'preparing', startIcon: _jsx(Printer, { size: 15 }), sx: {
                    bgcolor: 'var(--accent)',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: 13,
                    py: 1.25,
                    borderRadius: 1.5,
                    textTransform: 'none',
                    '&:hover': { bgcolor: 'var(--accent-hover)' },
                    '&.Mui-disabled': { bgcolor: 'var(--rule)', color: 'var(--ink-4)' },
                }, children: status === 'preparing' ? 'Preparing…' : 'Print sheet' }), status === 'qz_dispatched' && (_jsxs(Box, { sx: { display: 'flex', gap: 0.75, alignItems: 'flex-start' }, children: [_jsx(CheckCircle2, { size: 14, color: "var(--accent)", style: { marginTop: 2, flexShrink: 0 } }), _jsx(Typography, { sx: { fontSize: 12, color: 'var(--ink-3)' }, children: message })] })), status === 'browser_ready' && pdfUrl && (_jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 0.75 }, children: [_jsxs(Typography, { sx: { fontSize: 12, color: 'var(--ink-3)' }, children: ["Ready to print in your browser. ", message] }), _jsxs(Box, { sx: { display: 'flex', gap: 0.75 }, children: [_jsx(Button, { component: "a", href: pdfUrl, target: "_blank", rel: "noopener noreferrer", size: "small", startIcon: _jsx(ExternalLink, { size: 13 }), sx: { textTransform: 'none', fontSize: 12, color: 'var(--accent)' }, children: "Open printable PDF" }), _jsx(Button, { component: "a", href: pdfUrl, download: downloadName, size: "small", startIcon: _jsx(Download, { size: 13 }), sx: { textTransform: 'none', fontSize: 12, color: 'var(--ink-3)' }, children: "Download PDF" })] })] })), status === 'error' && (_jsxs(Box, { sx: { display: 'flex', gap: 0.75, alignItems: 'flex-start' }, children: [_jsx(AlertTriangle, { size: 14, color: "var(--critical-ink)", style: { marginTop: 2, flexShrink: 0 } }), _jsx(Typography, { sx: { fontSize: 12, color: 'var(--critical-ink)' }, children: message })] })), _jsx(Typography, { sx: { fontSize: 10.5, color: 'var(--ink-4)', lineHeight: 1.4 }, children: "Printer app optional \u2014 labels can also be opened as a PDF and printed from your browser." })] }));
}
//# sourceMappingURL=PrintPreviewPanel.js.map