// apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx
//
// ORDER FLOW
// ==========
// Unified, single-screen working surface for the outbound order lifecycle.
//
// LAYOUT (page-scroll, two columns)
// ---------------------------------
// The page fits in one viewport with no page-level scroll. It is split into a
// header (full width) and a two-column working body:
//
//   ┌───────────────────────────── header ─────────────────────────────┐
//   │ Order Flow · summary line · (optional pool filter chip)           │
//   └───────────────────────────────────────────────────────────────────┘
//   ┌───────────── LEFT (work) ─────────────┐ ┌──── RIGHT (space) ────┐
//   │ CPT risk matrix          (TIME lens)  │ │ Floor                 │
//   │ release-success banner (transient)    │ │ isometric warehouse   │
//   │ ┌── release pool ──┐ ┌── next wave ──┐│ │ canvas (SPACE lens)   │
//   │ │ pool table       │ │ wave summary  ││ │ fills full height —   │
//   │ │ (page scroll)    │ │ + release btn ││ │ removes top dead-space│
//   │ └──────────────────┘ └───────────────┘│ │                       │
//   └───────────────────────────────────────┘ └───────────────────────┘
//
// The two visuals have deliberately non-overlapping jobs:
//   - CPT matrix  = TIME  → "will we make the cutoffs?"
//   - Floor canvas = SPACE → "where on the floor is the work?"
//
// BLOCKED ORDERS
// --------------
// Blocked orders are exception triage, not the daily action, so they no longer
// occupy an inline section on the working surface. Instead the matrix's blocked
// cells are clickable and open a right-side resolution Drawer that lists the
// blocked orders for the chosen CPT bucket. This keeps blocked one click away
// without letting it hijack the canvas or force a scroll.
//
// WHAT WAS REMOVED FROM THE PREVIOUS VERSION
// ------------------------------------------
//   - Blocked / Release pool / Fulfillment / Main-action stat-card row (redundant)
//   - "N blocked orders need review" alert (redundant restatement)
//   - "Live flow" FlowStage strip (third restatement of the same three numbers)
//   - "Fulfillment live" strip (restated fulfillment)
//   - Inline "Blocked review" list (moved into the Drawer)
//   - StatCard + FlowStage components (orphaned once the above were cut)
//
// DATA CAVEATS (carried forward)
//   - CPT buckets are computed from order age vs today's cutoff, because
//     per-order promised_ship_by is not yet written (all-NULL). Per-order
//     ship-by support lands in a later slice.
//   - picking/packing counts are parked in the "today" column until per-batch
//     deadlines exist.

import { type ChangeEvent, useCallback, useMemo, useState } from 'react';
import { Box, Typography, CircularProgress, Checkbox, Drawer, useTheme } from '@mui/material';
import { Clock, Flag } from 'lucide-react';
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

/**
 * Normalise an order's zone_distribution (which may arrive as an array, a
 * JSON-encoded array, or a comma-separated string) into a clean string list.
 */
const getOrderZones = (order: PoolOrder): string[] => {
  const zones = order.zone_distribution;

  if (Array.isArray(zones)) {
    return zones.filter(Boolean);
  }

  if (!zones) {
    return [];
  }

  const trimmed = zones.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  return trimmed
    .split(',')
    .map(zone => zone.trim())
    .filter(Boolean);
};

