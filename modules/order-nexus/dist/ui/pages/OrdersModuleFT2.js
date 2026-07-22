import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx
//
// ORDERS MODULE — FT2 OPERATOR SURFACE — TRIAGE-FIRST
// ─────────────────────────────────────────────────────────────
// Layout:
//   1. Header          — title + signal line + resolve CTA
//   2. Needs a decision — triage card: Critical band → Watch band → footer
//   3. Today's flow    — pulse counts + stage bar
//
// RULES:
// - No hardcoded hex. CSS variables or design-system tokens only.
//   Exception: severity band colors (#E5484D critical, #D9A23B watch, #4CAF7A ok) — domain tokens.
//   Exception: STAGE_COLORS — pipeline stage domain tokens, tracked in B-08.
// - No inline style={}. MUI sx prop only.
// - No cross-module imports.
// - No fetching. All data via props.
// - Font: Plus Jakarta Sans (app default) — never set fontFamily explicitly.
import { useState } from 'react';
import { Box, Collapse, Typography } from '@mui/material';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatCurrencyCompact, PulseCard, ReorderTransitionList } from '@lasyncro/shared/ui';
// ─── HELPERS ──────────────────────────────────────────────────
const TRIAGE_PREVIEW_LIMIT = 3;
const PRIORITY_REORDER_HOLD_MS = 560;
const PRIORITY_FLASH_MS = 1400;
const fmtN = (n) => n == null ? '—' : Math.round(n).toLocaleString();
const fmtSlaAge = (hours) => {
    const h = Math.round(hours);
    const d = Math.floor(h / 24);
    const rem = h % 24;
    if (d === 0)
        return `${rem}h past`;
    if (rem === 0)
        return `${d}d past`;
    return `${d}d ${rem}h past`;
};
// ─── STAGE COLORS ─────────────────────────────────────────────
// Domain-specific pipeline stage colors — no design-system token equivalent yet.
// Tracked in B-08. When @lasyncro/ui-ft2 adds stage tokens, migrate here.
const STAGE_COLORS = {
    new: '#9CA3AF',
    ready: '#10B981',
    picking: '#3B82F6',
    packed: '#6366F1',
    blocked: '#F97316',
    breached: '#EF4444',
    awaiting_reply: '#F59E0B',
    awaiting_stock: '#EAB308',
};
/**
 * PrioritizeButton (THREAD B, 2026-06-30)
 * -----------------------------------------
 * Replaces the old "Release →" CTA, which navigated to /orders/flow and
 * did nothing else — dead-end, no actual prioritization happened.
 *
 * New behavior: flags the order via onPriorityFlag (ON-01, now
 * consolidated + pool-guarded), which sets is_priority_flagged on the
 * order. Prioritized orders surface at the top of the Orders Pool in
 * /orders/flow. No navigation on click.
 *
 * Three visual states:
 * - already prioritized (order.isPriorityFlagged === true, persisted)
 * - just clicked (local transient state, brief confirmation)
 * - default
 */
