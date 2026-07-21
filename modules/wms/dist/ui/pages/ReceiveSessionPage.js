import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
// modules/wms/src/ui/pages/ReceiveSessionPage.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Paper, Typography, Button, LinearProgress, Alert, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Chip, Table, TableBody, TableCell, TableHead, TableRow, useTheme, } from '@mui/material';
import { CheckCircle, AlertTriangle, PackageX, ScanBarcode, Hash, Package } from 'lucide-react';
const EXCEPTION_LABELS = {
    defect: 'Unit defect',
    packaging_damage: 'Packaging damaged',
    wrong_item: 'Wrong product',
    wrong_variant: 'Wrong variant',
    wrong_quantity: 'Wrong quantity',
    barcode_mismatch: 'Barcode mismatch',
    other: 'Other',
};
export default function ReceiveSessionPage({ receiveJobId, supplierName, lines, onInspectLine, onReportException, onCloseJob, onComplete, onResolveBarcode, onPrintUnitLabels, }) {
    const theme = useTheme();
    // ── Count mode state ───────────────────────────────────────────────────────
    const [currentIndex, setCurrentIndex] = useState(0);
    const [accepted, setAccepted] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState(null);
    const [exceptionDialog, setExceptionDialog] = useState(false);
    const [exceptionType, setExceptionType] = useState(null);
    const [exceptionNotes, setExceptionNotes] = useState('');
    const [exceptionQty, setExceptionQty] = useState('1');
    const [closing, setClosing] = useState(false);
    const [deliveryDate, setDeliveryDate] = useState('');
    const [closeDialog, setCloseDialog] = useState(false);
    // ── Scan mode state ────────────────────────────────────────────────────────
    // Initialise from backend state — supports session resume after refresh
    const initialScanCounts = {};
    const initialConfirmedLines = new Set();
    for (const line of lines) {
        if (line.inspection_complete) {
            initialConfirmedLines.add(line.receive_job_line_id);
            initialScanCounts[line.receive_job_line_id] = line.quantity_accepted ?? line.quantity_expected;
        }
    }
    // scanCounts: { [receive_job_line_id]: number } — units scanned per line
    const [scanCounts, setScanCounts] = useState(initialScanCounts);
    // confirmedLines: set of receive_job_line_ids that have been inspected
    const [confirmedLines, setConfirmedLines] = useState(initialConfirmedLines);
    // Resume brief screen only if no lines are already confirmed — otherwise go straight to inspect
    const hasPartialProgress = initialConfirmedLines.size > 0;
    const [scanError, setScanError] = useState(null);
    const [scanProcessing, setScanProcessing] = useState(false);
    // overcountLine: holds line that was scanned over expected qty — triggers dialog
    const [overcountLine, setOvercountLine] = useState(null);
    const scanInputRef = useRef(null);
    const [flashLine, setFlashLine] = useState(null);
    const [scanInputValue, setScanInputValue] = useState('');
    // ── Session phase + mode ───────────────────────────────────────────────────
    // Persist inspect mode in sessionStorage — survives refresh within the same tab
    const storedMode = sessionStorage.getItem(`receive-mode-${receiveJobId}`);
    const [inspectMode, setInspectMode] = useState(storedMode === 'scan' && onResolveBarcode ? 'scan'
        : hasPartialProgress && onResolveBarcode ? 'scan'
            : 'count');
    // Skip brief screen if resuming a partially-completed session
    const [sessionPhase, setSessionPhase] = useState(hasPartialProgress || storedMode ? 'inspect' : 'brief');
    // Auto-focus scan input when in scan mode
    useEffect(() => {
        if (sessionPhase === 'inspect' && inspectMode === 'scan') {
            scanInputRef.current?.focus();
        }
    }, [sessionPhase, inspectMode]);
    // Re-focus after error — error Alert renders and steals focus
    useEffect(() => {
        if (sessionPhase === 'inspect' && inspectMode === 'scan') {
            setTimeout(() => scanInputRef.current?.focus(), 50);
        }
    }, [scanError, sessionPhase, inspectMode]);
    const inspectAndPrint = useCallback(async (params) => {
        await onInspectLine(params);
        if (params.quantity_accepted > 0 && onPrintUnitLabels) {
            try {
                await onPrintUnitLabels(params.receive_job_line_id);
            }
            catch {
                // Print failure must never block the receive flow
                console.warn('[RECEIVE] Unit label print failed — non-blocking', params.receive_job_line_id);
            }
        }
    }, [onInspectLine, onPrintUnitLabels]);
    // ── Scan handler — free-scan: resolves barcode against all PO lines ────────
    const handleScan = useCallback(async (scannedValue) => {
        if (!onResolveBarcode || scanProcessing)
            return;
        setScanProcessing(true);
        setScanError(null);
        try {
            const resolved = await onResolveBarcode(scannedValue);
            if (!resolved?.lasyncro_variant_id) {
                setScanError(`Not recognised — no product matched for "${scannedValue}"`);
                return;
            }
            const matchedLine = lines.find((l) => l.lasyncro_variant_id === resolved.lasyncro_variant_id);
            if (!matchedLine) {
                setScanError(`Not in this PO — scanned barcode matches a different product`);
                return;
            }
            if (confirmedLines.has(matchedLine.receive_job_line_id)) {
                setScanError(`Already confirmed — ${matchedLine.sku ?? matchedLine.variant_title ?? 'this item'} is fully received`);
                return;
            }
            const current = scanCounts[matchedLine.receive_job_line_id] ?? 0;
            const next = current + 1;
            if (next > matchedLine.quantity_expected) {
                // Overcount — pause and confirm with operator
                setOvercountLine(matchedLine);
                return;
            }
            setScanCounts((prev) => ({ ...prev, [matchedLine.receive_job_line_id]: next }));
            // Flash the matched line green briefly as scan confirmation
            setFlashLine(matchedLine.receive_job_line_id);
            setTimeout(() => {
                setFlashLine(null);
                scanInputRef.current?.focus();
            }, 600);
            if (next === matchedLine.quantity_expected) {
                // Auto-confirm this line
                setScanProcessing(true);
                try {
                    await inspectAndPrint({
                        lasyncro_variant_id: matchedLine.lasyncro_variant_id,
                        receive_job_line_id: matchedLine.receive_job_line_id,
                        quantity_accepted: next,
                        quantity_rejected: 0,
                    });
                }
                catch (inspectErr) {
                    // 409 = already inspected — treat as confirmed, not an error
                    if (inspectErr?.response?.status !== 409)
                        throw inspectErr;
                }
                setConfirmedLines((prev) => new Set([...prev, matchedLine.receive_job_line_id]));
                setScanError(null);
                // Check if all lines confirmed
                const newConfirmed = new Set([...confirmedLines, matchedLine.receive_job_line_id]);
                if (newConfirmed.size === lines.length) {
                    setSessionPhase('summary');
                }
                else {
                    setTimeout(() => scanInputRef.current?.focus(), 50);
                }
            }
        }
        catch {
            setScanError('Scan failed — check connection and try again');
        }
        finally {
            setScanProcessing(false);
            scanInputRef.current?.focus();
        }
    }, [onResolveBarcode, scanProcessing, lines, confirmedLines, scanCounts, onInspectLine]);
    // ── Overcount confirm — add one more unit ──────────────────────────────────
    const handleOvercountAccept = useCallback(async () => {
        if (!overcountLine)
            return;
        const next = (scanCounts[overcountLine.receive_job_line_id] ?? 0) + 1;
        setScanCounts((prev) => ({ ...prev, [overcountLine.receive_job_line_id]: next }));
        setOvercountLine(null);
        scanInputRef.current?.focus();
    }, [overcountLine, scanCounts]);
    const handleOvercountReject = useCallback(() => {
        setOvercountLine(null);
        scanInputRef.current?.focus();
    }, []);
    // ── Shortfall modal state ──────────────────────────────────────────────────
    const [shortfallModal, setShortfallModal] = useState(null);
    const [shortfallExceptionType, setShortfallExceptionType] = useState(null);
    const [shortfallExceptionQty, setShortfallExceptionQty] = useState('');
    const [shortfallExceptionNotes, setShortfallExceptionNotes] = useState('');
    const [shortfallSubmitting, setShortfallSubmitting] = useState(false);
    const [shortfallQtyError, setShortfallQtyError] = useState(null);
    const currentLine = lines[currentIndex];
    const isLastLine = currentIndex === lines.length - 1;
    const progress = Math.round((currentIndex / lines.length) * 100);
    const rejected = currentLine ? Math.max(0, currentLine.quantity_expected - accepted) : 0;
    const totalCounted = accepted + rejected;
    const remaining = currentLine ? currentLine.quantity_expected - totalCounted : 0;
    const resetForNext = useCallback(() => {
        setAccepted(0);
        setSubmitError(null);
    }, []);
    const handleConfirmBatch = useCallback(async () => {
        if (!currentLine)
            return;
        // In scan mode — Confirm Batch advances to summary if all lines confirmed
        if (inspectMode === 'scan') {
            if (confirmedLines.size === lines.length) {
                setSessionPhase('summary');
            }
            else {
                setSubmitError(`${lines.length - confirmedLines.size} line${lines.length - confirmedLines.size > 1 ? 's' : ''} still need scanning before you can continue.`);
            }
            return;
        }
        const shortfall = currentLine.quantity_expected - accepted;
        // Shortfall detected — force exception reporting before allowing confirmation
        if (shortfall > 0) {
            setShortfallModal({
                line: currentLine,
                accepted,
                totalShortfall: shortfall,
                remainingShortfall: shortfall,
            });
            setShortfallExceptionType(null);
            setShortfallExceptionQty('');
            setShortfallExceptionNotes('');
            return;
        }
        // All units accounted — submit directly
        setSubmitting(true);
        setSubmitError(null);
        try {
            await inspectAndPrint({
                lasyncro_variant_id: currentLine.lasyncro_variant_id,
                receive_job_line_id: currentLine.receive_job_line_id,
                quantity_accepted: accepted,
                quantity_rejected: 0,
            });
            resetForNext();
            if (isLastLine) {
                setCloseDialog(true);
            }
            else {
                setCurrentIndex((i) => i + 1);
            }
        }
        catch (err) {
            setSubmitError(err?.message ?? 'Failed to confirm batch. Please retry.');
        }
        finally {
            setSubmitting(false);
        }
    }, [currentLine, accepted, isLastLine, onInspectLine, resetForNext]);
    // ── Submit inspection after all shortfall exceptions accounted for ─────────
    const submitInspectionAfterShortfall = useCallback(async (line, acceptedQty, totalShortfall) => {
        setShortfallSubmitting(true);
        try {
            await inspectAndPrint({
                lasyncro_variant_id: line.lasyncro_variant_id,
                receive_job_line_id: line.receive_job_line_id,
                quantity_accepted: acceptedQty,
                quantity_rejected: totalShortfall,
            });
            setShortfallModal(null);
            setShortfallExceptionType(null);
            setShortfallExceptionQty('');
            setShortfallExceptionNotes('');
            setShortfallQtyError(null);
            resetForNext();
            if (isLastLine) {
                setCloseDialog(true);
            }
            else {
                setCurrentIndex((i) => i + 1);
            }
        }
        catch (err) {
            setSubmitError(err?.message ?? 'Failed to submit inspection.');
        }
        finally {
            setShortfallSubmitting(false);
        }
    }, [onInspectLine, resetForNext, isLastLine]);
    // ── Shortfall modal confirm — report one exception chunk ───────────────────
    const handleShortfallConfirm = useCallback(async () => {
        if (!shortfallModal || !shortfallExceptionType)
            return;
        const qty = parseInt(shortfallExceptionQty, 10);
        if (!shortfallExceptionQty.trim() || isNaN(qty) || qty <= 0) {
            setShortfallQtyError('Enter a quantity to continue.');
            return;
        }
        if (qty > shortfallModal.remainingShortfall) {
            setShortfallQtyError(`Maximum is ${shortfallModal.remainingShortfall}.`);
            return;
        }
        setShortfallQtyError(null);
        const needsNotes = shortfallExceptionType === 'barcode_mismatch' || shortfallExceptionType === 'other';
        if (needsNotes && !shortfallExceptionNotes.trim())
            return;
        setShortfallSubmitting(true);
        try {
            await onReportException({
                lasyncro_variant_id: shortfallModal.line.lasyncro_variant_id,
                receive_job_line_id: shortfallModal.line.receive_job_line_id,
                exception_type: shortfallExceptionType,
                quantity_affected: qty,
                notes: shortfallExceptionNotes.trim() || `${qty} unit${qty > 1 ? 's' : ''} unaccounted during receive`,
            });
            const newRemaining = shortfallModal.remainingShortfall - qty;
            if (newRemaining > 0) {
                // More shortfall to account for — loop
                setShortfallModal((prev) => prev ? { ...prev, remainingShortfall: newRemaining } : null);
                setShortfallExceptionType(null);
                setShortfallExceptionQty('');
                setShortfallExceptionNotes('');
            }
            else {
                // All accounted — submit inspection
                await submitInspectionAfterShortfall(shortfallModal.line, shortfallModal.accepted, shortfallModal.totalShortfall);
            }
        }
        catch (err) {
            setSubmitError(err?.message ?? 'Failed to report exception.');
        }
        finally {
            setShortfallSubmitting(false);
        }
    }, [shortfallModal, shortfallExceptionType, shortfallExceptionQty, shortfallExceptionNotes, onReportException, submitInspectionAfterShortfall]);
    // ── Miscount escape hatch — accept full expected, no exception ─────────────
    const handleMiscount = useCallback(async () => {
        if (!shortfallModal)
            return;
        setShortfallModal(null);
        setAccepted(shortfallModal.line.quantity_expected);
        setShortfallSubmitting(true);
        try {
            await inspectAndPrint({
                lasyncro_variant_id: shortfallModal.line.lasyncro_variant_id,
                receive_job_line_id: shortfallModal.line.receive_job_line_id,
                quantity_accepted: shortfallModal.line.quantity_expected,
                quantity_rejected: 0,
            });
            resetForNext();
            if (isLastLine) {
                setCloseDialog(true);
            }
            else {
                setCurrentIndex((i) => i + 1);
            }
        }
        catch (err) {
            setSubmitError(err?.message ?? 'Failed to submit inspection.');
        }
        finally {
            setShortfallSubmitting(false);
        }
    }, [shortfallModal, onInspectLine, resetForNext, isLastLine]);
    const handleReportException = useCallback(async () => {
        if (!currentLine || !exceptionType)
            return;
        const needsNotes = exceptionType === 'barcode_mismatch' || exceptionType === 'other';
        if (needsNotes && !exceptionNotes.trim())
            return;
        try {
            await onReportException({
                lasyncro_variant_id: currentLine.lasyncro_variant_id,
                receive_job_line_id: currentLine.receive_job_line_id,
                exception_type: exceptionType,
                quantity_affected: parseInt(exceptionQty, 10) || 1,
                notes: exceptionNotes.trim() || undefined,
            });
        }
        catch (err) {
            console.error('[RECEIVE_SESSION] Exception report failed', err?.message);
        }
        finally {
            setExceptionDialog(false);
            setExceptionType(null);
            setExceptionNotes('');
            setExceptionQty('1');
        }
    }, [currentLine, exceptionType, exceptionNotes, exceptionQty, onReportException]);
    const handleCloseJob = useCallback(async () => {
        setClosing(true);
        try {
            await onCloseJob({ actual_delivery_date: deliveryDate || undefined });
            onComplete();
        }
        catch (err) {
            setSubmitError(err?.message ?? 'Failed to close receive job.');
            setClosing(false);
            setCloseDialog(false);
        }
    }, [deliveryDate, onCloseJob, onComplete]);
    const totalUnits = lines.reduce((s, l) => s + l.quantity_expected, 0);
    // ── BRIEF SCREEN ──────────────────────────────────────────────────────────
    if (sessionPhase === 'brief') {
        return (_jsxs(Box, { sx: { p: 3, maxWidth: 560, mx: 'auto' }, children: [_jsxs(Typography, { variant: "h6", fontWeight: 600, sx: { mb: 0.5 }, children: ["Receive from ", supplierName] }), _jsxs(Typography, { variant: "body2", color: "text.secondary", sx: { mb: 3 }, children: [lines.length, " variant", lines.length !== 1 ? 's' : '', " \u00B7 ", totalUnits, " units expected"] }), _jsx(Paper, { variant: "outlined", sx: { mb: 3, borderRadius: 2 }, children: _jsxs(Table, { size: "small", children: [_jsx(TableHead, { children: _jsxs(TableRow, { children: [_jsx(TableCell, { sx: { fontWeight: 600, fontSize: 11 }, children: "Product" }), _jsx(TableCell, { align: "right", sx: { fontWeight: 600, fontSize: 11 }, children: "Expected" })] }) }), _jsx(TableBody, { children: lines.map((line) => (_jsxs(TableRow, { children: [_jsx(TableCell, { sx: { fontSize: 12 }, children: _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 }, children: [line.image_url ? (_jsx(Box, { component: "img", src: line.image_url, alt: "", sx: { width: 36, height: 36, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 } })) : (_jsx(Box, { sx: { width: 36, height: 36, borderRadius: 0.5, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: _jsx(Package, { size: 16, style: { opacity: 0.4 } }) })), _jsxs(Box, { children: [_jsx(Typography, { variant: "body2", fontWeight: 600, noWrap: true, children: line.product_title ?? line.variant_title ?? line.description ?? line.sku ?? '—' }), line.sku && _jsx(Typography, { variant: "caption", color: "text.secondary", children: line.sku })] })] }) }), _jsx(TableCell, { align: "right", sx: { fontSize: 12 }, children: line.quantity_expected })] }, line.receive_job_line_id))) })] }) }), _jsx(Typography, { variant: "caption", fontWeight: 600, color: "text.secondary", sx: { mb: 1.5, display: 'block', letterSpacing: '0.08em', textTransform: 'uppercase' }, children: "How do you want to inspect?" }), _jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }, children: [_jsx(Paper, { variant: "outlined", onClick: () => { setInspectMode('count'); sessionStorage.setItem(`receive-mode-${receiveJobId}`, 'count'); }, sx: {
                                p: 2, borderRadius: 2, cursor: 'pointer',
                                borderColor: inspectMode === 'count' ? 'var(--accent)' : 'divider',
                                bgcolor: inspectMode === 'count' ? 'var(--accent-ghost)' : 'transparent',
                                transition: 'all 0.15s',
                            }, children: _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5 }, children: [_jsx(Hash, { size: 20, color: inspectMode === 'count' ? 'var(--accent)' : theme.palette.text.secondary }), _jsxs(Box, { children: [_jsx(Typography, { variant: "body2", fontWeight: 600, color: inspectMode === 'count' ? 'var(--accent)' : 'text.primary', children: "Count by hand" }), _jsx(Typography, { variant: "caption", color: "text.secondary", children: "Tap + for each accepted unit. Always available." })] })] }) }), _jsx(Paper, { variant: "outlined", onClick: () => { if (onResolveBarcode) {
                                setInspectMode('scan');
                                sessionStorage.setItem(`receive-mode-${receiveJobId}`, 'scan');
                            } }, sx: {
                                p: 2, borderRadius: 2,
                                cursor: onResolveBarcode ? 'pointer' : 'not-allowed',
                                opacity: onResolveBarcode ? 1 : 0.45,
                                borderColor: inspectMode === 'scan' ? 'var(--accent)' : 'divider',
                                bgcolor: inspectMode === 'scan' ? 'var(--accent-ghost)' : 'transparent',
                                transition: 'all 0.15s',
                            }, children: _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5 }, children: [_jsx(ScanBarcode, { size: 20, color: inspectMode === 'scan' ? 'var(--accent)' : theme.palette.text.secondary }), _jsxs(Box, { children: [_jsx(Typography, { variant: "body2", fontWeight: 600, color: inspectMode === 'scan' ? 'var(--accent)' : 'text.primary', children: "Scan barcodes" }), _jsxs(Typography, { variant: "caption", color: "text.secondary", children: ["Free-scan any unit \u2014 system matches it to the right PO line automatically.", !onResolveBarcode && ' (Not available — barcode resolver not connected)'] })] })] }) })] }), _jsx(Button, { variant: "contained", fullWidth: true, size: "large", onClick: () => setSessionPhase('inspect'), sx: { bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 600 }, children: "Start Receiving" })] }));
    }
    // ── SUMMARY SCREEN ────────────────────────────────────────────────────────
    if (sessionPhase === 'summary') {
        const totalAccepted = lines.reduce((s, l) => {
            if (inspectMode === 'scan')
                return s + (scanCounts[l.receive_job_line_id] ?? 0);
            return s + (confirmedLines.has(l.receive_job_line_id) ? (scanCounts[l.receive_job_line_id] ?? l.quantity_expected) : accepted);
        }, 0);
        const totalRejected = totalUnits - totalAccepted;
        return (_jsxs(Box, { sx: { p: 3, maxWidth: 560, mx: 'auto' }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }, children: [_jsx(CheckCircle, { size: 28, color: theme.palette.success.main }), _jsx(Typography, { variant: "h6", fontWeight: 600, children: "Inspection complete" })] }), _jsxs(Typography, { variant: "body2", color: "text.secondary", sx: { mb: 3 }, children: [supplierName, " \u00B7 ", lines.length, " variant", lines.length !== 1 ? 's' : ''] }), _jsx(Paper, { variant: "outlined", sx: { mb: 3, borderRadius: 2 }, children: _jsxs(Table, { size: "small", children: [_jsx(TableHead, { children: _jsxs(TableRow, { children: [_jsx(TableCell, { sx: { fontWeight: 600, fontSize: 11 }, children: "Product" }), _jsx(TableCell, { align: "right", sx: { fontWeight: 600, fontSize: 11 }, children: "Expected" }), _jsx(TableCell, { align: "right", sx: { fontWeight: 600, fontSize: 11 }, children: "Accepted" })] }) }), _jsxs(TableBody, { children: [lines.map((line) => {
                                        const lineAccepted = inspectMode === 'scan'
                                            ? (scanCounts[line.receive_job_line_id] ?? 0)
                                            : (confirmedLines.has(line.receive_job_line_id) ? line.quantity_expected : 0);
                                        const short = line.quantity_expected - lineAccepted;
                                        return (_jsxs(TableRow, { children: [_jsx(TableCell, { sx: { fontSize: 12 }, children: _jsx(Typography, { variant: "body2", fontWeight: 500, noWrap: true, children: line.variant_title && line.variant_title !== 'Default Title'
                                                            ? line.variant_title
                                                            : line.description ?? line.sku ?? '—' }) }), _jsx(TableCell, { align: "right", sx: { fontSize: 12 }, children: line.quantity_expected }), _jsx(TableCell, { align: "right", sx: { fontSize: 12 }, children: _jsx(Typography, { variant: "body2", color: short > 0 ? 'error' : 'success.main', fontWeight: 600, children: lineAccepted }) })] }, line.receive_job_line_id));
                                    }), _jsxs(TableRow, { children: [_jsx(TableCell, { sx: { fontWeight: 600, fontSize: 12 }, children: "Total" }), _jsx(TableCell, { align: "right", sx: { fontWeight: 600, fontSize: 12 }, children: totalUnits }), _jsx(TableCell, { align: "right", sx: { fontWeight: 600, fontSize: 12 }, children: _jsx(Typography, { variant: "body2", color: totalRejected > 0 ? 'error' : 'success.main', fontWeight: 600, children: totalAccepted }) })] })] })] }) }), totalRejected > 0 && (_jsxs(Alert, { severity: "warning", sx: { mb: 2 }, children: [totalRejected, " unit", totalRejected > 1 ? 's' : '', " short \u2014 exceptions have been logged to the Problem Center."] })), _jsx(TextField, { label: "Actual delivery date (optional)", type: "date", size: "small", fullWidth: true, value: deliveryDate, onChange: (e) => setDeliveryDate(e.target.value), InputLabelProps: { shrink: true }, sx: { mb: 2 } }), _jsx(Button, { variant: "contained", fullWidth: true, size: "large", disabled: closing, onClick: () => void handleCloseJob(), sx: { bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 600 }, children: closing ? 'Closing...' : 'Close & Create Stow Tasks' })] }));
    }
    // ── DONE SCREEN ───────────────────────────────────────────
    if (!currentLine && !closeDialog && sessionPhase === 'inspect' && inspectMode === 'count') {
        return (_jsxs(Box, { sx: { height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 3 }, children: [_jsx(CheckCircle, { size: 56, color: theme.palette.success.main }), _jsx(Typography, { variant: "h5", fontWeight: 700, sx: { mt: 2 }, children: "All variants inspected" }), _jsxs(Typography, { variant: "body2", color: "text.secondary", sx: { mt: 1, mb: 4, textAlign: 'center' }, children: [lines.length, " variant", lines.length !== 1 ? 's' : '', " processed from ", supplierName, "."] })] }));
    }
    return (_jsxs(Box, { sx: { height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }, children: [_jsxs(Box, { sx: { px: 2, pt: 1.5, pb: 1 }, children: [_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', mb: 0.5 }, children: [_jsxs(Typography, { variant: "caption", color: "text.secondary", children: ["Variant ", currentIndex + 1, " of ", lines.length, " \u2014 ", supplierName] }), _jsxs(Typography, { variant: "caption", color: "text.secondary", children: [progress, "%"] })] }), _jsx(LinearProgress, { variant: "determinate", value: progress, sx: { borderRadius: 1, height: 5 } })] }), _jsxs(Paper, { variant: "outlined", sx: { mx: 2, mt: 1.5, p: 2, borderRadius: 2, flex: '0 0 auto' }, children: [_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }, children: [_jsx(Typography, { variant: "overline", color: "text.secondary", sx: { fontSize: 10 }, children: inspectMode === 'scan' ? 'Scan mode' : 'Inspection count' }), inspectMode === 'scan' && (_jsxs(Box, { onClick: () => { setInspectMode('count'); sessionStorage.setItem(`receive-mode-${receiveJobId}`, 'count'); }, sx: {
                                    display: 'inline-flex', alignItems: 'center', gap: 0.5,
                                    px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500,
                                    color: 'var(--accent)', border: '0.5px solid var(--accent-border)',
                                    borderRadius: '6px', cursor: 'pointer',
                                    '&:hover': { opacity: 0.75 },
                                }, children: [_jsx(Hash, { size: 12 }), " Switch to count"] })), inspectMode === 'count' && onResolveBarcode && (_jsxs(Box, { onClick: () => { setInspectMode('scan'); sessionStorage.setItem(`receive-mode-${receiveJobId}`, 'scan'); }, sx: {
                                    display: 'inline-flex', alignItems: 'center', gap: 0.5,
                                    px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500,
                                    color: 'var(--accent)', border: '0.5px solid var(--accent-border)',
                                    borderRadius: '6px', cursor: 'pointer',
                                    '&:hover': { opacity: 0.75 },
                                }, children: [_jsx(ScanBarcode, { size: 12 }), " Switch to scan"] }))] }), inspectMode === 'scan' ? (_jsxs(Box, { children: [_jsx(Box, { sx: { mb: 2 }, children: lines.map((line) => {
                                    const count = scanCounts[line.receive_job_line_id] ?? 0;
                                    const isConfirmed = confirmedLines.has(line.receive_job_line_id);
                                    return (_jsxs(Box, { sx: {
                                            display: 'flex', alignItems: 'center', gap: 1, mb: 0.75,
                                            px: 1, py: 0.5, borderRadius: '6px',
                                            bgcolor: flashLine === line.receive_job_line_id
                                                ? 'rgba(34,197,94,0.15)'
                                                : 'transparent',
                                            transition: 'background-color 0.4s ease',
                                        }, children: [_jsx(Box, { sx: { flexShrink: 0 }, children: line.image_url ? (_jsx(Box, { component: "img", src: line.image_url, alt: "", sx: { width: 32, height: 32, objectFit: 'cover', borderRadius: 0.5 } })) : (_jsx(Box, { sx: { width: 32, height: 32, borderRadius: 0.5, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: _jsx(Package, { size: 14, style: { opacity: 0.4 } }) })) }), _jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsx(Typography, { variant: "caption", noWrap: true, color: isConfirmed ? 'success.main' : 'text.primary', fontWeight: isConfirmed ? 600 : 400, children: line.product_title ?? line.variant_title ?? line.description ?? '—' }), line.sku && _jsx(Typography, { variant: "caption", display: "block", color: "text.secondary", noWrap: true, children: line.sku })] }), _jsx(Chip, { label: `${count} / ${line.quantity_expected}`, size: "small", color: isConfirmed ? 'success' : count > 0 ? 'primary' : 'default', variant: isConfirmed ? 'filled' : 'outlined' }), isConfirmed && _jsx(CheckCircle, { size: 14, color: theme.palette.success.main })] }, line.receive_job_line_id));
                                }) }), hasPartialProgress && lines.some(l => !confirmedLines.has(l.receive_job_line_id) &&
                                (scanCounts[l.receive_job_line_id] ?? 0) === 0 &&
                                !l.inspection_complete) && (_jsx(Alert, { severity: "info", sx: { mb: 1.5, py: 0.5, fontSize: 12 }, children: "Session resumed \u2014 fully scanned lines are restored. Any partial scans must be re-scanned." })), _jsxs(Box, { sx: { display: 'flex', gap: 1, alignItems: 'flex-start' }, children: [_jsx(TextField, { inputRef: scanInputRef, fullWidth: true, size: "small", placeholder: "Scan barcode or type and press Enter", disabled: scanProcessing, value: scanInputValue, onChange: (e) => setScanInputValue(e.target.value), onKeyDown: (e) => {
                                            if (e.key === 'Enter') {
                                                const val = scanInputValue.trim();
                                                if (val) {
                                                    void handleScan(val);
                                                    setScanInputValue('');
                                                }
                                            }
                                        }, helperText: scanProcessing ? 'Processing...' : 'Scanner auto-submits · manual entry: press Enter or tap Scan', autoComplete: "off" }), scanInputValue.trim() && (_jsx(Button, { variant: "contained", size: "small", disabled: scanProcessing, onClick: () => {
                                            const val = scanInputValue.trim();
                                            if (val) {
                                                void handleScan(val);
                                                setScanInputValue('');
                                            }
                                        }, sx: {
                                            bgcolor: 'var(--accent)',
                                            '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                                            borderRadius: '6px',
                                            fontWeight: 600,
                                            whiteSpace: 'nowrap',
                                            mt: 0.25,
                                            minWidth: 64,
                                        }, children: "Scan" }))] }), scanError && (_jsx(Alert, { severity: "error", sx: { mt: 1, py: 0.5 }, onClose: () => setScanError(null), children: scanError }))] })) : (_jsx(Typography, { variant: "overline", color: "text.secondary", sx: { fontSize: 10 }, children: "Inspection count" })), inspectMode === 'count' && (_jsx(Box, { sx: { display: 'flex', gap: 2, mt: 1 }, children: _jsxs(Box, { sx: { flex: 1, textAlign: 'center' }, children: [_jsx(Typography, { variant: "caption", color: "success.main", fontWeight: 700, children: "Accepted" }), _jsx(Typography, { variant: "h3", fontWeight: 800, color: "success.main", children: accepted }), _jsxs(Box, { sx: { display: 'flex', gap: 1, justifyContent: 'center', mt: 1, alignItems: 'center' }, children: [_jsx(Button, { variant: "outlined", color: "success", size: "small", onClick: () => setAccepted((a) => Math.max(0, a - 1)), disabled: accepted === 0, sx: { minWidth: 36, px: 1 }, children: "\u2212" }), _jsx(TextField, { size: "small", value: accepted, onChange: (e) => {
                                                const v = parseInt(e.target.value, 10);
                                                if (!isNaN(v) && v >= 0 && currentLine && v <= currentLine.quantity_expected) {
                                                    setAccepted(v);
                                                }
                                            }, inputProps: { style: { textAlign: 'center', width: 48, fontWeight: 700 } }, sx: { width: 72 } }), _jsx(Button, { variant: "contained", color: "success", size: "small", onClick: () => setAccepted((a) => a + 1), sx: { minWidth: 36, px: 1 }, children: "+" })] }), _jsxs(Button, { size: "small", variant: "text", color: "success", onClick: () => currentLine && setAccepted(currentLine.quantity_expected), sx: { mt: 0.5, fontSize: 11 }, children: ["Set all (", currentLine?.quantity_expected, ")"] })] }) }))] }), _jsxs(Box, { sx: { mx: 2, mt: 1.5, flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }, children: [submitError && (_jsx(Alert, { severity: "error", sx: { py: 0.5 }, children: submitError })), _jsx(Button, { variant: "contained", color: "success", fullWidth: true, size: "large", disabled: submitting || (inspectMode === 'count' && totalCounted === 0), onClick: () => void handleConfirmBatch(), startIcon: _jsx(CheckCircle, { size: 20 }), sx: { borderRadius: 2, fontWeight: 700, py: 1.8, fontSize: 16 }, children: submitting ? 'Confirming...'
                            : inspectMode === 'scan' ? 'Finish & Review'
                                : isLastLine ? 'Confirm & Finish'
                                    : 'Confirm Batch' }), _jsx(Button, { variant: "outlined", color: "warning", fullWidth: true, size: "large", startIcon: _jsx(AlertTriangle, { size: 18 }), onClick: () => setExceptionDialog(true), sx: { borderRadius: 2, fontWeight: 600 }, children: "Report Problem" })] }), _jsxs(Dialog, { open: !!shortfallModal, onClose: () => {
                    // Only allow close if no exceptions have been committed yet
                    if (shortfallModal && shortfallModal.remainingShortfall === shortfallModal.totalShortfall) {
                        setShortfallModal(null);
                    }
                }, fullWidth: true, maxWidth: "sm", children: [_jsx(DialogTitle, { children: shortfallModal && shortfallModal.remainingShortfall < shortfallModal.totalShortfall
                            ? `${shortfallModal.remainingShortfall} unit${shortfallModal.remainingShortfall > 1 ? 's' : ''} still unaccounted`
                            : `${shortfallModal?.totalShortfall} unit${(shortfallModal?.totalShortfall ?? 0) > 1 ? 's' : ''} short — what happened?` }), _jsx(DialogContent, { children: _jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }, children: [_jsxs(Typography, { variant: "body2", color: "text.secondary", children: ["Expected ", shortfallModal?.line.quantity_expected, ", accepted ", shortfallModal?.accepted, ". Account for all ", shortfallModal?.remainingShortfall, " unit", (shortfallModal?.remainingShortfall ?? 0) > 1 ? 's' : '', " before continuing."] }), Object.keys(EXCEPTION_LABELS).map((type) => (_jsx(Button, { variant: shortfallExceptionType === type ? 'contained' : 'outlined', color: type === 'defect' || type === 'wrong_item' ? 'error' : 'warning', fullWidth: true, size: "large", onClick: () => setShortfallExceptionType(type), sx: { borderRadius: 2, justifyContent: 'flex-start' }, children: EXCEPTION_LABELS[type] }, type))), shortfallExceptionType && (_jsx(TextField, { label: `Qty affected (max ${shortfallModal?.remainingShortfall})`, type: "number", size: "small", value: shortfallExceptionQty, onChange: (e) => {
                                        setShortfallExceptionQty(e.target.value);
                                        setShortfallQtyError(null);
                                    }, inputProps: { min: 1, max: shortfallModal?.remainingShortfall }, fullWidth: true, error: !!shortfallQtyError, helperText: shortfallQtyError ?? undefined, placeholder: `Enter qty (max ${shortfallModal?.remainingShortfall})` })), (shortfallExceptionType === 'barcode_mismatch' || shortfallExceptionType === 'other') && (_jsx(TextField, { label: shortfallExceptionType === 'barcode_mismatch' ? 'Scanned barcode value' : 'Notes', value: shortfallExceptionNotes, onChange: (e) => setShortfallExceptionNotes(e.target.value), fullWidth: true, required: true, multiline: shortfallExceptionType === 'other', rows: shortfallExceptionType === 'other' ? 2 : 1, placeholder: shortfallExceptionType === 'barcode_mismatch' ? 'Enter the barcode printed on the unit' : 'Describe the problem' }))] }) }), _jsxs(DialogActions, { sx: { justifyContent: 'space-between', px: 3, pb: 2 }, children: [shortfallModal && shortfallModal.remainingShortfall === shortfallModal.totalShortfall && (_jsxs(Box, { onClick: () => !shortfallSubmitting && void handleMiscount(), sx: {
                                    display: 'inline-flex', alignItems: 'center',
                                    px: 1.25, py: 0.5,
                                    fontSize: 11, fontWeight: 500,
                                    color: 'var(--accent)',
                                    border: '0.5px solid var(--accent-border)',
                                    borderRadius: '6px', cursor: shortfallSubmitting ? 'not-allowed' : 'pointer',
                                    opacity: shortfallSubmitting ? 0.4 : 1,
                                    '&:hover': { opacity: shortfallSubmitting ? 0.4 : 0.75 },
                                }, children: ["I miscounted \u2014 accept all ", shortfallModal?.line.quantity_expected] })), _jsx(Button, { variant: "contained", disabled: !shortfallExceptionType || shortfallSubmitting, onClick: () => void handleShortfallConfirm(), sx: { bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 600 }, children: shortfallSubmitting ? 'Saving...' : 'Confirm exception' })] })] }), _jsxs(Dialog, { open: !!overcountLine, fullWidth: true, maxWidth: "sm", children: [_jsx(DialogTitle, { children: "Extra unit scanned" }), _jsx(DialogContent, { children: _jsxs(Typography, { variant: "body2", color: "text.secondary", children: ["You've already scanned ", overcountLine ? scanCounts[overcountLine.receive_job_line_id] ?? 0 : 0, " of ", overcountLine?.quantity_expected, " expected units for ", _jsx("strong", { children: overcountLine?.variant_title && overcountLine.variant_title !== 'Default Title'
                                        ? overcountLine.variant_title
                                        : overcountLine?.description ?? overcountLine?.sku ?? 'this product' }), ". Add another?"] }) }), _jsxs(DialogActions, { children: [_jsx(Button, { onClick: handleOvercountReject, color: "inherit", children: "No \u2014 skip it" }), _jsx(Button, { variant: "contained", onClick: () => void handleOvercountAccept(), sx: { bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 600 }, children: "Yes \u2014 add it" })] })] }), _jsxs(Dialog, { open: exceptionDialog, onClose: () => setExceptionDialog(false), fullWidth: true, children: [_jsx(DialogTitle, { children: "Report Problem" }), _jsx(DialogContent, { children: _jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }, children: [Object.keys(EXCEPTION_LABELS).map((type) => (_jsx(Button, { variant: exceptionType === type ? 'contained' : 'outlined', color: type === 'defect' || type === 'wrong_item' ? 'error' : 'warning', fullWidth: true, size: "large", startIcon: type === 'wrong_item' ? _jsx(PackageX, { size: 16 }) : _jsx(ScanBarcode, { size: 16 }), onClick: () => setExceptionType(type), sx: { borderRadius: 2, justifyContent: 'flex-start' }, children: EXCEPTION_LABELS[type] }, type))), exceptionType && (_jsx(TextField, { label: "Qty affected", type: "number", size: "small", value: exceptionQty, onChange: (e) => setExceptionQty(e.target.value), inputProps: { min: 1 }, fullWidth: true })), (exceptionType === 'barcode_mismatch' || exceptionType === 'other') && (_jsx(TextField, { label: exceptionType === 'barcode_mismatch' ? 'Scanned barcode value' : 'Notes', value: exceptionNotes, onChange: (e) => setExceptionNotes(e.target.value), fullWidth: true, required: true, multiline: exceptionType === 'other', rows: exceptionType === 'other' ? 2 : 1, placeholder: exceptionType === 'barcode_mismatch' ? 'Enter the barcode printed on the unit' : 'Describe the problem' }))] }) }), _jsxs(DialogActions, { children: [_jsx(Button, { onClick: () => { setExceptionDialog(false); setExceptionType(null); }, children: "Cancel" }), _jsx(Button, { variant: "contained", color: "warning", disabled: !exceptionType, onClick: () => void handleReportException(), children: "Report" })] })] }), _jsxs(Dialog, { open: closeDialog, fullWidth: true, children: [_jsx(DialogTitle, { children: "Close receive session" }), _jsx(DialogContent, { children: _jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }, children: [_jsx(Typography, { variant: "body2", color: "text.secondary", children: "All variants inspected. Closing the session will write received quantities and create stow tasks automatically." }), _jsx(TextField, { label: "Actual delivery date (optional)", type: "date", value: deliveryDate, onChange: (e) => setDeliveryDate(e.target.value), fullWidth: true, InputLabelProps: { shrink: true } })] }) }), _jsxs(DialogActions, { children: [_jsx(Button, { onClick: () => setCloseDialog(false), disabled: closing, children: "Cancel" }), _jsx(Button, { variant: "contained", color: "success", disabled: closing, onClick: () => void handleCloseJob(), children: closing ? 'Closing...' : 'Close & Create Stow Tasks' })] })] })] }));
}
//# sourceMappingURL=ReceiveSessionPage.js.map