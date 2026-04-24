// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx

import { useState } from 'react';
import {
  Box,
  Typography,
  Chip,
  Divider,
  useTheme,
  Button,
  Checkbox,
  Tooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  AlertTriangle,
  Package,
  Clock,
  CheckCircle,
  Flag,
  Timer,
  Zap,
  HelpCircle,
  Printer,
  ClipboardList,
  ExternalLink,
} from 'lucide-react';
import type { FT2TemporalProps } from '@lasyncro/ui-ft2';
import { mapOperationalSignals } from '../mappers/mapOperationalSignals.js';
import { mapWorkQueues } from '../mappers/mapWorkQueues.js';
import type { OperationalSignal } from '../../contracts/operationalSignals.js';
import { updateSignalLifecycle } from '../mappers/lifecycle/signalLifecycleEngine.js';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';

/**
 * OrdersModuleFT2DataProps
 * -----------------------
 * STRICT data contract. No data derivation in this component.
 */
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
    /**
     * blockedBy breakdown is NOT produced by the backend FTEP layer.
     * Do not add attribution fields here — FT2 obligations are aggregate-only.
     */
    coverage: { status: 'sufficient' | 'insufficient' };
  };

  decision: {
    /**
     * brief is null when no operational snapshot exists (degraded state).
     * Never spread null — guard before use.
     */
    brief: {
      ready_to_ship: number;
      awaiting_customer: number;
      inventory_blocked_revenue: string | number;
      manual_review: string | number;
    } | null;
  };

  onOrderSelect?: (orderId: string) => void;

  /**
   * Operator Summary (independent load)
   * Populated by GET /api/v1/modules/order-nexus/operator-summary.
   * null = still loading or unavailable. Must render gracefully.
   */
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

  /** CURRENCY LAYER 3 — pass from EntitlementsContext, never hardcode */
  currency?: CurrencyContext;
}

// ─────────────────────────────────────────────────────────────
// LOCAL HELPERS
// ─────────────────────────────────────────────────────────────

const fmtN = (n: number | null | undefined): string =>
  n == null ? '—' : Math.round(n).toLocaleString();

/**
 * SLA bucket label — groups aging orders into operator-meaningful bands.
 * Raw hours (1,292 hrs) are meaningless. Bands (72h+) are actionable.
 */
const slaBucket = (hours: number): { label: string; severity: 'critical' | 'warning' | 'mild' } => {
  if (hours >= 72) return { label: '72h+', severity: 'critical' };
  if (hours >= 48) return { label: '48h+', severity: 'warning' };
  return { label: '24h+', severity: 'mild' };
};

const constraintLabel = (type: string | null | undefined): string => {
  switch (type) {
    case 'inventory':   return 'Out of stock';
    case 'customer':    return 'Waiting on customer';
    case 'operational': return 'Needs review';
    default:            return 'No specific block';
  }
};

// Retained for signal lifecycle tracking — not rendered.
function handleOperationsAction(actionType: string, signal: OperationalSignal) {
  updateSignalLifecycle(signal.id, 'IN_PROGRESS');
  console.info('[OrdersModuleFT2] action', { actionType, signalId: signal.id });
}

