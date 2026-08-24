import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// modules/wms/src/ui/pages/CountingSessionPage.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography, } from '@mui/material';
import { CheckCircle2, MapPin, PackageCheck, ScanBarcode, SkipForward, } from 'lucide-react';
const SKIP_OPTIONS = [
    { value: 'bin_inaccessible', label: 'Cannot access bin' },
    { value: 'stock_in_motion', label: 'Stock is moving' },
    { value: 'bin_not_found', label: 'Cannot find bin' },
    { value: 'other', label: 'Other' },
];
function locationMatches(scanned, locationCode) {
    const value = scanned.trim().toUpperCase();
    const expected = locationCode.trim().toUpperCase();
    return value === expected || value === `LOC-${expected}`;
}
function isResolved(line) {
    return line.counted_at !== null || line.skipped_at !== null;
}
function errorMessage(error, fallback) {
    const responseError = error?.response?.data?.error;
    if (responseError)
        return responseError;
    if (error instanceof Error && error.message)
        return error.message;
    return fallback;
}
export default function CountingSessionPage({ task, onComplete, onFetchLines, onFetchFindings, onCreateFinding, onClaimTask, onResolveBarcode, onRecordCount, onSkipLine, onCloseTask, }) {
    const locationInputRef = useRef(null);
    const scanInputRef = useRef(null);
    const quantityRefs = useRef({});
    const [phase, setPhase] = useState('brief');
    const [lines, setLines] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [locationInput, setLocationInput] = useState('');
    const [scanInput, setScanInput] = useState('');
    const [quantityInputs, setQuantityInputs] = useState({});
    const [activeBinCode, setActiveBinCode] = useState(null);
    const [skipTargetId, setSkipTargetId] = useState(null);
    const [skipReason, setSkipReason] = useState(null);
    const [skipNotes, setSkipNotes] = useState('');
    // RECOUNT-EXCEPTIONS-80: findings describe physical observations only.
    // They never alter counted quantity or inventory truth.
    const [, setFindings] = useState([]);
    const [findingDraft, setFindingDraft] = useState(null);
    const [findingQuantity, setFindingQuantity] = useState('1');
    const [findingNotes, setFindingNotes] = useState('');
    // RECOUNT-BINLIST-62 — the domain is location-centric, not line-centric.
    // Lines arrive already sorted into walk order (RECOUNT-WALKORDER-27), so
    // grouping preserves first-appearance order rather than re-sorting: any
    // re-sort here would silently discard the lane ordering the backend built.
    const bins = useMemo(() => {
        const order = [];
        const grouped = new Map();
        for (const line of lines) {
            const existing = grouped.get(line.location_code);
            if (existing) {
                existing.push(line);
            }
            else {
                grouped.set(line.location_code, [line]);
                order.push(line.location_code);
            }
        }
        return order.map((code) => ({
            location_code: code,
            lines: grouped.get(code) ?? [],
        }));
    }, [lines]);
    const unresolvedLines = useMemo(() => lines.filter((line) => !isResolved(line)), [lines]);
    const activeBin = bins.find((bin) => bin.location_code === activeBinCode) ?? null;
    const activeBinResolved = activeBin
        ? activeBin.lines.filter(isResolved).length
        : 0;
    const activeBinComplete = Boolean(activeBin && activeBinResolved === activeBin.lines.length);
    const binsComplete = bins.filter((bin) => bin.lines.every(isResolved)).length;
    const activeBinNumber = activeBin
        ? bins.findIndex((bin) => bin.location_code === activeBin.location_code) + 1
        : 0;
    const firstOpenBin = (fromIndex = 0) => {
        for (let index = fromIndex; index < bins.length; index += 1) {
            if (bins[index].lines.some((line) => !isResolved(line))) {
                return bins[index];
            }
        }
        return null;
    };
    useEffect(() => {
        void (async () => {
            setLoading(true);
            setError(null);
            try {
                const loaded = await onFetchLines(task.recount_task_id);
                const loadedFindings = await onFetchFindings(task.recount_task_id);
                setLines(loaded);
                setFindings(loadedFindings);
                // RECOUNT-RESUME-POSITION-72: reopening an in-progress count should
                // resume at its first unresolved bin instead of restarting at brief.
                // Location confirmation is intentionally required again after refresh.
                if (task.status === 'claimed' || task.status === 'counting') {
                    const nextUnresolvedLine = loaded.find((line) => !isResolved(line));
                    setActiveBinCode(nextUnresolvedLine?.location_code ?? null);
                    setPhase(nextUnresolvedLine ? 'location' : 'summary');
                }
            }
            catch (loadError) {
                setError(errorMessage(loadError, 'Failed to load this count. Return to Warehouse and try again.'));
            }
            finally {
                setLoading(false);
            }
        })();
    }, [task.recount_task_id, onFetchLines, onFetchFindings]);
    useEffect(() => {
        if (phase === 'location') {
            setTimeout(() => locationInputRef.current?.focus(), 50);
        }
        if (phase === 'bin') {
            setTimeout(() => scanInputRef.current?.focus(), 50);
        }
    }, [phase, activeBinCode]);
    const handleStart = async () => {
        if (submitting || loading)
            return;
        setSubmitting(true);
        setError(null);
        try {
            if (task.status === 'dispatched') {
                await onClaimTask(task.recount_task_id);
            }
            const next = firstOpenBin();
            setActiveBinCode(next?.location_code ?? null);
            setPhase(next ? 'location' : 'summary');
        }
        catch (startError) {
            setError(errorMessage(startError, 'Failed to start this count. Return to Warehouse and try again.'));
        }
        finally {
            setSubmitting(false);
        }
    };
    const handleLocation = () => {
        if (!activeBin) {
            setError('No location is active. Return to Warehouse and try again.');
            return;
        }
        if (!locationMatches(locationInput, activeBin.location_code)) {
            setError(`Wrong bin. Go to ${activeBin.location_code}.`);
            return;
        }
        setError(null);
        setLocationInput('');
        setPhase('bin');
    };
    // A scan does not commit anything on its own -- unlike stow, a count needs a
    // quantity. The scan only identifies which row the operator is standing in
    // front of and moves focus into that row's input.
    const handleScan = async () => {
        const scanned = scanInput.trim();
        if (!activeBin || !scanned || submitting)
            return;
        setSubmitting(true);
        setError(null);
        try {
            const resolved = await onResolveBarcode(scanned);
            if (!resolved) {
                setError('Barcode not recognised. Try again.');
                return;
            }
            const match = activeBin.lines.find((line) => line.lasyncro_variant_id === resolved.lasyncro_variant_id);
            if (!match) {
                // A resolved barcode physically observed in this bin is evidence,
                // even when the recount line set did not expect it here.
                setFindingDraft({
                    client_event_id: crypto.randomUUID(),
                    line: null,
                    lasyncro_variant_id: resolved.lasyncro_variant_id,
                    location_code: activeBin.location_code,
                    finding_type: 'unexpected_item',
                });
                setFindingQuantity('1');
                setFindingNotes('');
                setScanInput('');
                return;
            }
            setScanInput('');
            setTimeout(() => quantityRefs.current[match.recount_line_id]?.focus(), 50);
        }
        catch (scanError) {
            setError(errorMessage(scanError, 'Barcode could not be resolved. Try again.'));
        }
        finally {
            setSubmitting(false);
        }
    };
    const handleCount = async (line) => {
        if (submitting)
            return;
        const raw = (quantityInputs[line.recount_line_id] ?? '').trim();
        if (!/^\d+$/.test(raw)) {
            setError('Enter a whole number, including 0 when the bin is empty.');
            return;
        }
        const quantity = Number(raw);
        if (!Number.isSafeInteger(quantity) || quantity < 0) {
            setError('Enter a valid whole-number quantity.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await onRecordCount(task.recount_task_id, line.recount_line_id, {
                counted_quantity: quantity,
                count_method: 'bin_quantity',
            });
            setLines((previous) => previous.map((entry) => entry.recount_line_id === line.recount_line_id
                ? {
                    ...entry,
                    counted_quantity: quantity,
                    count_method: 'bin_quantity',
                    counted_at: new Date().toISOString(),
                    skip_reason: null,
                    skipped_at: null,
                }
                : entry));
            setQuantityInputs((previous) => {
                const next = { ...previous };
                delete next[line.recount_line_id];
                return next;
            });
            setTimeout(() => scanInputRef.current?.focus(), 50);
        }
        catch (countError) {
            setError(errorMessage(countError, 'Count could not be saved. Check the connection and try again.'));
        }
        finally {
            setSubmitting(false);
        }
    };
    const handleSkip = async () => {
        if (!skipTargetId || !skipReason || submitting)
            return;
        if (skipReason === 'other' && !skipNotes.trim()) {
            setError('Add a short note for Other.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await onSkipLine(task.recount_task_id, skipTargetId, {
                skip_reason: skipReason,
                ...(skipNotes.trim() ? { notes: skipNotes.trim() } : {}),
            });
            setLines((previous) => previous.map((entry) => entry.recount_line_id === skipTargetId
                ? {
                    ...entry,
                    counted_quantity: null,
                    counted_at: null,
                    skip_reason: skipReason,
                    skipped_at: new Date().toISOString(),
                }
                : entry));
            setSkipTargetId(null);
            setSkipReason(null);
            setSkipNotes('');
            setTimeout(() => scanInputRef.current?.focus(), 50);
        }
        catch (skipError) {
            setError(errorMessage(skipError, 'This item could not be skipped. Try again.'));
        }
        finally {
            setSubmitting(false);
        }
    };
    const handleNextBin = () => {
        if (!activeBin)
            return;
        const currentIndex = bins.findIndex((bin) => bin.location_code === activeBin.location_code);
        const next = firstOpenBin(currentIndex + 1) ?? firstOpenBin(0);
        setError(null);
        setLocationInput('');
        setScanInput('');
        if (!next) {
            setPhase('summary');
            return;
        }
        setActiveBinCode(next.location_code);
        setPhase('location');
    };
    const handleSaveFinding = async () => {
        if (!findingDraft || submitting)
            return;
        const rawQuantity = findingQuantity.trim();
        if (!/^\d+$/.test(rawQuantity)) {
            setError('Enter a positive whole-number quantity.');
            return;
        }
        const quantity = Number(rawQuantity);
        if (!Number.isSafeInteger(quantity) || quantity <= 0) {
            setError('Enter a positive whole-number quantity.');
            return;
        }
        if (findingDraft.line?.counted_quantity !== null &&
            findingDraft.line?.counted_quantity !== undefined &&
            quantity > findingDraft.line.counted_quantity) {
            setError('Defect quantity cannot exceed the physical quantity counted.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const created = await onCreateFinding(task.recount_task_id, {
                client_event_id: findingDraft.client_event_id,
                recount_line_id: findingDraft.line?.recount_line_id ?? null,
                lasyncro_variant_id: findingDraft.lasyncro_variant_id,
                location_code: findingDraft.location_code,
                finding_type: findingDraft.finding_type,
                quantity,
                ...(findingNotes.trim() ? { notes: findingNotes.trim() } : {}),
            });
            setFindings((previous) => [...previous, created]);
            setFindingDraft(null);
            setFindingQuantity('1');
            setFindingNotes('');
            setTimeout(() => scanInputRef.current?.focus(), 50);
        }
        catch (findingError) {
            setError(errorMessage(findingError, 'This physical finding could not be saved. Try again.'));
        }
        finally {
            setSubmitting(false);
        }
    };
    const handleFinish = async () => {
        if (unresolvedLines.length > 0 || submitting)
            return;
        setSubmitting(true);
        setError(null);
        try {
            // The operator session deliberately ignores review/variance details.
            // Blind counting ends with a simple acknowledgement that the task
            // reached the server.
            await onCloseTask(task.recount_task_id);
            setPhase('complete');
        }
        catch (closeError) {
            setError(errorMessage(closeError, 'Count could not be finished. Try again.'));
        }
        finally {
            setSubmitting(false);
        }
    };
    if (loading) {
        return (_jsx(Box, { sx: { p: '30px 24px', maxWidth: 720, mx: 'auto' }, children: _jsx(Box, { sx: { display: 'flex', justifyContent: 'center', py: 10 }, children: _jsx(CircularProgress, { size: 26 }) }) }));
    }
    const renderRow = (line) => {
        const counted = line.counted_at !== null;
        const skipped = line.skipped_at !== null;
        const resolved = counted || skipped;
        return (_jsxs(Box, { sx: {
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                py: 0.75,
                borderBottom: '1px solid var(--rule)',
                opacity: resolved ? 0.5 : 1,
            }, children: [_jsx(Box, { sx: {
                        width: 32,
                        height: 32,
                        flexShrink: 0,
                        borderRadius: '4px',
                        bgcolor: 'var(--surface-2, var(--surface))',
                        border: '1px solid var(--rule)',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }, children: line.image_url ? (_jsx(Box, { component: "img", src: line.image_url, alt: "", sx: { width: '100%', height: '100%', objectFit: 'cover' } })) : (_jsx(PackageCheck, { size: 14, color: "var(--ink-4)" })) }), _jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsxs(Typography, { sx: {
                                fontSize: 12,
                                lineHeight: 1.35,
                                color: 'var(--ink)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }, children: [line.product_title ?? 'Product', line.variant_title && line.variant_title !== 'Default Title'
                                    ? ` · ${line.variant_title}`
                                    : ''] }), _jsx(Typography, { sx: {
                                fontSize: 11,
                                lineHeight: 1.35,
                                fontFamily: '"DM Mono", "SF Mono", ui-monospace, monospace',
                                color: 'var(--ink-4)',
                            }, children: line.sku ?? 'No SKU' })] }), counted && (_jsx(Typography, { sx: { fontSize: 14, fontWeight: 600, color: 'var(--ink)', width: 72, textAlign: 'right' }, children: line.counted_quantity })), counted && Number(line.counted_quantity) > 0 && (_jsx(Button, { size: "small", variant: "text", onClick: () => {
                        setError(null);
                        setFindingDraft({
                            client_event_id: crypto.randomUUID(),
                            line,
                            lasyncro_variant_id: line.lasyncro_variant_id,
                            location_code: line.location_code,
                            finding_type: 'product_defect',
                        });
                        setFindingQuantity('1');
                        setFindingNotes('');
                    }, disabled: submitting, sx: { minWidth: 'auto', px: 0.75, fontSize: 11 }, children: "Report defect" })), skipped && (_jsx(Typography, { sx: { fontSize: 11, color: 'var(--ink-3)', width: 72, textAlign: 'right' }, children: "Skipped" })), !resolved && (_jsxs(_Fragment, { children: [_jsx(TextField, { inputRef: (element) => {
                                quantityRefs.current[line.recount_line_id] = element;
                            }, value: quantityInputs[line.recount_line_id] ?? '', onChange: (event) => setQuantityInputs((previous) => ({
                                ...previous,
                                [line.recount_line_id]: event.target.value,
                            })), onKeyDown: (event) => {
                                if (event.key === 'Enter')
                                    void handleCount(line);
                            }, placeholder: "Qty", size: "small", disabled: submitting, autoComplete: "off", inputProps: {
                                inputMode: 'numeric',
                                pattern: '[0-9]*',
                                autoComplete: 'off',
                                style: { textAlign: 'right', padding: '6px 8px', fontSize: 13 },
                            }, sx: { width: 72 } }), _jsx(Button, { size: "small", onClick: () => {
                                setError(null);
                                setSkipReason(null);
                                setSkipNotes('');
                                setSkipTargetId(line.recount_line_id);
                            }, disabled: submitting, "aria-label": "Cannot count this item", sx: { minWidth: 32, px: 0.5 }, children: _jsx(SkipForward, { size: 15 }) })] }))] }, line.recount_line_id));
    };
    return (_jsxs(Box, { sx: { p: '30px 24px', maxWidth: 720, mx: 'auto' }, children: [_jsxs(Box, { sx: { mb: 3 }, children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 600, color: 'var(--accent)', mb: 0.5 }, children: task.label }), _jsx(Typography, { sx: {
                            fontSize: 26,
                            fontWeight: 700,
                            color: 'var(--ink)',
                            lineHeight: 1.1,
                        }, children: "Count inventory" }), _jsxs(Typography, { sx: { fontSize: 13, fontWeight: 300, color: 'var(--ink-3)', mt: 0.75 }, children: [binsComplete, " of ", bins.length, ' ', bins.length === 1 ? 'bin' : 'bins', " counted"] })] }), error && (_jsx(Alert, { severity: "error", sx: { mb: 2, borderRadius: '10px' }, children: error })), phase === 'brief' && (_jsxs(Box, { sx: {
                    bgcolor: 'var(--surface)',
                    border: '1px solid var(--rule)',
                    borderRadius: '14px',
                    p: 3,
                }, children: [_jsx(ScanBarcode, { size: 28, color: "var(--accent)" }), _jsxs(Typography, { sx: { fontSize: 18, fontWeight: 600, color: 'var(--ink)', mt: 1.5 }, children: [bins.length - binsComplete, ' ', bins.length - binsComplete === 1 ? 'bin' : 'bins', " remaining"] }), _jsx(Typography, { sx: {
                            fontSize: 13,
                            fontWeight: 300,
                            color: 'var(--ink-3)',
                            mt: 0.75,
                            mb: 2.5,
                        }, children: "Scan the bin, then scan each item and enter what you physically see. System quantities stay hidden while you count." }), _jsx(Button, { variant: "contained", onClick: () => void handleStart(), disabled: submitting || Boolean(error && lines.length === 0), children: submitting
                            ? 'Starting…'
                            : binsComplete > 0
                                ? 'Continue count'
                                : 'Start count' }), _jsx(Button, { onClick: onComplete, disabled: submitting, sx: { ml: 1 }, children: "Back" })] })), phase === 'location' && activeBin && (_jsxs(Box, { sx: {
                    bgcolor: 'var(--surface)',
                    border: '1px solid var(--rule)',
                    borderRadius: '14px',
                    p: 3,
                }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }, children: [_jsx(MapPin, { size: 18, color: "var(--accent)" }), _jsx(Typography, { sx: { fontSize: 14, fontWeight: 600, color: 'var(--ink)' }, children: "Scan the bin barcode" })] }), _jsxs(Typography, { sx: { fontSize: 12, color: 'var(--ink-3)', mb: 1.5 }, children: ["Bin ", activeBinNumber, " of ", bins.length, " \u00B7", ' ', activeBin.lines.length, ' ', activeBin.lines.length === 1 ? 'item' : 'items', " to check"] }), _jsx(TextField, { inputRef: locationInputRef, fullWidth: true, value: locationInput, onChange: (event) => setLocationInput(event.target.value.toUpperCase()), onKeyDown: (event) => {
                            if (event.key === 'Enter')
                                handleLocation();
                        }, placeholder: "Scan bin barcode", disabled: submitting, autoComplete: "off", inputProps: { autoComplete: 'off' } }), _jsx(Button, { variant: "contained", onClick: handleLocation, disabled: !locationInput.trim() || submitting, sx: { mt: 1.5 }, children: "Confirm bin" })] })), phase === 'bin' && activeBin && (_jsxs(Box, { sx: {
                    bgcolor: 'var(--surface)',
                    border: '1px solid var(--rule)',
                    borderRadius: '14px',
                    p: 2.25,
                }, children: [_jsxs(Box, { sx: {
                            display: 'flex',
                            alignItems: 'baseline',
                            justifyContent: 'space-between',
                            mb: 1.25,
                        }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.75 }, children: [_jsx(MapPin, { size: 17, color: "var(--accent)" }), _jsx(Typography, { sx: { fontSize: 20, fontWeight: 700, color: 'var(--ink)' }, children: activeBin.location_code })] }), _jsxs(Typography, { sx: { fontSize: 12, color: 'var(--ink-3)' }, children: ["Bin ", activeBinNumber, " of ", bins.length, " \u00B7 ", activeBinResolved, " of", ' ', activeBin.lines.length, " items"] })] }), _jsx(TextField, { inputRef: scanInputRef, fullWidth: true, size: "small", value: scanInput, onChange: (event) => setScanInput(event.target.value), onKeyDown: (event) => {
                            if (event.key === 'Enter')
                                void handleScan();
                        }, placeholder: "Scan product barcode", disabled: submitting || activeBinComplete, autoComplete: "off", inputProps: { autoComplete: 'off' }, sx: { mb: 1.25 } }), _jsx(Box, { sx: { borderTop: '1px solid var(--rule)' }, children: activeBin.lines.map(renderRow) }), activeBinComplete && (_jsx(Button, { variant: "contained", onClick: handleNextBin, disabled: submitting, sx: { mt: 2 }, children: firstOpenBin() ? 'Next bin' : 'Review count' }))] })), phase === 'summary' && (_jsxs(Box, { sx: {
                    bgcolor: 'var(--surface)',
                    border: '1px solid var(--rule)',
                    borderRadius: '14px',
                    p: 3,
                }, children: [_jsx(CheckCircle2, { size: 30, color: "var(--accent)" }), _jsx(Typography, { sx: { fontSize: 18, fontWeight: 600, color: 'var(--ink)', mt: 1.5 }, children: "All bins counted" }), _jsx(Typography, { sx: {
                            fontSize: 13,
                            fontWeight: 300,
                            color: 'var(--ink-3)',
                            mt: 0.75,
                            mb: 2.5,
                        }, children: "Finish the count to send it for the next required step." }), _jsx(Button, { variant: "contained", onClick: () => void handleFinish(), disabled: submitting || unresolvedLines.length > 0, children: submitting ? 'Finishing…' : 'Finish count' })] })), phase === 'complete' && (_jsxs(Box, { sx: {
                    bgcolor: 'var(--surface)',
                    border: '1px solid var(--rule)',
                    borderRadius: '14px',
                    p: 3,
                }, children: [_jsx(CheckCircle2, { size: 32, color: "var(--accent)" }), _jsx(Typography, { sx: { fontSize: 19, fontWeight: 600, color: 'var(--ink)', mt: 1.5 }, children: "Count submitted" }), _jsx(Typography, { sx: {
                            fontSize: 13,
                            fontWeight: 300,
                            color: 'var(--ink-3)',
                            mt: 0.75,
                            mb: 2.5,
                        }, children: "Your count has been submitted. You can return to Warehouse." }), _jsx(Button, { variant: "contained", onClick: onComplete, children: "Back to Warehouse" })] })), _jsxs(Dialog, { open: findingDraft !== null, onClose: () => {
                    if (!submitting) {
                        setFindingDraft(null);
                        setError(null);
                    }
                }, fullWidth: true, maxWidth: "xs", children: [_jsx(DialogTitle, { children: findingDraft?.finding_type === 'unexpected_item'
                            ? 'Unexpected item found'
                            : 'Report defective stock' }), _jsxs(DialogContent, { children: [error && (_jsx(Alert, { severity: "error", sx: { mb: 2 }, children: error })), _jsx(Typography, { sx: { fontSize: 13, color: 'var(--ink-3)', mb: 2 }, children: findingDraft?.finding_type === 'unexpected_item'
                                    ? `This item is not expected at ${findingDraft.location_code}. Record what you physically found.`
                                    : 'Keep these units in the physical count. Record only the units that are defective.' }), findingDraft?.line && (_jsxs(Box, { sx: { display: 'flex', gap: 1, mb: 2 }, children: [_jsx(Button, { variant: findingDraft.finding_type === 'product_defect'
                                            ? 'contained'
                                            : 'outlined', onClick: () => setFindingDraft((previous) => previous
                                            ? { ...previous, finding_type: 'product_defect' }
                                            : previous), disabled: submitting, children: "Product defect" }), _jsx(Button, { variant: findingDraft.finding_type === 'packaging_defect'
                                            ? 'contained'
                                            : 'outlined', onClick: () => setFindingDraft((previous) => previous
                                            ? { ...previous, finding_type: 'packaging_defect' }
                                            : previous), disabled: submitting, children: "Packaging defect" })] })), _jsx(TextField, { fullWidth: true, label: "Quantity", value: findingQuantity, onChange: (event) => {
                                    setFindingQuantity(event.target.value);
                                    setError(null);
                                }, disabled: submitting, inputProps: {
                                    inputMode: 'numeric',
                                    pattern: '[0-9]*',
                                } }), _jsx(TextField, { fullWidth: true, multiline: true, minRows: 2, value: findingNotes, onChange: (event) => setFindingNotes(event.target.value), placeholder: "Optional note", disabled: submitting, sx: { mt: 2 } }), findingDraft?.line && (_jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', mt: 1 }, children: ["Physically counted: ", findingDraft.line.counted_quantity] }))] }), _jsxs(DialogActions, { children: [_jsx(Button, { onClick: () => {
                                    setFindingDraft(null);
                                    setError(null);
                                }, disabled: submitting, children: "Cancel" }), _jsx(Button, { variant: "contained", onClick: () => void handleSaveFinding(), disabled: submitting || !findingQuantity.trim(), children: submitting ? 'Saving…' : 'Record finding' })] })] }), _jsxs(Dialog, { open: skipTargetId !== null, onClose: () => {
                    if (!submitting)
                        setSkipTargetId(null);
                }, fullWidth: true, maxWidth: "xs", children: [_jsx(DialogTitle, { children: "Why can\u2019t this item be counted?" }), _jsxs(DialogContent, { children: [_jsx(Box, { sx: {
                                    display: 'grid',
                                    gridTemplateColumns: '1fr',
                                    gap: 1,
                                    pt: 0.5,
                                }, children: SKIP_OPTIONS.map((option) => (_jsx(Button, { variant: skipReason === option.value ? 'contained' : 'outlined', onClick: () => {
                                        setSkipReason(option.value);
                                        setError(null);
                                    }, disabled: submitting, sx: { justifyContent: 'flex-start' }, children: option.label }, option.value))) }), skipReason === 'other' && (_jsx(TextField, { fullWidth: true, multiline: true, minRows: 2, value: skipNotes, onChange: (event) => setSkipNotes(event.target.value), placeholder: "What prevented the count?", disabled: submitting, sx: { mt: 2 } }))] }), _jsxs(DialogActions, { children: [_jsx(Button, { onClick: () => setSkipTargetId(null), disabled: submitting, children: "Cancel" }), _jsx(Button, { variant: "contained", onClick: () => void handleSkip(), disabled: !skipReason ||
                                    submitting ||
                                    (skipReason === 'other' && !skipNotes.trim()), children: submitting ? 'Saving…' : 'Skip item' })] })] })] }));
}
//# sourceMappingURL=CountingSessionPage.js.map