function PrioritizeButton({ isPriorityFlagged, onPrioritize, }) {
    const [justPrioritized, setJustPrioritized] = useState(false);
    const [isPending, setIsPending] = useState(false);
    const handleClick = async () => {
        if (isPending || isPriorityFlagged || justPrioritized)
            return;
        setIsPending(true);
        try {
            await onPrioritize();
            setJustPrioritized(true);
            setTimeout(() => setJustPrioritized(false), 2000);
        }
        finally {
            setIsPending(false);
        }
    };
    const showConfirmed = isPriorityFlagged || justPrioritized;
    return (_jsxs(Box, { children: [_jsx(Box, { component: "button", onClick: handleClick, disabled: isPending || showConfirmed, sx: {
                    width: '100%',
                    fontSize: 12,
                    fontWeight: 600,
                    // CONFIRM-GHOST EXCEPTION (Thread B, 2026-06-30): documented
                    // deviation from the orange-only CTA system — see
                    // modules-ux-playbook.md §9. Confirmed/persisted state only,
                    // never used for an actionable CTA.
                    color: showConfirmed ? 'var(--confirm-ink)' : 'var(--accent-ink)',
                    bgcolor: showConfirmed ? 'var(--confirm-ghost)' : 'var(--accent)',
                    border: showConfirmed ? '1px solid var(--confirm-border)' : 'none',
                    borderRadius: '6px',
                    py: 1,
                    textAlign: 'center',
                    cursor: showConfirmed ? 'default' : 'pointer',
                    opacity: isPending ? 0.6 : 1,
                    '&:hover': { opacity: showConfirmed ? 1 : 0.88 },
                }, children: showConfirmed ? 'Prioritized ✓' : isPending ? 'Prioritizing…' : 'Prioritize →' }), showConfirmed && (_jsx(Typography, { sx: {
                    fontSize: 10,
                    fontWeight: 400,
                    color: 'var(--ink-4)',
                    textAlign: 'center',
                    mt: 0.5,
                }, children: "To be released in the next batch" }))] }));
}
// MAIN COMPONENT
export default function OrdersModuleFT2(props) {
    const navigate = useNavigate();
    const { operationalControl, revenue, operatorSummary, currency, onExport, onOrderClick, onPriorityFlag } = props;
    const fmt$ = (n) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);
    // ── Derived counts ──────────────────────────────────────────
    const qReady = operatorSummary?.queueCounts?.readyToShip ?? operationalControl?.queue_ready_to_ship ?? 0;
    const qPicking = operationalControl?.pending_fulfillment ?? 0;
    const constrained = operationalControl?.constrained_orders ?? 0;
    const aging72 = operationalControl?.aging_72h_plus ?? 0;
    const totalOrders = props.orders?.total ?? 0;
    const blockedRevenue = operationalControl?.blocked_revenue ?? 0;
    // ── Date / sync header ──────────────────────────────────────
    const now = new Date();
    const dayLabel = now
        .toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' })
        .toUpperCase();
    const syncLabel = (() => {
        const snap = operationalControl?.snapshot_date;
        if (!snap)
            return 'Syncing…';
        const diffMin = Math.round((now.getTime() - new Date(snap).getTime()) / 60000);
        if (diffMin < 1)
            return 'Just synced';
        if (diffMin < 60)
            return `Last synced ${diffMin} min ago`;
        return `Last synced ${Math.round(diffMin / 60)}h ago`;
    })();
    // ── Triage queues ────────────────────────────────────────────
    // THREAD B (2026-06-30): prioritized orders sort to the bottom of
    // Critical after a short confirmation hold. This prevents the row from
    // teleporting immediately after the user clicks Prioritize.
    const [criticalExpanded, setCriticalExpanded] = useState(false);
    const [watchExpanded, setWatchExpanded] = useState(false);
    const [movementHeldOrderIds, setMovementHeldOrderIds] = useState(() => new Set());
    const [priorityFlashOrderIds, setPriorityFlashOrderIds] = useState(() => new Set());
    const holdPriorityMovement = (orderId) => {
        setMovementHeldOrderIds(prev => {
            const next = new Set(prev);
            next.add(orderId);
            return next;
        });
        window.setTimeout(() => {
            setMovementHeldOrderIds(prev => {
                const next = new Set(prev);
                next.delete(orderId);
                return next;
            });
        }, PRIORITY_REORDER_HOLD_MS);
    };
    const flashPriorityRow = (orderId) => {
        setPriorityFlashOrderIds(prev => {
            const next = new Set(prev);
            next.add(orderId);
            return next;
        });
        window.setTimeout(() => {
            setPriorityFlashOrderIds(prev => {
                const next = new Set(prev);
                next.delete(orderId);
                return next;
            });
        }, PRIORITY_FLASH_MS);
    };
    const handlePrioritizeOrder = async (orderId) => {
        holdPriorityMovement(orderId);
        try {
            await onPriorityFlag?.([orderId], true);
            flashPriorityRow(orderId);
        }
        catch (error) {
            setMovementHeldOrderIds(prev => {
                const next = new Set(prev);
                next.delete(orderId);
                return next;
            });
            setPriorityFlashOrderIds(prev => {
                const next = new Set(prev);
                next.delete(orderId);
                return next;
            });
            throw error;
        }
    };
    const allAgingOrders = [...(operatorSummary?.agingOrders ?? [])].sort((a, b) => {
        const aPrioritySettled = a.isPriorityFlagged && !movementHeldOrderIds.has(a.lasyncro_order_id);
        const bPrioritySettled = b.isPriorityFlagged && !movementHeldOrderIds.has(b.lasyncro_order_id);
        if (aPrioritySettled !== bPrioritySettled) {
            return aPrioritySettled ? 1 : -1;
        }
        return b.ageHours - a.ageHours;
    });
    // Critical = SLA already breached — act today
    const criticalOrders = allAgingOrders.filter(o => o.isShippingSlaBreached);
    // FIX (2026-07-01): the >= 24 check was dead weight — the backend already
    // pre-filters agingOrders to WATCH_FLOOR_SECONDS (now SLA-aware, was a flat
    // 48h) before this array ever reaches the frontend, so every order here
    // already qualifies. Re-checking a hardcoded 24h client-side both duplicated
    // backend logic and used a different, disconnected number.
    const watchOrders = allAgingOrders.filter(o => !o.isShippingSlaBreached);
    const visibleCriticalOrders = criticalOrders.slice(0, TRIAGE_PREVIEW_LIMIT);
    const hiddenCriticalOrders = criticalOrders.slice(TRIAGE_PREVIEW_LIMIT);
    const visibleWatchOrders = watchOrders.slice(0, TRIAGE_PREVIEW_LIMIT);
    const hiddenWatchOrders = watchOrders.slice(TRIAGE_PREVIEW_LIMIT);
    const prioritizedCriticalCount = criticalOrders.filter(o => o.isPriorityFlagged).length;
    const unprioritizedCriticalCount = Math.max(criticalOrders.length - prioritizedCriticalCount, 0);
    const pulseRows = [
        { label: 'Breached', n: aging72, color: STAGE_COLORS.breached },
        { label: 'Picking', n: qPicking, color: STAGE_COLORS.picking },
        { label: 'Ready', n: qReady, color: STAGE_COLORS.ready },
        { label: 'Blocked', n: constrained, color: STAGE_COLORS.blocked },
    ];
    const pulseMax = Math.max(...pulseRows.map(row => row.n), 1);
    // FIX (2026-07-01): default branch fired identically for "operational
    // constraint, unspecified type" AND "no constraint at all, just aging"
    // — the second case is exactly every Watch-band order, which have zero
    // constraint type by definition. Confirmed live: Watch rows showed
    // "SLA breach · Xd past aging" on orders that were explicitly NOT
    // SLA-breached (isShippingSlaBreached: false). Now takes the real
    // breach flag so it can tell the two apart honestly.
    const constraintLabel = (type, isBreached) => {
        switch (type) {
            case 'inventory': return 'Out of stock';
            case 'customer': return 'Address issue';
            case 'operational': return 'Pick exception';
            default: return isBreached ? 'SLA breach' : 'Aging';
        }
    };
    // ── Stage bar ───────────────────────────────────────────────
    const stageData = [
        { key: 'ready', label: 'Ready', count: qReady },
        { key: 'picking', label: 'Picking', count: qPicking },
        { key: 'blocked', label: 'Blocked', count: constrained },
        { key: 'breached', label: 'Breached', count: aging72 },
        { key: 'awaiting_stock', label: 'Awaiting stock', count: operatorSummary?.constraintCounts?.inventory ?? 0 },
        { key: 'awaiting_reply', label: 'Awaiting reply', count: operatorSummary?.constraintCounts?.customer ?? 0 },
    ];
    const accountedFor = stageData.reduce((s, d) => s + d.count, 0);
    const newCount = Math.max(0, totalOrders - accountedFor);
    const allStages = [{ key: 'new', label: 'New', count: newCount }, ...stageData];
    const stageTotal = allStages.reduce((s, d) => s + d.count, 0) || 1;
    return (_jsxs(Box, { sx: { p: '24px 40px', minHeight: '100%', bgcolor: 'var(--bg)' }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3 }, children: [_jsxs(Box, { children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }, children: [_jsx(Box, { sx: { width: 6, height: 6, borderRadius: '50%', bgcolor: '#4CAF7A', flexShrink: 0 } }), _jsxs(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: [dayLabel, " \u00B7 Channels live \u00B7 ", syncLabel] })] }), _jsx(Typography, { sx: { fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }, children: "Orders" }), _jsx(Typography, { sx: { fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }, children: constrained > 0
                                    ? `${constrained} order${constrained === 1 ? '' : 's'} constrained · ${fmt$(blockedRevenue)} blocked · ${qPicking} in pick & pack`
                                    // FIX (2026-07-01): previously only checked `constrained`
                                    // (order_constraints-based count) — completely blind to
                                    // SLA-breached aging orders, which are a separate signal
                                    // (isShippingSlaBreached, unconstrained but overdue).
                                    // Confirmed live: headline said "All orders on track" while
                                    // 8 orders sat in the Critical band below it, same page.
                                    // Reuse the same criticalOrders/watchOrders arrays the
                                    // bands already render from — single source, no new query.
                                    : criticalOrders.length > 0
                                        ? `${criticalOrders.length} SLA-breached · ${fmt$(criticalOrders.reduce((s, o) => s + (o.revenue ?? 0), 0))} at stake`
                                        : watchOrders.length > 0
                                            ? `${watchOrders.length} order${watchOrders.length === 1 ? '' : 's'} aging, approaching SLA`
                                            : 'All orders on track — nothing needs immediate action' })] }), _jsx(Box, { sx: { display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }, children: onExport && (_jsx(Box, { onClick: onExport, sx: { display: 'inline-flex', alignItems: 'center', px: '12px', py: '6px', fontSize: 12, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent-border)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: "Export \u2192" })) })] }), _jsxs(Box, { sx: { display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, flexWrap: { xs: 'nowrap', lg: 'wrap' }, gap: 2.25, alignItems: 'stretch' }, children: [_jsxs(Box, { sx: { flex: { xs: '1 1 auto', lg: '1 1 0' }, minWidth: 0, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', p: '16px 20px 14px', borderBottom: '1px solid var(--rule)' }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 14, fontWeight: 500, color: 'var(--ink)', mb: 0.375 }, children: "Needs a decision" }), _jsx(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: "Ranked by commercial consequence" })] }), _jsx(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }, children: syncLabel })] }), criticalOrders.length > 0 ? (_jsxs(_Fragment, { children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1, bgcolor: 'rgba(229,72,77,0.07)' }, children: [_jsx(Box, { sx: { width: 6, height: 6, borderRadius: '50%', bgcolor: '#E5484D', flexShrink: 0 } }), _jsx(Typography, { sx: { fontSize: 10, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#F2555A' }, children: "Critical \u2014 act today" }), _jsx(Box, { sx: { flex: 1 } }), _jsxs(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }, children: [criticalOrders.length, " items"] })] }), _jsx(ReorderTransitionList, { items: visibleCriticalOrders, getKey: (order) => order.lasyncro_order_id, durationMs: 520, renderItem: (order) => (_jsxs(Box, { sx: {
                                                display: 'grid',
                                                gridTemplateColumns: 'minmax(0,1fr) 90px 118px',
                                                gap: 1.75,
                                                alignItems: 'center',
                                                px: 2.5,
                                                py: 1.75,
                                                borderTop: '1px solid var(--rule)',
                                                bgcolor: priorityFlashOrderIds.has(order.lasyncro_order_id)
                                                    ? 'rgba(16,185,129,0.08)'
                                                    : 'transparent',
                                                boxShadow: priorityFlashOrderIds.has(order.lasyncro_order_id)
                                                    ? 'inset 3px 0 0 rgba(16,185,129,0.55)'
                                                    : 'inset 0 0 0 rgba(16,185,129,0)',
                                                transition: 'background-color 520ms ease, box-shadow 520ms ease',
                                            }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', mb: 0.375 }, children: order.externalOrderId ? `#${order.externalOrderId}` : order.lasyncro_order_id.slice(0, 8).toUpperCase() }), _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: [constraintLabel(order.constraintType, order.isShippingSlaBreached), " \u00B7 ", fmtSlaAge(order.ageHours)] })] }), _jsxs(Box, { sx: { textAlign: 'right' }, children: [_jsx(Typography, { sx: { fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }, children: fmt$(order.revenue) }), _jsx(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }, children: "at stake" })] }), order.constraintType !== null ? (_jsx(Box, { component: "button", onClick: () => onOrderClick?.(order.lasyncro_order_id), sx: { fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)', bgcolor: 'var(--accent)', border: 'none', borderRadius: '6px', py: 1, textAlign: 'center', cursor: 'pointer', '&:hover': { opacity: 0.88 } }, children: "Review queue" })) : order.inPickBatch ? (_jsx(Box, { sx: {
                                                        fontSize: 12,
                                                        fontWeight: 600,
                                                        color: 'var(--ink-3)',
                                                        bgcolor: 'var(--bg-3)',
                                                        border: '0.5px solid var(--rule)',
                                                        borderRadius: '6px',
                                                        py: 1,
                                                        textAlign: 'center',
                                                    }, children: "In batch" })) : (_jsx(PrioritizeButton, { isPriorityFlagged: order.isPriorityFlagged, onPrioritize: () => handlePrioritizeOrder(order.lasyncro_order_id) }))] }, order.lasyncro_order_id)) }), hiddenCriticalOrders.length > 0 && (_jsxs(_Fragment, { children: [_jsx(Collapse, { in: criticalExpanded, timeout: 180, unmountOnExit: true, children: _jsx(ReorderTransitionList, { items: hiddenCriticalOrders, getKey: (order) => order.lasyncro_order_id, durationMs: 520, renderItem: (order) => (_jsxs(Box, { sx: {
                                                            display: 'grid',
                                                            gridTemplateColumns: 'minmax(0,1fr) 90px 118px',
                                                            gap: 1.75,
                                                            alignItems: 'center',
                                                            px: 2.5,
                                                            py: 1.75,
                                                            borderTop: '1px solid var(--rule)',
                                                            bgcolor: priorityFlashOrderIds.has(order.lasyncro_order_id)
                                                                ? 'rgba(16,185,129,0.08)'
                                                                : 'transparent',
                                                            boxShadow: priorityFlashOrderIds.has(order.lasyncro_order_id)
                                                                ? 'inset 3px 0 0 rgba(16,185,129,0.55)'
                                                                : 'inset 0 0 0 rgba(16,185,129,0)',
                                                            transition: 'background-color 520ms ease, box-shadow 520ms ease',
                                                        }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', mb: 0.375 }, children: order.externalOrderId ? `#${order.externalOrderId}` : order.lasyncro_order_id.slice(0, 8).toUpperCase() }), _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: [constraintLabel(order.constraintType, order.isShippingSlaBreached), " \u00B7 ", fmtSlaAge(order.ageHours)] })] }), _jsxs(Box, { sx: { textAlign: 'right' }, children: [_jsx(Typography, { sx: { fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }, children: fmt$(order.revenue) }), _jsx(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }, children: "at stake" })] }), order.constraintType !== null ? (_jsx(Box, { component: "button", onClick: () => onOrderClick?.(order.lasyncro_order_id), sx: { fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)', bgcolor: 'var(--accent)', border: 'none', borderRadius: '6px', py: 1, textAlign: 'center', cursor: 'pointer', '&:hover': { opacity: 0.88 } }, children: "Review queue" })) : order.inPickBatch ? (_jsx(Box, { sx: {
                                                                    fontSize: 12,
                                                                    fontWeight: 600,
                                                                    color: 'var(--ink-3)',
                                                                    bgcolor: 'var(--bg-3)',
                                                                    border: '0.5px solid var(--rule)',
                                                                    borderRadius: '6px',
                                                                    py: 1,
                                                                    textAlign: 'center',
                                                                }, children: "In batch" })) : (_jsx(PrioritizeButton, { isPriorityFlagged: order.isPriorityFlagged, onPrioritize: () => handlePrioritizeOrder(order.lasyncro_order_id) }))] }, order.lasyncro_order_id)) }) }), _jsxs(Box, { onClick: () => setCriticalExpanded(v => !v), sx: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: 2.5, py: 1.125, borderTop: '1px solid var(--rule)', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }, children: [_jsx(Typography, { sx: { fontSize: 11, fontWeight: 500 }, children: criticalExpanded ? 'Show less' : `See ${hiddenCriticalOrders.length} more` }), criticalExpanded ? _jsx(ChevronUp, { size: 13 }) : _jsx(ChevronDown, { size: 13 })] })] }))] })) : (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1, bgcolor: 'rgba(76,175,122,0.06)' }, children: [_jsx(Box, { sx: { width: 6, height: 6, borderRadius: '50%', bgcolor: '#4CAF7A', flexShrink: 0 } }), _jsx(Typography, { sx: { fontSize: 10, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#4CAF7A' }, children: "All clear \u2014 no critical items" })] })), watchOrders.length > 0 && (_jsxs(_Fragment, { children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1, bgcolor: 'rgba(217,162,59,0.06)', borderTop: '1px solid var(--rule)' }, children: [_jsx(Box, { sx: { width: 6, height: 6, borderRadius: '50%', bgcolor: '#D9A23B', flexShrink: 0 } }), _jsx(Typography, { sx: { fontSize: 10, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#D9A23B' }, children: "Watch" }), _jsx(Box, { sx: { flex: 1 } }), _jsxs(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }, children: [watchOrders.length, " items"] })] }), visibleWatchOrders.map(order => (_jsxs(Box, { sx: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 118px', gap: 1.75, alignItems: 'center', px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)' }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', mb: 0.375 }, children: order.externalOrderId ? `#${order.externalOrderId}` : order.lasyncro_order_id.slice(0, 8).toUpperCase() }), _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: [constraintLabel(order.constraintType, order.isShippingSlaBreached), " \u00B7 ", fmtSlaAge(order.ageHours), " aging"] })] }), _jsx(Box, { component: "button", onClick: () => onOrderClick?.(order.lasyncro_order_id), sx: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: "View order \u2192" })] }, order.lasyncro_order_id))), hiddenWatchOrders.length > 0 && (_jsxs(_Fragment, { children: [_jsx(Collapse, { in: watchExpanded, timeout: 180, unmountOnExit: true, children: hiddenWatchOrders.map(order => (_jsxs(Box, { sx: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 118px', gap: 1.75, alignItems: 'center', px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)' }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', mb: 0.375 }, children: order.externalOrderId ? `#${order.externalOrderId}` : order.lasyncro_order_id.slice(0, 8).toUpperCase() }), _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: [constraintLabel(order.constraintType, order.isShippingSlaBreached), " \u00B7 ", fmtSlaAge(order.ageHours), " aging"] })] }), _jsx(Box, { component: "button", onClick: () => onOrderClick?.(order.lasyncro_order_id), sx: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: "View order \u2192" })] }, order.lasyncro_order_id))) }), _jsxs(Box, { onClick: () => setWatchExpanded(v => !v), sx: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: 2.5, py: 1.125, borderTop: '1px solid var(--rule)', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }, children: [_jsx(Typography, { sx: { fontSize: 11, fontWeight: 500 }, children: watchExpanded ? 'Show less' : `See ${hiddenWatchOrders.length} more` }), watchExpanded ? _jsx(ChevronUp, { size: 13 }) : _jsx(ChevronDown, { size: 13 })] })] }))] })), _jsx(Box, { sx: { px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)' }, children: _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: [constrained === 0 && watchOrders.length === 0 ? 'Everything else is on track · ' : '', fmtN(props.orders?.fulfilled), " shipped today \u00B7 ", syncLabel] }) })] }), _jsx(Box, { sx: { flex: { xs: '1 0 300px', lg: '0 0 300px' }, minWidth: 0 }, children: _jsx(PulseCard, { title: "Today's pulse", headline: {
                                value: `${fmtN(aging72)} breached`,
                                tone: aging72 > 0 ? 'critical' : 'good',
                                colorOverride: aging72 > 0 ? STAGE_COLORS.breached : 'var(--ink)',
                                subtext: unprioritizedCriticalCount > 0
                                    ? `${unprioritizedCriticalCount} still need priority`
                                    : 'Critical queue is under control',
                            }, rows: [
                                { id: 'breached', label: 'Breached', value: aging72, tone: 'critical', colorOverride: STAGE_COLORS.breached, progress: { value: aging72, max: pulseMax } },
                                { id: 'blocked', label: 'Blocked', value: constrained, tone: 'warning', colorOverride: STAGE_COLORS.blocked, progress: { value: constrained, max: pulseMax } },
                                { id: 'picking', label: 'Picking', value: qPicking, tone: 'neutral', colorOverride: STAGE_COLORS.picking, progress: { value: qPicking, max: pulseMax } },
                                { id: 'ready', label: 'Ready', value: qReady, tone: 'good', colorOverride: STAGE_COLORS.ready, progress: { value: qReady, max: pulseMax } },
                            ], footerNote: _jsxs(_Fragment, { children: [_jsx(Box, { component: "span", sx: { fontWeight: 600, color: 'var(--ink)' }, children: fmtN(props.orders?.fulfilled) }), ' shipped today · ', _jsx(Box, { component: "span", sx: { fontWeight: 600, color: 'var(--ink)' }, children: fmt$(revenue?.earned) }), ' collected'] }), footerCta: { label: 'View order flow', onClick: () => navigate('/orders/flow') } }) })] })] }));
}
//# sourceMappingURL=OrdersModuleFT2.js.map