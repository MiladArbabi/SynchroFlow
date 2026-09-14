/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx
//
// ORDER FLOW
// ==========
// 3-column board for the outbound order lifecycle, read left to right:
// Blocked orders → Order pool → Fulfillment.
//
// LAYOUT
// ------
//   ┌───────────────────────────── header ─────────────────────────────┐
//   │ Order Flow · summary line                                        │
//   └───────────────────────────────────────────────────────────────────┘
//   ┌── BLOCKED ───────┐ ┌── ORDER POOL ───────────────┐ ┌── FULFILLMENT ──┐
//   │ persistent,      │ │ pool table + wave builder     │ │ read-only       │
//   │ reason-tagged    │ │ (release queue)                │ │ 4-stage stepper │
//   │ list             │ │                                 │ │ pick→pack→ship │
//   └──────────────────┘ └─────────────────────────────────┘ └─────────────────┘
//
// Grid is conditionally 2 or 3 columns: blockedCount === 0 collapses the
// Blocked column entirely (see the grid wrapper below).
//
// COLUMN NOTES
// ------------
//   - Blocked: orders are grouped into sections by reason category
//     (blockedByReason — Operational hold / Out of Stock / Address Issue,
//     CONSTRAINT_LABELS in useConstrainedOrders.ts), one label per card.
//     Each card also shows a CPT-bucket indicator (overdue/today/ahead —
//     see DATA CAVEATS) as a separate time signal. 'operational' was
//     previously labeled "Overdue" (collided with this CPT badge), then
//     "Pick Exception" (RETURNS-BOUNDARY-01, 2026-09-14: wrong — the
//     evaluator producing it is permanently inert and the dominant real
//     cause is returned_undelivered, an internal Order Pool release guard
//     that is now filtered out of this column entirely, not a pick
//     exception). Now a neutral "Operational hold" for the rare residual
//     case (see useConstrainedOrders.ts and blockedOrders above).
//   - Order pool: table + wave builder, feeds batch release via
//     useOrderPool.ts / pickBatch.service.ts.
//   - Fulfillment: read-only — all batch-lifecycle actions are scan-gated
//     and owner-gated server-side (wms.controller.ts), so there is no
//     manager override here. Sourced from usePickBatches.ts. Stalled-batch
//     signal not yet wired (planned: alerts table / wms_operator_idle,
//     see idleAlert.service.ts).
//
// DATA CAVEATS
//   - CPT buckets are computed from order age vs today's cutoff, because
//     per-order promised_ship_by is not yet written (all-NULL). Per-order
//     ship-by support lands in a later slice.
//   - picking/packing counts are parked in the "today" column until
//     per-batch deadlines exist.

