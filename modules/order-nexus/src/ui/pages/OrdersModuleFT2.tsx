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
import type { FT2TemporalProps } from '@lasyncro/ui-ft2';
import { formatCurrencyCompact, PulseCard, ReorderTransitionList } from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';

// ─── PROPS ────────────────────────────────────────────────────

export interface OrdersModuleFT2DataProps extends FT2TemporalProps {
  orders: {
    total: number | null;
    fulfilled: number | null;
    unfulfilled: number | null;
    constrained: number | null;
  };

  revenue: {
    totalSales: number | null;
    earned: number | null;
    pending: number | null;
    blocked: number | null;
  };

  operationalControl: {
    snapshot_date: string;
    aggregate_version: number;
    realized_revenue: number;
    at_risk_revenue: number;
    total_at_risk_revenue: number;
    sla_breach_24h_revenue: number;
    top_blocking_type: string;
    blocked_revenue: number;
    revenue_leakage: number;
    avg_contribution_margin_pct: number;
    orders_at_sla_risk: number;
    aging_24h: number;
    aging_48h: number;
    aging_72h_plus: number;
    pending_fulfillment: number;
    pending_payment: number;
    exception_orders: number;
    constrained_orders: number;
    revenue_blocked_inventory: number;
    revenue_blocked_customer: number;
    revenue_blocked_operational: number;
    queue_manual_review: number;
    queue_awaiting_inventory: number;
    queue_ready_to_ship: number;
    queue_awaiting_customer: number;
    partial_fulfillment_opportunity: number;
  };

  returns?: {
    returnedRevenue: number | null;
    returnedUnits: number | null;
    affectedOrders: number | null;
  };

  obligations?: {
    totalBlockedValue: number | null;
    coverage: { status: 'sufficient' | 'insufficient' };
  };

  decision: {
    brief: {
      ready_to_ship: number;
      awaiting_customer: number;
      inventory_blocked_revenue: string | number;
      manual_review: string | number;
    } | null;
  };

  // onOrderSelect removed 2026-06-28 — dead prop, zero consumers found
  // (only the interface + compiled .d.ts reflected it). Same pattern as
  // OV-02's onResolveAll. onOrderClick below is the real, wired mechanism.
  onPriorityFlag?: (orderIds: string[], flagged: boolean) => Promise<void>;
  /** Opens the shared EntityDetailModal for this order. See entity-detail-modal-playbook.md §2. */
  onOrderClick?: (orderId: string) => void;

  /**
   * Module-level export CTA.
   * Handler is owned by the app shell because export API/auth concerns live outside order-nexus.
   */
  onExport?: () => void | Promise<void>;

  operatorSummary?: {
    constraintCounts?: { inventory: number; customer: number; operational: number };
    topBlockingType?: string | null;
    agingOrders?: Array<{
      lasyncro_order_id: string;
      externalOrderId: string | null;
      ageHours: number;
      isShippingSlaBreached: boolean;
      constraintType: string | null;
      isPriorityFlagged: boolean;
      inPickBatch: boolean;
      pickBatchStatus: string | null;
      revenue: number;
      timeToSlaBreachMinutes: number | null;
    }>;
    imminentSlaBreachers?: Array<{
      lasyncro_order_id: string;
      externalOrderId: string | null;
      minutesUntilBreach: number;
      constraintType: string | null;
      revenue: number;
    }>;
    queueCounts?: {
      readyToShip: number;
      awaitingInventory: number;
      awaitingCustomer: number;
      manualReview: number;
    };
  } | null;

  currency?: CurrencyContext;
}

// ─── HELPERS ──────────────────────────────────────────────────
const TRIAGE_PREVIEW_LIMIT = 3;
const PRIORITY_REORDER_HOLD_MS = 560;
const PRIORITY_FLASH_MS = 1400;

const fmtN = (n: number | null | undefined): string =>
  n == null ? '—' : Math.round(n).toLocaleString();

const fmtSlaAge = (hours: number): string => {
  const h = Math.round(hours);
  const d = Math.floor(h / 24);
  const rem = h % 24;
  if (d === 0) return `${rem}h past`;
  if (rem === 0) return `${d}d past`;
  return `${d}d ${rem}h past`;
};

