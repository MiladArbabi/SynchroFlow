/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/OrdersFT2Page.tsx
//
// OrdersFT2Page
// -------------
// FT2-only Orders observability surface.
//
// HARD CONTRACT:
// - MUST render OrdersModuleFT2 only
// - MUST NOT render FT1 modules
// - MUST NOT infer lifecycle
// - MUST assume FT2 routing is authoritative
//
// onPriorityFlag (Change 2 · Sprint 3):
// - Fires POST /api/v1/wms/orders/:orderId/priority for each selected id
// - Parallel via Promise.all — order-independent
// - Invalidates ['wms','order-pool'] so ReleaseQueuePage reflects priority
//   flags immediately when the navigation lands there
//
// onOrderClick (2026-06-28 — ORD-03, see entity-detail-modal-playbook.md §2):
// - Opens EntityDetailModal for the clicked order. Replaces the previous
//   OrderDetailPanel import, which was confirmed dead (its open trigger was
//   never wired anywhere — setSelectedOrderId was only ever called with
//   null). OrderDetailPanel.tsx and OrderDetailPage.tsx are now orphaned —
//   not deleted yet, flagging for a decision rather than removing unasked.
// - Modal merges useOrderDecision (constraint + recommended action) and
//   usePickExceptionsForOrder (NEW — per-exception audit trail, separate
//   concern from the order-level block, see that hook's file header).
// - DEFERRED, NOT YET MERGED: useOrderDetail's content (line items, payment,
//   fulfillment, tracking, timeline, pack decisions) — see
//   entity-detail-modal-playbook.md §2.5 step 3. Until merged, the modal
//   title shows a truncated order ID rather than externalOrderId, since
//   that field isn't fetched at this layer yet.
import { useState, useCallback, useEffect, ReactNode, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Button, CircularProgress, Alert } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { AlertCircle, AlertTriangle, ArrowRight, Clock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { EntityDetailModal } from '@lasyncro/shared/ui';
import { useBulkSetPriority } from '../wms/useOrderPool';
import { OrdersModuleFT2 } from '@lasyncro/order-nexus';
import { useOrdersFt2Snapshot } from '../orders/useOrdersFt2Snapshot';
import { mapOrdersFt2Props } from '../orders/useOrdersFt2Adapter';
import { useOrdersOperatorSummary } from '../orders/useOrdersOperatorSummary';
import { useOrderDecision, useExecuteOrderDecision } from '../orders/useOrderDecision';
import { useOrderDetail } from '../orders/useOrderDetail';
import {
  getConstraintLabel,
  getConstraintSeverity,
  getSlaProximity,
  getAgeLabel,
  type ConstrainedOrder,
  type ConstrainedOrdersResponse,
} from '../orders/useConstrainedOrders';
import { usePickExceptionsForOrder, useResolvePickException } from '../orders/usePickExceptionsForOrder';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useExchangeRates } from 'hooks/useExchangeRates';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { OrderCapBanner } from '../../components/OrderCapBanner';
import { ExportDrawer } from 'components/ExportDrawer';

const __DEV__ = import.meta.env.DEV;

const ACTION_LABELS: Record<string, string> = {
  proceed_fulfillment: 'Proceed to ship',
  resolve_operational_block: 'Mark as resolved',
  resolve_inventory_block: 'Go to sourcing',
  resolve_customer_block: 'Flag for customer review',
};

