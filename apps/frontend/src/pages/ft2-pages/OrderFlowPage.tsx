// apps/frontend/src/pages/ft2-pages/OrderFlowPage.tsx
//
// ORDER FLOW
// ----------
// Unified working surface for the order lifecycle.
//
// This page intentionally starts as a safe shell:
// - real data hooks
// - no route/nav changes yet
// - no IsometricCanvas dependency yet
// - no duplicated release-pool table yet
//
// Later slices will add:
// - release-pool table
// - wave builder
// - blocked drawer/detail handling
// - fulfillment compact strip
// - optional warehouse map fallback

import { type ChangeEvent, useCallback, useMemo, useState } from 'react';
import { Box, Typography, CircularProgress, Checkbox } from '@mui/material';
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

const fmt$ = (value: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

const fmtOrderValue = (price: number, currency: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price);

type CptBucket = 'overdue' | 'today' | 'ahead';

const bucketByCpt = (
  createdAtIso: string,
  hoursToCpt: number | null,
): CptBucket => {
  if (hoursToCpt == null || hoursToCpt <= 0) return 'overdue';
  const ageHours = (Date.now() - new Date(createdAtIso).getTime()) / 3_600_000;
  return ageHours >= hoursToCpt ? 'today' : 'ahead';
};

const ageLabel = (iso: string): string => {
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

const ageHoursFrom = (iso: string): number =>
  Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);

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

const getWaveZones = (orders: PoolOrder[]): string =>
  [...new Set(orders.flatMap(getOrderZones))].join(' · ') || '—';

const formatSkippedOrder = (order: SkippedReleaseOrder): string => {
  const orderLabel = order.external_order_id
    ? `#${order.external_order_id}`
    : order.order_id.slice(0, 8).toUpperCase();

  return `${orderLabel} · ${order.label}`;
};

function StatCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'neutral' | 'attention' | 'active';
}) {
  const toneSx =
    tone === 'attention'
      ? { borderColor: 'var(--accent-border)', bgcolor: 'var(--accent-ghost)' }
      : tone === 'active'
      ? { borderColor: 'var(--rule-2)', bgcolor: 'var(--bg-2)' }
      : { borderColor: 'var(--rule)', bgcolor: 'var(--surface)' };

  return (
    <Box
      sx={{
        border: '1px solid',
        borderRadius: '14px',
        p: 2,
        ...toneSx,
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
        {label}
      </Typography>

      <Typography
        sx={{
          fontSize: 28,
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: '-0.03em',
          color: 'var(--ink)',
        }}
      >
        {value}
      </Typography>

      <Typography
        sx={{
          fontSize: 12,
          fontWeight: 300,
          color: 'var(--ink-3)',
          mt: 0.875,
        }}
      >
        {detail}
      </Typography>
    </Box>
  );
}

function FlowStage({
  title,
  value,
  detail,
  active,
}: {
  title: string;
  value: string;
  detail: string;
  active?: boolean;
}) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 180,
        border: '1px solid var(--rule)',
        borderRadius: '12px',
        bgcolor: active ? 'var(--accent-ghost)' : 'var(--surface)',
        p: 1.75,
      }}
    >
      <Typography
        sx={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: active ? 'var(--accent)' : 'var(--ink-4)',
          mb: 0.875,
        }}
      >
        {title}
      </Typography>

      <Typography sx={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>
        {value}
      </Typography>

      <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', mt: 0.75 }}>
        {detail}
      </Typography>
    </Box>
  );
}