import { type ChangeEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { SpotlightCoachMark } from '@lasyncro/shared/ui';
import { useSpotlight } from '../../hooks/useSpotlight';
import { useSearchParams } from 'react-router-dom';
import { Box, Typography, CircularProgress, Checkbox, useTheme, Collapse } from '@mui/material';
import { Clock, Flag, ChevronDown, ChevronUp, X } from 'lucide-react';
import { EntityDetailModal } from '@lasyncro/shared/ui';
import { OrderDetailModalBody } from '../orders/OrderDetailModalBody';
import { BatchDetailModalBody } from './BatchDetailModalBody';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { 
  getAgeLabel, 
  getBlockerReason, 
  getConstraintLabel, 
  useConstrainedOrders 
} from '../orders/useConstrainedOrders';
import {
  useOrderPool,
  useReleaseBatch,
  useSetPriority,
  useBulkSetPriority,
  type PoolOrder,
  type SkippedReleaseOrder,
  NewlyBlockedOrder,
} from '../wms/useOrderPool';
import { comparePoolOrders, type PoolSortField } from './orderPoolSorting';
import { useCancelBatch, usePickBatches } from '../wms/usePickBatches';
import { useWmsOperators } from '../wms/useWmsOperators';
import { useLiveCapacity } from '../wms/useWmsAnalytics';

// ---------------------------------------------------------------------------
// Formatting + bucketing helpers (pure, render-independent)
// ---------------------------------------------------------------------------

/** USD currency formatter for held/at-risk revenue figures. */
const fmt$ = (value: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

/** Order-value formatter that respects the order's own currency. */
const fmtOrderValue = (price: number, currency: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price);

type CptBucket = 'overdue' | 'today' | 'ahead';

type BlockedReasonKey = 'operational' | 'inventory' | 'customer' | 'unknown';

const BLOCKED_REASON_KEYS: readonly BlockedReasonKey[] = [
  'operational',
  'inventory',
  'customer',
  'unknown',
];

/**
 * Classify an order into a CPT (carrier pick-up time) bucket.
 *
 * Until per-order promised_ship_by is written, "deadline" is approximated by
 * the shop-wide hours_to_cpt: an order older than that window is treated as
 * due "today", a fresh order is "ahead", and anything past cutoff is "overdue".
 */
const bucketByCpt = (
  createdAtIso: string,
  hoursToCpt: number | null,
): CptBucket => {
  if (hoursToCpt == null || hoursToCpt <= 0) return 'overdue';
  const ageHours = (Date.now() - new Date(createdAtIso).getTime()) / 3_600_000;
  return ageHours >= hoursToCpt ? 'today' : 'ahead';
};

/** Compact age label, e.g. "7h" or "3d". */
const ageLabel = (iso: string): string => {
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

/** Raw age in whole hours — used to flag rows older than 48h. */
const ageHoursFrom = (iso: string): number =>
  Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);

/** Human label for an order skipped during release (shown in the success banner). */
const formatSkippedOrder = (order: SkippedReleaseOrder): string => {
  const orderLabel = order.external_order_id
    ? `#${order.external_order_id}`
    : order.order_id.slice(0, 8).toUpperCase();

  return `${orderLabel} · ${order.label}`;
};

/** Order number for an order release moved to Blocked (FLOW-INVENTORY-TRIGGER-GAP-01). */
const formatNewlyBlockedOrder = (order: NewlyBlockedOrder): string =>
  order.external_order_id
    ? `#${order.external_order_id}`
    : order.order_id.slice(0, 8).toUpperCase();

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function OrderFlowPage() {
  const theme = useTheme();

  // --- Data hooks -----------------------------------------------------------
  const constrainedQuery = useConstrainedOrders({ limit: 50 });
  const orderPoolQuery = useOrderPool();
  const pickBatchesQuery = usePickBatches({ refetchInterval: 10_000 });
  const liveCapacityQuery = useLiveCapacity();
  const releaseBatch = useReleaseBatch();
  const cancelBatch = useCancelBatch();
  const setPriority = useSetPriority();
  const spotlightOrderFlowWave = useSpotlight('order_flow_wave');
  // ONB-ORD1: step 2 of the fulfillment coaching arc (pool → release → floor).
  // Renders once a batch exists; key is free-form server-side (user-state.controller.ts:166).
  const spotlightOrderFlowBatch = useSpotlight('order_flow_batch');

  /**
   * OF-08 (2026-07-02) — Blocked-order resolution path.
   * Reuses the exact same modal + body component as OrdersFT2Page.tsx
   * (extracted to orders/OrderDetailModalBody.tsx specifically so both
   * pages could share it — see that file's header comment). onPriorityFlag
   * reuses useBulkSetPriority (the same bulk endpoint OrdersFT2Page.tsx's
   * own Prioritize action calls), not the single-order useSetPriority
   * already in this file (that one is for the pool table's row-level flag
   * toggle, different call shape).
   */
  const bulkSetPriority = useBulkSetPriority();
  const onPriorityFlag = useCallback(
    async (orderIds: string[], _flagged: boolean) => {
      await bulkSetPriority.mutateAsync(orderIds);
    },
    [bulkSetPriority]
  );
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const handleCloseOrderDetail = useCallback(() => {
    setSelectedOrderId(null);
  }, []);
  const [modalTitle, setModalTitle] = useState('');
  const [modalSubtitle, setModalSubtitle] = useState<string | undefined>(undefined);
  const [modalFooter, setModalFooter] = useState<ReactNode>(null);
  const { data: operatorsData } = useWmsOperators();

  const operators = operatorsData?.operators ?? [];
  /**
   * RETURNS-BOUNDARY-01: returned_undelivered is an internal Order Pool
   * release guard (order_constraints.constraint_type='operational',
   * block_type='returned_undelivered'), not a merchant-facing pre-fulfillment
   * blocker. It stays written for release-safety (HO-2026-09-14-05 proved
   * it can be the sole reason an order is excluded from the pool) but must
   * not render here — Order Flow / Blocked Orders is pre-fulfillment
   * blockers only. Its merchant-facing action/visibility lives in Returns
   * (Order Detail's "Review return" CTA and the Returns Items/Overview
   * tabs already route there independently of this filter — see
   * orders.decision-by-order.controller.ts and OrderDetailModalBody.tsx,
   * both untouched by this filter).
   *
   * Dropped ONLY when it is the order's sole active constraint
   * (other_blocker_types empty). The backend elects operational first by
   * precedence (orders.constrained.controller.ts), so an order that also
   * carries a real customer/inventory block would otherwise be hidden
   * entirely by a naive filter — other_blocker_types is exactly the
   * signal that a real blocker is still present, and that row is kept
   * as-is so the real blocker stays visible (FLOW-MULTIBLOCK-01 invariant:
   * an order with both a real blocker and this guard remains blocked for
   * the real blocker only).
   *
   * Filtered client-side, not server-side: /api/v1/orders/constrained is
   * also consumed by OrdersModuleFT2 (modules/order-nexus), which already
   * has its own correct, tested "Package returned" handling and depends on
   * receiving these rows.
   */
  const blockedOrders = useMemo(
    () => (constrainedQuery.data?.data ?? []).filter((order) => {
      const isReturnedUndeliveredGuard =
        order.constraint_type === 'operational' && order.block_type === 'returned_undelivered';
      const hasOtherRealBlocker = (order.other_blocker_types?.length ?? 0) > 0;
      return !isReturnedUndeliveredGuard || hasOtherRealBlocker;
    }),
    [constrainedQuery.data],
  );
  const poolOrders = useMemo(() => orderPoolQuery.data?.orders ?? [], [orderPoolQuery.data]);
  const batches = useMemo(() => pickBatchesQuery.data?.batches ?? [], [pickBatchesQuery.data]);
  const selectedBatch = useMemo(
    () => batches.find((batch) => batch.pick_batch_id === selectedBatchId) ?? null,
    [batches, selectedBatchId],
  );
  // --- Deep-link params: ?constraint=<type> auto-expands its accordion
  // section; ?urgency=sla_breach filters to order_age_snapshot's real
  // is_shipping_sla_breached flag. See cta-deeplink-playbook.md §3 — these
  // are intentionally NOT the same as bucketByCpt/CptBucket below, which is
  // a separate, capacity-relative concept.
  const [searchParams] = useSearchParams();
  const constraintParam = searchParams.get('constraint');
  const urgencyFilter = searchParams.get('urgency') === 'sla_breach';
  // ISS-RQ-02: revenue_at_risk deep-link context — no order filtering, banner only.
  const revenueBlockedContext = searchParams.get('context') === 'revenue_blocked';

  // --- Cross-linking: pool cell → pool-table filter ------------------------
  // Clicking a POOL cell filters the pool table to that bucket.
  const [cptFilter, setCptFilter] = useState<{ bucket: CptBucket; stage: 'pool' } | null>(null);
  /**
   * OF-01/02/03 (2026-07-02) — Order Pool sort/filter/pagination
   * ----------------------------------------------------------------
   * Deliberately separate from cptFilter above — that's a cross-link
   * mechanism driven by clicking a matrix cell elsewhere on the page
   * (see cta-deeplink-playbook.md §5), not an in-table operator control.
   * These are new, genuinely in-table controls, additive alongside it.
   *
   * Sort fields deliberately exclude is_priority_flagged/
   * is_shipping_sla_breached — those are release-order flags already
   * fixed server-side (pickBatch.service.ts's
   * is_priority_flagged DESC, is_shipping_sla_breached DESC,
   * order_created_at ASC — see cta-deeplink-playbook.md §6). Letting
   * operators freely re-sort by that same dimension here would wrongly
   * imply they can reorder release priority from this table. They're
   * exposed as filter toggles instead (statusFilter below), consistent
   * with how they already render as inline badges, not sortable data.
   */
  const [sortField, setSortField] = useState<PoolSortField>('age');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [statusFilter, setStatusFilter] = useState<Set<'priority' | 'sla_breached'>>(new Set());
  // ISS-RQ-05: dismissible intent banner — shown only on deep-linked urgency/constraint landings.
  const [intentBannerDismissed, setIntentBannerDismissed] = useState(false);
  // ISS-OP-02: order pool search — wired into filteredPool chain below.
  const [poolSearch, setPoolSearch] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const handleSort = useCallback((field: PoolSortField) => {
    setSortField((prevField) => {
      if (prevField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortDir('asc');
      }
      return field;
    });
    setPage(1); // per modules-ux-playbook.md §6: always reset to page 1 on sort change
  }, []);
  const toggleStatusFilter = useCallback((key: 'priority' | 'sla_breached') => {
    setPage(1);
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setPage(1); // reset to page 1 on filter change, per §6
  }, []);
  /**
   * OF-05 (2026-07-02) — See-more reveal for Blocked Orders groups.
   * Separate state from the single-open accordion state below — this
   * toggles preview-vs-full within the currently open section.
   * TRIAGE_PREVIEW_LIMIT = 3 per
   * updated app-wide standard (modules-ux-playbook.md, was 4).
   */
  const TRIAGE_PREVIEW_LIMIT = 3;
  const [revealedGroups, setRevealedGroups] = useState<Set<string>>(new Set());
  const toggleRevealed = useCallback((key: string) => {
    setRevealedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const poolBucket = useCallback(
    (o: PoolOrder): CptBucket => bucketByCpt(o.order_created_at, liveCapacityQuery.data?.hours_to_cpt ?? null),
    [liveCapacityQuery.data],
  );

  const filteredPool = useMemo(
    () => poolOrders.filter(o => {
      // ISS-OP-02: search filter — matches external order id or internal id prefix.
      if (poolSearch.trim()) {
        const q = poolSearch.toLowerCase();
        const matchesId = (o.external_order_id ?? '').toLowerCase().includes(q) ||
                          o.lasyncro_order_id.toLowerCase().includes(q);
        if (!matchesId) return false;
      }
      return (
        (!cptFilter || poolBucket(o) === cptFilter.bucket) &&
        (!urgencyFilter || o.is_shipping_sla_breached) &&
        (!statusFilter.has('priority') || o.is_priority_flagged) &&
        (!statusFilter.has('sla_breached') || o.is_shipping_sla_breached)
      );
    }),
    [poolOrders, cptFilter, poolBucket, urgencyFilter, statusFilter, poolSearch],
  );

  // The operator's Age/Value/Lines/Units choice is a tiebreaker INSIDE a
  // Priority/SLA tier, never a replacement for the backend's urgency
  // ranking — see orderPoolSorting.ts.
  const sortedPool = useMemo(
    () => [...filteredPool].sort(comparePoolOrders(sortField, sortDir)),
    [filteredPool, sortField, sortDir],
  );

  // OF-03: pagination — was fully unbounded (visiblePool.map with no
  // slice), fine at today's low order volume but breaks at real scale.
  // Follows modules-ux-playbook.md §6's canonical pattern exactly.
  const poolTotalPages = Math.ceil(sortedPool.length / perPage);
  const visiblePool = useMemo(
    () => sortedPool.slice((page - 1) * perPage, page * perPage),
    [sortedPool, page, perPage],
  );

  // --- Blocked column CPT-bucket indicator (overdue / today / ahead) -------
  const blockedBucket = useCallback(
    (o: { age_since_creation_seconds: number | null; is_shipping_sla_breached: boolean | null }): CptBucket => {
      if (o.is_shipping_sla_breached) return 'overdue';
      const createdIso = new Date(Date.now() - (o.age_since_creation_seconds ?? 0) * 1000).toISOString();
      return bucketByCpt(createdIso, liveCapacityQuery.data?.hours_to_cpt?? null);
    },
    [liveCapacityQuery.data],
  );

  // --- Blocked column: group by reason category (constraint_type)----------
  // Canonical constraint types currently emitted by the evaluators are
  // inventory | customer | operational. The DB column itself is text, so an
  // unexpected value is a contract break rather than an enum rejection:
  // log it and bucket it separately instead of silently miscategorizing it.
  // urgencyFilter (?urgency=sla_breach) narrows to real SLA-breached orders
  // only, independent of which constraint group they fall into.
  const blockedForDisplay = useMemo(
    () => (urgencyFilter ? blockedOrders.filter(o => o.is_shipping_sla_breached) : blockedOrders),
    [blockedOrders, urgencyFilter],
  );

  const blockedByReason = useMemo(() => {
    const grouped: Record<'inventory' | 'customer' | 'operational' | 'unknown', typeof blockedOrders> = {
      inventory: [],
      customer: [],
      operational: [],
      unknown: [],
    };

    blockedForDisplay.forEach((order) => {
      const key = order.constraint_type;
      if (key === 'inventory' || key === 'customer' || key === 'operational') {
        grouped[key].push(order);
      } else {
        console.error('[ORDER_FLOW] Unrecognized constraint_type — check order_constraints enum', {
          orderId: order.order_id,
          constraintType: key,
        });
        grouped.unknown.push(order);
      }
    });

    return grouped;
  }, [blockedForDisplay]);

  /**
   * OF-UX-02 (2026-08-14)
   * ---------------------
   * Preserve the backend's authoritative urgency ordering at group level.
   * The category owning the first ranked blocked order appears first; later
   * categories follow the position of their highest-ranked member.
   *
   * This is deliberately separate from multi-blocker election precedence,
   * which determines the primary blocker for ONE order.
   */
  const orderedBlockedReasonKeys = useMemo<BlockedReasonKey[]>(() => {
    const seen = new Set<BlockedReasonKey>();
    const ordered: BlockedReasonKey[] = [];

    blockedForDisplay.forEach((order) => {
      const key: BlockedReasonKey =
        order.constraint_type === 'operational' ||
        order.constraint_type === 'inventory' ||
        order.constraint_type === 'customer'
          ? order.constraint_type
          : 'unknown';

      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    });

    return ordered;
  }, [blockedForDisplay]);

  /**
   * OF-UX-02: one blocker group is expanded at a time.
   *
   * A valid ?constraint=<type> deep link takes precedence. Otherwise the
   * highest-ranked non-empty category is the initial visible work surface.
   */
  const [expandedReason, setExpandedReason] = useState<BlockedReasonKey | null>(
    () =>
      BLOCKED_REASON_KEYS.includes(constraintParam as BlockedReasonKey)
        ? (constraintParam as BlockedReasonKey)
        : null
  );

  useEffect(() => {
    if (BLOCKED_REASON_KEYS.includes(constraintParam as BlockedReasonKey)) {
      setExpandedReason(constraintParam as BlockedReasonKey);
    }
  }, [constraintParam]);

  const activeExpandedReason =
    expandedReason && blockedByReason[expandedReason].length > 0
      ? expandedReason
      : orderedBlockedReasonKeys[0] ?? null;


  // --- Wave selection + release state --------------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [operatorId, setOperatorId] = useState<string>('');
  // SHOP-REV-03 (2026-08-06): surfaces release failures. Cleared on each attempt.
  const [releaseError, setReleaseError] = useState<string | null>(null);

  /**
   * BATCH-CANCEL-UNCLAIMED-01: cancellation stays inline on the pending
   * fulfillment card so a destructive action never hides its consequence.
   */
  const [cancelConfirmBatchId, setCancelConfirmBatchId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<{
    batchId: string;
    message: string;
  } | null>(null);

  const [releaseSuccess, setReleaseSuccess] = useState<{
    batchId: string | null;
    orderCount: number;
    skippedOrders: SkippedReleaseOrder[];
  } | null>(null);

  /**
   * FLOW-INVENTORY-TRIGGER-GAP-01
   * Orders that release moved to Blocked. Kept separate from
   * releaseSuccess and NOT auto-cleared: releaseSuccess is a transient
   * receipt for something that went right, this is a state change the
   * merchant may need to act on. Dismissed explicitly.
   */
  const [newlyBlocked, setNewlyBlocked] = useState<NewlyBlockedOrder[]>([]);
  /** O(1) lookup for the arrival highlight — see the blocked card's animation. */
  const newlyBlockedIds = useMemo(
    () => new Set(newlyBlocked.map((o) => o.order_id)),
    [newlyBlocked],
  );

  const isLoading =
    constrainedQuery.isLoading ||
    orderPoolQuery.isLoading ||
    pickBatchesQuery.isLoading;

  const isError =
    constrainedQuery.isError ||
    orderPoolQuery.isError ||
    pickBatchesQuery.isError;

  // --- Header summary figures ----------------------------------------------
  const poolSummary = orderPoolQuery.data?.summary;
  const blockedCount = blockedOrders.length;
  const heldRevenue = blockedOrders.reduce((sum, order) => sum + Number(order.revenue ?? 0), 0);
  const readyCount = orderPoolQuery.data?.eligible_order_count ?? poolOrders.length;
  /**
   * POOL-VIS-01: the page header states held revenue for blocked orders, so a
   * merchant could see what was stuck in money terms but not what was ready to
   * ship. Pool rows carry total_price (useOrderPool.ts:27) — a different field
   * from blockedOrders.revenue, same meaning.
   */
  const releasableRevenue = poolOrders.reduce(
    (sum, order) => sum + Number(order.total_price ?? 0), 0
  );
  const inBatchOrderCount = poolSummary?.in_batch_order_count ?? 0;
  /**
   * BL-06a (2026-08-09): falls back to 0, not blockedCount.
   *
   * blockedCount is blockedOrders.length — ALL constrained orders.
   * blocked_count is constrained AND unbatched (wms.controller.ts:2540).
   * Substituting one for the other made the chip display an
   * all-constrained figure under a label promising an unbatched filter.
   * A zero reads as "no data yet"; a wrong number under a precise label
   * does not. Matches the sibling counts above and below, which already
   * fall back to 0.
   */
  const poolBlockedCount = poolSummary?.blocked_count ?? 0;
  const fulfilledCount = poolSummary?.fulfilled_count ?? 0;
  const activeBatchCount = poolSummary?.active_batch_count ?? batches.length;

  // --- Next-wave derived totals --------------------------------------------
  // If the user has hand-selected orders, the wave previews that subset;
  // otherwise it previews the whole eligible pool.
  const selectedOrders = poolOrders.filter(order => selected.has(order.lasyncro_order_id));
  const useSubset = selected.size > 0;
  const waveOrders = useSubset ? selected.size : poolOrders.length;
  const waveSource = useSubset ? selectedOrders : poolOrders;
  const waveLineItems = waveSource.reduce((sum, order) => sum + order.line_item_count, 0);
  const waveUnits = waveSource.reduce((sum, order) => sum + order.unit_count, 0);
  const maxLineItems = orderPoolQuery.data?.max_batch_line_items ?? 108;
  const releaseDisabled = waveOrders === 0 || releaseBatch.isPending;
   // ONB-ORD1: the fulfillment coaching arc is a phase function over app state,
  // not a click-chain. One mark stays mounted and its content follows the user
  // (pool → selected → floor) so acting on step 1 never blanks the panel.
  // Dismissal stays per-key: giving up in the pool phase still leaves the
  // floor beat available once a wave actually exists.
  const fulfillmentCoach = useMemo(() => {
    if (batches.length > 0) {
      return {
        step: 2,
        title: 'Your wave is on the floor',
        body: 'Track each batch as it moves through picking and packing. Tap a batch for detail.',
        isDismissed: spotlightOrderFlowBatch.isDismissed,
        dismiss: spotlightOrderFlowBatch.dismiss,
      };
    }
    if (selected.size > 0) {
      return {
        step: 1,
        title: 'Ready when you are',
        body: `Hit Release ${selected.size} order${selected.size === 1 ? '' : 's'} to send this wave to the floor.`,
        isDismissed: spotlightOrderFlowWave.isDismissed,
        dismiss: spotlightOrderFlowWave.dismiss,
      };
    }
    return {
      step: 1,
      title: 'Select orders to release',
      body: 'Check orders in the pool to choose what goes to the floor, or release all at once.',
      isDismissed: spotlightOrderFlowWave.isDismissed,
      dismiss: spotlightOrderFlowWave.dismiss,
    };
  }, [
    batches.length,
    selected.size,
    spotlightOrderFlowWave.isDismissed, spotlightOrderFlowWave.dismiss,
    spotlightOrderFlowBatch.isDismissed, spotlightOrderFlowBatch.dismiss,
  ]);

  // --- Selection + release handlers ----------------------------------------
  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected(prev =>
      prev.size === poolOrders.length && poolOrders.length > 0
        ? new Set()
        : new Set(poolOrders.map(order => order.lasyncro_order_id)),
    );
  }, [poolOrders]);

  const handleRelease = async () => {
    setReleaseError(null);
    try {
      const result = await releaseBatch.mutateAsync({
        priority_order_ids: selected.size > 0 ? [...selected] : undefined,
        exclusive: selected.size > 0 ? true : undefined,
        assigned_operator_id: operatorId ? Number(operatorId) : undefined,
      });

      /**
       * SHOP-REV-03 (2026-08-06): httpReleaseBatch returns HTTP 200 with a bare
       * { message } body when releaseBatch() resolves null. That resolves the
       * promise, so this fell into the success banner and rendered
       * "undefined orders released" — indistinguishable from a dead button.
       * A missing order_count is not a success.
       */
      if (typeof result?.order_count !== 'number') {
        setReleaseError('No batch was created — no orders were eligible for release.');
        return;
      }

      setSelected(new Set());
      setOperatorId('');
      setReleaseSuccess({
        batchId: result.pick_batch_id,
        orderCount: result.order_count,
        skippedOrders: result.skipped_orders ?? [],
      });
      setNewlyBlocked(result.newly_blocked_orders ?? []);
      setTimeout(() => setReleaseSuccess(null), 9000);
    } catch (err) {
      /**
       * SHOP-REV-03: this catch was empty, deferring to "releaseBatch.isError
       * in the wave builder". OF-10 (2026-07-21) removed that builder and the
       * error surface went with it. The page-level isError union covers the
       * three read queries only, never this mutation — so a 500 from
       * /wms/batch/release rendered nothing at all. Shopify review ref 102766
       * cited exactly this as an unresponsive button.
       */
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err instanceof Error ? err.message : 'Unknown error');
      setReleaseError(message);
    }
  };

  const handleCancelBatch = async (batchId: string) => {
    setCancelError(null);

    try {
      await cancelBatch.mutateAsync(batchId);
      setCancelConfirmBatchId(null);
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err instanceof Error ? err.message : 'Unknown error');

      setCancelError({ batchId, message });
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <Box
      sx={{
        bgcolor: 'var(--bg)',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
     <ModuleTabBar tabs={ORDERS_MODULE_TABS} />
      <Box
        sx={{
          p: '20px 28px',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* ---------- Header: title + live summary + pool-filter chip ---------- */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            mb: 2,
            flexShrink: 0,
          }}
        >
          <Box>
            <Typography
              sx={{
                fontSize: 26,
                fontWeight: 700,
                color: 'var(--ink)',
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                mb: 0.375,
              }}
            >
              Order Flow
            </Typography>

            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
              {isLoading
                ? 'Loading live order flow…'
                : `${blockedCount} blocked · ${fmt$(heldRevenue)} held · ${readyCount} in order pool · ${activeBatchCount} batch${activeBatchCount !== 1 ? 'es' : ''} active`}
            </Typography>

            {/* Active pool filter (set by clicking a pool cell in the matrix). */}
            {cptFilter && (
              <Box
                onClick={() => setCptFilter(null)}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.75,
                  mt: 1,
                  px: 1.25,
                  py: 0.5,
                  bgcolor: 'var(--accent-ghost)',
                  border: '1px solid var(--accent-border)',
                  borderRadius: '999px',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: 'var(--accent)',
                  textTransform: 'capitalize',
                }}
              >
                {cptFilter.bucket} · pool
                <Box component="span" sx={{ fontSize: 14, lineHeight: 1, color: 'var(--ink-3)' }}>✕</Box>
              </Box>
            )}
          </Box>
        </Box>

        {/* ---------- Error + loading states ---------- */}
        {isError && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              px: 2,
              py: 1.25,
              mb: 3,
              bgcolor: 'var(--accent-ghost)',
              border: '1px solid var(--accent-border)',
              borderRadius: '10px',
            }}
          >
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-2)' }}>
              Couldn’t load part of the order flow. Refresh to retry.
            </Typography>
          </Box>
        )}

        {/* FLOW-INVENTORY-TRIGGER-GAP-01
            Orders the release attempt moved out of the pool and into Blocked
            because their stock was gone. Sits above the release-failure slot
            and persists until dismissed: this is a state change the merchant
            has to act on, not a transient receipt like releaseSuccess.
            Distinguished from the accent banners by surface treatment and by
            its own wording — colour is reinforcement only (WCAG 1.4.1). */}
        {newlyBlocked.length > 0 && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1.5,
              px: 2,
              py: 1.25,
              mb: 3,
              bgcolor: 'var(--surface)',
              border: '1px solid var(--rule)',
              borderRadius: '10px',
            }}
          >
            {/* §18: severity dot mirrors the success banner's accent dot at the
                same position. --warning-ink, not --critical-ink: an order moving
                to Blocked is recoverable (stock arrives, it returns to the pool),
                and red would collide with the release-failure banner directly
                below, which is the genuine error state. Colour is reinforcement
                only — the text carries the meaning (WCAG 1.4.1). */}
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'var(--warning-ink)', flexShrink: 0, mt: 0.625 }} />

            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-2)' }}>
                <Box component="span" sx={{ fontWeight: 600, color: 'var(--ink)' }}>
                  {newlyBlocked.length} order{newlyBlocked.length !== 1 ? 's' : ''} moved to Blocked
                </Box>
                {' · '}
                {newlyBlocked.slice(0, 3).map(formatNewlyBlockedOrder).join(', ')}
                {newlyBlocked.length > 3 && ` +${newlyBlocked.length - 3} more`}
              </Typography>
              <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-3)', mt: 0.5 }}>
                There isn't enough stock in a pickable location to fill{' '}
                {newlyBlocked.length !== 1 ? 'these orders' : 'this order'}. Find{' '}
                {newlyBlocked.length !== 1 ? 'them' : 'it'} under Blocked Orders → Out of Stock.
              </Typography>
            </Box>
            <Box
              component="span"
              role="button"
              tabIndex={0}
              aria-label="Dismiss"
              onClick={() => setNewlyBlocked([])}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') setNewlyBlocked([]);
              }}
              sx={{
                flexShrink: 0,
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: 1,
                mt: 0.25,
                color: 'var(--ink-3)',
                '&:hover': { color: 'var(--ink)' },
              }}
            >
              ✕
            </Box>
          </Box>
        )}

        {/* SHOP-REV-03: release-action failures. Separate from isError above,
            which covers the three read queries — a failed release must not
            blank the page, but it must never fail silently either. */}
        {releaseError && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              px: 2,
              py: 1.25,
              mb: 3,
              bgcolor: 'var(--accent-ghost)',
              border: '1px solid var(--accent-border)',
              borderRadius: '10px',
            }}
          >
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-2)' }}>
              Release failed — {releaseError}
            </Typography>
          </Box>
        )}

        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={24} sx={{ color: 'var(--accent)' }} />
          </Box>
        )}