// ─────────────────────────────────────────────────────────────
// MONEY BAR — proportional bar relative to totalSales
// ─────────────────────────────────────────────────────────────
function MoneyBar({ value, total, color }: { value: number | null; total: number | null; color: string }) {
  const pct = value && total && total > 0 ? Math.min(Math.round((value / total) * 100), 100) : 0;
  return (
    <Box sx={{ height: 4, width: 80, background: 'action.selected', borderRadius: 2, mt: '5px', overflow: 'hidden' }}>
      <Box sx={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2 }} />
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────
// ORDERS MODULE — FT2 (OPERATOR SURFACE)
// ─────────────────────────────────────────────────────────────
export default function OrdersModuleFT2(props: OrdersModuleFT2DataProps) {
  const theme = useTheme();

  const {
    orders,
    revenue,
    operationalControl,
    operatorSummary,
    distribution,
    currency,
  } = props;

  const fmt$ = (n: number | null | undefined): string =>
    formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  // ── Health classification ────────────────────────────────────
  const constrained = operationalControl?.constrained_orders ?? 0;
  const exceptions  = operationalControl?.exception_orders ?? 0;
  const isCritical  = constrained > 0;
  const isWarning   = !isCritical && exceptions > 0;

  // ── Constraint counts ────────────────────────────────────────
  // Prefer operator summary (accurate DB counts) over snapshot revenue fields.
  const invBlocked  = operatorSummary?.constraintCounts?.inventory
    ?? operationalControl?.revenue_blocked_inventory  ?? 0;
  const custBlocked = operatorSummary?.constraintCounts?.customer
    ?? operationalControl?.revenue_blocked_customer   ?? 0;
  const opsBlocked  = operatorSummary?.constraintCounts?.operational
    ?? operationalControl?.revenue_blocked_operational ?? 0;

  // ── Dominant blocker — derived from actual counts, not stale snapshot field ──
  const dominantBlocker: 'inventory' | 'customer' | 'operational' | 'unknown' =
    invBlocked >= custBlocked && invBlocked >= opsBlocked && invBlocked > 0 ? 'inventory' :
    custBlocked >= invBlocked && custBlocked >= opsBlocked && custBlocked > 0 ? 'customer' :
    opsBlocked > 0 ? 'operational' : 'unknown';

  // ── Queue counts ─────────────────────────────────────────────
  const qReady   = operatorSummary?.queueCounts?.readyToShip       ?? operationalControl?.queue_ready_to_ship      ?? 0;
  const qInv     = operatorSummary?.queueCounts?.awaitingInventory
    ?? (operationalControl?.queue_awaiting_inventory > 0
        ? operationalControl?.queue_awaiting_inventory
        : operationalControl?.constrained_orders)
    ?? 0;
  const qCust    = operatorSummary?.queueCounts?.awaitingCustomer   ?? operationalControl?.queue_awaiting_customer  ?? 0;
  const qManual  = operatorSummary?.queueCounts?.manualReview       ?? operationalControl?.queue_manual_review      ?? 0;
  const qPending = operationalControl?.pending_fulfillment ?? 0;

  // ── Revenue ──────────────────────────────────────────────────
  const earned     = revenue?.earned     ?? null;
  const pending    = revenue?.pending    ?? null;
  const totalSales = revenue?.totalSales ?? null;
  const atRisk     = operationalControl?.at_risk_revenue ?? null;

  // ── Aging orders ─────────────────────────────────────────────
  // Split aging orders into three SLA bands — each band shows orders that
  // crossed that threshold. Sorted ascending within band (least late first).
  const allAgingOrders = (operatorSummary?.agingOrders ?? [])
    .sort((a, b) => a.ageHours - b.ageHours);

  const aging24Orders = allAgingOrders.filter(o => o.ageHours >= 24 && o.ageHours < 48);
  const aging48Orders = allAgingOrders.filter(o => o.ageHours >= 48 && o.ageHours < 72);
  const aging72Orders = allAgingOrders.filter(o => o.ageHours >= 72);

  const agingCount = operationalControl?.aging_48h ?? 0;
  const aging72Count = operationalControl?.aging_72h_plus ?? 0;

  // ── Priority selection state ──────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [prioritising, setPrioritising] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkPrioritise = async () => {
    if (selectedIds.size === 0) return;
    setPrioritising(true);
    try {
      await fetch('/api/v1/modules/order-nexus/prioritise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ order_ids: Array.from(selectedIds) }),
      });
      setSelectedIds(new Set());
    } finally {
      setPrioritising(false);
    }
  };

  const imminentBreachers = operatorSummary?.imminentSlaBreachers ?? [];

  // ── SLA countdown label ───────────────────────────────────
  const slaCountdownLabel = (minutesRemaining: number | null): { label: string; color: 'error' | 'warning' | 'default' } => {
    if (minutesRemaining === null) return { label: 'SLA unknown', color: 'default' };
    if (minutesRemaining <= 0) {
      const hoursBreached = Math.abs(Math.floor(minutesRemaining / 60));
      return { label: `Breached ${hoursBreached}h ago`, color: 'error' };
    }
    if (minutesRemaining < 60) return { label: `${minutesRemaining}m left`, color: 'error' };
    const hours = Math.floor(minutesRemaining / 60);
    const mins = minutesRemaining % 60;
    return {
      label: `${hours}h ${mins}m left`,
      color: minutesRemaining < 240 ? 'error' : 'warning',
    };
  };

  // ── Signal engine — retained for lifecycle, not rendered ─────
  const safeSnap = operationalControl ?? {
    snapshot_date: new Date().toISOString(), aggregate_version: 0,
    realized_revenue: 0, at_risk_revenue: 0, total_at_risk_revenue: 0,
    sla_breach_24h_revenue: 0, top_blocking_type: 'none',
    blocked_revenue: 0, revenue_leakage: 0, avg_contribution_margin_pct: 0,
    orders_at_sla_risk: 0, aging_24h: 0, aging_48h: 0, aging_72h_plus: 0,
    pending_fulfillment: 0, pending_payment: 0, exception_orders: 0,
    constrained_orders: 0, revenue_blocked_inventory: 0,
    revenue_blocked_customer: 0, revenue_blocked_operational: 0,
    queue_manual_review: 0, queue_awaiting_inventory: 0,
    queue_ready_to_ship: 0, queue_awaiting_customer: 0,
    partial_fulfillment_opportunity: 0,
  };
  if (!operationalControl) {
    console.error('[OrdersModuleFT2] operationalControl missing → using fallback');
  }
  mapOperationalSignals(safeSnap, currency);
  mapWorkQueues(safeSnap);

  // ── Shared tokens ────────────────────────────────────────────
  const dividerSx = { borderColor: 'divider' };
  const rowSx = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    px: 2,
    py: 1.5,
    borderBottom: '1px solid',
    borderColor: 'divider',
    '&:last-child': { borderBottom: 'none' },
  };
  const cardSx = {
    border: '1px solid',
    borderColor: 'divider',
    borderRadius: 2,
    overflow: 'hidden',
  };

  return (
    <Box sx={{ p: 3 }}>

      {/* ── MOMENTUM BAR ───────────────────────────────────────── */}
      {orders?.fulfilled != null && orders.fulfilled > 0 && (
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          px: 2, py: 1.25, mb: 2.5,
          background: 'action.hover',
          border: '1px solid', borderColor: 'divider',
          borderRadius: 1.5,
        }}>
          <CheckCircle size={14} color={theme.palette.success.main} />
          <Typography variant="caption" color="text.secondary">
            You've shipped{' '}
            <Typography component="span" variant="caption" sx={{ fontWeight: 600, color: 'success.dark' }}>
              {fmtN(orders.fulfilled)} orders
            </Typography>
            {' '}and collected{' '}
            <Typography component="span" variant="caption" sx={{ fontWeight: 600, color: 'success.dark' }}>
              {fmt$(earned)}
            </Typography>
            {' '}— keep it up.
            {/**
              * DELTA NOTE:
              * Yesterday comparison requires retaining previous snapshot rows.
              * Currently only one snapshot day exists. Re-enable once the
              * reconciliation projection retains historical snapshots.
              */}
          </Typography>
        </Box>
      )}

      {/* ── PRIORITY BANNER ────────────────────────────────────── */}
      {(isCritical || isWarning) && (
        <Box sx={{
          p: 2, mb: 3,
          border: '1px solid',
          borderColor: isCritical ? 'error.light' : 'warning.light',
          borderRadius: 1.5,
          borderLeft: '4px solid',
          borderLeftColor: isCritical ? 'error.main' : 'warning.main',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 1.5 }}>
            <Box>
              <Typography variant="body2" fontWeight={600}>
                {isCritical
                  ? `${fmtN(constrained)} orders are stuck and cannot ship`
                  : `${fmtN(exceptions)} orders need your attention`}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {isCritical
                  ? `${fmt$(pending)} in paid orders waiting — most need ${
                      dominantBlocker === 'inventory'   ? 'stock restocking' :
                      dominantBlocker === 'customer'    ? 'customer action' :
                      dominantBlocker === 'operational' ? 'manual review' :
                      'your attention'
                    } to ship`
                  : 'Some orders need a decision before they can ship'}
              </Typography>
            </Box>
            <Chip
              label="Needs action"
              size="small"
              color={isCritical ? 'error' : 'warning'}
              variant="outlined"
              sx={{ flexShrink: 0 }}
            />
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button size="small" variant="contained" color="error" startIcon={<ClipboardList size={14} />}>
              Review {fmtN(constrained)} stuck orders
            </Button>
            <Button size="small" variant="outlined" color="inherit" startIcon={<Printer size={14} />}>
              Print pick list
            </Button>
          </Box>
        </Box>
      )}

      {/* ── 72H+ URGENT BANNER ─────────────────────────────────── */}
      {aging72Count > 0 && (
        <Box sx={{
          p: 2, mb: 2,
          border: '1px solid',
          borderColor: 'error.light',
          borderRadius: 1.5,
          borderLeft: '4px solid',
          borderLeftColor: 'error.main',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2,
        }}>
          <Box>
            <Typography variant="body2" fontWeight={600}>
              {fmtN(aging72Count)} orders past 72 hours — customers may cancel
            </Typography>
            <Typography variant="caption" color="text.secondary">
              These are your most urgent. Resolving them first protects your refund rate.
            </Typography>
          </Box>
          <Button size="small" variant="outlined" color="error" startIcon={<ExternalLink size={14} />} sx={{ flexShrink: 0 }}>
            View 72h+ orders
          </Button>
        </Box>
      )}

      {/* ── PULSE ROW ──────────────────────────────────────────── */}
      <Typography variant="overline" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
        Right now
      </Typography>

      <Box sx={{
        display: 'flex', flexWrap: 'wrap',
        border: '1px solid', borderColor: 'divider',
        borderRadius: 2, overflow: 'hidden', mb: 4,
      }}>
        {[
          { label: 'Total orders',         value: fmtN(orders?.total),       color: 'text.primary' },
          { label: 'Shipped',              value: fmtN(orders?.fulfilled),   color: 'success.dark' },
          { label: 'Ready to ship',        value: fmtN(qReady),              color: qReady > 0 ? 'success.dark' : 'text.primary' },
          { label: 'Stuck orders',         value: fmtN(constrained),         color: constrained > 0 ? 'error.main' : 'text.primary' },
          { label: 'Waiting to ship',      value: fmtN(orders?.unfulfilled), color: 'text.primary' },
        ].map((stat, i, arr) => (
          <Box key={stat.label} sx={{ display: 'flex' }}>
            <Box sx={{ minWidth: 120, px: 2, py: 1.5 }}>
              <Typography variant="h5" fontWeight={700} sx={{ color: stat.color, fontVariantNumeric: 'tabular-nums' }}>
                {stat.value}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                {stat.label}
              </Typography>
            </Box>
            {i < arr.length - 1 && <Divider orientation="vertical" flexItem sx={dividerSx} />}
          </Box>
        ))}
      </Box>

      <Divider sx={{ mb: 4, ...dividerSx }} />

      {/* ── TWO COLUMN ─────────────────────────────────────────── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 3 }}>

        {/* LEFT */}
        <Box>

          {/* Start here — SLA-bucketed aging orders */}
          <Typography variant="overline" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            Start here — orders crossing the line
          </Typography>

          {/* ── IMMINENT SLA BREACHERS — will breach in <8h ── */}
          {imminentBreachers.length > 0 && (
            <Box sx={{ ...cardSx, mb: 2, border: '1px solid', borderColor: 'error.main', bgcolor: alpha(theme.palette.error.main, 0.04) }}>
              <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'error.light', display: 'flex', alignItems: 'center', gap: 1 }}>
                <Timer size={14} color={theme.palette.error.main} />
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'error.main' }}>
                  Breaching SLA in &lt;8h — act now
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>{imminentBreachers.length} orders</Typography>
              </Box>
              {imminentBreachers.map((order) => (
                <Box key={order.lasyncro_order_id} sx={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 1, alignItems: 'center', px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      {order.externalOrderId ? `#${order.externalOrderId}` : 'Order'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{constraintLabel(order.constraintType)}</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 600, display: 'block' }}>
                      {order.minutesUntilBreach < 60
                        ? `${order.minutesUntilBreach}m until breach`
                        : `${Math.floor(order.minutesUntilBreach / 60)}h ${order.minutesUntilBreach % 60}m until breach`}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{fmt$(order.revenue)} at risk</Typography>
                  </Box>
                  <Chip label="Critical" size="small" color="error" sx={{ fontSize: 10, height: 20 }} />
                </Box>
              ))}
            </Box>
          )}

          {/* ── BULK ACTION BAR — appears when orders selected ── */}
          {selectedIds.size > 0 && (
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 1.5,
              px: 2, py: 1.25, mb: 2, borderRadius: 2,
              bgcolor: alpha(theme.palette.primary.main, 0.08),
              border: '1px solid', borderColor: alpha(theme.palette.primary.main, 0.3),
            }}>
              <Flag size={14} color={theme.palette.primary.main} />
              <Typography variant="body2" fontWeight={600} color="primary">
                {selectedIds.size} order{selectedIds.size > 1 ? 's' : ''} selected
              </Typography>
              <Button
                size="small"
                variant="contained"
                color="primary"
                disabled={prioritising}
                onClick={handleBulkPrioritise}
                startIcon={<Zap size={12} />}
                sx={{ ml: 'auto', fontSize: 11, py: 0.25 }}
              >
                {prioritising ? 'Prioritising...' : 'Prioritise selected'}
              </Button>
              <Button size="small" variant="text" onClick={() => setSelectedIds(new Set())} sx={{ fontSize: 11 }}>
                Clear
              </Button>
            </Box>
          )}

          {/* 72h+ band */}
          {aging72Orders.length > 0 && (
            <Box sx={{ ...cardSx, mb: 2 }}>
              <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'error.main' }}>72h+ — deadline missed</Typography>
                <Typography variant="caption" color="text.secondary">{aging72Orders.length} orders</Typography>
              </Box>
              {aging72Orders.slice(0, 5).map((order) => {
                const countdown = slaCountdownLabel(order.timeToSlaBreachMinutes ?? null);
                return (
                  <Box key={order.lasyncro_order_id} sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 1, alignItems: 'center', px: 1.5, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' }, '&:hover': { bgcolor: 'action.hover' }, bgcolor: selectedIds.has(order.lasyncro_order_id) ? alpha(theme.palette.primary.main, 0.04) : 'transparent' }}>
                    <Checkbox size="small" checked={selectedIds.has(order.lasyncro_order_id)} onChange={() => toggleSelect(order.lasyncro_order_id)} sx={{ p: 0.5 }} />
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Typography variant="body2" fontWeight={600}>{order.externalOrderId ? `#${order.externalOrderId}` : 'Order'}</Typography>
                        {order.isPriorityFlagged && <Tooltip title="Priority flagged"><Flag size={12} color={theme.palette.warning.main} /></Tooltip>}
                      </Box>
                      <Typography variant="caption" color="text.secondary">{constraintLabel(order.constraintType)}</Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: `${countdown.color}.main`, fontWeight: 600, whiteSpace: 'nowrap' }}>{countdown.label}</Typography>
                    <Chip label={order.isShippingSlaBreached ? 'SLA missed' : 'Urgent'} size="small" color="error" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                  </Box>
                );
              })}
              {aging72Orders.length > 5 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                  +{aging72Orders.length - 5} more
                </Typography>
              )}
            </Box>
          )}

          {/* 48h+ band */}
          {aging48Orders.length > 0 && (
            <Box sx={{ ...cardSx, mb: 2 }}>
              <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'warning.dark' }}>48h+ — needs attention today</Typography>
                <Typography variant="caption" color="text.secondary">{aging48Orders.length} orders</Typography>
              </Box>
              {aging48Orders.slice(0, 5).map((order) => {
                const countdown = slaCountdownLabel(order.timeToSlaBreachMinutes ?? null);
                return (
                  <Box key={order.lasyncro_order_id} sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 1, alignItems: 'center', px: 1.5, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' }, '&:hover': { bgcolor: 'action.hover' }, bgcolor: selectedIds.has(order.lasyncro_order_id) ? alpha(theme.palette.primary.main, 0.04) : 'transparent' }}>
                    <Checkbox size="small" checked={selectedIds.has(order.lasyncro_order_id)} onChange={() => toggleSelect(order.lasyncro_order_id)} sx={{ p: 0.5 }} />
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Typography variant="body2" fontWeight={600}>{order.externalOrderId ? `#${order.externalOrderId}` : 'Order'}</Typography>
                        {order.isPriorityFlagged && <Tooltip title="Priority flagged"><Flag size={12} color={theme.palette.warning.main} /></Tooltip>}
                      </Box>
                      <Typography variant="caption" color="text.secondary">{constraintLabel(order.constraintType)}</Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: `${countdown.color}.main`, fontWeight: 600, whiteSpace: 'nowrap' }}>{countdown.label}</Typography>
                    <Chip label="Late" size="small" color="warning" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                  </Box>
                );
              })}
              {aging48Orders.length > 5 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                  +{aging48Orders.length - 5} more
                </Typography>
              )}
            </Box>
          )}

          {/* 24h+ band */}
          {aging24Orders.length > 0 && (
            <Box sx={{ ...cardSx, mb: 2 }}>
              <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>24h+ — keep an eye on these</Typography>
                <Typography variant="caption" color="text.secondary">{aging24Orders.length} orders</Typography>
              </Box>
              {aging24Orders.slice(0, 5).map((order) => (
                <Box key={order.lasyncro_order_id} sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 1, alignItems: 'center', px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' }, '&:hover': { bgcolor: 'action.hover' } }}>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{order.externalOrderId ? `#${order.externalOrderId}` : 'Order'}</Typography>
                    <Typography variant="caption" color="text.secondary">{constraintLabel(order.constraintType)}</Typography>
                  </Box>
                  <Chip label="Watch" size="small" color="default" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                </Box>
              ))}
              {aging24Orders.length > 5 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                  +{aging24Orders.length - 5} more
                </Typography>
              )}
            </Box>
          )}

          {allAgingOrders.length === 0 && (
            <Box sx={{ ...cardSx, mb: 2, px: 2, py: 2 }}>
              <Typography variant="caption" color="text.secondary">
                {operatorSummary === undefined
                  ? `${fmtN(agingCount)} overdue orders — loading details…`
                  : 'No overdue orders. All caught up.'}
              </Typography>
            </Box>
          )}

          <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
            <Button size="small" variant="outlined" color="inherit" startIcon={<ExternalLink size={14} />} href="/fulfillment">
              Go to fulfillment queue →
            </Button>
          </Box>

          {/* What's holding things up */}
          {(invBlocked > 0 || custBlocked > 0 || opsBlocked > 0) && (
            <>
              <Typography variant="overline" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
                What's holding up your orders
              </Typography>
              <Box sx={{ ...cardSx, mb: 3 }}>
                {[
                  {
                    icon: <HelpCircle size={16} />,
                    label: 'Needs manual review',
                    sub: 'Address issues, fraud checks, or other blockers',
                    count: opsBlocked,
                    color: opsBlocked > 0 ? theme.palette.error.main : theme.palette.text.disabled,
                    chipColor: opsBlocked > 0 ? 'error' as const : 'default' as const,
                    action: 'Review',
                  },
                  {
                    icon: <Package size={16} />,
                    label: 'Out of stock items',
                    sub: 'Orders cannot ship — items not in warehouse',
                    count: invBlocked,
                    color: invBlocked > 0 ? theme.palette.error.main : theme.palette.text.disabled,
                    chipColor: invBlocked > 0 ? 'error' as const : 'default' as const,
                    action: 'Check stock',
                  },
                  {
                    icon: <Clock size={16} />,
                    label: 'Waiting on customer',
                    sub: "Customer hasn't responded or confirmed",
                    count: custBlocked,
                    color: custBlocked > 0 ? theme.palette.warning.main : theme.palette.text.disabled,
                    chipColor: custBlocked > 0 ? 'warning' as const : 'default' as const,
                    action: 'Contact',
                  },
                ]
                .filter(item => item.count > 0)
                .map((item) => (
                  <Box key={item.label} sx={{
                    ...rowSx,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ color: item.color }}>{item.icon}</Box>
                      <Box>
                        <Typography variant="body2" fontWeight={600}>{item.label}</Typography>
                        <Typography variant="caption" color="text.secondary">{item.sub}</Typography>
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip label={`${fmtN(item.count)} orders`} size="small" color={item.chipColor} variant="outlined" />
                      <Button size="small" variant="text" color="inherit" sx={{ fontSize: 12, minWidth: 0 }}>
                        {item.action}
                      </Button>
                    </Box>
                  </Box>
                ))}
              </Box>
            </>
          )}

          {/* Quick actions */}
          <Typography variant="overline" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            Quick actions
          </Typography>

          {qReady > 0 && (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 2, mb: 1.5 }}>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                Ship the {fmtN(qReady)} {qReady === 1 ? 'order' : 'orders'} that {qReady === 1 ? 'is' : 'are'} ready
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                {qReady === 1
                  ? 'This order is packed and waiting. Print the label and hand it off.'
                  : 'These orders are packed and waiting. Print labels and hand them off.'}
              </Typography>
              <Button size="small" variant="contained" color="success" startIcon={<Printer size={14} />}>
                Print shipping {qReady === 1 ? 'label' : 'labels'}
              </Button>
            </Box>
          )}

          {constrained > 0 && (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 2, mb: 1.5 }}>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                Review {fmtN(constrained)} stuck orders
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Each needs a decision from you. Open them in bulk to work through faster.
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button size="small" variant="outlined" color="inherit" startIcon={<ClipboardList size={14} />}>
                  Open bulk review
                </Button>
                <Button size="small" variant="outlined" color="inherit" startIcon={<Printer size={14} />}>
                  Generate pick list
                </Button>
              </Box>
            </Box>
          )}

        </Box>
        
        {/* RIGHT */}
        <Box>

          {/* Your money */}
          <Typography variant="overline" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            Your money
          </Typography>

          <Box sx={{ ...cardSx, mb: 3 }}>
            {[
              {
                label: 'Total order value',
                sub: 'All orders ever placed',
                value: totalSales,
                color: theme.palette.text.secondary,
              },
              {
                label: 'Collected — shipped orders',
                sub: 'Revenue in hand',
                value: earned,
                color: theme.palette.success.dark,
              },
              {
                label: 'Paid but not yet shipped',
                sub: 'Customers are waiting',
                value: pending,
                color: theme.palette.warning.dark,
              },
              {
                label: 'At risk of being lost',
                sub: 'Overdue, may cancel or refund',
                value: atRisk,
                color: atRisk && atRisk > 0 ? theme.palette.error.main : theme.palette.text.secondary,
              },
            ].map((item) => (
              <Box key={item.label} sx={{ ...rowSx }}>
                <Box>
                  <Typography variant="body2" fontWeight={600}>{item.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{item.sub}</Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="body2" fontWeight={700} sx={{ color: item.color }}>
                    {fmt$(item.value)}
                  </Typography>
                  <MoneyBar value={item.value} total={totalSales} color={item.color} />
                </Box>
              </Box>
            ))}
          </Box>

          {/* Orders by stage */}
          <Typography variant="overline" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            Orders by stage
          </Typography>

          <Box sx={{ ...cardSx, mb: 3 }}>
            {[
              { color: theme.palette.success.main,   label: 'Ready to pack and ship',       count: qReady,   action: 'Ship now' },
              { color: theme.palette.error.main,      label: 'Needs someone to look at it',  count: opsBlocked > 0 ? opsBlocked : qManual, action: 'Review' },
              { color: theme.palette.warning.main,    label: 'Being processed for shipment', count: qPending, action: null },
              { color: theme.palette.text.disabled,   label: 'Waiting for stock',            count: invBlocked > 0 ? invBlocked : qInv, action: null },
              { color: theme.palette.text.disabled,   label: 'Waiting for customer reply',   count: qCust,    action: null },
            ].map((item) => (
              <Box key={item.label} sx={{
                ...rowSx,
                '&:hover': { bgcolor: 'action.hover' },
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                  <Typography variant="body2">{item.label}</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" fontWeight={700}>{fmtN(item.count)}</Typography>
                  {item.action && item.count > 0 && (
                    <Button size="small" variant="text" color="inherit" sx={{ fontSize: 12, minWidth: 0 }}>
                      {item.action}
                    </Button>
                  )}
                </Box>
              </Box>
            ))}
          </Box>

        </Box>
      </Box>

      {/* Optional analytical surfaces */}
      {distribution}

    </Box>
  );
}