function getActionLabel(actionType: string): string {
  return ACTION_LABELS[actionType] ?? 'Take action';
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function formatWarehouseStatus(status: string | null): string {
  if (!status) return 'In pool';
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
}

const TIMELINE_VISIBLE_COUNT = 3;

/**
 * useCachedConstrainedRow
 * ------------------------
 * The Fulfillment Queue row (useConstrainedOrders) is already fetched and
 * polling every 10s — reading it from the query cache costs nothing and
 * gives the modal urgency context (SLA/$/margin) without a second
 * round-trip. See entity-detail-modal-playbook.md §2.8.
 */
function useCachedConstrainedRow(orderId: string): ConstrainedOrder | undefined {
  const queryClient = useQueryClient();
  const caches = queryClient.getQueriesData<ConstrainedOrdersResponse>({ queryKey: ['orders', 'constrained'] });
  for (const [, data] of caches) {
    const row = data?.data?.find((o) => o.order_id === orderId);
    if (row) return row;
  }
  return undefined;
}

/**
 * OrderUrgencySubtitle
 * ---------------------
 * Feeds EntityDetailModal's `subtitle` prop — previously unused. Surfaces
 * the exact numbers that justified opening this order (revenue at stake,
 * SLA breach age, margin) so the operator never has to go back to the
 * list to re-derive why this order mattered.
 */
function buildUrgencySubtitle(row: ConstrainedOrder | undefined): string | undefined {
  if (!row) return undefined;
  const parts: string[] = [];
  if (row.revenue != null) parts.push(`${formatCurrency(row.revenue, 'USD')} at stake`);
  const proximity = getSlaProximity(row);
  if (proximity === 'breached') parts.push(`SLA breached · ${getAgeLabel(row)} past`);
  else if (proximity === 'warning') parts.push(`Approaching SLA · ${getAgeLabel(row)} old`);
  if (row.margin_pct != null) parts.push(`${row.margin_pct.toFixed(1)}% margin`);
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * ConstraintAlertCard
 * --------------------
 * Stacked, independently-colored alert per active constraint — replaces
 * the original flat text list. Reuses the icon+color+label severity
 * pattern from TopnavbarContent.tsx's BellAlertRow (AlertsModule.md D5:
 * never colour alone).
 */
function ConstraintAlertCard({
  constraintType,
  blockType,
  detail,
}: {
  constraintType: string;
  blockType: string | null;
  detail?: string;
}) {
  const theme = useTheme();
  const severity = getConstraintSeverity(constraintType);
  const color = severity === 'critical' ? theme.palette.error.main : theme.palette.warning.main;
  const bg = severity === 'critical' ? 'rgba(226,75,74,0.08)' : 'rgba(239,159,39,0.08)';
  const Icon = severity === 'critical' ? AlertCircle : AlertTriangle;

  return (
    <Box sx={{ display: 'flex', gap: 1.25, bgcolor: bg, borderRadius: '10px', p: 1.25 }}>
      <Icon size={16} color={color} style={{ flexShrink: 0, marginTop: 1 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 500, color }}>
          {getConstraintLabel(constraintType)}
        </Typography>
        {(blockType || detail) && (
          <Typography sx={{ fontSize: 11.5, color, mt: 0.5 }}>
            {detail ?? blockType?.replace(/_/g, ' ')}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function OrderDetailModalBody({
  orderId,
  onTitleReady,
  onSubtitleReady,
  onNavigateToOrder,
  onFooterReady,
  onPriorityFlag,
}: {
  orderId: string;
  onTitleReady: (title: string) => void;
  onSubtitleReady: (subtitle: string | undefined) => void;
  onNavigateToOrder: (orderId: string) => void;
  /**
   * FOOTER LIFT (2026-07-02)
   * ------------------------
   * Unlike onTitleReady/onSubtitleReady (fire-once-per-order, simple
   * useEffect), the footer's content depends on several pieces of
   * mid-render local state (constraint status, isPrioritizing,
   * prioritized) — so it's computed via useMemo, not set once, and
   * re-fires onFooterReady whenever that memoized value changes.
   */
  onFooterReady: (footer: ReactNode) => void;
  /**
   * ORDM-04b (2026-07-01): same mutation as ORDM-02's list-row
   * "Prioritize" action (see OrdersModuleFT2.tsx handlePrioritizeOrder).
   * Reused here rather than re-implementing — one source of truth for
   * what "prioritize" does (bulk-set-priority endpoint, order surfaces
   * at top of pool with a Priority badge).
   */
  onPriorityFlag?: (orderIds: string[], flagged: boolean) => Promise<void>;
}) {
  const { data, isLoading, isError, error } = useOrderDecision(orderId);
  const navigate = useNavigate();
  // FIX (2026-07-01): 404 is now an expected, good response from
  // httpGetOrderDecision after the status-filter fix — it means "no
  // active decision for this order" (fully resolved, or calmly sitting
  // in the pool), not a failure. Confirmed the interceptor in
  // axiosConfig.ts passes 404s through untouched (only 401s are
  // special-cased for token refresh), so error.response.status is safe
  // to read directly here. Only a genuine non-404 error should
  // short-circuit the modal into a warning state.
  const is404 = (error as { response?: { status?: number } })?.response?.status === 404;
  const isRealError = isError && !is404;

  const {
    mutate: execute,
    isPending,
    isSuccess,
    isError: isExecError,
    error: execError,
  } = useExecuteOrderDecision();

  const exceptionsQuery = usePickExceptionsForOrder(orderId);
  const resolveException = useResolvePickException(orderId);
  const detailQuery = useOrderDetail(orderId);
  const cachedRow = useCachedConstrainedRow(orderId);
  const queryClient = useQueryClient();
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  /**
   * ORDM-04b (2026-07-01): local pending/success state for the modal's
   * "Prioritize" action — deliberately NOT reusing OrdersModuleFT2's
   * holdPriorityMovement/flashPriorityRow (that's row-hold/flash
   * animation logic coupled to the list view, not applicable inside a
   * single-order modal). Same underlying mutation, simpler local UI.
   */
  const [isPrioritizing, setIsPrioritizing] = useState(false);
  const [prioritized, setPrioritized] = useState(false);

  const allConstrained = queryClient
    .getQueriesData<ConstrainedOrdersResponse>({ queryKey: ['orders', 'constrained'] })
    .flatMap(([, d]) => d?.data ?? []);
  const similarOrders = cachedRow
    ? allConstrained.filter(
        (o) =>
          o.order_id !== orderId &&
          o.constraint_type === cachedRow.constraint_type &&
          o.block_type === cachedRow.block_type
      )
    : [];

  // data is undefined on 404 — every read below already tolerates that
  // via ?? [] / ?. fallbacks, no additional guarding needed.
  const decision = data?.decision;
  const constraints = data?.constraints ?? [];
  const recommendedAction = decision?.recommended_action;
  const alternateActions = (decision?.actions ?? []).filter(
    (a) => a.type !== recommendedAction?.type
  );
  const exceptions = exceptionsQuery.data?.exceptions ?? [];
  const unresolvedExceptions = exceptions.filter((e) => !e.resolved);
  const order = detailQuery.data;

  const hasActiveInventoryConstraint = constraints.some((c) => c.constraint_type === 'inventory');
  const hasAnyActiveConstraint = constraints.length > 0;
  /**
   * FOOTER LIFT (2026-07-02)
   * ------------------------
   * Computed here (not inline in JSX) because it must reach
   * EntityDetailModal's footerActions slot via onFooterReady, not
   * render inside this component's own body. Only the constraint-free/
   * unbatched case has a footer today — other states (blocked,
   * resolved) render nothing here, same as before this change.
   */
  const footerContent = useMemo(() => {
    if (hasAnyActiveConstraint || order?.warehouseStatus) return null;
    return (
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-start' }}>
        <Button
          variant="contained"
          size="small"
          sx={{
            flex: '0 1 auto',
            minWidth: 140,
            textTransform: 'none',
            borderRadius: '6px',
            color: prioritized ? 'var(--confirm-ink)' : 'var(--accent-ink)',
            bgcolor: prioritized ? 'var(--confirm-ghost)' : 'var(--accent)',
            border: prioritized ? '1px solid var(--confirm-border)' : 'none',
            cursor: prioritized ? 'default' : 'pointer',
            '&:hover': { bgcolor: prioritized ? 'var(--confirm-ghost)' : 'var(--accent)', opacity: prioritized ? 1 : 0.88 },
            '&.Mui-disabled': { color: prioritized ? 'var(--confirm-ink)' : undefined, bgcolor: prioritized ? 'var(--confirm-ghost)' : undefined },
          }}
          disabled={isPrioritizing || prioritized}
          onClick={async () => {
            if (!onPriorityFlag) return;
            setIsPrioritizing(true);
            try {
              await onPriorityFlag([orderId], true);
              setPrioritized(true);
            } finally {
              setIsPrioritizing(false);
            }
          }}
        >
          {prioritized ? 'Prioritized ✓' : isPrioritizing ? 'Prioritizing…' : 'Prioritize'}
        </Button>
        <Button
          variant="outlined"
          size="small"
          endIcon={<ArrowRight size={14} />}
          onClick={() => navigate('/orders/flow')}
          sx={{ flex: '0 1 auto', minWidth: 140, borderColor: 'var(--accent-border)', color: 'var(--accent)', textTransform: 'none' }}
        >
          Go to order flow
        </Button>
      </Box>
    );
  }, [hasAnyActiveConstraint, order?.warehouseStatus, isPrioritizing, prioritized, onPriorityFlag, orderId, navigate]);
  const showInventoryResolvedBanner = !hasActiveInventoryConstraint && isSuccess;

  useEffect(() => {
    if (order) {
      onTitleReady(order.externalOrderId ? `Order #${order.externalOrderId}` : `Order #${orderId.slice(0, 8).toUpperCase()}`);
    }
  }, [order, orderId, onTitleReady]);

  useEffect(() => {
    onSubtitleReady(buildUrgencySubtitle(cachedRow));
  }, [cachedRow, onSubtitleReady]);

  useEffect(() => {
    onFooterReady(footerContent);
  }, [footerContent, onFooterReady]);

  if (isLoading || detailQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={24} sx={{ color: 'var(--accent)' }} />
      </Box>
    );
  }

  if (isRealError) {
    return <Alert severity="warning" sx={{ mb: 2 }}>Couldn't load this order's decision. Try reopening.</Alert>;
  }

  // PIPELINE STATUS PILL — three real states, in priority order, per the
  // documented flow in OrdersModule.md: constrained → /orders/blocked;
  // unconstrained + unbatched → /orders/pool; batched → real
  // order_warehouse_status. NOT verified: exact GET /decision query
  // semantics for whether constraints[] always excludes resolved rows —
  // flagged in entity-detail-modal-playbook.md §2.8, pending confirmation.
  const pipelineLabel = hasAnyActiveConstraint
    ? 'Blocked'
    : formatWarehouseStatus(order?.warehouseStatus ?? null);
  const pipelineColorKey = hasAnyActiveConstraint ? 'danger' : order?.warehouseStatus ? 'accent' : 'neutral';

  const timelineEvents = order?.timeline ?? [];
  const visibleTimeline = timelineExpanded ? timelineEvents : timelineEvents.slice(-TIMELINE_VISIBLE_COUNT).reverse();
  const hiddenTimelineCount = Math.max(0, timelineEvents.length - TIMELINE_VISIBLE_COUNT);
  const fullTimelineDescending = [...timelineEvents].reverse();
  const displayedTimeline = timelineExpanded ? fullTimelineDescending : fullTimelineDescending.slice(0, TIMELINE_VISIBLE_COUNT);

  return (
    <Box>
      {order && (
        <Box sx={{ mb: 3, pb: 2, borderBottom: '1px solid var(--rule)', display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {/*
            LEFT COLUMN — ITEMS
            Per target design (2026-07-01) + explicit layout instruction:
            top section = order details in two columns (items / customer
            + summary), "Why — activity" stays full-width below this
            block, unchanged.
          */}
          <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
              Order contents
            </Typography>
            {order.lineItems.map((item) => (
              <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75 }}>
                {item.image_url ? (
                  <Box component="img" src={item.image_url} alt=""
                    sx={{ width: 36, height: 36, borderRadius: '6px', objectFit: 'cover', flexShrink: 0, border: '1px solid var(--rule)' }} />
                ) : (
                  // VO-08: no placeholder asset exists yet — a plain
                  // bordered box avoids a broken-image icon without
                  // inventing product imagery.
                  <Box sx={{ width: 36, height: 36, borderRadius: '6px', flexShrink: 0, border: '1px solid var(--rule)', bgcolor: 'var(--bg-2)' }} />
                )}
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>{item.title}</Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>{item.sku ?? 'No SKU'} · qty {item.quantity}</Typography>
                </Box>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                  {formatCurrency(item.line_total, order.currency)}
                </Typography>
              </Box>
            ))}
          </Box>

          {/*
            RIGHT COLUMN — CUSTOMER + SUMMARY
            Customer identity sourced from orders.shipping_* (VO-01/
            VO-07) — NOT customers.email/first_name, which is
            structurally blank for most merchants (Shopify PCD scope).
            "name" here is the shipping recipient, not a verified
            account identity — do not imply otherwise in copy.
            No order-count/"returning" badge — that requires a
            customers-table join keyed on data we've confirmed is
            usually blank; not worth building on an unreliable key.
          */}
          <Box sx={{ flex: '1 1 220px', minWidth: 200 }}>
            {order.shipping.name && (
              <Box sx={{ mb: 2 }}>
                <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
                  Customer
                </Typography>
                <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>{order.shipping.name}</Typography>
                {order.shipping.address1 && (
                  <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: 0.5 }}>{order.shipping.address1}</Typography>
                )}
                {order.shipping.address2 && (
                  <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>{order.shipping.address2}</Typography>
                )}
                {(order.shipping.city || order.shipping.province || order.shipping.countryCode) && (
                  <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    {[order.shipping.city, order.shipping.province, order.shipping.countryCode].filter(Boolean).join(', ')}
                  </Typography>
                )}
              </Box>
            )}

            <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
              Summary
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.375 }}>
              <Typography sx={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Subtotal</Typography>
              <Typography sx={{ fontSize: 12.5, color: 'var(--ink)' }}>{formatCurrency(order.subtotal, order.currency)}</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.375 }}>
              <Typography sx={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Tax</Typography>
              <Typography sx={{ fontSize: 12.5, color: 'var(--ink)' }}>{formatCurrency(order.tax, order.currency)}</Typography>
            </Box>
            {/* Shipping line intentionally omitted — GH-1032, no reliable source yet */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 1, mt: 0.5, borderTop: '1px solid var(--rule)' }}>
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', textTransform: 'uppercase' }}>Total</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{formatCurrency(order.total, order.currency)}</Typography>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1.75 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>Payment status</Typography>
                <Box sx={{ px: 1.25, py: 0.375, borderRadius: '999px', fontSize: 11, fontWeight: 500, bgcolor: 'rgba(99,153,34,0.12)', color: '#3B6D11' }}>
                  {order.paymentState.replace(/_/g, ' ')}
                </Box>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>Pipeline status</Typography>
                <Box sx={{
                  px: 1.25, py: 0.375, borderRadius: '999px', fontSize: 11, fontWeight: 500,
                  bgcolor: pipelineColorKey === 'danger' ? 'rgba(226,75,74,0.12)' : pipelineColorKey === 'accent' ? 'var(--accent-ghost)' : 'var(--rule)',
                  color: pipelineColorKey === 'danger' ? '#A32D2D' : pipelineColorKey === 'accent' ? 'var(--accent)' : 'var(--ink-3)',
                }}>
                  {pipelineLabel}
                </Box>
              </Box>
            </Box>

            {order.tracking?.tracking_number && (
              <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: 1.5 }}>
                Tracking: {order.tracking.tracking_number}{order.tracking.carrier_code && ` (${order.tracking.carrier_code})`}
              </Typography>
            )}
          </Box>
        </Box>
      )}

      {timelineEvents.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
            Why — activity
          </Typography>
          <Box sx={{ borderLeft: '2px solid var(--rule)', pl: 2, ml: 0.5 }}>
            {displayedTimeline.map((event, i) => (
              <Box key={event.id} sx={{ pb: i < displayedTimeline.length - 1 ? 1.25 : 0, position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
                <Box sx={{ position: 'absolute', left: -25, top: 4, width: 8, height: 8, borderRadius: '50%', bgcolor: i === 0 ? 'var(--accent)' : 'var(--ink-4)' }} />
                <Typography sx={{ fontSize: 13, color: 'var(--ink)', flexShrink: 0 }}>{event.status.replace(/_/g, ' ')}</Typography>
                {/*
                  ORDM-04f (2026-07-02): dotted leader connects label to
                  timestamp, closing the empty-space gap flagged live —
                  was a bare flex justify-between with nothing filling
                  the middle.
                */}
                <Box sx={{ flex: 1, borderBottom: '1px dotted var(--rule)', mb: '3px', minWidth: 12 }} />
                <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', flexShrink: 0, whiteSpace: 'nowrap' }}>{new Date(event.event_occurred_at).toLocaleString()}</Typography>
              </Box>
            ))}
          </Box>
          {!timelineExpanded && hiddenTimelineCount > 0 && (
            <Button size="small" onClick={() => setTimelineExpanded(true)}
              sx={{ fontSize: 11.5, color: 'var(--accent)', textTransform: 'none', mt: 1, px: 0 }}>
              Show {hiddenTimelineCount} more
            </Button>
          )}
        </Box>
      )}

      {constraints.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
            Issue
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {constraints.map((c, i) => (
              <ConstraintAlertCard key={i} constraintType={c.constraint_type} blockType={c.block_type} />
            ))}
          </Box>

          {similarOrders.length > 0 && (
            <Box sx={{ mt: 1.5, p: 1.25, bgcolor: 'var(--accent-ghost)', border: '1px solid var(--accent-border)', borderRadius: '8px' }}>
              <Typography sx={{ fontSize: 12.5, color: 'var(--ink-2)', mb: 1 }}>
                {similarOrders.length} other order{similarOrders.length === 1 ? '' : 's'} share this exact issue —{' '}
                {formatCurrency(similarOrders.reduce((sum, o) => sum + (o.revenue ?? 0), 0), 'USD')} combined at stake
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {similarOrders.slice(0, 5).map((o) => (
                  <Box key={o.order_id} onClick={() => onNavigateToOrder(o.order_id)}
                    sx={{ display: 'flex', justifyContent: 'space-between', px: 1, py: 0.5, borderRadius: '6px', cursor: 'pointer', '&:hover': { bgcolor: 'var(--accent-border)' } }}>
                    <Typography sx={{ fontSize: 12, color: 'var(--ink)' }}>#{o.external_order_id ?? o.order_id.slice(0, 8).toUpperCase()}</Typography>
                    <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>{o.revenue != null ? formatCurrency(o.revenue, 'USD') : '—'}</Typography>
                  </Box>
                ))}
                {similarOrders.length > 5 && (
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', px: 1, mt: 0.25 }}>+{similarOrders.length - 5} more</Typography>
                )}
              </Box>
            </Box>
          )}
        </Box>
      )}

      {!hasAnyActiveConstraint && !order?.warehouseStatus && (
        <Box sx={{ mb: 3, display: 'flex', flexDirection: 'column', gap: 1.25, bgcolor: 'var(--bg-2)', borderRadius: '10px', p: 1.25 }}>
          <Box sx={{ display: 'flex', gap: 1.25 }}>
            <Clock size={16} color="var(--ink-3)" style={{ flexShrink: 0, marginTop: 1 }} />
            <Typography sx={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
              No open issues. Order is in the pool, waiting to be released into a pick batch.
            </Typography>
          </Box>
        </Box>
      )}

      {showInventoryResolvedBanner && (
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'rgba(99,153,34,0.12)', borderRadius: '10px', p: 1.25 }}>
            <Typography sx={{ fontSize: 12.5, color: '#3B6D11' }}>Stock confirmed — inventory block resolved</Typography>
          </Box>
        </Box>
      )}

      {recommendedAction && !showInventoryResolvedBanner && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
            Recommended action
          </Typography>
          {isExecError ? (
            <>
              <Alert severity="error" sx={{ mb: 1 }}>{execError?.message ?? 'Execution failed. Please try again.'}</Alert>
              <Button variant="contained" fullWidth onClick={() => execute(orderId)}
                sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}>
                {getActionLabel(recommendedAction.type)}
              </Button>
            </>
          ) : (
            <Button variant="contained" fullWidth disabled={isPending} onClick={() => execute(orderId)}
              startIcon={isPending ? <CircularProgress size={16} color="inherit" /> : recommendedAction.type === 'resolve_inventory_block' ? <ArrowRight size={16} /> : null}
              sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}>
              {isPending ? 'Processing…' : getActionLabel(recommendedAction.type)}
            </Button>
          )}

          {alternateActions.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mb: 0.75 }}>Other options</Typography>
              {alternateActions.map((a) => (
                <Button key={a.type} variant="outlined" fullWidth size="small" disabled={isPending} onClick={() => execute(orderId)}
                  sx={{ mb: 0.75, fontSize: 12.5, color: 'var(--ink-2)', borderColor: 'var(--rule)' }}>
                  {getActionLabel(a.type)}
                </Button>
              ))}
            </Box>
          )}
        </Box>
      )}

      {!exceptionsQuery.isLoading && exceptions.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
            Pick exceptions · {unresolvedExceptions.length} open
          </Typography>
          <Box sx={{ bgcolor: 'var(--bg)', border: '1px solid var(--rule)', borderRadius: '10px', overflow: 'hidden' }}>
            {exceptions.map((exc, idx) => (
              <Box key={exc.pick_exception_id} sx={{ px: 2, py: 1.5, borderTop: idx > 0 ? '1px solid var(--rule)' : 'none' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                      {exc.exception_type.replace(/_/g, ' ')} — {exc.variant_title ?? exc.sku ?? 'Unknown item'}
                    </Typography>
                    <Typography sx={{ fontSize: 11.5, color: 'var(--ink-4)', mt: 0.25 }}>
                      {exc.stage.replace(/_/g, ' ')} · Batch {exc.batch_short_id} · needed {exc.quantity_required}, found {exc.quantity_found}
                    </Typography>
                  </Box>
                  {exc.resolved ? (
                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#4CAF7A' }}>Resolved</Typography>
                  ) : (
                    <Button size="small" variant="outlined" disabled={resolveException.isPending}
                      onClick={() => resolveException.mutate({ exceptionId: exc.pick_exception_id, resolutionNote: 'Resolved from Order detail' })}
                      sx={{ fontSize: 11, color: 'var(--accent)', borderColor: 'var(--accent)' }}>
                      Resolve
                    </Button>
                  )}
                </Box>
                {exc.resolved && exc.resolution_note && (
                  <Typography sx={{ fontSize: 11.5, color: 'var(--ink-4)', mt: 0.5, fontStyle: 'italic' }}>"{exc.resolution_note}"</Typography>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

export default function OrdersFT2Page() {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [modalTitle, setModalTitle] = useState('');
  const [exportDrawerOpen, setExportDrawerOpen] = useState(false);
  const [modalSubtitle, setModalSubtitle] = useState<string | undefined>(undefined);
  const [modalFooter, setModalFooter] = useState<ReactNode>(null);
  const snapshotQuery = useOrdersFt2Snapshot();
  const operatorSummaryQuery = useOrdersOperatorSummary();
  const { displayCurrency, locale, tier } = useEntitlements();
  const { rates } = useExchangeRates();
  const bulkSetPriority = useBulkSetPriority();
  const onPriorityFlag = useCallback(
    // THREAD B (2026-06-30): consolidated from an N-call Promise.all loop
    // against the singular WMS endpoint to one call against the bulk
    // ON-01 endpoint, which now carries the same pool-membership guard.
    // `flagged` is currently always true here (Prioritize is a one-way
    // action in the UI) — kept as a no-op param for forward
    // compatibility, not wired to a deprioritise call yet.
    async (orderIds: string[], flagged: boolean) => {
      await bulkSetPriority.mutateAsync(orderIds);
    },
    [bulkSetPriority]
  );

  if (!snapshotQuery.data) {
    return <div>Loading orders insights…</div>;
  }

  const decision = snapshotQuery.data.decision;
  const operationalControl = snapshotQuery.data.operationalControl!;
  const headerProps = mapOrdersFt2Props(snapshotQuery.data, decision);

  if (__DEV__) {
    console.debug('[OrdersFT2Page] rendering OrdersModuleFT2', headerProps);
  }

  return (
    <>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />
      <OrderCapBanner />
      <OrdersModuleFT2
        {...headerProps}
        operationalControl={operationalControl}
        operatorSummary={operatorSummaryQuery.data ?? null}
        currency={{ displayCurrency, locale, rates }}
        onPriorityFlag={onPriorityFlag}
        onOrderClick={(orderId) => setSelectedOrderId(orderId)}
        // ORDM-01 FIX (2026-06-29): was a hardcoded blob-download bypassing
        // the established ExportDrawer pattern (see export_system_playbook.md
        // §6 — Orders/Overview is specced as "Export → opens drawer with
        // format picker", same as Overview's Export brief). 'orders-all' and
        // 'orders-blocked' report IDs already existed in exportReports.ts,
        // unused until now.
        onExport={async () => setExportDrawerOpen(true)}
      />
      <ExportDrawer
        open={exportDrawerOpen}
        onClose={() => setExportDrawerOpen(false)}
        userTier={tier}
        reportIds={['orders-all', 'orders-blocked']}
      />
     <EntityDetailModal
        entityId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        title={modalTitle}
        subtitle={modalSubtitle}
        maxWidth="md"
        footerActions={modalFooter}
      >
        {selectedOrderId && (
          <OrderDetailModalBody
            orderId={selectedOrderId}
            onTitleReady={setModalTitle}
            onSubtitleReady={setModalSubtitle}
            onNavigateToOrder={setSelectedOrderId}
            onFooterReady={setModalFooter}
            onPriorityFlag={onPriorityFlag}
          />
        )}
      </EntityDetailModal>
    </>
  );
}
