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

const TRIAGE_PREVIEW_LIMIT = 4;

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
  picking:        '#14B8A6',
  packed:         '#3B82F6',
  blocked:        '#F97316',
  breached:       '#EF4444',
  awaiting_reply: '#F59E0B',
  awaiting_stock: '#EAB308',
};

// ─── MAIN COMPONENT ───────────────────────────────────────────

export default function OrdersModuleFT2(props: OrdersModuleFT2DataProps) {
  const navigate = useNavigate();
  const { operationalControl, revenue, operatorSummary, currency, onExport, onOrderClick } = props

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
  const allAgingOrders = [...(operatorSummary?.agingOrders ?? [])].sort((a, b) => b.ageHours - a.ageHours);
  // Critical = SLA already breached — act today
  const [criticalExpanded, setCriticalExpanded] = useState(false);
const [watchExpanded, setWatchExpanded] = useState(false);

const criticalOrders = allAgingOrders.filter(o => o.isShippingSlaBreached);
// Watch = aging 24h+ but not yet breached — monitor
const watchOrders    = allAgingOrders.filter(o => !o.isShippingSlaBreached && o.ageHours >= 24);

const visibleCriticalOrders = criticalOrders.slice(0, TRIAGE_PREVIEW_LIMIT);
const hiddenCriticalOrders  = criticalOrders.slice(TRIAGE_PREVIEW_LIMIT);
const visibleWatchOrders    = watchOrders.slice(0, TRIAGE_PREVIEW_LIMIT);
const hiddenWatchOrders     = watchOrders.slice(TRIAGE_PREVIEW_LIMIT);

  const constraintLabel = (type: string | null): string => {
    switch (type) {
      case 'inventory': return 'Out of stock';
      case 'customer':  return 'Address issue';
      default:          return 'SLA breach';
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
              ? `${constrained} need a decision · ${fmt$(blockedRevenue)} blocked · ${qPicking} in pick & pack`
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
              {visibleCriticalOrders.map(order => (
                <Box
                  key={order.lasyncro_order_id}
                  sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 90px 118px', gap: 1.75, alignItems: 'center', px: 2.5, py: 1.75, borderTop: '1px solid var(--rule)' }}
                >
                  <Box>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', mb: 0.375 }}>
                      {order.externalOrderId ? `#${order.externalOrderId}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                    </Typography>
                    <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                      {constraintLabel(order.constraintType)} · {fmtSlaAge(order.ageHours)}
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
                  <Box
                    component="button"
                    onClick={() => order.constraintType !== null ? onOrderClick?.(order.lasyncro_order_id) : navigate('/orders/flow')}
                    sx={{ fontSize: 12, fontWeight: 600, color: '#10151E', bgcolor: 'var(--accent)', border: 'none', borderRadius: '8px', py: 1, textAlign: 'center', cursor: 'pointer', '&:hover': { opacity: 0.88 } }}
                  >
                    {order.constraintType !== null ? 'Review queue' : 'Release →'}
                  </Box>
                </Box>
              ))}
              {hiddenCriticalOrders.length > 0 && (
                <>
                  <Collapse in={criticalExpanded} timeout={180} unmountOnExit>
                    {hiddenCriticalOrders.map(order => (
                      <Box
                        key={order.lasyncro_order_id}
                        sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 90px 118px', gap: 1.75, alignItems: 'center', px: 2.5, py: 1.75, borderTop: '1px solid var(--rule)' }}
                      >
                        <Box>
                          <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', mb: 0.375 }}>
                            {order.externalOrderId ? `#${order.externalOrderId}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                          </Typography>
                          <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                            {constraintLabel(order.constraintType)} · {fmtSlaAge(order.ageHours)}
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
                        <Box
                          component="button"
                          onClick={() => order.constraintType !== null ? onOrderClick?.(order.lasyncro_order_id) : navigate('/orders/flow')}
                          sx={{ fontSize: 12, fontWeight: 600, color: '#10151E', bgcolor: 'var(--accent)', border: 'none', borderRadius: '8px', py:1, textAlign: 'center', cursor: 'pointer', '&:hover': { opacity: 0.88 } }}
                        >
                          {order.constraintType !== null ? 'Review queue': 'Release →'}
                        </Box>
                      </Box>
                    ))}
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
                        {constraintLabel(order.constraintType)} · {fmtSlaAge(order.ageHours)} aging
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
                              {constraintLabel(order.constraintType)} · {fmtSlaAge(order.ageHours)} aging
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

        {/* ── RIGHT: Today's flow ─────────────────────────────── */}
        <Box sx={{ flex: '0 0 300px', bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '18px 20px' }}>
          <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.875 }}>
            Today's flow
          </Typography>

          {[
            { label: 'Ready to ship',     n: qReady,      color: '#4CAF7A'       },
            { label: 'Picking & packing', n: qPicking,    color: 'var(--ink)'    },
            { label: 'Blocked',           n: constrained, color: 'var(--accent)' },
            { label: 'Breached 72h+',     n: aging72,     color: '#E5484D'       },
          ].map(({ label, n, color }) => (
            <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', py: 1.125, borderBottom: '1px solid var(--rule)' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>{label}</Typography>
              <Typography sx={{ fontSize: 15, fontWeight: 600, color }}>{fmtN(n)}</Typography>
            </Box>
          ))}

          <Box sx={{ display: 'flex', height: 6, borderRadius: '3px', overflow: 'hidden', mt: 2, mb: 1.25, bgcolor: 'var(--bg)' }}>
            {allStages.filter(s => s.count > 0).map(stage => (
              <Box
                key={stage.key}
                sx={{ width: `${(stage.count / stageTotal) * 100}%`, bgcolor: STAGE_COLORS[stage.key] ?? 'var(--ink-4)' }}
              />
            ))}
          </Box>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '5px 12px', mb: 2 }}>
            {allStages.filter(s => s.count > 0).map(stage => (
              <Box key={stage.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: 7, height: 7, borderRadius: '2px', bgcolor: STAGE_COLORS[stage.key] ?? 'var(--ink-4)', flexShrink: 0 }} />
                <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)' }}>{stage.label}</Typography>
                <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{fmtN(stage.count)}</Typography>
              </Box>
            ))}
          </Box>

          <Box sx={{ borderTop: '1px solid var(--rule)', pt: 1.5 }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-4)' }}>
              Shipped today{' '}
              <Box component="span" sx={{ fontWeight: 600, color: 'var(--ink)' }}>{fmtN(props.orders?.fulfilled)}</Box>
              {' · Collected '}
              <Box component="span" sx={{ fontWeight: 600, color: 'var(--ink)' }}>{fmt$(revenue?.earned)}</Box>
            </Typography>
          </Box>

          {/* Tier 2 navigation CTA — keep aligned with modules UX playbook ghost pill anatomy. */}
          <Box
            onClick={() => navigate('/orders/flow')}
            sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', mt: 1.5, px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
          >
            View all orders →
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
