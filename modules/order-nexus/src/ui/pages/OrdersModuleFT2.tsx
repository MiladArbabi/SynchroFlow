// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx
//
// ORDERS MODULE — FT2 OPERATOR SURFACE
// Sprint 3 redesign · May 2026
// ─────────────────────────────────────────────────────────────
// Layout:
//   1. Header      — DM Sans compact + live data signal line
//   2. Alert       — blocked revenue banner (conditional)
//   3. Context     — LEFT: Pulse 2×2 + aging | RIGHT: Money 2×2 + stage bar
//   4. Action Queue — checkbox select → priority bar → Release Queue
//
// RULES:
// - No hardcoded hex. CSS variables or theme.palette.* only.
//   Exception: STAGE_COLORS — domain tokens, no design-system equivalent yet.
// - No inline style={}. MUI sx prop only.
// - No cross-module imports.
// - No fetching. All data via props.

import { useState, useCallback } from 'react';
import { Box, Typography, Checkbox, useTheme } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import { AlertTriangle, Clock, MapPin, Package, ArrowUp } from 'lucide-react';
import type { FT2TemporalProps } from '@lasyncro/ui-ft2';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
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

  onOrderSelect?: (orderId: string) => void;

  /**
   * onPriorityFlag
   * --------------
   * Wired at page level via POST /api/v1/wms/orders/:orderId/priority.
   * Called with the array of selected lasyncro_order_ids.
   * On resolution, this component clears selection and navigates to /orders/pool.
   */
  onPriorityFlag?: (orderIds: string[], flagged: boolean) => Promise<void>;

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

const fmtN = (n: number | null | undefined): string =>
  n == null ? '—' : Math.round(n).toLocaleString();

/**
 * fmtSlaAge
 * ---------
 * Converts raw hours to operator-readable SLA age.
 * 1271 → "53d 1h past"  |  5 → "5h past"  |  48 → "2d past"
 */
const fmtSlaAge = (hours: number): string => {
  const h = Math.round(hours);
  const d = Math.floor(h / 24);
  const rem = h % 24;
  if (d === 0) return `${rem}h past`;
  if (rem === 0) return `${d}d past`;
  return `${d}d ${rem}h past`;
};

// ─── STAGE COLORS ─────────────────────────────────────────────
// Domain-specific pipeline stage colors.
// No design-system token equivalent yet — tracked in B-08.
// When @lasyncro/ui-ft2 adds stage tokens, migrate here.
const STAGE_COLORS: Record<string, string> = {
  new:            '#9CA3AF',
  ready:          '#10B981',
  picking:        '#14B8A6',
  packed:         '#3B82F6',
  blocked:        '#F97316',
  breached:       '#EF4444',
  awaiting_reply: '#F59E0B',
  awaiting_stock: '#EAB308',
};

// ─── CONSTRAINT TAG ───────────────────────────────────────────
// Semantic pill replacing the old HoldDot + text pattern.
// Uses theme.palette — no hardcoded hex.

type ConstraintType = 'inventory' | 'customer' | 'operational' | null | undefined;

function ConstraintTag({ type }: { type: ConstraintType }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const config = (() => {
    switch (type) {
      case 'inventory':
        return {
          label: 'Out of stock',
          Icon: Package,
          color: theme.palette.warning.main,
        };
      case 'customer':
        return {
          label: 'Address issue',
          Icon: MapPin,
          color: theme.palette.info.main,
        };
      default:
        return {
          label: 'Overdue',
          Icon: Clock,
          color: theme.palette.error.main,
        };
    }
  })();

  return (
    <Box sx={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 0.5,
      px: 1,
      py: 0.375,
      borderRadius: '20px',
      bgcolor: alpha(config.color, isDark ? 0.2 : 0.1),
      border: `0.5px solid ${alpha(config.color, 0.35)}`,
    }}>
      <config.Icon size={10} color={config.color} />
      <Typography sx={{ fontSize: 11, fontWeight: 500, color: config.color, lineHeight: 1 }}>
        {config.label}
      </Typography>
    </Box>
  );
}

