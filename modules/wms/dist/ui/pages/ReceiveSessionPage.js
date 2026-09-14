import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// modules/wms/src/ui/pages/ReceiveSessionPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Paper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography, useTheme, } from '@mui/material';
import { AlertTriangle, CheckCircle, Hash, Package, ScanBarcode, } from 'lucide-react';
const PROBLEM_LABELS = {
    defect: 'Damaged unit',
    packaging_damage: 'Damaged packaging',
    wrong_item: 'Wrong product',
    wrong_variant: 'Wrong variant',
    wrong_quantity: 'Missing or extra',
    missing_item: 'Missing item',
    extra_item: 'Extra item',
    barcode_mismatch: 'Barcode problem',
    other: 'Other problem',
};
const PROBLEM_CHOICES = [
    { id: 'defect', label: 'Damaged unit', problemType: 'defect' },
    { id: 'packaging_damage', label: 'Damaged packaging', problemType: 'packaging_damage' },
    { id: 'wrong_item', label: 'Wrong product', problemType: 'wrong_item' },
    { id: 'wrong_variant', label: 'Wrong variant', problemType: 'wrong_variant' },
    {
        id: 'missing_item',
        label: 'Missing item',
        problemType: 'missing_item',
        defaultNotes: 'Missing item reported during receive',
    },
    {
        id: 'extra_item',
        label: 'Extra item',
        problemType: 'extra_item',
        defaultNotes: 'Extra item reported during receive',
    },
    { id: 'barcode_mismatch', label: 'Barcode problem', problemType: 'barcode_mismatch' },
    { id: 'other', label: 'Other', problemType: 'other' },
];
const RECONCILIATION_CHOICES = [
    { type: 'defect', label: 'Damaged unit' },
    { type: 'wrong_item', label: 'Wrong product' },
    { type: 'wrong_variant', label: 'Wrong variant' },
    { type: 'missing_item', label: 'Missing item' },
    { type: 'other', label: 'Other', requiresNotes: true },
];
const OPS_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
const monoSx = { fontFamily: OPS_MONO, letterSpacing: 0 };
const OPS_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatOpsDate(value) {
    if (!value)
        return '—';
    const calendarDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (calendarDate) {
        const [, year, month, day] = calendarDate;
        return `${Number(day)} ${OPS_MONTHS[Number(month) - 1]} ${year}`;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return value;
    return `${parsed.getDate()} ${OPS_MONTHS[parsed.getMonth()]} ${parsed.getFullYear()}`;
}
function formatOpsTimestamp(value) {
    if (!value)
        return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return value;
    const hours = String(parsed.getHours()).padStart(2, '0');
    const minutes = String(parsed.getMinutes()).padStart(2, '0');
    return `${parsed.getDate()} ${OPS_MONTHS[parsed.getMonth()]} ${parsed.getFullYear()} · ${hours}:${minutes}`;
}
const countStepperButtonSx = (emphasized = false) => ({
    minWidth: 0,
    height: 40,
    px: 1.5,
    borderRadius: '6px',
    bgcolor: emphasized ? 'var(--surface)' : 'transparent',
    borderColor: emphasized ? 'var(--rule-2)' : 'var(--rule)',
    color: 'var(--ink)',
    fontWeight: 800,
    '&:hover': {
        bgcolor: 'var(--surface)',
        borderColor: 'var(--rule-2)',
    },
    '&.Mui-disabled': {
        bgcolor: 'transparent',
        borderColor: 'var(--rule)',
    },
});
const countStepperValueSx = {
    '& .MuiInputBase-root': {
        height: 40,
        borderRadius: '6px',
        bgcolor: 'transparent',
        color: 'var(--ink)',
    },
    '& .MuiOutlinedInput-notchedOutline': {
        borderColor: 'var(--rule)',
    },
    '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': {
        borderColor: 'var(--rule-2)',
    },
    '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
        borderColor: 'var(--rule-2)',
        borderWidth: 1,
    },
    '& .MuiInputBase-input': {
        py: 0,
    },
};
const reconciliationChoiceSx = (selected) => ({
    minHeight: 40,
    px: 1.5,
    py: 0.75,
    borderRadius: '6px',
    justifyContent: 'flex-start',
    bgcolor: selected ? 'var(--surface)' : 'transparent',
    borderColor: selected ? 'var(--rule-2)' : 'var(--rule)',
    color: 'var(--ink)',
    boxShadow: 'none',
    fontWeight: selected ? 700 : 600,
    cursor: 'pointer',
    '&:hover': {
        bgcolor: selected ? 'var(--surface)' : 'var(--surface-2, var(--surface))',
        borderColor: 'var(--rule-2)',
    },
    '&.Mui-focusVisible': {
        outline: '2px solid var(--focus-ring, var(--rule-2))',
        outlineOffset: 2,
    },
    '&.Mui-disabled': {
        bgcolor: 'transparent',
        borderColor: 'var(--rule)',
    },
});
const reconciliationCommitActionSx = {
    width: '100%',
    minHeight: 38,
    borderRadius: '6px',
    bgcolor: 'var(--accent)',
    borderColor: 'var(--accent)',
    color: 'var(--accent-ink)',
    fontWeight: 750,
    '&:hover': {
        bgcolor: 'var(--accent)',
        borderColor: 'var(--accent)',
        opacity: 0.88,
    },
    '&.Mui-focusVisible': {
        outline: '2px solid var(--focus-ring, var(--rule-2))',
        outlineOffset: 2,
    },
    '&.Mui-disabled': {
        bgcolor: 'transparent',
        borderColor: 'var(--rule)',
        color: 'text.disabled',
    },
};
function lineName(line) {
    return line.product_title ?? line.variant_title ?? line.description ?? line.sku ?? 'Unknown item';
}
function variantName(line) {
    return line.variant_title && line.variant_title !== 'Default Title'
        ? line.variant_title
        : line.description ?? line.sku ?? 'Default variant';
}
function hasExternalBarcode(line) {
    return !!line.barcode?.trim();
}
function statusLabel(line, awaitingLabel, complete) {
    if (awaitingLabel)
        return 'label hold';
    if (complete)
        return 'received';
    if (hasExternalBarcode(line))
        return 'scan or count';
    return 'count only';
}
function problemLabel(exceptionType) {
    return PROBLEM_LABELS[exceptionType] ?? 'Reported problem';
}
function unitLabel(quantity) {
    return `${quantity} unit${quantity === 1 ? '' : 's'}`;
}
function reportedProblems(line) {
    return line.reported_problems ?? [];
}
function projectedSellable(line) {
    return Number(line.quantity_sellable_provisional
        ?? line.quantity_accepted
        ?? 0);
}
function hasProjectedReconciliation(line) {
    if (!line.reconciliation)
        return false;
    return !!line.reconciliation_started_at
        || line.reconciliation.allocations.length > 0
        || line.reconciliation.unaccounted === 0 && line.reconciliation.sellable < line.reconciliation.expected
        || line.reconciliation.sellable < line.reconciliation.expected
            && line.reconciliation.allocations.some((allocation) => allocation.counts_toward_shortfall);
}
function projectedReconciliationState(line) {
    if (!line.reconciliation)
        return null;
    const expected = Number(line.reconciliation.expected ?? line.quantity_expected);
    const sellable = Number(line.reconciliation.sellable ?? line.quantity_accepted ?? 0);
    const accounted = Number(line.reconciliation.accounted ?? 0);
    const unaccounted = Number(line.reconciliation.unaccounted ?? Math.max(0, expected - sellable - accounted));
    const totalShortfall = accounted + unaccounted;
    if (totalShortfall <= 0)
        return null;
    return {
        line,
        accepted: sellable,
        totalShortfall,
        remainingShortfall: unaccounted,
        allocations: line.reconciliation.allocations.map((allocation) => ({
            type: allocation.exception_type,
            quantity: Number(allocation.quantity_affected ?? 0),
        })),
    };
}
function problemCountLabel(line) {
    const count = reportedProblems(line).length;
    if (count === 0)
        return null;
    return `${count} problem${count === 1 ? '' : 's'} reported`;
}
function problemDetailLabel(problem) {
    const label = problemLabel(problem.exception_type);
    const quantity = unitLabel(Number(problem.quantity_affected ?? 0));
    return problem.resolved ? `${label} · ${quantity} · resolved` : `${label} · ${quantity}`;
}
function ReportedProblemSummary({ line, compact = false, }) {
    const problems = reportedProblems(line);
    if (problems.length === 0)
        return null;
    if (compact) {
        return (_jsx(Chip, { size: "small", variant: "outlined", label: `${problems.length} problem${problems.length === 1 ? '' : 's'}`, sx: {
                mt: 0.5,
                height: 24,
                maxWidth: '100%',
                borderColor: 'divider',
                bgcolor: 'background.paper',
                '& .MuiChip-label': {
                    px: 0.9,
                    fontSize: 11,
                    fontWeight: 650,
                },
            } }));
    }
    return (_jsxs(Paper, { variant: "outlined", sx: {
            width: '100%',
            minHeight: 64,
            p: 1.25,
            mb: 2,
            borderRadius: '6px',
            borderColor: 'divider',
            bgcolor: 'background.default',
            display: 'grid',
            gap: 0.75,
        }, children: [_jsxs(Box, { sx: {
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    gap: 1,
                    alignItems: 'center',
                }, children: [_jsx(Typography, { variant: "body2", fontWeight: 700, children: problemCountLabel(line) }), _jsx(Chip, { size: "small", variant: "outlined", label: "Problem Center", sx: {
                            height: 24,
                            borderColor: 'divider',
                            '& .MuiChip-label': {
                                px: 0.9,
                                fontSize: 11,
                                fontWeight: 650,
                            },
                        } })] }), problems.map((problem) => (_jsxs(Box, { sx: {
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    gap: 1,
                    alignItems: 'center',
                }, children: [_jsx(Typography, { variant: "caption", color: "text.secondary", noWrap: true, children: problemLabel(problem.exception_type) }), _jsxs(Typography, { variant: "caption", color: "text.secondary", noWrap: true, sx: monoSx, children: [unitLabel(Number(problem.quantity_affected ?? 0)), problem.resolved ? ' · resolved' : ''] })] }, problem.receive_exception_id)))] }));
}
export default function ReceiveSessionPage({ receiveJobId, poId, supplierName, closedAt, actualDeliveryDate, lines, onInspectLine, onReportException, onPersistLineProgress, onCloseJob, onComplete, onResolveBarcode, onPrintUnitLabels, onConfirmUnitLabelsPrinted, onRefresh, }) {
    const theme = useTheme();
    const scanInputRef = useRef(null);
    const progressPersistQueueRef = useRef(Promise.resolve());
    const progressPersistErrorRef = useRef(null);
    const initialComplete = useMemo(() => new Set(lines.filter((line) => line.inspection_complete).map((line) => line.receive_job_line_id)), [lines]);
    const initialAccepted = useMemo(() => Object.fromEntries(lines.map((line) => [line.receive_job_line_id, projectedSellable(line)])), [lines]);
    const initialRejected = useMemo(() => Object.fromEntries(lines.map((line) => [line.receive_job_line_id, Number(line.quantity_rejected ?? 0)])), [lines]);
    const firstBackendHold = lines.find((line) => line.awaiting_label_ack)?.receive_job_line_id ?? null;
    const firstReconciliationIndex = lines.findIndex((line) => !line.inspection_complete && hasProjectedReconciliation(line));
    const firstActiveIndex = lines.findIndex((line) => !line.inspection_complete && line.quantity_sellable_provisional != null);
    const hasResumeState = lines.some((line) => (line.inspection_complete
        || line.awaiting_label_ack
        || hasProjectedReconciliation(line)
        || line.quantity_sellable_provisional != null));
    const startsComplete = lines.length > 0 && lines.every((line) => line.inspection_complete && !line.awaiting_label_ack);
    const initialCurrentIndex = firstReconciliationIndex >= 0
        ? firstReconciliationIndex
        : firstBackendHold
            ? lines.findIndex((line) => line.receive_job_line_id === firstBackendHold)
            : firstActiveIndex >= 0
                ? firstActiveIndex
                : (() => {
                    const firstOpen = lines.findIndex((line) => !line.inspection_complete || line.awaiting_label_ack);
                    return firstOpen >= 0 ? firstOpen : 0;
                })();
    const initialReconciliationLine = firstReconciliationIndex >= 0
        ? projectedReconciliationState(lines[firstReconciliationIndex])
        : null;
    const [sessionPhase, setSessionPhase] = useState(closedAt
        ? 'handoff'
        : startsComplete
            ? 'review'
            : firstReconciliationIndex >= 0
                ? 'reconcile'
                : hasResumeState
                    ? 'inspect'
                    : 'brief');
    const [currentIndex, setCurrentIndex] = useState(initialCurrentIndex);
    const [lineAction, setLineAction] = useState('count');
    const [accepted, setAccepted] = useState(0);
    const [acceptedByLine, setAcceptedByLine] = useState(initialAccepted);
    const [rejectedByLine, setRejectedByLine] = useState(initialRejected);
    const [completeLines, setCompleteLines] = useState(initialComplete);
    const [acknowledgedLabelLines, setAcknowledgedLabelLines] = useState(new Set());
    const [labelHoldLineId, setLabelHoldLineId] = useState(firstBackendHold);
    const [labelPrintFailed, setLabelPrintFailed] = useState(false);
    const [labelAckSubmitting, setLabelAckSubmitting] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState(null);
    const [scanInputValue, setScanInputValue] = useState('');
    const [scanError, setScanError] = useState(null);
    const [scanProcessing, setScanProcessing] = useState(false);
    const [flashLine, setFlashLine] = useState(null);
    const [overDeliveryDecision, setOverDeliveryDecision] = useState(null);
    const [problemDialog, setProblemDialog] = useState(false);
    const [problemChoice, setProblemChoice] = useState(null);
    const [problemType, setProblemType] = useState(null);
    const [problemNotes, setProblemNotes] = useState('');
    const [problemQty, setProblemQty] = useState('1');
    const [problemSubmitting, setProblemSubmitting] = useState(false);
    const [problemError, setProblemError] = useState(null);
    const [shortfallModal, setShortfallModal] = useState(null);
    const [shortfallProblemType, setShortfallProblemType] = useState(null);
    const [shortfallProblemQty, setShortfallProblemQty] = useState('');
    const [shortfallProblemNotes, setShortfallProblemNotes] = useState('');
    const [shortfallSubmitting, setShortfallSubmitting] = useState(false);
    const [shortfallQtyError, setShortfallQtyError] = useState(null);
    const [reconciliationLine, setReconciliationLine] = useState(initialReconciliationLine);
    const [deliveryDate, setDeliveryDate] = useState('');
    const [closing, setClosing] = useState(false);
    const totalExpected = lines.reduce((sum, line) => sum + line.quantity_expected, 0);
    const currentLine = lines[currentIndex] ?? null;
    const isLineComplete = useCallback((line) => (completeLines.has(line.receive_job_line_id) || !!line.inspection_complete), [completeLines]);
    const isLineAwaitingLabel = useCallback((line) => {
        if (acknowledgedLabelLines.has(line.receive_job_line_id))
            return false;
        return labelHoldLineId === line.receive_job_line_id || !!line.awaiting_label_ack;
    }, [acknowledgedLabelLines, labelHoldLineId]);
    const isLineDone = useCallback((line) => (isLineComplete(line) && !isLineAwaitingLabel(line)), [isLineAwaitingLabel, isLineComplete]);
    const completedCount = lines.filter(isLineDone).length;
    const progress = lines.length ? Math.round((completedCount / lines.length) * 100) : 0;
    const currentAwaitingLabel = currentLine ? isLineAwaitingLabel(currentLine) : false;
    const currentComplete = currentLine ? isLineComplete(currentLine) : false;
    const currentCanScan = !!currentLine && hasExternalBarcode(currentLine) && !!onResolveBarcode;
    const scanReady = sessionPhase === 'inspect'
        && !!currentLine
        && lineAction === 'scan'
        && currentCanScan
        && !currentAwaitingLabel
        && !problemDialog
        && !shortfallModal
        && !reconciliationLine
        && !overDeliveryDecision
        && !submitting
        && !currentComplete;
    const activeAccepted = currentLine ? accepted : 0;
    const activeRejected = currentLine ? rejectedByLine[currentLine.receive_job_line_id] ?? 0 : 0;
    const allLinesDone = lines.length > 0 && lines.every(isLineDone);
    const persistLineProgress = useCallback((line, nextAccepted, options) => {
        setAccepted(nextAccepted);
        setAcceptedByLine((prev) => ({
            ...prev,
            [line.receive_job_line_id]: nextAccepted,
        }));
        if (!onPersistLineProgress || isLineComplete(line))
            return progressPersistQueueRef.current;
        progressPersistQueueRef.current = progressPersistQueueRef.current
            .then(async () => {
            await onPersistLineProgress(line.receive_job_line_id, {
                quantity_sellable_provisional: nextAccepted,
                ...(options?.reconciliationRequired ? { reconciliation_required: true } : {}),
            });
            progressPersistErrorRef.current = null;
        })
            .catch((err) => {
            const error = err instanceof Error ? err : new Error(err?.message ?? 'Could not save count progress.');
            progressPersistErrorRef.current = error;
        });
        return progressPersistQueueRef.current;
    }, [isLineComplete, onPersistLineProgress]);
    const flushLineProgress = useCallback(async () => {
        await progressPersistQueueRef.current;
        if (progressPersistErrorRef.current)
            throw progressPersistErrorRef.current;
    }, []);
    useEffect(() => {
        if (!currentLine)
            return;
        setAccepted(acceptedByLine[currentLine.receive_job_line_id] ?? Number(currentLine.quantity_accepted ?? 0));
        setLineAction(currentLine.quantity_sellable_provisional != null ? 'count' : currentCanScan ? 'scan' : 'count');
        setSubmitError(null);
        setScanError(null);
        setScanInputValue('');
    }, [currentCanScan, currentLine]);
    useEffect(() => {
        if (sessionPhase !== 'inspect' || !allLinesDone)
            return;
        setSessionPhase('review');
    }, [allLinesDone, sessionPhase]);
    useEffect(() => {
        if (!scanReady)
            return;
        scanInputRef.current?.focus();
    }, [scanReady, currentIndex, scanError, scanProcessing]);
    const moveToNextLineOrReview = useCallback((completedLineId, ackedLineId) => {
        const nextIndex = lines.findIndex((line) => {
            if (line.receive_job_line_id === completedLineId || line.receive_job_line_id === ackedLineId)
                return false;
            const complete = completeLines.has(line.receive_job_line_id) || !!line.inspection_complete;
            const awaitingLabel = line.receive_job_line_id === labelHoldLineId || !!line.awaiting_label_ack;
            const acked = acknowledgedLabelLines.has(line.receive_job_line_id) || line.receive_job_line_id === ackedLineId;
            return !complete || (awaitingLabel && !acked);
        });
        if (nextIndex === -1) {
            setSessionPhase('review');
            return;
        }
        setCurrentIndex(nextIndex);
        setSessionPhase('inspect');
    }, [acknowledgedLabelLines, completeLines, labelHoldLineId, lines]);
    const inspectAndResolveReadiness = useCallback(async (line, quantityAccepted, quantityRejected) => {
        await onInspectLine({
            lasyncro_variant_id: line.lasyncro_variant_id,
            receive_job_line_id: line.receive_job_line_id,
            quantity_accepted: quantityAccepted,
            quantity_rejected: quantityRejected,
        });
        setAcceptedByLine((prev) => ({ ...prev, [line.receive_job_line_id]: quantityAccepted }));
        setRejectedByLine((prev) => ({ ...prev, [line.receive_job_line_id]: quantityRejected }));
        setCompleteLines((prev) => new Set([...prev, line.receive_job_line_id]));
        const needsLabelAck = quantityAccepted > 0 && !hasExternalBarcode(line);
        if (!needsLabelAck)
            return { awaitingLabelAck: false };
        // Establish the hold before any asynchronous print work. Otherwise the
        // completed-line effect can briefly see every line as done and advance
        // the session to Review before attachment acknowledgement exists.
        setLabelHoldLineId(line.receive_job_line_id);
        if (onPrintUnitLabels) {
            try {
                await onPrintUnitLabels(line.receive_job_line_id);
                setLabelPrintFailed(false);
            }
            catch {
                setLabelPrintFailed(true);
            }
        }
        return { awaitingLabelAck: true };
    }, [onInspectLine, onPrintUnitLabels]);
    const completeLine = useCallback(async (line, quantityAccepted, quantityRejected) => {
        setSubmitting(true);
        setSubmitError(null);
        try {
            const outcome = await inspectAndResolveReadiness(line, quantityAccepted, quantityRejected);
            if (!outcome.awaitingLabelAck) {
                moveToNextLineOrReview(line.receive_job_line_id);
            }
        }
        catch (err) {
            setSubmitError(err?.message ?? 'Could not save this line. Please retry.');
        }
        finally {
            setSubmitting(false);
        }
    }, [inspectAndResolveReadiness, moveToNextLineOrReview]);
    const handleStart = useCallback(() => {
        const firstOpen = lines.findIndex((line) => !isLineDone(line));
        setCurrentIndex(firstOpen >= 0 ? firstOpen : 0);
        if (firstOpen >= 0) {
            void persistLineProgress(lines[firstOpen], projectedSellable(lines[firstOpen]));
        }
        setSessionPhase(firstOpen >= 0 ? 'inspect' : 'review');
    }, [isLineDone, lines, persistLineProgress]);
    const handleCountConfirm = useCallback(async () => {
        if (!currentLine || currentComplete || currentAwaitingLabel)
            return;
        try {
            await flushLineProgress();
        }
        catch (err) {
            setSubmitError(err?.message ?? 'Could not save count progress. Please retry.');
            return;
        }
        if (accepted > currentLine.quantity_expected) {
            setOverDeliveryDecision({ line: currentLine, counted: accepted });
            return;
        }
        const shortfall = currentLine.quantity_expected - accepted;
        if (shortfall > 0) {
            try {
                await persistLineProgress(currentLine, accepted, { reconciliationRequired: true });
                await flushLineProgress();
            }
            catch (err) {
                setSubmitError(err?.message ?? 'Could not save count progress. Please retry.');
                return;
            }
            setReconciliationLine({
                line: currentLine,
                accepted,
                totalShortfall: shortfall,
                remainingShortfall: shortfall,
                allocations: [],
            });
            setShortfallProblemType(null);
            setShortfallProblemQty('1');
            setShortfallProblemNotes('');
            setShortfallQtyError(null);
            setSessionPhase('reconcile');
            return;
        }
        await completeLine(currentLine, accepted, 0);
    }, [accepted, completeLine, currentAwaitingLabel, currentComplete, currentLine, flushLineProgress, persistLineProgress]);
    const handleScan = useCallback(async (value) => {
        if (!scanReady || !currentLine || !onResolveBarcode || scanProcessing)
            return;
        const scannedValue = value.trim();
        if (!scannedValue)
            return;
        setScanProcessing(true);
        setScanError(null);
        try {
            const resolved = await onResolveBarcode(scannedValue);
            if (!resolved?.lasyncro_variant_id) {
                setScanError(`Barcode not recognised: ${scannedValue}`);
                return;
            }
            if (resolved.lasyncro_variant_id !== currentLine.lasyncro_variant_id) {
                setScanError('That barcode belongs to a different receive line.');
                return;
            }
            const next = activeAccepted + 1;
            if (next > currentLine.quantity_expected) {
                setOverDeliveryDecision({ line: currentLine, counted: next });
                return;
            }
            void persistLineProgress(currentLine, next);
            setFlashLine(currentLine.receive_job_line_id);
            window.setTimeout(() => setFlashLine(null), 450);
        }
        catch {
            setScanError('Scan failed. Check the connection and try again.');
        }
        finally {
            setScanProcessing(false);
            setScanInputValue('');
            if (scanReady)
                window.setTimeout(() => scanInputRef.current?.focus(), 30);
        }
    }, [
        activeAccepted,
        currentLine,
        onResolveBarcode,
        persistLineProgress,
        scanProcessing,
        scanReady,
    ]);
    const handleRetryPrintLabels = useCallback(async () => {
        if (!labelHoldLineId || !onPrintUnitLabels)
            return;
        try {
            await onPrintUnitLabels(labelHoldLineId);
            setLabelPrintFailed(false);
        }
        catch {
            setLabelPrintFailed(true);
        }
    }, [labelHoldLineId, onPrintUnitLabels]);
    const handleConfirmLabelsPrinted = useCallback(async () => {
        if (!labelHoldLineId)
            return;
        setLabelAckSubmitting(true);
        setSubmitError(null);
        try {
            await onConfirmUnitLabelsPrinted(labelHoldLineId);
            setAcknowledgedLabelLines((prev) => new Set([...prev, labelHoldLineId]));
            const ackedLineId = labelHoldLineId;
            setLabelHoldLineId(null);
            setLabelPrintFailed(false);
            moveToNextLineOrReview(undefined, ackedLineId);
        }
        catch (err) {
            setSubmitError(err?.message ?? 'Could not record label acknowledgement. Please retry.');
        }
        finally {
            setLabelAckSubmitting(false);
        }
    }, [labelHoldLineId, moveToNextLineOrReview, onConfirmUnitLabelsPrinted]);
    const submitInspectionAfterShortfall = useCallback(async (line, acceptedQty, totalShortfall) => {
        try {
            const outcome = await inspectAndResolveReadiness(line, acceptedQty, totalShortfall);
            setShortfallModal(null);
            setShortfallProblemType(null);
            setShortfallProblemQty('');
            setShortfallProblemNotes('');
            setShortfallQtyError(null);
            if (!outcome.awaitingLabelAck) {
                moveToNextLineOrReview(line.receive_job_line_id);
            }
        }
        catch (err) {
            setSubmitError(err?.message ?? 'Could not save this line. Please retry.');
        }
    }, [inspectAndResolveReadiness, moveToNextLineOrReview]);
    const handleShortfallConfirm = useCallback(async () => {
        if (!shortfallModal || !shortfallProblemType)
            return;
        const qty = Number.parseInt(shortfallProblemQty, 10);
        if (!shortfallProblemQty.trim() || Number.isNaN(qty) || qty <= 0) {
            setShortfallQtyError('Enter a quantity to continue.');
            return;
        }
        if (qty > shortfallModal.remainingShortfall) {
            setShortfallQtyError(`Maximum is ${shortfallModal.remainingShortfall}.`);
            return;
        }
        const needsNotes = shortfallProblemType === 'barcode_mismatch' || shortfallProblemType === 'other';
        if (needsNotes && !shortfallProblemNotes.trim())
            return;
        setShortfallSubmitting(true);
        setSubmitError(null);
        try {
            await onReportException({
                lasyncro_variant_id: shortfallModal.line.lasyncro_variant_id,
                receive_job_line_id: shortfallModal.line.receive_job_line_id,
                exception_type: shortfallProblemType,
                quantity_affected: qty,
                accounting_role: 'shortfall',
                notes: shortfallProblemNotes.trim() || `${qty} missing during receive`,
            });
            const remainingShortfall = shortfallModal.remainingShortfall - qty;
            if (remainingShortfall > 0) {
                setShortfallModal((prev) => prev ? { ...prev, remainingShortfall } : null);
                setShortfallProblemType(null);
                setShortfallProblemQty('');
                setShortfallProblemNotes('');
            }
            else {
                await submitInspectionAfterShortfall(shortfallModal.line, shortfallModal.accepted, shortfallModal.totalShortfall);
            }
        }
        catch (err) {
            setSubmitError(err?.message ?? 'Could not report the problem. Nothing was changed; retry to continue.');
        }
        finally {
            setShortfallSubmitting(false);
        }
    }, [
        onReportException,
        shortfallModal,
        shortfallProblemNotes,
        shortfallProblemQty,
        shortfallProblemType,
        submitInspectionAfterShortfall,
    ]);
    const handleReconciliationAllocation = useCallback(async () => {
        if (!reconciliationLine || !shortfallProblemType)
            return;
        const qty = Number.parseInt(shortfallProblemQty, 10);
        if (!shortfallProblemQty.trim() || Number.isNaN(qty) || qty <= 0) {
            setShortfallQtyError('Enter a quantity to continue.');
            return;
        }
        if (qty > reconciliationLine.remainingShortfall) {
            setShortfallQtyError(`Maximum is ${reconciliationLine.remainingShortfall}.`);
            return;
        }
        if (shortfallProblemType === 'other' && !shortfallProblemNotes.trim()) {
            setShortfallQtyError('Add a note to continue.');
            return;
        }
        setShortfallSubmitting(true);
        setSubmitError(null);
        try {
            await onReportException({
                lasyncro_variant_id: reconciliationLine.line.lasyncro_variant_id,
                receive_job_line_id: reconciliationLine.line.receive_job_line_id,
                exception_type: shortfallProblemType,
                quantity_affected: qty,
                accounting_role: 'shortfall',
                notes: shortfallProblemNotes.trim() || `${qty} ${problemLabel(shortfallProblemType).toLowerCase()} during receive`,
            });
            const remainingShortfall = reconciliationLine.remainingShortfall - qty;
            const allocations = [...reconciliationLine.allocations, { type: shortfallProblemType, quantity: qty }];
            setReconciliationLine({ ...reconciliationLine, remainingShortfall, allocations });
            setShortfallProblemType(null);
            setShortfallProblemQty(remainingShortfall > 0 ? '1' : '0');
            setShortfallProblemNotes('');
            setShortfallQtyError(null);
            await onRefresh?.();
        }
        catch (err) {
            setSubmitError(err?.message ?? 'Could not add this reconciliation item. Retry to continue.');
        }
        finally {
            setShortfallSubmitting(false);
        }
    }, [
        onRefresh,
        onReportException,
        reconciliationLine,
        shortfallProblemNotes,
        shortfallProblemQty,
        shortfallProblemType,
    ]);
    const handleFinishReconciledLine = useCallback(async () => {
        if (!reconciliationLine || reconciliationLine.remainingShortfall > 0)
            return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const outcome = await inspectAndResolveReadiness(reconciliationLine.line, reconciliationLine.accepted, 0);
            const completedLineId = reconciliationLine.line.receive_job_line_id;
            setReconciliationLine(null);
            setSessionPhase('inspect');
            if (!outcome.awaitingLabelAck) {
                moveToNextLineOrReview(completedLineId);
            }
        }
        catch (err) {
            setSubmitError(err?.message ?? 'Could not finish this line. Please retry.');
        }
        finally {
            setSubmitting(false);
        }
    }, [inspectAndResolveReadiness, moveToNextLineOrReview, reconciliationLine]);
    const handleMiscount = useCallback(async () => {
        if (!shortfallModal)
            return;
        setShortfallSubmitting(true);
        setAccepted(shortfallModal.line.quantity_expected);
        try {
            const outcome = await inspectAndResolveReadiness(shortfallModal.line, shortfallModal.line.quantity_expected, 0);
            setShortfallModal(null);
            if (!outcome.awaitingLabelAck) {
                moveToNextLineOrReview(shortfallModal.line.receive_job_line_id);
            }
        }
        catch (err) {
            setSubmitError(err?.message ?? 'Could not save this line. Please retry.');
        }
        finally {
            setShortfallSubmitting(false);
        }
    }, [inspectAndResolveReadiness, moveToNextLineOrReview, shortfallModal]);
    const handleReconciliationMiscount = useCallback(async () => {
        if (!reconciliationLine)
            return;
        setShortfallSubmitting(true);
        setAccepted(reconciliationLine.line.quantity_expected);
        try {
            const outcome = await inspectAndResolveReadiness(reconciliationLine.line, reconciliationLine.line.quantity_expected, 0);
            const completedLineId = reconciliationLine.line.receive_job_line_id;
            setReconciliationLine(null);
            setSessionPhase('inspect');
            if (!outcome.awaitingLabelAck) {
                moveToNextLineOrReview(completedLineId);
            }
        }
        catch (err) {
            setSubmitError(err?.message ?? 'Could not save this line. Please retry.');
        }
        finally {
            setShortfallSubmitting(false);
        }
    }, [inspectAndResolveReadiness, moveToNextLineOrReview, reconciliationLine]);
    const openProblemDialog = useCallback((defaults) => {
        const choice = defaults?.choice ?? null;
        const option = choice ? PROBLEM_CHOICES.find((item) => item.id === choice) : undefined;
        setProblemChoice(choice);
        setProblemType(option?.problemType ?? null);
        setProblemQty(defaults?.qty ?? '1');
        setProblemNotes(defaults?.notes ?? option?.defaultNotes ?? '');
        setProblemError(null);
        setProblemDialog(true);
    }, []);
    const handleAcceptOverDelivery = useCallback(async () => {
        if (!overDeliveryDecision)
            return;
        const { line, counted } = overDeliveryDecision;
        setOverDeliveryDecision(null);
        await persistLineProgress(line, counted);
        await flushLineProgress();
        await completeLine(line, counted, 0);
    }, [completeLine, flushLineProgress, overDeliveryDecision, persistLineProgress]);
    const handleRejectOverDelivery = useCallback(() => {
        if (!overDeliveryDecision)
            return;
        void persistLineProgress(overDeliveryDecision.line, overDeliveryDecision.line.quantity_expected);
        setOverDeliveryDecision(null);
    }, [overDeliveryDecision, persistLineProgress]);
    const handleReportOverDelivery = useCallback(() => {
        if (!overDeliveryDecision)
            return;
        const extra = Math.max(1, overDeliveryDecision.counted - overDeliveryDecision.line.quantity_expected);
        void persistLineProgress(overDeliveryDecision.line, overDeliveryDecision.line.quantity_expected);
        setOverDeliveryDecision(null);
        openProblemDialog({
            choice: 'extra_item',
            qty: String(extra),
            notes: `${extra} extra unit${extra === 1 ? '' : 's'} found during receive`,
        });
    }, [openProblemDialog, overDeliveryDecision, persistLineProgress]);
    const handleReportProblem = useCallback(async () => {
        if (!currentLine || !problemType)
            return;
        const qty = Number.parseInt(problemQty, 10);
        if (Number.isNaN(qty) || qty <= 0) {
            setProblemError('Enter a quantity to continue.');
            return;
        }
        const needsNotes = problemType === 'barcode_mismatch' || problemType === 'other';
        if (needsNotes && !problemNotes.trim()) {
            setProblemError('Add a note to continue.');
            return;
        }
        setProblemSubmitting(true);
        setProblemError(null);
        try {
            await onReportException({
                lasyncro_variant_id: currentLine.lasyncro_variant_id,
                receive_job_line_id: currentLine.receive_job_line_id,
                exception_type: problemType,
                quantity_affected: qty,
                notes: problemNotes.trim() || undefined,
            });
            setProblemDialog(false);
            setProblemChoice(null);
            setProblemType(null);
            setProblemNotes('');
            setProblemQty('1');
            await onRefresh?.();
        }
        catch (err) {
            setProblemError(err?.message ?? 'Could not report the problem. Your entry is still here; retry when ready.');
        }
        finally {
            setProblemSubmitting(false);
        }
    }, [currentLine, onRefresh, onReportException, problemNotes, problemQty, problemType]);
    const handleCloseJob = useCallback(async () => {
        if (!deliveryDate.trim()) {
            setSubmitError('Actual delivery date is required before closing this receive.');
            return;
        }
        setClosing(true);
        setSubmitError(null);
        try {
            await onCloseJob({ actual_delivery_date: deliveryDate });
            await onRefresh?.();
            setSessionPhase('handoff');
        }
        catch (err) {
            setSubmitError(err?.message ?? 'Could not close receive. Nothing was changed; retry when ready.');
        }
        finally {
            setClosing(false);
        }
    }, [deliveryDate, onCloseJob, onRefresh]);
    const WorkNote = () => {
        const item = currentLine ? lineName(currentLine) : `${lines.length} lines`;
        const identity = currentLine
            ? currentLine.barcode?.trim() || currentLine.sku || currentLine.lasyncro_variant_id || currentLine.receive_job_line_id
            : receiveJobId;
        const action = sessionPhase === 'brief'
            ? 'Brief'
            : sessionPhase === 'review'
                ? 'Review'
                : sessionPhase === 'handoff'
                    ? 'Stow handoff'
                    : sessionPhase === 'reconcile'
                        ? 'Reconcile'
                        : currentAwaitingLabel
                            ? 'Label hold'
                            : lineAction === 'scan'
                                ? 'Scan line'
                                : 'Count line';
        const quantity = currentLine
            ? sessionPhase === 'reconcile' && reconciliationLine
                ? `${reconciliationLine.accepted}/${currentLine.quantity_expected}, ${reconciliationLine.remainingShortfall} unaccounted`
                : `${activeAccepted}/${currentLine.quantity_expected}${activeAccepted > currentLine.quantity_expected ? `, +${activeAccepted - currentLine.quantity_expected} extra` : ''}${activeRejected ? `, ${activeRejected} problem` : ''}`
            : `${completedCount}/${lines.length} lines`;
        const nextStep = sessionPhase === 'brief'
            ? 'start receive'
            : sessionPhase === 'review'
                ? 'close receive'
                : sessionPhase === 'handoff'
                    ? 'move stock to stow'
                    : sessionPhase === 'reconcile'
                        ? 'account shortfall'
                        : currentAwaitingLabel
                            ? 'attach LSU labels'
                            : lineAction === 'scan'
                                ? 'scan or count locally'
                                : 'finish count';
        const workNoteFields = sessionPhase === 'handoff'
            ? [
                ['Action', action],
                ['Status', 'CLOSED'],
                ['Closed at', formatOpsTimestamp(closedAt)],
                ['Actual delivery', formatOpsDate(actualDeliveryDate)],
                ['Reference', poId],
                ['Item', item],
                ['Qty', quantity],
                ['Source', supplierName],
                ['Identity', identity],
                ['Next', nextStep],
            ]
            : [
                ['Action', action],
                ['Reference', poId],
                ['Item', item],
                ['Qty', quantity],
                ['Source', supplierName],
                ['Identity', identity],
                ['Next', nextStep],
            ];
        return (_jsx(Paper, { variant: "outlined", sx: {
                px: 2,
                py: 1.25,
                borderRadius: '6px',
                bgcolor: 'background.paper',
                display: 'grid',
                gridTemplateColumns: {
                    xs: '1fr 1fr',
                    md: sessionPhase === 'handoff'
                        ? 'repeat(5, minmax(0, 1fr))'
                        : 'repeat(4, minmax(0, 1fr))',
                },
                gap: 1,
            }, children: workNoteFields.map(([label, value]) => (_jsxs(Box, { sx: { minWidth: 0 }, children: [_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { fontSize: 10, textTransform: 'uppercase' }, children: label }), _jsx(Typography, { variant: "body2", noWrap: true, sx: { ...(label === 'Item' || label === 'Source' ? {} : monoSx), fontWeight: 650 }, children: value })] }, label))) }));
    };
    const LineMedia = ({ line, size = 44 }) => (line.image_url ? (_jsx(Box, { component: "img", src: line.image_url, alt: "", sx: { width: size, height: size, objectFit: 'cover', borderRadius: '4px', flexShrink: 0 } })) : (_jsx(Box, { sx: { width: size, height: size, borderRadius: '4px', bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: _jsx(Package, { size: Math.max(16, size / 2.5), style: { opacity: 0.4 } }) })));
    const renderBrief = () => (_jsxs(Box, { sx: { display: 'grid', gap: 2 }, children: [_jsxs(Box, { children: [_jsxs(Typography, { variant: "h5", fontWeight: 750, children: ["Receive from ", supplierName] }), _jsxs(Typography, { variant: "body2", color: "text.secondary", children: ["PO ", _jsx(Box, { component: "span", sx: monoSx, children: poId }), " \u00B7 Receive ", _jsx(Box, { component: "span", sx: monoSx, children: receiveJobId })] })] }), _jsx(Paper, { variant: "outlined", sx: { borderRadius: '6px', overflow: 'hidden' }, children: _jsxs(Table, { size: "small", children: [_jsx(TableHead, { children: _jsxs(TableRow, { children: [_jsx(TableCell, { children: "Product + variant" }), _jsx(TableCell, { align: "right", children: "Expected" }), _jsx(TableCell, { align: "right", children: "Already received" }), _jsx(TableCell, { align: "right", children: "Remaining" }), _jsx(TableCell, { children: "Barcode state" })] }) }), _jsx(TableBody, { children: lines.map((line) => {
                                const acceptedQty = acceptedByLine[line.receive_job_line_id] ?? Number(line.quantity_accepted ?? 0);
                                const remainingQty = Math.max(0, line.quantity_expected - acceptedQty);
                                const awaiting = isLineAwaitingLabel(line);
                                const complete = isLineComplete(line);
                                return (_jsxs(TableRow, { children: [_jsx(TableCell, { children: _jsxs(Box, { sx: { display: 'flex', gap: 1, alignItems: 'center', minWidth: 0 }, children: [_jsx(LineMedia, { line: line, size: 36 }), _jsxs(Box, { sx: { minWidth: 0 }, children: [_jsx(Typography, { variant: "body2", fontWeight: 650, noWrap: true, children: lineName(line) }), _jsxs(Typography, { variant: "caption", color: "text.secondary", noWrap: true, children: [variantName(line), line.sku ? _jsxs(_Fragment, { children: [" \u00B7 ", _jsx(Box, { component: "span", sx: monoSx, children: line.sku })] }) : null] }), _jsx(ReportedProblemSummary, { line: line, compact: true })] })] }) }), _jsx(TableCell, { align: "right", sx: monoSx, children: line.quantity_expected }), _jsx(TableCell, { align: "right", sx: monoSx, children: acceptedQty }), _jsx(TableCell, { align: "right", sx: monoSx, children: remainingQty }), _jsx(TableCell, { children: _jsx(Chip, { size: "small", label: hasExternalBarcode(line) ? `barcode ${line.barcode}` : awaiting ? 'LSU label hold' : 'barcode-less: LSU labels after count', color: awaiting ? 'warning' : complete ? 'success' : hasExternalBarcode(line) ? 'primary' : 'default', variant: complete || awaiting ? 'filled' : 'outlined', sx: { maxWidth: 240, '& .MuiChip-label': { ...monoSx, overflow: 'hidden', textOverflow: 'ellipsis' } } }) })] }, line.receive_job_line_id));
                            }) })] }) }), _jsx(Alert, { severity: "info", children: "Barcode-capable lines can scan continuously or be counted locally. Barcode-less lines are counted, then held until LSU labels are printed and attached." }), _jsx(Button, { variant: "contained", size: "large", onClick: handleStart, sx: { justifySelf: 'start', bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 700 }, children: "Start Receive" })] }));
    const renderLineRail = () => (_jsx(Paper, { variant: "outlined", sx: { borderRadius: '6px', overflow: 'hidden' }, children: lines.map((line, index) => {
            const complete = isLineComplete(line);
            const awaiting = isLineAwaitingLabel(line);
            const done = isLineDone(line);
            return (_jsxs(Box, { component: "button", disabled: done, onClick: () => setCurrentIndex(index), sx: {
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: 'auto minmax(0,1fr) auto',
                    gap: 1,
                    alignItems: 'center',
                    p: 1.25,
                    border: 0,
                    borderBottom: index === lines.length - 1 ? 0 : '1px solid',
                    borderColor: 'divider',
                    bgcolor: currentIndex === index ? 'var(--accent-ghost)' : 'transparent',
                    color: 'text.primary',
                    textAlign: 'left',
                    cursor: done ? 'not-allowed' : 'pointer',
                    opacity: done ? 0.58 : 1,
                }, children: [done ? _jsx(CheckCircle, { size: 16, color: theme.palette.success.main }) : awaiting ? _jsx(AlertTriangle, { size: 16, color: theme.palette.warning.main }) : _jsx(Hash, { size: 16 }), _jsxs(Box, { sx: { minWidth: 0 }, children: [_jsx(Typography, { variant: "body2", fontWeight: 650, noWrap: true, children: lineName(line) }), _jsx(Typography, { variant: "caption", color: "text.secondary", noWrap: true, sx: monoSx, children: line.sku ?? line.receive_job_line_id }), _jsx(ReportedProblemSummary, { line: line, compact: true })] }), _jsx(Chip, { size: "small", label: statusLabel(line, awaiting, complete), variant: "outlined", sx: { '& .MuiChip-label': monoSx } })] }, line.receive_job_line_id));
        }) }));
    const renderInspect = () => {
        if (!currentLine)
            return null;
        const remaining = Math.max(0, currentLine.quantity_expected - activeAccepted);
        const extra = Math.max(0, activeAccepted - currentLine.quantity_expected);
        return (_jsxs(Box, { sx: {
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', lg: '320px minmax(0,1fr) 320px' },
                gap: 2,
                alignItems: 'stretch',
            }, children: [renderLineRail(), _jsxs(Paper, { variant: "outlined", sx: {
                        borderRadius: '6px',
                        p: 2.25,
                        bgcolor: flashLine === currentLine.receive_job_line_id ? 'rgba(34,197,94,0.10)' : 'background.paper',
                        transition: 'background-color 180ms ease',
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 320,
                    }, children: [_jsxs(Box, { sx: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1, mb: 2 }, children: [currentLine.sku && (_jsx(Chip, { size: "small", label: `SKU ${currentLine.sku}`, sx: { width: '100%', '& .MuiChip-label': monoSx } })), _jsx(Chip, { size: "small", label: `Expected ${currentLine.quantity_expected}`, sx: { width: '100%', '& .MuiChip-label': monoSx } }), _jsx(Chip, { size: "small", label: `Remaining ${remaining}`, color: remaining === 0 ? 'success' : 'default', sx: { width: '100%', '& .MuiChip-label': monoSx } })] }), _jsx(ReportedProblemSummary, { line: currentLine }), submitError && _jsx(Alert, { severity: "error", sx: { mb: 2 }, children: submitError }), currentAwaitingLabel ? (_jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', flex: 1, gap: 2 }, children: [_jsxs(Box, { children: [_jsx(Typography, { variant: "subtitle1", fontWeight: 750, children: "Attach a label to each unit" }), _jsxs(Typography, { variant: "body2", color: "text.secondary", sx: { mt: 0.5 }, children: [activeAccepted, " unit labels were created for ", variantName(currentLine), ". Attach one label to each unit before moving them to Stow."] })] }), labelPrintFailed && (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 }, children: [_jsx(Typography, { variant: "body2", color: "warning.main", children: "Labels could not be printed." }), onPrintUnitLabels && (_jsx(Button, { variant: "outlined", color: "warning", size: "small", onClick: () => void handleRetryPrintLabels(), sx: { borderRadius: '6px', fontWeight: 650 }, children: "Reprint labels" }))] })), _jsx(Button, { "data-testid": "confirm-unit-labels-printed", variant: "contained", disabled: labelAckSubmitting, onClick: () => void handleConfirmLabelsPrinted(), startIcon: _jsx(CheckCircle, { size: 16 }), sx: {
                                        width: '100%',
                                        minHeight: 36,
                                        mt: 'auto',
                                        bgcolor: 'var(--accent)',
                                        '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                                        borderRadius: '6px',
                                        fontWeight: 700,
                                    }, children: labelAckSubmitting ? 'Confirming...' : `All ${activeAccepted} labels are attached` })] })) : (_jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', flex: 1, gap: 2 }, children: [currentCanScan && (_jsxs(Box, { sx: { display: 'inline-flex', gap: 0.75, alignItems: 'center' }, children: [_jsx(Button, { variant: lineAction === 'scan' ? 'contained' : 'outlined', size: "small", startIcon: _jsx(ScanBarcode, { size: 14 }), onClick: () => setLineAction('scan'), sx: { borderRadius: '6px', fontWeight: 650 }, children: "Scan" }), _jsx(Button, { variant: lineAction === 'count' ? 'contained' : 'outlined', size: "small", startIcon: _jsx(Hash, { size: 14 }), onClick: () => {
                                                setLineAction('count');
                                                void persistLineProgress(currentLine, accepted);
                                            }, sx: { borderRadius: '6px', fontWeight: 650 }, children: "Count" })] })), lineAction === 'scan' && currentCanScan ? (_jsxs(Box, { sx: { display: 'grid', gap: 1 }, children: [_jsx(TextField, { inputRef: scanInputRef, size: "small", fullWidth: true, value: scanInputValue, disabled: !scanReady || scanProcessing || currentComplete, placeholder: "Scan barcode", onChange: (event) => setScanInputValue(event.target.value), onKeyDown: (event) => {
                                                if (event.key !== 'Enter')
                                                    return;
                                                const value = scanInputValue;
                                                setScanInputValue('');
                                                void handleScan(value);
                                            }, helperText: scanProcessing ? 'Processing scan...' : 'Scanner-ready: scan, process, clear, refocus', autoComplete: "off", inputProps: { style: monoSx } }), scanError && _jsx(Alert, { severity: "error", onClose: () => setScanError(null), children: scanError })] })) : (_jsxs(Box, { sx: { width: '100%', my: 'auto' }, children: [_jsxs(Box, { sx: {
                                                display: 'grid',
                                                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                                                gap: 1,
                                            }, children: [_jsx(Button, { variant: "outlined", onClick: () => {
                                                        const next = Math.max(0, accepted - 1);
                                                        void persistLineProgress(currentLine, next);
                                                    }, disabled: accepted <= 0 || currentComplete, sx: countStepperButtonSx(), children: "\u2212" }), _jsx(TextField, { size: "small", value: accepted, disabled: currentComplete, onChange: (event) => {
                                                        const next = Number.parseInt(event.target.value, 10);
                                                        if (Number.isNaN(next) || next < 0)
                                                            return;
                                                        void persistLineProgress(currentLine, next);
                                                        if (next > currentLine.quantity_expected) {
                                                            setOverDeliveryDecision({ line: currentLine, counted: next });
                                                            return;
                                                        }
                                                    }, inputProps: {
                                                        min: 0,
                                                        style: { ...monoSx, textAlign: 'center', fontWeight: 800 },
                                                    }, sx: countStepperValueSx }), _jsx(Button, { variant: "outlined", onClick: () => {
                                                        const next = accepted + 1;
                                                        void persistLineProgress(currentLine, next);
                                                        if (accepted >= currentLine.quantity_expected) {
                                                            setOverDeliveryDecision({ line: currentLine, counted: next });
                                                            return;
                                                        }
                                                    }, disabled: currentComplete, sx: countStepperButtonSx(true), children: "+" }), _jsxs(Button, { size: "small", variant: "outlined", onClick: () => void persistLineProgress(currentLine, currentLine.quantity_expected), disabled: currentComplete, sx: {
                                                        minWidth: 0,
                                                        height: 40,
                                                        gridColumn: 2,
                                                        borderRadius: '6px',
                                                        fontWeight: 650,
                                                    }, children: ["ALL ", currentLine.quantity_expected] })] }), _jsxs(Box, { sx: { mt: 1.5 }, children: [_jsxs(Box, { sx: {
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'center',
                                                        mb: 0.75,
                                                    }, children: [_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { fontWeight: 650 }, children: "COUNTED" }), _jsxs(Typography, { variant: "caption", color: "text.secondary", sx: monoSx, children: [accepted, " / ", currentLine.quantity_expected] })] }), _jsx(Box, { sx: {
                                                        height: 4,
                                                        borderRadius: 999,
                                                        bgcolor: 'action.hover',
                                                        overflow: 'hidden',
                                                    }, children: _jsx(Box, { sx: {
                                                            width: `${Math.min(100, (accepted / Math.max(1, currentLine.quantity_expected)) * 100)}%`,
                                                            height: '100%',
                                                            borderRadius: 999,
                                                            bgcolor: accepted >= currentLine.quantity_expected
                                                                ? 'var(--accent)'
                                                                : 'text.secondary',
                                                            transition: 'width 180ms ease, background-color 180ms ease',
                                                        } }) })] })] })), _jsx(Box, { sx: { display: 'grid', gridTemplateColumns: '1fr', gap: 1, mt: 'auto' }, children: _jsx(Button, { variant: "contained", size: "small", "aria-label": "Finish count Confirm line", disabled: submitting || currentComplete, onClick: () => void handleCountConfirm(), startIcon: _jsx(CheckCircle, { size: 16 }), sx: {
                                            width: '100%',
                                            minHeight: 36,
                                            bgcolor: 'var(--accent)',
                                            '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                                            borderRadius: '6px',
                                            fontWeight: 700,
                                        }, children: submitting ? 'Saving...' : 'Finish count' }) })] }))] }), _jsxs(Paper, { variant: "outlined", sx: {
                        display: { xs: 'none', lg: 'flex' },
                        flexDirection: 'column',
                        borderRadius: '6px',
                        p: 2.25,
                        minHeight: 320,
                        overflow: 'hidden',
                        bgcolor: 'background.paper',
                    }, children: [_jsxs(Box, { children: [_jsx(Typography, { variant: "subtitle2", fontWeight: 700, noWrap: true, children: lineName(currentLine) }), _jsx(Typography, { variant: "body2", color: "text.secondary", noWrap: true, children: variantName(currentLine) })] }), _jsx(Box, { sx: { flex: 1, display: 'grid', placeItems: 'center' }, children: _jsx(LineMedia, { line: currentLine, size: 220 }) })] })] }));
    };
    const renderReconciliation = () => {
        if (!reconciliationLine)
            return renderInspect();
        const { line, accepted: sellable, totalShortfall, remainingShortfall, allocations } = reconciliationLine;
        const accounted = totalShortfall - remainingShortfall;
        const selectedChoice = RECONCILIATION_CHOICES.find((choice) => choice.type === shortfallProblemType);
        return (_jsxs(Box, { sx: {
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', lg: '320px minmax(0,1fr) 320px' },
                gap: 2,
                alignItems: 'stretch',
            }, children: [renderLineRail(), _jsxs(Paper, { variant: "outlined", sx: {
                        borderRadius: '6px',
                        p: 2.25,
                        bgcolor: 'background.paper',
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 420,
                        gap: 1.5,
                    }, children: [_jsx(Box, { sx: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }, children: [
                                ['Expected', line.quantity_expected],
                                ['Sellable', sellable],
                                ['To account for', remainingShortfall],
                            ].map(([label, value]) => (_jsxs(Paper, { variant: "outlined", sx: { p: 1.25, borderRadius: '6px', minHeight: 70 }, children: [_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { textTransform: 'uppercase' }, children: label }), _jsx(Typography, { variant: "h6", sx: monoSx, fontWeight: 800, children: value })] }, label))) }), _jsxs(Typography, { variant: "body2", color: "text.secondary", sx: { mt: -0.25 }, children: ["Account for the remaining ", remainingShortfall, " units before finishing this line."] }), submitError && _jsx(Alert, { severity: "error", children: submitError }), _jsx(Box, { sx: { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 0.875 }, children: RECONCILIATION_CHOICES.map((choice) => {
                                const selected = shortfallProblemType === choice.type;
                                const isOther = choice.type === 'other';
                                return (_jsxs(Button, { variant: "outlined", color: "inherit", "aria-pressed": selected, "data-testid": `reconciliation-choice-${choice.type}`, disabled: remainingShortfall === 0 || shortfallSubmitting, onClick: () => {
                                        setShortfallProblemType(choice.type);
                                        setShortfallProblemQty('1');
                                        setShortfallProblemNotes('');
                                        setShortfallQtyError(null);
                                    }, sx: {
                                        ...reconciliationChoiceSx(selected),
                                        gridColumn: { xs: '1', sm: isOther ? '1 / -1' : 'auto' },
                                    }, style: isOther ? { gridColumn: '1 / -1' } : undefined, children: [selected && (_jsx(CheckCircle, { size: 14, "aria-hidden": "true", style: { marginRight: 8, flexShrink: 0 } })), choice.label] }, choice.type));
                            }) }), shortfallProblemType && remainingShortfall > 0 && (_jsxs(Box, { sx: { display: 'grid', gap: 1 }, children: [_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { fontWeight: 700 }, children: "Qty affected" }), _jsxs(Box, { sx: { display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr) 44px', gap: 1, alignItems: 'center' }, children: [_jsx(Button, { variant: "outlined", color: "inherit", disabled: shortfallSubmitting, onClick: () => {
                                                const current = Number.parseInt(shortfallProblemQty, 10) || 1;
                                                setShortfallProblemQty(String(Math.max(1, current - 1)));
                                            }, sx: countStepperButtonSx(), children: "\u2212" }), _jsx(TextField, { type: "number", size: "small", value: shortfallProblemQty, onChange: (event) => {
                                                setShortfallProblemQty(event.target.value);
                                                setShortfallQtyError(null);
                                            }, error: !!shortfallQtyError, helperText: shortfallQtyError ?? undefined, inputProps: {
                                                min: 1,
                                                max: remainingShortfall,
                                                'aria-label': 'Qty affected',
                                                style: { ...monoSx, textAlign: 'center' },
                                            }, sx: countStepperValueSx }), _jsx(Button, { variant: "outlined", color: "inherit", disabled: shortfallSubmitting, onClick: () => {
                                                const current = Number.parseInt(shortfallProblemQty, 10) || 1;
                                                setShortfallProblemQty(String(Math.min(remainingShortfall, current + 1)));
                                            }, sx: countStepperButtonSx(true), children: "+" })] }), selectedChoice?.requiresNotes && (_jsx(TextField, { label: "Notes", size: "small", value: shortfallProblemNotes, onChange: (event) => setShortfallProblemNotes(event.target.value), required: true, multiline: true, rows: 2 })), _jsx(Button, { variant: "contained", color: "inherit", disabled: shortfallSubmitting || !shortfallProblemType, onClick: () => void handleReconciliationAllocation(), sx: reconciliationCommitActionSx, children: shortfallSubmitting ? 'Adding...' : 'Add to reconciliation' })] })), _jsxs(Box, { sx: { mt: 'auto', display: 'grid', gap: 0.75 }, children: [_jsx(Typography, { variant: "subtitle2", fontWeight: 750, children: "Accounted" }), allocations.length === 0 ? (_jsx(Typography, { variant: "body2", color: "text.secondary", children: "No allocations yet." })) : (_jsx(Box, { sx: { display: 'grid', gap: 0.75 }, children: allocations.map((allocation, index) => (_jsxs(Box, { sx: { display: 'flex', justifyContent: 'space-between', gap: 1, borderBottom: '1px solid', borderColor: 'divider', pb: 0.75 }, children: [_jsx(Typography, { variant: "body2", children: problemLabel(allocation.type) }), _jsx(Typography, { variant: "body2", sx: monoSx, children: unitLabel(allocation.quantity) })] }, `${allocation.type}-${index}`))) })), _jsxs(Typography, { variant: "body2", sx: monoSx, children: ["Accounted ", accounted, " / ", totalShortfall] }), _jsxs(Typography, { variant: "body2", sx: monoSx, children: ["To account for ", remainingShortfall] }), _jsx(Button, { variant: "contained", disabled: remainingShortfall > 0 || submitting, onClick: () => void handleFinishReconciledLine(), sx: {
                                        mt: 0.5,
                                        width: '100%',
                                        minHeight: 36,
                                        bgcolor: 'var(--accent)',
                                        '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                                        borderRadius: '6px',
                                        fontWeight: 700,
                                    }, children: submitting ? 'Finishing...' : 'Finish line' }), allocations.length === 0 && (_jsx(Button, { color: "inherit", disabled: shortfallSubmitting || submitting, onClick: () => void handleReconciliationMiscount(), sx: { borderRadius: '6px', fontWeight: 650 }, children: "I miscounted" }))] })] }), _jsxs(Paper, { variant: "outlined", sx: {
                        display: { xs: 'none', lg: 'flex' },
                        flexDirection: 'column',
                        borderRadius: '6px',
                        p: 2.25,
                        minHeight: 420,
                        overflow: 'hidden',
                        bgcolor: 'background.paper',
                    }, children: [_jsxs(Box, { children: [_jsx(Typography, { variant: "subtitle2", fontWeight: 700, noWrap: true, children: lineName(line) }), _jsx(Typography, { variant: "body2", color: "text.secondary", noWrap: true, children: variantName(line) })] }), _jsx(Box, { sx: { flex: 1, display: 'grid', placeItems: 'center' }, children: _jsx(LineMedia, { line: line, size: 220 }) })] })] }));
    };
    const renderReview = () => {
        const totalAccepted = lines.reduce((sum, line) => sum + (acceptedByLine[line.receive_job_line_id] ?? Number(line.quantity_accepted ?? 0)), 0);
        const totalProblems = lines.reduce((sum, line) => sum + reportedProblems(line).length, 0);
        const totalExtra = lines.reduce((sum, line) => {
            const acceptedQty = acceptedByLine[line.receive_job_line_id] ?? Number(line.quantity_accepted ?? 0);
            return sum + Math.max(0, acceptedQty - line.quantity_expected);
        }, 0);
        return (_jsxs(Box, { sx: { display: 'grid', gap: 2 }, children: [_jsxs(Box, { children: [_jsx(Typography, { variant: "h5", fontWeight: 750, children: "Review receive" }), _jsx(Typography, { variant: "body2", color: "text.secondary", children: "Count and scan paths converge here before closing." })] }), submitError && _jsx(Alert, { severity: "error", children: submitError }), _jsx(Paper, { variant: "outlined", sx: { borderRadius: '6px', overflow: 'hidden' }, children: _jsxs(Table, { size: "small", children: [_jsx(TableHead, { children: _jsxs(TableRow, { children: [_jsx(TableCell, { children: "Line" }), _jsx(TableCell, { align: "right", children: "Expected" }), _jsx(TableCell, { align: "right", children: "Received" }), _jsx(TableCell, { align: "right", children: "Extra" }), _jsx(TableCell, { align: "right", children: "Problems" }), _jsx(TableCell, { children: "Status" })] }) }), _jsxs(TableBody, { children: [lines.map((line) => {
                                        const acceptedQty = acceptedByLine[line.receive_job_line_id] ?? Number(line.quantity_accepted ?? 0);
                                        const problemCount = reportedProblems(line).length;
                                        const extraQty = Math.max(0, acceptedQty - line.quantity_expected);
                                        const awaiting = isLineAwaitingLabel(line);
                                        return (_jsxs(TableRow, { children: [_jsxs(TableCell, { children: [_jsx(Typography, { variant: "body2", fontWeight: 650, children: lineName(line) }), _jsx(Typography, { variant: "caption", color: "text.secondary", sx: monoSx, children: line.sku ?? line.receive_job_line_id }), _jsx(ReportedProblemSummary, { line: line, compact: true })] }), _jsx(TableCell, { align: "right", sx: monoSx, children: line.quantity_expected }), _jsx(TableCell, { align: "right", sx: monoSx, children: acceptedQty }), _jsx(TableCell, { align: "right", sx: { ...monoSx, color: extraQty > 0 ? 'warning.main' : 'text.primary' }, children: extraQty }), _jsx(TableCell, { align: "right", sx: monoSx, children: problemCount }), _jsx(TableCell, { children: _jsx(Chip, { size: "small", color: awaiting ? 'warning' : 'success', label: awaiting ? 'label hold' : 'ready', sx: { '& .MuiChip-label': monoSx } }) })] }, line.receive_job_line_id));
                                    }), _jsxs(TableRow, { children: [_jsx(TableCell, { sx: { fontWeight: 750 }, children: "Total" }), _jsx(TableCell, { align: "right", sx: { ...monoSx, fontWeight: 750 }, children: totalExpected }), _jsx(TableCell, { align: "right", sx: { ...monoSx, fontWeight: 750 }, children: totalAccepted }), _jsx(TableCell, { align: "right", sx: { ...monoSx, fontWeight: 750, color: totalExtra > 0 ? 'warning.main' : 'text.primary' }, children: totalExtra }), _jsx(TableCell, { align: "right", sx: { ...monoSx, fontWeight: 750 }, children: totalProblems }), _jsx(TableCell, {})] })] })] }) }), _jsxs(Paper, { variant: "outlined", sx: { borderRadius: '6px', p: 2, display: 'grid', gap: 1.5, maxWidth: 420 }, children: [_jsx(TextField, { label: "Actual delivery date", type: "date", size: "small", required: true, value: deliveryDate, onChange: (event) => setDeliveryDate(event.target.value), helperText: "Required to close this receive.", InputLabelProps: { shrink: true } }), _jsx(Button, { variant: "contained", disabled: closing || !deliveryDate.trim() || lines.some(isLineAwaitingLabel), onClick: () => void handleCloseJob(), sx: { bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 700 }, children: closing ? 'Closing receive...' : 'Close receive' })] })] }));
    };
    const renderHandoff = () => (_jsxs(Box, { sx: { maxWidth: 560, mx: 'auto', textAlign: 'center', py: 7 }, children: [_jsx(CheckCircle, { size: 58, color: theme.palette.success.main }), _jsx(Typography, { variant: "h4", fontWeight: 800, sx: { mt: 2 }, children: "Receive complete" }), _jsx(Typography, { variant: "body1", color: "text.secondary", sx: { mt: 1 }, children: "Received units are now available for Stow." }), _jsx(Button, { variant: "contained", onClick: onComplete, sx: { mt: 3, bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 700 }, children: "Back to WMS" })] }));
    const renderBody = () => {
        if (sessionPhase === 'brief')
            return renderBrief();
        if (sessionPhase === 'reconcile')
            return renderReconciliation();
        if (sessionPhase === 'review')
            return renderReview();
        if (sessionPhase === 'handoff')
            return renderHandoff();
        return renderInspect();
    };
    return (_jsxs(Box, { sx: {
            position: 'fixed',
            inset: 0,
            zIndex: 1300,
            bgcolor: 'background.default',
            color: 'text.primary',
            overflow: 'auto',
        }, children: [_jsxs(Box, { sx: { minHeight: '100dvh', display: 'flex', flexDirection: 'column' }, children: [_jsxs(Box, { component: "header", sx: {
                            px: { xs: 2, md: 3 },
                            py: 1.5,
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                            bgcolor: 'background.paper',
                            position: 'sticky',
                            top: 0,
                            zIndex: 1,
                        }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1 }, children: [_jsxs(Box, { sx: { minWidth: 0 }, children: [_jsx(Typography, { variant: "overline", color: "text.secondary", sx: { fontSize: 10 }, children: "Focus receive session" }), _jsx(Typography, { variant: "h6", fontWeight: 800, noWrap: true, children: supplierName })] }), _jsx(Chip, { label: `${progress}% complete`, color: progress === 100 ? 'success' : 'default', sx: { '& .MuiChip-label': monoSx } })] }), _jsx(LinearProgress, { variant: "determinate", value: progress, sx: { height: 5, borderRadius: 1, mb: 1.25 } }), _jsx(WorkNote, {})] }), _jsx(Box, { component: "main", sx: { width: '100%', maxWidth: 1180, mx: 'auto', p: { xs: 2, md: 3 }, flex: 1 }, children: renderBody() })] }), _jsxs(Dialog, { open: !!shortfallModal, fullWidth: true, maxWidth: "sm", onClose: () => {
                    if (shortfallModal && shortfallModal.remainingShortfall === shortfallModal.totalShortfall) {
                        setShortfallModal(null);
                    }
                }, children: [_jsxs(DialogTitle, { children: [shortfallModal?.remainingShortfall, " missing unit", (shortfallModal?.remainingShortfall ?? 0) === 1 ? '' : 's'] }), _jsx(DialogContent, { children: _jsxs(Box, { sx: { display: 'grid', gap: 1.5, pt: 1 }, children: [_jsxs(Typography, { variant: "body2", color: "text.secondary", children: ["Expected ", _jsx(Box, { component: "span", sx: monoSx, children: shortfallModal?.line.quantity_expected }), ", counted ", _jsx(Box, { component: "span", sx: monoSx, children: shortfallModal?.accepted }), ". Account for every missing unit before the line can close."] }), submitError && _jsx(Alert, { severity: "error", children: submitError }), Object.keys(PROBLEM_LABELS).map((type) => (_jsx(Button, { variant: shortfallProblemType === type ? 'contained' : 'outlined', color: type === 'defect' || type === 'wrong_item' ? 'error' : 'warning', onClick: () => setShortfallProblemType(type), sx: { justifyContent: 'flex-start', borderRadius: '6px' }, children: PROBLEM_LABELS[type] }, type))), shortfallProblemType && (_jsx(TextField, { label: `Qty affected (max ${shortfallModal?.remainingShortfall})`, type: "number", size: "small", value: shortfallProblemQty, onChange: (event) => {
                                        setShortfallProblemQty(event.target.value);
                                        setShortfallQtyError(null);
                                    }, error: !!shortfallQtyError, helperText: shortfallQtyError ?? undefined, inputProps: { min: 1, max: shortfallModal?.remainingShortfall, style: monoSx } })), (shortfallProblemType === 'barcode_mismatch' || shortfallProblemType === 'other') && (_jsx(TextField, { label: shortfallProblemType === 'barcode_mismatch' ? 'Barcode value' : 'Notes', value: shortfallProblemNotes, onChange: (event) => setShortfallProblemNotes(event.target.value), required: true, multiline: shortfallProblemType === 'other', rows: shortfallProblemType === 'other' ? 2 : 1 }))] }) }), _jsxs(DialogActions, { sx: { justifyContent: 'space-between', px: 3, pb: 2 }, children: [shortfallModal && shortfallModal.remainingShortfall === shortfallModal.totalShortfall && (_jsx(Button, { color: "inherit", disabled: shortfallSubmitting, onClick: () => void handleMiscount(), children: "I miscounted" })), _jsx(Button, { variant: "contained", disabled: !shortfallProblemType || shortfallSubmitting, onClick: () => void handleShortfallConfirm(), sx: { bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 700 }, children: shortfallSubmitting ? 'Saving...' : 'Save problem' })] })] }), _jsxs(Dialog, { open: !!overDeliveryDecision, fullWidth: true, maxWidth: "sm", children: [_jsx(DialogTitle, { children: "Extra unit detected" }), _jsx(DialogContent, { children: _jsxs(Box, { sx: { display: 'grid', gap: 1.5, pt: 0.5 }, children: [_jsx(Typography, { variant: "body2", color: "text.secondary", children: "Decide what to do with the overage before this line can continue." }), _jsx(Box, { sx: {
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                                        gap: 1,
                                    }, children: [
                                        ['Expected', overDeliveryDecision?.line.quantity_expected ?? 0],
                                        ['Counted', overDeliveryDecision?.counted ?? 0],
                                        ['Extra', Math.max(0, (overDeliveryDecision?.counted ?? 0) - (overDeliveryDecision?.line.quantity_expected ?? 0))],
                                    ].map(([label, value]) => (_jsxs(Paper, { variant: "outlined", sx: { p: 1.25, borderRadius: '6px' }, children: [_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { textTransform: 'uppercase' }, children: label }), _jsx(Typography, { variant: "h6", sx: monoSx, fontWeight: 800, children: value })] }, label))) })] }) }), _jsxs(DialogActions, { children: [_jsx(Button, { onClick: handleRejectOverDelivery, color: "inherit", children: "Do not receive extra" }), _jsx(Button, { onClick: handleReportOverDelivery, color: "warning", children: "Report problem" }), _jsxs(Button, { variant: "contained", color: "warning", onClick: () => void handleAcceptOverDelivery(), children: ["Accept extra unit", Math.max(0, (overDeliveryDecision?.counted ?? 0) - (overDeliveryDecision?.line.quantity_expected ?? 0)) === 1 ? '' : 's'] })] })] }), _jsxs(Dialog, { open: problemDialog, onClose: () => !problemSubmitting && setProblemDialog(false), fullWidth: true, maxWidth: "sm", children: [_jsx(DialogTitle, { children: "Report a problem" }), _jsx(DialogContent, { children: _jsxs(Box, { sx: { display: 'grid', gap: 2, pt: 0.5 }, children: [problemError && _jsx(Alert, { severity: "error", children: problemError }), currentLine && (_jsxs(Paper, { variant: "outlined", sx: {
                                        p: 1.5,
                                        borderRadius: '6px',
                                        bgcolor: 'background.default',
                                    }, children: [_jsx(Typography, { variant: "body2", fontWeight: 700, children: lineName(currentLine) }), _jsx(Typography, { variant: "body2", color: "text.secondary", children: variantName(currentLine) }), currentLine.sku && (_jsxs(Typography, { variant: "caption", color: "text.secondary", sx: monoSx, children: ["SKU ", currentLine.sku] }))] })), _jsxs(Box, { children: [_jsx(Typography, { variant: "subtitle2", fontWeight: 700, sx: { mb: 1 }, children: "What happened?" }), _jsx(Box, { sx: {
                                                display: 'grid',
                                                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                                                gap: 1,
                                            }, children: PROBLEM_CHOICES.map((choice) => {
                                                const selected = problemChoice === choice.id;
                                                return (_jsx(Button, { variant: "outlined", onClick: () => {
                                                        if (problemChoice !== choice.id) {
                                                            setProblemNotes(choice.defaultNotes ?? '');
                                                        }
                                                        setProblemChoice(choice.id);
                                                        setProblemType(choice.problemType);
                                                        setProblemError(null);
                                                    }, sx: {
                                                        minHeight: 40,
                                                        justifyContent: 'flex-start',
                                                        borderRadius: '6px',
                                                        fontWeight: 650,
                                                        color: 'text.primary',
                                                        bgcolor: selected ? 'action.selected' : 'transparent',
                                                        borderColor: selected ? 'text.secondary' : 'divider',
                                                        boxShadow: selected ? 'inset 0 0 0 1px currentColor' : 'none',
                                                        '&:hover': {
                                                            bgcolor: selected ? 'action.selected' : 'action.hover',
                                                            borderColor: 'text.secondary',
                                                        },
                                                    }, children: choice.label }, choice.id));
                                            }) })] }), problemChoice && (_jsx(TextField, { label: "Qty affected", type: "number", size: "small", value: problemQty, onChange: (event) => setProblemQty(event.target.value), inputProps: { min: 1, style: monoSx } })), problemChoice === 'barcode_mismatch' && (_jsx(TextField, { label: "Barcode value", size: "small", value: problemNotes, onChange: (event) => setProblemNotes(event.target.value), required: true })), problemChoice === 'other' && (_jsx(TextField, { label: "Notes", size: "small", value: problemNotes, onChange: (event) => setProblemNotes(event.target.value), required: true, multiline: true, rows: 2 }))] }) }), _jsxs(DialogActions, { sx: { px: 3, pb: 2.5, gap: 1 }, children: [_jsx(Button, { color: "inherit", disabled: problemSubmitting, onClick: () => setProblemDialog(false), children: "Cancel" }), _jsx(Button, { variant: "contained", disabled: !problemChoice || !problemType || problemSubmitting, onClick: () => void handleReportProblem(), sx: {
                                    bgcolor: 'var(--accent)',
                                    '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                                    borderRadius: '6px',
                                    fontWeight: 700,
                                }, children: problemSubmitting ? 'Saving...' : 'Report problem' })] })] })] }));
}
//# sourceMappingURL=ReceiveSessionPage.js.map