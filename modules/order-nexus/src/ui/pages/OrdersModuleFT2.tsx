// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx
//
// ORDERS MODULE — FT2 OPERATOR SURFACE — OPERATIONAL CONTEXT
// ─────────────────────────────────────────────────────────────
// Layout:
//   1. Header        — title + signal line + export
//   2. Body          — shared OperationalContextShell:
//                      primary Orders workspace | Order health rail
//
// RULES:
// - No hardcoded hex. CSS variables or design-system tokens only.
//   Exception: header live-dot color (#4CAF7A) — pre-existing domain token.
// - No inline style={}. MUI sx prop only.
// - No cross-module imports.
// - No fetching. All data via props.
// - Font: Plus Jakarta Sans (app default) — never set fontFamily explicitly.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { FT2TemporalProps } from '@lasyncro/ui-ft2';
import { formatCurrencyCompact, OperationalContextShell } from '@lasyncro/shared/ui';
import type { OperationalMapState } from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';
import type { OperationalEpisodeProjection } from '@lasyncro/shared/contracts/operational-episode';

// ─── PROPS ────────────────────────────────────────────────────

/**
 * D2B-RED — module-owned MINIMAL structural presentation contract for one
 * order's dominant operational-episode visual. order-nexus must not import
 * from apps/frontend (the D2A OrdersOperationalVisual type lives there), so
 * this shape is defined here instead, built only from the canonical SHARED
 * OperationalEpisodeProjection/OperationalMapState types — no second
 * lifecycle/problem model is minted. The app-owned D2A
 * OrdersOperationalVisual[] (apps/frontend/src/pages/orders/
 * ordersOperationalEpisodeVisual.ts) is structurally assignable to this
 * shape without any adapter/transformation, by construction.
 */