{/* ---------- ISS-RQ-05: Intent banner — deep-link context bridge ----------
            Rendered only when ?urgency=sla_breach or ?constraint=* is present.
            Tells the first-time user what they are seeing and what the one action is.
            Dismissible per-session via local state (no persistence needed). */}
          {!isLoading && !intentBannerDismissed && (urgencyFilter || !!constraintParam || revenueBlockedContext) && (          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 2,
              px: 2,
              py: 1.5,
              mb: 2,
              bgcolor: 'var(--surface)',
              border: '1px solid var(--rule)',
              borderRadius: '10px',
            }}
          >
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', mb: 0.375 }}>
                {urgencyFilter
                  ? 'These orders have missed their shipping window.'
                  : revenueBlockedContext
                  ? 'Revenue is being held by constrained orders.'
                  : 'These orders are blocked by a constraint.'}
              </Typography>
              <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', lineHeight: 1.6 }}>
                {urgencyFilter
                  ? 'Select them in the Order Pool and release a wave — operators will pick and ship today. This clears the SLA alert.'
                  : revenueBlockedContext
                  ? 'Resolve each order\'s constraint in the Blocked column — fixing the address, restocking, or clearing the exception releases the revenue immediately.'
                  : 'Resolve each order\'s constraint in the Blocked column, then release a wave from the Order Pool to ship them.'}
              </Typography>
            </Box>
            <Box
              onClick={() => setIntentBannerDismissed(true)}
              sx={{ flexShrink: 0, cursor: 'pointer', color: 'var(--ink-3)', '&:hover': { color: 'var(--ink)' }, mt: 0.25 }}
            >
              <X size={14} />
            </Box>
          </Box>
        )}
        {/* ---------- Working body: bounded operational board ---------- */}
          {!isLoading && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.5,
                  pb: '1px',
                }}
              >
              {/* ---- Release-success banner (transient, auto-dismisses) ---- */}
              {releaseSuccess && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1.5,
                    px: 2,
                    py: 1.375,
                    bgcolor: 'var(--accent-ghost)',
                    border: '1px solid var(--accent-border)',
                    borderRadius: '12px',
                  }}
                >
                  <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'var(--accent)', flexShrink: 0, mt: 0.625 }} />

                  <Box>
                    {releaseSuccess.orderCount > 0 && (
                      <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-2)' }}>
                        <Box component="span" sx={{ fontWeight: 600, color: 'var(--ink)' }}>
                          {releaseSuccess.orderCount} order{releaseSuccess.orderCount !== 1 ? 's' : ''} released
                        </Box>
                        {releaseSuccess.batchId && (
                          <>
                            {' · '}
                            Batch {releaseSuccess.batchId.slice(0, 8).toUpperCase()} is now active in fulfillment.
                          </>
                        )}
                      </Typography>
                    )}

                    {releaseSuccess.skippedOrders.length > 0 && (
                      <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-3)', mt: releaseSuccess.orderCount > 0 ? 0.5 : 0 }}>
                        <Box component="span" sx={{ fontWeight: 600, color: 'var(--ink)' }}>
                          {releaseSuccess.skippedOrders.length} order{releaseSuccess.skippedOrders.length !== 1 ? 's' : ''} not released
                        </Box>
                        {' · '}
                        {releaseSuccess.skippedOrders.slice(0, 3).map(formatSkippedOrder).join(' · ')}
                        {releaseSuccess.skippedOrders.length > 3 && ` ·+${releaseSuccess.skippedOrders.length - 3} more`}
                      </Typography>
                    )}

                    {/* FLOW-BLOCKED-TRANSITION-UX-01: newlyBlocked is a third
                        outcome this fallback predates. When release moved every
                        order to Blocked, the pool did NOT change underneath the
                        merchant and refreshing will not help — the banner above
                        already states what happened and what to do. */}
                    {releaseSuccess.orderCount === 0 && releaseSuccess.skippedOrders.length === 0 && newlyBlocked.length === 0 && (
                      <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
                        No orders were released. The release pool may have changed. Refresh and try again.
                      </Typography>
                    )}
                  </Box>
                </Box>
              )}
              {/* Phase 4a of target-IA rebuild: grid wrapper so the three
                columns (Blocked / Pool / Fulfillment) render side-by-side
                instead of stacked. Legacy banner/grid/table/Drawer UI has
                been fully removed (Phase 4b complete). */}
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: '1fr',
                      lg: blockedCount > 0 ? '0.8fr 1.4fr 0.8fr' : 'repeat(2, 1fr)',
                    },
                    gap: 1.5,
                    alignItems: 'stretch',
                    flex: 1,
                    minHeight: 0,
                  }}
                >

                {/* Phase 1 of target-IA rebuild: persistent reason-tagged blocked list
                    (target mockup's "Blocked orders" column) — now the sole Blocked
                    UI; the legacy banner/Drawer it was verified alongside is removed.
                    OF-UX-01: the operational board is viewport-bounded; each
                    primary column owns its vertical scrolling. */}
                {blockedCount > 0 && (
                  <Box
                    sx={{
                      bgcolor: 'var(--surface)',
                      border: '1px solid var(--rule)',
                      borderRadius: '14px',
                      p: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                      minHeight: 0,
                    }}
                  >
                   <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', flexShrink: 0 }}>
                      Blocked orders
                    </Typography>
                    <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {orderedBlockedReasonKeys.map((key) =>
                      blockedByReason[key].length > 0 && (
                        <Box key={key} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          <Box
                            onClick={() => setExpandedReason(key)}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              cursor: 'pointer',
                              mt: 0.5,
                              userSelect: 'none',
                            }}
                          >
                            <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>
                              {getConstraintLabel(key)} · {blockedByReason[key].length}
                            </Typography>
                            <ChevronDown
                              size={14}
                              style={{
                                color: 'var(--ink-4)',
                                transform: activeExpandedReason === key ? 'rotate(180deg)' : 'rotate(0deg)',
                                transition: 'transform 0.2s ease',
                              }}
                            />
                          </Box>
                          <Collapse in={activeExpandedReason === key} timeout={200}>
                            <Box sx={{ display: 'flex', flexDirection:'column', gap: 0.5 }}>
                              {(revealedGroups.has(key) ? blockedByReason[key] : blockedByReason[key].slice(0, TRIAGE_PREVIEW_LIMIT)).map((order) => (
                                <Box
                                  key={order.order_id}
                                  onClick={() => setSelectedOrderId(order.order_id)}
                                  sx={{
                                    border: '1px solid var(--rule)',
                                    borderRadius: '10px',
                                    p: '10px 12px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 0.5,
                                    cursor: 'pointer',
                                    '&:hover': { borderColor: 'var(--accent-border)', bgcolor: 'var(--bg-2)' },
                                    /**
                                     * FLOW-BLOCKED-TRANSITION-UX-01
                                     * A card arriving here during release appears silently in a
                                     * column the operator is not looking at. Two seconds of
                                     * highlight marks WHERE the order went; the banner above
                                     * already says THAT it went — colour is reinforcement only
                                     * (WCAG 1.4.1), so nothing is lost if it is missed.
                                     * --warning-ink per playbook §18: recoverable, not critical.
                                     * Inline @keyframes matches the app's established convention
                                     * (OverviewFT2Page, TrialCountdownChip) over importing
                                     * keyframes from @mui/system.
                                     * forwards holds the resolved end state so the card settles
                                     * into its normal treatment rather than snapping back.
                                     */
                                    ...(newlyBlockedIds.has(order.order_id) && {
                                      animation: 'flowBlockedArrive 2s ease-out forwards',
                                      '@keyframes flowBlockedArrive': {
                                        '0%': {
                                          backgroundColor: 'var(--warning-ghost)',
                                          borderColor: 'var(--warning-ink)',
                                        },
                                        '70%': {
                                          backgroundColor: 'var(--warning-ghost)',
                                          borderColor: 'var(--warning-ink)',
                                        },
                                        '100%': {
                                          backgroundColor: 'transparent',
                                          borderColor: 'var(--rule)',
                                        },
                                      },
                                    }),
                                  }}
                                >
                                  {/*
                                    BL-02a: 2x2 card grid — identity/reason left,
                                    value/age right. Both columns baseline-aligned
                                    per row so the card reads as two stacked pairs
                                    rather than three unrelated rows.

                                    Reason comes from canonical constraint fields,
                                    never from recommended_action: the old
                                    'Manual review required' fallback fired on every
                                    production card because decision=null.

                                    The blockedBucket chip that sat beside the age
                                    rendered 'Overdue', duplicating the age it sat
                                    next to and reading as a blocker reason. Age
                                    alone is the honest time signal.
                                  */}
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
                                      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                                        {order.external_order_id ? `#${order.external_order_id}` : order.order_id.slice(0, 8).toUpperCase()}
                                      </Typography>
                                      <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
                                        {getBlockerReason(order)}
                                        {/*
                                          * FLOW-MULTIBLOCK-01 (2026-08-13): this card shows ONE
                                          * elected constraint, but 9 of 19 blocked orders locally
                                          * hold two. Naming the hidden blocker here stops the
                                          * operator resolving the visible one and seeing no
                                          * movement. Renders nothing when there is only one.
                                          */}
                                        {(order.other_blocker_types?.length ?? 0) > 0 && (
                                            <Box
                                              component="span"
                                              sx={{
                                                display: 'block',
                                                color: 'var(--ink-3)',
                                                fontSize: 11,
                                                fontWeight: 500,
                                                lineHeight: 1.4,
                                                mt: 0.375,
                                              }}
                                            >
                                              Also blocked by: {order.other_blocker_types
                                                ?.map(getConstraintLabel)
                                                .join(' · ')}
                                            </Box>
                                          )}
                                      </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-end', flexShrink: 0 }}>
                                      <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
                                        {fmt$(Number(order.revenue ?? 0))}
                                      </Typography>
                                      <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                                        {getAgeLabel(order)} open
                                      </Typography>
                                    </Box>
                                  </Box>
                                </Box>
                              ))}
                            </Box>
                            {/*
                              OF-05 (2026-07-02): See-more reveal, per
                              modules-ux-playbook.md's FT2 Decision Group
                              Reveal Pattern — TRIAGE_PREVIEW_LIMIT updated
                              to 3 (new app-wide standard, was 4). Canonical
                              control, reused verbatim from the playbook.
                            */}
                            {blockedByReason[key].length > TRIAGE_PREVIEW_LIMIT && (
                              <Box
                                onClick={() => toggleRevealed(key)}
                                sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: 2.5, py: 1.125, borderTop: '1px solid var(--rule)', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }}
                              >
                                <Typography sx={{ fontSize: 11, fontWeight: 500 }}>
                                  {revealedGroups.has(key) ? 'Show less' : `See ${blockedByReason[key].length - TRIAGE_PREVIEW_LIMIT} more`}
                                </Typography>
                                {revealedGroups.has(key) ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                              </Box>
                            )}
                          </Collapse>
                        </Box>
                      )
                    )}
                  </Box>
                </Box>
              )}

                {/* Phase 2 of target-IA rebuild: consolidated "Order pool" column
                    (target mockup's middle column). Added alongside the existing
                    Next-Wave panel + pool table for side-by-side verification —
                    those are removed in Phase 4 once this is confirmed correct.
                    Reuses existing state/handlers verbatim; no new behavior.
                    Floor-capacity gauge intentionally dropped to a plain text
                    line here (approved scope) — width doesn't fit a bar at
                    column scale. */}
                <Box
                  sx={{
                    bgcolor: 'var(--surface)',
                    border: '1px solid var(--rule)',
                    borderRadius: '14px',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                    <Box sx={{ p: '12px 14px', borderBottom: '1px solid var(--rule)' }}>
                      <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                        Order pool · {readyCount} ready · {fmt$(releasableRevenue)} releasable
                      </Typography>
                      <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }}>
                        paid · stock reserved
                      </Typography>

                    {/*
                        POOL-VIS-01: rendered as a plain count strip, NOT pills.
                        These four were styled as bordered pills directly above
                        the OF-02 Priority / SLA breached chips, which are real
                        onClick toggles — two visually identical rows, one
                        interactive, one not. Counts state facts; chips filter.

                        `Ready` was dropped: the header one line above already
                        carries it as the panel's headline figure.

                        `In batch` moved out of this group. The other counts all
                        share pbo.lasyncro_order_id IS NULL and partition
                        unbatched orders; in_batch_order_count is deliberately
                        the complement (wms.controller.ts:3143), so grouping it
                        with them implied a sum that does not exist.
                      */}
                      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 1 }}>
                        {[
                          { label: 'Blocked · unbatched', value: poolBlockedCount },
                          { label: 'Fulfilled', value: fulfilledCount },
                        ].map(({ label, value }) => (
                          <Box key={label} sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.5 }}>
                            <Typography sx={{ fontSize: 10, fontWeight: 400, color: 'var(--ink-4)' }}>
                              {label}
                            </Typography>
                            <Typography sx={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-2)' }}>
                              {value}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    {/*
                      OF-02 (2026-07-02): in-table status filter chips —
                      additive alongside cptFilter (that's a cross-link
                      from clicking a matrix cell elsewhere, not an
                      in-table control — see state comment above). These
                      are simple operator-toggled filters on data already
                      shown inline as row badges (Priority/SLA breached).
                    */}
                    <Box sx={{ display: 'flex', gap: 0.75, mt: 1, alignItems: 'center', justifyContent: 'space-between' }}>
                      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                        {([
                          { key: 'priority' as const, label: 'Priority' },
                          { key: 'sla_breached' as const, label: 'SLA breached' },
                        ]).map(({ key, label }) => {
                          const active = statusFilter.has(key);
                          return (
                            <Box
                              key={key}
                              onClick={() => toggleStatusFilter(key)}
                              sx={{
                                display: 'inline-flex', alignItems: 'center', gap: 0.5,
                                px: 1.25, py: 0.375, fontSize: 10.5, fontWeight: 600,
                                border: '1px solid', borderRadius: '999px', cursor: 'pointer',
                                borderColor: active ? 'var(--accent)' : 'var(--ink-3)',
                                bgcolor: active ? 'var(--accent-ghost)' : 'var(--surface)',
                                color: active ? 'var(--accent)' : 'var(--ink-2)',
                                transition: 'border-color 0.12s, color 0.12s',
                                '&:hover': { borderColor: 'var(--accent)', color: 'var(--accent)' },
                              }}
                            >
                              <Box sx={{
                                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                                bgcolor: active ? 'var(--accent)' : 'transparent',
                                border: active ? 'none' : '1px solid var(--ink-3)',
                              }} />
                              {label}
                            </Box>
                          );
                        })}
                      </Box>
                      <Box
                        component="button"
                        type="button"
                        /* REV-HARD-03a: releaseDisabled (line ~412) was computed
                            but never applied — an empty pool left the CTA live and
                            reading "Release all 0". A press could only 204 or 500,
                            which reads as an unresponsive button (Shopify ref 102766). */
                        disabled={releaseDisabled}
                        onClick={handleRelease}
                        sx={{
                          flexShrink: 0, px: '14px', py: '7px',
                          border: 0, borderRadius: '8px',
                          bgcolor: 'var(--accent)', color: 'var(--accent-ink)',
                          fontSize: 12, fontWeight: 600,
                          cursor: releaseBatch.isPending
                            ? 'wait'
                            : waveOrders === 0
                            ? 'not-allowed'
                            : 'pointer',
                          opacity: releaseDisabled ? 0.5 : 1,
                          transition: 'opacity 0.12s',
                          '&:hover': { opacity: releaseDisabled ? 0.5 : 0.88 },
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {releaseBatch.isPending
                          ? 'Releasing…'
                          : waveOrders === 0
                          ? 'Nothing to release'
                          : selected.size > 0
                          ? `Release ${selected.size} order${selected.size !==1 ? 's' : ''}`
                          : `Release all ${waveOrders}`}
                      </Box>
                    </Box>

                    {/* ISS-OP-02: order search input */}
                    <Box
                      component="input"
                      placeholder="Search by order number…"
                      value={poolSearch}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setPoolSearch(e.target.value);
                        setPage(1);
                      }}
                      sx={{
                        mt: 1, width: '100%', px: 1.25, py: 0.625,
                        bgcolor: 'var(--bg)', border: '1px solid var(--rule)',
                        borderRadius: '8px', color: 'var(--ink)',
                        fontSize: 12, fontFamily: 'inherit', outline: 'none',
                        '&::placeholder': { color: 'var(--ink-4)' },
                      }}
                    />
                  </Box>

                  {/* OF-10 (2026-07-21): Release CTA moved to the filter-chips
                      row above. Multi-select operator picker (previously
                      shown here when selected.size > 0) removed alongside —
                      confirm scope before reintroducing if operator assignment
                      on release is still needed. */}

                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: '32px 32px minmax(150px,1fr) 64px 64px 74px',
                      gap: '10px',
                      alignItems: 'center',
                      px: 2,
                      py: 1.25,
                      borderBottom: '1px solid var(--rule)',
                      bgcolor: 'var(--bg-2)',
                    }}
                  >
                    <Checkbox
                      size="small"
                      sx={{ p: 0 }}
                      checked={selected.size === poolOrders.length && poolOrders.length > 0}
                      indeterminate={selected.size > 0 && selected.size <poolOrders.length}
                      onChange={toggleSelectAll}
                    />
                    <Box />
                    {/*
                      OF-01 (2026-07-02): sortable headers — was static
                      Typography with no click handlers at all. 'Order /
                      Value' maps to the 'value' sort field (total_price);
                      the label itself doesn't change, only its behavior.
                      Pattern matches modules-ux-playbook.md §6's Column
                      Sorting Pattern exactly (uppercase label + ↑/↓
                      indicator, accent color when active).
                    */}
                    {/*
                      2026-07-02: 'Lines' → 'SKUs' per explicit product
                      decision — 'line item' is standard WMS jargon
                      ("1 line = 1 distinct product/variant") but not
                      obvious outside that context. 'SKUs' is the more
                      universally understood term for the same count.
                      'Units' (total quantity across all SKUs) kept
                      as-is deliberately — 'Items' was considered and
                      rejected as a replacement since it's ambiguous
                      with SKUs' own meaning (could read as "distinct
                      products" too), while 'Units' unambiguously means
                      physical quantity to pick. sortField key stays
                      'lines' internally — only the display label changed,
                      not the data/sort logic.
                    */}
                    {([
                      { label: 'Order / Value', field: 'value' as const },
                      { label: 'SKUs', field: 'lines' as const },
                      { label: 'Units', field: 'units' as const },
                      { label: 'Age', field: 'age' as const },
                    ]).map(({ label, field }) => (
                      <Box
                        key={label}
                        onClick={() => handleSort(field)}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer' }}
                      >
                        <Typography
                          sx={{
                            fontSize: 10,
                            fontWeight: 500,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: sortField === field ? 'var(--accent)' : 'var(--ink-4)',
                          }}
                        >
                          {label}
                        </Typography>
                        {sortField === field && (
                          <Typography sx={{ fontSize: 9, color: 'var(--accent)' }}>
                            {sortDir === 'asc' ? '↑' : '↓'}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Box>

                  <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                    {poolOrders.length === 0 && (
                        <Box sx={{ px: 3, py: 5, textAlign: 'center' }}>
                          {orderPoolQuery.data?.empty_reason === 'ALL_ELIGIBLE_ORDERS_ALREADY_BATCHED' ? (
                            <>
                              <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', mb: 0.75 }}>
                                Release pool is clear
                              </Typography>
                              <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-4)', maxWidth: 360, mx: 'auto', lineHeight: 1.6 }}>
                                All eligible orders have already been released into active batch work.
                                There are no more orders waiting to be released right now.
                              </Typography>

                              <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, flexWrap: 'wrap', mt: 2 }}>
                                <Box sx={{ px: 1.25, py: 0.625, borderRadius: '999px', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)' }}>
                                  <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)' }}>
                                    {orderPoolQuery.data?.summary?.in_batch_order_count ?? 0} in batch
                                  </Typography>
                                </Box>
                                <Box sx={{ px: 1.25, py: 0.625, borderRadius: '999px', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)' }}>
                                  <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)' }}>
                                    {orderPoolQuery.data?.summary?.active_batch_count ?? 0} active batch
                                  </Typography>
                                </Box>
                                <Box sx={{ px: 1.25, py: 0.625, borderRadius: '999px', border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)' }}>
                                  <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)' }}>
                                    {orderPoolQuery.data?.summary?.ready_for_release_count ?? 0} ready for release
                                  </Typography>
                                </Box>
                              </Box>

                              <Typography sx={{ fontSize: 11.5, fontWeight: 300, color: 'var(--ink-4)', mt: 2 }}>
                                Check the Fulfillment column to continue batch work.
                              </Typography>
                            </>
                          ) : (
                            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-4)' }}>
                              No orders are ready for release right now.
                            </Typography>
                          )}
                        </Box>
                      )}

                    {visiblePool.map((order) => {
                      const isSelected = selected.has(order.lasyncro_order_id);
                      const hours = ageHoursFrom(order.order_created_at);

                      return (
                        <Box
                          key={order.lasyncro_order_id}
                          onClick={() => setSelectedOrderId(order.lasyncro_order_id)}
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: '32px 32px minmax(150px,1fr) 64px 64px 74px',
                            gap: '10px',
                            alignItems: 'center',
                            px: 2,
                            py: 1.375,
                            borderTop: '1px solid var(--rule)',
                            cursor: 'pointer',
                            bgcolor: isSelected ? 'var(--accent-ghost)' : 'transparent',
                            '&:hover': { bgcolor: isSelected ? 'var(--accent-ghost)' : 'var(--bg-2)' },
                          }}
                        >
                          <Checkbox
                            size="small"
                            sx={{ p: 0 }}
                            checked={isSelected}
                            onChange={(event) => {
                              event.stopPropagation();
                              toggleSelect(order.lasyncro_order_id);
                            }}
                            onClick={(event) => event.stopPropagation()}
                          />

                          <Box
                            onClick={(event) => {
                              event.stopPropagation();
                              setPriority.mutate({
                                orderId: order.lasyncro_order_id,
                                flagged: !order.is_priority_flagged,
                              });
                            }}
                            sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                          >
                            <Flag
                              size={13}
                              color={order.is_priority_flagged ? 'var(--accent)' : 'var(--ink-4)'}
                              fill={order.is_priority_flagged ? 'var(--accent)' : 'none'}
                            />
                          </Box>

                          <Box sx={{ minWidth: 0 }}>
                            <Typography
                              sx={{
                                fontSize: 13,
                                fontWeight: 500,
                                color: 'var(--ink)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {order.external_order_id ? `#${order.external_order_id}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                            </Typography>

                            <Typography sx={{ fontSize: 11.5, fontWeight:500, color: 'var(--ink-3)', mt: 0.125 }}>
                              {fmtOrderValue(Number(order.total_price), order.currency)}
                              {order.is_priority_flagged && (
                                <Box component="span" sx={{ color: 'var(--accent)', ml: 0.75, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                                  Priority
                                </Box>
                              )}
                              {order.is_shipping_sla_breached && (
                                <Box component="span" sx={{ color: 'var(--accent)', ml: 0.75, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                                  SLA breached
                                </Box>
                              )}
                            </Typography>
                          </Box>

                          <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
                            {order.line_item_count}
                          </Typography>

                          <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
                            {order.unit_count}
                          </Typography>

                          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, width: 'fit-content' }}>
                            <Clock size={11} color={hours > 48 ? 'var(--accent)' : 'var(--ink-4)'} />
                            <Typography
                              sx={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: hours > 48 ? 'var(--accent)' : 'var(--ink-3)',
                              }}
                            >
                              {ageLabel(order.order_created_at)}
                            </Typography>
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                  {/*
                    OF-03 (2026-07-02): pagination footer — was fully
                    unbounded (no .slice(), rendered every filtered
                    order regardless of count). Compact variant of
                    modules-ux-playbook.md §6's canonical pattern —
                    page-size selector omitted here (column is narrow,
                    10/25/50/100 chips wouldn't fit; sortedPool.length
                    is realistically small at real order-pool volumes
                    compared to e.g. Catalog's product list). Prev/Next
                    + page count only. Only renders when there's more
                    than one page — avoids empty chrome at low volume.
                  */}
                  {poolTotalPages > 1 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: '14px', py: 1, borderTop: '1px solid var(--rule)', bgcolor: 'var(--bg)' }}>
                      <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                        Page {page} of {poolTotalPages}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Box
                          onClick={() => page > 1 && setPage((p) => p - 1)}
                          sx={{
                            px: 1.25, py: 0.375, borderRadius: '6px',
                            cursor: page > 1 ? 'pointer' : 'not-allowed',
                            border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
                            fontSize: 11, color: page > 1 ? 'var(--ink-3)' : 'var(--ink-4)',
                            opacity: page > 1 ? 1 : 0.4,
                          }}
                        >
                          ← Prev
                        </Box>
                        <Box
                          onClick={() => page < poolTotalPages && setPage((p) => p + 1)}
                          sx={{
                            px: 1.25, py: 0.375, borderRadius: '6px',
                            cursor: page < poolTotalPages ? 'pointer' : 'not-allowed',
                            border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
                            fontSize: 11, color: page < poolTotalPages ? 'var(--ink-3)' : 'var(--ink-4)',
                            opacity: page < poolTotalPages ? 1 : 0.4,
                          }}
                        >
                          Next →
                        </Box>
                      </Box>
                    </Box>
                  )}
                </Box>

                {/* Phase 3a of target-IA rebuild: read-only Fulfillment monitoring
                    column (target mockup's right column). No advance-stage actions —
                    claim/pick-complete/pack-complete are gated by picker/packer
                    ownership + scan-completion data (wms.controller.ts), not
                    manager-facing actions. "Shipped" omitted from the stepper: it's
                    a per-order action (POST /batch/:id/ship), not a batch-status
                    value. pack_complete and cancelled batches never appear here —
                    usePickBatches excludes them server-side, so "Packed" below is
                    the path's destination, not a state any card will show as
                    current. Stalled-batch highlighting deferred to Phase 3b
                    pending the alerts-hook audit. */}
                <Box
                  sx={{
                    bgcolor: 'var(--surface)',
                    border: '1px solid var(--rule)',
                    borderRadius: '14px',
                    p: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                    minHeight: 0,
                  }}
                >
                  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', flexShrink: 0 }}>
                    Fulfillment · {batches.length} active
                  </Typography>

                  {/* ONB-ORD1: persistent coach slot, sits above the (scrollable)
                      batch list so it never scrolls away. Same DOM position across
                      all phases — copy swaps in place instead of unmounting. */}
                  <SpotlightCoachMark
                    title={fulfillmentCoach.title}
                    body={fulfillmentCoach.body}
                    isDismissed={fulfillmentCoach.isDismissed}
                    onDismiss={fulfillmentCoach.dismiss}
                    step={fulfillmentCoach.step}
                    totalSteps={2}
                  />

                  <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {batches.length === 0 ? (
                    <Box sx={{ px: 1, py: 4, textAlign: 'center' }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-4)' }}>
                        No active batches. Released waves will appear here.
                      </Typography>
                    </Box>
                  ) : (
                    batches.map((batch) => {
                      const stages = [
                        { key: 'picking', label: 'Picking' },
                        { key: 'pick_complete', label: 'Picked' },
                        { key: 'packing', label: 'Packing' },
                        { key: 'pack_complete', label: 'Packed' },
                      ];
                      const stageIndex = stages.findIndex((s) => s.key === batch.status);
                      const stageTimestamp =
                        batch.status === 'picking' ? batch.pick_claimed_at
                        : batch.status === 'pick_complete' ? batch.pick_completed_at
                        : batch.status === 'packing' ? batch.pack_claimed_at
                        : batch.status === 'pack_complete' ? batch.pack_completed_at
                        : batch.released_at;

                      return (
                        <Box
                          key={batch.pick_batch_id}
                          role="button"
                          tabIndex={0}
                          aria-label={`Inspect batch ${batch.pick_batch_id.slice(0, 8).toUpperCase()}`}
                          onClick={() => setSelectedBatchId(batch.pick_batch_id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedBatchId(batch.pick_batch_id);
                            }
                          }}
                          sx={{
                            border: '1px solid var(--rule)',
                            borderRadius: '10px',
                            p: '10px 12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 0.75,
                            cursor: 'pointer',
                            '&:hover': {
                              borderColor: 'var(--accent-border)',
                            },
                            '&:focus-visible': {
                              outline: '2px solid var(--accent)',
                              outlineOffset: '2px',
                            },
                          }}
                        >
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                              {batch.pick_batch_id.slice(0, 8).toUpperCase()}
                            </Typography>

                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                              <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>
                                {batch.status === 'pending' ? 'Pending' : stages[stageIndex]?.label ?? batch.status}
                              </Typography>

                              {batch.status === 'pending' && (
                                <Box
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setCancelError(null);
                                    setCancelConfirmBatchId((current) =>
                                      current === batch.pick_batch_id ? null : batch.pick_batch_id,
                                    );
                                  }}
                                  aria-label={`Cancel batch ${batch.pick_batch_id.slice(0, 8).toUpperCase()}`}
                                  sx={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 22,
                                    height: 22,
                                    borderRadius: '6px',
                                    border: '0.5px solid var(--rule)',
                                    color: 'var(--ink-4)',
                                    cursor: 'pointer',
                                    '&:hover': {
                                      color: theme.palette.error.main,
                                      borderColor: theme.palette.error.main,
                                    },
                                  }}
                                >
                                  <X size={12} />
                                </Box>
                              )}
                            </Box>
                          </Box>

                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            {stages.map((stage, i) => (
                              <Box
                                key={stage.key}
                                sx={{
                                  flex: 1,
                                  textAlign: 'center',
                                  py: 0.5,
                                  borderRadius: '6px',
                                  border: '1px solid',
                                  borderColor: i === stageIndex ? 'var(--accent)' : 'var(--rule)',
                                  bgcolor: i === stageIndex ? 'var(--accent-ghost)' : 'transparent',
                                }}
                              >
                                <Typography sx={{ fontSize: 10, color: i === stageIndex ? 'var(--accent)' : i < stageIndex ? 'var(--ink-3)' : 'var(--ink-4)' }}>
                                  {stage.label}
                                </Typography>
                              </Box>
                            ))}
                          </Box>

                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                              {stageTimestamp
                                ? batch.status === 'pending'
                                  ? `Released ${ageLabel(stageTimestamp)} ago`
                                  : `${ageLabel(stageTimestamp)} in ${stages[stageIndex]?.label ?? batch.status}`
                                : '—'}
                            </Typography>
                            <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                              {batch.total_line_items}L · {batch.total_units}u
                            </Typography>
                          </Box>

                          {(batch.picker_name || batch.packer_name) && (
                            <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                              {batch.packer_name ?? batch.picker_name}
                            </Typography>
                          )}

                          <Collapse
                            in={cancelConfirmBatchId === batch.pick_batch_id}
                            timeout={180}
                            unmountOnExit
                          >
                            <Box
                              onClick={(event) => event.stopPropagation()}
                              sx={{
                                mt: 0.25,
                                pt: 1,
                                borderTop: '1px solid var(--rule)',
                              }}
                            >
                              <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'var(--ink)' }}>
                                Cancel batch {batch.pick_batch_id.slice(0, 8).toUpperCase()}?
                              </Typography>

                              <Typography sx={{ mt: 0.25, fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                                Its orders return to the order pool or Blocked if constraints apply.
                              </Typography>

                              {cancelError?.batchId === batch.pick_batch_id && (
                                <Typography
                                  sx={{
                                    mt: 0.75,
                                    fontSize: 11,
                                    fontWeight: 500,
                                    color: theme.palette.error.main,
                                  }}
                                >
                                  {cancelError.message}
                                </Typography>
                              )}

                              <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end', gap: 0.75 }}>
                                <Box
                                  onClick={() => {
                                    setCancelError(null);
                                    setCancelConfirmBatchId(null);
                                  }}
                                  sx={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    px: 1.25,
                                    py: 0.5,
                                    fontSize: 11,
                                    fontWeight: 500,
                                    color: 'var(--ink-3)',
                                    border: '0.5px solid var(--rule)',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    '&:hover': { opacity: 0.75 },
                                  }}
                                >
                                  Keep batch
                                </Box>

                                <Box
                                  onClick={() =>
                                    !cancelBatch.isPending &&
                                    void handleCancelBatch(batch.pick_batch_id)
                                  }
                                  sx={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    px: 1.25,
                                    py: 0.5,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: theme.palette.common.white,
                                    bgcolor: theme.palette.error.main,
                                    borderRadius: '6px',
                                    cursor: cancelBatch.isPending ? 'not-allowed' : 'pointer',
                                    opacity: cancelBatch.isPending ? 0.55 : 1,
                                    '&:hover': {
                                      opacity: cancelBatch.isPending ? 0.55 : 0.88,
                                    },
                                  }}
                                >
                                  {cancelBatch.isPending ? 'Cancelling…' : 'Cancel batch'}
                                </Box>
                              </Box>
                            </Box>
                          </Collapse>
                        </Box>
                      );
                    })
                  )}
                 </Box>
                </Box>
                
                </Box>
              </Box>
          </Box>
        )}
      </Box>
      {/*
        OF-08 (2026-07-02): blocked-order resolution path. Same
        EntityDetailModal + OrderDetailModalBody pair OrdersFT2Page.tsx
        uses — reused, not duplicated (see OrderDetailModalBody.tsx's
        header comment for why it lives in apps/frontend, not
        modules/shared).
      */}
      <EntityDetailModal
        entityId={selectedBatchId}
        onClose={() => setSelectedBatchId(null)}
        title={`Batch ${selectedBatchId?.slice(0, 8).toUpperCase() ?? ''}`}
        subtitle={
          selectedBatch
            ? `${selectedBatch.status.replace(/_/g, ' ')} · ${selectedBatch.release_trigger ?? 'standard'} release`
            : undefined
        }
        maxWidth="md"
      >
        {selectedBatch && (
          <BatchDetailModalBody
            batch={selectedBatch}
            onNavigateToOrder={(orderId) => {
              setSelectedBatchId(null);
              setSelectedOrderId(orderId);
            }}
          />
        )}
      </EntityDetailModal>

      <EntityDetailModal
        entityId={selectedOrderId}
        onClose={handleCloseOrderDetail}
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
              onClose={handleCloseOrderDetail}
            />
        )}
      </EntityDetailModal>

    </Box>
  );
}