// ─── SLA BADGE ────────────────────────────────────────────────

function SlaBadge({ hours }: { hours: number }) {
  const theme = useTheme();
  return (
    <Box sx={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 0.5,
      px: 1,
      py: 0.25,
      borderRadius: '4px',
      bgcolor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.18 : 0.08),
    }}>
      <Clock size={10} color={theme.palette.error.main} />
      <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.palette.error.main, fontVariantNumeric: 'tabular-nums' }}>
        {fmtSlaAge(hours)}
      </Typography>
    </Box>
  );
}

// ─── STAT CARD ────────────────────────────────────────────────

function StatCard({ label, value, valueColor, cta, ctaHref }: {
  label: string;
  value: string;
  valueColor?: string;
  cta?: string;
  ctaHref?: string;
}) {
  const navigate = useNavigate();
  return (
    <Box sx={{
      bgcolor: 'var(--bg-3)',
      border: '0.5px solid var(--rule)',
      borderRadius: '8px',
      p: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 0.5,
    }}>
      <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 24, fontWeight: 500, color: valueColor ?? 'var(--ink)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      {cta && ctaHref && (
        <Box
          onClick={() => navigate(ctaHref)}
          sx={{ display: 'inline-flex', alignItems: 'center', px: 1, py: 0.375, fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', mt: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
        >
          {cta} →
        </Box>
      )}
    </Box>
  );
}

// ─── MONEY CARD ───────────────────────────────────────────────