export default function OrderFlowPage() {
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

  const [cptFilter, setCptFilter] = useState<{ bucket: CptBucket; stage: 'blocked' | 'pool' } | null>(null);

  const blockedBucket = useCallback(
    (o: { age_since_creation_seconds: number | null; is_shipping_sla_breached: boolean | null }): CptBucket => {
      if (o.is_shipping_sla_breached) return 'overdue';
      const createdIso = new Date(Date.now() - (o.age_since_creation_seconds ?? 0) * 1000).toISOString();
      return bucketByCpt(createdIso, liveCapacityQuery.data?.hours_to_cpt ?? null);
    },
    [liveCapacityQuery.data],
  );

  const poolBucket = useCallback(
    (o: PoolOrder): CptBucket => bucketByCpt(o.order_created_at, liveCapacityQuery.data?.hours_to_cpt ?? null),
    [liveCapacityQuery.data],
  );

  const visibleBlocked = useMemo(
    () =>
      cptFilter?.stage === 'blocked'
        ? blockedOrders.filter(o => blockedBucket(o) === cptFilter.bucket)
        : blockedOrders,
    [blockedOrders, cptFilter, blockedBucket],
  );

  const visiblePool = useMemo(
    () =>
      cptFilter?.stage === 'pool'
        ? poolOrders.filter(o => poolBucket(o) === cptFilter.bucket)
        : poolOrders,
    [poolOrders, cptFilter, poolBucket],
  );

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

  const blockedCount = blockedOrders.length;
  const heldRevenue = blockedOrders.reduce((sum, order) => sum + Number(order.revenue ?? 0), 0);
  const readyCount = orderPoolQuery.data?.eligible_order_count ?? poolOrders.length;
  const activeBatchCount = batches.length;
  const pickingCount = batches.filter(batch => batch.status === 'picking').length;

  const batchStatusCounts = batches.reduce<Record<string, number>>((acc, batch) => {
    acc[batch.status] = (acc[batch.status] ?? 0) + 1;
    return acc;
  }, {});

  const fulfillmentStatusLine =
    Object.entries(batchStatusCounts)
      .map(([status, count]) => `${count} ${status.replace(/_/g, ' ')}`)
      .join(' · ') || 'No active batches';

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
      : new Set(poolOrders.map(order => order.lasyncro_order_id))
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

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%' }}>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />

      <Box sx={{ p: '32px 40px' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3 }}>
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
                : `${blockedCount} blocked · ${fmt$(heldRevenue)} held· ${readyCount} ready to release · ${activeBatchCount} batch${activeBatchCount !== 1 ? 'es' : ''} active`}
            </Typography>
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
                {cptFilter.bucket} · {cptFilter.stage}
                <Box component="span" sx={{ fontSize: 14, lineHeight: 1, color: 'var(--ink-3)' }}>✕</Box>
              </Box>
            )}
          </Box>
        </Box>

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
        </Box>
        )}

        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={24} sx={{ color: 'var(--accent)' }} />
          </Box>
        )}

        {!isLoading && (
          <>
            <Box
              sx={{
                border: '1px solid var(--rule)',
                borderRadius: '12px',
                p: 2,
                mb: 3,
              }}
            >
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
                      return (
                        <Box
                          key={col}
                          onClick={() => {
                            if (stage !== 'blocked' && stage !== 'pool') return;
                            if (n === 0) return;
                            setCptFilter(prev =>
                              prev && prev.bucket === col && prev.stage === stage
                                ? null
                                : { bucket: col, stage },
                            );
                          }}
                          sx={{
                            textAlign: 'center',
                            py: 0.5,
                            borderRadius: '6px',
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: (stage === 'blocked' || stage === 'pool') && n > 0 ? 'pointer' : 'default',
                            color: n === 0 ? 'var(--ink-4)' : danger ? 'var(--accent)' : 'var(--ink)',
                            bgcolor: danger ? 'var(--accent-ghost)' : n > 0 ? 'var(--bg-2)' : 'transparent',
                            border:
                              cptFilter?.bucket === col && cptFilter?.stage === stage
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
                Bucketed by order age against today's cutoff · per-order ship-by lands later
              </Typography>
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: 2,
                mb: 3,
              }}
            >
              <StatCard
                label="Blocked"
                value={String(blockedCount)}
                detail={`${fmt$(heldRevenue)} held`}
                tone={blockedCount > 0 ? 'attention' : 'active'}
                />
              <StatCard
                label="Release pool"
                value={String(readyCount)}
                detail="Clean orders ready for the next wave"
              />
              <StatCard
                label="Fulfillment"
                value={String(activeBatchCount)}
                detail={`${pickingCount} currently picking`}
              />
              <StatCard
                label="Main action"
                value="Release"
                detail="Build the next floor wave from the pool"
              />
            </Box>

            {blockedCount > 0 && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 2,
                  px: 2,
                  py: 1.75,
                  mb: 3,
                  bgcolor: 'var(--accent-ghost)',
                  border: '1px solid var(--accent-border)',
                  borderRadius: '14px',
                }}
              >
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', mb: 0.25 }}>
                    {blockedCount} blocked order{blockedCount !== 1 ? 's' : ''} need review
                  </Typography>

                  <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-3)' }}>
                    {fmt$(heldRevenue)} is held until customer, inventory, or operational blocks are resolved.
                  </Typography>
                </Box>

                <Box
                  component="a"
                  href="#blocked-orders"
                  sx={{
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--accent)',
                    textDecoration: 'none',
                    px: 1.25,
                    py: 0.75,
                    borderRadius: '8px',
                    '&:hover': { bgcolor: 'var(--surface)' },
                  }}
                >
                  Review blocked →
                </Box>
              </Box>
            )}

            <Box
              sx={{
                border: '1px solid var(--rule)',
                borderRadius: '16px',
                bgcolor: 'var(--surface)',
                p: 2,
                mb: 3,
              }}
            >
              <Typography
                sx={{
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-4)',
                  mb: 1.5,
                }}
              >
                Live flow
              </Typography>

              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                <FlowStage
                  title="Blocked"
                  value={String(blockedCount)}
                  detail="Orders needing attention before release"
                  active={blockedCount > 0}
                />
                <FlowStage
                  title="Release pool"
                  value={String(readyCount)}
                  detail="Clean orders eligible for batching"
                  active
                />
                <FlowStage
                  title="Fulfillment"
                  value={String(activeBatchCount)}
                  detail="Released batches on the warehouse floor"
                  active={activeBatchCount > 0}
                />
              </Box>
            </Box>

            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 2,
                px: 2,
                py: 1.5,
                mb: 3,
                bgcolor: 'var(--surface)',
                border: '1px solid var(--rule)',
                borderRadius: '14px',
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
                  Fulfillment live
                </Typography>

                <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                  {fulfillmentStatusLine}
                </Typography>
              </Box>

              <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
                {pickingCount} currently picking
              </Typography>
            </Box>

            {releaseSuccess && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1.5,
                  px: 2,
                  py: 1.375,
                  mb: 2,
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

            {blockedCount > 0 && (
              <Box
                id="blocked-orders"
                sx={{
                  bgcolor: 'var(--surface)',
                  border: '1px solid var(--rule)',
                  borderRadius: '14px',
                  overflow: 'hidden',
                  mb: 3,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 2,
                    px: 2,
                    py: 1.5,
                    bgcolor: 'var(--bg-2)',
                    borderBottom: '1px solid var(--rule)',
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
                      Blocked review
                    </Typography>

                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                      Resolve these before they can enter the release pool.
                    </Typography>
                  </Box>

                  <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)' }}>
                    {blockedCount} blocked · {fmt$(heldRevenue)} held
                  </Typography>
                </Box>

                {visibleBlocked.slice(0, 5).map((order) => (
                  <Box
                    key={order.order_id}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0,1fr) 130px 100px 110px',
                      gap: 1.5,
                      alignItems: 'center',
                      px: 2,
                      py: 1.375,
                      borderTop: '1px solid var(--rule)',
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

                    <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>
                      {fmt$(Number(order.revenue ?? 0))}
                    </Typography>
                  </Box>
                ))}

                {blockedCount > 5 && (
                  <Box sx={{ px: 2, py: 1.25, borderTop: '1px solid var(--rule)', bgcolor: 'var(--bg)' }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                      Showing 5 of {blockedCount} blocked orders. Full resolution drawer comes next.
                    </Typography>
                  </Box>
                )}
              </Box>
            )}

            <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 2.5, alignItems: 'start' }}>
              <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }}>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '36px 40px minmax(0,1fr) 86px 72px 72px 90px 110px',
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
                  {['Order', 'Value', 'Lines', 'Units', 'Age', 'Zones'].map((col) => (
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

                {poolOrders.length === 0 && (
                  <Box sx={{ px: 3, py: 6, textAlign: 'center' }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-4)' }}>
                      No orders in the release pool. Orders are either blocked, already batched, or not ready yet.
                    </Typography>
                  </Box>
                )}

                {visiblePool.map((order) => {
                  const isSelected = selected.has(order.lasyncro_order_id);
                  const zones = getOrderZones(order);
                  const hours = ageHoursFrom(order.order_created_at);

                  return (
                    <Box
                      key={order.lasyncro_order_id}
                      onClick={() => toggleSelect(order.lasyncro_order_id)}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: '36px 40px minmax(0,1fr) 86px 72px 72px 90px 110px',
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
                          {order.external_order_id ? `#${order.external_order_id}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                        </Typography>

                        {order.is_priority_flagged && (
                          <Typography
                            sx={{
                              fontSize: 9.5,
                              fontWeight: 600,
                              letterSpacing: '0.07em',
                              textTransform: 'uppercase',
                              color: 'var(--accent)',
                              mt: 0.125,
                            }}
                          >
                            Priority
                          </Typography>
                        )}
                      </Box>

                      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                        {fmtOrderValue(Number(order.total_price), order.currency)}
                      </Typography>

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
                        {zones.length === 0 ? '—' : zones.join(' · ')}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>

              <Box sx={{ position: 'sticky', top: '20px', bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '20px' }}>
                <Typography
                  sx={{
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-4)',
                    mb: 2,
                  }}
                >
                  Next wave
                </Typography>

                <Typography sx={{ fontSize: 38, fontWeight: 700, color: 'var(--ink)', lineHeight: 1, letterSpacing: '-0.02em' }}>
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

                <Box sx={{ mt: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 1.25, borderTop: '1px solid var(--rule)' }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-4)' }}>Line items</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{waveLineItems}</Typography>
                  </Box>

                  <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 1.25, borderTop: '1px solid var(--rule)' }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-4)' }}>Units to pick</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{waveUnits}</Typography>
                  </Box>
                </Box>

                <Box sx={{ mt: 2.5 }}>
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
                    mt: 2.5,
                    bgcolor: 'var(--bg)',
                    border: '1px solid var(--rule)',
                    borderRadius: '8px',
                    px: 1.5,
                    py: 1.125,
                    fontSize: 12.5,
                    color: operatorId ? 'var(--ink)' : 'var(--ink-4)',
                    cursor: 'pointer',
                    outline: 'none',
                    fontFamily: 'inherit',
                    appearance: 'none',
                    display: 'block',
                    '&:focus': { borderColor: 'var(--rule-2)' },
                  }}
                >
                  <option value="">Dispatch to all operators</option>
                  {operators.map((operator) => (
                    <option key={operator.user_id} value={String(operator.user_id)}>
                      {operator.first_name} {operator.last_name}{operator.role === 'owner' ? ' (you)' : ` · ${operator.role}`}
                    </option>
                  ))}
                </Box>

                {releaseBatch.isError && (
                  <Typography sx={{ fontSize: 11.5, fontWeight: 500, color: 'var(--accent)', mt: 1.25 }}>
                    Release failed. Please retry.
                  </Typography>
                )}

                <Box
                  component="button"
                  onClick={handleRelease}
                  disabled={releaseBatch.isPending || poolOrders.length === 0}
                  sx={{
                    width: '100%',
                    fontSize: 13,
                    fontWeight: 600,
                    color: poolOrders.length > 0 ? 'var(--ink)' : 'var(--ink-4)',
                    bgcolor: poolOrders.length > 0 ? 'var(--accent)' : 'var(--bg-2)',
                    border: 'none',
                    borderRadius: '8px',
                    py: 1.375,
                    textAlign: 'center',
                    cursor: releaseBatch.isPending ? 'not-allowed' : 'pointer',
                    mt: 2.5,
                    fontFamily: 'inherit',
                    '&:hover': { opacity: poolOrders.length > 0 && !releaseBatch.isPending ? 0.88 : 1 },
                    '&:disabled': { opacity: 0.6, cursor: 'not-allowed' },
                  }}
                >
                  {releaseBatch.isPending ? 'Releasing…' : 'Release wave to floor'}
                </Box>

                <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', textAlign: 'center', mt: 1.5 }}>
                  Pickers see it on their mobile instantly.
                </Typography>
              </Box>
            </Box>
          </>
        )}
      </Box>
    
    </Box>
  );
}