export interface OrdersOperationalEpisodeVisualInput {
  readonly orderId: string;
  readonly state: OperationalMapState;
  readonly glyph: '!' | '◌' | '✓';
  readonly episodeCount: number;
  readonly dominant: Pick<OperationalEpisodeProjection, 'lifecycle' | 'problem'>;
}

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
  /** Opens the shared EntityDetailModal for this order. See entity-detail-modal-playbook.md §2. */
  onOrderClick?: (orderId: string) => void;

  /**
   * Module-level export CTA.
   * Handler is owned by the app shell because export API/auth concerns live outside order-nexus.
   */
  onExport?: () => void | Promise<void>;

  /**
   * ORD-UX-01 — live Orders map surface supplied by the app shell.
   *
   * The module never decides map eligibility and never acquires floor or
   * activity data; it only leases the primary slot of the shared
   * OperationalContextShell. When absent, the same normalized composition
   * renders with an empty primary slot — there is no triage-first variant.
   */
  mapContent?: ReactNode;

  /**
   * SCREEN-ARCH — when true, the Ops Console is open and owns attention, so
   * the Order health rail withdraws. Supplied by the app shell from global
   * Ops Console state; this module never reads that state itself.
   */
  suppressOrderHealth?: boolean;

  /**
   * Canonical operational-episode lifecycle presentation for Order health.
   * One entry per order, D1/D2A-aggregated and dominant-resolved by the
   * caller — this module performs no lifecycle inference of its own.
   *
   *   null            -> lifecycle projection UNRESOLVED ("Checking
   *                      operational state"; the exact V1 legacy pairings
   *                      fail closed and are never shown as confirmed clear)
   *   []              -> resolved, no current lifecycle episodes
   *   [visuals...]    -> resolved lifecycle presentation (attention /
   *                      Verifying / Just resolved reconciliation)
   *   undefined       -> non-participating consumer; treated like []
   *
   * These semantics are identical for every primary composition — real map,
   * LiveMapTeaser, no-floor setup state, or a direct consumer with no
   * mapContent.
   */
  operationalEpisodeVisuals?: readonly OrdersOperationalEpisodeVisualInput[] | null;

  operatorSummary?: {
    constraintCounts?: { inventory: number; customer: number; operational: number };
    topBlockingType?: string | null;
    fulfillmentSla?: {
      fulfillmentSlaHours: number;
      breachedCount: number;
      breachedRevenue: number;
      approachingCount: number;
    };
    agingOrders?: Array<{
      lasyncro_order_id: string;
      externalOrderId: string | null;
      ageHours: number;
      isShippingSlaBreached: boolean;
      constraintType: string | null;
      blockType?: string | null;
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

  /**
   * Active constrained orders — the existing /api/v1/orders/constrained
   * payload (useConstrainedOrders). DR-03B2 (#1114): returned_undelivered
   * rows are explicitly EXCLUDED from admission (see
   * isMerchantActionableConstraint) — that is Returns-owned post-shipment
   * work now, not an Orders Overview decision; Returns is the sole
   * merchant-facing owner. Minimal shape — extend only as this module
   * requires.
   */
  constrainedOrders?: Array<{
    order_id: string;
    external_order_id: string | null;
    constraint_type: string;
    block_type: string | null;
    revenue?: number | string | null;
    age_since_creation_seconds?: number | null;
    is_shipping_sla_breached?: boolean | null;
  }> | null;

  currency?: CurrencyContext;
}

// ─── HELPERS ──────────────────────────────────────────────────
const fmtSlaAge = (hours: number): string => {
  const h = Math.round(hours);
  const d = Math.floor(h / 24);
  const rem = h % 24;
  if (d === 0) return `${rem}h past`;
  if (rem === 0) return `${d}d past`;
  return `${d}d ${rem}h past`;
};

// ─── ORDER HEALTH RAIL PRESENTATION ───────────────────────────
// Mirrors Overview's certified Operations Pulse rail grammar: 0.5px rule
// group separators, uppercase 10px group labels, 12.5px rows, and the same
// interactive-row treatment (6px radius, 0.12s background-color, --bg-3
// hover, 2px accent focus ring). No other motion.

const HEALTH_ROW_INTERACTIVE_SX = {
  // Native button reset — the row keeps its presentation.
  appearance: 'none',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  bgcolor: 'transparent',
  border: 'none',
  m: 0,
  // Horizontal inset offset by negative margin so the hover surface does
  // not shift content or change the group's dimensions.
  px: '8px',
  mx: '-8px',
  py: '2px',
  display: 'block',
  borderRadius: '6px',
  cursor: 'pointer',
  transition: 'background-color 0.12s',
  '&:hover': { bgcolor: 'var(--bg-3)' },
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
} as const;

function HealthGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <Box
      role="group"
      aria-label={label}
      sx={{ display: 'flex', flexDirection: 'column', gap: '6px', py: '10px', borderTop: '0.5px solid var(--rule)', '&:first-of-type': { borderTop: 'none', pt: 0 } }}
    >
      {label && (
        <Typography component="span" sx={{ display: 'block', fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: '2px' }}>
          {label}
        </Typography>
      )}
      {children}
    </Box>
  );
}

function HealthMetric({ label, value }: { label: string; value: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
      <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 400, lineHeight: 1.45, color: 'var(--ink-3)' }}>
        {label}
      </Typography>
      <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.45, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
}

function LifecycleRow({
  glyph,
  group,
  onOrderClick,
}: {
  glyph: '◌' | '✓';
  group: { label: string; orderIds: string[] };
  onOrderClick?: (orderId: string) => void;
}) {
  const text = (
    <Typography component="span" sx={{ display: 'block', fontSize: 12.5, fontWeight: 500, lineHeight: 1.45, color: 'var(--ink)' }}>
      {glyph} {group.orderIds.length} {group.label}
    </Typography>
  );
  if (group.orderIds.length === 1 && onOrderClick) {
    return (
      <Box component="button" type="button" onClick={() => onOrderClick(group.orderIds[0])} sx={HEALTH_ROW_INTERACTIVE_SX}>
        {text}
      </Box>
    );
  }
  return text;
}

