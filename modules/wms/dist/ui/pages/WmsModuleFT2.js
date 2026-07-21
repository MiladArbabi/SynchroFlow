import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// modules/wms/src/ui/pages/WmsModuleFT2.tsx
import { useState, memo, useEffect, useRef } from 'react';
import { Box, Typography, CircularProgress, Alert, TextField, } from '@mui/material';
import { ScanBarcode, Package } from 'lucide-react';
import PickSessionPage from './PickSessionPage.js';
import PackSessionPage from './PackSessionPage.js';
import ReceiveSessionPage from './ReceiveSessionPage.js';
import StowSessionPage from './StowSessionPage.js';
import { ModuleErrorBoundary, WarehouseGrid } from '@lasyncro/shared/ui';
import ReturnSessionPage from './ReturnSessionPage.js';
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
                }, children: [mapLoading ? _jsx(CircularProgress, { size: 11, sx: { mr: 0.5 } }) : null, mapOpen ? 'Hide map' : 'Show pick map'] })), mapOpen && gridLocations && (_jsxs(Box, { sx: { mb: 2, border: '1px solid var(--rule)', borderRadius: '8px', p: 1, bgcolor: 'var(--bg-2)', overflowX: 'auto' }, children: [_jsx(WarehouseGrid, { locations: gridLocations, highlightedBins: pickLocations, pickPath: pickLocations, mode: "pick", variant: "mini" }), pickLocations.length > 0 && (_jsxs(Typography, { sx: { fontSize: 10, color: 'var(--ink-4)', mt: 0.5, letterSpacing: '0.06em' }, children: ["Pick route: ", pickLocations.join(' → ')] }))] })), _jsxs(Box, { sx: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2.75, mb: 2 }, children: [_jsxs(Box, { children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.875 }, children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }, children: "Picking" }), _jsxs(Typography, { sx: { fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }, children: [batch.units_picked, "/", batch.total_units] })] }), _jsx(Box, { sx: { height: 7, borderRadius: '4px', bgcolor: 'var(--rule)', overflow: 'hidden' }, children: _jsx(Box, { sx: { width: `${pickProgress}%`, height: '100%', bgcolor: 'var(--ok, #4CAF7A)', borderRadius: '4px', transition: 'width 0.3s ease' } }) })] }), _jsxs(Box, { children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.875 }, children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }, children: "Packing" }), _jsxs(Typography, { sx: { fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }, children: [batch.units_packed, "/", batch.total_units] })] }), _jsx(Box, { sx: { height: 7, borderRadius: '4px', bgcolor: 'var(--rule)', overflow: 'hidden' }, children: _jsx(Box, { sx: { width: `${packProgress}%`, height: '100%', bgcolor: 'var(--accent)', borderRadius: '4px', transition: 'width 0.3s ease' } }) })] })] }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', pt: 1.75, borderTop: '1px solid var(--rule)' }, children: [_jsx(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: isPicking ? 'Picking in progress' : isPickComplete ? 'Picking done · awaiting pack scan' : isPacking ? 'Packing in progress' : 'Available' }), _jsx(Box, { sx: { flex: 1 } }), ctaLabel && (_jsx(Box, { component: "button", onClick: handleCta, disabled: isPickComplete, sx: {
                            fontSize: 12, fontWeight: 600,
                            color: isPickComplete ? 'var(--ink-3)' : '#10151E',
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
const StowTaskCard = memo(function StowTaskCard({ task, onClaim, onConfirm, }) {
    const triggerLabel = task.trigger === 'order_cancelled_mid_pick' ? 'Cancelled pick' : 'Inbound receive';
    const isPending = task.status === 'pending';
    return (_jsxs(Box, { sx: {
            bgcolor: 'var(--surface)',
            border: '1px solid var(--accent-border)',
            borderRadius: '14px',
            p: '18px 20px',
            mb: 1.5,
        }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.25 }, children: [task.image_url ? (_jsx(Box, { component: "img", src: task.image_url, alt: "", sx: { width: 40, height: 40, objectFit: 'cover', borderRadius: '8px', flexShrink: 0 } })) : (_jsx(Box, { sx: { width: 40, height: 40, borderRadius: '8px', bgcolor: 'var(--accent-ghost)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: _jsx(Package, { size: 18, color: "var(--accent)" }) })), _jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsx(Typography, { sx: { fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: task.product_title ?? task.variant_title ?? task.sku ?? task.lasyncro_variant_id.slice(0, 8).toUpperCase() }), task.sku && (_jsx(Typography, { sx: { fontSize: 11.5, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }, children: task.sku }))] }), _jsx(Box, { sx: { px: 1, py: 0.375, bgcolor: 'var(--accent-ghost)', border: '0.5px solid var(--accent-border)', borderRadius: '100px', flexShrink: 0 }, children: _jsx(Typography, { sx: { fontSize: 10.5, fontWeight: 600, color: 'var(--accent)', letterSpacing: '0.04em' }, children: "Stow pending" }) })] }), _jsxs(Box, { sx: { display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }, children: [_jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: ["Qty: ", task.quantity] }), _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: ["Location: ", task.location_code ?? 'Unassigned'] }), _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: ["Source: ", triggerLabel] })] }), _jsx(Box, { component: "button", onClick: () => isPending ? onClaim(task.stow_task_id) : onConfirm(task.stow_task_id), sx: {
                    width: '100%', fontSize: 12, fontWeight: 600,
                    color: 'var(--accent-ink)', bgcolor: 'var(--accent)',
                    border: 'none', borderRadius: '8px',
                    py: 1.25, cursor: 'pointer',
                    '&:hover': { opacity: 0.88 },
                    transition: 'opacity 0.15s ease',
                }, children: isPending ? 'Claim & stow →' : 'Confirm stowed →' })] }));
});
function WmsModuleFT2Inner({ data, isLoading, isError, onCreateReceiveJob, onFetchReceiveJob, onInspectReceiveLine, onReportReceiveException, onCloseReceiveJob, onPrintUnitLabels, onClaimBatch, onFetchLineItems, onResolveBarcode, onConfirmScan, onReportException, onCreateProblemTask, onPickComplete, onClaimPack, onFetchPackOrders, onPackFreeScan, onConfirmPackScan, onReportPackException, onPrintLabel, onPrintInvoice, onPackComplete, onConfirmShipment, onRefresh, onSessionExit, isOnline, queuedCount, stowTasks, onClaimStowTask, onConfirmStow, onFetchStowTasks, onResolveLocation, onAssignStowLocation, onReportStowException, gridLocations, pendingReceiveSession, pendingStowTaskId, onStowSessionEnter, pendingPickBatchId, onPickSessionEnter, pendingPackBatchId, onPackSessionEnter, onRaisePackDecision, onPollPackDecision, onFetchReturnJob, onAddReturnLine, onProcessReturnLine, onCompleteReturnJob, }) {
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
        if (pendingPickBatchId) {
            enterPickSession(pendingPickBatchId, false).catch(() => { });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const [loadingSession, setLoadingSession] = useState(false);
    const [sessionError, setSessionError] = useState(null);
    const batches = data?.batches ?? [];
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
    const exitSession = () => {
        setActiveSession(null);
        onRefresh();
        onSessionExit?.();
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
        return (_jsx(StowSessionPage, { initialTaskId: activeSession.taskId, onComplete: exitSession, onFetchTasks: onFetchStowTasks ?? (() => Promise.resolve([])), onResolveLocation: onResolveLocation ?? (() => Promise.resolve(null)), onAssignLocation: (taskId, locationCode) => onAssignStowLocation?.(taskId, locationCode) ?? Promise.resolve(), onClaimTask: (taskId) => onClaimStowTask?.(taskId) ?? Promise.resolve(), onResolveBarcode: onResolveBarcode, onConfirmStow: (taskId, qty, lasyncroUnitId) => onConfirmStow?.(taskId, qty, lasyncroUnitId) ?? Promise.resolve(), onReportException: (taskId, params) => onReportStowException?.(taskId, params) ?? Promise.resolve({}) }));
    }
    if (activeSession?.type === 'return') {
        return (_jsx(ReturnSessionPage, { returnJobId: activeSession.returnJobId, onFetchReturnJob: onFetchReturnJob, onAddReturnLine: onAddReturnLine, onProcessReturnLine: onProcessReturnLine, onCompleteReturnJob: onCompleteReturnJob, onComplete: exitSession }));
    }
    return (_jsxs(Box, { sx: { p: '30px 24px', maxWidth: 720, mx: 'auto' }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 3 }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }, children: "Warehouse" }), _jsx(Typography, { sx: { fontSize: 14, fontWeight: 300, color: 'var(--ink-3)', mt: 0.75 }, children: "Pick and pack active batches." })] }), _jsx(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 } })] }), (isLoading || loadingSession) && (_jsx(Box, { sx: { display: 'flex', justifyContent: 'center', pt: 6 }, children: _jsx(CircularProgress, { size: 24 }) })), (isError || sessionError) && (_jsx(Alert, { severity: "error", sx: { mb: 3, borderRadius: '10px' }, children: sessionError ?? 'Failed to load warehouse data. Please refresh.' })), _jsxs(Box, { sx: { bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '20px 22px', mb: 2.75 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.625, mb: 2 }, children: [_jsx(Box, { sx: {
                                    width: 40, height: 40, borderRadius: '10px',
                                    bgcolor: packScanError ? 'rgba(229,72,77,0.12)' : 'var(--accent-ghost)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0,
                                }, children: packScanLoading
                                    ? _jsx(CircularProgress, { size: 18, sx: { color: 'var(--accent)' } })
                                    : _jsx(ScanBarcode, { size: 20, color: packScanError ? '#E5484D' : 'var(--accent)' }) }), _jsx(Typography, { sx: { fontSize: 15, fontWeight: 500, color: 'var(--ink)' }, children: "Pack mode" }), _jsx(Box, { sx: { flex: 1 } }), _jsxs(Box, { sx: {
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
                                        } }), _jsx(Typography, { sx: { fontSize: 11.5, fontWeight: 500, color: packScanError ? '#E5484D' : '#4CAF7A' }, children: packScanLoading ? 'Resolving…' : packScanError ? 'Hold' : 'Listening' })] })] }), packScanError && (_jsx(Alert, { severity: "error", sx: { mb: 1.5, py: 0.5, fontSize: 13, borderRadius: '8px' }, children: packScanError })), _jsx(Box, { sx: {
                            bgcolor: 'var(--bg)',
                            border: '1.5px solid',
                            borderColor: packScanError ? 'error.main' : 'rgba(255,107,43,0.45)',
                            borderRadius: '10px',
                            px: 2.25, py: 1.875, mb: 1.25,
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
                            } }) }), _jsx(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: "Scanner auto-submits \u00B7 manual entry: press Enter" })] }), !isLoading && !loadingSession && batches.length > 0 && (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }, children: [_jsx(Typography, { sx: { fontSize: 10.5, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Active batches" }), _jsxs(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }, children: [batches.length, " in progress"] })] })), !isLoading && !loadingSession && !isError && batches.length === 0 && (_jsxs(Box, { sx: {
                    textAlign: 'center', py: 8,
                    bgcolor: 'var(--surface)', border: '1px dashed var(--rule)',
                    borderRadius: '14px',
                }, children: [_jsx(ScanBarcode, { size: 36, color: "var(--ink-4)" }), _jsx(Typography, { sx: { fontSize: 13, fontWeight: 300, color: 'var(--ink-4)', mt: 1.5 }, children: "No active batches \u2014 waiting for release." })] })), !isLoading && !loadingSession && batches.map((batch) => (_jsx(BatchCard, { batch: batch, onClaim: (id) => void enterPickSession(id, true), onContinuePick: (id) => void enterPickSession(id, false), gridLocations: gridLocations, onFetchLineItems: onFetchLineItems }, batch.pick_batch_id))), !isLoading && !loadingSession && (stowTasks ?? []).length > 0 && (_jsxs(Box, { sx: { mt: batches.length > 0 ? 3 : 0 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }, children: [_jsx(Typography, { sx: { fontSize: 10.5, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Stow tasks" }), _jsxs(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }, children: [(stowTasks ?? []).length, " pending"] })] }), (stowTasks ?? []).map((task) => (_jsx(StowTaskCard, { task: task, onClaim: (id) => { onStowSessionEnter?.(id); setActiveSession({ type: 'stow', taskId: id }); }, onConfirm: (id) => void onConfirmStow?.(id).then(onRefresh) }, task.stow_task_id)))] }))] }));
}
export default function WmsModuleFT2(props) {
    return _jsx(ModuleErrorBoundary, { moduleName: "wms", children: _jsx(WmsModuleFT2Inner, { ...props }) });
}
//# sourceMappingURL=WmsModuleFT2.js.map