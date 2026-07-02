/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/orders/OrderDetailModalBody.tsx
//
// OrderDetailModalBody
// ---------------------
// EXTRACTED (2026-07-02) from OrdersFT2Page.tsx, where it was a private,
// unexported function — OrderFlowPage.tsx needed the same "click a
// blocked order, see why + resolve it" modal body, and it couldn't be
// reused while private to another page. Moved here (apps/frontend/src/
// pages/orders/, NOT modules/shared) deliberately: this component
// orchestrates five data hooks (useOrderDecision, useExecuteOrderDecision,
// usePickExceptionsForOrder, useResolvePickException, useOrderDetail) plus
// contexts/hooks that only exist inside the apps/frontend workspace —
// modules/shared is a separate package with no access to those, confirmed
// via package.json/import audit before this move. A "presentational only"
// version in modules/shared was considered and rejected — it would mean
// re-deriving this component's business logic (pipeline status priority,
// exception filtering, similar-orders lookup) as prop-drilling from two
// separate page components, effectively a rewrite, not an extraction.
//
// Both OrdersFT2Page.tsx and OrderFlowPage.tsx now import this file
// directly (same apps/frontend workspace, same path aliases).
//
// Renders inside EntityDetailModal (@lasyncro/shared/ui) as `children`,
// and drives EntityDetailModal's `footerActions` slot via the
// onFooterReady callback prop — see that prop's own doc comment below.
import { useState, useEffect, ReactNode, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Button, CircularProgress, Alert, TextField } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { AlertCircle, AlertTriangle, ArrowRight, Clock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useOrderDecision, useExecuteOrderDecision } from './useOrderDecision';
import { useOrderDetail } from './useOrderDetail';
import {
  getConstraintLabel,
  getConstraintSeverity,
  getSlaProximity,
  getAgeLabel,
  type ConstrainedOrder,
  type ConstrainedOrdersResponse,
} from './useConstrainedOrders';
import { usePickExceptionsForOrder, useResolvePickException } from './usePickExceptionsForOrder';
import { useUpdateShippingAddress } from './useShippingAddress';
import type { OrderShipping } from './useOrderDetail';

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

/**
 * formatTimelineEventLabel (2026-07-02)
 * ----------------------------------------
 * Raw order_fulfillment_history status codes are internal state-machine
 * vocabulary, not customer-facing language — 'pending' as a first-ever
 * timeline entry reads as "pending what?" to an SMB operator, not as
 * "order was placed." Every status shown in the Order Detail modal's
 * timeline must map to a plain-English phrase here, not just have its
 * underscores swapped for spaces (event.status.replace(/_/g, ' ')).
 *
 * 'pending' specifically means "order synced from Shopify, no
 * fulfillment action taken yet" — i.e. the very first lifecycle event —
 * so it's labeled as such, not left as raw status jargon.
 *
 * Add new cases here whenever a new status value is introduced anywhere
 * upstream (order_fulfillment_history, orders.paid_at synthetic event,
 * order_warehouse_status synthetic event — see VO-02, GH-1034). Falls
 * back to the raw underscore-replaced string only for genuinely unknown
 * future statuses, so nothing silently renders blank.
 */
function formatTimelineEventLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Order placed',
    processing: 'Processing',
    partially_fulfilled: 'Partially fulfilled',
    fulfilled: 'Fulfilled',
    cancelled: 'Cancelled',
    failed: 'Fulfillment failed',
    payment_captured: 'Payment captured',
    in_release_pool: 'Released to pick batch',
    address_corrected: 'Shipping address corrected',
  };
  return labels[status] ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
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
 * buildUrgencySubtitle
 * ---------------------
 * Feeds EntityDetailModal's `subtitle` prop. Surfaces the exact numbers
 * that justified opening this order (revenue at stake, SLA breach age,
 * margin) so the operator never has to go back to the list to re-derive
 * why this order mattered.
 */
