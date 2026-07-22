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
//     (blockedByReason — Pick Exception / Out of Stock / Address Issue,
//     CONSTRAINT_LABELS in useConstrainedOrders.ts), one label per card.
//     Each card also shows a CPT-bucket indicator (overdue/today/ahead —
//     see DATA CAVEATS) as a separate time signal. 'operational' was
//     previously labeled "Overdue", which collided with this CPT badge —
//     renamed to "Pick Exception" to resolve it (see useConstrainedOrders.ts).
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

import { type ChangeEvent, type ReactNode, useCallback, useMemo, useState } from 'react';
import { SpotlightCoachMark } from '@lasyncro/shared/ui';
import { useSpotlight } from '../../hooks/useSpotlight';
import { useSearchParams } from 'react-router-dom';
import { Box, Typography, CircularProgress, Checkbox, useTheme, Collapse } from '@mui/material';
import { Clock, Flag, ChevronDown, ChevronUp, X } from 'lucide-react';
import { EntityDetailModal } from '@lasyncro/shared/ui';
import { OrderDetailModalBody } from '../orders/OrderDetailModalBody';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { getAgeLabel, getConstraintLabel, useConstrainedOrders } from '../orders/useConstrainedOrders';
import {
  useOrderPool,
  useReleaseBatch,
  useSetPriority,
  useBulkSetPriority,
  type PoolOrder,
  type SkippedReleaseOrder,
} from '../wms/useOrderPool';
import { usePickBatches } from '../wms/usePickBatches';
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
  const setPriority = useSetPriority();
  const spotlightOrderFlowWave = useSpotlight('order_flow_wave');

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
  const [modalTitle, setModalTitle] = useState('');
  const [modalSubtitle, setModalSubtitle] = useState<string | undefined>(undefined);
  const [modalFooter, setModalFooter] = useState<ReactNode>(null);
  const { data: operatorsData } = useWmsOperators();

  const operators = operatorsData?.operators ?? [];
  const blockedOrders = useMemo(() => constrainedQuery.data?.data ?? [], [constrainedQuery.data]);
  const poolOrders = useMemo(() => orderPoolQuery.data?.orders ?? [], [orderPoolQuery.data]);
  const batches = useMemo(() => pickBatchesQuery.data?.batches ?? [], [pickBatchesQuery.data]);

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
  type PoolSortField = 'age' | 'value' | 'lines' | 'units';
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
  // ISSUE-15 → OF-06 (2026-07-02): accordion state for Blocked Orders
  // categories. Previously started fully collapsed by default (empty Set,
  // except deep-linked ?constraint=<type>) — flagged live as leaving
  // significant dead space on the Blocked Orders card when nothing is
  // manually expanded. Now defaults to expanded for every category
  // (bounded safely by OF-05's TRIAGE_PREVIEW_LIMIT=3 reveal cap, so this
  // can't balloon into a huge list even with several blocked categories).
  // constraintParam still works the same way — it's already covered by
  // "start with everything expanded," no special-case needed anymore.
  const [expandedReasons, setExpandedReasons] = useState<Set<string>>(
    () => new Set(['operational', 'inventory', 'customer', 'unknown'])
  );
  const toggleReason = useCallback((key: string) => {
    setExpandedReasons((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);
  /**
   * OF-05 (2026-07-02) — See-more reveal for Blocked Orders groups.
   * Separate state from expandedReasons (that toggles the whole
   * accordion section open/closed) — this toggles preview-vs-full
   * within an already-open section. TRIAGE_PREVIEW_LIMIT = 3 per
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

  const sortedPool = useMemo(() => {
    const sorted = [...filteredPool].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'age':
          cmp = new Date(a.order_created_at).getTime() - new Date(b.order_created_at).getTime();
          break;
        case 'value':
          cmp = Number(a.total_price) - Number(b.total_price);
          break;
        case 'lines':
          cmp = a.line_item_count - b.line_item_count;
          break;
        case 'units':
          cmp = a.unit_count - b.unit_count;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredPool, sortField, sortDir]);

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

  // --- Blocked column: group by reason category (constraint_type) ----------
  // constraint_type is a hard DB enum — inventory | customer | operational
  // only (order_constraint_events migration). Any other value is a contract
  // break, not a silent miscategorization: log it and bucket separately.
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

  // --- Wave selection + release state --------------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [operatorId, setOperatorId] = useState<string>('');
  const [releaseSuccess, setReleaseSuccess] = useState<{
    batchId: string | null;
    orderCount: number;
    skippedOrders: SkippedReleaseOrder[];
  } | null>(null);

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
  const inBatchOrderCount = poolSummary?.in_batch_order_count ?? 0;
  const poolBlockedCount = poolSummary?.blocked_count ?? blockedCount;
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
    try {
      const result = await releaseBatch.mutateAsync({
        priority_order_ids: selected.size > 0 ? [...selected] : undefined,
        exclusive: selected.size > 0 ? true : undefined,
        assigned_operator_id: operatorId ? Number(operatorId) : undefined,
      });

      setSelected(new Set());
      setOperatorId('');
      setReleaseSuccess({
        batchId: result.pick_batch_id,
        orderCount: result.order_count,
        skippedOrders: result.skipped_orders ?? [],
      });
      setTimeout(() => setReleaseSuccess(null), 9000);
    } catch {
      // Error state is rendered from releaseBatch.isError in the wave builder.
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
                : `${blockedCount} blocked · ${fmt$(heldRevenue)} held · ${readyCount} ready to release · ${activeBatchCount} batch${activeBatchCount !== 1 ? 'es' : ''} active`}
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
        {/* ---------- Working body: top overview + bottom work area---------- */}
          {!isLoading && (
            <Box
              sx={{
                display: 'grid',
                gridTemplateRows: 'max-content minmax(0, 1fr)',
                gap: 2,
                flex: 1,
                minHeight: 0,
              }}
            >
              <Box
                sx={{
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

                    {releaseSuccess.orderCount === 0 && releaseSuccess.skippedOrders.length === 0 && (
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
                    No truncation: FT2 Page Scroll Rule prefers page-level scroll
                    over nested list limits for primary working lists. */}
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
                    {(['operational', 'inventory', 'customer', 'unknown'] as const).map((key) =>
                      blockedByReason[key].length > 0 && (
                        <Box key={key} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          <Box
                            onClick={() => toggleReason(key)}
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
                                transform: expandedReasons.has(key) ? 'rotate(180deg)' : 'rotate(0deg)',
                                transition: 'transform 0.2s ease',
                              }}
                            />
                          </Box>
                          <Collapse in={expandedReasons.has(key)} timeout={200}>
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
                                  }}
                                >
                                  <Box sx={{ display: 'flex', justifyContent:'space-between' }}>
                                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                                      {order.external_order_id ? `#${order.external_order_id}` : order.order_id.slice(0, 8).toUpperCase()}
                                    </Typography>
                                    <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
                                      {fmt$(Number(order.revenue ?? 0))}
                                    </Typography>
                                  </Box>
                                  <Typography sx={{ fontSize: 12, fontWeight:300, color: 'var(--ink-3)' }}>
                                    {order.recommended_action?.type ? order.recommended_action.type.replace(/_/g, ' ') : 'Manual review required'}
                                  </Typography>
                                  <Box sx={{ display: 'flex', justifyContent:'space-between', mt: 0.5 }}>
                                    <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                                      {getAgeLabel(order)} open
                                    </Typography>
                                    <Typography
                                      sx={{
                                        fontSize: 11,
                                        fontWeight: 600,
                                        textTransform: 'capitalize',
                                        color: blockedBucket(order) === 'overdue' ? 'var(--accent)' : 'var(--ink-4)',
                                      }}
                                    >
                                      {blockedBucket(order)}
                                    </Typography>
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
                        Order pool · {readyCount} ready
                      </Typography>
                      <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }}>
                        paid · stock reserved
                      </Typography>

                      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1 }}>
                        {[
                          { label: 'Ready', value: readyCount },
                          { label: 'In batch', value: inBatchOrderCount },
                          { label: 'Blocked', value: poolBlockedCount },
                          { label: 'Fulfilled', value: fulfilledCount },
                        ].map(({ label, value }) => (
                          <Box
                            key={label}
                            sx={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 0.5,
                              px: 1,
                              py: 0.375,
                              borderRadius: '999px',
                              border: '0.5px solid var(--rule)',
                              bgcolor: 'var(--bg-3)',
                            }}
                          >
                            <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-4)' }}>
                              {label}
                            </Typography>
                            <Typography sx={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink)' }}>
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
                        disabled={releaseBatch.isPending}
                        onClick={handleRelease}
                        sx={{
                          flexShrink: 0, px: '14px', py: '7px',
                          border: 0, borderRadius: '8px',
                          bgcolor: 'var(--accent)', color: 'var(--accent-ink)',
                          fontSize: 12, fontWeight: 600,
                          cursor: releaseBatch.isPending ? 'wait' : 'pointer',
                          opacity: releaseBatch.isPending ? 0.6 : 1,
                          transition: 'opacity 0.12s',
                          '&:hover': { opacity: 0.88 },
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {releaseBatch.isPending
                          ? 'Releasing…'
                          : selected.size > 0
                          ? `Release ${selected.size} order${selected.size !== 1 ? 's' : ''}`
                          : `Release all ${poolOrders.length}`}
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
                          onClick={() => toggleSelect(order.lasyncro_order_id)}
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

                  {selected.size === 0 && (
                    <SpotlightCoachMark
                      title="Select orders to release"
                      body="Check orders in the pool to choose what goes to the floor, or release all at once."
                      isDismissed={spotlightOrderFlowWave.isDismissed}
                      onDismiss={spotlightOrderFlowWave.dismiss}
                      step={1}
                      totalSteps={2}
                    />
                  )}

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
                          sx={{
                            border: '1px solid var(--rule)',
                            borderRadius: '10px',
                            p: '10px 12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 0.75,
                          }}
                        >
                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                              {batch.pick_batch_id.slice(0, 8).toUpperCase()}
                            </Typography>
                            <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>
                              {batch.status === 'pending' ? 'Pending' : stages[stageIndex]?.label ?? batch.status}
                            </Typography>
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
                        </Box>
                      );
                    })
                  )}
                 </Box>
                </Box>
                
                </Box>
              </Box>
              {/* ===================== BOTTOM ROW — release pool + next wave ===================== */}
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.5,
                }}
              >

            {/* ---- Release pool table + next-wave rail ---- */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr',
                  gap: 1.5,
                  alignItems: 'stretch',
                }}
              >

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

    </Box>
  );
}