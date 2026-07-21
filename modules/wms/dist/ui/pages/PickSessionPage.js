import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// modules/wms/src/ui/pages/PickSessionPage.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Paper, Typography, Button, LinearProgress, Alert, Dialog, DialogTitle, DialogContent, DialogActions, TextField, useTheme, } from '@mui/material';
import { CheckCircle, AlertTriangle, MapPin, Package, Hash } from 'lucide-react';
import { useScanSourceDetector } from '../hooks/useScanSourceDetector.js';
// ─── Constants ───────────────────────────────────────────────────────────────
const EXCEPTION_LABELS = {
    item_missing: 'Item not found at location',
    short_pick: 'Short pick — fewer units than required',
    defect: 'Product defect',
    packaging_damage: 'Packaging damaged',
    wrong_item: 'Wrong item entirely',
    wrong_variant: 'Wrong variant (size / colour)',
    wrong_quantity: 'Wrong quantity on label',
    barcode_mismatch: 'Barcode mismatch',
    other: 'Other',
};
const NOTES_REQUIRED = ['barcode_mismatch', 'other'];
const QTY_REQUIRED = ['short_pick'];
// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Accept LOC-A-1-3-7 or A-1-3-7 against location_code A-1-3-7 */
function locationMatches(scanned, locationCode) {
    const n = scanned.trim().toUpperCase();
    const c = locationCode.trim().toUpperCase();
    return n === c || n === `LOC-${c}`;
}
/** "A-1-3-7" → "Lane A · Bin 7" */
function parseLocationLabel(code) {
    const parts = code.split('-');
    if (parts.length >= 2)
        return `Lane ${parts[0]} · Bin ${parts[parts.length - 1]}`;
    return code;
}
// ─── Component ───────────────────────────────────────────────────────────────
export default function PickSessionPage({ pickBatchId, lineItems, onComplete, onResolveBarcode, onConfirmScan, onReportException, onCreateProblemTask, onPickComplete, }) {
    const theme = useTheme();
    const { onInputChange, detectSourceAndReset, reset: resetScanDetector } = useScanSourceDetector();
    const locationInputRef = useRef(null);
    const productInputRef = useRef(null);
    const qtyInputRef = useRef(null);
    // WEB-PICK-UNIT-01: carries LSU- unit ID from product_scan into qty_confirm path.
    const resolvedUnitIdRef = useRef(undefined);
    const [phase, setPhase] = useState('brief');
    const [currentIndex, setCurrentIndex] = useState(0);
    const [locationInput, setLocationInput] = useState('');
    const [productInput, setProductInput] = useState('');
    const [qtyInput, setQtyInput] = useState('');
    const [scanError, setScanError] = useState(null);
    const [scanProcessing, setScanProcessing] = useState(false);
    const [exceptionDialog, setExceptionDialog] = useState(false);
    const [exceptionType, setExceptionType] = useState(null);
    const [exceptionQty, setExceptionQty] = useState('');
    const [exceptionNotes, setExceptionNotes] = useState('');
    const [exceptionError, setExceptionError] = useState(null);
    const [exceptionProcessing, setExceptionProcessing] = useState(false);
    const [pickResults, setPickResults] = useState([]);
    const [completingPick, setCompletingPick] = useState(false);
    const [completionError, setCompletionError] = useState(null);
    const currentItem = lineItems[currentIndex];
    const totalUnits = lineItems.reduce((sum, li) => sum + li.quantity, 0);
    const progress = lineItems.length > 0 ? Math.round((currentIndex / lineItems.length) * 100) : 0;
    const isLocationPhase = phase === 'location_scan';
    const isProductPhase = phase === 'product_scan';
    const isQtyPhase = phase === 'qty_confirm';
    const needsQtyConfirm = (currentItem?.quantity ?? 1) > 1;
    // ── Focus management ───────────────────────────────────────
    useEffect(() => {
        if (phase === 'location_scan')
            setTimeout(() => locationInputRef.current?.focus(), 50);
        if (phase === 'product_scan')
            setTimeout(() => productInputRef.current?.focus(), 50);
        if (phase === 'qty_confirm')
            setTimeout(() => qtyInputRef.current?.focus(), 50);
    }, [phase, currentIndex]);
    useEffect(() => {
        if (!scanError)
            return;
        if (phase === 'location_scan')
            setTimeout(() => locationInputRef.current?.focus(), 50);
        if (phase === 'product_scan')
            setTimeout(() => productInputRef.current?.focus(), 50);
        if (phase === 'qty_confirm')
            setTimeout(() => qtyInputRef.current?.focus(), 50);
    }, [scanError, phase]);
    // ── Advance / summary ──────────────────────────────────────
    const advanceOrSummary = useCallback(() => {
        if (currentIndex >= lineItems.length - 1) {
            setPhase('summary');
        }
        else {
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
    const handleLocationScan = useCallback((value) => {
        if (!currentItem)
            return;
        setScanError(null);
        if (locationMatches(value, currentItem.location_code)) {
            setPhase('product_scan');
        }
        else {
            setScanError(`Wrong location. Expected ${currentItem.location_code} — try again.`);
        }
    }, [currentItem]);
    // ── Product scan ───────────────────────────────────────────
    const handleProductScan = useCallback(async (value) => {
        if (!currentItem)
            return;
        setScanProcessing(true);
        setScanError(null);
        try {
            const result = await onResolveBarcode(value.trim());
            if (result?.lasyncro_variant_id === currentItem.lasyncro_variant_id) {
                resolvedUnitIdRef.current = result.lasyncro_unit_id;
                if (currentItem.quantity > 1) {
                    setPhase('qty_confirm');
                }
                else {
                    await onConfirmScan({
                        lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
                        lasyncro_variant_id: currentItem.lasyncro_variant_id,
                        location_code: currentItem.location_code,
                        quantity_confirmed: currentItem.quantity,
                        scan_source: detectSourceAndReset(),
                        lasyncro_unit_id: result.lasyncro_unit_id,
                    });
                    setPickResults(prev => [...prev, { lineItem: currentItem, status: 'picked' }]);
                    setTimeout(advanceOrSummary, 400);
                }
            }
            else {
                setScanError('Wrong item — barcode does not match. Check you are at the right bin.');
            }
        }
        catch (err) {
            const msg = err?.response?.data?.error ?? (err instanceof Error ? err.message : 'Scan failed. Try again.');
            setScanError(msg);
        }
        finally {
            setScanProcessing(false);
        }
    }, [currentItem, onResolveBarcode, onConfirmScan, detectSourceAndReset, advanceOrSummary]);
    const handleQtyConfirm = useCallback(() => {
        if (!currentItem)
            return;
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
            lasyncro_variant_id: currentItem.lasyncro_variant_id,
            location_code: currentItem.location_code,
            quantity_confirmed: currentItem.quantity,
            scan_source: detectSourceAndReset(),
            lasyncro_unit_id: resolvedUnitIdRef.current,
        })
            .then(() => {
            setPickResults(prev => [...prev, { lineItem: currentItem, status: 'picked' }]);
            setQtyInput('');
            setTimeout(advanceOrSummary, 400);
        })
            .catch((err) => {
            const msg = err?.response?.data?.error ?? 'Confirm failed. Try again.';
            setScanError(msg);
        })
            .finally(() => setScanProcessing(false));
    }, [currentItem, qtyInput, onConfirmScan, detectSourceAndReset, advanceOrSummary]);
    // ── Exception report ───────────────────────────────────────
    const handleReportException = useCallback(() => {
        if (!currentItem || !exceptionType)
            return;
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
            lasyncro_variant_id: currentItem.lasyncro_variant_id,
            exception_type: exceptionType,
            quantity_required: currentItem.quantity,
            quantity_found: qtyFound,
            notes: exceptionNotes.trim() || undefined,
        })
            .then(() => onCreateProblemTask({
            lasyncro_variant_id: currentItem.lasyncro_variant_id,
            quantity: currentItem.quantity - qtyFound,
            exception_type: exceptionType,
            source: 'pick',
        }))
            .then(() => {
            setPickResults(prev => [...prev, { lineItem: currentItem, status: 'exception', exceptionType }]);
            setExceptionDialog(false);
            setExceptionType(null);
            setExceptionQty('');
            setExceptionNotes('');
            advanceOrSummary();
        })
            .catch((err) => {
            const msg = err?.response?.data?.error ?? 'Exception report failed. Try again.';
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
            .catch((err) => {
            const msg = err?.response?.data?.error ?? 'Pick complete failed. Retry when connection is restored.';
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
        return (_jsxs(Box, { sx: { p: 2, maxWidth: 480, mx: 'auto' }, children: [_jsx(Typography, { variant: "h6", fontWeight: 600, sx: { mb: 0.5 }, children: "Pick Session" }), _jsxs(Typography, { variant: "body2", color: "text.secondary", sx: { mb: 3 }, children: ["Batch ", pickBatchId.slice(-6).toUpperCase()] }), _jsxs(Paper, { variant: "outlined", sx: { borderRadius: 2, p: 2, mb: 2, display: 'flex', gap: 2 }, children: [_jsxs(Box, { sx: { flex: 1, textAlign: 'center' }, children: [_jsx(Typography, { variant: "h4", fontWeight: 600, children: lineItems.length }), _jsx(Typography, { variant: "caption", color: "text.secondary", children: "Line items" })] }), _jsxs(Box, { sx: { flex: 1, textAlign: 'center' }, children: [_jsx(Typography, { variant: "h4", fontWeight: 600, children: totalUnits }), _jsx(Typography, { variant: "caption", color: "text.secondary", children: "Total units" })] })] }), _jsx(Alert, { icon: false, sx: { mb: 3, borderRadius: 2 }, children: "Items are sorted by optimized pick route. For each item: scan the bin barcode first, then scan the product barcode to confirm." }), _jsx(Button, { variant: "contained", fullWidth: true, size: "large", onClick: () => setPhase('location_scan'), sx: {
                        borderRadius: '6px',
                        fontWeight: 600,
                        bgcolor: 'var(--accent)',
                        '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                    }, children: "Start Picking" })] }));
    }
    // ── SUMMARY ────────────────────────────────────────────────
    if (phase === 'summary') {
        const pickedCount = pickResults.filter(r => r.status === 'picked').length;
        const exceptionCount = pickResults.filter(r => r.status === 'exception').length;
        return (_jsxs(Box, { sx: { p: 2, maxWidth: 480, mx: 'auto' }, children: [_jsx(Typography, { variant: "h6", fontWeight: 600, sx: { mb: 0.5 }, children: "Pick Summary" }), _jsx(Typography, { variant: "body2", color: "text.secondary", sx: { mb: 2 }, children: "Review before confirming" }), _jsxs(Box, { sx: { display: 'flex', gap: 1.5, mb: 2 }, children: [_jsxs(Paper, { variant: "outlined", sx: { flex: 1, borderRadius: 2, p: 1.5, textAlign: 'center' }, children: [_jsx(Typography, { variant: "h5", fontWeight: 600, color: "success.main", children: pickedCount }), _jsx(Typography, { variant: "caption", color: "text.secondary", children: "Picked" })] }), exceptionCount > 0 && (_jsxs(Paper, { variant: "outlined", sx: { flex: 1, borderRadius: 2, p: 1.5, textAlign: 'center' }, children: [_jsx(Typography, { variant: "h5", fontWeight: 600, color: "warning.main", children: exceptionCount }), _jsx(Typography, { variant: "caption", color: "text.secondary", children: "Exceptions" })] }))] }), exceptionCount > 0 && (_jsxs(Alert, { icon: false, severity: "warning", sx: { mb: 2, borderRadius: 2 }, children: [exceptionCount, " item", exceptionCount > 1 ? 's' : '', " reported as exceptions \u2014 routed to Problem Center."] })), _jsx(Box, { sx: { mb: 2, display: 'flex', flexDirection: 'column', gap: 1 }, children: pickResults.map(({ lineItem, status, exceptionType: et }) => (_jsxs(Paper, { variant: "outlined", sx: { borderRadius: 2, p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }, children: [status === 'picked' ? (_jsx(CheckCircle, { size: 18, color: theme.palette.success.main })) : (_jsx(AlertTriangle, { size: 18, color: theme.palette.warning.main })), _jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsx(Typography, { variant: "body2", fontWeight: 500, noWrap: true, children: lineItem.product_title }), lineItem.variant_title && (_jsx(Typography, { variant: "caption", color: "text.secondary", children: lineItem.variant_title }))] }), _jsxs(Box, { sx: { textAlign: 'right', flexShrink: 0 }, children: [_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { fontFamily: 'monospace', display: 'block' }, children: lineItem.location_code }), status === 'exception' && et && (_jsx(Typography, { variant: "caption", color: "warning.main", display: "block", children: EXCEPTION_LABELS[et] }))] })] }, lineItem.lasyncro_line_item_id))) }), completionError && (_jsx(Alert, { severity: "error", sx: { mb: 2, borderRadius: 2 }, children: completionError })), _jsx(Button, { variant: "contained", fullWidth: true, size: "large", onClick: handlePickComplete, disabled: completingPick, sx: {
                        borderRadius: '6px',
                        fontWeight: 600,
                        bgcolor: 'var(--accent)',
                        '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                    }, children: completingPick ? 'Confirming…' : 'Confirm Pick Complete' })] }));
    }
    // ── DONE ───────────────────────────────────────────────────
    if (phase === 'done') {
        return (_jsxs(Box, { sx: {
                height: '100dvh',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                p: 3,
            }, children: [_jsx(CheckCircle, { size: 56, color: theme.palette.success.main }), _jsx(Typography, { variant: "h6", fontWeight: 600, sx: { mt: 2 }, children: "Pick Complete" }), _jsxs(Typography, { variant: "body2", color: "text.secondary", sx: { mt: 1, textAlign: 'center' }, children: [lineItems.length, " items processed. Batch ready for pack."] })] }));
    }
    // ── INSPECT PHASES (location_scan + product_scan) ──────────
    if (!currentItem)
        return null;
    const variantPills = currentItem.variant_title
        ? currentItem.variant_title.split('/').map(s => s.trim()).filter(Boolean)
        : [];
    return (_jsxs(Box, { sx: { height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }, children: [_jsxs(Box, { sx: { px: 2, pt: 1.5, pb: 1 }, children: [_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', mb: 0.5 }, children: [_jsxs(Typography, { variant: "caption", color: "text.secondary", children: ["Item ", currentIndex + 1, " of ", lineItems.length] }), _jsxs(Typography, { variant: "caption", color: "text.secondary", children: ["Batch ", pickBatchId.slice(-6).toUpperCase()] })] }), _jsx(LinearProgress, { variant: "determinate", value: progress, sx: {
                            borderRadius: 1, height: 3,
                            bgcolor: 'action.hover',
                            '& .MuiLinearProgress-bar': { bgcolor: 'var(--accent)' },
                        } })] }), _jsx(Alert, { icon: false, sx: { mx: 2, mt: 1, py: 0.5, borderRadius: 2, fontSize: 12 }, children: isLocationPhase
                    ? `Step 1 of ${needsQtyConfirm ? 3 : 2} — Walk to the location and scan the bin barcode.`
                    : isProductPhase
                        ? `Step 2 of ${needsQtyConfirm ? 3 : 2} — Find the item and scan the product barcode.`
                        : 'Step 3 of 3 — Count the units and confirm the quantity.' }), _jsx(Paper, { variant: "outlined", sx: { mx: 2, mt: 1.5, p: 2, borderRadius: 2, bgcolor: 'background.default' }, children: _jsxs(Box, { sx: { position: 'relative', height: 100 }, children: [_jsx(Box, { sx: {
                                position: 'absolute', left: 0, right: 0, top: 19,
                                height: 3, bgcolor: 'action.disabledBackground', borderRadius: 1, overflow: 'hidden',
                            }, children: _jsx(Box, { sx: {
                                    height: '100%',
                                    width: isLocationPhase ? '0%'
                                        : isProductPhase ? (needsQtyConfirm ? '50%' : '66%')
                                            : isQtyPhase ? '75%'
                                                : '100%',
                                    bgcolor: theme.palette.success.main,
                                    borderRadius: 1,
                                    transition: 'width 0.55s ease',
                                } }) }), _jsx(Box, { sx: { position: 'absolute', left: needsQtyConfirm ? 'calc(25% - 20px)' : 'calc(33% - 20px)', top: 0, width: 40 }, children: _jsx(Box, { sx: {
                                    width: 40, height: 40, borderRadius: '50%',
                                    bgcolor: isLocationPhase ? 'var(--accent)' : theme.palette.success.main,
                                    border: `2.5px solid ${isLocationPhase ? 'var(--accent)' : theme.palette.success.main}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'background 0.3s, border-color 0.3s',
                                    ...(isLocationPhase && {
                                        '@keyframes pickNodePulse': {
                                            '0%': { boxShadow: '0 0 0 0 rgba(255,107,43,0.55)' },
                                            '70%': { boxShadow: '0 0 0 10px rgba(255,107,43,0)' },
                                            '100%': { boxShadow: '0 0 0 0 rgba(255,107,43,0)' },
                                        },
                                        animation: 'pickNodePulse 1.3s ease-out infinite',
                                    }),
                                }, children: isLocationPhase ? _jsx(MapPin, { size: 18, color: "white" }) : _jsx(CheckCircle, { size: 18, color: "white" }) }) }), _jsxs(Box, { sx: { position: 'absolute', left: needsQtyConfirm ? 'calc(25% - 50px)' : 'calc(33% - 50px)', top: 48, width: 100, textAlign: 'center' }, children: [_jsx(Typography, { sx: { fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: isLocationPhase ? 'var(--accent)' : theme.palette.success.main, mb: 0.5, transition: 'color 0.3s' }, children: isLocationPhase ? 'Scan Location' : '✓ Confirmed' }), _jsx(Typography, { sx: { fontSize: 13, fontWeight: 500, fontFamily: 'monospace', color: 'text.primary' }, children: currentItem.location_code })] }), _jsx(Box, { sx: { position: 'absolute', left: needsQtyConfirm ? 'calc(50% - 20px)' : 'calc(66% - 20px)', top: 0, width: 40 }, children: _jsx(Box, { sx: {
                                    width: 40, height: 40, borderRadius: '50%',
                                    bgcolor: isLocationPhase ? 'background.paper' : isProductPhase ? 'var(--accent)' : theme.palette.success.main,
                                    border: `2.5px solid ${isLocationPhase ? theme.palette.divider : isProductPhase ? 'var(--accent)' : theme.palette.success.main}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'background 0.3s, border-color 0.3s',
                                    ...(isProductPhase && {
                                        '@keyframes pickNodePulse': {
                                            '0%': { boxShadow: '0 0 0 0 rgba(255,107,43,0.55)' },
                                            '70%': { boxShadow: '0 0 0 10px rgba(255,107,43,0)' },
                                            '100%': { boxShadow: '0 0 0 0 rgba(255,107,43,0)' },
                                        },
                                        animation: 'pickNodePulse 1.3s ease-out infinite',
                                    }),
                                }, children: isLocationPhase
                                    ? _jsx(Package, { size: 18, color: theme.palette.text.disabled })
                                    : isProductPhase
                                        ? _jsx(Package, { size: 18, color: "white" })
                                        : _jsx(CheckCircle, { size: 18, color: "white" }) }) }), _jsxs(Box, { sx: { position: 'absolute', left: needsQtyConfirm ? 'calc(50% - 50px)' : 'calc(66% - 50px)', top: 48, width: 100, textAlign: 'center' }, children: [_jsx(Typography, { sx: { fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: isLocationPhase ? 'text.disabled' : isProductPhase ? 'var(--accent)' : theme.palette.success.main, mb: 0.5, transition: 'color 0.3s' }, children: isLocationPhase ? 'Up next' : isProductPhase ? 'Scan Item' : '✓ Confirmed' }), _jsx(Typography, { sx: { fontSize: 11, fontWeight: 500, color: 'text.primary', lineHeight: 1.3 }, noWrap: true, children: currentItem.product_title }), (currentItem.unit_ids ?? []).length > 0 && (_jsx(Box, { sx: { mt: 0.5, display: 'flex', justifyContent: 'center' }, children: _jsx(Box, { sx: { fontSize: 9, px: 0.75, py: 0.25, border: '0.5px solid', borderColor: 'var(--accent)', borderRadius: '3px', fontFamily: 'monospace', color: 'var(--accent)', bgcolor: 'background.paper' }, children: currentItem.unit_ids[0] }) }))] }), needsQtyConfirm && (_jsxs(_Fragment, { children: [_jsx(Box, { sx: { position: 'absolute', left: 'calc(75% - 20px)', top: 0, width: 40 }, children: _jsx(Box, { sx: {
                                            width: 40, height: 40, borderRadius: '50%',
                                            bgcolor: isQtyPhase ? 'var(--accent)' : 'background.paper',
                                            border: `2.5px solid ${isQtyPhase ? 'var(--accent)' : theme.palette.divider}`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            transition: 'background 0.3s, border-color 0.3s',
                                            ...(isQtyPhase && {
                                                '@keyframes pickNodePulse': {
                                                    '0%': { boxShadow: '0 0 0 0 rgba(255,107,43,0.55)' },
                                                    '70%': { boxShadow: '0 0 0 10px rgba(255,107,43,0)' },
                                                    '100%': { boxShadow: '0 0 0 0 rgba(255,107,43,0)' },
                                                },
                                                animation: 'pickNodePulse 1.3s ease-out infinite',
                                            }),
                                        }, children: _jsx(Hash, { size: 18, color: isQtyPhase ? 'white' : theme.palette.text.disabled }) }) }), _jsxs(Box, { sx: { position: 'absolute', left: 'calc(75% - 50px)', top: 48, width: 100, textAlign: 'center' }, children: [_jsx(Typography, { sx: { fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: isQtyPhase ? 'var(--accent)' : 'text.disabled', mb: 0.5, transition: 'color 0.3s' }, children: isQtyPhase ? 'Confirm Qty' : 'Up next' }), _jsxs(Typography, { sx: { fontSize: 13, fontWeight: 500, color: 'text.primary' }, children: ["\u00D7", currentItem.quantity] })] })] }))] }) }), (isProductPhase || isQtyPhase) && (_jsx(Paper, { variant: "outlined", sx: { mx: 2, mt: 1.5, borderRadius: 2, overflow: 'hidden' }, children: _jsxs(Box, { sx: { p: 1.5, display: 'flex', gap: 1.5, alignItems: 'flex-start' }, children: [currentItem.image_url ? (_jsx(Box, { component: "img", src: currentItem.image_url, alt: currentItem.product_title, sx: { width: 56, height: 56, objectFit: 'cover', borderRadius: 1, flexShrink: 0 } })) : (_jsx(Box, { sx: { width: 56, height: 56, borderRadius: 1, bgcolor: 'action.hover', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: _jsx(Package, { size: 22, color: "var(--ink3, #9ca3af)" }) })), _jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsx(Typography, { sx: { fontSize: 13, fontWeight: 600, lineHeight: 1.3 }, noWrap: true, children: currentItem.product_title }), currentItem.variant_title && (_jsx(Typography, { sx: { fontSize: 11, color: 'text.secondary', mt: 0.25 }, noWrap: true, children: currentItem.variant_title })), _jsxs(Box, { sx: { mt: 0.75, display: 'flex', alignItems: 'center', gap: 0.5 }, children: [_jsx(MapPin, { size: 11, color: "var(--accent)" }), _jsx(Typography, { sx: { fontSize: 11, fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 500 }, children: currentItem.location_code })] }), (currentItem.unit_ids ?? []).length > 0 && (_jsxs(Box, { sx: { mt: 0.75 }, children: [_jsx(Typography, { sx: { fontSize: 9, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: '0.07em', mb: 0.5 }, children: "LSU- codes for this pick" }), _jsxs(Box, { sx: { display: 'flex', flexWrap: 'wrap', gap: 0.5 }, children: [(currentItem.unit_ids ?? []).slice(0, 6).map((id) => (_jsx(Box, { sx: { fontSize: 9, px: 0.75, py: 0.25, border: '0.5px solid', borderColor: 'divider', borderRadius: '3px', fontFamily: 'monospace', color: 'text.secondary', bgcolor: 'background.paper' }, children: id }, id))), (currentItem.unit_ids ?? []).length > 6 && (_jsxs(Box, { sx: { fontSize: 9, px: 0.75, py: 0.25, border: '0.5px solid', borderColor: 'divider', borderRadius: '3px', color: 'text.disabled', bgcolor: 'background.paper' }, children: ["+", (currentItem.unit_ids ?? []).length - 6, " more"] }))] })] })), currentItem.sku && (_jsxs(Typography, { sx: { fontSize: 9, color: 'text.disabled', fontFamily: 'monospace', mt: 0.75 }, children: ["SKU: ", currentItem.sku] }))] })] }) })), _jsxs(Box, { sx: { mx: 2, mt: 1.5, flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }, children: [scanError && (_jsx(Alert, { severity: "error", sx: { borderRadius: 2, py: 0.5 }, children: scanError })), isLocationPhase && (_jsxs(Box, { sx: { display: 'flex', gap: 1 }, children: [_jsx(TextField, { inputRef: locationInputRef, fullWidth: true, size: "small", type: "text", placeholder: "Scan bin barcode or type location code", disabled: scanProcessing, value: locationInput, onChange: (e) => { setLocationInput(e.target.value); onInputChange(); }, onKeyDown: (e) => {
                                    if (e.key === 'Enter' && locationInput.trim()) {
                                        const val = locationInput.trim();
                                        setLocationInput('');
                                        handleLocationScan(val);
                                    }
                                }, helperText: "Scanner auto-submits \u00B7 manual entry: press Enter", autoComplete: "off" }), locationInput.trim() && (_jsx(Button, { variant: "contained", onClick: () => {
                                    const val = locationInput.trim();
                                    setLocationInput('');
                                    handleLocationScan(val);
                                }, sx: {
                                    bgcolor: 'var(--accent)', borderRadius: '6px', fontWeight: 600,
                                    '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                                    flexShrink: 0,
                                }, children: "Scan" }))] })), isProductPhase && (_jsxs(Box, { sx: { display: 'flex', gap: 1 }, children: [_jsx(TextField, { inputRef: productInputRef, fullWidth: true, size: "small", type: "text", placeholder: "Scan product barcode or type barcode value", disabled: scanProcessing, value: productInput, onChange: (e) => { setProductInput(e.target.value); onInputChange(); }, onKeyDown: (e) => {
                                    if (e.key === 'Enter' && productInput.trim()) {
                                        const val = productInput.trim();
                                        setProductInput('');
                                        handleProductScan(val).catch((err) => {
                                            const msg = err?.response?.data?.error ?? (err instanceof Error ? err.message : 'Scan failed.');
                                            setScanError(msg);
                                        });
                                    }
                                }, helperText: "Scanner auto-submits \u00B7 manual entry: press Enter", autoComplete: "off" }), productInput.trim() && (_jsx(Button, { variant: "contained", disabled: scanProcessing, onClick: () => {
                                    const val = productInput.trim();
                                    setProductInput('');
                                    handleProductScan(val).catch((err) => {
                                        const msg = err?.response?.data?.error ?? (err instanceof Error ? err.message : 'Scan failed.');
                                        setScanError(msg);
                                    });
                                }, sx: {
                                    bgcolor: 'var(--accent)', borderRadius: '6px', fontWeight: 600,
                                    '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                                    flexShrink: 0,
                                }, children: scanProcessing ? '…' : 'Scan' }))] })), isQtyPhase && (_jsx(Box, { children: _jsxs(Box, { sx: { display: 'flex', gap: 1 }, children: [_jsx(TextField, { inputRef: qtyInputRef, fullWidth: true, size: "small", type: "number", placeholder: `Count and enter qty (expected: ${currentItem.quantity})`, disabled: scanProcessing, value: qtyInput, onChange: (e) => setQtyInput(e.target.value), onKeyDown: (e) => {
                                        if (e.key === 'Enter' && qtyInput.trim())
                                            handleQtyConfirm();
                                    }, inputProps: { min: 1 }, helperText: `Expected ${currentItem.quantity} unit${currentItem.quantity > 1 ? 's' : ''} — count before confirming`, autoComplete: "off" }), _jsx(Button, { variant: "contained", disabled: scanProcessing || !qtyInput.trim(), onClick: handleQtyConfirm, sx: {
                                        bgcolor: 'var(--accent)', borderRadius: '6px', fontWeight: 600,
                                        '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                                        flexShrink: 0,
                                    }, children: scanProcessing ? '…' : 'Confirm' })] }) })), _jsx(Button, { variant: "outlined", fullWidth: true, size: "large", startIcon: _jsx(AlertTriangle, { size: 18 }), onClick: openExceptionDialog, sx: {
                            borderRadius: '6px', fontWeight: 600,
                            borderColor: 'var(--accent-border)', color: 'var(--accent)',
                            '&:hover': { borderColor: 'var(--accent)', bgcolor: 'var(--accent-ghost)' },
                        }, children: "Report problem" })] }), _jsxs(Dialog, { open: exceptionDialog, onClose: () => undefined, fullWidth: true, maxWidth: "xs", children: [_jsx(DialogTitle, { sx: { fontWeight: 600, fontSize: 16 }, children: "Report Problem" }), _jsxs(DialogContent, { children: [_jsxs(Typography, { variant: "body2", color: "text.secondary", sx: { mb: 2 }, children: [currentItem?.product_title, currentItem?.variant_title ? ` · ${currentItem.variant_title}` : ''] }), _jsx(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 0.75, mb: 2 }, children: Object.keys(EXCEPTION_LABELS).map((type) => (_jsx(Button, { variant: exceptionType === type ? 'contained' : 'outlined', fullWidth: true, size: "small", onClick: () => { setExceptionType(type); setExceptionError(null); }, sx: {
                                        justifyContent: 'flex-start',
                                        borderRadius: '6px',
                                        fontWeight: exceptionType === type ? 600 : 400,
                                        fontSize: 12,
                                        bgcolor: exceptionType === type ? 'var(--accent)' : 'transparent',
                                        borderColor: exceptionType === type ? 'var(--accent)' : 'divider',
                                        color: exceptionType === type ? 'white' : 'text.primary',
                                        '&:hover': {
                                            bgcolor: exceptionType === type ? 'var(--accent)' : 'action.hover',
                                            opacity: exceptionType === type ? 0.88 : 1,
                                            borderColor: exceptionType === type ? 'var(--accent)' : 'divider',
                                        },
                                    }, children: EXCEPTION_LABELS[type] }, type))) }), exceptionType && QTY_REQUIRED.includes(exceptionType) && (_jsx(TextField, { label: "Quantity found", type: "number", size: "small", fullWidth: true, value: exceptionQty, onChange: (e) => setExceptionQty(e.target.value), inputProps: { min: 0, max: currentItem ? currentItem.quantity - 1 : 99 }, sx: { mb: 1.5 } })), exceptionType && NOTES_REQUIRED.includes(exceptionType) && (_jsx(TextField, { label: "Notes (required)", size: "small", fullWidth: true, multiline: true, rows: 2, value: exceptionNotes, onChange: (e) => setExceptionNotes(e.target.value), sx: { mb: 1.5 } })), exceptionError && (_jsx(Alert, { severity: "error", sx: { borderRadius: 2 }, children: exceptionError }))] }), _jsxs(DialogActions, { sx: { px: 3, pb: 2, gap: 1 }, children: [_jsx(Button, { onClick: () => setExceptionDialog(false), sx: {
                                    color: 'text.secondary', fontWeight: 400, fontSize: 12,
                                    borderRadius: '6px', border: '0.5px solid var(--accent-border)',
                                    '&:hover': { bgcolor: 'action.hover' },
                                }, children: "Cancel" }), _jsx(Button, { variant: "contained", onClick: handleReportException, disabled: !exceptionType || exceptionProcessing, sx: {
                                    borderRadius: '6px', fontWeight: 600,
                                    bgcolor: 'var(--accent)',
                                    '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                                }, children: exceptionProcessing ? 'Reporting…' : 'Confirm Exception' })] })] })] }));
}
//# sourceMappingURL=PickSessionPage.js.map