// MAIN COMPONENT
export default function OrdersModuleFT2(props: OrdersModuleFT2DataProps) {
  const navigate = useNavigate();
  const [showAllRailGroups, setShowAllRailGroups] = useState(false);
  const { 
    operationalControl, 
    operatorSummary, 
    currency, 
    onExport, 
    onOrderClick,
    mapContent,
    suppressOrderHealth = false,
    operationalEpisodeVisuals
  } = props

  const fmt$ = (n: number | null | undefined): string =>
    formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  // ── Derived counts ──────────────────────────────────────────
  const qReady         = operatorSummary?.queueCounts?.readyToShip ?? operationalControl?.queue_ready_to_ship ?? 0;
  const qPicking       = operationalControl?.pending_fulfillment ?? 0;
  const constrained    = operationalControl?.constrained_orders ?? 0;
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

  // SCREEN-ARCH (C1C): a priority flag is Order Flow planning state, not a
  // resolution. It never hides an order whose SLA/aging/constraint condition
  // is still active from Order health, so no priority filtering happens here.
  const allAgingOrders = operatorSummary?.agingOrders ?? [];

  // SCREEN-ARCH (C1D): pick-batch membership is fulfillment progress, not a
  // resolution — a breached order stays represented while it is breached.
  const allBreachedOrders = allAgingOrders.filter(o => o.isShippingSlaBreached);

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
  const isMerchantActionableConstraint = (
    constraintType: string,
    blockType: string | null
  ): boolean => {
    switch (constraintType) {
      case 'inventory':
        // allocation_pending has no ratified merchant-actionable semantics
        // and is pending its own lifecycle audit — it must not silently
        // become a decision. Every other inventory block is actionable.
        return blockType !== 'allocation_pending';
      case 'customer':
        return true;
      case 'operational':
        // DR-03B2 (#1114): returned_undelivered is Returns-owned post-shipment
        // recovery, never an Orders Overview decision — Returns is the sole
        // merchant-facing owner (no "Package returned" tile here anymore,
        // and not replaced by folding it into "Operational issues" either).
        return blockType !== 'returned_undelivered';
      default:
        // An unrecognised constraint type is NOT assumed actionable. New
        // types opt in here deliberately rather than appearing by default.
        return false;
    }
  };

  // Real aging facts, keyed by order id, so a constrained row can be
  // enriched with them where they exist. Nothing is fabricated: an order
  // absent from the aging population simply has no such facts.
  const agingFactsById = new Map(
    allAgingOrders.map(o => [o.lasyncro_order_id, o] as const)
  );

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
        ageHours:
          aging?.ageHours ??
          Math.max(0, Math.floor((o.age_since_creation_seconds ?? 0) / 3600)),
        isShippingSlaBreached:
          aging?.isShippingSlaBreached ?? Boolean(o.is_shipping_sla_breached),
        // Canonical truth owns the classification, so the order lands under
        // its real issue group rather than the aging row's stale view.
        constraintType: o.constraint_type as string | null,
        blockType: (o.block_type ?? null) as string | null,
        isPriorityFlagged: aging?.isPriorityFlagged ?? false,
        inPickBatch: aging?.inPickBatch ?? false,
        pickBatchStatus: (aging?.pickBatchStatus ?? null) as string | null,
        revenue: Number(o.revenue ?? aging?.revenue ?? 0) || 0,
        timeToSlaBreachMinutes: (aging?.timeToSlaBreachMinutes ?? null) as number | null,
      };
    });

  const actionableConstrainedIds = new Set(
    actionableConstrainedOrders.map(o => o.lasyncro_order_id)
  );

  // Merge — canonical constraint ownership wins. An SLA-breached aging row is
  // admitted only when no actionable constraint already owns that order, so
  // every order id appears exactly once and lands under its blocker's group
  // rather than being double-listed under Shipping SLA breached.
  const criticalOrdersById = new Map<string, (typeof allBreachedOrders)[number]>();
  for (const o of allBreachedOrders) criticalOrdersById.set(o.lasyncro_order_id, o);
  for (const o of actionableConstrainedOrders) criticalOrdersById.set(o.lasyncro_order_id, o);
  // DR-03B2 (#1114): returned_undelivered is excluded at admission
  // (isMerchantActionableConstraint) for actionableConstrainedOrders, but
  // allAgingOrders is a SEPARATE population keyed only by SLA-breach/aging
  // facts — an order can appear there with constraintType:null even though
  // props.constrainedOrders independently marks it returned_undelivered
  // (the two populations are not guaranteed to agree, and the merge above
  // no longer lets the (now-excluded) actionable row overwrite the aging
  // row's null constraint). So the exclusion must be keyed off the ORIGINAL
  // constrainedOrders payload directly, not off whichever row happened to
  // win the merge — otherwise such an order silently reappears under
  // "Shipping SLA breached" instead of having no home at all. Returns is
  // the sole merchant-facing owner of this decision, by order id, full stop.
  const returnedUndeliveredOrderIds = new Set([
    ...(props.constrainedOrders ?? [])
      .filter(o => o.constraint_type === 'operational' && o.block_type === 'returned_undelivered')
      .map(o => o.order_id),
    ...allAgingOrders
      .filter(o => o.constraintType === 'operational' && o.blockType === 'returned_undelivered')
      .map(o => o.lasyncro_order_id),
  ]);
  const criticalOrders = [...criticalOrdersById.values()].filter(
    o => !returnedUndeliveredOrderIds.has(o.lasyncro_order_id)
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
  // SLA-CANONICAL-01C: headline truth is the uncapped live aggregate.
  // agingOrders remains a bounded inspection list and is only a compatibility
  // fallback for older/partial operator-summary payloads.
  const slaBreachedCount =
    operatorSummary?.fulfillmentSla?.breachedCount ??
    allBreachedOrders.length;
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
  const watchOrders = allAgingOrders.filter(
    o =>
      !o.isShippingSlaBreached &&
      !actionableConstrainedIds.has(o.lasyncro_order_id)
  );

  /**
   * D2B — OPERATIONAL LIFECYCLE RECONCILIATION (Order health rail).
   * ─────────────────────────────────────────────────────────────────────
   * Applies strictly AFTER `criticalGroups` (above) is established, and only
   * feeds the Order health `railGroups` built below. There is one
   * composition, so this applies whether or not mapContent is supplied.
   *
   * FAIL CLOSED: only a dominant problem of EXACTLY customer/
   * incomplete_address or inventory/oversell is ever consumed. Any other
   * problem/domain pair (in particular operational/returned_undelivered,
   * which remains Returns-owned) is ignored outright — never rendered, never
   * allowed to suppress the order's existing Orders-owned representation.
   * Supported status is decided from `dominant.problem`, never inferred from
   * `visual.glyph`.
   *
   * D1/D2A already resolve one dominant episode per order (no sibling
   * re-resolution here) — `visual.dominant.lifecycle` is used verbatim.
   *
   * NON-SPATIAL: nothing here touches mapContent, IsometricCanvas props, or
   * any location/bin/station/occupancy field.
   */
  const SUPPORTED_OPERATIONAL_EPISODE_LABELS: Record<string, string> = {
    'customer:incomplete_address': 'Address issues',
    'inventory:oversell': 'Out of stock',
  };

  function supportedOperationalEpisodeLabel(
    visual: OrdersOperationalEpisodeVisualInput
  ): string | null {
    const key = `${visual.dominant.problem.domain}:${visual.dominant.problem.type}`;
    return SUPPORTED_OPERATIONAL_EPISODE_LABELS[key] ?? null;
  }

  /**
   * D2C — THREE-STATE CONTRACT.
   *   undefined -> legacy/non-participating consumer; behaves exactly like
   *                `[]` below (no supported visuals, nothing suppressed).
   *   null      -> canonical operational lifecycle UNRESOLVED. Fail closed
   *                ONLY for the exact V1 legacy pairing (see
   *                `isExactV1LegacyRow` below) — every other row (SLA-only,
   *                other customer/inventory block types, non-V1 operational)
   *                is untouched.
   *   []/[...]  -> existing D2B reconciliation, unchanged.
   */
  const isOperationalLifecycleUnresolved = operationalEpisodeVisuals === null;

  /**
   * The EXACT legacy pairing D2C is allowed to fail-closed on while
   * unresolved — never a broader customer/inventory suppression. Matches
   * the same two pairings `SUPPORTED_OPERATIONAL_EPISODE_LABELS` recognises
   * for a real visual, but read directly off the legacy row's own
   * constraintType/blockType, since no visual exists yet to consult.
   */
  const isExactV1LegacyRow = (order: { constraintType: string | null; blockType?: string | null }): boolean =>
    (order.constraintType === 'customer' && order.blockType === 'incomplete_address') ||
    (order.constraintType === 'inventory' && order.blockType === 'oversell');

  const supportedVisualByOrderId = new Map<string, OrdersOperationalEpisodeVisualInput>();
  for (const visual of operationalEpisodeVisuals ?? []) {
    if (supportedOperationalEpisodeLabel(visual)) {
      supportedVisualByOrderId.set(visual.orderId, visual);
    }
  }

  const verifyingOrderIds = new Set<string>();
  const justResolvedOrderIds = new Set<string>();
  for (const visual of supportedVisualByOrderId.values()) {
    if (visual.dominant.lifecycle === 'verifying') verifyingOrderIds.add(visual.orderId);
    else if (visual.dominant.lifecycle === 'just_resolved') justResolvedOrderIds.add(visual.orderId);
  }

  const isReconciledOutOfDecision = (orderId: string): boolean =>
    verifyingOrderIds.has(orderId) || justResolvedOrderIds.has(orderId);

  // Rail-only reconciled groups — a verifying/just_resolved order is removed
  // from the attention groups here, and (only while the canonical lifecycle is
  // UNRESOLVED) the exact V1 legacy pairing is fail-closed too. `criticalGroups`
  // itself is never mutated.
  const railCriticalGroups = criticalGroups
    .map(group => ({
      ...group,
      orders: group.orders.filter(o => {
        if (isOperationalLifecycleUnresolved && isExactV1LegacyRow(o)) return false;
        return !isReconciledOutOfDecision(o.lasyncro_order_id);
      }),
    }))
    .filter(group => group.orders.length > 0)
    .map(group => ({
      ...group,
      revenue: group.orders.reduce((sum, order) => sum + (order.revenue ?? 0), 0),
      oldestAgeHours: Math.max(...group.orders.map(order => order.ageHours)),
    }));

  const groupHasAttentionVisual = (orderIds: string[]): boolean =>
    orderIds.some(id => supportedVisualByOrderId.get(id)?.dominant.lifecycle === 'attention');

  /**
   * Builds one rail group per supported problem label for a lifecycle
   * population (verifying / just_resolved) — same group-not-order
   * granularity as the existing rail, never a per-order row.
   */
  function buildLifecycleRailGroups(
    orderIds: ReadonlySet<string>
  ): Array<{ key: string; label: string; orderIds: string[] }> {
    const byLabel = new Map<string, string[]>();
    for (const orderId of orderIds) {
      const visual = supportedVisualByOrderId.get(orderId);
      const label = visual ? supportedOperationalEpisodeLabel(visual) : null;
      if (!label) continue;
      const existing = byLabel.get(label);
      if (existing) existing.push(orderId);
      else byLabel.set(label, [orderId]);
    }
    return [...byLabel.entries()].map(([label, ids]) => ({ key: label, label, orderIds: ids }));
  }

  const verifyingRailGroups = buildLifecycleRailGroups(verifyingOrderIds);
  const justResolvedRailGroups = buildLifecycleRailGroups(justResolvedOrderIds);

  /**
   * D2B-GREEN FOLLOW-UP — CANONICAL ATTENTION INDEPENDENCE.
   * ─────────────────────────────────────────────────────────────────────
   * A supported ATTENTION episode must not depend on constrainedOrders/
   * agingOrders independently containing the same order — operational
   * episodes are canonical lifecycle truth on their own. `criticalGroups`
   * (the ORIGINAL, pre-reconciliation population) is the dedupe authority:
   * an order already represented there is never added again here. An order
   * with a supported attention episode and NO legacy representation at all
   * is admitted by orderId only — no revenue/age/SLA fact is fabricated for
   * it, since none exists; `revenue`/`oldestAgeHours` stay `null` for a
   * brand-new episode-only group so the rail never presents an invented
   * fact as real.
   */
  const legacyOrderIdsInGroups = new Set(
    criticalGroups.flatMap(group => group.orders.map(order => order.lasyncro_order_id))
  );
  const episodeOnlyAttentionOrderIds = new Set(
    [...supportedVisualByOrderId.values()]
      .filter(visual => visual.dominant.lifecycle === 'attention' && !legacyOrderIdsInGroups.has(visual.orderId))
      .map(visual => visual.orderId)
  );
  const episodeOnlyAttentionGroups = buildLifecycleRailGroups(episodeOnlyAttentionOrderIds);

  /**
   * ORD-UX-01 — GROUP summaries for the Order health rail.
   *
   * Built from `railCriticalGroups` (D2B-reconciled — see above), same
   * commercial-consequence ordering (revenue at stake, descending), same
   * labels, with a trailing "!" glyph appended only when the group contains
   * a supported attention-lifecycle episode. Episode-only attention orders
   * (no legacy representation) merge into the matching label's group by
   * orderId, or — when no such group exists at all — form their own new
   * group with honest null revenue/age. The rail only changes the
   * PRESENTATION — one line per issue class, never per order. Aging is
   * appended last because it is imminent risk rather than a realised
   * blocker (the former Watch band's meaning).
   */
  const railGroups: Array<{
    key: string;
    label: string;
    count: number;
    revenue: number | null;
    oldestAgeHours: number | null;
    orderIds: string[];
  }> = [];

  const mergedEpisodeOnlyLabels = new Set<string>();
  for (const group of railCriticalGroups) {
    const legacyOrderIds = group.orders.map(o => o.lasyncro_order_id);
    const episodeOnlyMatch = episodeOnlyAttentionGroups.find(g => g.label === group.label);
    if (episodeOnlyMatch) mergedEpisodeOnlyLabels.add(episodeOnlyMatch.label);
    const orderIds = episodeOnlyMatch ? [...legacyOrderIds, ...episodeOnlyMatch.orderIds] : legacyOrderIds;

    railGroups.push({
      key: group.key,
      label: groupHasAttentionVisual(orderIds) ? `${group.label} !` : group.label,
      count: orderIds.length,
      revenue: group.revenue,
      oldestAgeHours: group.oldestAgeHours,
      orderIds,
    });
  }

  for (const group of episodeOnlyAttentionGroups) {
    if (mergedEpisodeOnlyLabels.has(group.label)) continue;
    railGroups.push({
      key: group.key,
      label: `${group.label} !`,
      count: group.orderIds.length,
      revenue: null,
      oldestAgeHours: null,
      orderIds: group.orderIds,
    });
  }

  if (watchOrders.length > 0) {
    railGroups.push({
      key: 'aging',
      label: 'Aging — review soon',
      count: watchOrders.length,
      revenue: watchOrders.reduce((sum, o) => sum + (o.revenue ?? 0), 0),
      oldestAgeHours: Math.max(...watchOrders.map(o => o.ageHours)),
      orderIds: watchOrders.map(o => o.lasyncro_order_id),
    });
  }

  const RAIL_GROUP_PREVIEW_LIMIT = 3;
  const visibleRailGroups = showAllRailGroups
    ? railGroups
    : railGroups.slice(0, RAIL_GROUP_PREVIEW_LIMIT);
  const hiddenRailGroupCount = railGroups.length - visibleRailGroups.length;

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

      {/* ── ORDERS OPERATIONAL CONTEXT (SCREEN-ARCH) ─────────── */}
      {/* PRIMARY: Orders workspace (map, teaser or setup state, leased from
          the app shell)  |  RAIL: Order health — state and orientation only.
          One composition for every input; there is no triage-first variant.
          The rail withdraws while the Ops Console is open. */}
      <OperationalContextShell
        primary={mapContent ?? null}
        suppressRail={suppressOrderHealth}
        rail={
          <Box
            component="section"
            role="region"
            aria-label="Order health"
            sx={{
              minWidth: 0,
              boxSizing: 'border-box',
              bgcolor: 'var(--surface)',
              border: '0.5px solid var(--rule)',
              borderRadius: '14px',
              px: '18px',
              py: '14px',
              display: 'flex',
              flexDirection: 'column',
              alignSelf: 'start',
            }}
          >
            <Typography component="h2" sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', lineHeight: 1, mb: '12px' }}>
              Order health
            </Typography>

            <HealthGroup>
              <HealthMetric label="Breached" value={slaBreachedCount} />
              <HealthMetric label="Blocked" value={constrained} />
              <HealthMetric label="Picking" value={qPicking} />
              <HealthMetric label="Fulfillable" value={qReady} />
            </HealthGroup>

            {railGroups.length > 0 && (
              <HealthGroup label="Constraints & aging">
                {visibleRailGroups.map(group => {
                  // One concrete order opens Orders inspection; a multi-order
                  // group is contextual state, not a workflow CTA.
                  const inspectable = group.orderIds.length === 1 && !!onOrderClick;
                  const contents = (
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography component="span" sx={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.45 }}>
                          {group.count} {group.label}
                        </Typography>
                        {group.oldestAgeHours != null && (
                          <Typography component="span" sx={{ display: 'block', fontSize: 11, color: 'var(--ink-4)' }}>
                            oldest {fmtSlaAge(group.oldestAgeHours)}
                          </Typography>
                        )}
                      </Box>
                      {group.revenue != null && (
                        <Typography component="span" sx={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink-3)', flexShrink: 0, fontVariantNumeric: 'tabular-nums', lineHeight: 1.6 }}>
                          {fmt$(group.revenue)}
                        </Typography>
                      )}
                    </Box>
                  );
                  return inspectable ? (
                    <Box
                      key={group.key}
                      component="button"
                      type="button"
                      onClick={() => onOrderClick!(group.orderIds[0])}
                      sx={HEALTH_ROW_INTERACTIVE_SX}
                    >
                      {contents}
                    </Box>
                  ) : (
                    <Box key={group.key}>{contents}</Box>
                  );
                })}

                {hiddenRailGroupCount > 0 && (
                  <Box
                    component="button"
                    type="button"
                    onClick={() => setShowAllRailGroups(true)}
                    sx={HEALTH_ROW_INTERACTIVE_SX}
                  >
                    <Typography component="span" sx={{ fontSize: 11.5, fontWeight: 500, color: 'var(--accent)' }}>
                      See {hiddenRailGroupCount} more
                    </Typography>
                  </Box>
                )}
              </HealthGroup>
            )}

            {/* D2C — UNRESOLVED: canonical lifecycle not yet known. Neutral
                copy only — no CTA, no navigation, no lifecycle glyph. */}
            {isOperationalLifecycleUnresolved && (
              <HealthGroup>
                <Typography component="span" sx={{ display: 'block', fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink-3)' }}>
                  Checking operational state
                </Typography>
              </HealthGroup>
            )}

            {/* D2B — Verifying / Just resolved: contextual lifecycle state.
                One order -> inspectable; more than one -> informational only. */}
            {verifyingRailGroups.length > 0 && (
              <HealthGroup label="Verifying">
                {verifyingRailGroups.map(group => (
                  <LifecycleRow key={group.key} glyph="◌" group={group} onOrderClick={onOrderClick} />
                ))}
              </HealthGroup>
            )}

            {justResolvedRailGroups.length > 0 && (
              <HealthGroup label="Just resolved">
                {justResolvedRailGroups.map(group => (
                  <LifecycleRow key={group.key} glyph="✓" group={group} onOrderClick={onOrderClick} />
                ))}
              </HealthGroup>
            )}

            {/* Contextual navigation only — release planning and execution
                belong to Order Flow. */}
            <HealthGroup>
              <Box
                component="button"
                type="button"
                onClick={() => navigate('/orders/flow')}
                sx={HEALTH_ROW_INTERACTIVE_SX}
              >
                <Typography component="span" sx={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)' }}>
                  View order flow
                </Typography>
                <Typography component="span" aria-hidden="true" sx={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)', ml: '4px' }}>
                  →
                </Typography>
              </Box>
            </HealthGroup>
          </Box>
        }
      />
    </Box>
  );
}
