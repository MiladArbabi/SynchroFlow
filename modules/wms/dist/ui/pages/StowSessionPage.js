import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// modules/wms/src/ui/pages/StowSessionPage.tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Paper, Typography, Button, Alert, Chip, Divider, Dialog, DialogTitle, DialogContent, DialogActions, TextField, useTheme, CircularProgress, IconButton, LinearProgress, alpha, } from '@mui/material';
import { CheckCircle, MapPin, Package, ArrowLeft, RotateCcw, Hash } from 'lucide-react';
const STOW_EXCEPTIONS = [
    { type: 'item_missing', label: 'Item missing' },
    { type: 'product_defect', label: 'Damaged' },
    { type: 'packaging_defect', label: 'Packaging issue' },
];
// ── Node track (matches pick UI pattern) ─────────────────────────────────────
function NodeTrack({ nodes }) {
    const theme = useTheme();
    return (_jsx(Box, { sx: { display: 'flex', alignItems: 'flex-start', mb: 3 }, children: nodes.map((node, i) => (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', flex: i < nodes.length - 1 ? 1 : 'none' }, children: [_jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 72 }, children: [_jsx(Box, { sx: {
                                width: 40, height: 40, borderRadius: '50%',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                bgcolor: node.state === 'confirmed'
                                    ? theme.palette.success.main
                                    : node.state === 'active'
                                        ? 'var(--accent)'
                                        : theme.palette.action.disabledBackground,
                                color: node.state === 'pending' ? theme.palette.text.disabled : '#fff',
                                ...(node.state === 'active' && {
                                    '@keyframes stowNodePulse': {
                                        '0%': { boxShadow: '0 0 0 0 rgba(255,107,43,0.55)' },
                                        '70%': { boxShadow: '0 0 0 10px rgba(255,107,43,0)' },
                                        '100%': { boxShadow: '0 0 0 0 rgba(255,107,43,0)' },
                                    },
                                    animation: 'stowNodePulse 1.3s ease-out infinite',
                                }),
                                transition: 'all 0.2s',
                            }, children: node.state === 'confirmed' ? _jsx(CheckCircle, { size: 18 }) : node.icon }), _jsxs(Typography, { variant: "caption", sx: {
                                mt: 0.5, fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                                letterSpacing: '0.06em',
                                color: node.state === 'pending' ? 'text.disabled'
                                    : node.state === 'active' ? 'var(--accent)'
                                        : 'success.main',
                            }, children: [node.state === 'confirmed' ? '✓ ' : '', node.label] }), node.sublabel && (_jsx(Typography, { variant: "caption", sx: { fontSize: 10, color: 'text.secondary', textAlign: 'center', maxWidth: 72 }, noWrap: true, children: node.sublabel }))] }), i < nodes.length - 1 && (_jsx(Box, { sx: {
                        flex: 1, height: 2, mx: 0.5, mb: 3,
                        bgcolor: node.state === 'confirmed'
                            ? theme.palette.success.main
                            : theme.palette.divider,
                        transition: 'background-color 0.2s',
                    } }))] }, i))) }));
}
// ── Scan input ────────────────────────────────────────────────────────────────
function ScanInput({ hint, onSubmit, error }) {
    const [value, setValue] = useState('');
    const inputRef = useRef(null);
    useEffect(() => { inputRef.current?.focus(); }, []);
    useEffect(() => { if (error)
        setTimeout(() => inputRef.current?.focus(), 50); }, [error]);
    const handleSubmit = () => {
        const val = value.trim();
        if (val) {
            onSubmit(val);
            setValue('');
        }
    };
    return (_jsxs(Box, { sx: { display: 'flex', gap: 1, alignItems: 'flex-start' }, children: [_jsx(TextField, { inputRef: inputRef, fullWidth: true, size: "small", placeholder: hint, value: value, onChange: (e) => setValue(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                    handleSubmit(); }, helperText: "Scanner auto-submits \u00B7 manual entry: press Enter", autoComplete: "off" }), value.trim() && (_jsx(Button, { variant: "contained", size: "small", onClick: handleSubmit, sx: { bgcolor: 'var(--accent)', borderRadius: '6px', fontWeight: 600, mt: '2px', flexShrink: 0 }, children: "Scan" }))] }));
}
// ── Main component ────────────────────────────────────────────────────────────
export default function StowSessionPage({ initialTaskId, onComplete, onFetchTasks, onResolveLocation, onAssignLocation, onClaimTask, onResolveBarcode, onConfirmStow, onReportException, }) {
    const theme = useTheme();
    const [phase, setPhase] = useState('brief');
    const [tasks, setTasks] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [loadError, setLoadError] = useState(null);
    const [submitError, setSubmitError] = useState(null);
    const [scannedUnitId, setScannedUnitId] = useState(null);
    const [confirmedLocation, setConfirmedLocation] = useState(null);
    const [remainingQty, setRemainingQty] = useState(0);
    const [qtyInput, setQtyInput] = useState('');
    const [shortfallDialog, setShortfallDialog] = useState(null);
    const [exType, setExType] = useState('');
    const [exQtyInput, setExQtyInput] = useState('');
    const [exSubmitting, setExSubmitting] = useState(false);
    const [pendingStow, setPendingStow] = useState(null);
    const [filedExceptions, setFiledExceptions] = useState([]);
    const currentTask = tasks[currentIndex] ?? null;
    // ── Load tasks ──────────────────────────────────────────────────────────────
    useEffect(() => {
        void (async () => {
            setLoading(true);
            try {
                const all = await onFetchTasks();
                const active = all.filter(t => t.status === 'pending' || t.status === 'in_progress');
                const tapped = active.find(t => t.stow_task_id === initialTaskId);
                const rest = active.filter(t => t.stow_task_id !== initialTaskId);
                const ordered = tapped ? [tapped, ...rest] : active;
                setTasks(ordered);
                if (ordered.length > 0)
                    setRemainingQty(ordered[0].quantity);
            }
            catch {
                setLoadError('Failed to load stow tasks.');
            }
            finally {
                setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialTaskId]);
    // ── Advance to next task ────────────────────────────────────────────────────
    const advanceToNext = useCallback(() => {
        const next = currentIndex + 1;
        if (next >= tasks.length) {
            setPhase('complete');
        }
        else {
            setCurrentIndex(next);
            setRemainingQty(tasks[next].quantity);
            setScannedUnitId(null);
            setConfirmedLocation(null);
            setQtyInput('');
            setShortfallDialog(null);
            setPendingStow(null);
            setFiledExceptions([]);
            setPhase('item_scan');
        }
    }, [currentIndex, tasks]);
    // ── Node 1: Item scan ───────────────────────────────────────────────────────
    const handleItemScan = useCallback(async (scannedValue) => {
        if (!currentTask)
            return;
        setSubmitError(null);
        const resolved = await onResolveBarcode(scannedValue);
        if (!resolved?.lasyncro_variant_id) {
            throw Object.assign(new Error('Barcode not recognised.'), {
                response: { data: { error: 'Barcode not recognised. Try scanning again or check the label.' } },
            });
        }
        if (resolved.lasyncro_variant_id !== currentTask.lasyncro_variant_id) {
            throw Object.assign(new Error('Wrong product.'), {
                response: { data: { error: 'Wrong product — does not match this stow task.' } },
            });
        }
        setScannedUnitId(resolved.lasyncro_unit_id ?? null);
        setPhase('location_scan');
    }, [currentTask, onResolveBarcode]);
    // ── Node 2: Location scan ───────────────────────────────────────────────────
    const handleLocationScan = useCallback(async (scannedValue) => {
        if (!currentTask)
            return;
        setSubmitError(null);
        const resolved = await onResolveLocation(scannedValue);
        if (!resolved?.location_code) {
            throw Object.assign(new Error('Location not found.'), {
                response: { data: { error: 'Location not recognised. Try scanning the bin barcode.' } },
            });
        }
        if (!currentTask.location_code) {
            await onAssignLocation(currentTask.stow_task_id, resolved.location_code);
        }
        else if (resolved.location_code !== currentTask.location_code) {
            throw Object.assign(new Error('Wrong location.'), {
                response: { data: { error: `Wrong location. Expected: ${currentTask.location_code}` } },
            });
        }
        try {
            await onClaimTask(currentTask.stow_task_id);
        }
        catch { /* already claimed — proceed */ }
        setTasks(prev => prev.map((t, i) => i === currentIndex ? { ...t, location_code: resolved.location_code, status: 'in_progress' } : t));
        setConfirmedLocation(resolved.location_code);
        setPhase('qty_confirm');
    }, [currentTask, currentIndex, onResolveLocation, onAssignLocation, onClaimTask]);
    // ── Node 3: Stow confirm ────────────────────────────────────────────────────
    const submitStow = useCallback(async (qty, exceptionsFiled = false) => {
        if (!currentTask)
            return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            await onConfirmStow(currentTask.stow_task_id, qty, scannedUnitId ?? undefined);
            const newRemaining = remainingQty - qty;
            if (newRemaining > 0 && !exceptionsFiled) {
                setRemainingQty(newRemaining);
                setScannedUnitId(null);
                setConfirmedLocation(null);
                setQtyInput('');
                setShortfallDialog(null);
                setPhase('item_scan');
            }
            else {
                advanceToNext();
            }
        }
        catch {
            setSubmitError('Stow confirm failed. Try again.');
        }
        finally {
            setSubmitting(false);
        }
    }, [currentTask, remainingQty, scannedUnitId, advanceToNext, onConfirmStow]);
    const handleQtyConfirm = useCallback(async () => {
        const qty = parseInt(qtyInput, 10);
        if (isNaN(qty) || qty <= 0) {
            setSubmitError('Enter a valid quantity.');
            return;
        }
        if (qty > remainingQty) {
            setSubmitError(`Only ${remainingQty} units remaining.`);
            return;
        }
        const shortfall = remainingQty - qty;
        if (shortfall > 0) {
            setShortfallDialog({ qty, shortfall, reported: [] });
            setExType('');
            setExQtyInput('');
            return;
        }
        setPendingStow({ qty, exceptionsFiled: false });
        setFiledExceptions([]);
        setPhase('summary');
    }, [qtyInput, remainingQty]);
    const handleShortfallConfirm = useCallback(async () => {
        if (!shortfallDialog || !currentTask || !exType)
            return;
        const exQty = parseInt(exQtyInput, 10);
        if (isNaN(exQty) || exQty <= 0 || exQty > shortfallDialog.shortfall) {
            setSubmitError(`Enter between 1 and ${shortfallDialog.shortfall}.`);
            return;
        }
        setExSubmitting(true);
        try {
            const result = await onReportException(currentTask.stow_task_id, {
                exception_type: exType,
                quantity: exQty,
                notes: 'Reported during stow qty confirm',
                lasyncro_unit_id: scannedUnitId ?? undefined,
            });
            const newReported = [
                ...shortfallDialog.reported,
                { type: exType, qty: exQty, label: result.prob_label ?? 'PROB-?' },
            ];
            const newShortfall = shortfallDialog.shortfall - exQty;
            if (newShortfall > 0) {
                setShortfallDialog(prev => prev ? { ...prev, shortfall: newShortfall, reported: newReported } : null);
                setExType('');
                setExQtyInput('');
            }
            else {
                setFiledExceptions(newReported);
                setShortfallDialog(null);
                setPendingStow({ qty: shortfallDialog.qty, exceptionsFiled: true });
                setPhase('summary');
            }
        }
        catch {
            setSubmitError('Failed to report exception.');
        }
        finally {
            setExSubmitting(false);
        }
    }, [shortfallDialog, currentTask, exType, exQtyInput, onReportException]);
    // ── Shared node config ──────────────────────────────────────────────────────
    const nodeStates = {
        item: phase === 'item_scan' ? 'active'
            : phase === 'brief' ? 'pending'
                : 'confirmed',
        location: phase === 'location_scan' ? 'active'
            : ['qty_confirm', 'summary'].includes(phase) ? 'confirmed'
                : 'pending',
        qty: ['qty_confirm', 'summary'].includes(phase) ? 'active' : 'pending',
    };
    const progressLabel = currentTask ? `Task ${currentIndex + 1} of ${tasks.length}` : '';
    const sharedNodes = !currentTask ? [] : [
        {
            label: 'Scan Item',
            sublabel: currentTask.sku ?? undefined,
            state: nodeStates.item,
            icon: _jsx(Package, { size: 16 }),
        },
        {
            label: 'Scan Location',
            sublabel: confirmedLocation ?? currentTask.location_code ?? undefined,
            state: nodeStates.location,
            icon: _jsx(MapPin, { size: 16 }),
        },
        {
            label: 'Qty',
            sublabel: undefined,
            state: nodeStates.qty,
            icon: _jsx(Hash, { size: 16 }),
        },
    ];
    // ── BRIEF ───────────────────────────────────────────────────────────────────
    if (phase === 'brief') {
        return (_jsx(Box, { sx: { p: 3 }, children: loading ? (_jsx(Box, { sx: { display: 'flex', justifyContent: 'center', pt: 8 }, children: _jsx(CircularProgress, { size: 32 }) })) : loadError ? (_jsx(Alert, { severity: "error", children: loadError })) : tasks.length === 0 ? (_jsx(Alert, { severity: "info", children: "No stow tasks pending." })) : (_jsxs(_Fragment, { children: [_jsxs(Box, { sx: { mb: 3 }, children: [_jsx(Typography, { variant: "h6", fontWeight: 600, children: "Stow Session" }), _jsx(Typography, { variant: "body2", color: "text.secondary", children: "Review your tasks below, then start stowing." })] }), _jsx(Box, { sx: { display: 'flex', gap: 2, mb: 3 }, children: [
                            { label: 'SKUs', value: tasks.length },
                            { label: 'Units', value: tasks.reduce((s, t) => s + t.quantity, 0) },
                            { label: 'Locations', value: new Set(tasks.map(t => t.location_code).filter(Boolean)).size },
                        ].map(({ label, value }) => (_jsxs(Paper, { variant: "outlined", sx: { flex: 1, p: 2, textAlign: 'center', borderRadius: 2 }, children: [_jsx(Typography, { variant: "h5", fontWeight: 600, color: "warning.main", children: value }), _jsx(Typography, { variant: "caption", color: "text.secondary", children: label })] }, label))) }), _jsx(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }, children: tasks.map((t) => (_jsx(Paper, { variant: "outlined", sx: { p: 2, borderRadius: 2 }, children: _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 2 }, children: [t.image_url ? (_jsx(Box, { component: "img", src: t.image_url, alt: t.variant_title ?? '', sx: { width: 40, height: 40, objectFit: 'cover', borderRadius: 1, flexShrink: 0, border: `1px solid ${theme.palette.divider}` } })) : (_jsx(Box, { sx: { width: 40, height: 40, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: _jsx(Package, { size: 18, color: theme.palette.text.disabled }) })), _jsx(Box, { sx: { flex: 1, minWidth: 0 }, children: _jsx(Typography, { variant: "body2", fontWeight: 600, noWrap: true, children: t.product_title ?? t.variant_title ?? t.sku ?? t.stow_task_id.slice(0, 8).toUpperCase() }) }), _jsxs(Box, { sx: { display: 'flex', gap: 1, flexShrink: 0 }, children: [_jsx(Chip, { label: `${t.quantity} units`, size: "small" }), t.location_code
                                                ? _jsx(Chip, { label: t.location_code, size: "small", color: "success" })
                                                : _jsx(Chip, { label: "No location", size: "small", sx: { bgcolor: 'var(--accent-ghost)', color: 'var(--accent)', border: '0.5px solid var(--accent-border)', fontWeight: 600, fontSize: 11 } })] })] }) }, t.stow_task_id))) }), _jsx(Button, { variant: "contained", size: "large", fullWidth: true, sx: { borderRadius: '6px', fontWeight: 600, bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }, onClick: () => setPhase('item_scan'), children: "Start Stowing" })] })) }));
    }
    // ── COMPLETE ─────────────────────────────────────────────────────────────────
    if (phase === 'complete') {
        return (_jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4, textAlign: 'center', minHeight: 400 }, children: [_jsx(CheckCircle, { size: 56, color: theme.palette.success.main }), _jsx(Typography, { variant: "h5", fontWeight: 600, sx: { mt: 2 }, children: "Stow complete" }), _jsxs(Typography, { variant: "body2", color: "text.secondary", sx: { mt: 1, mb: 4 }, children: [tasks.length, " SKU", tasks.length !== 1 ? 's' : '', " stowed. Inventory updated."] }), _jsx(Button, { variant: "contained", size: "large", sx: { borderRadius: '6px', fontWeight: 600, bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }, onClick: onComplete, children: "Back to operations" })] }));
    }
    if (!currentTask)
        return null;
    // ── ITEM SCAN (Node 1) ───────────────────────────────────────────────────────
    if (phase === 'item_scan') {
        return (_jsxs(Box, { sx: { p: 2 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 1 }, children: [_jsx(IconButton, { onClick: () => setPhase('brief'), size: "small", children: _jsx(ArrowLeft, { size: 18 }) }), _jsx(Typography, { variant: "subtitle2", color: "text.secondary", children: progressLabel })] }), _jsx(LinearProgress, { variant: "determinate", value: ((currentIndex + 1) / tasks.length) * 100, sx: { mb: 2, borderRadius: 1 } }), _jsx(NodeTrack, { nodes: sharedNodes }), _jsxs(Alert, { severity: "info", icon: false, sx: { mb: 2, py: 0.5, fontSize: 13 }, children: [_jsx("strong", { children: "Step 1 of 3" }), " \u2014 Scan the item's LSU- barcode to confirm you have the right product."] }), _jsxs(Paper, { variant: "outlined", sx: { p: 2, mb: 2, borderRadius: 2, display: 'flex', gap: 2, alignItems: 'center' }, children: [currentTask.image_url ? (_jsx(Box, { component: "img", src: currentTask.image_url, alt: currentTask.variant_title ?? '', sx: { width: 64, height: 64, objectFit: 'cover', borderRadius: 1, flexShrink: 0, border: `1px solid ${theme.palette.divider}` } })) : (_jsx(Box, { sx: { width: 64, height: 64, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: _jsx(Package, { size: 28, color: theme.palette.text.disabled }) })), _jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsx(Typography, { variant: "body2", fontWeight: 600, noWrap: true, children: currentTask.product_title ?? currentTask.variant_title ?? '—' }), currentTask.sku && (_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { fontFamily: 'monospace', display: 'block' }, children: currentTask.sku })), _jsxs(Typography, { variant: "caption", color: "text.secondary", children: [remainingQty, " unit", remainingQty !== 1 ? 's' : '', " to stow"] }), (currentTask.unit_ids ?? []).length > 0 && (_jsxs(Box, { sx: { mt: 1 }, children: [_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { display: 'block', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, fontSize: 10 }, children: "LSU- codes for this task" }), _jsx(Box, { sx: { display: 'flex', flexWrap: 'wrap', gap: 0.5 }, children: (currentTask.unit_ids ?? []).map((id) => (_jsx(Chip, { label: id, size: "small", sx: { fontFamily: 'monospace', fontSize: 11, bgcolor: alpha('#ff6b00', 0.10), color: 'var(--accent)', fontWeight: 600 } }, id))) })] }))] })] }), _jsx(ScanInput, { hint: "Scan item barcode (LSU- or product barcode)", error: submitError, onSubmit: (v) => {
                        void handleItemScan(v).catch((err) => {
                            const msg = err?.response?.data?.error ?? (err instanceof Error ? err.message : 'Item scan failed.');
                            setSubmitError(msg);
                        });
                    } }), submitError && _jsx(Alert, { severity: "error", sx: { mt: 2 }, children: submitError })] }));
    }
    // ── LOCATION SCAN (Node 2) ───────────────────────────────────────────────────
    if (phase === 'location_scan') {
        return (_jsxs(Box, { sx: { p: 2 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 1 }, children: [_jsx(IconButton, { onClick: () => setPhase('item_scan'), size: "small", children: _jsx(ArrowLeft, { size: 18 }) }), _jsx(Typography, { variant: "subtitle2", color: "text.secondary", children: progressLabel })] }), _jsx(LinearProgress, { variant: "determinate", value: ((currentIndex + 1) / tasks.length) * 100, sx: { mb: 2, borderRadius: 1 } }), _jsx(NodeTrack, { nodes: sharedNodes }), _jsxs(Alert, { severity: "info", icon: false, sx: { mb: 2, py: 0.5, fontSize: 13 }, children: [_jsx("strong", { children: "Step 2 of 3" }), " \u2014 Walk to the bin and scan its barcode to confirm the destination."] }), _jsxs(Paper, { variant: "outlined", sx: { p: 2, mb: 2, borderRadius: 2, borderColor: theme.palette.success.main, display: 'flex', gap: 2, alignItems: 'center' }, children: [currentTask.image_url ? (_jsx(Box, { component: "img", src: currentTask.image_url, alt: currentTask.variant_title ?? '', sx: { width: 48, height: 48, objectFit: 'cover', borderRadius: 1, flexShrink: 0 } })) : (_jsx(Box, { sx: { width: 48, height: 48, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: _jsx(Package, { size: 22, color: theme.palette.success.main }) })), _jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }, children: [_jsx(CheckCircle, { size: 13, color: theme.palette.success.main }), _jsx(Typography, { variant: "caption", color: "success.main", fontWeight: 600, children: "Item confirmed" })] }), _jsx(Typography, { variant: "body2", fontWeight: 600, noWrap: true, children: currentTask.product_title ?? currentTask.variant_title ?? '—' }), _jsxs(Typography, { variant: "caption", color: "text.secondary", children: [remainingQty, " units"] })] })] }), currentTask.location_code && (_jsxs(Paper, { variant: "outlined", sx: { p: 2, mb: 2, borderRadius: 2, bgcolor: 'var(--accent-ghost)', borderColor: 'var(--accent-border)' }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.75 }, children: [_jsx(MapPin, { size: 16, color: 'var(--accent)' }), _jsxs(Typography, { variant: "body2", fontWeight: 600, sx: { color: 'var(--accent)' }, children: ["Suggested bin: ", currentTask.location_code] })] }), _jsx(Typography, { variant: "caption", color: "text.secondary", sx: { mt: 0.25, display: 'block' }, children: "Walk to this bin and scan its barcode to confirm." })] })), _jsx(ScanInput, { hint: "Scan bin barcode or type location code", error: submitError, onSubmit: (v) => {
                        void handleLocationScan(v).catch((err) => {
                            const msg = err?.response?.data?.error ?? (err instanceof Error ? err.message : 'Location scan failed.');
                            setSubmitError(msg);
                        });
                    } }), submitError && _jsx(Alert, { severity: "error", sx: { mt: 2 }, children: submitError })] }));
    }
    // ── QTY CONFIRM (Node 3) ─────────────────────────────────────────────────────
    if (phase === 'qty_confirm') {
        return (_jsxs(Box, { sx: { p: 2 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 1 }, children: [_jsx(IconButton, { onClick: () => setPhase('location_scan'), size: "small", children: _jsx(ArrowLeft, { size: 18 }) }), _jsx(Typography, { variant: "subtitle2", color: "text.secondary", children: progressLabel })] }), _jsx(LinearProgress, { variant: "determinate", value: ((currentIndex + 1) / tasks.length) * 100, sx: { mb: 2, borderRadius: 1 } }), _jsx(NodeTrack, { nodes: sharedNodes }), _jsxs(Paper, { variant: "outlined", sx: { p: 2, mb: 1.5, borderRadius: 2 }, children: [_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }, children: "Location" }), _jsx(Typography, { variant: "body1", fontWeight: 600, children: confirmedLocation })] }), _jsxs(Paper, { variant: "outlined", sx: { p: 2, mb: 2, borderRadius: 2 }, children: [_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }, children: "Product" }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.5 }, children: [currentTask.image_url ? (_jsx(Box, { component: "img", src: currentTask.image_url, alt: "", sx: { width: 40, height: 40, objectFit: 'cover', borderRadius: 1, flexShrink: 0 } })) : (_jsx(Box, { sx: { width: 40, height: 40, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: _jsx(Package, { size: 18, style: { opacity: 0.4 } }) })), _jsxs(Box, { children: [_jsx(Typography, { variant: "body1", fontWeight: 600, children: currentTask.product_title ?? currentTask.variant_title ?? currentTask.sku ?? '—' }), currentTask.sku && _jsx(Typography, { variant: "caption", color: "text.secondary", sx: { fontFamily: 'monospace' }, children: currentTask.sku })] })] })] }), _jsx(Divider, { sx: { mb: 2 } }), _jsx(Typography, { variant: "body2", color: "text.secondary", sx: { mb: 1 }, children: "How many units are you placing here?" }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 2, mb: 1 }, children: [_jsx(TextField, { type: "number", value: qtyInput, onChange: (e) => setQtyInput(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                                void handleQtyConfirm(); }, placeholder: `/ ${remainingQty}`, autoFocus: true, size: "small", sx: { flex: 1 }, inputProps: { min: 1, max: remainingQty } }), _jsxs(Typography, { variant: "body2", color: "text.secondary", children: ["of ", remainingQty] })] }), submitError && _jsx(Alert, { severity: "error", sx: { mb: 2 }, children: submitError }), _jsx(Button, { variant: "contained", size: "large", fullWidth: true, disabled: submitting, sx: { borderRadius: '6px', fontWeight: 600, bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }, onClick: () => void handleQtyConfirm(), children: submitting ? 'Confirming…' : 'Confirm stow' }), _jsxs(Dialog, { open: !!shortfallDialog, onClose: () => undefined, fullWidth: true, maxWidth: "xs", children: [_jsxs(DialogTitle, { sx: { fontSize: 16, fontWeight: 600 }, children: [shortfallDialog?.shortfall, " unit", (shortfallDialog?.shortfall ?? 0) > 1 ? 's' : '', " unaccounted"] }), _jsxs(DialogContent, { sx: { pt: '8px !important' }, children: [_jsx(Typography, { variant: "body2", color: "text.secondary", sx: { mb: 2 }, children: (shortfallDialog?.reported.length ?? 0) > 0
                                        ? `${shortfallDialog?.reported.reduce((s, e) => s + e.qty, 0)} explained. What about the rest?`
                                        : `You placed ${shortfallDialog?.qty} of ${remainingQty}. What happened to the rest?` }), shortfallDialog?.reported.map((ex, i) => (_jsx(Box, { sx: { mb: 1, p: 1, borderRadius: 1, bgcolor: alpha(theme.palette.success.main, 0.15) }, children: _jsxs(Typography, { variant: "caption", color: "success.main", children: ["\u2713 ", ex.qty, " \u00D7 ", ex.type, " \u2192 ", ex.label] }) }, i))), _jsx(Box, { sx: { display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }, children: STOW_EXCEPTIONS.map(({ type, label }) => (_jsx(Chip, { label: label, onClick: () => setExType(type), color: exType === type ? 'warning' : 'default', variant: exType === type ? 'filled' : 'outlined', sx: { cursor: 'pointer' } }, type))) }), _jsx(TextField, { label: `Quantity (max ${shortfallDialog?.shortfall})`, type: "number", value: exQtyInput, onChange: (e) => setExQtyInput(e.target.value), size: "small", fullWidth: true, inputProps: { min: 1, max: shortfallDialog?.shortfall }, sx: { mb: 1 } }), submitError && _jsx(Alert, { severity: "error", children: submitError })] }), _jsxs(DialogActions, { sx: { flexDirection: 'column', gap: 1, px: 2, pb: 2 }, children: [_jsx(Button, { variant: "contained", fullWidth: true, disabled: !exType || exSubmitting, sx: { borderRadius: '6px', fontWeight: 600, bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }, onClick: () => void handleShortfallConfirm(), children: exSubmitting ? 'Processing…' : 'Report & continue' }), (shortfallDialog?.reported.length ?? 0) === 0 && (_jsxs(Button, { fullWidth: true, size: "small", color: "inherit", startIcon: _jsx(RotateCcw, { size: 14 }), onClick: () => { setShortfallDialog(null); void submitStow(remainingQty); }, disabled: exSubmitting, children: ["I miscounted \u2014 all ", remainingQty, " are here"] }))] })] })] }));
    }
    // ── SUMMARY ───────────────────────────────────────────────────────────────────
    if (phase === 'summary' && pendingStow && currentTask) {
        return (_jsxs(Box, { sx: { p: 2 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 1 }, children: [_jsx(IconButton, { onClick: () => setPhase('qty_confirm'), size: "small", children: _jsx(ArrowLeft, { size: 18 }) }), _jsx(Typography, { variant: "subtitle2", color: "text.secondary", children: progressLabel }), _jsx(Chip, { label: "Review & confirm", size: "small", color: "primary", sx: { ml: 'auto' } })] }), _jsx(LinearProgress, { variant: "determinate", value: ((currentIndex + 1) / tasks.length) * 100, sx: { mb: 2, borderRadius: 1 } }), _jsx(NodeTrack, { nodes: sharedNodes }), _jsx(Typography, { variant: "h6", fontWeight: 600, sx: { mb: 2 }, children: "Review before stowing" }), _jsxs(Paper, { variant: "outlined", sx: { p: 2, mb: 1.5, borderRadius: 2 }, children: [_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }, children: "Location" }), _jsx(Typography, { variant: "body1", fontWeight: 600, children: confirmedLocation })] }), _jsxs(Paper, { variant: "outlined", sx: { p: 2, mb: 1.5, borderRadius: 2 }, children: [_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }, children: "Product" }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.5 }, children: [currentTask.image_url ? (_jsx(Box, { component: "img", src: currentTask.image_url, alt: "", sx: { width: 40, height: 40, objectFit: 'cover', borderRadius: 1, flexShrink: 0 } })) : (_jsx(Box, { sx: { width: 40, height: 40, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: _jsx(Package, { size: 18, style: { opacity: 0.4 } }) })), _jsxs(Box, { children: [_jsx(Typography, { variant: "body1", fontWeight: 600, children: currentTask.product_title ?? currentTask.variant_title ?? currentTask.sku ?? '—' }), currentTask.sku && _jsx(Typography, { variant: "caption", color: "text.secondary", sx: { fontFamily: 'monospace' }, children: currentTask.sku })] })] })] }), _jsxs(Paper, { variant: "outlined", sx: { p: 2, mb: 2, borderRadius: 2 }, children: [_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }, children: "Units placing" }), _jsxs(Typography, { variant: "body1", fontWeight: 600, children: [pendingStow.qty, " of ", remainingQty] })] }), filedExceptions.length > 0 && (_jsxs(Paper, { variant: "outlined", sx: { p: 2, mb: 2, borderRadius: 2, borderColor: 'warning.main' }, children: [_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, display: 'block', mb: 1 }, children: "Exceptions filed" }), filedExceptions.map((ex, i) => (_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', mb: 0.5 }, children: [_jsx(Typography, { variant: "body2", children: ex.type.replace(/_/g, ' ') }), _jsxs(Typography, { variant: "body2", fontWeight: 600, children: [ex.qty, " units \u2192 ", ex.label] })] }, i)))] })), submitError && _jsx(Alert, { severity: "error", sx: { mb: 2 }, children: submitError }), _jsx(Button, { variant: "contained", size: "large", fullWidth: true, disabled: submitting, sx: { borderRadius: '6px', fontWeight: 600, bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }, onClick: () => void submitStow(pendingStow.qty, pendingStow.exceptionsFiled), children: submitting ? 'Confirming…' : 'Confirm & Stow' })] }));
    }
    return null;
}
//# sourceMappingURL=StowSessionPage.js.map