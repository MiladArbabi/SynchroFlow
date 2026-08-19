import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// modules/wms/src/ui/pages/StowSessionPage.tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Paper, Typography, Button, Alert, Chip, TextField, useTheme, CircularProgress, IconButton, alpha, } from '@mui/material';
import { CheckCircle, MapPin, Package, PackageOpen, ArrowLeft, } from 'lucide-react';
/**
 * STOW-SPLIT-01 — backend errors are diagnostic evidence, not operator copy.
 *
 * Keep the exact technical reason in the browser console for engineering
 * diagnosis, but translate anything rendered in the workflow into:
 *   1. what happened in warehouse terms, and
 *   2. what the operator should do next.
 *
 * Unknown backend text must never leak directly into the scanner UI.
 */
function getStowOperatorError(err, context) {
    const responseError = err
        ?.response?.data?.error;
    const technicalMessage = typeof responseError === 'string'
        ? responseError
        : err instanceof Error
            ? err.message
            : 'Unknown stow error';
    // Engineering detail remains available without exposing implementation
    // language such as service names, database state or internal error codes.
    console.error('[STOW_UI_OPERATION_FAILED]', {
        context,
        error: technicalMessage,
    });
    const reason = technicalMessage.toLowerCase();
    if (reason.includes('unauthorized') ||
        reason.includes('session')) {
        return 'Your session has expired. Sign in again, then reopen Stow.';
    }
    if (reason.includes('no active stow task') ||
        reason.includes('task not found') ||
        reason.includes('task not in progress') ||
        reason.includes('not assignable')) {
        return 'This stow task is no longer available. Return to Stow and reopen the task.';
    }
    if (reason.includes('owned by different operator') ||
        reason.includes('different operator')) {
        return 'Another operator is already working this stow task. Return to Stow and choose another task.';
    }
    if (reason.includes('wrong product') ||
        reason.includes('does not match this stow task')) {
        return 'Wrong product. Scan a unit that matches this stow task.';
    }
    if (reason.includes('wrong unit') ||
        reason.includes('lsu mismatch') ||
        reason.includes('specific unit')) {
        return 'Wrong unit. Scan the LSU shown for this stow task.';
    }
    if (reason.includes('physical unit not resolved') ||
        reason.includes('no physical units resolved')) {
        return 'No available unit was found for this scan. Scan the LSU label or check that the unit is still waiting to be stowed.';
    }
    if (reason.includes('no active location') ||
        reason.includes('scan a bin barcode first')) {
        return 'Scan a bin barcode first, then scan the unit.';
    }
    if (reason.includes('location not found') ||
        reason.includes('location not recognised')) {
        return 'Bin not recognised. Scan the bin label again.';
    }
    if (reason.includes('invalid_restow_destination') ||
        reason.includes('not an active bin')) {
        return 'This location cannot receive the unit. Scan another active storage bin.';
    }
    if (reason.includes('source equals destination') ||
        reason.includes('source and destination must differ')) {
        return 'This unit is already at that location. Scan a different destination bin.';
    }
    if (reason.includes('barcode not recognised') ||
        reason.includes('no variant found')) {
        return 'Barcode not recognised. Check the label and scan it again.';
    }
    // STOW-SPLIT-01 — fallback is intentionally actionable and generic.
    // Technical implementation details remain only in the console above.
    return context === 'location_scan'
        ? 'That bin could not be activated. Scan the bin label again or choose another active bin.'
        : 'That scan could not be completed. Check the unit label and try again.';
}
// ── Scan input ────────────────────────────────────────────────────────────────
function ScanInput({ hint, onSubmit, error, disabled = false }) {
    const [value, setValue] = useState('');
    const inputRef = useRef(null);
    useEffect(() => { inputRef.current?.focus(); }, []);
    useEffect(() => {
        if (error)
            setTimeout(() => inputRef.current?.focus(), 50);
    }, [error]);
    const handleSubmit = () => {
        // STOW-SPLIT-01 — never start another physical scanner action while the
        // previous one is still being saved. The page-level lock remains the
        // authoritative guard; disabling the input also makes that state visible.
        if (disabled)
            return;
        const val = value.trim();
        if (val) {
            onSubmit(val);
            setValue('');
        }
    };
    return (_jsxs(Box, { sx: { display: 'flex', gap: 1, alignItems: 'flex-start' }, children: [_jsx(TextField, { inputRef: inputRef, fullWidth: true, size: "small", placeholder: hint, value: value, disabled: disabled, onChange: (e) => setValue(e.target.value), onKeyDown: (e) => {
                    if (e.key === 'Enter')
                        handleSubmit();
                }, helperText: disabled
                    ? 'Saving scan…'
                    : 'Scanner auto-submits · manual entry: press Enter', autoComplete: "off" }), value.trim() && (_jsx(Button, { variant: "contained", size: "small", onClick: handleSubmit, disabled: disabled, sx: {
                    bgcolor: 'var(--accent)',
                    borderRadius: '6px',
                    fontWeight: 600,
                    mt: '2px',
                    flexShrink: 0,
                }, children: "Scan" }))] }));
}
// ── Main component ────────────────────────────────────────────────────────────
export default function StowSessionPage({ initialTaskId, onComplete, onFetchTasks, onResolveLocation, onAssignLocation, onClaimTask, onResolveBarcode, onConfirmStow, }) {
    const theme = useTheme();
    const [phase, setPhase] = useState('brief');
    const [tasks, setTasks] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [loadError, setLoadError] = useState(null);
    const [submitError, setSubmitError] = useState(null);
    // STOW-SPLIT-01 — success/info feedback describes the last completed physical
    // scanner action. A new scan clears it before producing its own result.
    const [scanFeedback, setScanFeedback] = useState(null);
    // STOW-SPLIT-01 — React state alone is not an atomic scanner lock because two
    // rapid hardware scans can arrive before a rerender. This ref changes
    // synchronously and guarantees that only one scanner action runs at a time.
    const scanInFlightRef = useRef(false);
    const beginScannerAction = () => {
        if (scanInFlightRef.current) {
            // Operator-facing feedback explains what happened and what to do next;
            // the duplicate scan is deliberately not sent to inventory mutation.
            setSubmitError(null);
            setScanFeedback({
                severity: 'info',
                message: 'The previous scan is still being saved. Wait for its confirmation, then scan again.',
            });
            return false;
        }
        scanInFlightRef.current = true;
        setSubmitting(true);
        return true;
    };
    const finishScannerAction = () => {
        scanInFlightRef.current = false;
        setSubmitting(false);
    };
    const [confirmedLocation, setConfirmedLocation] = useState(null);
    // STOW-SPLIT-01 — this count belongs to the active physical bin, not the task.
    // It persists across task advancement while the operator stays at the same
    // location and resets only when a different bin becomes active.
    const [placedHereCount, setPlacedHereCount] = useState(0);
    // Per-unit auto-commit only needs the number of physical units still required.
    // Quantity-entry, shortfall and review state belonged to the retired bulk flow.
    const [remainingQty, setRemainingQty] = useState(0);
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
                if (ordered.length > 0) {
                    // STOW-SPLIT-01 — resume from committed database progress. A partially
                    // completed task must not revert to its original total quantity after
                    // refresh, reconnect or Fast Refresh.
                    setRemainingQty(Math.max(ordered[0].quantity - ordered[0].quantity_placed, 0));
                }
            }
            catch (err) {
                // STOW-SPLIT-01 — session bootstrap failures must preserve the concrete
                // backend or runtime reason. A generic load error hides whether the failure
                // came from authentication, permissions, networking, or malformed data.
                const message = err
                    ?.response?.data?.error ??
                    (err instanceof Error
                        ? err.message
                        : 'Failed to load stow tasks for an unknown reason.');
                setLoadError(message);
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
            // STOW-SPLIT-01 — a queued active task may already be partially placed.
            // Auto-advance therefore reconstructs only its persisted remaining work
            // instead of assuming its original task quantity is still outstanding.
            setRemainingQty(Math.max(tasks[next].quantity - tasks[next].quantity_placed, 0));
            // STOW-SPLIT-01 — the active bin is session-level state, not task-level
            // state. Auto-advance therefore changes only the active task and its
            // remaining count; no retired quantity/review state exists to reset.
            setPhase('item_scan');
        }
    }, [currentIndex, tasks]);
    // ── Node 1: Item scan ───────────────────────────────────────────────────────
    const handleItemScan = useCallback(async (scannedValue) => {
        if (!currentTask) {
            // STOW-SPLIT-01 — scanner input without an active task is an invalid
            // session state. Fail explicitly so the operator and logs have a concrete
            // reason instead of silently discarding a physical scan.
            throw Object.assign(new Error('No active stow task.'), {
                response: {
                    data: {
                        error: 'Cannot scan an item because no active stow task is loaded.',
                    },
                },
            });
        }
        setSubmitError(null);
        setScanFeedback(null);
        // STOW-SPLIT-01 — every new scan starts with a clean feedback surface.
        // The previous success remains visible until this point, then this scan owns
        // the next success, bin-change message or operator-friendly error.
        // STOW-SPLIT-01 — the session uses one scanner vocabulary. A bin scan
        // always takes precedence over an item scan so the operator can change
        // physical position at any point without leaving the active workflow.
        const resolvedLocation = await onResolveLocation(scannedValue);
        if (resolvedLocation?.location_code) {
            const isPhysicalBinChange = Boolean(confirmedLocation) &&
                resolvedLocation.location_code !== confirmedLocation;
            if (resolvedLocation.location_code !== currentTask.location_code) {
                await onAssignLocation(currentTask.stow_task_id, resolvedLocation.location_code);
            }
            // STOW-SPLIT-01 — placedHereCount describes the operator's physical active
            // bin, not the task's persisted destination. Reset it only when the operator
            // has actually scanned a different physical bin.
            if (isPhysicalBinChange) {
                setPlacedHereCount(0);
            }
            await onClaimTask(currentTask.stow_task_id);
            setTasks(prev => prev.map((task, index) => index === currentIndex
                ? {
                    ...task,
                    location_code: resolvedLocation.location_code,
                    status: 'in_progress',
                }
                : task));
            setConfirmedLocation(resolvedLocation.location_code);
            // STOW-SPLIT-01 — the active-bin card is the authoritative destination state.
            // A physical bin switch already updates that card and resets placedHereCount,
            // so additional transient copy would only repeat information on screen.
            setPhase('item_scan');
            return;
        }
        // Location-first is an inventory-safety rule, not just presentation.
        // Never accept a physical unit when the session has no confirmed bin.
        if (!confirmedLocation) {
            throw Object.assign(new Error('No active location.'), {
                response: {
                    data: {
                        error: 'Scan a bin barcode first, then scan the unit.',
                    },
                },
            });
        }
        // The sticky location survives task advancement, but each new task still
        // owns its persisted destination. Synchronise that destination before any
        // unit can be committed so ledger movements use the physical active bin.
        if (currentTask.location_code !== confirmedLocation) {
            await onAssignLocation(currentTask.stow_task_id, confirmedLocation);
            setTasks(prev => prev.map((task, index) => index === currentIndex
                ? {
                    ...task,
                    location_code: confirmedLocation,
                }
                : task));
        }
        // A newly auto-advanced task may still be pending even though the operator
        // and active location are unchanged. Claim it before accepting its unit.
        await onClaimTask(currentTask.stow_task_id);
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
        // INV-BLOCK-10b-LSU-01 — cancellation recovery is unit-specific.
        //
        // Scoped deliberately to order_cancelled_mid_pick: inbound stow units of
        // the same variant are fungible, and the receive→stow flow relies on a
        // generic product barcode resolving to any received sibling. Widening
        // this to all triggers would change that verified behaviour.
        //
        // Both LSUs of a variant share one shopify_barcode, so a generic scan
        // cannot discriminate them. unit_ids (now trigger-aware server-side)
        // is the task's declaration of which physical unit satisfies it. The
        // backend guard in confirmStow remains authoritative; this check exists
        // to fail fast at scan time with a message naming the required LSU.
        if (currentTask.trigger === 'order_cancelled_mid_pick' &&
            (currentTask.unit_ids ?? []).length > 0 &&
            (!resolved.lasyncro_unit_id ||
                !(currentTask.unit_ids ?? []).includes(resolved.lasyncro_unit_id))) {
            throw Object.assign(new Error('Wrong unit.'), {
                response: {
                    data: {
                        error: `This task recovers a specific unit. Scan ${(currentTask.unit_ids ?? []).join(' or ')}.`,
                    },
                },
            });
        }
        if (!resolved.lasyncro_unit_id) {
            // STOW-SPLIT-01 — the redesigned session is strictly per-unit. A variant-only
            // resolution is not enough to mutate inventory because every placement must
            // be attributable to one physical LSU and therefore one ledger identity.
            throw Object.assign(new Error('Physical unit not resolved.'), {
                response: {
                    data: {
                        error: 'No physical unit is available for this scan. Scan the LSU label or check the unit state.',
                    },
                },
            });
        }
        // STOW-SPLIT-01 — one successful physical scan commits exactly one unit.
        // The page-level scanner lock remains active for this entire asynchronous
        // action and is released by the caller regardless of success or failure.
        const confirmResult = await onConfirmStow(currentTask.stow_task_id, 1, resolved.lasyncro_unit_id);
        // STOW-SPLIT-01 — persisted backend progress is authoritative. Keep the local
        // task snapshot aligned with the committed cumulative quantity instead of
        // reconstructing progress from scanner-local decrements.
        setTasks(prev => prev.map((task, index) => index === currentIndex
            ? {
                ...task,
                quantity_placed: confirmResult.quantity_placed,
            }
            : task));
        // Update UI state only after the backend transaction succeeds. Failed writes
        // must never increment either the active-bin count or task progress.
        const nextPlacedHereCount = placedHereCount + 1;
        setPlacedHereCount(nextPlacedHereCount);
        const authoritativeRemaining = Math.max(confirmResult.quantity_total - confirmResult.quantity_placed, 0);
        // STOW-SPLIT-01 — successful feedback acknowledges the physical scan only.
        // Active location, placed-here count and remaining quantity already have
        // dedicated persistent surfaces and must not be repeated here.
        setScanFeedback({
            severity: 'success',
            message: `Unit placed · ${resolved.lasyncro_unit_id}`,
        });
        if (!confirmResult.is_fully_placed) {
            setRemainingQty(authoritativeRemaining);
            setSubmitError(null);
            // Unit identity is scoped to this scanner event. Once the caller releases
            // the lock, the scanner is immediately ready for the next unit or bin.
            setPhase('item_scan');
        }
        else {
            // STOW-SPLIT-01 — completion is decided by the committed server result.
            // Browser-local remaining state may have been reconstructed after refresh
            // and therefore must never be authoritative for warehouse completion.
            advanceToNext();
        }
    }, [
        currentTask,
        currentIndex,
        confirmedLocation,
        placedHereCount,
        remainingQty,
        advanceToNext,
        onResolveLocation,
        onAssignLocation,
        onClaimTask,
        onResolveBarcode,
        onConfirmStow,
    ]);
    // ── Node 2: Location scan ───────────────────────────────────────────────────
    const handleLocationScan = useCallback(async (scannedValue) => {
        if (!currentTask) {
            // STOW-SPLIT-01 — a bin must never be assigned without an identified task.
            // Throw an actionable error rather than allowing the scan to disappear.
            throw Object.assign(new Error('No active stow task.'), {
                response: {
                    data: {
                        error: 'Cannot activate a bin because no active stow task is loaded.',
                    },
                },
            });
        }
        setSubmitError(null);
        setScanFeedback(null);
        const resolved = await onResolveLocation(scannedValue);
        if (!resolved?.location_code) {
            throw Object.assign(new Error('Location not found.'), {
                response: { data: { error: 'Location not recognised. Try scanning the bin barcode.' } },
            });
        }
        // STOW-SPLIT-01 — a claimed task may move between bins while units remain.
        if (resolved.location_code !== currentTask.location_code) {
            await onAssignLocation(currentTask.stow_task_id, resolved.location_code);
        }
        // STOW-SPLIT-01 — task-location synchronisation and physical movement are
        // separate concepts. Preserve the running count when the same active bin is
        // merely being attached to a newly advanced task.
        if (confirmedLocation &&
            resolved.location_code !== confirmedLocation) {
            setPlacedHereCount(0);
        }
        // STOW-SPLIT-01 — claimStowTask is intentionally idempotent when the same
        // operator resumes their own in-progress task. Any other claim failure is
        // meaningful and must propagate to the scanner error UI instead of being
        // silently treated as success.
        await onClaimTask(currentTask.stow_task_id);
        setTasks(prev => prev.map((t, i) => i === currentIndex
            ? {
                ...t,
                location_code: resolved.location_code,
                status: 'in_progress',
            }
            : t));
        setConfirmedLocation(resolved.location_code);
        // STOW-SPLIT-01 — the active-bin card immediately reflects the newly scanned
        // destination and its reset placed-here count. Do not duplicate that state
        // with a second informational message below the scanner.
        // Activating a bin is the first operational action. Once active, the next
        // required action is scanning a physical unit.
        setPhase('item_scan');
    }, [
        currentTask,
        currentIndex,
        confirmedLocation,
        onResolveLocation,
        onAssignLocation,
        onClaimTask,
    ]);
    // STOW-SPLIT-01 — task position remains useful navigation context, but workflow
    // progress is communicated by the physical bin state and remaining-unit count
    // rather than an abstract progress bar or duplicated step tracker.
    const progressLabel = currentTask
        ? `Stow ${currentIndex + 1} of ${tasks.length}`
        : '';
    // STOW-SPLIT-01 — one physical visual anchor replaces abstract progress UI.
    // A closed box means no destination is active. Once a bin is scanned, the box
    // opens and stays open while that sticky bin is accepting units. Location,
    // placed-here count, remaining work and the next scanner action all live here
    // so those facts do not need to be repeated elsewhere on the session screen.
    const activeBinCard = (_jsx(Paper, { variant: "outlined", sx: {
            p: 2,
            mb: 2,
            borderRadius: '6px',
            borderColor: confirmedLocation
                ? theme.palette.success.main
                : theme.palette.error.main,
            bgcolor: confirmedLocation
                ? alpha(theme.palette.success.main, 0.08)
                : alpha(theme.palette.error.main, 0.06),
        }, children: _jsxs(Box, { sx: {
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
            }, children: [_jsx(Box, { sx: {
                        width: 48,
                        height: 48,
                        borderRadius: '6px',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: confirmedLocation
                            ? alpha(theme.palette.success.main, 0.12)
                            : theme.palette.action.hover,
                        color: confirmedLocation
                            ? 'var(--good-ink)'
                            : 'var(--critical-ink)',
                    }, children: confirmedLocation ? (_jsx(PackageOpen, { size: 28 })) : (_jsx(Package, { size: 28 })) }), _jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsxs(Box, { sx: {
                                display: 'flex',
                                alignItems: 'baseline',
                                flexWrap: 'wrap',
                                gap: 0.75,
                            }, children: [_jsx(Typography, { variant: "subtitle1", fontWeight: 700, children: confirmedLocation ?? 'No active bin' }), _jsx(Typography, { variant: "caption", fontWeight: 700, sx: {
                                        color: confirmedLocation
                                            ? 'var(--good-ink)'
                                            : 'var(--critical-ink)',
                                    }, children: confirmedLocation ? 'ACTIVE' : 'INACTIVE' })] }), confirmedLocation ? (_jsxs(_Fragment, { children: [_jsxs(Typography, { variant: "body2", color: "text.secondary", children: [placedHereCount, " placed here \u00B7 ", remainingQty, " remaining"] }), _jsx(Typography, { variant: "caption", color: "text.secondary", children: "Scan a unit, or scan another bin to move." })] })) : (_jsx(Typography, { variant: "body2", color: "text.secondary", children: "Scan a bin barcode to begin." }))] })] }) }));
    // ── BRIEF ───────────────────────────────────────────────────────────────────
    if (phase === 'brief') {
        return (_jsx(Box, { sx: { p: 3 }, children: loading ? (_jsx(Box, { sx: { display: 'flex', justifyContent: 'center', pt: 8 }, children: _jsx(CircularProgress, { size: 32 }) })) : loadError ? (_jsx(Alert, { severity: "error", children: loadError })) : tasks.length === 0 ? (_jsx(Alert, { severity: "info", children: "No stow tasks pending." })) : (_jsxs(_Fragment, { children: [_jsxs(Box, { sx: { mb: 3 }, children: [_jsx(Typography, { variant: "h6", fontWeight: 600, children: "Stow Session" }), _jsx(Typography, { variant: "body2", color: "text.secondary", children: "Review your tasks below, then start stowing." })] }), _jsx(Box, { sx: { display: 'flex', gap: 2, mb: 3 }, children: [
                            { label: 'SKUs', value: tasks.length },
                            { label: 'Units', value: tasks.reduce((s, t) => s + t.quantity, 0) },
                            { label: 'Locations', value: new Set(tasks.map(t => t.location_code).filter(Boolean)).size },
                        ].map(({ label, value }) => (_jsxs(Paper, { variant: "outlined", sx: { flex: 1, p: 2, textAlign: 'center', borderRadius: 2 }, children: [_jsx(Typography, { variant: "h5", fontWeight: 600, color: "warning.main", children: value }), _jsx(Typography, { variant: "caption", color: "text.secondary", children: label })] }, label))) }), _jsx(Box, { sx: { display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }, children: tasks.map((t) => (_jsx(Paper, { variant: "outlined", sx: { p: 2, borderRadius: 2 }, children: _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 2 }, children: [t.image_url ? (_jsx(Box, { component: "img", src: t.image_url, alt: t.variant_title ?? '', sx: { width: 40, height: 40, objectFit: 'cover', borderRadius: 1, flexShrink: 0, border: `1px solid ${theme.palette.divider}` } })) : (_jsx(Box, { sx: { width: 40, height: 40, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: _jsx(Package, { size: 18, color: theme.palette.text.disabled }) })), _jsx(Box, { sx: { flex: 1, minWidth: 0 }, children: _jsx(Typography, { variant: "body2", fontWeight: 600, noWrap: true, children: t.product_title ?? t.variant_title ?? t.sku ?? t.stow_task_id.slice(0, 8).toUpperCase() }) }), _jsxs(Box, { sx: { display: 'flex', gap: 1, flexShrink: 0 }, children: [_jsx(Chip, { label: `${t.quantity} units`, size: "small" }), t.location_code
                                                ? _jsx(Chip, { label: t.location_code, size: "small", color: "success" })
                                                : _jsx(Chip, { label: "No location", size: "small", sx: { bgcolor: 'var(--accent-ghost)', color: 'var(--accent)', border: '0.5px solid var(--accent-border)', fontWeight: 600, fontSize: 11 } })] })] }) }, t.stow_task_id))) }), _jsx(Button, { variant: "contained", size: "large", fullWidth: true, sx: {
                            borderRadius: '6px',
                            fontWeight: 600,
                            bgcolor: 'var(--accent)',
                            color: 'var(--accent-ink)',
                            '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 },
                        }, onClick: () => setPhase('location_scan'), children: "Start Stowing" })] })) }));
    }
    // ── COMPLETE ─────────────────────────────────────────────────────────────────
    if (phase === 'complete') {
        return (_jsxs(Box, { sx: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4, textAlign: 'center', minHeight: 400 }, children: [_jsx(CheckCircle, { size: 56, color: theme.palette.success.main }), _jsx(Typography, { variant: "h5", fontWeight: 600, sx: { mt: 2 }, children: "Stow complete" }), _jsxs(Typography, { variant: "body2", color: "text.secondary", sx: { mt: 1, mb: 4 }, children: [tasks.length, " SKU", tasks.length !== 1 ? 's' : '', " stowed. Inventory updated."] }), _jsx(Button, { variant: "contained", size: "large", sx: { borderRadius: '6px', fontWeight: 600, bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }, onClick: onComplete, children: "Back to operations" })] }));
    }
    if (!currentTask) {
        // STOW-SPLIT-01 — reaching an active session phase without a task means the
        // UI state and loaded task queue have diverged. Do not render a blank screen:
        // surface the exact invariant failure so the operator knows why work stopped.
        return (_jsx(Box, { sx: { p: 2 }, children: _jsx(Alert, { severity: "error", children: "Cannot continue stowing because no active stow task is loaded." }) }));
    }
    // ── ITEM SCAN (Node 1) ───────────────────────────────────────────────────────
    if (phase === 'item_scan') {
        return (_jsxs(Box, { sx: { p: 2 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 2 }, children: [_jsx(IconButton, { onClick: () => setPhase('brief'), size: "small", children: _jsx(ArrowLeft, { size: 18 }) }), _jsx(Typography, { variant: "subtitle2", color: "text.secondary", children: progressLabel })] }), activeBinCard, _jsxs(Paper, { variant: "outlined", sx: { p: 2, mb: 2, borderRadius: 2, display: 'flex', gap: 2, alignItems: 'center' }, children: [currentTask.image_url ? (_jsx(Box, { component: "img", src: currentTask.image_url, alt: currentTask.variant_title ?? '', sx: { width: 64, height: 64, objectFit: 'cover', borderRadius: 1, flexShrink: 0, border: `1px solid ${theme.palette.divider}` } })) : (_jsx(Box, { sx: { width: 64, height: 64, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, children: _jsx(Package, { size: 28, color: theme.palette.text.disabled }) })), _jsxs(Box, { sx: { flex: 1, minWidth: 0 }, children: [_jsx(Typography, { variant: "body2", fontWeight: 600, noWrap: true, children: currentTask.product_title ?? currentTask.variant_title ?? '—' }), currentTask.sku && (_jsx(Typography, { variant: "caption", color: "text.secondary", sx: { fontFamily: 'monospace', display: 'block' }, children: currentTask.sku }))] })] }), _jsx(ScanInput, { hint: "Scan item barcode (LSU- or product barcode)", error: submitError, disabled: submitting, onSubmit: (v) => {
                        if (!beginScannerAction())
                            return;
                        void handleItemScan(v)
                            .catch((err) => {
                            // Failed scans replace previous positive feedback with an actionable
                            // operator message. Technical detail remains diagnostic only.
                            setScanFeedback(null);
                            setSubmitError(getStowOperatorError(err, 'item_scan'));
                        })
                            .finally(() => {
                            finishScannerAction();
                        });
                    } }), scanFeedback && (_jsx(Alert, { severity: scanFeedback.severity, sx: { mt: 2 }, children: scanFeedback.message })), submitError && (_jsx(Alert, { severity: "error", sx: { mt: 2 }, children: submitError }))] }));
    }
    // ── LOCATION SCAN (Node 2) ───────────────────────────────────────────────────
    if (phase === 'location_scan') {
        return (_jsxs(Box, { sx: { p: 2 }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 2 }, children: [_jsx(IconButton
                        // STOW-SPLIT-01 — location is the first operational step. Going back from
                        // here returns to the session brief rather than exposing unit scanning
                        // before a physical destination has been activated.
                        , { 
                            // STOW-SPLIT-01 — location is the first operational step. Going back from
                            // here returns to the session brief rather than exposing unit scanning
                            // before a physical destination has been activated.
                            onClick: () => setPhase('brief'), size: "small", "aria-label": "Back to stow session", children: _jsx(ArrowLeft, { size: 18 }) }), _jsx(Typography, { variant: "subtitle2", color: "text.secondary", children: progressLabel })] }), activeBinCard, currentTask.location_code && (_jsxs(Paper, { variant: "outlined", sx: { p: 2, mb: 2, borderRadius: 2, bgcolor: 'var(--accent-ghost)', borderColor: 'var(--accent-border)' }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.75 }, children: [_jsx(MapPin, { size: 16, color: 'var(--accent)' }), _jsxs(Typography, { variant: "body2", fontWeight: 600, sx: { color: 'var(--accent)' }, children: ["Suggested bin: ", currentTask.location_code] })] }), _jsx(Typography, { variant: "caption", color: "text.secondary", sx: { mt: 0.25, display: 'block' }, children: "Walk to this bin and scan its barcode to confirm." })] })), _jsx(ScanInput, { hint: "Scan bin barcode or type location code", error: submitError, disabled: submitting, onSubmit: (v) => {
                        if (!beginScannerAction())
                            return;
                        void handleLocationScan(v)
                            .catch((err) => {
                            // Failed activation leaves no stale success message competing with the
                            // recovery instruction shown to the operator.
                            setScanFeedback(null);
                            setSubmitError(getStowOperatorError(err, 'location_scan'));
                        })
                            .finally(() => {
                            finishScannerAction();
                        });
                    } }), scanFeedback && (_jsx(Alert, { severity: scanFeedback.severity, sx: { mt: 2 }, children: scanFeedback.message })), submitError && (_jsx(Alert, { severity: "error", sx: { mt: 2 }, children: submitError }))] }));
    }
    // STOW-SPLIT-01 — quantity confirmation was intentionally removed.
    // A successful unit scan already represents confirmation of quantity = 1.
    // STOW-SPLIT-01 — every supported operational phase returns above.
    // If execution reaches this point, the session state has diverged from the
    // declared workflow. Render the invariant failure instead of failing silently.
    return (_jsx(Box, { sx: { p: 2 }, children: _jsx(Alert, { severity: "error", children: "Cannot render the stow session because its workflow state is unsupported." }) }));
}
//# sourceMappingURL=StowSessionPage.js.map