function buildUrgencySubtitle(row: ConstrainedOrder | undefined): string | undefined {
  if (!row) return undefined;
  const parts: string[] = [];
  if (row.revenue != null) parts.push(`${formatCurrency(row.revenue, 'USD')} at stake`);
  const proximity = getSlaProximity(row);
  if (proximity === 'breached') parts.push(`SLA breached · ${getAgeLabel(row)} past`);
  else if (proximity === 'warning') parts.push(`Approaching SLA · ${getAgeLabel(row)} old`);
  /**
   * OF-09 (2026-07-02): margin_pct is typed number|null but is actually
   * a string at runtime — oms.margin_pct is a Postgres DECIMAL column,
   * and knex/pg return DECIMAL as string by default, not number. Same
   * class of bug already documented elsewhere today (see
   * decision-engine-playbook.md's inventory_blocked_revenue
   * decimal-as-string note). Coerce here rather than trust the type;
   * fixing knex's serialization globally is out of scope for this fix.
   */
  if (row.margin_pct != null) parts.push(`${Number(row.margin_pct).toFixed(1)}% margin`);
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

/**
 * ShippingAddressForm
 * ---------------------
 * OF-08 (2026-07-02): the real in-app resolution path for
 * customer/incomplete_address blocks — pre-fills from whatever partial
 * shipping data already exists on the order (order.shipping, from
 * VO-01), lets the operator correct/complete it, and submits via
 * useUpdateShippingAddress. Required fields match
 * customerConstraintEvaluator.ts's own definition of "complete"
 * exactly (address1, city, zip, countryCode) — submitting anything
 * short of that would just re-trigger the same block, so the Save
 * button stays disabled until all four are filled.
 *
 * Deliberately does NOT optimistically assume the block clears —
 * reconciliation re-evaluates asynchronously (~200ms poll cycle, see
 * useShippingAddress.ts's own comment). Shows a plain "Saved" success
 * state instead of pretending the constraint is already gone.
 */
function ShippingAddressForm({
  orderId,
  currentShipping,
}: {
  orderId: string;
  currentShipping: OrderShipping | undefined;
}) {
  const [name, setName] = useState(currentShipping?.name ?? '');
  const [address1, setAddress1] = useState(currentShipping?.address1 ?? '');
  const [address2, setAddress2] = useState(currentShipping?.address2 ?? '');
  const [city, setCity] = useState(currentShipping?.city ?? '');
  const [zip, setZip] = useState(currentShipping?.zip ?? '');
  const [province, setProvince] = useState(currentShipping?.province ?? '');
  const [countryCode, setCountryCode] = useState(currentShipping?.countryCode ?? '');
  const [phone, setPhone] = useState(currentShipping?.phone ?? '');

  const updateAddress = useUpdateShippingAddress();

  const canSave = address1.trim() && city.trim() && zip.trim() && countryCode.trim();

  const fieldSx = { mb: 1.25 };

  if (updateAddress.isSuccess) {
    return (
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'var(--confirm-ghost)', border: '1px solid var(--confirm-border)', borderRadius: '10px', p: 1.25 }}>
        <Typography sx={{ fontSize: 12.5, color: 'var(--confirm-ink)' }}>
          Address saved. This order will clear automatically once it's re-checked — no further action needed.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 3 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
        Correct shipping address
      </Typography>

      {updateAddress.isError && (
        <Alert severity="error" sx={{ mb: 1.25 }}>
          {updateAddress.error?.message ?? 'Could not save the address. Please try again.'}
        </Alert>
      )}

      <TextField size="small" fullWidth label="Recipient name" value={name} onChange={(e) => setName(e.target.value)} sx={fieldSx} />
      <TextField size="small" fullWidth required label="Address line 1" value={address1} onChange={(e) => setAddress1(e.target.value)} sx={fieldSx} />
      <TextField size="small" fullWidth label="Address line 2 (optional)" value={address2} onChange={(e) => setAddress2(e.target.value)} sx={fieldSx} />
      <Box sx={{ display: 'flex', gap: 1.25, mb: 1.25 }}>
        <TextField size="small" fullWidth required label="City" value={city} onChange={(e) => setCity(e.target.value)} />
        <TextField size="small" fullWidth label="State / Province" value={province} onChange={(e) => setProvince(e.target.value)} />
      </Box>
      <Box sx={{ display: 'flex', gap: 1.25, mb: 1.75 }}>
        <TextField size="small" fullWidth required label="ZIP / Postal code" value={zip} onChange={(e) => setZip(e.target.value)} />
        <TextField size="small" fullWidth required label="Country code" placeholder="US" value={countryCode} onChange={(e) => setCountryCode(e.target.value.toUpperCase())} />
      </Box>
      <TextField size="small" fullWidth label="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} sx={fieldSx} />

      <Button
        variant="contained"
        fullWidth
        disabled={!canSave || updateAddress.isPending}
        onClick={() =>
          updateAddress.mutate({
            orderId,
            name: name.trim() || undefined,
            address1: address1.trim(),
            address2: address2.trim() || undefined,
            city: city.trim(),
            zip: zip.trim(),
            province: province.trim() || undefined,
            countryCode: countryCode.trim(),
            phone: phone.trim() || undefined,
          })
        }
        sx={{ bgcolor: 'var(--accent)', color: 'var(--accent-ink)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}
      >
        {updateAddress.isPending ? 'Saving…' : 'Save address'}
      </Button>
    </Box>
  );
}

export function OrderDetailModalBody({
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

  /**
   * OF-10 (2026-07-02): two real bugs fixed here.
   * (a) getQueriesData({ queryKey: ['orders', 'constrained'] })
   * prefix-matches ALL cached variants — the real key includes
   * { page, limit, constraint_type } (see useConstrainedOrders.ts), so
   * the same order can legitimately exist in multiple cached variants
   * (e.g. an unfiltered list AND a constraint_type-filtered list both
   * containing it). Flattening without dedup produced the same order
   * appearing 2-3x in "similar orders" — deduped by order_id here.
   * (b) revenue is `o.total_price`, a Postgres DECIMAL column returned
   * as a string by knex/pg, not a number despite its TS type — same
   * class of bug as margin_pct (see buildUrgencySubtitle above).
   * Coerced at the read site, same pattern.
   */
  const allConstrainedRaw = queryClient
    .getQueriesData<ConstrainedOrdersResponse>({ queryKey: ['orders', 'constrained'] })
    .flatMap(([, d]) => d?.data ?? []);
  const allConstrained = Array.from(
    new Map(allConstrainedRaw.map((o) => [o.order_id, o])).values()
  );
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
                <Typography sx={{ fontSize: 13, color: 'var(--ink)', flexShrink: 0 }}>{formatTimelineEventLabel(event.status)}</Typography>
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
                {formatCurrency(similarOrders.reduce((sum, o) => sum + Number(o.revenue ?? 0), 0), 'USD')} combined at stake
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

      {/*
        OF-08 (2026-07-02): customer/incomplete_address blocks get a
        real in-app resolution form instead of the generic execute
        button — resolve_customer_block's own handler is a documented
        manual no-op (resolve_customer_block.handler.ts), so the old
        button never actually did anything. All other recommended
        actions keep the original execute-button behavior, unchanged
        below.
      */}
      {recommendedAction?.type === 'resolve_customer_block' && !showInventoryResolvedBanner ? (
        <ShippingAddressForm
          orderId={orderId}
          currentShipping={order?.shipping}
        />
      ) : recommendedAction && !showInventoryResolvedBanner && (
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