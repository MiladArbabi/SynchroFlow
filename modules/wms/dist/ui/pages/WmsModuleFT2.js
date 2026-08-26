import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// modules/wms/src/ui/pages/WmsModuleFT2.tsx
import { useState, memo, useEffect, useRef } from 'react';
import { Box, Typography, CircularProgress, Alert, TextField, Button, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, Collapse, } from '@mui/material';
import { ScanBarcode, Package, ChevronDown, ChevronUp, ArrowUp } from 'lucide-react';
import PickSessionPage from './PickSessionPage.js';
import PackSessionPage from './PackSessionPage.js';
import ReceiveSessionPage from './ReceiveSessionPage.js';
import StowSessionPage from './StowSessionPage.js';
import CountingSessionPage, { WMS_TIER1_ACTION_SX, } from './CountingSessionPage.js';
import { IsometricCanvas, ModuleErrorBoundary, WarehouseGrid } from '@lasyncro/shared/ui';
import { mapRecountPreviewBinsToCanvas, selectAllRecountBins, toggleRecountBinSelection, } from './recountSelection.js';
export { mapRecountPreviewBinsToCanvas, } from './recountSelection.js';
import ReturnSessionPage from './ReturnSessionPage.js';
import { WorkTally, isAllClear } from '../components/WorkTally.js';
const STATUS_LABELS = {
    pending: { label: 'Available', color: 'primary' },
    picking: { label: 'In Progress', color: 'warning' },
    pick_complete: { label: 'Ready to Pack', color: 'success' },
    packing: { label: 'Packing', color: 'warning' },
    pack_complete: { label: 'Complete', color: 'success' },
    cancelled: { label: 'Cancelled', color: 'error' },
};
const BatchCard = memo(function BatchCard({ batch, onClaim, onContinuePick, gridLocations, onFetchLineItems, }) {
    const releasedAt = new Date(batch.released_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const [mapOpen, setMapOpen] = useState(false);
    const [pickLocations, setPickLocations] = useState([]);
    const [mapLoading, setMapLoading] = useState(false);
    const handleToggleMap = async () => {
        if (mapOpen) {
            setMapOpen(false);
            return;
        }
        if (!onFetchLineItems || !gridLocations?.length) {
            setMapOpen(true);
            return;
        }
        setMapLoading(true);
        try {
            const items = await onFetchLineItems(batch.pick_batch_id);
            const codes = [...new Set(items.map((i) => i.location_code).filter(Boolean))].sort();
            setPickLocations(codes);
        }
        catch { /* silent — grid renders with empty highlight */ }
        finally {
            setMapLoading(false);
            setMapOpen(true);
        }
    };
    const pickProgress = batch.total_units > 0
        ? Math.round((batch.units_picked / batch.total_units) * 100)
        : 0;
    const packProgress = batch.total_units > 0
        ? Math.round((batch.units_packed / batch.total_units) * 100)
        : 0;
    const isPending = batch.status === 'pending';
    const isPicking = batch.status === 'picking';
    const isPickComplete = batch.status === 'pick_complete';
    const isPacking = batch.status === 'packing';
    const ctaLabel = isPending ? 'Claim & pick →'
        : isPicking ? 'Continue picking →'
            : isPickComplete ? 'Ready to pack →'
                : isPacking ? 'Continue packing →'
                    : null;
    const handleCta = () => {
        if (isPending)
            onClaim(batch.pick_batch_id);
        else if (isPicking)
            onContinuePick(batch.pick_batch_id);
    };
    return (_jsxs(Box, { sx: {
            bgcolor: 'var(--surface)',
            border: '1px solid var(--rule)',
            borderRadius: '14px',
            p: '18px 20px',
            mb: 1.5,
        }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }, children: [_jsx(Typography, { sx: {
                            fontFamily: '"DM Mono", "SF Mono", ui-monospace, monospace',
                            fontSize: 14.5, fontWeight: 500, color: 'var(--ink)',
                            letterSpacing: '0.03em',
                        }, children: batch.pick_batch_id.slice(0, 8).toUpperCase() }), _jsx(Box, { sx: { flex: 1 } }), _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: [batch.total_line_items, " lines \u00B7 ", batch.total_units, " units \u00B7 ", releasedAt] })] }), gridLocations && gridLocations.length > 0 && (_jsxs(Box, { onClick: handleToggleMap, sx: {
                    display: 'inline-flex', alignItems: 'center', gap: 0.75,
                    px: 1.25, py: 0.5, mb: 1.75,
                    fontSize: 11, fontWeight: 500, color: 'var(--accent)',
                    border: '0.5px solid var(--accent)', borderRadius: '6px',
                    cursor: 'pointer',
                    '&:hover': { opacity: 0.75 },
                }, children: [mapLoading ? _jsx(CircularProgress, { size: 11, sx: { mr: 0.5 } }) : null, mapOpen ? 'Hide map' : 'Show pick map'] })), mapOpen && gridLocations && (_jsxs(Box, { sx: { mb: 2, border: '1px solid var(--rule)', borderRadius: '8px', p: 1, bgcolor: 'var(--bg-2)', overflowX: 'auto' }, children: [_jsx(WarehouseGrid, { locations: gridLocations, highlightedBins: pickLocations, pickPath: pickLocations, zoneTypes: ['pick'], mode: "pick", variant: "mini" }), pickLocations.length > 0 && (_jsxs(Typography, { sx: { fontSize: 10, color: 'var(--ink-4)', mt: 0.5, letterSpacing: '0.06em' }, children: ["Pick route: ", pickLocations.join(' → ')] }))] })), _jsxs(Box, { sx: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2.75, mb: 2 }, children: [_jsxs(Box, { children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.875 }, children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }, children: "Picking" }), _jsxs(Typography, { sx: { fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }, children: [batch.units_picked, "/", batch.total_units] })] }), _jsx(Box, { sx: { height: 7, borderRadius: '4px', bgcolor: 'var(--rule)', overflow: 'hidden' }, children: _jsx(Box, { sx: { width: `${pickProgress}%`, height: '100%', bgcolor: 'var(--ok, #4CAF7A)', borderRadius: '4px', transition: 'width 0.3s ease' } }) })] }), _jsxs(Box, { children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.875 }, children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }, children: "Packing" }), _jsxs(Typography, { sx: { fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }, children: [batch.units_packed, "/", batch.total_units] })] }), _jsx(Box, { sx: { height: 7, borderRadius: '4px', bgcolor: 'var(--rule)', overflow: 'hidden' }, children: _jsx(Box, { sx: { width: `${packProgress}%`, height: '100%', bgcolor: 'var(--accent)', borderRadius: '4px', transition: 'width 0.3s ease' } }) })] })] }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', pt: 1.75, borderTop: '1px solid var(--rule)' }, children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: isPicking ? 'Picking in progress' : isPickComplete ? 'Picking done · awaiting pack scan' : isPacking ? 'Packing in progress' : 'Available' }), _jsx(Box, { sx: { flex: 1 } }), ctaLabel && (_jsx(Box, { component: "button", onClick: handleCta, disabled: isPickComplete, sx: {
                            fontSize: 12, fontWeight: 600,
                            color: isPickComplete ? 'var(--ink-3)' : 'var(--accent-ink)',
                            bgcolor: isPickComplete ? 'var(--rule)' : 'var(--accent)',
                            border: 'none', borderRadius: '8px',
                            px: 2.25, py: 1,
                            cursor: isPickComplete ? 'default' : 'pointer',
                            '&:hover:not(:disabled)': { opacity: 0.88 },
                            transition: 'opacity 0.15s ease',
                        }, children: ctaLabel }))] })] }));
});
/**
 * STOW TASK CARD
 * --------------
 * Displays a pending stow task — stock that needs to be put away.
 * Triggered by: inbound receive close, cancelled order mid-pick.
 */
