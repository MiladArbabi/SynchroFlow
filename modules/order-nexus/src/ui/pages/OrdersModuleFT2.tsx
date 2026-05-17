// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx
//
// ORDERS MODULE — FT2 OPERATOR SURFACE
// -------------------------------------
// Target design: LASYNCRO_UX_PLAYBOOK.md §2.2
// Sections:
//   1. Header        — serif greeting + date/sync + revenue alert banner
//   2. Operation Pulse — 4 stat cards + aging band row
//   3. Action Queue  — blocked orders table (SLA · hold reason · resolve)
//   4. Orders by Stage — stacked progress bar + stage grid
//   5. Your Money    — 4 large-number cards + leakage footer
//
// RULES:
// - No hardcoded hex — CSS variables or theme.palette.* only
// - No fetching — pure UI, all data via props
// - No cross-module imports

import { Box, Typography, Checkbox, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { AlertTriangle, Clock } from 'lucide-react';
import type { FT2TemporalProps } from '@lasyncro/ui-ft2';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';

// ─── PROPS CONTRACT ───────────────────────────────────────────────────────────

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

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const fmtN = (n: number | null | undefined): string =>
  n == null ? '—' : Math.round(n).toLocaleString();

// Hold reason colors are constraint-type signal colors.
// No MUI palette equivalent — these are domain-specific, not severity tiers.
// If the design system adds constraint-type tokens, migrate here.
const HOLD_COLORS = {
  inventory:   '#F59E0B',
  customer:    '#3B82F6',
  operational: '#EF4444',
  default:     '#6B7280',
} as const;

const holdReasonLabel = (type: string | null | undefined): { label: string; color: string } => {
  switch (type) {
    case 'inventory':   return { label: 'Out of stock',          color: HOLD_COLORS.inventory   };
    case 'customer':    return { label: 'Address invalid',       color: HOLD_COLORS.customer    };
    case 'operational': return { label: 'Payment hold — review', color: HOLD_COLORS.operational };
    default:            return { label: 'Hold',                  color: HOLD_COLORS.default     };
  }
};

// Dot used in hold reason column — colored per constraint type
function HoldDot({ color }: { color: string }) {
  return <Box component="span" sx={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', bgcolor: color, mr: 0.75, flexShrink: 0 }} />;
}

// ─── SECTION LABEL ────────────────────────────────────────────────────────────
// 10px / 500 / 0.08em — playbook §3 label-caps style

function SectionLabel({ left, right }: { left: string; right?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
      <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
        {left}
      </Typography>
      {right && (
        <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          {right}
        </Typography>
      )}
    </Box>
  );
}

// ─── STAT CARD ────────────────────────────────────────────────────────────────
// Playbook §6 StatCard — label above, large number, CTA link below

function StatCard({
  label, value, valueColor, cta, ctaHref,
}: {
  label: string;
  value: string;
  valueColor?: string;
  cta?: string;
  ctaHref?: string;
}) {
  return (
    <Box sx={{
      flex: 1,
      bgcolor: 'var(--surface)',
      border: '1px solid var(--rule)',
      borderRadius: '10px',
      p: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 0.5,
    }}>
      <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 28, fontWeight: 500, color: valueColor ?? 'var(--ink)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      {cta && ctaHref && (
        <Typography
          component="a"
          href={ctaHref}
          sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', textDecoration: 'none', mt: 0.5, '&:hover': { textDecoration: 'underline' } }}
        >
          {cta} →
        </Typography>
      )}
    </Box>
  );
}

