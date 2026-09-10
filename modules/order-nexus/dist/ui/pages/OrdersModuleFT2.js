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
import { formatCurrencyCompact, PulseCard } from '@lasyncro/shared/ui';
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
    const [showAllRailGroups, setShowAllRailGroups] = useState(false);
    const { operationalControl, revenue, operatorSummary, currency, onExport, onOrderClick, mapContent, onPriorityFlag } = props;
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
    const [expandedCriticalGroupKeys, setExpandedCriticalGroupKeys] = useState(() => new Set());
    const [watchExpanded, setWatchExpanded] = useState(false);
    const [bulkPriorityConfirmGroupKey, setBulkPriorityConfirmGroupKey] = useState(null);
    const [bulkPriorityPendingGroupKey, setBulkPriorityPendingGroupKey] = useState(null);
    const [bulkPriorityConfirmedGroupKey, setBulkPriorityConfirmedGroupKey] = useState(null);
    const [bulkPriorityErrorGroupKey, setBulkPriorityErrorGroupKey] = useState(null);
    const toggleCriticalGroup = (key) => {
        setExpandedCriticalGroupKeys(prev => {
            const next = new Set(prev);
            if (next.has(key))
                next.delete(key);
            else
                next.add(key);
            return next;
        });
    };
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
    const handlePrioritizeGroup = async (groupKey, orderIds) => {
        if (!onPriorityFlag || orderIds.length === 0)
            return;
        orderIds.forEach(holdPriorityMovement);
        setBulkPriorityPendingGroupKey(groupKey);
        setBulkPriorityErrorGroupKey(null);
        try {
            await onPriorityFlag(orderIds, true);
            orderIds.forEach(flashPriorityRow);
            setBulkPriorityConfirmGroupKey(null);
            setBulkPriorityConfirmedGroupKey(groupKey);
            window.setTimeout(() => {
                setBulkPriorityConfirmedGroupKey(prev => prev === groupKey ? null : prev);
            }, 2000);
        }
        catch {
            setMovementHeldOrderIds(prev => {
                const next = new Set(prev);
                orderIds.forEach(id => next.delete(id));
                return next;
            });
            setPriorityFlashOrderIds(prev => {
                const next = new Set(prev);
                orderIds.forEach(id => next.delete(id));
                return next;
            });
            setBulkPriorityErrorGroupKey(groupKey);
        }
        finally {
            setBulkPriorityPendingGroupKey(null);
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
    // Critical/Watch contain only decisions that still need intervention.
    // A successful priority action remains briefly during the existing movement
    // hold, then leaves Needs a decision once that confirmation window expires.
    const stillNeedsDecision = (order) => !order.isPriorityFlagged ||
        movementHeldOrderIds.has(order.lasyncro_order_id);
    // Unconstrained orders already moving in a pick batch have no decision here.
    const allBreachedOrders = allAgingOrders.filter(o => o.isShippingSlaBreached);
    const breachedCriticalOrders = allBreachedOrders.filter(o => stillNeedsDecision(o) &&
        (o.constraintType !== null || !o.inPickBatch));
    /**
     * ORD-OVERVIEW-INVENTORY-01 — CANONICAL CONSTRAINT ADMISSION
     * ----------------------------------------------------------
     * Generalised from the ORD-RETPKG (2026-09) returned-package path, which
     * established the principle for one block type only: active
     * order_constraints rows are canonical truth, carry no shipping-SLA
     * semantics of their own, and are not guaranteed an order_age_snapshot
     * row — so they must NOT depend on the SLA/aging population.
     *
     * That was implemented as a `returned_undelivered` special case, which
     * left every other blocker admissible only by breaching SLA: a freshly
     * out-of-stock or address-blocked order was counted in the header and
     * absent from this card. Two dimensions, now kept separate:
     *
     *   WHY blocked  → canonical constraint  (admission)
     *   HOW urgent   → SLA / age             (ranking, never admission)
     *
     * Source of record is unchanged: the existing constrained-orders payload
     * (useConstrainedOrders → /api/v1/orders/constrained).
     */
    const isMerchantActionableConstraint = (constraintType, blockType) => {
        switch (constraintType) {
            case 'inventory':
                // allocation_pending has no ratified merchant-actionable semantics
                // and is pending its own lifecycle audit — it must not silently
                // become a decision. Every other inventory block is actionable.
                return blockType !== 'allocation_pending';
            case 'customer':
            case 'operational':
                return true;
            default:
                // An unrecognised constraint type is NOT assumed actionable. New
                // types opt in here deliberately rather than appearing by default.
                return false;
        }
    };
    // Real aging facts, keyed by order id, so a constrained row can be
    // enriched with them where they exist. Nothing is fabricated: an order
    // absent from the aging population simply has no such facts.
    const agingFactsById = new Map(allAgingOrders.map(o => [o.lasyncro_order_id, o]));
    // Normalise only the fields the Critical row / detail-open contract needs.
    const actionableConstrainedOrders = (props.constrainedOrders ?? [])
        .filter(o => isMerchantActionableConstraint(o.constraint_type, o.block_type ?? null))
        .map(o => {
        const aging = agingFactsById.get(o.order_id);
        return {
            lasyncro_order_id: o.order_id,
            externalOrderId: o.external_order_id ?? aging?.externalOrderId ?? null,
            // Prefer the aging population's real age/SLA/batch facts when the
            // order appears there too; otherwise use whatever the constrained
            // row actually carries. Never invent a breach or a promised date.
            ageHours: aging?.ageHours ??
                Math.max(0, Math.floor((o.age_since_creation_seconds ?? 0) / 3600)),
            isShippingSlaBreached: aging?.isShippingSlaBreached ?? Boolean(o.is_shipping_sla_breached),
            // Canonical truth owns the classification, so the order lands under
            // its real issue group rather than the aging row's stale view.
            constraintType: o.constraint_type,
            blockType: (o.block_type ?? null),
            isPriorityFlagged: aging?.isPriorityFlagged ?? false,
            inPickBatch: aging?.inPickBatch ?? false,
            pickBatchStatus: (aging?.pickBatchStatus ?? null),
            revenue: Number(o.revenue ?? aging?.revenue ?? 0) || 0,
            timeToSlaBreachMinutes: (aging?.timeToSlaBreachMinutes ?? null),
        };
    });
    const actionableConstrainedIds = new Set(actionableConstrainedOrders.map(o => o.lasyncro_order_id));
    // Merge — canonical constraint ownership wins. An SLA-breached aging row is
    // admitted only when no actionable constraint already owns that order, so
    // every order id appears exactly once and lands under its blocker's group
    // rather than being double-listed under Shipping SLA breached.
    const criticalOrdersById = new Map();
    for (const o of breachedCriticalOrders)
        criticalOrdersById.set(o.lasyncro_order_id, o);
    for (const o of actionableConstrainedOrders)
        criticalOrdersById.set(o.lasyncro_order_id, o);
    const criticalOrders = [...criticalOrdersById.values()];
    // Ids that belong to "Package returned" regardless of which merged row won —
    // used to keep the SLA / operational groups from double-listing them.
    const returnedPackageOrderIds = new Set([
        ...actionableConstrainedOrders
            .filter(o => o.constraintType === 'operational' && o.blockType === 'returned_undelivered')
            .map(o => o.lasyncro_order_id),
        ...breachedCriticalOrders
            .filter(o => o.constraintType === 'operational' && o.blockType === 'returned_undelivered')
            .map(o => o.lasyncro_order_id),
    ]);
    // UX-CRITICAL-GROUPS: the owner acts on issue classes, not a wall of
    // repeated order rows. Preserve every order underneath an expandable group.
    const criticalGroups = [
        {
            key: 'customer',
            label: 'Address issues',
            orders: criticalOrders.filter(o => o.constraintType === 'customer'),
        },
        {
            key: 'inventory',
            label: 'Out of stock',
            orders: criticalOrders.filter(o => o.constraintType === 'inventory'),
        },
        {
            key: 'operational',
            label: 'Operational issues',
            orders: criticalOrders.filter(o => o.constraintType !== null &&
                o.constraintType !== 'customer' &&
                o.constraintType !== 'inventory' &&
                o.blockType !== 'returned_undelivered' &&
                !returnedPackageOrderIds.has(o.lasyncro_order_id)),
        },
        {
            key: 'returned_undelivered',
            label: 'Package returned',
            orders: criticalOrders.filter(o => returnedPackageOrderIds.has(o.lasyncro_order_id)),
        },
        {
            key: 'sla',
            label: 'Shipping SLA breached',
            orders: criticalOrders.filter(o => o.constraintType === null && !returnedPackageOrderIds.has(o.lasyncro_order_id)),
        },
    ]
        .filter(group => group.orders.length > 0)
        .map(group => ({
        ...group,
        revenue: group.orders.reduce((sum, order) => sum + (order.revenue ?? 0), 0),
        oldestAgeHours: Math.max(...group.orders.map(order => order.ageHours)),
    }))
        .sort((a, b) => b.revenue - a.revenue);
    /**
     * DC-03 (2026-08-15): the SLA breach count. aging_72h_plus is NOT this — it
     * counts unfulfilled orders older than 72h since creation
     * (age_since_creation_seconds >= 259200), with no reference to
     * promised_ship_by. An order can be four days old and within its promise, or
     * breach in six hours. Shop 15: 15 aging vs 13 actually breached.
     *
     * Same conflation the 2026-07-01 constraintLabel fix corrected below; it was
     * never propagated to the pulse. The card's own subtext already counted
     * against this figure, so the headline contradicted its own caption.
     */
    const slaBreachedCount = allBreachedOrders.length;
    // FIX (2026-07-01): the >= 24 check was dead weight — the backend already
    // pre-filters agingOrders to WATCH_FLOOR_SECONDS (now SLA-aware, was a flat
    // 48h) before this array ever reaches the frontend, so every order here
    // already qualifies. Re-checking a hardcoded 24h client-side both duplicated
    // backend logic and used a different, disconnected number.
    // ORD-OVERVIEW-INVENTORY-01: Watch is "aging, needs attention soon" — an
    // order already owned by an actionable canonical constraint is not merely
    // aging, it is blocked, and belongs in Critical under its issue group. It
    // must not appear in both bands. This is a frontend ownership rule only;
    // the backend aging population and WATCH_FLOOR are unchanged.
    const watchOrders = allAgingOrders.filter(o => !o.isShippingSlaBreached &&
        stillNeedsDecision(o) &&
        !actionableConstrainedIds.has(o.lasyncro_order_id));
    const visibleWatchOrders = watchOrders.slice(0, TRIAGE_PREVIEW_LIMIT);
    const hiddenWatchOrders = watchOrders.slice(TRIAGE_PREVIEW_LIMIT);
    const prioritizedCriticalCount = criticalOrders.filter(o => o.isPriorityFlagged).length;
    const unprioritizedCriticalCount = Math.max(criticalOrders.length - prioritizedCriticalCount, 0);
    const pulseRows = [
        { label: 'Breached', n: slaBreachedCount, color: STAGE_COLORS.breached },
        { label: 'Picking', n: qPicking, color: STAGE_COLORS.picking },
        { label: 'Fulfillable', n: qReady, color: STAGE_COLORS.ready },
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
    const constraintLabel = (type, isBreached, blockType) => {
        switch (type) {
            case 'inventory': return 'Out of stock';
            case 'customer': return 'Address issue';
            case 'operational': return blockType === 'returned_undelivered' ? 'Package returned' : 'Pick exception';
            default: return isBreached ? 'SLA breach' : 'Aging';
        }
    };
    // ── Stage bar ───────────────────────────────────────────────
    const stageData = [
        // DC-04 (2026-08-15): queue_ready_to_ship counts every unblocked unfulfilled
        // order — pool, batched, picking, packed alike. It is not a pipeline stage
        // and not the order pool, which is the unbatched subset shown on Order Flow
        // (3 vs 13 on shop 15). "Fulfillable" states the predicate: nothing is in
        // this order's way. Key unchanged; renaming needs a consumer sweep.
        { key: 'ready', label: 'Fulfillable', count: qReady },
        { key: 'picking', label: 'Picking', count: qPicking },
        { key: 'blocked', label: 'Blocked', count: constrained },
        // DC-03: keeps the aging bucket — a pipeline age band sits naturally beside
        // Ready/Picking/Blocked — but stops calling it a breach. Key unchanged;
        // renaming it needs a sweep of consumers.
        { key: 'breached', label: 'Aging 3d+', count: aging72 },
        { key: 'awaiting_stock', label: 'Awaiting stock', count: operatorSummary?.constraintCounts?.inventory ?? 0 },
        { key: 'awaiting_reply', label: 'Awaiting reply', count: operatorSummary?.constraintCounts?.customer ?? 0 },
    ];
    const accountedFor = stageData.reduce((s, d) => s + d.count, 0);
    const newCount = Math.max(0, totalOrders - accountedFor);
    const allStages = [{ key: 'new', label: 'New', count: newCount }, ...stageData];
    const stageTotal = allStages.reduce((s, d) => s + d.count, 0) || 1;
    /**
     * ORD-UX-01 — GROUP summaries for the 280px Live Intelligence rail.
     *
     * Reuses `criticalGroups` verbatim: same authoritative population, same
     * commercial-consequence ordering (revenue at stake, descending), same
     * labels. The rail only changes the PRESENTATION — one line per issue class,
     * never per order. Aging is appended last because it is imminent risk rather
     * than a realised blocker, matching the Watch band's meaning in the triage
     * layout. No group is invented: each one only exists when its authoritative
     * population is non-empty.
     */
    const railGroups = [
        ...criticalGroups.map(group => ({
            key: group.key,
            label: group.label,
            count: group.orders.length,
            revenue: group.revenue,
            oldestAgeHours: group.oldestAgeHours,
            orderIds: group.orders.map(o => o.lasyncro_order_id),
        })),
        ...(watchOrders.length > 0
            ? [{
                    key: 'aging',
                    label: 'Aging — review soon',
                    count: watchOrders.length,
                    revenue: watchOrders.reduce((sum, o) => sum + (o.revenue ?? 0), 0),
                    oldestAgeHours: Math.max(...watchOrders.map(o => o.ageHours)),
                    orderIds: watchOrders.map(o => o.lasyncro_order_id),
                }]
            : []),
    ];
    const RAIL_GROUP_PREVIEW_LIMIT = 3;
    const visibleRailGroups = showAllRailGroups
        ? railGroups
        : railGroups.slice(0, RAIL_GROUP_PREVIEW_LIMIT);
    const hiddenRailGroupCount = railGroups.length - visibleRailGroups.length;
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
                                    // ORD-OVERVIEW-INVENTORY-01: this said "SLA-breached", which
                                    // became false once canonical constraints are admitted without
                                    // an SLA prerequisite — a freshly out-of-stock order is
                                    // critical but not late. Critical is the accurate collective
                                    // noun; SLA breach stays identifiable at group/order level via
                                    // the "Shipping SLA breached" group.
                                    : criticalOrders.length > 0
                                        ? `${criticalOrders.length} critical order${criticalOrders.length === 1 ? '' : 's'} · ${fmt$(criticalOrders.reduce((s, o) => s + (o.revenue ?? 0), 0))} at stake`
                                        : watchOrders.length > 0
                                            ? `${watchOrders.length} order${watchOrders.length === 1 ? '' : 's'} aging · review soon`
                                            : 'All orders on track — nothing needs immediate action' })] }), _jsx(Box, { sx: { display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }, children: onExport && (_jsx(Box, { onClick: onExport, sx: { display: 'inline-flex', alignItems: 'center', px: '12px', py: '6px', fontSize: 12, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent-border)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: "Export \u2192" })) })] }), mapContent ? (_jsxs(Box, { sx: { display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, gap: 2.25, alignItems: 'stretch' }, children: [_jsx(Box, { sx: { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }, children: mapContent }), _jsxs(Box, { sx: { flex: { xs: '1 1 auto', lg: '0 0 280px' }, width: { lg: 280 }, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }, children: [railGroups.length > 0 && (_jsxs(Box, { sx: { bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', overflow: 'hidden' }, children: [_jsx(Box, { sx: { px: 1.75, py: 1.25, borderBottom: '0.5px solid var(--rule)' }, children: _jsx(Typography, { sx: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }, children: "Needs a decision" }) }), visibleRailGroups.map(group => (_jsxs(Box, { onClick: () => {
                                            // A single concrete order is the natural action — open it.
                                            // Anything wider belongs to the workflow that owns it.
                                            if (group.orderIds.length === 1 && onOrderClick) {
                                                onOrderClick(group.orderIds[0]);
                                                return;
                                            }
                                            navigate('/orders/flow');
                                        }, sx: {
                                            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1,
                                            px: 1.75, py: 1.25, cursor: 'pointer',
                                            borderBottom: '0.5px solid var(--rule)',
                                            '&:last-of-type': { borderBottom: 'none' },
                                            '&:hover': { bgcolor: 'action.hover' },
                                        }, children: [_jsxs(Box, { sx: { minWidth: 0 }, children: [_jsxs(Typography, { sx: { fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.35 }, children: [group.count, " ", group.label] }), group.oldestAgeHours != null && (_jsxs(Typography, { sx: { fontSize: 11, color: 'var(--ink-4)', mt: 0.125 }, children: ["oldest ", fmtSlaAge(group.oldestAgeHours)] }))] }), group.revenue != null && (_jsx(Typography, { sx: { fontSize: 11.5, fontWeight: 500, color: 'var(--ink-3)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }, children: fmt$(group.revenue) }))] }, group.key))), hiddenRailGroupCount > 0 && (_jsx(Box, { onClick: () => setShowAllRailGroups(true), sx: { px: 1.75, py: 1, borderTop: '0.5px solid var(--rule)', cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: _jsxs(Typography, { sx: { fontSize: 11, fontWeight: 500, color: 'var(--accent)' }, children: ["See ", hiddenRailGroupCount, " more \u2192"] }) }))] })), _jsx(PulseCard, { title: "Today's pulse", headline: {
                                    value: `${fmtN(slaBreachedCount)} breached`,
                                    tone: slaBreachedCount > 0 ? 'critical' : 'good',
                                    colorOverride: slaBreachedCount > 0 ? STAGE_COLORS.breached : 'var(--ink)',
                                    subtext: unprioritizedCriticalCount > 0
                                        ? `${unprioritizedCriticalCount} still need priority`
                                        : 'Critical queue is under control',
                                }, rows: [
                                    { id: 'breached', label: 'Breached', value: slaBreachedCount, tone: 'critical', colorOverride: STAGE_COLORS.breached, progress: { value: slaBreachedCount, max: pulseMax } },
                                    { id: 'blocked', label: 'Blocked', value: constrained, tone: 'warning', colorOverride: STAGE_COLORS.blocked, progress: { value: constrained, max: pulseMax } },
                                    { id: 'picking', label: 'Picking', value: qPicking, tone: 'neutral', colorOverride: STAGE_COLORS.picking, progress: { value: qPicking, max: pulseMax } },
                                    { id: 'ready', label: 'Fulfillable', value: qReady, tone: 'good', colorOverride: STAGE_COLORS.ready, progress: { value: qReady, max: pulseMax } },
                                ], footerNote: _jsxs(_Fragment, { children: [_jsx(Box, { component: "span", sx: { fontWeight: 600, color: 'var(--ink)' }, children: fmtN(props.orders?.fulfilled) }), ' fulfilled to date · ', _jsx(Box, { component: "span", sx: { fontWeight: 600, color: 'var(--ink)' }, children: fmt$(revenue?.earned) }), ' collected to date'] }), footerCta: { label: 'View order flow', onClick: () => navigate('/orders/flow') } })] })] })) : (
            /* ── TRIAGE-FIRST GRID (compatibility fallback) ──────────
               Preserved unchanged for consumers that supply no map surface. */
            _jsxs(Box, { sx: { display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, flexWrap: { xs: 'nowrap', lg: 'wrap' }, gap: 2.25, alignItems: 'stretch' }, children: [_jsxs(Box, { sx: { flex: { xs: '1 1 auto', lg: '1 1 0' }, minWidth: 0, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', p: '16px 20px 14px', borderBottom: '1px solid var(--rule)' }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 14, fontWeight: 500, color: 'var(--ink)', mb: 0.375 }, children: "Needs a decision" }), _jsx(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: "Ranked by commercial consequence" })] }), _jsx(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }, children: syncLabel })] }), criticalOrders.length > 0 ? (_jsxs(_Fragment, { children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1, bgcolor: 'rgba(229,72,77,0.07)' }, children: [_jsx(Box, { sx: { width: 6, height: 6, borderRadius: '50%', bgcolor: '#E5484D', flexShrink: 0 } }), _jsx(Typography, { sx: { fontSize: 10, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#F2555A' }, children: "Critical \u2014 act today" }), _jsx(Box, { sx: { flex: 1 } }), _jsxs(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }, children: [criticalOrders.length, " orders \u00B7 ", criticalGroups.length, " ", criticalGroups.length === 1 ? 'issue' : 'issues'] })] }), criticalGroups.map(group => {
                                        const expanded = expandedCriticalGroupKeys.has(group.key);
                                        const bulkPriorityOrderIds = group.key === 'sla'
                                            ? group.orders
                                                .filter(order => !order.isPriorityFlagged)
                                                .map(order => order.lasyncro_order_id)
                                            : [];
                                        const bulkPriorityPending = bulkPriorityPendingGroupKey === group.key;
                                        const bulkPriorityConfirmed = bulkPriorityConfirmedGroupKey === group.key;
                                        return (_jsxs(Box, { children: [_jsxs(Box, { sx: {
                                                        display: 'grid',
                                                        gridTemplateColumns: 'minmax(0,1fr) 90px 118px',
                                                        gap: 1.75,
                                                        alignItems: 'center',
                                                        px: 2.5,
                                                        py: 1.75,
                                                        borderTop: '1px solid var(--rule)',
                                                    }, children: [_jsxs(Box, { component: "button", type: "button", onClick: () => toggleCriticalGroup(group.key), sx: {
                                                                display: 'block',
                                                                width: '100%',
                                                                p: 0,
                                                                border: 'none',
                                                                bgcolor: 'transparent',
                                                                color: 'inherit',
                                                                textAlign: 'left',
                                                                cursor: 'pointer',
                                                                '&:hover': { opacity: 0.8 },
                                                            }, children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.75 }, children: [_jsx(Typography, { sx: { fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }, children: group.label }), expanded ? _jsx(ChevronUp, { size: 13 }) : _jsx(ChevronDown, { size: 13 })] }), _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)', mt: 0.375 }, children: [group.orders.length, " ", group.orders.length === 1 ? 'order' : 'orders', " \u00B7 oldest ", fmtSlaAge(group.oldestAgeHours)] })] }), _jsxs(Box, { sx: { textAlign: 'right' }, children: [_jsx(Typography, { sx: { fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }, children: fmt$(group.revenue) }), _jsx(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }, children: "at stake" })] }), group.key === 'sla' && !expanded ? (_jsx(Box, { component: "button", type: "button", disabled: !onPriorityFlag ||
                                                                bulkPriorityPending ||
                                                                bulkPriorityConfirmed ||
                                                                bulkPriorityOrderIds.length === 0, onClick: (event) => {
                                                                event.stopPropagation();
                                                                if (!onPriorityFlag ||
                                                                    bulkPriorityPending ||
                                                                    bulkPriorityConfirmed ||
                                                                    bulkPriorityOrderIds.length === 0)
                                                                    return;
                                                                setBulkPriorityErrorGroupKey(null);
                                                                setBulkPriorityConfirmGroupKey(group.key);
                                                            }, sx: {
                                                                fontSize: 12,
                                                                fontWeight: 600,
                                                                color: bulkPriorityConfirmed
                                                                    ? 'var(--confirm-ink)'
                                                                    : 'var(--accent-ink)',
                                                                bgcolor: bulkPriorityConfirmed
                                                                    ? 'var(--confirm-ghost)'
                                                                    : 'var(--accent)',
                                                                border: bulkPriorityConfirmed
                                                                    ? '1px solid var(--confirm-border)'
                                                                    : 'none',
                                                                borderRadius: '6px',
                                                                py: 1,
                                                                px: 1.25,
                                                                textAlign: 'center',
                                                                cursor: bulkPriorityPending || bulkPriorityConfirmed
                                                                    ? 'default'
                                                                    : 'pointer',
                                                                opacity: bulkPriorityPending ? 0.6 : 1,
                                                                '&:hover': {
                                                                    opacity: bulkPriorityPending || bulkPriorityConfirmed
                                                                        ? 1
                                                                        : 0.88,
                                                                },
                                                            }, children: bulkPriorityConfirmed
                                                                ? 'Prioritized ✓'
                                                                : bulkPriorityPending
                                                                    ? 'Prioritizing…'
                                                                    : 'Prioritize all…' })) : (_jsx(Box, {}))] }), group.key === 'sla' && expanded && (_jsxs(Box, { sx: {
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        gap: 2,
                                                        px: 2.5,
                                                        py: 1.25,
                                                        borderTop: '1px solid var(--rule)',
                                                        bgcolor: 'var(--accent-ghost)',
                                                    }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: {
                                                                        fontSize: 10,
                                                                        fontWeight: 600,
                                                                        letterSpacing: '0.08em',
                                                                        textTransform: 'uppercase',
                                                                        color: 'var(--accent)',
                                                                        mb: 0.25,
                                                                    }, children: "Bulk action" }), _jsxs(Typography, { sx: {
                                                                        fontSize: 12,
                                                                        fontWeight: 300,
                                                                        color: 'var(--ink-3)',
                                                                    }, children: ["Apply to all ", bulkPriorityOrderIds.length, ' ', bulkPriorityOrderIds.length === 1
                                                                            ? 'order'
                                                                            : 'orders'] })] }), _jsx(Box, { component: "button", type: "button", disabled: !onPriorityFlag ||
                                                                bulkPriorityPending ||
                                                                bulkPriorityConfirmed ||
                                                                bulkPriorityOrderIds.length === 0, onClick: () => {
                                                                if (!onPriorityFlag ||
                                                                    bulkPriorityPending ||
                                                                    bulkPriorityConfirmed ||
                                                                    bulkPriorityOrderIds.length === 0)
                                                                    return;
                                                                setBulkPriorityErrorGroupKey(null);
                                                                setBulkPriorityConfirmGroupKey(group.key);
                                                            }, sx: {
                                                                fontSize: 12,
                                                                fontWeight: 600,
                                                                color: bulkPriorityConfirmed
                                                                    ? 'var(--confirm-ink)'
                                                                    : 'var(--accent-ink)',
                                                                bgcolor: bulkPriorityConfirmed
                                                                    ? 'var(--confirm-ghost)'
                                                                    : 'var(--accent)',
                                                                border: bulkPriorityConfirmed
                                                                    ? '1px solid var(--confirm-border)'
                                                                    : 'none',
                                                                borderRadius: '6px',
                                                                px: 1.5,
                                                                py: 0.875,
                                                                whiteSpace: 'nowrap',
                                                                cursor: bulkPriorityPending || bulkPriorityConfirmed
                                                                    ? 'default'
                                                                    : 'pointer',
                                                                opacity: bulkPriorityPending ? 0.6 : 1,
                                                                '&:hover': {
                                                                    opacity: bulkPriorityPending || bulkPriorityConfirmed
                                                                        ? 1
                                                                        : 0.88,
                                                                },
                                                            }, children: bulkPriorityConfirmed
                                                                ? 'Prioritized ✓'
                                                                : bulkPriorityPending
                                                                    ? 'Prioritizing…'
                                                                    : 'Prioritize all…' })] })), group.key === 'sla' && (_jsx(Collapse, { in: bulkPriorityConfirmGroupKey === group.key, timeout: 180, unmountOnExit: true, children: _jsxs(Box, { sx: {
                                                            px: 2.5,
                                                            py: 1.5,
                                                            borderTop: '1px solid var(--rule)',
                                                            bgcolor: 'var(--accent-ghost)',
                                                        }, children: [_jsxs(Typography, { sx: {
                                                                    fontSize: 13,
                                                                    fontWeight: 600,
                                                                    color: 'var(--ink)',
                                                                    mb: 0.375,
                                                                }, children: ["Prioritize all ", bulkPriorityOrderIds.length, " orders?"] }), _jsx(Typography, { sx: {
                                                                    fontSize: 12,
                                                                    fontWeight: 300,
                                                                    color: 'var(--ink-4)',
                                                                    mb: 1.25,
                                                                }, children: "They will move to the top of the Order Flow pool for the next release." }), bulkPriorityErrorGroupKey === group.key && (_jsx(Typography, { sx: {
                                                                    fontSize: 11,
                                                                    fontWeight: 500,
                                                                    color: 'var(--critical-ink)',
                                                                    mb: 1,
                                                                }, children: "Prioritization failed. Nothing was changed." })), _jsxs(Box, { sx: {
                                                                    display: 'flex',
                                                                    justifyContent: 'flex-end',
                                                                    gap: 1,
                                                                }, children: [_jsx(Box, { component: "button", type: "button", disabled: bulkPriorityPending, onClick: () => {
                                                                            setBulkPriorityConfirmGroupKey(null);
                                                                            setBulkPriorityErrorGroupKey(null);
                                                                        }, sx: {
                                                                            border: '1px solid var(--rule)',
                                                                            bgcolor: 'transparent',
                                                                            color: 'var(--ink-3)',
                                                                            borderRadius: '6px',
                                                                            px: 1.5,
                                                                            py: 0.75,
                                                                            fontSize: 12,
                                                                            fontWeight: 500,
                                                                            cursor: bulkPriorityPending
                                                                                ? 'not-allowed'
                                                                                : 'pointer',
                                                                        }, children: "Cancel" }), _jsx(Box, { component: "button", type: "button", disabled: bulkPriorityPending ||
                                                                            bulkPriorityOrderIds.length === 0, onClick: () => void handlePrioritizeGroup(group.key, bulkPriorityOrderIds), sx: {
                                                                            border: 'none',
                                                                            bgcolor: 'var(--accent)',
                                                                            color: 'var(--accent-ink)',
                                                                            borderRadius: '6px',
                                                                            px: 1.5,
                                                                            py: 0.75,
                                                                            fontSize: 12,
                                                                            fontWeight: 600,
                                                                            cursor: bulkPriorityPending
                                                                                ? 'not-allowed'
                                                                                : 'pointer',
                                                                            opacity: bulkPriorityPending ? 0.6 : 1,
                                                                            '&:hover': {
                                                                                opacity: bulkPriorityPending ? 0.6 : 0.88,
                                                                            },
                                                                        }, children: bulkPriorityPending
                                                                            ? 'Prioritizing…'
                                                                            : 'Confirm priority' })] })] }) })), _jsx(Collapse, { in: expanded, timeout: 180, unmountOnExit: true, children: group.orders.map(order => (_jsxs(Box, { sx: {
                                                            display: 'grid',
                                                            gridTemplateColumns: order.constraintType === null
                                                                ? 'minmax(0,1fr) 90px 118px'
                                                                : 'minmax(0,1fr) 90px',
                                                            gap: 1.75,
                                                            alignItems: 'center',
                                                            px: 2.5,
                                                            py: 1.5,
                                                            pl: 4,
                                                            borderTop: '1px solid var(--rule)',
                                                            bgcolor: priorityFlashOrderIds.has(order.lasyncro_order_id)
                                                                ? 'rgba(16,185,129,0.08)'
                                                                : 'var(--bg-2)',
                                                            boxShadow: priorityFlashOrderIds.has(order.lasyncro_order_id)
                                                                ? 'inset 3px 0 0 rgba(16,185,129,0.55)'
                                                                : 'none',
                                                        }, children: [_jsxs(Box, { component: "button", type: "button", "aria-label": `View order #${order.externalOrderId
                                                                    ? order.externalOrderId
                                                                    : order.lasyncro_order_id.slice(0, 8).toUpperCase()} details`, onClick: () => onOrderClick?.(order.lasyncro_order_id), sx: {
                                                                    display: 'block',
                                                                    width: '100%',
                                                                    p: 0,
                                                                    border: 'none',
                                                                    bgcolor: 'transparent',
                                                                    color: 'inherit',
                                                                    textAlign: 'left',
                                                                    cursor: 'pointer',
                                                                    borderRadius: '6px',
                                                                    '&:hover': { opacity: 0.82 },
                                                                    '&:focus-visible': {
                                                                        outline: '1px solid var(--accent-border)',
                                                                        outlineOffset: '3px',
                                                                    },
                                                                }, children: [_jsx(Typography, { sx: { fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', mb: 0.375 }, children: order.externalOrderId
                                                                            ? `#${order.externalOrderId}`
                                                                            : order.lasyncro_order_id.slice(0, 8).toUpperCase() }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, minWidth: 0 }, children: [_jsxs(Typography, { sx: { fontSize: 11.5, fontWeight: 300, color: 'var(--ink-4)' }, children: [constraintLabel(order.constraintType, order.isShippingSlaBreached, order.blockType), " \u00B7 ", fmtSlaAge(order.ageHours)] }), _jsx(Typography, { sx: {
                                                                                    flexShrink: 0,
                                                                                    fontSize: 11,
                                                                                    fontWeight: 600,
                                                                                    color: 'var(--accent)',
                                                                                    border: '1px solid var(--accent-border)',
                                                                                    bgcolor: 'var(--surface)',
                                                                                    borderRadius: '6px',
                                                                                    px: 0.75,
                                                                                    py: 0.25,
                                                                                    lineHeight: 1.2,
                                                                                }, children: "View \u2192" })] })] }), _jsx(Box, { sx: { textAlign: 'right', alignSelf: 'end' }, children: _jsx(Typography, { sx: { fontSize: 13, fontWeight: 600, color: 'var(--ink)' }, children: fmt$(order.revenue) }) }), order.constraintType === null ? (_jsx(PrioritizeButton, { isPriorityFlagged: order.isPriorityFlagged, onPrioritize: () => handlePrioritizeOrder(order.lasyncro_order_id) })) : (_jsx(Box, {}))] }, order.lasyncro_order_id))) })] }, group.key));
                                    })] })) : (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1, bgcolor: 'rgba(76,175,122,0.06)' }, children: [_jsx(Box, { sx: { width: 6, height: 6, borderRadius: '50%', bgcolor: '#4CAF7A', flexShrink: 0 } }), _jsx(Typography, { sx: { fontSize: 10, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#4CAF7A' }, children: "All clear \u2014 no critical items" })] })), watchOrders.length > 0 && (_jsxs(_Fragment, { children: [_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1, bgcolor: 'rgba(217,162,59,0.06)', borderTop: '1px solid var(--rule)' }, children: [_jsx(Box, { sx: { width: 6, height: 6, borderRadius: '50%', bgcolor: '#D9A23B', flexShrink: 0 } }), _jsx(Typography, { sx: { fontSize: 10, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#D9A23B' }, children: "Watch" }), _jsx(Box, { sx: { flex: 1 } }), _jsxs(Typography, { sx: { fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }, children: [watchOrders.length, " items"] })] }), visibleWatchOrders.map(order => (_jsxs(Box, { sx: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 118px', gap: 1.75, alignItems: 'center', px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)' }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', mb: 0.375 }, children: order.externalOrderId ? `#${order.externalOrderId}` : order.lasyncro_order_id.slice(0, 8).toUpperCase() }), _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: [constraintLabel(order.constraintType, order.isShippingSlaBreached, order.blockType), " \u00B7 ", fmtSlaAge(order.ageHours), " aging"] })] }), _jsx(Box, { component: "button", onClick: () => onOrderClick?.(order.lasyncro_order_id), sx: { display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', px: 0, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: 'none', cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: "View \u2192" })] }, order.lasyncro_order_id))), hiddenWatchOrders.length > 0 && (_jsxs(_Fragment, { children: [_jsx(Collapse, { in: watchExpanded, timeout: 180, unmountOnExit: true, children: hiddenWatchOrders.map(order => (_jsxs(Box, { sx: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 118px', gap: 1.75, alignItems: 'center', px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)' }, children: [_jsxs(Box, { children: [_jsx(Typography, { sx: { fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', mb: 0.375 }, children: order.externalOrderId ? `#${order.externalOrderId}` : order.lasyncro_order_id.slice(0, 8).toUpperCase() }), _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: [constraintLabel(order.constraintType, order.isShippingSlaBreached, order.blockType), " \u00B7 ", fmtSlaAge(order.ageHours), " aging"] })] }), _jsx(Box, { component: "button", onClick: () => onOrderClick?.(order.lasyncro_order_id), sx: { display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', px: 0, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: 'none', cursor: 'pointer', '&:hover': { opacity: 0.75 } }, children: "View \u2192" })] }, order.lasyncro_order_id))) }), _jsxs(Box, { onClick: () => setWatchExpanded(v => !v), sx: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: 2.5, py: 1.125, borderTop: '1px solid var(--rule)', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }, children: [_jsx(Typography, { sx: { fontSize: 11, fontWeight: 500 }, children: watchExpanded ? 'Show less' : `See ${hiddenWatchOrders.length} more` }), watchExpanded ? _jsx(ChevronUp, { size: 13 }) : _jsx(ChevronDown, { size: 13 })] })] }))] })), _jsx(Box, { sx: { px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)' }, children: _jsxs(Typography, { sx: { fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }, children: [constrained === 0 && watchOrders.length === 0 ? 'Everything else is on track · ' : '', fmtN(props.orders?.fulfilled), " fulfilled to date \u00B7 ", syncLabel] }) })] }), _jsx(Box, { sx: { flex: { xs: '1 0 300px', lg: '0 0 300px' }, minWidth: 0 }, children: _jsx(PulseCard, { title: "Today's pulse", headline: {
                                value: `${fmtN(slaBreachedCount)} breached`,
                                tone: slaBreachedCount > 0 ? 'critical' : 'good',
                                colorOverride: slaBreachedCount > 0 ? STAGE_COLORS.breached : 'var(--ink)',
                                subtext: unprioritizedCriticalCount > 0
                                    ? `${unprioritizedCriticalCount} still need priority`
                                    : 'Critical queue is under control',
                            }, rows: [
                                { id: 'breached', label: 'Breached', value: slaBreachedCount, tone: 'critical', colorOverride: STAGE_COLORS.breached, progress: { value: slaBreachedCount, max: pulseMax } },
                                { id: 'blocked', label: 'Blocked', value: constrained, tone: 'warning', colorOverride: STAGE_COLORS.blocked, progress: { value: constrained, max: pulseMax } },
                                { id: 'picking', label: 'Picking', value: qPicking, tone: 'neutral', colorOverride: STAGE_COLORS.picking, progress: { value: qPicking, max: pulseMax } },
                                { id: 'ready', label: 'Fulfillable', value: qReady, tone: 'good', colorOverride: STAGE_COLORS.ready, progress: { value: qReady, max: pulseMax } },
                            ], footerNote: _jsxs(_Fragment, { children: [_jsx(Box, { component: "span", sx: { fontWeight: 600, color: 'var(--ink)' }, children: fmtN(props.orders?.fulfilled) }), ' fulfilled to date · ', _jsx(Box, { component: "span", sx: { fontWeight: 600, color: 'var(--ink)' }, children: fmt$(revenue?.earned) }), ' collected to date'] }), footerCta: { label: 'View order flow', onClick: () => navigate('/orders/flow') } }) })] }))] }));
}
//# sourceMappingURL=OrdersModuleFT2.js.map