const StowTaskCard = memo(function StowTaskCard({ task, onOpen, }) {
    const triggerLabel = task.trigger === 'order_cancelled_mid_pick' ? 'Cancelled pick' : 'Inbound receive';
    // STOW-CARD-CTA-01 — the card is an entry point, never a confirm.
    //
    // Previously an in_progress task took a direct onConfirmStow(id) branch
    // that passed neither quantity nor LSU. Inbound stow survived it only via
    // the legacy no-LSU fallback in confirmStow; order_cancelled_mid_pick
    // hard-requires an LSU scan (stow.service.ts) and could never complete.
    // Once claimed, a task had no route back into the scan session at all.
    //
    // StowSessionPage already loads both pending and in_progress tasks, and
    // the session-entry callback only writes a URL param, so a single route
    // is safe for every status. The claim fires inside the session at the
    // location-scan step, which is why the old 'Claim & stow' label was
    // describing the session, not this button.
    const isClaimed = task.status === 'in_progress';
    return (_jsxs(Box, { sx: {
            bgcolor: 'var(--surface)',
            border: '1px solid var(--accent-border)',
            borderRadius: '14px',
            p: '18px 20px',
            mb: 1.5,
        }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.25 }, children: [task.image_url ? (_jsx(Box, { component: "img", src: task.image_url, alt: "", sx: { width: 40, height: 40, objectFit: 'cover', borderRadius: '8px', flexShrink: 0 } })) : (_jsx(Box, { sx: { width: 40, height: 40, borderRadius: '8px', bgcolor: 'var(--accent-ghost)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: _jsx(Package, { size: 18, color: "var(--accent)" }) })), _jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsx(Typography, { sx: { fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: task.product_title ?? task.variant_title ?? task.sku ?? task.lasyncro_variant_id.slice(0, 8).toUpperCase() }), task.sku && (_jsx(Typography, { sx: { fontSize: 11.5, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }, children: task.sku }))] }), _jsx(Box, { sx: { px: 1, py: 0.375, bgcolor: 'var(--accent-ghost)', border: '0.5px solid var(--accent-border)', borderRadius: '100px', flexShrink: 0 }, children: _jsx(Typography, { sx: { fontSize: 10.5, fontWeight: 600, color: 'var(--accent)', letterSpacing: '0.04em' }, children: isClaimed ? 'In progress' : 'Stow pending' }) })] }), _jsxs(Box, { sx: { display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }, children: [_jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: ["Qty: ", task.quantity] }), _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: ["Location: ", task.location_code ?? 'Unassigned'] }), _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: ["Source: ", triggerLabel] })] }), _jsx(Box, { component: "button", onClick: () => onOpen(task.stow_task_id), sx: {
                    width: '100%', fontSize: 12, fontWeight: 600,
                    color: 'var(--accent-ink)', bgcolor: 'var(--accent)',
                    border: 'none', borderRadius: '8px',
                    py: 1.25, cursor: 'pointer',
                    '&:hover': { opacity: 0.88 },
                    transition: 'opacity 0.15s ease',
                }, children: isClaimed ? 'Resume stow →' : 'Start stow →' })] }));
});
const CountingTaskCard = memo(function CountingTaskCard({ task, onOpen, currentUserId, canReassignCount, onReassignRequest, }) {
    const continuing = task.status === 'claimed' || task.status === 'counting';
    // RECOUNT-RESUME-POSITION-72: operators may only start/resume work they own.
    // Owner/admin takeover or reassignment must be explicit.
    const assignedToOther = task.status === 'dispatched' &&
        task.assigned_to !== null &&
        task.assigned_to !== currentUserId;
    const claimedByOther = continuing &&
        task.claimed_by !== null &&
        task.claimed_by !== currentUserId;
    const blockedByOwnership = assignedToOther || claimedByOther;
    // RECOUNT-CLAIM-ABANDONED-131: only on another operator's active
    // (claimed/counting) claim — never dispatched, never the viewer's own
    // task, never manual_review/committed (both fall outside `continuing`).
    const showReassign = Boolean(canReassignCount) && claimedByOther;
    return (_jsxs(Box, { sx: {
            bgcolor: 'var(--surface)',
            border: '1px solid var(--rule)',
            borderRadius: '12px',
            p: '16px 18px',
            mb: 1.25,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
        }, children: [_jsxs(Box, { sx: { minWidth: 0, flex: 1 }, children: [_jsx(Typography, { sx: {
                            fontSize: 14,
                            fontWeight: 600,
                            color: 'var(--ink)',
                        }, children: task.label }), _jsxs(Typography, { sx: {
                            fontSize: 12,
                            fontWeight: 300,
                            color: 'var(--ink-3)',
                            mt: 0.375,
                        }, children: [task.line_count, " checks", task.counted_count > 0
                                ? ` · ${task.counted_count} counted`
                                : ''] })] }), _jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }, children: [_jsx(Button, { variant: "contained", size: "small", disabled: blockedByOwnership, onClick: () => onOpen(task), sx: { ...WMS_TIER1_ACTION_SX, flexShrink: 0 }, children: assignedToOther
                            ? 'Assigned'
                            : claimedByOther
                                ? 'Claimed'
                                : continuing
                                    ? 'Continue'
                                    : 'Start count' }), showReassign && (_jsx(Button, { variant: "outlined", size: "small", onClick: () => onReassignRequest?.(task), sx: {
                            borderColor: 'var(--rule)',
                            color: 'var(--ink)',
                            borderRadius: '6px',
                            fontWeight: 600,
                            fontSize: 11,
                            px: 1,
                            py: 0.25,
                            minWidth: 'auto',
                        }, children: "Reassign count" }))] })] }));
});
function WorkQueueFamily({ title, summary, expanded, onToggle, children, }) {
    return (_jsxs(Box, { sx: { border: '1px solid var(--rule)', borderRadius: '8px', overflow: 'hidden' }, children: [_jsxs(Box, { component: "button", type: "button", "aria-expanded": expanded, onClick: onToggle, sx: {
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 2,
                    py: 1.5,
                    border: 0,
                    bgcolor: 'transparent',
                    color: 'var(--ink)',
                    font: 'inherit',
                    textAlign: 'left',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
                }, children: [_jsx(Typography, { sx: { fontSize: 14, fontWeight: 600, color: 'var(--ink)' }, children: title }), _jsx(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: summary }), _jsx(Box, { sx: { flex: 1 } }), _jsx(ChevronDown, { size: 16, color: "var(--ink-4)", style: {
                            transform: expanded ? 'rotate(180deg)' : 'none',
                            transition: 'transform 150ms ease',
                        } })] }), _jsx(Collapse, { in: expanded, children: _jsx(Box, { sx: { px: 2, pb: 2 }, children: children }) })] }));
}
function WmsModuleFT2Inner({ data, isLoading, isError, onCreateReceiveJob, onFetchReceiveJob, onInspectReceiveLine, onReportReceiveException, onCloseReceiveJob, onPrintUnitLabels, onClaimBatch, onFetchLineItems, onResolveBarcode, onConfirmScan, onReportException, onCreateProblemTask, onPickComplete, onClaimPack, onFetchPackOrders, onPackFreeScan, onConfirmPackScan, onReportPackException, onPrintLabel, onPrintInvoice, onPackComplete, onConfirmShipment, onRefresh, onSessionExit, onCountFinished, isOnline, queuedCount, stowTasks, onClaimStowTask, onConfirmStow, onFetchStowTasks, onResolveLocation, onAssignStowLocation, gridLocations, pendingReceiveSession, pendingStowTaskId, onStowSessionEnter, pendingPickBatchId, onPickSessionEnter, pendingPackBatchId, onPackSessionEnter, onRaisePackDecision, onPollPackDecision, onFetchReturnJob, onAddReturnLine, onProcessReturnLine, onCompleteReturnJob, readyToPackOrders, readyToPackCount, openReceiveJobCount, recountLocked, recountTasks, onRecountUpgrade, onFetchCountingPreview, onFetchCountingAssignees, onCreateCountingTask, onFetchCountingLines, onFetchCountingFindings, onCreateCountingFinding, onClaimCountingTask, onReassignCountingTask, onRecordCountingLine, onSkipCountingLine, onCloseCountingTask, currentUserId, canReassignCount, pendingCountTaskId, onCountSessionEnter, }) {
    const [countDialogOpen, setCountDialogOpen] = useState(false);
    const [countDialogLoading, setCountDialogLoading] = useState(false);
    const [countDialogError, setCountDialogError] = useState(null);
    const [countPreviewBins, setCountPreviewBins] = useState([]);
    const [countAssignees, setCountAssignees] = useState([]);
    const [selectedCountBins, setSelectedCountBins] = useState([]);
    const [countAssignedTo, setCountAssignedTo] = useState('');
    const [countNotes, setCountNotes] = useState('');
    const [countCreating, setCountCreating] = useState(false);
    // RECOUNT-CLAIM-ABANDONED-131
    const [reassignTask, setReassignTask] = useState(null);
    const [reassignTargets, setReassignTargets] = useState([]);
    const [reassignLoading, setReassignLoading] = useState(false);
    const [reassignError, setReassignError] = useState(null);
    const [reassignTargetId, setReassignTargetId] = useState('');
    const [reassignSubmitting, setReassignSubmitting] = useState(false);
    const openReassignDialog = async (task) => {
        setReassignTask(task);
        setReassignTargetId('');
        setReassignError(null);
        setReassignLoading(true);
        try {
            const targets = await onFetchCountingAssignees();
            setReassignTargets(targets);
        }
        catch (error) {
            setReassignError(error instanceof Error ? error.message : 'Failed to load team operators.');
        }
        finally {
            setReassignLoading(false);
        }
    };
    const closeReassignDialog = () => {
        setReassignTask(null);
        setReassignTargetId('');
        setReassignError(null);
    };
    const submitReassign = async () => {
        if (!reassignTask || reassignTargetId === '')
            return;
        setReassignSubmitting(true);
        setReassignError(null);
        try {
            await onReassignCountingTask?.(reassignTask.recount_task_id, reassignTargetId);
            onRefresh();
            closeReassignDialog();
        }
        catch (error) {
            setReassignError(error instanceof Error ? error.message : 'Reassignment failed. Try again.');
        }
        finally {
            setReassignSubmitting(false);
        }
    };
    const openCountDialog = async () => {
        setCountDialogOpen(true);
        setCountDialogLoading(true);
        setCountDialogError(null);
        setSelectedCountBins([]);
        setCountAssignedTo('');
        setCountNotes('');
        try {
            const [bins, assignees] = await Promise.all([
                onFetchCountingPreview(),
                onFetchCountingAssignees(),
            ]);
            setCountPreviewBins(bins);
            setCountAssignees(assignees);
        }
        catch (error) {
            setCountDialogError(error instanceof Error ? error.message : 'Failed to load count setup.');
        }
        finally {
            setCountDialogLoading(false);
        }
    };
    const toggleCountBin = (locationCode) => {
        setSelectedCountBins((current) => toggleRecountBinSelection(current, locationCode));
    };
    const selectAllSuggestedCountBins = () => {
        setSelectedCountBins(selectAllRecountBins(countPreviewBins));
    };
    const createCount = async () => {
        if (selectedCountBins.length === 0)
            return;
        setCountCreating(true);
        setCountDialogError(null);
        try {
            await onCreateCountingTask({
                scope: 'locations',
                location_codes: selectedCountBins,
                assigned_to: countAssignedTo === '' ? null : countAssignedTo,
                ...(countNotes.trim() ? { notes: countNotes.trim() } : {}),
            });
            setCountDialogOpen(false);
        }
        catch (error) {
            setCountDialogError(error instanceof Error ? error.message : 'Failed to create count.');
        }
        finally {
            setCountCreating(false);
        }
    };
    const countBinCanvasSelection = mapRecountPreviewBinsToCanvas(gridLocations, countPreviewBins);
    const selectedCanvasBins = selectedCountBins.filter((locationCode) => countBinCanvasSelection.selectableCodes.has(locationCode));
    // Auto-enter receive session if handed off from Suppliers portal via URL param
    const [activeSession, setActiveSession] = useState(pendingReceiveSession
        ? { type: 'receive', ...pendingReceiveSession }
        : pendingStowTaskId
            ? { type: 'stow', taskId: pendingStowTaskId }
            : null);
    useEffect(() => {
        if (pendingReceiveSession) {
            setActiveSession({ type: 'receive', ...pendingReceiveSession });
        }
    }, [pendingReceiveSession]);
    useEffect(() => {
        if (pendingStowTaskId) {
            setActiveSession({ type: 'stow', taskId: pendingStowTaskId });
        }
    }, [pendingStowTaskId]);
    useEffect(() => {
        if (recountLocked) {
            setActiveSession((session) => session?.type === 'count' ? null : session);
            return;
        }
        if (!pendingCountTaskId)
            return;
        const task = (recountTasks ?? []).find((candidate) => candidate.recount_task_id === pendingCountTaskId &&
            ((candidate.status === 'dispatched' &&
                (candidate.assigned_to === null ||
                    candidate.assigned_to === currentUserId)) ||
                ((candidate.status === 'claimed' || candidate.status === 'counting') &&
                    candidate.claimed_by === currentUserId)));
        if (task) {
            setActiveSession({ type: 'count', task });
        }
    }, [pendingCountTaskId, recountTasks, currentUserId, recountLocked]);
    useEffect(() => {
        if (pendingPickBatchId) {
            enterPickSession(pendingPickBatchId, false).catch(() => { });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const [loadingSession, setLoadingSession] = useState(false);
    const [sessionError, setSessionError] = useState(null);
    const batches = data?.batches ?? [];
    // Warehouse execution owns only physical counting work.
    // manual_review belongs to the owner decision surface, not this floor list.
    const countingTasks = (recountTasks ?? []).filter((task) => task.status === 'dispatched' ||
        task.status === 'claimed' ||
        task.status === 'counting');
    const enterPickSession = async (batchId, claim) => {
        setLoadingSession(true);
        setSessionError(null);
        try {
            if (claim)
                await onClaimBatch(batchId);
            const items = await onFetchLineItems(batchId);
            setActiveSession({ type: 'pick', batchId, lineItems: items });
            onPickSessionEnter?.(batchId);
        }
        catch (err) {
            setSessionError(err?.message ?? 'Failed to start pick session.');
        }
        finally {
            setLoadingSession(false);
        }
    };
    const [packScanLoading, setPackScanLoading] = useState(false);
    const [packScanError, setPackScanError] = useState(null);
    const [readyToPackOpen, setReadyToPackOpen] = useState(false);
    const [pickPackExpanded, setPickPackExpanded] = useState(true);
    const [puttingAwayExpanded, setPuttingAwayExpanded] = useState(false);
    const [inventoryChecksExpanded, setInventoryChecksExpanded] = useState(false);
    const [showAllInventoryChecks, setShowAllInventoryChecks] = useState(false);
    const packInputRef = useRef(null);
    const packErrorTimerRef = useRef(null);
    // Re-focus pack input whenever operations page becomes active
    useEffect(() => {
        if (!activeSession)
            setTimeout(() => packInputRef.current?.focus(), 100);
    }, [activeSession]);
    const handlePackFreeScan = async (scannedValue) => {
        if (packScanLoading)
            return;
        if (packErrorTimerRef.current)
            clearTimeout(packErrorTimerRef.current);
        setPackScanLoading(true);
        setPackScanError(null);
        try {
            const result = await onPackFreeScan(scannedValue);
            if ('error' in result) {
                setPackScanError(result.message);
                packErrorTimerRef.current = setTimeout(() => setPackScanError(null), 3500);
                return;
            }
            if (result.type === 'unit_resolved') {
                setActiveSession({ type: 'pack', freeScanResult: result });
            }
            if (result.type === 'return') {
                if (result.claimedByOther) {
                    setPackScanError('This return is already claimed by another operator.');
                    packErrorTimerRef.current = setTimeout(() => setPackScanError(null), 3500);
                    return;
                }
                setActiveSession({ type: 'return', returnJobId: result.returnJobId });
            }
        }
        catch (err) {
            const msg = err?.response?.data?.message ?? err?.message ?? 'Scan failed — try again';
            setPackScanError(msg);
            packErrorTimerRef.current = setTimeout(() => setPackScanError(null), 3500);
        }
        finally {
            setPackScanLoading(false);
            if (packInputRef.current)
                packInputRef.current.value = '';
        }
    };
    const exitSession = (finishedLabel) => {
        setActiveSession(null);
        onRefresh();
        onSessionExit?.();
        if (finishedLabel) {
            onCountFinished?.(finishedLabel);
        }
    };
    // Active pick session
    if (activeSession?.type === 'pick') {
        return (_jsx(PickSessionPage, { pickBatchId: activeSession.batchId, lineItems: activeSession.lineItems, onComplete: exitSession, onResolveBarcode: onResolveBarcode, onConfirmScan: (params) => onConfirmScan(activeSession.batchId, params), onReportException: (params) => onReportException(activeSession.batchId, params), onCreateProblemTask: onCreateProblemTask, onPickComplete: () => onPickComplete(activeSession.batchId) }));
    }
    // Active pack session (WEB-PACK-02 — item-centric free-scan)
    if (activeSession?.type === 'pack') {
        return (_jsx(PackSessionPage, { initialFreeScanResult: activeSession.freeScanResult, onPackFreeScan: onPackFreeScan, onPackCountConfirm: async (params) => {
                await onConfirmPackScan(activeSession.freeScanResult.pick_batch_id, {
                    lasyncro_order_id: activeSession.freeScanResult.lasyncro_order_id,
                    ...params,
                });
            }, onPrintInvoice: onPrintInvoice, onPrintLabel: onPrintLabel, onCreateProblemTask: onCreateProblemTask, onComplete: exitSession }));
    }
    // Active receive session
    if (activeSession?.type === 'receive') {
        return (_jsx(ReceiveSessionPage, { receiveJobId: activeSession.receiveJobId, poId: activeSession.poId, supplierName: activeSession.supplierName, lines: activeSession.lines, onInspectLine: (params) => onInspectReceiveLine?.(activeSession.receiveJobId, params) ?? Promise.resolve(), onReportException: (params) => onReportReceiveException?.(activeSession.receiveJobId, params) ?? Promise.resolve(), onCloseJob: (params) => onCloseReceiveJob?.(activeSession.receiveJobId, params) ?? Promise.resolve(), onComplete: exitSession, onResolveBarcode: onResolveBarcode, onPrintUnitLabels: onPrintUnitLabels }));
    }
    // Active stow session
    if (activeSession?.type === 'stow') {
        return (_jsx(StowSessionPage, { initialTaskId: activeSession.taskId, onComplete: exitSession, onFetchTasks: onFetchStowTasks ?? (() => Promise.resolve([])), onResolveLocation: onResolveLocation ?? (() => Promise.resolve(null)), onAssignLocation: (taskId, locationCode) => onAssignStowLocation?.(taskId, locationCode) ?? Promise.resolve(), onClaimTask: (taskId) => onClaimStowTask?.(taskId) ?? Promise.resolve(), onResolveBarcode: onResolveBarcode, onConfirmStow: (taskId, qty, lasyncroUnitId) => onConfirmStow?.(taskId, qty, lasyncroUnitId) ??
                // STOW-SPLIT-01 — StowSession requires the authoritative committed
                // server result. Never silently resolve when the confirm adapter is absent,
                // because that would let the scanner advance without a warehouse mutation.
                Promise.reject(new Error('Stow confirmation is unavailable. Return to Operations and try again.')) }));
    }
    if (activeSession?.type === 'count' && !recountLocked) {
        return (_jsx(CountingSessionPage, { task: activeSession.task, onComplete: exitSession, onFetchLines: onFetchCountingLines, onFetchFindings: onFetchCountingFindings, onCreateFinding: onCreateCountingFinding, onClaimTask: onClaimCountingTask, onResolveBarcode: onResolveBarcode, onRecordCount: onRecordCountingLine, onSkipLine: onSkipCountingLine, onCloseTask: onCloseCountingTask }));
    }
    if (activeSession?.type === 'return') {
        return (_jsx(ReturnSessionPage, { returnJobId: activeSession.returnJobId, onFetchReturnJob: onFetchReturnJob, onAddReturnLine: onAddReturnLine, onProcessReturnLine: onProcessReturnLine, onCompleteReturnJob: onCompleteReturnJob, onComplete: exitSession }));
    }
    /**
   * Counts are TASKS, not units. A batch mid-pack counts under both Picking
   * and Packing on purpose — it needs a picker's attention and a packer's,
   * and on a real floor those are different operators.
   *
   * NOTE: /batches returns { batches: [...] }, not a bare array.
   */
    const workCounts = {
        picking: (data?.batches ?? []).filter((b) => Number(b.units_picked) < Number(b.total_units)).length,
        packing: new Set((readyToPackOrders ?? []).map((o) => o.pick_batch_id)).size,
        puttingAway: (stowTasks ?? []).length,
        receiving: openReceiveJobCount ?? 0,
        counting: recountLocked ? 0 : countingTasks.length,
    };
    return (_jsxs(Box, { sx: { p: '30px 24px', maxWidth: 720, mx: 'auto' }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 3 }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }, children: "Warehouse" }), _jsx(Typography, { sx: { fontSize: 14, fontWeight: 300, color: 'var(--ink-3)', mt: 0.75 }, children: isAllClear(workCounts)
                                    ? 'All clear — nothing waiting.'
                                    : 'Work waiting to be done.' })] }), _jsx(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }, children: _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: '6px' }, children: [_jsx(Button, { variant: "contained", onClick: () => {
                                        if (recountLocked) {
                                            onRecountUpgrade?.();
                                            return;
                                        }
                                        void openCountDialog();
                                    }, sx: {
                                        bgcolor: 'var(--accent)',
                                        color: 'var(--accent-ink)',
                                        borderRadius: '6px',
                                        fontWeight: 600,
                                        '&:hover': { bgcolor: 'var(--accent-hover)' },
                                    }, children: "Reconcile inventory" }), recountLocked && (_jsxs(Box, { sx: {
                                        display: 'flex', alignItems: 'center', gap: '2px',
                                        bgcolor: 'var(--accent-ghost)',
                                        border: '1px solid var(--accent-border)',
                                        borderRadius: '4px',
                                        px: '4px', py: '1px',
                                    }, children: [_jsx(ArrowUp, { size: 8, color: "var(--accent)", strokeWidth: 2.5 }), _jsx(Typography, { sx: { fontSize: 9, fontWeight: 700, color: 'var(--accent)', lineHeight: 1.6 }, children: "Core" })] }))] }) })] }), _jsx(WorkTally, { counts: workCounts, countingLocked: recountLocked }), _jsxs(Dialog, { open: countDialogOpen, onClose: () => {
                    if (!countCreating)
                        setCountDialogOpen(false);
                }, fullWidth: true, maxWidth: "sm", children: [_jsx(DialogTitle, { children: "Reconcile inventory" }), _jsxs(DialogContent, { dividers: true, children: [_jsx(Typography, { sx: { fontSize: 13, color: 'var(--ink-3)', mb: 2 }, children: "Count what\u2019s physically in your warehouse and compare it with system stock." }), countDialogLoading && (_jsx(Box, { sx: { display: 'flex', justifyContent: 'center', py: 4 }, children: _jsx(CircularProgress, { size: 24 }) })), countDialogError && (_jsx(Alert, { severity: "error", sx: { mb: 2 }, children: countDialogError })), !countDialogLoading && (_jsxs(_Fragment, { children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', mb: 1 }, children: "Suggested bins" }), countPreviewBins.length === 0 ? (_jsx(Alert, { severity: "info", sx: { mb: 2 }, children: "No suggested bins right now." })) : (_jsxs(_Fragment, { children: [countBinCanvasSelection.canvasZones.length > 0 && (_jsx(Box, { sx: {
                                                    height: 260,
                                                    border: '1px solid var(--rule)',
                                                    borderRadius: '8px',
                                                    bgcolor: 'var(--bg-2)',
                                                    overflow: 'hidden',
                                                    mb: countBinCanvasSelection.fallbackBins.length > 0 ? 1.5 : 2.5,
                                                }, children: _jsx(IsometricCanvas, { zones: countBinCanvasSelection.canvasZones, onZoneClick: (locationCode) => {
                                                        if (countBinCanvasSelection.selectableCodes.has(locationCode)) {
                                                            toggleCountBin(locationCode);
                                                        }
                                                    }, focusedBins: selectedCanvasBins.length > 0
                                                        ? selectedCanvasBins
                                                        : undefined, focusTone: "risk", focusDimOpacity: 0.58, showLegend: false, showControls: false, disablePan: true, autoFit: true, fitPhysicalFloorFirst: true, fitPadding: 0.82 }) })), countBinCanvasSelection.fallbackBins.length > 0 && (_jsx(Box, { sx: { display: 'grid', gap: 0.75, mb: 2.5 }, children: countBinCanvasSelection.fallbackBins.map((bin) => {
                                                    const selected = selectedCountBins.includes(bin.location_code);
                                                    return (_jsxs(Box, { component: "button", type: "button", onClick: () => toggleCountBin(bin.location_code), sx: {
                                                            width: '100%',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between',
                                                            gap: 2,
                                                            px: 1.5,
                                                            py: 1.25,
                                                            borderRadius: '10px',
                                                            border: selected
                                                                ? '2px solid var(--accent)'
                                                                : '1px solid var(--rule)',
                                                            bgcolor: selected
                                                                ? 'var(--bg-3)'
                                                                : 'var(--bg-2)',
                                                            color: 'var(--ink)',
                                                            font: 'inherit',
                                                            textAlign: 'left',
                                                            cursor: 'pointer',
                                                        }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 14, fontWeight: 600 }, children: bin.location_code }), _jsxs(Typography, { sx: { fontSize: 12, color: 'var(--ink-3)' }, children: [bin.variant_count, " variant", bin.variant_count === 1 ? '' : 's', ' · ', bin.reason.replace(/_/g, ' ')] })] }), _jsxs(Typography, { sx: { fontSize: 12, color: 'var(--ink-3)' }, children: [bin.units, " units"] })] }, bin.location_code));
                                                }) }))] })), _jsxs(TextField, { select: true, fullWidth: true, size: "small", label: "Assign to", value: countAssignedTo, onChange: (event) => {
                                            const value = event.target.value;
                                            setCountAssignedTo(value === '' ? '' : Number(value));
                                        }, sx: { mb: 2 }, children: [_jsx(MenuItem, { value: "", children: "Anyone can claim" }), countAssignees.map((operator) => {
                                                const name = `${operator.first_name ?? ''} ${operator.last_name ?? ''}`.trim() ||
                                                    `Operator ${operator.user_id}`;
                                                return (_jsxs(MenuItem, { value: operator.user_id, children: [name, " \u00B7 ", operator.role] }, operator.user_id));
                                            })] }), _jsx(TextField, { fullWidth: true, size: "small", label: "Notes", placeholder: "Optional note", multiline: true, minRows: 2, value: countNotes, onChange: (event) => setCountNotes(event.target.value) })] }))] }), _jsxs(DialogActions, { children: [_jsx(Button, { onClick: () => setCountDialogOpen(false), disabled: countCreating, sx: { color: 'var(--accent)' }, children: "Cancel" }), _jsx(Button, { variant: "outlined", onClick: selectAllSuggestedCountBins, disabled: countDialogLoading ||
                                    countCreating ||
                                    countPreviewBins.length === 0, sx: {
                                    borderColor: 'var(--rule)',
                                    color: 'var(--ink)',
                                    borderRadius: '6px',
                                    fontWeight: 600,
                                }, children: "Select all suggested bins" }), _jsx(Button, { variant: "contained", onClick: () => {
                                    void createCount();
                                }, disabled: countDialogLoading ||
                                    countCreating ||
                                    selectedCountBins.length === 0, sx: {
                                    bgcolor: 'var(--accent)',
                                    color: 'var(--accent-ink)',
                                    borderRadius: '6px',
                                    fontWeight: 600,
                                    '&:hover': { bgcolor: 'var(--accent-hover)' },
                                }, children: `Create count · ${selectedCountBins.length} ${selectedCountBins.length === 1 ? 'bin' : 'bins'}` })] })] }), _jsxs(Dialog, { open: reassignTask !== null, onClose: reassignSubmitting ? undefined : closeReassignDialog, fullWidth: true, maxWidth: "xs", children: [_jsx(DialogTitle, { children: "Reassign count" }), _jsxs(DialogContent, { children: [reassignTask && (_jsxs(Typography, { sx: { fontSize: 13, color: 'var(--ink-3)', mb: 2 }, children: [reassignTask.label, " is currently claimed by another operator. Choose who should take it over."] })), reassignError && (_jsx(Alert, { severity: "error", sx: { mb: 2 }, children: reassignError })), _jsxs(TextField, { select: true, fullWidth: true, size: "small", label: "Reassign to", value: reassignTargetId, disabled: reassignLoading || reassignSubmitting, onChange: (event) => {
                                    const value = event.target.value;
                                    setReassignTargetId(value === '' ? '' : Number(value));
                                }, children: [_jsx(MenuItem, { value: "", disabled: true, children: reassignLoading ? 'Loading operators…' : 'Select an operator' }), reassignTargets
                                        .filter((operator) => operator.user_id !== reassignTask?.claimed_by)
                                        .map((operator) => {
                                        const name = `${operator.first_name ?? ''} ${operator.last_name ?? ''}`.trim() ||
                                            `Operator ${operator.user_id}`;
                                        return (_jsxs(MenuItem, { value: operator.user_id, children: [name, " \u00B7 ", operator.role] }, operator.user_id));
                                    })] })] }), _jsxs(DialogActions, { children: [_jsx(Button, { onClick: closeReassignDialog, disabled: reassignSubmitting, sx: { color: 'var(--accent)' }, children: "Cancel" }), _jsx(Button, { variant: "contained", onClick: () => void submitReassign(), disabled: reassignTargetId === '' || reassignSubmitting, sx: {
                                    bgcolor: 'var(--accent)',
                                    color: 'var(--accent-ink)',
                                    borderRadius: '6px',
                                    fontWeight: 600,
                                    '&:hover': { bgcolor: 'var(--accent-hover)' },
                                }, children: reassignSubmitting ? 'Reassigning…' : 'Reassign count' })] })] }), (isLoading || loadingSession) && (_jsx(Box, { sx: { display: 'flex', justifyContent: 'center', pt: 6 }, children: _jsx(CircularProgress, { size: 24 }) })), (isError || sessionError) && (_jsx(Alert, { severity: "error", sx: { mb: 3, borderRadius: '10px' }, children: sessionError ?? 'Failed to load warehouse data. Please refresh.' })), _jsxs(Box, { sx: { bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '12px 14px', mb: 2.75 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: { xs: 'wrap', md: 'nowrap' } }, children: [_jsx(Box, { sx: {
                                    width: 32, height: 32, borderRadius: '8px',
                                    bgcolor: packScanError ? 'rgba(229,72,77,0.12)' : 'var(--accent-ghost)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0,
                                }, children: packScanLoading
                                    ? _jsx(CircularProgress, { size: 16, sx: { color: 'var(--accent)' } })
                                    : _jsx(ScanBarcode, { size: 18, color: packScanError ? '#E5484D' : 'var(--accent)' }) }), _jsx(Typography, { sx: { fontSize: 14, fontWeight: 500, color: 'var(--ink)', flexShrink: 0 }, children: "Quick scan" }), _jsx(Box, { sx: {
                                    flex: '1 1 280px',
                                    minWidth: 0,
                                    bgcolor: 'var(--bg)',
                                    border: '1.5px solid',
                                    borderColor: packScanError ? 'error.main' : 'rgba(255,107,43,0.45)',
                                    borderRadius: '8px',
                                    px: 1.5, py: 0.75,
                                }, children: _jsx(TextField, { inputRef: packInputRef, fullWidth: true, variant: "standard", placeholder: "Scan an item or invoice barcode to begin packing", disabled: packScanLoading, onKeyDown: (e) => {
                                        if (e.key === 'Enter') {
                                            const val = packInputRef.current?.value.trim();
                                            if (val)
                                                void handlePackFreeScan(val);
                                        }
                                    }, autoComplete: "off", InputProps: { disableUnderline: true }, sx: {
                                        '& .MuiInputBase-input': {
                                            fontFamily: '"DM Mono", "SF Mono", ui-monospace, monospace',
                                            fontSize: 15, color: 'var(--ink-3)',
                                            '&::placeholder': { color: 'var(--ink-4)' },
                                        },
                                    } }) }), _jsxs(Box, { sx: {
                                    display: 'flex', alignItems: 'center', gap: 0.75,
                                    border: `1px solid ${packScanError ? 'rgba(229,72,77,0.35)' : 'rgba(76,175,122,0.3)'}`,
                                    borderRadius: '100px', px: 1.375, py: 0.5,
                                }, children: [_jsx(Box, { sx: {
                                            width: 5, height: 5, borderRadius: '50%',
                                            bgcolor: packScanError ? '#E5484D' : '#4CAF7A',
                                            ...(!packScanError && !packScanLoading && {
                                                '@keyframes wmsListenPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } },
                                                animation: 'wmsListenPulse 1.6s ease-in-out infinite',
                                            }),
                                        } }), _jsx(Typography, { sx: { fontSize: 11.5, fontWeight: 500, color: packScanError ? '#E5484D' : '#4CAF7A' }, children: packScanLoading ? 'Resolving…' : packScanError ? 'Hold' : 'Listening' })] })] }), packScanError && (_jsx(Alert, { severity: "error", sx: { mt: 1, py: 0.5, fontSize: 13, borderRadius: '8px' }, children: packScanError })), _jsx(Typography, { sx: { mt: 0.75, fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }, children: "Scanner auto-submits \u00B7 manual entry: press Enter" })] }), !isLoading && !loadingSession && (_jsxs(Box, { sx: { mt: 3 }, children: [_jsx(Typography, { sx: {
                            fontSize: 10.5,
                            fontWeight: 500,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: 'var(--ink-4)',
                            mb: 1.5,
                        }, children: "Work queue" }), _jsxs(Box, { sx: { display: 'grid', gap: 1.25 }, children: [_jsxs(WorkQueueFamily, { title: "Pick & pack", summary: `${batches.length} active ${batches.length === 1 ? 'batch' : 'batches'} · ${readyToPackCount ?? 0} ready to pack`, expanded: pickPackExpanded, onToggle: () => setPickPackExpanded((value) => !value), children: [!!readyToPackCount && readyToPackCount > 0 && (_jsxs(Box, { sx: {
                                            bgcolor: 'var(--surface)',
                                            border: '1px solid var(--rule)',
                                            borderRadius: '14px',
                                            mb: 2.5,
                                            overflow: 'hidden',
                                        }, children: [_jsxs(Box, { onClick: () => setReadyToPackOpen(v => !v), sx: {
                                                    display: 'flex', alignItems: 'center', gap: 1,
                                                    px: '20px', py: '16px', cursor: 'pointer',
                                                }, children: [_jsx(Package, { size: 16, color: "var(--accent)" }), _jsxs(Typography, { sx: { fontSize: 14, fontWeight: 500, color: 'var(--ink)' }, children: [readyToPackCount, " ", readyToPackCount === 1 ? 'order' : 'orders', " ready to be packed"] }), _jsx(Box, { sx: { flex: 1 } }), _jsx(Typography, { sx: {
                                                            fontSize: 12, color: 'var(--ink-4)',
                                                            transform: readyToPackOpen ? 'rotate(180deg)' : 'none',
                                                            transition: 'transform 0.15s',
                                                        }, children: "\u25BE" })] }), readyToPackOpen && (_jsx(Box, { sx: { px: '20px', pb: '16px' }, children: (readyToPackOrders ?? []).map(order => (_jsxs(Box, { sx: {
                                                        border: '1px solid var(--rule)', borderRadius: '10px',
                                                        p: '14px 16px', mb: 1.25,
                                                        '&:last-child': { mb: 0 },
                                                    }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 1 }, children: [_jsxs(Typography, { sx: { fontSize: 13, fontWeight: 600, color: 'var(--ink)' }, children: ["#", order.external_order_id] }), order.wms_barcode && (_jsx(Typography, { sx: {
                                                                        fontSize: 11.5, fontFamily: '"DM Mono", "SF Mono", ui-monospace, monospace',
                                                                        color: 'var(--ink-3)', ml: 'auto',
                                                                    }, children: order.wms_barcode }))] }), order.line_items.map(item => (_jsxs(Box, { sx: {
                                                                display: 'flex', alignItems: 'center', gap: 1,
                                                                py: 0.5,
                                                            }, children: [_jsxs(Typography, { sx: { fontSize: 12, color: 'var(--ink-3)', flex: 1 }, noWrap: true, children: [item.product_title, item.variant_title ? ` · ${item.variant_title}` : ''] }), _jsx(Typography, { sx: {
                                                                        fontSize: 11.5, fontFamily: '"DM Mono", "SF Mono", ui-monospace, monospace',
                                                                        color: item.unit_barcode ? 'var(--accent)' : 'var(--ink-4)',
                                                                    }, children: item.unit_barcode ?? 'no tracked unit' })] }, item.lasyncro_line_item_id)))] }, order.lasyncro_order_id))) }))] })), !isLoading && !loadingSession && batches.length > 0 && (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }, children: [_jsx(Typography, { sx: { fontSize: 10.5, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Active batches" }), _jsxs(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }, children: [batches.length, " in progress"] })] })), !isLoading && !loadingSession && !isError && batches.length === 0 && (_jsxs(Box, { sx: {
                                            textAlign: 'center', py: 8,
                                            bgcolor: 'var(--surface)', border: '1px dashed var(--rule)',
                                            borderRadius: '14px',
                                        }, children: [_jsx(ScanBarcode, { size: 36, color: "var(--ink-4)" }), _jsx(Typography, { sx: { fontSize: 13, fontWeight: 300, color: 'var(--ink-4)', mt: 1.5 }, children: "No active batches \u2014 waiting for release." })] })), !isLoading && !loadingSession && batches.map((batch) => (_jsx(BatchCard, { batch: batch, onClaim: (id) => void enterPickSession(id, true), onContinuePick: (id) => void enterPickSession(id, false), gridLocations: gridLocations, onFetchLineItems: onFetchLineItems }, batch.pick_batch_id)))] }), _jsx(WorkQueueFamily, { title: "Putting away", summary: `${(stowTasks ?? []).length} ${(stowTasks ?? []).length === 1 ? 'task' : 'tasks'}`, expanded: puttingAwayExpanded, onToggle: () => setPuttingAwayExpanded((value) => !value), children: (stowTasks ?? []).map((task) => (_jsx(StowTaskCard, { task: task, onOpen: (id) => { onStowSessionEnter?.(id); setActiveSession({ type: 'stow', taskId: id }); } }, task.stow_task_id))) }), _jsxs(WorkQueueFamily, { title: "Inventory checks", summary: recountLocked ? 'Core · Upgrade to view' : `${countingTasks.length} ${countingTasks.length === 1 ? 'task' : 'tasks'}`, expanded: inventoryChecksExpanded, onToggle: () => {
                                    if (recountLocked) {
                                        onRecountUpgrade?.();
                                        return;
                                    }
                                    if (inventoryChecksExpanded)
                                        setShowAllInventoryChecks(false);
                                    setInventoryChecksExpanded((value) => !value);
                                }, children: [!recountLocked && countingTasks.length > 0 && (showAllInventoryChecks
                                        ? countingTasks
                                        : countingTasks.slice(0, 4)).map((task) => (_jsx(CountingTaskCard, { task: task, currentUserId: currentUserId, canReassignCount: canReassignCount, onReassignRequest: (t) => void openReassignDialog(t), onOpen: (selectedTask) => {
                                            onCountSessionEnter?.(selectedTask.recount_task_id);
                                            setActiveSession({
                                                type: 'count',
                                                task: selectedTask,
                                            });
                                        } }, task.recount_task_id))), !recountLocked && countingTasks.length > 4 && (_jsxs(Box, { onClick: () => setShowAllInventoryChecks((value) => !value), sx: {
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: 0.5,
                                            px: 2.5,
                                            py: 1.125,
                                            borderTop: '1px solid var(--rule)',
                                            color: 'var(--accent)',
                                            cursor: 'pointer',
                                            '&:hover': { opacity: 0.75 },
                                        }, children: [_jsx(Typography, { sx: { fontSize: 11, fontWeight: 500 }, children: showAllInventoryChecks
                                                    ? 'Show less'
                                                    : `See ${countingTasks.length - 4} more` }), showAllInventoryChecks ? _jsx(ChevronUp, { size: 13 }) : _jsx(ChevronDown, { size: 13 })] }))] })] })] }))] }));
}
export default function WmsModuleFT2(props) {
    return _jsx(ModuleErrorBoundary, { moduleName: "wms", children: _jsx(WmsModuleFT2Inner, { ...props }) });
}
//# sourceMappingURL=WmsModuleFT2.js.map