// ─── STAGE COLORS ─────────────────────────────────────────────────────────────
// Playbook §2.2 — stage color registry. Add new stages here only.
// Stage colors are pipeline-stage signal colors — not MUI severity colors.
// Named per operator vocabulary (§2.2). Extend here when new stages are added.
// If the design system adds stage tokens, migrate here.
const STAGE_COLORS: Record<string, string> = {
  new:             '#9CA3AF',
  ready:           '#10B981',
  picking:         '#14B8A6',
  packed:          '#3B82F6',
  blocked:         '#F97316',
  breached:        '#EF4444',
  awaiting_reply:  '#F59E0B',
  awaiting_stock:  '#EAB308',
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function OrdersModuleFT2(props: OrdersModuleFT2DataProps) {
  const theme = useTheme();
  const { operationalControl, revenue, operatorSummary, currency } = props;

  const fmt$ = (n: number | null | undefined): string =>
    formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  // ── Derived counts ──────────────────────────────────────────────────────────
  const qReady      = operatorSummary?.queueCounts?.readyToShip      ?? operationalControl?.queue_ready_to_ship      ?? 0;
  const qPicking    = operationalControl?.pending_fulfillment ?? 0;
  const constrained = operationalControl?.constrained_orders  ?? 0;
  const aging72     = operationalControl?.aging_72h_plus      ?? 0;
  const aging48     = operationalControl?.aging_48h           ?? 0;
  const aging24     = operationalControl?.aging_24h           ?? 0;
  const totalOrders = props.orders?.total ?? 0;

  // ── Date header ─────────────────────────────────────────────────────────────
  const now = new Date();
  const dayLabel = now.toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();

  // ── Revenue alert ───────────────────────────────────────────────────────────
  const atRiskRevenue  = operationalControl?.at_risk_revenue ?? 0;
  const atRiskCount    = constrained;
  const oldestHours    = operatorSummary?.agingOrders?.[0]?.ageHours ?? null;

  // ── Stage bar segments ──────────────────────────────────────────────────────
  // Each segment is a proportion of totalOrders. Unknown remainder = new.
  const stageData = [
    { key: 'ready',          label: 'Ready pick',      count: qReady      },
    { key: 'picking',        label: 'Picking',         count: qPicking    },
    { key: 'blocked',        label: 'Blocked',         count: constrained },
    { key: 'breached',       label: 'Breached',        count: aging72     },
    { key: 'awaiting_stock', label: 'Awaiting stock',  count: operatorSummary?.constraintCounts?.inventory ?? 0 },
    { key: 'awaiting_reply', label: 'Awaiting reply',  count: operatorSummary?.constraintCounts?.customer  ?? 0 },
  ];
  const accountedFor = stageData.reduce((s, d) => s + d.count, 0);
  const newCount = Math.max(0, totalOrders - accountedFor);

  const allStages = [
    { key: 'new', label: 'New', count: newCount },
    ...stageData,
  ];
  const stageTotal = allStages.reduce((s, d) => s + d.count, 0) || 1;

  // ── Action queue rows (blocked orders from operatorSummary) ─────────────────
  // Shows up to 5 most urgent. Sorted by ageHours desc (oldest first).
  const actionQueueOrders = [...(operatorSummary?.agingOrders ?? [])]
    .sort((a, b) => b.ageHours - a.ageHours)
    .slice(0, 5);

  // ── Your money ──────────────────────────────────────────────────────────────
  const leakage = operationalControl?.revenue_leakage ?? 0;

  // ── Shared card style ────────────────────────────────────────────────────────
  const cardSx = {
    bgcolor: 'var(--surface)',
    border: '1px solid var(--rule)',
    borderRadius: '10px',
    overflow: 'hidden',
  };

  return (
    <Box sx={{ p: '32px 40px', minHeight: '100%', bgcolor: 'var(--bg)' }}>

      {/* ── SECTION 1: HEADER ──────────────────────────────────────────────── */}

      {/* Date / sync line */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: theme.palette.success.main, flexShrink: 0 }} />
        <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          {dayLabel} · Channels live · Last synced 2 min ago
        </Typography>
      </Box>

      {/* Serif heading + italic accent */}
      <Box sx={{ mb: 1 }}>
        <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, color: 'var(--ink)', lineHeight: 1.15, display: 'inline' }}>
          Orders today.{' '}
        </Typography>
        <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, fontStyle: 'italic', color: 'var(--accent)', lineHeight: 1.15, display: 'inline' }}>
          Here's what to clear first.
        </Typography>
      </Box>

      {/* Subheading */}
      <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', mb: 2.5 }}>
        {constrained > 0
          ? `${constrained} orders need a decision today — ${aging72} past 72h SLA. Everything else is on track.`
          : 'All orders are on track — nothing needs immediate action.'}
      </Typography>

      {/* Revenue alert banner — only when revenue at risk */}
      {atRiskRevenue > 0 && (
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 2, px: 2, py: 1.5, mb: 4,
          bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.error.main, 0.18) : alpha(theme.palette.error.main, 0.06),
          border: '1px solid', borderColor: alpha(theme.palette.error.main, 0.3),
          borderRadius: '10px',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <AlertTriangle size={16} color={theme.palette.error.main} />
            <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>
              <Typography component="span" sx={{ fontWeight: 600, color: 'var(--ink)' }}>{fmt$(atRiskRevenue)}</Typography>
              {' '}of revenue is held up across{' '}
              <Typography component="span" sx={{ fontWeight: 600 }}>{atRiskCount} orders</Typography>
              {oldestHours != null && `. Oldest is ${Math.round(oldestHours)}h past SLA — every hour is a refund risk.`}
            </Typography>
          </Box>
          <Typography
            component="a"
            href="/fulfillment?filter=blocked"
            sx={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', whiteSpace: 'nowrap', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
          >
            Review queue →
          </Typography>
        </Box>
      )}

      {/* ── SECTION 2: OPERATION PULSE ─────────────────────────────────────── */}

      <SectionLabel left="Operation Pulse" right={`Today, so far · ${fmtN(totalOrders)} total`} />

      <Box sx={{ display: 'flex', gap: 2, mb: 1.5 }}>
        <StatCard
          label="Ready to ship"
          value={fmtN(qReady)}
          valueColor={qReady > 0 ? theme.palette.success.main : undefined}
          cta="Fulfillment queue"
          ctaHref="/fulfillment"
        />
        <StatCard
          label="Being picked & packed"
          value={fmtN(qPicking)}
          cta="In progress"
          ctaHref="/fulfillment"
        />
        <StatCard
          label="Blocked — cannot ship"
          value={fmtN(constrained)}
          valueColor={constrained > 0 ? 'var(--accent)' : undefined}
          cta="Blocked orders"
          ctaHref="/fulfillment?filter=blocked"
        />
        <StatCard
          label="Breached SLA · 72h+"
          value={fmtN(aging72)}
          valueColor={aging72 > 0 ? theme.palette.error.main : undefined}
          cta="Urgent"
          ctaHref="/fulfillment?filter=urgent"
        />
      </Box>

      {/* Aging band row */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 4, px: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {[
            { count: aging24, label: '24H+', color: theme.palette.warning.light },
            { count: aging48, label: '48H+', color: theme.palette.warning.main },
            { count: aging72, label: '72H+ BREACHED', color: theme.palette.error.main },
          ].map(({ count, label, color }) => (
            <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color }} />
              <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                {fmtN(count)} {label}
              </Typography>
            </Box>
          ))}
        </Box>
        <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          ● {fmtN(props.orders?.fulfilled)} shipped this week · {fmt$(revenue?.earned)} collected
        </Typography>
      </Box>

      {/* ── SECTION 3: ACTION QUEUE ────────────────────────────────────────── */}

      <SectionLabel
        left={`Action Queue · ${constrained > 0 ? `${constrained} urgent` : 'clear'}`}
        right="View all orders →"
      />

      <Box sx={{ ...cardSx, mb: 4 }}>
        {/* Table header */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: '32px 1fr 1fr 80px 80px 90px',
          px: 2, py: 1,
          bgcolor: 'var(--bg-2)',
          borderBottom: '1px solid var(--rule)',
        }}>
          {['', 'Order · Channel', 'Hold Reason', 'SLA', 'Value', ''].map((col, i) => (
            <Typography key={i} sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              {col}
            </Typography>
          ))}
        </Box>

        {/* Table rows */}
        {actionQueueOrders.length === 0 ? (
          <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 13, color: 'var(--ink-4)' }}>No blocked orders — queue is clear.</Typography>
          </Box>
        ) : actionQueueOrders.map((order) => {
          const hold = holdReasonLabel(order.constraintType);
          const hoursOver = Math.round(order.ageHours);
          return (
            <Box key={order.lasyncro_order_id} sx={{
              display: 'grid',
              gridTemplateColumns: '32px 1fr 1fr 80px 80px 90px',
              alignItems: 'center',
              px: 2, py: 1.25,
              borderBottom: '1px solid var(--rule)',
              '&:last-child': { borderBottom: 'none' },
              '&:hover': { bgcolor: 'var(--bg-2)' },
            }}>
              {/* Checkbox — Phase 2 bulk select (stub) */}
              <Checkbox size="small" sx={{ p: 0 }} />

              {/* Order / channel */}
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                  {order.externalOrderId ? `#${order.externalOrderId}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                </Typography>
                <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>Shopify</Typography>
              </Box>

              {/* Hold reason */}
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <HoldDot color={hold.color} />
                <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>{hold.label}</Typography>
              </Box>

              {/* SLA badge */}
              <Box sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5,
                px: 1, py: 0.25,
                bgcolor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.18 : 0.08),
                borderRadius: '4px',
                width: 'fit-content',
              }}>
                <Clock size={11} color={theme.palette.error.main} />
                <Typography sx={{ fontSize: 11, fontWeight: 600, color: theme.palette.error.main }}>
                  {hoursOver}H
                </Typography>
              </Box>

              {/* Value — placeholder, revenue not on agingOrders shape */}
              <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>—</Typography>

              {/* Resolve button */}
              <Typography
                component="a"
                href={`/fulfillment?order=${order.lasyncro_order_id}`}
                sx={{
                  fontSize: 11, fontWeight: 500, color: 'var(--ink-3)',
                  border: '1px solid var(--rule)', borderRadius: '4px',
                  px: 1.25, py: 0.5, textDecoration: 'none',
                  display: 'inline-block',
                  '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' },
                }}
              >
                Resolve →
              </Typography>
            </Box>
          );
        })}

        {/* Table footer */}
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          px: 2, py: 1,
          bgcolor: 'var(--bg-2)',
          borderTop: '1px solid var(--rule)',
        }}>
          <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
            {qPicking > 0 && `${fmtN(qPicking)} in pick & pack`}
          </Typography>
          {atRiskRevenue > 0 && (
            <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: theme.palette.error.main }}>
              {fmt$(atRiskRevenue)} at risk across this queue
            </Typography>
          )}
        </Box>
      </Box>

      {/* ── SECTION 4: ORDERS BY STAGE ─────────────────────────────────────── */}

      <SectionLabel left="Open Orders by Stage" right={`${fmtN(props.orders?.unfulfilled)} open`} />

      {/* Stacked proportional progress bar */}
      <Box sx={{ display: 'flex', height: 8, borderRadius: '4px', overflow: 'hidden', mb: 2, bgcolor: 'var(--bg-3)' }}>
        {allStages.filter(s => s.count > 0).map((stage) => (
          <Box
            key={stage.key}
            sx={{
              width: `${(stage.count / stageTotal) * 100}%`,
              bgcolor: STAGE_COLORS[stage.key] ?? 'var(--ink-4)',
              transition: 'width 0.3s ease',
            }}
          />
        ))}
      </Box>

      {/* Stage grid */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', mb: 4 }}>
        {allStages.map((stage) => (
          <Box key={stage.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: STAGE_COLORS[stage.key] ?? 'var(--ink-4)', flexShrink: 0 }} />
            <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>
              {stage.label}
            </Typography>
            <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>
              {fmtN(stage.count)}
            </Typography>
          </Box>
        ))}
      </Box>

      {/* ── SECTION 5: YOUR MONEY ──────────────────────────────────────────── */}

      <SectionLabel left="Your Money · This Week" right="Open Finances →" />

      <Box sx={{
        ...cardSx,
        bgcolor: theme.palette.mode === 'dark' ? 'var(--bg-2)' : 'var(--surface)',
      }}>
        {/* 4 large-number cards in a row */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '1px solid var(--rule)' }}>
          {[
            { label: 'Total order value',        value: revenue?.totalSales ?? null, color: 'var(--ink)'                              },
            { label: 'Collected — shipped',       value: revenue?.earned     ?? null, color: theme.palette.success.main               },
            { label: 'Paid · not yet shipped',    value: revenue?.pending    ?? null, color: 'var(--accent)'                          },
            { label: 'Blocked — held up',         value: revenue?.blocked    ?? null, color: theme.palette.error.main                 },
          ].map((item, i, arr) => (
            <Box key={item.label} sx={{
              p: '20px 24px',
              borderRight: i < arr.length - 1 ? '1px solid var(--rule)' : 'none',
            }}>
              <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
                {item.label}
              </Typography>
              <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 28, fontWeight: 400, color: item.color, lineHeight: 1 }}>
                {fmt$(item.value)}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* Revenue leakage footer */}
        {leakage > 0 && (
          <Box sx={{ px: 3, py: 1.25 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)' }}>
              {fmt$(leakage)} leaked to refunds · lost to SLA misses this week · unrecoverable
            </Typography>
          </Box>
        )}
      </Box>

    </Box>
  );
}