// ─── STAGE COLORS ─────────────────────────────────────────────
// Domain-specific pipeline stage colors — no design-system token equivalent yet.
// Tracked in B-08. When @lasyncro/ui-ft2 adds stage tokens, migrate here.
const STAGE_COLORS: Record<string, string> = {
  new:            '#9CA3AF',
  ready:          '#10B981',
  picking:        '#3B82F6',
  packed:         '#6366F1',
  blocked:        '#F97316',
  breached:       '#EF4444',
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
function PrioritizeButton({
  isPriorityFlagged,
  onPrioritize,
}: {
  isPriorityFlagged: boolean;
  onPrioritize: () => Promise<void>;
}) {
  const [justPrioritized, setJustPrioritized] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const handleClick = async () => {
    if (isPending || isPriorityFlagged || justPrioritized) return;
    setIsPending(true);
    try {
      await onPrioritize();
      setJustPrioritized(true);
      setTimeout(() => setJustPrioritized(false), 2000);
    } finally {
      setIsPending(false);
    }
  };

  const showConfirmed = isPriorityFlagged || justPrioritized;

  return (
    <Box>
      <Box
        component="button"
        onClick={handleClick}
        disabled={isPending || showConfirmed}
        sx={{
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
        }}
      >
        {showConfirmed ? 'Prioritized ✓' : isPending ? 'Prioritizing…' : 'Prioritize →'}
      </Box>
      {showConfirmed && (
        <Typography
          sx={{
            fontSize: 10,
            fontWeight: 400,
            color: 'var(--ink-4)',
            textAlign: 'center',
            mt: 0.5,
          }}
        >
          To be released in the next batch
        </Typography>
      )}
    </Box>
  );
}

// MAIN COMPONENT
export default function OrdersModuleFT2(props: OrdersModuleFT2DataProps) {
  const navigate = useNavigate();
  const { 
    operationalControl, 
    revenue, 
    operatorSummary, 
    currency, 
    onExport, 
    onOrderClick, 
    onPriorityFlag 
  } = props

  const fmt$ = (n: number | null | undefined): string =>
    formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  // ── Derived counts ──────────────────────────────────────────
  const qReady         = operatorSummary?.queueCounts?.readyToShip ?? operationalControl?.queue_ready_to_ship ?? 0;
  const qPicking       = operationalControl?.pending_fulfillment ?? 0;
  const constrained    = operationalControl?.constrained_orders ?? 0;
  const aging72        = operationalControl?.aging_72h_plus ?? 0;
  const totalOrders    = props.orders?.total ?? 0;
  const blockedRevenue = operationalControl?.blocked_revenue ?? 0;

  // ── Date / sync header ──────────────────────────────────────
  const now = new Date();
  const dayLabel = now
    .toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' })
    .toUpperCase();
  const syncLabel = (() => {
    const snap = operationalControl?.snapshot_date;
    if (!snap) return 'Syncing…';
    const diffMin = Math.round((now.getTime() - new Date(snap).getTime()) / 60000);
    if (diffMin < 1) return 'Just synced';
    if (diffMin < 60) return `Last synced ${diffMin} min ago`;
    return `Last synced ${Math.round(diffMin / 60)}h ago`;
  })();

  // ── Triage queues ────────────────────────────────────────────
  // THREAD B (2026-06-30): prioritized orders sort to the bottom of
  // Critical after a short confirmation hold. This prevents the row from
  // teleporting immediately after the user clicks Prioritize.
  const [expandedCriticalGroupKeys, setExpandedCriticalGroupKeys] =
    useState<Set<string>>(() => new Set());
  const [watchExpanded, setWatchExpanded] = useState(false);
  const [bulkPriorityConfirmGroupKey, setBulkPriorityConfirmGroupKey] =
    useState<string | null>(null);
  const [bulkPriorityPendingGroupKey, setBulkPriorityPendingGroupKey] =
    useState<string | null>(null);
  const [bulkPriorityConfirmedGroupKey, setBulkPriorityConfirmedGroupKey] =
    useState<string | null>(null);
  const [bulkPriorityErrorGroupKey, setBulkPriorityErrorGroupKey] =
    useState<string | null>(null);

  const toggleCriticalGroup = (key: string) => {
    setExpandedCriticalGroupKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const [movementHeldOrderIds, setMovementHeldOrderIds] = useState<Set<string>>(() => new Set());
  const [priorityFlashOrderIds, setPriorityFlashOrderIds] = useState<Set<string>>(() => new Set());

  const holdPriorityMovement = (orderId: string) => {
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

  const flashPriorityRow = (orderId: string) => {
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

  const handlePrioritizeOrder = async (orderId: string): Promise<void> => {
    holdPriorityMovement(orderId);

    try {
      await onPriorityFlag?.([orderId], true);
      flashPriorityRow(orderId);
    } catch (error) {
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

  const handlePrioritizeGroup = async (
    groupKey: string,
    orderIds: string[]
  ): Promise<void> => {
    if (!onPriorityFlag || orderIds.length === 0) return;

    orderIds.forEach(holdPriorityMovement);
    setBulkPriorityPendingGroupKey(groupKey);
    setBulkPriorityErrorGroupKey(null);

    try {
      await onPriorityFlag(orderIds, true);
      orderIds.forEach(flashPriorityRow);
      setBulkPriorityConfirmGroupKey(null);
      setBulkPriorityConfirmedGroupKey(groupKey);

      window.setTimeout(() => {
        setBulkPriorityConfirmedGroupKey(prev =>
          prev === groupKey ? null : prev
        );
      }, 2000);
    } catch {
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
    } finally {
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
  const stillNeedsDecision = (order: (typeof allAgingOrders)[number]): boolean =>
    !order.isPriorityFlagged ||
    movementHeldOrderIds.has(order.lasyncro_order_id);

  // Unconstrained orders already moving in a pick batch have no decision here.
  const allBreachedOrders = allAgingOrders.filter(o => o.isShippingSlaBreached);
  const criticalOrders = allBreachedOrders.filter(
    o =>
      stillNeedsDecision(o) &&
      (o.constraintType !== null || !o.inPickBatch)
  );

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
      orders: criticalOrders.filter(
        o =>
          o.constraintType !== null &&
          o.constraintType !== 'customer' &&
          o.constraintType !== 'inventory'
      ),
    },
    {
      key: 'sla',
      label: 'Shipping SLA breached',
      orders: criticalOrders.filter(o => o.constraintType === null),
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
  const watchOrders = allAgingOrders.filter(
    o => !o.isShippingSlaBreached && stillNeedsDecision(o)
  );

  const visibleWatchOrders    = watchOrders.slice(0, TRIAGE_PREVIEW_LIMIT);
  const hiddenWatchOrders     = watchOrders.slice(TRIAGE_PREVIEW_LIMIT);
  const prioritizedCriticalCount = criticalOrders.filter(o => o.isPriorityFlagged).length;
  const unprioritizedCriticalCount = Math.max(criticalOrders.length - prioritizedCriticalCount, 0);
  const pulseRows = [
    { label: 'Breached', n: slaBreachedCount, color: STAGE_COLORS.breached },
    { label: 'Picking',  n: qPicking, color: STAGE_COLORS.picking },
    { label: 'Fulfillable', n: qReady, color: STAGE_COLORS.ready },
    { label: 'Blocked',  n: constrained, color: STAGE_COLORS.blocked },
  ];

  const pulseMax = Math.max(...pulseRows.map(row => row.n), 1);

  // FIX (2026-07-01): default branch fired identically for "operational
  // constraint, unspecified type" AND "no constraint at all, just aging"
  // — the second case is exactly every Watch-band order, which have zero
  // constraint type by definition. Confirmed live: Watch rows showed
  // "SLA breach · Xd past aging" on orders that were explicitly NOT
  // SLA-breached (isShippingSlaBreached: false). Now takes the real
  // breach flag so it can tell the two apart honestly.
  const constraintLabel = (type: string | null, isBreached: boolean): string => {
    switch (type) {
      case 'inventory': return 'Out of stock';
      case 'customer':  return 'Address issue';
      case 'operational': return 'Pick exception';
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
    { key: 'ready',          label: 'Fulfillable',    count: qReady      },
    { key: 'picking',        label: 'Picking',        count: qPicking    },
    { key: 'blocked',        label: 'Blocked',        count: constrained },
    // DC-03: keeps the aging bucket — a pipeline age band sits naturally beside
    // Ready/Picking/Blocked — but stops calling it a breach. Key unchanged;
    // renaming it needs a sweep of consumers.
    { key: 'breached',       label: 'Aging 3d+',      count: aging72     },
    { key: 'awaiting_stock', label: 'Awaiting stock', count: operatorSummary?.constraintCounts?.inventory ?? 0 },
    { key: 'awaiting_reply', label: 'Awaiting reply', count: operatorSummary?.constraintCounts?.customer  ?? 0 },
  ];
  const accountedFor = stageData.reduce((s, d) => s + d.count, 0);
  const newCount     = Math.max(0, totalOrders - accountedFor);
  const allStages    = [{ key: 'new', label: 'New', count: newCount }, ...stageData];
  const stageTotal   = allStages.reduce((s, d) => s + d.count, 0) || 1;

  return (
    <Box sx={{ p: '24px 40px', minHeight: '100%', bgcolor: 'var(--bg)' }}>

      {/* ── HEADER ────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#4CAF7A', flexShrink: 0 }} />
            <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              {dayLabel} · Channels live · {syncLabel}
            </Typography>
          </Box>
          <Typography sx={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }}>
            Orders
          </Typography>

          <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
            {constrained > 0
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
                  ? `${watchOrders.length} order${watchOrders.length === 1 ? '' : 's'} aging · review soon`
                  : 'All orders on track — nothing needs immediate action'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
          {onExport && (
            <Box
              onClick={onExport}
              sx={{ display: 'inline-flex', alignItems: 'center', px: '12px', py: '6px', fontSize: 12, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent-border)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
            >
              Export →
            </Box>
          )}

        </Box>
      </Box>

      {/* ── TRIAGE-FIRST GRID ─────────────────────────────────── */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, flexWrap: { xs: 'nowrap', lg: 'wrap' }, gap: 2.25, alignItems: 'stretch' }}>

        {/* ── LEFT: Needs a decision ──────────────────────────── */}
        <Box sx={{ flex: { xs: '1 1 auto', lg: '1 1 0' }, minWidth: 0, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }}>

          {/* Card header */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', p: '16px 20px 14px', borderBottom: '1px solid var(--rule)' }}>
            <Box>
              <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', mb: 0.375 }}>
                Needs a decision
              </Typography>
              <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                Ranked by commercial consequence
              </Typography>
            </Box>
            <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }}>
              {syncLabel}
            </Typography>
          </Box>

          {/* Critical band */}
          {criticalOrders.length > 0 ? (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1, bgcolor: 'rgba(229,72,77,0.07)' }}>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#E5484D', flexShrink: 0 }} />
                <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#F2555A' }}>
                  Critical — act today
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                  {criticalOrders.length} orders · {criticalGroups.length} {criticalGroups.length === 1 ? 'issue' : 'issues'}
                </Typography>
              </Box>

              {criticalGroups.map(group => {
                const expanded = expandedCriticalGroupKeys.has(group.key);
                const bulkPriorityOrderIds =
                  group.key === 'sla'
                    ? group.orders
                        .filter(order => !order.isPriorityFlagged)
                        .map(order => order.lasyncro_order_id)
                    : [];
                const bulkPriorityPending =
                  bulkPriorityPendingGroupKey === group.key;
                const bulkPriorityConfirmed =
                  bulkPriorityConfirmedGroupKey === group.key;

                return (
                  <Box key={group.key}>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0,1fr) 90px 118px',
                        gap: 1.75,
                        alignItems: 'center',
                        px: 2.5,
                        py: 1.75,
                        borderTop: '1px solid var(--rule)',
                      }}
                    >
                      <Box
                        component="button"
                        type="button"
                        onClick={() => toggleCriticalGroup(group.key)}
                        sx={{
                          display: 'block',
                          width: '100%',
                          p: 0,
                          border: 'none',
                          bgcolor: 'transparent',
                          color: 'inherit',
                          textAlign: 'left',
                          cursor: 'pointer',
                          '&:hover': { opacity: 0.8 },
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>
                            {group.label}
                          </Typography>
                          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </Box>
                        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)', mt: 0.375 }}>
                          {group.orders.length} {group.orders.length === 1 ? 'order' : 'orders'} · oldest {fmtSlaAge(group.oldestAgeHours)}
                        </Typography>
                      </Box>

                      <Box sx={{ textAlign: 'right' }}>
                        <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
                          {fmt$(group.revenue)}
                        </Typography>
                        <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }}>
                          at stake
                        </Typography>
                      </Box>

                      {group.key === 'sla' && !expanded ? (
                        <Box
                          component="button"
                          type="button"
                          disabled={
                            !onPriorityFlag ||
                            bulkPriorityPending ||
                            bulkPriorityConfirmed ||
                            bulkPriorityOrderIds.length === 0
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            if (
                              !onPriorityFlag ||
                              bulkPriorityPending ||
                              bulkPriorityConfirmed ||
                              bulkPriorityOrderIds.length === 0
                            ) return;

                            setBulkPriorityErrorGroupKey(null);
                            setBulkPriorityConfirmGroupKey(group.key);
                          }}
                          sx={{
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
                            cursor:
                              bulkPriorityPending || bulkPriorityConfirmed
                                ? 'default'
                                : 'pointer',
                            opacity: bulkPriorityPending ? 0.6 : 1,
                            '&:hover': {
                              opacity:
                                bulkPriorityPending || bulkPriorityConfirmed
                                  ? 1
                                  : 0.88,
                            },
                          }}
                        >
                          {bulkPriorityConfirmed
                            ? 'Prioritized ✓'
                            : bulkPriorityPending
                              ? 'Prioritizing…'
                              : 'Prioritize all…'}
                        </Box>
                      ) : (
                        <Box />
                      )}
                    </Box>

                    {group.key === 'sla' && expanded && (
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 2,
                          px: 2.5,
                          py: 1.25,
                          borderTop: '1px solid var(--rule)',
                          bgcolor: 'var(--accent-ghost)',
                        }}
                      >
                        <Box>
                          <Typography
                            sx={{
                              fontSize: 10,
                              fontWeight: 600,
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase',
                              color: 'var(--accent)',
                              mb: 0.25,
                            }}
                          >
                            Bulk action
                          </Typography>

                          <Typography
                            sx={{
                              fontSize: 12,
                              fontWeight: 300,
                              color: 'var(--ink-3)',
                            }}
                          >
                            Apply to all {bulkPriorityOrderIds.length}{' '}
                            {bulkPriorityOrderIds.length === 1
                              ? 'order'
                              : 'orders'}
                          </Typography>
                        </Box>

                        <Box
                          component="button"
                          type="button"
                          disabled={
                            !onPriorityFlag ||
                            bulkPriorityPending ||
                            bulkPriorityConfirmed ||
                            bulkPriorityOrderIds.length === 0
                          }
                          onClick={() => {
                            if (
                              !onPriorityFlag ||
                              bulkPriorityPending ||
                              bulkPriorityConfirmed ||
                              bulkPriorityOrderIds.length === 0
                            ) return;

                            setBulkPriorityErrorGroupKey(null);
                            setBulkPriorityConfirmGroupKey(group.key);
                          }}
                          sx={{
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
                            cursor:
                              bulkPriorityPending || bulkPriorityConfirmed
                                ? 'default'
                                : 'pointer',
                            opacity: bulkPriorityPending ? 0.6 : 1,
                            '&:hover': {
                              opacity:
                                bulkPriorityPending || bulkPriorityConfirmed
                                  ? 1
                                  : 0.88,
                            },
                          }}
                        >
                          {bulkPriorityConfirmed
                            ? 'Prioritized ✓'
                            : bulkPriorityPending
                              ? 'Prioritizing…'
                              : 'Prioritize all…'}
                        </Box>
                      </Box>
                    )}

                    {group.key === 'sla' && (
                      <Collapse
                        in={bulkPriorityConfirmGroupKey === group.key}
                        timeout={180}
                        unmountOnExit
                      >
                        <Box
                          sx={{
                            px: 2.5,
                            py: 1.5,
                            borderTop: '1px solid var(--rule)',
                            bgcolor: 'var(--accent-ghost)',
                          }}
                        >
                          <Typography
                            sx={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: 'var(--ink)',
                              mb: 0.375,
                            }}
                          >
                            Prioritize all {bulkPriorityOrderIds.length} orders?
                          </Typography>

                          <Typography
                            sx={{
                              fontSize: 12,
                              fontWeight: 300,
                              color: 'var(--ink-4)',
                              mb: 1.25,
                            }}
                          >
                            They will move to the top of the Order Flow pool
                            for the next release.
                          </Typography>

                          {bulkPriorityErrorGroupKey === group.key && (
                            <Typography
                              sx={{
                                fontSize: 11,
                                fontWeight: 500,
                                color: 'var(--critical-ink)',
                                mb: 1,
                              }}
                            >
                              Prioritization failed. Nothing was changed.
                            </Typography>
                          )}

                          <Box
                            sx={{
                              display: 'flex',
                              justifyContent: 'flex-end',
                              gap: 1,
                            }}
                          >
                            <Box
                              component="button"
                              type="button"
                              disabled={bulkPriorityPending}
                              onClick={() => {
                                setBulkPriorityConfirmGroupKey(null);
                                setBulkPriorityErrorGroupKey(null);
                              }}
                              sx={{
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
                              }}
                            >
                              Cancel
                            </Box>

                            <Box
                              component="button"
                              type="button"
                              disabled={
                                bulkPriorityPending ||
                                bulkPriorityOrderIds.length === 0
                              }
                              onClick={() =>
                                void handlePrioritizeGroup(
                                  group.key,
                                  bulkPriorityOrderIds
                                )
                              }
                              sx={{
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
                              }}
                            >
                              {bulkPriorityPending
                                ? 'Prioritizing…'
                                : 'Confirm priority'}
                            </Box>
                          </Box>
                        </Box>
                      </Collapse>
                    )}

                    <Collapse in={expanded} timeout={180} unmountOnExit>
                      {group.orders.map(order => (
                        <Box
                          key={order.lasyncro_order_id}
                          sx={{
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
                          }}
                        >
                          <Box
                            component="button"
                            type="button"
                            aria-label={`View order #${
                              order.externalOrderId
                                ? order.externalOrderId
                                : order.lasyncro_order_id.slice(0, 8).toUpperCase()
                            } details`}
                            onClick={() => onOrderClick?.(order.lasyncro_order_id)}
                            sx={{
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
                            }}
                          >
                            <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', mb: 0.375 }}>
                              {order.externalOrderId
                                ? `#${order.externalOrderId}`
                                : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, minWidth: 0 }}>
                              <Typography sx={{ fontSize: 11.5, fontWeight: 300, color: 'var(--ink-4)' }}>
                                {constraintLabel(order.constraintType, order.isShippingSlaBreached)} · {fmtSlaAge(order.ageHours)}
                              </Typography>
                              <Typography
                                sx={{
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
                                }}
                              >
                                View →
                              </Typography>
                            </Box>
                          </Box>

                          <Box sx={{ textAlign: 'right', alignSelf: 'end' }}>
                            <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                              {fmt$(order.revenue)}
                            </Typography>
                          </Box>

                          {order.constraintType === null ? (
                            <PrioritizeButton
                              isPriorityFlagged={order.isPriorityFlagged}
                              onPrioritize={() => handlePrioritizeOrder(order.lasyncro_order_id)}
                            />
                          ) : (
                            <Box />
                          )}
                        </Box>
                      ))}
                    </Collapse>
                  </Box>
                );
              })}
            </>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1, bgcolor: 'rgba(76,175,122,0.06)' }}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#4CAF7A', flexShrink: 0 }} />
              <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#4CAF7A' }}>
                All clear — no critical items
              </Typography>
            </Box>
          )}

          {/* Watch band */}
            {watchOrders.length > 0 && (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1, bgcolor: 'rgba(217,162,59,0.06)', borderTop: '1px solid var(--rule)' }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#D9A23B', flexShrink: 0 }} />
                  <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#D9A23B' }}>
                    Watch
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>{watchOrders.length} items</Typography>
                </Box>

                {visibleWatchOrders.map(order => (
                  <Box
                    key={order.lasyncro_order_id}
                    sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 118px', gap: 1.75, alignItems: 'center', px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)' }}
                  >
                    <Box>
                      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', mb: 0.375 }}>
                        {order.externalOrderId ? `#${order.externalOrderId}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                      </Typography>
                      <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                        {constraintLabel(order.constraintType, order.isShippingSlaBreached)} · {fmtSlaAge(order.ageHours)} aging
                      </Typography>
                    </Box>
                    <Box
                      component="button"
                      onClick={() => onOrderClick?.(order.lasyncro_order_id)}
                      sx={{ display: 'inline-flex', alignItems: 'center',justifyContent: 'flex-end', px: 0, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: 'none', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
                    >
                      View →
                    </Box>
                  </Box>
                ))}

                {hiddenWatchOrders.length > 0 && (
                  <>
                    <Collapse in={watchExpanded} timeout={180} unmountOnExit>
                      {hiddenWatchOrders.map(order => (
                        <Box
                          key={order.lasyncro_order_id}
                          sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 118px', gap: 1.75, alignItems: 'center', px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)' }}
                        >
                          <Box>
                            <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', mb: 0.375 }}>
                              {order.externalOrderId ? `#${order.externalOrderId}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                            </Typography>
                            <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                              {constraintLabel(order.constraintType, order.isShippingSlaBreached)} · {fmtSlaAge(order.ageHours)} aging
                            </Typography>
                          </Box>
                          <Box
                            component="button"
                            onClick={() => onOrderClick?.(order.lasyncro_order_id)}
                            sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', px: 0, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: 'none', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
                          >
                            View →
                          </Box>
                        </Box>
                      ))}
                    </Collapse>

                    <Box
                      onClick={() => setWatchExpanded(v => !v)}
                      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: 2.5, py: 1.125, borderTop: '1px solid var(--rule)', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }}
                    >
                      <Typography sx={{ fontSize: 11, fontWeight: 500 }}>
                        {watchExpanded ? 'Show less' : `See ${hiddenWatchOrders.length} more`}
                      </Typography>
                      {watchExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </Box>
                  </>
                )}
              </>
            )}
          {/* Footer */}
          <Box sx={{ px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)' }}>
            <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
              {constrained === 0 && watchOrders.length === 0 ? 'Everything else is on track · ' : ''}
              {/* DC-02a (2026-08-15): "shipped today" was false. orders.fulfilled
                  is queue.metrics.ts fulfilledOrders, bounded only by
                  order_created_at <= snapshotCutoff — an upper bound, so the
                  figure is cumulative, not daily. Shop 15 read 23 while nothing
                  had shipped since 20 Jun. A correctly day-scoped count exists
                  (wms.controller.ts:4664, shipped_at::date = CURRENT_DATE) but
                  is not plumbed to this module; rewiring is DC-02c. */}
              {fmtN(props.orders?.fulfilled)} fulfilled to date · {syncLabel}
            </Typography>
          </Box>
        </Box>

      {/* ── RIGHT: Today's pulse — PULSE-01 ───────────────────── */}
        <Box sx={{ flex: { xs: '1 0 300px', lg: '0 0 300px' }, minWidth: 0 }}>
          <PulseCard
            title="Today's pulse"
            headline={{
              value: `${fmtN(slaBreachedCount)} breached`,
              tone: slaBreachedCount > 0 ? 'critical' : 'good',
              colorOverride: slaBreachedCount > 0 ? STAGE_COLORS.breached : 'var(--ink)',
              subtext: unprioritizedCriticalCount > 0
                ? `${unprioritizedCriticalCount} still need priority`
                : 'Critical queue is under control',
            }}
            rows={[
              { id: 'breached', label: 'Breached', value: slaBreachedCount, tone: 'critical', colorOverride: STAGE_COLORS.breached, progress: { value: slaBreachedCount, max: pulseMax } },
              { id: 'blocked', label: 'Blocked', value: constrained, tone: 'warning', colorOverride: STAGE_COLORS.blocked, progress: { value: constrained, max: pulseMax } },
              { id: 'picking', label: 'Picking', value: qPicking, tone: 'neutral', colorOverride: STAGE_COLORS.picking, progress: { value: qPicking, max: pulseMax } },
              { id: 'ready', label: 'Fulfillable', value: qReady, tone: 'good', colorOverride: STAGE_COLORS.ready, progress: { value: qReady, max: pulseMax } },
            ]}
            footerNote={
              <>
                {/* DC-02a/b: both figures are cumulative, not daily. fulfilled is
                    an upper-bounded count (see above); revenue.earned is
                    realized_revenue, summed with the same <= snapshotCutoff bound
                    and no day scoping. Rendered inside a card titled "Today's
                    pulse", they read as daily and contradicted the truthful
                    "Revenue today $0" and "Value shipped this week $0.00" on
                    adjacent screens. The numbers were always right; the words
                    were not. */}
                <Box component="span" sx={{ fontWeight: 600, color: 'var(--ink)' }}>{fmtN(props.orders?.fulfilled)}</Box>
                {' fulfilled to date · '}
                <Box component="span" sx={{ fontWeight: 600, color: 'var(--ink)' }}>{fmt$(revenue?.earned)}</Box>
                {' collected to date'}
              </>
            }
            footerCta={{ label: 'View order flow', onClick: () => navigate('/orders/flow') }}
          />
        </Box>
      </Box>
    </Box>
  );
}
