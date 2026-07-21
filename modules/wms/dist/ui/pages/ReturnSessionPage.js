import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
// modules/wms/src/ui/pages/ReturnSessionPage.tsx
//
// RETURN SESSION PAGE — folded into WMS operations free-scan (WEB-RETURN-01)
// -----------------------------------------------------------------------------
// Rendered by WmsModuleFT2 when a pack free-scan resolves to an already-
// shipped item/order. Presentational only — all data access is owned by
// WmsPage.tsx and threaded down as props, matching PackSessionPage/
// StowSessionPage. No hooks, no axios, per the module/app boundary
// (modules/wms's tsconfig rootDir excludes apps/frontend entirely).
import { useState, useEffect } from 'react';
import { Box, Typography, CircularProgress, Alert, Button, TextField, Paper } from '@mui/material';
import { CheckCircle } from 'lucide-react';
const CONDITIONS = [
    { value: 'resellable', label: 'Resellable' },
    { value: 'repackable', label: 'Repackable' },
    { value: 'damaged', label: 'Damaged' },
    { value: 'unsellable', label: 'Unsellable' },
];
const REASONS = [
    { value: 'wrong_item', label: 'Wrong item' },
    { value: 'damaged_in_transit', label: 'Damaged in transit' },
    { value: 'damaged_on_arrival', label: 'Damaged on arrival' },
    { value: 'not_as_described', label: 'Not as described' },
    { value: 'quality_issue', label: 'Quality issue' },
    { value: 'changed_mind', label: 'Changed mind' },
    { value: 'duplicate_order', label: 'Duplicate order' },
    { value: 'other', label: 'Other' },
];
const formatAge = (isoDate) => {
    const hours = (Date.now() - new Date(isoDate).getTime()) / 3600000;
    if (hours < 24)
        return `${Math.round(hours)}h ago`;
    return `${Math.round(hours / 24)}d ago`;
};
function LineRow({ line, onSave, }) {
    const [condition, setCondition] = useState(line.item_condition);
    const [qty, setQty] = useState(line.quantity_received ?? line.refunded_quantity);
    const [notes, setNotes] = useState('');
    const isProcessed = !!line.processed_at;
    const needsNotes = condition === 'damaged' || condition === 'unsellable';
    return (_jsxs(Box, { sx: { px: 2.5, py: 2, borderBottom: '0.5px solid var(--rule)' }, children: [_jsxs(Typography, { sx: { fontSize: 13, color: 'var(--ink)', fontWeight: 500 }, children: [line.variant_title ?? line.sku ?? 'Unknown product', " \u00B7 refunded qty ", line.refunded_quantity] }), isProcessed ? (_jsxs(Typography, { sx: { fontSize: 12, color: 'var(--ink-3)', mt: 0.5 }, children: ["Condition: ", line.item_condition, " \u00B7 received ", line.quantity_received] })) : (_jsxs(Box, { sx: { mt: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }, children: [_jsx(Box, { sx: { display: 'flex', gap: 0.75, flexWrap: 'wrap' }, children: CONDITIONS.map((c) => (_jsx(Box, { onClick: () => setCondition(c.value), sx: {
                                px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, borderRadius: '6px', cursor: 'pointer',
                                border: condition === c.value ? 'none' : '0.5px solid var(--accent)',
                                bgcolor: condition === c.value ? 'var(--accent)' : 'transparent',
                                color: condition === c.value ? 'var(--accent-ink)' : 'var(--accent)',
                            }, children: c.label }, c.value))) }), _jsx(TextField, { size: "small", type: "number", label: "Quantity received", value: qty, onChange: (e) => setQty(Number(e.target.value)), sx: { maxWidth: 160 } }), needsNotes && (_jsx(TextField, { size: "small", label: "Condition notes (required)", multiline: true, rows: 2, value: notes, onChange: (e) => setNotes(e.target.value) })), _jsx(Button, { size: "small", variant: "contained", disabled: !condition || (needsNotes && !notes), sx: { alignSelf: 'flex-start', bgcolor: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: '6px', fontWeight: 600, '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }, onClick: () => condition && onSave({ lineId: line.lasyncro_refund_line_item_id, itemCondition: condition, quantityReceived: qty, conditionNotes: notes || undefined }), children: "Save line" })] }))] }));
}
export default function ReturnSessionPage({ returnJobId, onFetchReturnJob, onAddReturnLine, onProcessReturnLine, onCompleteReturnJob, onComplete, }) {
    const [job, setJob] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [scanValue, setScanValue] = useState('');
    const [scanError, setScanError] = useState(null);
    const [reason, setReason] = useState(null);
    const [reasonNotes, setReasonNotes] = useState('');
    const [completeError, setCompleteError] = useState(null);
    const [completing, setCompleting] = useState(false);
    const refetch = () => {
        setLoading(true);
        onFetchReturnJob(returnJobId)
            .then((data) => { setJob(data); setLoadError(null); })
            .catch((err) => setLoadError(err?.message ?? 'Failed to load return job'))
            .finally(() => setLoading(false));
    };
    useEffect(() => { refetch(); }, [returnJobId]); // eslint-disable-line react-hooks/exhaustive-deps
    if (loading) {
        return _jsx(Box, { sx: { display: 'flex', justifyContent: 'center', pt: 6 }, children: _jsx(CircularProgress, { size: 24 }) });
    }
    if (loadError || !job) {
        return _jsx(Box, { sx: { p: 3 }, children: _jsx(Alert, { severity: "error", children: loadError ?? 'Return job not found.' }) });
    }
    const lines = job.lines;
    const allProcessed = lines.length > 0 && lines.every((l) => !!l.processed_at);
    const needsReason = job.origin === 'customer_return';
    const reasonValid = !needsReason || (!!reason && (reason !== 'other' || !!reasonNotes));
    const canComplete = allProcessed && reasonValid && job.status !== 'awaiting_decision';
    const handleAddLine = () => {
        const val = scanValue.trim();
        if (!val)
            return;
        setScanError(null);
        onAddReturnLine(returnJobId, { scannedValue: val, quantityReceived: 1, itemCondition: 'resellable' })
            .then(refetch)
            .catch((err) => setScanError(err?.message ?? 'Failed to add line'));
        setScanValue('');
    };
    const handleSaveLine = (input) => {
        onProcessReturnLine(returnJobId, input).then(refetch).catch(() => { });
    };
    const handleComplete = () => {
        setCompleteError(null);
        setCompleting(true);
        onCompleteReturnJob(returnJobId, { returnReason: reason ?? undefined, returnNotes: reasonNotes || undefined })
            .then(onComplete)
            .catch((err) => setCompleteError(err?.message ?? 'Failed to complete return'))
            .finally(() => setCompleting(false));
    };
    return (_jsxs(Box, { sx: { p: '30px 24px', maxWidth: 640, mx: 'auto' }, children: [_jsxs(Typography, { sx: { fontSize: 22, fontWeight: 500, color: 'var(--ink)', mb: 0.5 }, children: ["Return job ", job.external_order_id ? `— Order #${job.external_order_id}` : ''] }), _jsxs(Typography, { sx: { fontSize: 13, color: 'var(--ink-3)', mb: 3 }, children: [job.origin === 'customer_return' ? 'Customer return' : 'Undelivered / return to sender', ' · ', "Created ", formatAge(job.created_at)] }), job.status === 'awaiting_decision' && (_jsx(Alert, { severity: "warning", sx: { mb: 2 }, children: "A damaged/unsellable line needs an owner decision before this job can complete." })), _jsxs(Box, { sx: { bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden', mb: 2 }, children: [_jsx(Box, { sx: { px: 2.5, py: 2, borderBottom: '1px solid var(--rule)' }, children: _jsx(Typography, { sx: { fontSize: 15, fontWeight: 500, color: 'var(--ink)' }, children: "Line items" }) }), lines.length === 0 && (_jsx(Box, { sx: { px: 2.5, py: 2 }, children: _jsx(Typography, { sx: { fontSize: 12, color: 'var(--ink-3)' }, children: "No refund linked yet \u2014 scan the physical product barcode below to log what arrived." }) })), lines.map((line) => (_jsx(LineRow, { line: line, onSave: handleSaveLine }, line.lasyncro_refund_line_item_id)))] }), _jsxs(Paper, { variant: "outlined", sx: { p: 2, mb: 2, borderRadius: '14px', border: '1px solid var(--rule)' }, children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 500, color: 'var(--ink)', mb: 1 }, children: "Scan an item to add a line" }), scanError && _jsx(Alert, { severity: "error", sx: { mb: 1, py: 0.5, fontSize: 12 }, children: scanError }), _jsxs(Box, { sx: { display: 'flex', gap: 1 }, children: [_jsx(TextField, { size: "small", fullWidth: true, autoComplete: "off", placeholder: "Scan product barcode\u2026", value: scanValue, onChange: (e) => setScanValue(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                                    handleAddLine(); } }), _jsx(Button, { variant: "outlined", onClick: handleAddLine, disabled: !scanValue.trim(), sx: { color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', fontWeight: 500, whiteSpace: 'nowrap' }, children: "Add line" })] })] }), needsReason && (_jsxs(Box, { sx: { bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: 2.5, mb: 2 }, children: [_jsx(Typography, { sx: { fontSize: 15, fontWeight: 500, color: 'var(--ink)', mb: 1.5 }, children: "Why was this returned?" }), _jsx(Box, { sx: { display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.5 }, children: REASONS.map((r) => (_jsx(Box, { onClick: () => setReason(r.value), sx: {
                                px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, borderRadius: '6px', cursor: 'pointer',
                                border: reason === r.value ? 'none' : '0.5px solid var(--accent)',
                                bgcolor: reason === r.value ? 'var(--accent)' : 'transparent',
                                color: reason === r.value ? 'var(--accent-ink)' : 'var(--accent)',
                            }, children: r.label }, r.value))) }), reason === 'other' && (_jsx(TextField, { size: "small", fullWidth: true, label: "Notes (required)", multiline: true, rows: 2, value: reasonNotes, onChange: (e) => setReasonNotes(e.target.value) }))] })), completeError && _jsx(Alert, { severity: "error", sx: { mb: 2 }, children: completeError }), _jsx(Button, { fullWidth: true, variant: "contained", size: "large", disabled: !canComplete || completing, startIcon: completing ? _jsx(CircularProgress, { size: 16 }) : _jsx(CheckCircle, { size: 16 }), sx: { bgcolor: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: '6px', fontWeight: 600, '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }, onClick: handleComplete, children: "Complete return" }), !allProcessed && lines.length > 0 && (_jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-3)', mt: 1, textAlign: 'center' }, children: "Assess every line before completing." }))] }));
}
//# sourceMappingURL=ReturnSessionPage.js.map