/** Distinct, "·"-joined set of all zones across a wave's orders. */
const getWaveZones = (orders: PoolOrder[]): string =>
  [...new Set(orders.flatMap(getOrderZones))].join(' · ') || '—';

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

  // --- CPT risk matrix (TIME lens) -----------------------------------------
  // Group every blocked + pool order, plus active batches, into a
  // { overdue, today, ahead } × { blocked, pool, picking, packing } grid,
  // accumulating value-at-risk per column.
  const cptMatrix = useMemo(() => {
    const empty = () => ({ blocked: 0, pool: 0, picking: 0, packing: 0, valueAtRisk: 0 });
    const cols: Record<CptBucket, ReturnType<typeof empty>> = {
      overdue: empty(),
      today: empty(),
      ahead: empty(),
    };
    const hoursToCpt = liveCapacityQuery.data?.hours_to_cpt ?? null;

    for (const o of blockedOrders) {
      const ageSec = o.age_since_creation_seconds ?? 0;
      const createdIso = new Date(Date.now() - ageSec * 1000).toISOString();
      const bucket = o.is_shipping_sla_breached
        ? 'overdue'
        : bucketByCpt(createdIso, hoursToCpt);
      cols[bucket].blocked += 1;
      cols[bucket].valueAtRisk += Number(o.revenue ?? 0);
    }

    for (const o of poolOrders) {
      const bucket = bucketByCpt(o.order_created_at, hoursToCpt);
      cols[bucket].pool += 1;
      cols[bucket].valueAtRisk += Number(o.total_price ?? 0);
    }

    // picking/packing have no per-batch deadline yet → parked in "today".
    for (const b of batches) {
      const stage = b.units_packed > 0 ? 'packing' : 'picking';
      cols.today[stage] += 1;
    }

    return cols;
  }, [blockedOrders, poolOrders, batches, liveCapacityQuery.data]);

  const matrixEmpty = useMemo(
    () =>
      (['overdue', 'today', 'ahead'] as const).every(col =>
        (['blocked', 'pool', 'picking', 'packing'] as const).every(stage => cptMatrix[col][stage] === 0),
      ),
    [cptMatrix],
  );

  // --- Cross-linking: pool cell → pool-table filter ------------------------
  // Clicking a POOL cell filters the pool table to that bucket. (Blocked cells
  // open the resolution drawer instead — see blockedDrawerBucket below.)
  const [cptFilter, setCptFilter] = useState<{ bucket: CptBucket; stage: 'pool' } | null>(null);

  const poolBucket = useCallback(
    (o: PoolOrder): CptBucket => bucketByCpt(o.order_created_at, liveCapacityQuery.data?.hours_to_cpt ?? null),
    [liveCapacityQuery.data],
  );

  const visiblePool = useMemo(
    () => (cptFilter ? poolOrders.filter(o => poolBucket(o) === cptFilter.bucket) : poolOrders),
    [poolOrders, cptFilter, poolBucket],
  );

  // --- Blocked resolution drawer (opened from matrix blocked cells) --------
  const [blockedDrawerBucket, setBlockedDrawerBucket] = useState<CptBucket | null>(null);
  const [blockedBannerOpen, setBlockedBannerOpen] = useState(false);
  const blockedBucket = useCallback(
    (o: { age_since_creation_seconds: number | null; is_shipping_sla_breached: boolean | null }): CptBucket => {
      if (o.is_shipping_sla_breached) return 'overdue';
      const createdIso = new Date(Date.now() - (o.age_since_creation_seconds ?? 0) * 1000).toISOString();
      return bucketByCpt(createdIso, liveCapacityQuery.data?.hours_to_cpt ?? null);
    },
    [liveCapacityQuery.data],
  );

  // Blocked orders for the currently-open drawer bucket (full list, not capped).
  const drawerBlocked = useMemo(
    () =>
      blockedDrawerBucket
        ? blockedOrders.filter(o => blockedBucket(o) === blockedDrawerBucket)
        : [],
    [blockedOrders, blockedDrawerBucket, blockedBucket],
  );

  const drawerHeld = useMemo(
    () => drawerBlocked.reduce((sum, o) => sum + Number(o.revenue ?? 0), 0),
    [drawerBlocked],
  );

  const blockedByBucket = useMemo(() => {
    const grouped: Record<CptBucket, typeof blockedOrders> = {
      overdue: [],
      today: [],
      ahead: [],
    };

    blockedOrders.forEach((order) => {
      grouped[blockedBucket(order)].push(order);
    });

    return grouped;
  }, [blockedOrders, blockedBucket]);

  const blockedBannerSummary = useMemo(
    () => ({
      overdue: blockedByBucket.overdue.length,
      today: blockedByBucket.today.length,
      ahead: blockedByBucket.ahead.length,
    }),
    [blockedByBucket],
  );

  // Groundwork for the reason-category blocked view (target IA, not yet wired
  // into rendering). constraint_type is a hard DB enum — inventory | customer |
  // operational only (order_constraint_events migration). Any other value is a
  // contract break, not a silent miscategorization: log it and bucket separately.
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
  const waveValue = waveSource.reduce((sum, order) => sum + Number(order.total_price), 0);
  const waveLineItems = waveSource.reduce((sum, order) => sum + order.line_item_count, 0);
  const waveUnits = waveSource.reduce((sum, order) => sum + order.unit_count, 0);
  const waveZones = getWaveZones(waveSource);
  const maxLineItems = orderPoolQuery.data?.max_batch_line_items ?? 108;
  const ceilingPct = Math.min(100, Math.round((waveLineItems / maxLineItems) * 100));
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

              {blockedCount > 0 && (
                <Box
                  component="button"
                  type="button"
                  onClick={() => setBlockedBannerOpen(prev => !prev)}
                  sx={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 2,
                    px: 2,
                    py: 1.25,
                    bgcolor: 'var(--accent-ghost)',
                    border: '1px solid var(--accent-border)',
                    borderRadius: '12px',
                    color: 'var(--ink)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    boxSizing: 'border-box',
                    '&:hover': {
                      borderColor: 'var(--accent)',
                    },
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2 }}>
                      Blocked orders · {blockedCount} · {fmt$(heldRevenue)} held
                    </Typography>
                    <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', mt: 0.375 }}>
                      Overdue {blockedBannerSummary.overdue} · Today {blockedBannerSummary.today} · Ahead {blockedBannerSummary.ahead}
                    </Typography>
                    <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', mt: 0.25 }}>
                      Inventory {blockedByReason.inventory.length} · Customer {blockedByReason.customer.length} · Operational {blockedByReason.operational.length}
                      {blockedByReason.unknown.length > 0 && ` · Unknown ${blockedByReason.unknown.length}`}
                    </Typography>
                  </Box>

                  <Box component="span" sx={{ flexShrink: 0, fontSize: 15, color: 'var(--accent)', lineHeight: 1 }}>
                    {blockedBannerOpen ? '▲' : '▼'}
                  </Box>
                </Box>
                )}

                  {/* Phase 4a of target-IA rebuild: grid wrapper so the three
                    additive columns above (Phases 1/2/3a) render side-by-side
                    instead of stacked. Old UI (banner/grid/table/Drawer) below
                    this closing tag is untouched — removed separately in 4b. */}
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', lg: `repeat(${blockedCount > 0 ? 3 : 2}, 1fr)` },
                    gap: 1.5,
                    alignItems: 'start',
                  }}
                >

                {/* Phase 1 of target-IA rebuild: persistent reason-tagged blocked list                    (target mockup's "Blocked orders" column). Added alongside the
                    existing banner/Drawer for side-by-side verification — those are
                    removed in Phase 4 once this is confirmed correct, not before.
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

                    {blockedOrders.map((order) => (
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
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                            {order.external_order_id ? `#${order.external_order_id}` : order.order_id.slice(0, 8).toUpperCase()}
                          </Typography>
                          <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
                            {fmt$(Number(order.revenue ?? 0))}
                          </Typography>
                        </Box>

                        <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>
                          {getConstraintLabel(order.constraint_type)}
                        </Typography>

                        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
                          {order.recommended_action?.type ? order.recommended_action.type.replace(/_/g, ' ') : 'Manual review required'}
                        </Typography>

                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
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
                      gridTemplateColumns: '32px 32px minmax(150px,1fr) 64px 64px 74px minmax(80px,0.45fr)',
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
                      indeterminate={selected.size > 0 && selected.size < poolOrders.length}
                      onChange={toggleSelectAll}
                    />
                    <Box />
                    {['Order / Value', 'Lines', 'Units', 'Age', 'Zones'].map((col) => (
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
                      const orderZones = getOrderZones(order);
                      const hours = ageHoursFrom(order.order_created_at);

                      return (
                        <Box
                          key={order.lasyncro_order_id}
                          onClick={() => toggleSelect(order.lasyncro_order_id)}
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: '32px 32px minmax(150px,1fr) 64px 64px 74px minmax(80px,0.45fr)',
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

                          <Typography
                            sx={{
                              fontSize: 11.5,
                              fontWeight: 300,
                              color: 'var(--ink-4)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {orderZones.length === 0 ? '—' : orderZones.join(' · ')}
                          </Typography>
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

                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', lg: '380px minmax(0, 1fr)' },
                  gap: 1.5,
                  alignItems: 'stretch',
                  minHeight: 0,
                }}
              >

              {/* Next-wave builder — kept above the pool so the primary floor action is visible before order selection. */}
                <Box
                  sx={{
                    flexShrink: 0,
                    bgcolor: 'var(--surface)',
                    border: '1px solid var(--rule)',
                    borderRadius: '14px',
                    p: '12px 14px',
                    overflow: 'hidden',
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: 10,
                      fontWeight: 500,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-4)',
                      mb: 1,
                    }}
                  >
                    Next wave
                  </Typography>
                  <Typography sx={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1, letterSpacing: '-0.02em' }}>
                    {waveOrders} order{waveOrders !== 1 ? 's' : ''}
                  </Typography>

                  <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-4)', mt: 0.625, mb: 0.25 }}>
                    {waveValue > 0 ? fmt$(waveValue) : '—'}
                    {waveZones !== '—' && ` · zones ${waveZones}`}
                  </Typography>

                  {selected.size > 0 && (
                    <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'var(--accent)', mt: 0.375 }}>
                      {selected.size} selected · only selected orders will be released
                    </Typography>
                  )}

                  <Box sx={{ mt: 1.25 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 1.25, borderTop: '1px solid var(--rule)' }}>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-4)' }}>Line items</Typography>
                      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{waveLineItems}</Typography>
                    </Box>

                    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 1.25, borderTop: '1px solid var(--rule)' }}>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-4)' }}>Units to pick</Typography>
                      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{waveUnits}</Typography>
                    </Box>
                  </Box>

                  {/* Floor-capacity gauge against the line-item ceiling. */}
                  <Box sx={{ mt: 1.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
                      <Typography
                        sx={{
                          fontSize: 10,
                          fontWeight: 500,
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                          color: 'var(--ink-4)',
                        }}
                      >
                        Floor capacity
                      </Typography>

                      <Typography sx={{ fontSize: 11, fontWeight: 600, color: ceilingPct > 90 ? 'var(--accent)' : 'var(--ink-4)' }}>
                        {ceilingPct}%
                      </Typography>
                    </Box>

                    <Box sx={{ height: 6, borderRadius: '3px', bgcolor: 'var(--bg)', overflow: 'hidden' }}>
                      <Box
                        sx={{
                          height: '100%',
                          width: `${ceilingPct}%`,
                          bgcolor: ceilingPct > 90 ? 'var(--accent)' : 'var(--rule-2)',
                          borderRadius: '3px',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </Box>

                    <Typography sx={{ fontSize: 10.5, fontWeight: 300, color: 'var(--ink-4)', mt: 0.75 }}>
                      {waveLineItems} of {maxLineItems} line item ceiling
                    </Typography>
                  </Box>

                  <Box
                    component="select"
                    value={operatorId}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) => setOperatorId(event.target.value)}
                    sx={{
                      width: '100%',
                      mt: 1,
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
                      mt: 1,
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

                  <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', textAlign: 'center', mt: 1.25 }}>
                    Pickers see it on their mobile instantly.
                  </Typography>
                 </Box>

              {/* CPT risk matrix — TIME lens ("will we make the cutoffs?"); see file-header comment for the TIME vs SPACE split. */}
              <Box sx={{ border: '1px solid var(--rule)', borderRadius: '12px', p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1.5 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                    CPT risk
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                    {liveCapacityQuery.data?.cpt_local
                      ? `cutoff ${liveCapacityQuery.data.cpt_local.slice(0, 5)}`
                      : 'no CPT set'}
                  </Typography>
                </Box>

                {matrixEmpty ? (
                  <Box sx={{ textAlign: 'center', py: 3, color: 'var(--ink-3)', fontSize: 13 }}>
                    Nothing at risk right now
                  </Box>
                ) : (
                  <Box sx={{ display: 'grid', gridTemplateColumns: '92px repeat(3, minmax(0, 1fr))', gap: 1, alignItems: 'center' }}>
                    <Box />
                    {(['overdue', 'today', 'ahead'] as const).map(col => (
                      <Typography key={col} sx={{ fontSize: 11, fontWeight: 600, textAlign: 'center', color: col === 'overdue' ? 'var(--accent)' : 'var(--ink-3)', textTransform: 'capitalize' }}>
                        {col}
                      </Typography>
                    ))}

                    {(['blocked', 'pool', 'picking', 'packing'] as const).map(stage => (
                      <Box key={stage} sx={{ display: 'contents' }}>
                        <Typography sx={{ fontSize: 12, color: 'var(--ink-2)', textTransform: 'capitalize' }}>
                          {stage}
                        </Typography>
                        {(['overdue', 'today', 'ahead'] as const).map(col => {
                          const n = cptMatrix[col][stage];
                          const danger = col === 'overdue' && stage === 'blocked' && n > 0;
                          // Only blocked + pool cells are interactive:
                          //   blocked → open resolution drawer for that bucket
                          //   pool    → toggle the pool-table filter for that bucket
                          const interactive = (stage === 'blocked' || stage === 'pool') && n > 0;
                          return (
                            <Box
                              key={col}
                              onClick={() => {
                                if (n === 0) return;
                                if (stage === 'blocked') {
                                  setBlockedDrawerBucket(col);
                                  return;
                                }
                                if (stage === 'pool') {
                                  setCptFilter(prev =>
                                    prev && prev.bucket === col
                                      ? null
                                      : { bucket: col, stage: 'pool' },
                                  );
                                }
                              }}
                              sx={{
                                textAlign: 'center',
                                py: 0.5,
                                borderRadius: '6px',
                                fontSize: 13,
                                fontWeight: 500,
                                cursor: interactive ? 'pointer' : 'default',
                                color: n === 0 ? 'var(--ink-4)' : danger ? 'var(--accent)' : 'var(--ink)',
                                bgcolor: danger ? 'var(--accent-ghost)' : n > 0 ? 'var(--bg-2)' : 'transparent',
                                border:
                                  cptFilter?.bucket === col && cptFilter?.stage === 'pool' && stage === 'pool'
                                    ? '1px solid var(--accent)'
                                    : danger
                                    ? '1px solid var(--accent-border)'
                                    : '1px solid transparent',
                                transition: 'border-color 0.12s',
                              }}
                            >
                              {n === 0 ? '—' : n}
                            </Box>
                          );
                        })}
                      </Box>
                    ))}

                    <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.5 }}>at risk</Typography>
                    {(['overdue', 'today', 'ahead'] as const).map(col => (
                      <Typography key={col} sx={{ fontSize: 11, textAlign: 'center', mt: 0.5, color: col === 'overdue' ? 'var(--accent)' : 'var(--ink-3)' }}>
                        {fmt$(cptMatrix[col].valueAtRisk)}
                      </Typography>
                    ))}
                  </Box>
                )}

                <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 1.5 }}>
                  Bucketed by order age against today’s cutoff · per-order ship-by lands later · click a blocked cell to resolve
                </Typography>
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

                {/* Pool table — header and rows participate in page-level scroll. */}
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
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: '32px 32px minmax(150px,1fr) 64px 64px 74px minmax(80px,0.45fr)',
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
                      indeterminate={selected.size > 0 && selected.size < poolOrders.length}
                      onChange={toggleSelectAll}
                    />
                    <Box />
                    {['Order / Value', 'Lines', 'Units', 'Age', 'Zones'].map((col) => (
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

                  {/* Release pool rows — page owns vertical scroll. */}
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
                      const orderZones = getOrderZones(order);
                      const hours = ageHoursFrom(order.order_created_at);

                      return (
                        <Box
                          key={order.lasyncro_order_id}
                          onClick={() => toggleSelect(order.lasyncro_order_id)}
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: '32px 32px minmax(150px,1fr) 64px 64px 74px minmax(80px,0.45fr)',
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

                          {/* Priority flag toggle */}
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

                          <Typography
                            sx={{
                              fontSize: 11.5,
                              fontWeight: 300,
                              color: 'var(--ink-4)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {orderZones.length === 0 ? '—' : orderZones.join(' · ')}
                          </Typography>
                        </Box>
                      );
                    })}
                  </Box>
                </Box>

              </Box>
            </Box>
          </Box>
        )}
      </Box>

      {/* ---------- Blocked resolution drawer (opened from matrix blocked cells) ---------- */}
      <Drawer
        anchor="right"
        open={blockedDrawerBucket !== null}
        onClose={() => setBlockedDrawerBucket(null)}
        PaperProps={{ sx: { width: { xs: '100%', sm: 460 }, bgcolor: 'var(--bg)', backgroundImage: 'none' } }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Drawer header */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              px: 2.5,
              py: 2,
              borderBottom: '1px solid var(--rule)',
              bgcolor: 'var(--surface)',
            }}
          >
            <Box>
              <Typography
                sx={{
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-4)',
                  mb: 0.5,
                }}
              >
                Blocked review{blockedDrawerBucket ? ` · ${blockedDrawerBucket}` : ''}
              </Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                {drawerBlocked.length} blocked · {fmt$(drawerHeld)} held
              </Typography>
              <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', mt: 0.25 }}>
                Resolve these before they can enter the release pool.
              </Typography>
            </Box>

            <Box
              component="button"
              onClick={() => setBlockedDrawerBucket(null)}
              aria-label="Close blocked review"
              sx={{
                flexShrink: 0,
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                lineHeight: 1,
                color: 'var(--ink-3)',
                bgcolor: 'transparent',
                border: '1px solid var(--rule)',
                borderRadius: '8px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                '&:hover': { bgcolor: 'var(--surface)' },
              }}
            >
              ✕
            </Box>
          </Box>

          {/* Drawer body — full bucket list, scrolls within the drawer */}
          <Box sx={{ flex: 1, overflowY: 'auto' }}>
            {drawerBlocked.length === 0 ? (
              <Box sx={{ px: 2.5, py: 6, textAlign: 'center' }}>
                <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-4)' }}>
                  No blocked orders in this bucket.
                </Typography>
              </Box>
            ) : (
              drawerBlocked.map((order) => (
                <Box
                  key={order.order_id}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0,1fr) 120px 80px 96px',
                    gap: 1.5,
                    alignItems: 'center',
                    px: 2.5,
                    py: 1.5,
                    borderBottom: '1px solid var(--rule)',
                  }}
                >
                  <Box>
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
                      {order.external_order_id ? `#${order.external_order_id}` : order.order_id.slice(0, 8).toUpperCase()}
                    </Typography>

                    <Typography sx={{ fontSize: 11.5, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }}>
                      {order.recommended_action?.type
                        ? order.recommended_action.type.replace(/_/g, ' ')
                        : 'Manual review required'}
                    </Typography>
                  </Box>

                  <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: 'var(--accent)' }}>
                    {getConstraintLabel(order.constraint_type)}
                  </Typography>

                  <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-3)' }}>
                    {getAgeLabel(order)}
                  </Typography>

                  <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', textAlign: 'right' }}>
                    {fmt$(Number(order.revenue ?? 0))}
                  </Typography>
                </Box>
              ))
            )}
          </Box>
        </Box>
      </Drawer>
    </Box>
  );
}