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
import { formatCurrencyCompact, ReorderTransitionList } from '@lasyncro/shared/ui';
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
  const [criticalExpanded, setCriticalExpanded] = useState(false);
  const [watchExpanded, setWatchExpanded] = useState(false);
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
  const hiddenCriticalOrders  = criticalOrders.slice(TRIAGE_PREVIEW_LIMIT);
  const visibleWatchOrders    = watchOrders.slice(0, TRIAGE_PREVIEW_LIMIT);
  const hiddenWatchOrders     = watchOrders.slice(TRIAGE_PREVIEW_LIMIT);
  const prioritizedCriticalCount = criticalOrders.filter(o => o.isPriorityFlagged).length;
  const unprioritizedCriticalCount = Math.max(criticalOrders.length - prioritizedCriticalCount, 0);
  const pulseRows = [
    { label: 'Breached', n: aging72, color: STAGE_COLORS.breached },
    { label: 'Picking',  n: qPicking, color: STAGE_COLORS.picking },
    { label: 'Ready',    n: qReady, color: STAGE_COLORS.ready },
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
    { key: 'ready',          label: 'Ready',          count: qReady      },
    { key: 'picking',        label: 'Picking',        count: qPicking    },
    { key: 'blocked',        label: 'Blocked',        count: constrained },
    { key: 'breached',       label: 'Breached',       count: aging72     },
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
                  ? `${watchOrders.length} order${watchOrders.length === 1 ? '' : 's'} aging, approaching SLA`
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
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.25, alignItems: 'start' }}>

        {/* ── LEFT: Needs a decision ──────────────────────────── */}
        <Box sx={{ flex: '1 0 300px', minWidth: 0, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }}>

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
                <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>{criticalOrders.length} items</Typography>
              </Box>
              <ReorderTransitionList
                items={visibleCriticalOrders}
                getKey={(order) => order.lasyncro_order_id}
                durationMs={520}
                renderItem={(order) => (
                <Box
                  key={order.lasyncro_order_id}
                  sx={{
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
                  }}
                >
                  <Box>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', mb: 0.375 }}>
                      {order.externalOrderId ? `#${order.externalOrderId}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                    </Typography>
                    <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                      {constraintLabel(order.constraintType, order.isShippingSlaBreached)} · {fmtSlaAge(order.ageHours)}
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
                      {fmt$(order.revenue)}
                    </Typography>
                    <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }}>
                      at stake
                    </Typography>
                  </Box>
                    {order.constraintType !== null ? (
                      <Box
                        component="button"
                        onClick={() => onOrderClick?.(order.lasyncro_order_id)}
                        sx={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)', bgcolor: 'var(--accent)', border: 'none', borderRadius: '6px', py: 1, textAlign: 'center', cursor: 'pointer', '&:hover': { opacity: 0.88 } }}
                      >
                        Review queue
                      </Box>
                    ) : order.inPickBatch ? (
                      <Box
                        sx={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--ink-3)',
                          bgcolor: 'var(--bg-3)',
                          border: '0.5px solid var(--rule)',
                          borderRadius: '6px',
                          py: 1,
                          textAlign: 'center',
                        }}
                      >
                        In batch
                      </Box>
                    ) : (
                      <PrioritizeButton
                        isPriorityFlagged={order.isPriorityFlagged}
                        onPrioritize={() => handlePrioritizeOrder(order.lasyncro_order_id)}
                      />
                    )}
                </Box>
                  )}
                />
              {hiddenCriticalOrders.length > 0 && (
                <>
                  <Collapse in={criticalExpanded} timeout={180} unmountOnExit>
                    <ReorderTransitionList
                      items={hiddenCriticalOrders}
                      getKey={(order) => order.lasyncro_order_id}
                      durationMs={520}
                      renderItem={(order) => (
                      <Box
                        key={order.lasyncro_order_id}
                        sx={{
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
                        }}
                      >
                        <Box>
                          <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', mb: 0.375 }}>
                            {order.externalOrderId ? `#${order.externalOrderId}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                          </Typography>
                          <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                            {constraintLabel(order.constraintType, order.isShippingSlaBreached)} · {fmtSlaAge(order.ageHours)}
                          </Typography>
                        </Box>
                        <Box sx={{ textAlign: 'right' }}>
                          <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
                            {fmt$(order.revenue)}
                          </Typography>
                          <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }}>
                            at stake
                          </Typography>
                        </Box>
                                                  {order.constraintType !== null ? (
                            <Box
                              component="button"
                              onClick={() => onOrderClick?.(order.lasyncro_order_id)}
                              sx={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)', bgcolor: 'var(--accent)', border: 'none', borderRadius: '6px', py: 1, textAlign: 'center', cursor: 'pointer', '&:hover': { opacity: 0.88 } }}
                            >
                              Review queue
                            </Box>
                          ) : order.inPickBatch ? (
                            <Box
                              sx={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: 'var(--ink-3)',
                                bgcolor: 'var(--bg-3)',
                                border: '0.5px solid var(--rule)',
                                borderRadius: '6px',
                                py: 1,
                                textAlign: 'center',
                              }}
                            >
                              In batch
                            </Box>
                          ) : (
                            <PrioritizeButton
                              isPriorityFlagged={order.isPriorityFlagged}
                              onPrioritize={() => handlePrioritizeOrder(order.lasyncro_order_id)}
                            />
                          )}
                      </Box>
                      )}
                    />
                  </Collapse>

                  <Box
                    onClick={() => setCriticalExpanded(v => !v)}
                    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: 2.5, py: 1.125, borderTop: '1px solid var(--rule)', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }}
                  >
                    <Typography sx={{ fontSize: 11, fontWeight: 500 }}>
                      {criticalExpanded ? 'Show less' : `See ${hiddenCriticalOrders.length} more`}
                    </Typography>
                    {criticalExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </Box>
                </>
              )}
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
                      sx={{ display: 'inline-flex', alignItems: 'center',justifyContent: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
                    >
                      View order →
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
                            sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
                          >
                            View order →
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
              {fmtN(props.orders?.fulfilled)} shipped today · {syncLabel}
            </Typography>
          </Box>
        </Box>

                {/* ── RIGHT: Today's pulse ───────────────────────────── */}
        <Box sx={{ flex: '0 0 300px' }}>
          <Box
            sx={{
              bgcolor: 'var(--surface)',
              border: '1px solid var(--rule)',
              borderRadius: '14px',
              p: '18px 20px',
            }}
          >
            <Typography
              sx={{
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--ink-4)',
                mb: 1,
              }}
            >
              Today&apos;s pulse
            </Typography>

            <Typography
              sx={{
                fontSize: 24,
                fontWeight: 700,
                color: aging72 > 0 ? STAGE_COLORS.breached : 'var(--ink)',
                lineHeight: 1.1,
              }}
            >
              {fmtN(aging72)} breached
            </Typography>

            <Typography
              sx={{
                fontSize: 12,
                fontWeight: 300,
                color: 'var(--ink-4)',
                mt: 0.5,
                mb: 2,
              }}
            >
              {unprioritizedCriticalCount > 0
                ? `${unprioritizedCriticalCount} still need priority`
                : 'Critical queue is under control'}
            </Typography>

            <Box sx={{ display: 'grid', gap: 1.15 }}>
              {pulseRows.map(row => (
                <Box key={row.label}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      mb: 0.5,
                    }}
                  >
                    <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-3)' }}>
                      {row.label}
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                      {fmtN(row.n)}
                    </Typography>
                  </Box>

                  <Box
                    sx={{
                      height: 5,
                      borderRadius: '999px',
                      overflow: 'hidden',
                      bgcolor: 'rgba(255,255,255,0.06)',
                    }}
                  >
                    <Box
                      sx={{
                        width: `${Math.max((row.n / pulseMax) * 100, row.n > 0 ? 8 : 0)}%`,
                        height: '100%',
                        borderRadius: '999px',
                        bgcolor: row.color,
                      }}
                    />
                  </Box>
                </Box>
              ))}
            </Box>

            <Box sx={{ borderTop: '1px solid var(--rule)', mt: 2, pt: 1.5 }}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-4)' }}>
                <Box component="span" sx={{ fontWeight: 600, color: 'var(--ink)' }}>
                  {fmtN(props.orders?.fulfilled)}
                </Box>
                {' shipped today · '}
                <Box component="span" sx={{ fontWeight: 600, color: 'var(--ink)' }}>
                  {fmt$(revenue?.earned)}
                </Box>
                {' collected'}
              </Typography>
            </Box>

            <Box
              onClick={() => navigate('/orders/flow')}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                mt: 1.5,
                px: 1.25,
                py: 0.5,
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--accent)',
                bgcolor: 'transparent',
                border: '0.5px solid var(--accent)',
                borderRadius: '6px',
                cursor: 'pointer',
                '&:hover': { opacity: 0.75 },
              }}
            >
              View order flow →
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
