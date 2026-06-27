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

import { type ChangeEvent, useCallback, useMemo, useState } from 'react';
import { Box, Typography, CircularProgress, Checkbox, useTheme, Collapse } from '@mui/material';
import { Clock, Flag, ChevronDown } from 'lucide-react';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { getAgeLabel, getConstraintLabel, useConstrainedOrders } from '../orders/useConstrainedOrders';
import {
  useOrderPool,
  useReleaseBatch,
  useSetPriority,
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
  const { data: operatorsData } = useWmsOperators();

  const operators = operatorsData?.operators ?? [];
  const blockedOrders = useMemo(() => constrainedQuery.data?.data ?? [], [constrainedQuery.data]);
  const poolOrders = useMemo(() => orderPoolQuery.data?.orders ?? [], [orderPoolQuery.data]);
  const batches = useMemo(() => pickBatchesQuery.data?.batches ?? [], [pickBatchesQuery.data]);

  // --- Cross-linking: pool cell → pool-table filter ------------------------
  // Clicking a POOL cell filters the pool table to that bucket.
  const [cptFilter, setCptFilter] = useState<{ bucket: CptBucket; stage: 'pool' } | null>(null);
  // ISSUE-15 — accordion state for Blocked Orders categories. Empty Set = all
  // collapsed on load, regardless of which categories have items.
  const [expandedReasons, setExpandedReasons] = useState<Set<string>>(new Set());
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

  const poolBucket = useCallback(
    (o: PoolOrder): CptBucket => bucketByCpt(o.order_created_at, liveCapacityQuery.data?.hours_to_cpt ?? null),
    [liveCapacityQuery.data],
  );

  const visiblePool = useMemo(
    () => (cptFilter ? poolOrders.filter(o => poolBucket(o) === cptFilter.bucket) : poolOrders),
    [poolOrders, cptFilter, poolBucket],
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
  const blockedByReason = useMemo(() => {
    const grouped: Record<'inventory' | 'customer' | 'operational' | 'unknown', typeof blockedOrders> = {
      inventory: [],
      customer: [],
      operational: [],
      unknown: [],
    };

    blockedOrders.forEach((order) => {
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
  }, [blockedOrders]);

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
  const blockedCount = blockedOrders.length;
  const heldRevenue = blockedOrders.reduce((sum, order) => sum + Number(order.revenue ?? 0), 0);
  const readyCount = orderPoolQuery.data?.eligible_order_count ?? poolOrders.length;
  const activeBatchCount = batches.length;

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
  // Keep the floor-release action tied to the visible wave preview.
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
        minHeight: '100%',
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

        {/* ---------- Working body: top overview + bottom work area ---------- */}
          {!isLoading && (
            <Box
              sx={{
                display: 'grid',
                gridTemplateRows: 'max-content auto',
                gap: 2,
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
                    alignItems: 'start',
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
                    }}
                  >
                   <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                      Blocked orders
                    </Typography>
                    {(['operational', 'inventory', 'customer', 'unknown']as const).map((key) =>
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
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                              {blockedByReason[key].map((order) => (
                                <Box
                                  key={order.order_id}
                                  sx={{
                                    border: '1px solid var(--rule)',
                                    borderRadius: '10px',
                                    p: '10px 12px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 0.5,
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
                          </Collapse>
                        </Box>
                      )
                    )}
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
                  </Box>

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
                    {['Order / Value', 'Lines', 'Units', 'Age'].map((col) => (
                      <Typography
                        key={col}
                        sx={{
                          fontSize: 10,
                          fontWeight: 500,
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                          color: 'var(--ink-4)',
                        }}
                      >
                        {col}
                      </Typography>
                    ))}
                  </Box>

                  <Box>
                    {poolOrders.length === 0 && (
                      <Box sx={{ px: 3, py: 6, textAlign: 'center' }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-4)' }}>
                          No orders in the release pool. Orders are either blocked, already batched, or not ready yet.
                        </Typography>
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

                            <Typography sx={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink-3)', mt: 0.125 }}>
                              {fmtOrderValue(Number(order.total_price), order.currency)}
                              {order.is_priority_flagged && (
                                <Box component="span" sx={{ color: 'var(--accent)', ml: 0.75, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                                  Priority
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

                  <Box sx={{ p: '12px 14px', borderTop: '1px solid var(--rule)' }}>
                    {selected.size > 0 && (
                      <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'var(--accent)', mb: 0.75 }}>
                        {selected.size} selected · only selected orders will be released
                      </Typography>
                    )}

                    <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mb: 1 }}>
                      {waveLineItems} of {maxLineItems} line items · {waveUnits} units to pick
                    </Typography>

                    <Box
                      component="select"
                      value={operatorId}
                      onChange={(event: ChangeEvent<HTMLSelectElement>) => setOperatorId(event.target.value)}
                      sx={{
                        width: '100%',
                        mb: 1,
                        px: 1.5,
                        py: 1,
                        bgcolor: 'var(--bg)',
                        border: '1px solid var(--rule)',
                        borderRadius: '8px',
                        color: operatorId ? 'var(--ink)' : 'var(--ink-3)',
                        fontSize: 13,
                        fontFamily: 'inherit',
                        outline: 'none',
                      }}
                    >
                      <option value="">Dispatch to all operators</option>
                      {operators.map((operator) => (
                        <option key={operator.user_id} value={operator.user_id}>
                          {`${operator.first_name} ${operator.last_name}`.trim()}
                        </option>
                      ))}
                    </Box>

                    <Box
                      component="button"
                      type="button"
                      disabled={releaseDisabled}
                      onClick={handleRelease}
                      sx={{
                        width: '100%',
                        py: 1.1,
                        border: 0,
                        borderRadius: '10px',
                        bgcolor: releaseDisabled ? 'var(--rule)' : 'var(--accent)',
                        color: theme.palette.common.white,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: releaseDisabled ? 'not-allowed' : 'pointer',
                        opacity: releaseDisabled ? 0.45 : 1,
                        transition: 'background 0.12s, opacity 0.12s',
                        '&:hover': {
                          bgcolor: releaseDisabled ? 'var(--rule)' : 'var(--accent-hover)',
                        },
                      }}
                    >
                      {releaseBatch.isPending ? 'Releasing…' : 'Release wave to floor'}
                    </Box>

                    <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', textAlign: 'center', mt: 1 }}>
                      Pickers see it on their mobile instantly.
                    </Typography>
                  </Box>
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
                  }}
                >
                  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                    Fulfillment · {batches.length} active
                  </Typography>

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
              {/* ===================== BOTTOM ROW — release pool + next wave ===================== */}
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.5,
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
                        {releaseSuccess.skippedOrders.length > 3 && ` · +${releaseSuccess.skippedOrders.length - 3} more`}
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
    </Box>
  );
}