function MoneyCard({ label, value, valueColor }: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <Box sx={{
      bgcolor: 'var(--bg-3)',
      border: '0.5px solid var(--rule)',
      borderRadius: '8px',
      p: '12px 14px',
    }}>
      <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.75 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 18, fontWeight: 500, color: valueColor ?? 'var(--ink)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {value}
      </Typography>
    </Box>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────

export default function OrdersModuleFT2(props: OrdersModuleFT2DataProps) {
  const theme = useTheme();
  const navigate = useNavigate();
  const { operationalControl, revenue, operatorSummary, currency, onPriorityFlag } = props;

  const fmt$ = (n: number | null | undefined): string =>
    formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  // ── Selection state ─────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPrioritising, setIsPrioritising] = useState(false);
  const [prioritisedCount, setPrioritisedCount] = useState<number | null>(null);

  // ── Derived counts ──────────────────────────────────────────
  const qReady      = operatorSummary?.queueCounts?.readyToShip ?? operationalControl?.queue_ready_to_ship ?? 0;
  const qPicking    = operationalControl?.pending_fulfillment ?? 0;
  const constrained = operationalControl?.constrained_orders ?? 0;
  const aging72     = operationalControl?.aging_72h_plus ?? 0;
  const aging48     = operationalControl?.aging_48h ?? 0;
  const aging24     = operationalControl?.aging_24h ?? 0;
  const totalOrders = props.orders?.total ?? 0;
  const blockedRevenue = operationalControl?.blocked_revenue ?? 0;
  const leakage = operationalControl?.revenue_leakage ?? 0;

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

  // ── Action queue ────────────────────────────────────────────
  const actionQueueOrders = [...(operatorSummary?.agingOrders ?? [])]
    .sort((a, b) => b.ageHours - a.ageHours)
    .slice(0, 5);

  // Revenue now carried directly on agingOrders — no cross-array lookup needed

  // ── Stage bar ───────────────────────────────────────────────
  const stageData = [
    { key: 'ready',          label: 'Ready pick',     count: qReady      },
    { key: 'picking',        label: 'Picking',        count: qPicking    },
    { key: 'blocked',        label: 'Blocked',        count: constrained },
    { key: 'breached',       label: 'Breached',       count: aging72     },
    { key: 'awaiting_stock', label: 'Awaiting stock', count: operatorSummary?.constraintCounts?.inventory ?? 0 },
    { key: 'awaiting_reply', label: 'Awaiting reply', count: operatorSummary?.constraintCounts?.customer  ?? 0 },
  ];
  const accountedFor = stageData.reduce((s, d) => s + d.count, 0);
  const newCount = Math.max(0, totalOrders - accountedFor);
  const allStages = [{ key: 'new', label: 'New', count: newCount }, ...stageData];
  const stageTotal = allStages.reduce((s, d) => s + d.count, 0) || 1;

  // ── Handlers ────────────────────────────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Only unconstrained orders can be prioritised — blocked orders go to /orders/blocked
  const poolEligibleOrders = actionQueueOrders.filter(o => o.constraintType === null);

  const toggleAll = useCallback(() => {
    setSelected(prev =>
      prev.size === poolEligibleOrders.length && poolEligibleOrders.length > 0
        ? new Set()
        : new Set(poolEligibleOrders.map(o => o.lasyncro_order_id))
    );
  }, [poolEligibleOrders]);

  const handlePrioritise = useCallback(async () => {
    if (!onPriorityFlag || selected.size === 0) return;
    setIsPrioritising(true);
    try {
      await onPriorityFlag([...selected], true);
      const n = selected.size;
      setSelected(new Set());
      setPrioritisedCount(n);
      // Brief confirmation window, then navigate to the pool
      setTimeout(() => {
        navigate('/orders/pool');
        setPrioritisedCount(null);
      }, 1200);
    } finally {
      setIsPrioritising(false);
    }
  }, [onPriorityFlag, selected, navigate]);

  // ── Shared styles ────────────────────────────────────────────
  const cardSx = {
    bgcolor: 'var(--surface)',
    border: '0.5px solid var(--rule)',
    borderRadius: '10px',
    overflow: 'hidden',
  };

  const oldestHours = operatorSummary?.agingOrders?.[0]?.ageHours ?? null;

  return (
    <Box sx={{ p: '24px 40px', minHeight: '100%', bgcolor: 'var(--bg)' }}>

      {/* ── 1. HEADER ─────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2.5 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: theme.palette.success.main, flexShrink: 0 }} />
            <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              {dayLabel} · Channels live · {syncLabel}
            </Typography>
          </Box>
          <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2, mb: 0.25 }}>
            Orders
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
            {constrained > 0
              ? `${constrained} need a decision · ${fmt$(blockedRevenue)} blocked · ${qPicking} in pick & pack`
              : 'All orders on track — nothing needs immediate action'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
          <Box
            sx={{
              px: 1.5, py: 0.625, borderRadius: '8px',
              border: '0.5px solid var(--rule)',
              bgcolor: 'var(--surface)',
              cursor: 'pointer', fontSize: 12, color: 'var(--ink-3)',
              '&:hover': { borderColor: 'var(--ink-3)' },
            }}
          >
            Export
          </Box>
          <Box
            onClick={() => navigate('/orders/blocked')}
            sx={{
              px: 1.5, py: 0.625, borderRadius: '8px',
              bgcolor: 'var(--accent)', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, color: theme.palette.common.white,
              '&:hover': { opacity: 0.88 },
            }}
          >
            Resolve all →
          </Box>
        </Box>
      </Box>

      {/* ── 2. ALERT BANNER ───────────────────────────────────── */}
      {blockedRevenue > 0 && (
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 2, px: 2, py: 1.25, mb: 3,
          bgcolor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.18 : 0.06),
          border: `0.5px solid ${alpha(theme.palette.error.main, 0.3)}`,
          borderRadius: '10px',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <AlertTriangle size={15} color={theme.palette.error.main} />
            <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>
              <Box component="span" sx={{ fontWeight: 600 }}>{fmt$(blockedRevenue)}</Box>
              {' '}of revenue held across{' '}
              <Box component="span" sx={{ fontWeight: 600 }}>{constrained} orders</Box>
              {oldestHours != null && `. Oldest is ${fmtSlaAge(oldestHours)} — every hour is a refund risk.`}
            </Typography>
          </Box>
          <Box
            onClick={() => navigate('/fulfillment?filter=blocked')}
            sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 12, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', '&:hover': { opacity: 0.88 } }}
          >
            Review queue →
          </Box>
        </Box>
      )}

      {/* ── 3. CONTEXT ZONE — 2 columns ───────────────────────── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>

        {/* LEFT: Operation Pulse */}
        <Box sx={{ ...cardSx, p: 2, height: '100%' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              Operation pulse
            </Typography>
            <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              Today · {fmtN(totalOrders)} total
            </Typography>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 2 }}>
            <StatCard
              label="Ready to ship"
              value={fmtN(qReady)}
              valueColor={qReady > 0 ? theme.palette.success.main : undefined}
              cta="Fulfillment queue"
              ctaHref="/fulfillment"
            />
            <StatCard
              label="Picking & packing"
              value={fmtN(qPicking)}
              cta="In progress"
              ctaHref="/fulfillment"
            />
            <StatCard
              label="Blocked"
              value={fmtN(constrained)}
              valueColor={constrained > 0 ? 'var(--accent)' : undefined}
              cta="Blocked orders"
              ctaHref="/orders/blocked"
            />
            <StatCard
              label="SLA breached 72h+"
              value={fmtN(aging72)}
              valueColor={aging72 > 0 ? theme.palette.error.main : undefined}
              cta="Urgent"
              ctaHref="/fulfillment?filter=urgent"
            />
          </Box>

          {/* Aging band */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 1.5, borderTop: '0.5px solid var(--rule)' }}>
            <Box sx={{ display: 'flex', gap: 2 }}>
              {[
                { count: aging24, label: '24h+',          color: theme.palette.warning.light },
                { count: aging48, label: '48h+',          color: theme.palette.warning.main  },
                { count: aging72, label: '72h+ breached', color: theme.palette.error.main    },
              ].map(({ count, label, color }) => (
                <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color }} />
                  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                    {fmtN(count)} {label}
                  </Typography>
                </Box>
              ))}
            </Box>
            <Typography sx={{ fontSize: 10, color: 'var(--ink-4)' }}>
              {fmtN(props.orders?.fulfilled)} shipped · {fmt$(revenue?.earned)} collected
            </Typography>
          </Box>
        </Box>

        {/* RIGHT: Money + Stage */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <MoneyCard label="Total order value"    value={fmt$(revenue?.totalSales)} />
            <MoneyCard label="Collected — shipped"  value={fmt$(revenue?.earned)}    valueColor={theme.palette.success.main} />
            <MoneyCard label="Paid · not shipped"   value={fmt$(revenue?.pending)}   valueColor="var(--accent)" />
            <MoneyCard label="Blocked — held up"    value={fmt$(revenue?.blocked)}   valueColor={theme.palette.error.main} />
          </Box>

          {leakage > 0 && (
            <Typography sx={{ fontSize: 11, fontWeight: 500, color: theme.palette.error.main, px: 0.5 }}>
              {fmt$(leakage)} leaked to refunds this week · SLA misses · unrecoverable
            </Typography>
          )}

          {/* Stage bar */}
          <Box sx={{ ...cardSx, p: 2, height: '100%' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.25 }}>
              <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                Open orders by stage
              </Typography>
              <Typography sx={{ fontSize: 10, color: 'var(--ink-4)' }}>
                {fmtN(props.orders?.unfulfilled)} open
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', height: 6, borderRadius: '3px', overflow: 'hidden', mb: 1.5, bgcolor: 'var(--bg)' }}>
              {allStages.filter(s => s.count > 0).map(stage => (
                <Box
                  key={stage.key}
                  sx={{ width: `${(stage.count / stageTotal) * 100}%`, bgcolor: STAGE_COLORS[stage.key] ?? 'var(--ink-4)' }}
                />
              ))}
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
              {allStages.filter(s => s.count > 0).map(stage => (
                <Box key={stage.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.625 }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: STAGE_COLORS[stage.key] ?? 'var(--ink-4)', flexShrink: 0 }} />
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>{stage.label}</Typography>
                  <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{fmtN(stage.count)}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      </Box>

      {/* ── 4. ACTION QUEUE ───────────────────────────────────── */}

      {/* Section label row */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
            Action queue
          </Typography>
          {constrained > 0 && (
            <Box sx={{
              px: 1, py: 0.25, borderRadius: '20px',
              bgcolor: alpha(theme.palette.error.main, 0.1),
              border: `0.5px solid ${alpha(theme.palette.error.main, 0.3)}`,
            }}>
              <Typography sx={{ fontSize: 11, fontWeight: 500, color: theme.palette.error.main }}>
                {constrained} urgent
              </Typography>
            </Box>
          )}
        </Box>
        {/* CTA-004: ghost pill — secondary nav action, intentionally lighter than primary filled CTAs */}
        <Box
          onClick={() => navigate('/orders')}
          sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
        >
          View all orders →
        </Box>
      </Box>

      {/* Priority confirmation */}
      {prioritisedCount != null && (
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1.5,
          px: 2, py: 1.25, mb: 2,
          bgcolor: alpha(theme.palette.success.main, 0.08),
          border: `0.5px solid ${alpha(theme.palette.success.main, 0.3)}`,
          borderRadius: '10px',
        }}>
          <ArrowUp size={15} color={theme.palette.success.main} />
          <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>
            <Box component="span" sx={{ fontWeight: 600 }}>
              {prioritisedCount} order{prioritisedCount !== 1 ? 's' : ''}
            </Box>
            {' '}flagged as priority — taking you to the Release Queue.
          </Typography>
        </Box>
      )}

      {/* Selection toolbar — visible when ≥1 order checked */}
      {selected.size > 0 && (
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          px: 2, py: 1.25, mb: 2,
          bgcolor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.15 : 0.06),
          border: `0.5px solid ${alpha(theme.palette.warning.main, 0.35)}`,
          borderRadius: '10px',
        }}>
          <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
            {selected.size} order{selected.size !== 1 ? 's' : ''} selected
          </Typography>
          <Box
            component="button"
            onClick={handlePrioritise}
            disabled={isPrioritising}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.75,
              px: 1.75, py: 0.75,
              bgcolor: isPrioritising ? 'var(--ink-4)' : 'var(--accent)',
              color: theme.palette.common.white,
              border: 'none', borderRadius: '8px',
              cursor: isPrioritising ? 'not-allowed' : 'pointer',
              fontSize: 12, fontWeight: 600,
              opacity: isPrioritising ? 0.7 : 1,
              transition: 'opacity 0.15s ease',
              '&:hover': { opacity: isPrioritising ? 0.7 : 0.88 },
            }}
          >
            <ArrowUp size={13} />
            {isPrioritising ? 'Prioritising…' : 'Prioritise in next batch →'}
          </Box>
        </Box>
      )}

      {/* Table */}
      <Box sx={{ ...cardSx }}>
        {/* Header row */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: '36px 1fr 160px 130px 80px 96px',
          px: 2, py: 1.25,
          bgcolor: 'var(--bg-2)',
          borderBottom: '0.5px solid var(--rule)',
          alignItems: 'center',
        }}>
          <Checkbox
            size="small" sx={{ p: 0 }}
            checked={selected.size === poolEligibleOrders.length && poolEligibleOrders.length > 0}
            indeterminate={selected.size > 0 && selected.size < poolEligibleOrders.length}
            onChange={toggleAll}
            disabled={poolEligibleOrders.length === 0}
          />
          {['Order · channel', 'Constraint', 'SLA', 'Value', ''].map((col, i) => (
            <Typography key={i} sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              {col}
            </Typography>
          ))}
        </Box>

        {/* Rows */}
        {actionQueueOrders.length === 0 ? (
          <Box sx={{ px: 2, py: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 13, color: 'var(--ink-4)' }}>No blocked orders — queue is clear.</Typography>
          </Box>
        ) : actionQueueOrders.map(order => {
          const isSelected = selected.has(order.lasyncro_order_id);
          return (
            <Box
              key={order.lasyncro_order_id}
              sx={{
                display: 'grid',
                gridTemplateColumns: '36px 1fr 160px 130px 80px 96px',
                alignItems: 'center',
                px: 2, py: 1.25,
                borderBottom: '0.5px solid var(--rule)',
                bgcolor: isSelected
                  ? alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.12 : 0.04)
                  : 'transparent',
                transition: 'background-color 0.12s ease',
                '&:last-child': { borderBottom: 'none' },
                '&:hover': { bgcolor: isSelected ? alpha(theme.palette.warning.main, 0.07) : 'var(--bg-2)' },
              }}
            >
              {order.constraintType === null ? (
                <Checkbox
                  size="small" sx={{ p: 0 }}
                  checked={isSelected}
                  onChange={() => toggleSelect(order.lasyncro_order_id)}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <Box sx={{ width: 36 }} />
              )}

              {/* Order ID + priority indicator */}
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                    {order.externalOrderId ? `#${order.externalOrderId}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                  </Typography>
                  {order.isPriorityFlagged && (
                    <Box sx={{
                      px: 0.75, py: 0.125,
                      bgcolor: alpha(theme.palette.error.main, 0.1),
                      border: `0.5px solid ${alpha(theme.palette.error.main, 0.3)}`,
                      borderRadius: '4px',
                    }}>
                      <Typography sx={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: theme.palette.error.main, textTransform: 'uppercase' }}>
                        Priority
                      </Typography>
                    </Box>
                  )}
                </Box>
                <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>Shopify</Typography>
              </Box>

              {/* Constraint tag */}
              <Box>
                <ConstraintTag type={order.constraintType as ConstraintType} />
              </Box>

              {/* SLA */}
              <Box>
                <SlaBadge hours={order.ageHours} />
              </Box>

              {/* Value */}
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
                {fmt$(order.revenue)}
              </Typography>

              {/* Resolve */}
              <Box
                onClick={() => navigate(
                  order.constraintType !== null
                    ? '/orders/blocked'
                    : `/fulfillment?order=${order.lasyncro_order_id}`
                )}
                sx={{
                  /* CTA-003: filled accent — matches Review › (Overview) and Receive → (Inbound) */
                  display: 'inline-flex', alignItems: 'center',
                  px: 1.25, py: 0.5,
                  fontSize: 11, fontWeight: 500,
                  bgcolor: 'var(--accent)', color: theme.palette.common.white,
                  border: 'none', borderRadius: '6px',
                  cursor: 'pointer',
                  '&:hover': { opacity: 0.88 },
                }}
              >
                {order.constraintType !== null ? 'Unblock →' : 'Resolve →'}
              </Box>
            </Box>
          );
        })}

        {/* Footer */}
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          px: 2, py: 1,
          bgcolor: 'var(--bg-2)',
          borderTop: '0.5px solid var(--rule)',
        }}>
          <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
            {qPicking > 0 ? `${fmtN(qPicking)} in pick & pack` : ''}
          </Typography>
          {blockedRevenue > 0 && (
            <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: theme.palette.error.main }}>
              {fmt$(blockedRevenue)} blocked across this queue
            </Typography>
          )}
        </Box>
      </Box>

    </Box>
  );
}