// apps/frontend/src/pages/ft2-pages/ReleaseQueuePage.tsx
//
// RELEASE QUEUE — 2-column: pool table + sticky wave builder panel
// Design: Orders / Release tab
//
// RULES: No alpha(). No fontFamily overrides. No hardcoded hex except severity tokens.
import { useState, useCallback, useMemo } from 'react';
import { Box, Typography, Checkbox, CircularProgress } from '@mui/material';
import { Flag, Clock } from 'lucide-react';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { useWmsOperators } from '../wms/useWmsOperators';
import { useOrderPool, useReleaseBatch, useSetPriority, type PoolOrder } from '../wms/useOrderPool';

const ageLabel = (iso: string): string => {
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

const ageHoursFrom = (iso: string): number =>
  Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);

const fmt$ = (price: number, currency: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price);

export default function ReleaseQueuePage() {
  const { data, isLoading, isError } = useOrderPool();
  const setPriority = useSetPriority();
  const releaseBatch = useReleaseBatch();
  const { data: operatorsData } = useWmsOperators();
  const operators = operatorsData?.operators ?? [];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [operatorId, setOperatorId] = useState<string>('');
  const [releaseSuccess, setReleaseSuccess] = useState<{ batchId: string; orderCount: number } | null>(null);

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const maxLineItems = data?.max_batch_line_items ?? 108;

  // Batch builder: show selected subset, else full pool
  const selectedOrders = orders.filter(o => selected.has(o.lasyncro_order_id));
  const useSubset = selected.size > 0;

  const waveOrders      = useSubset ? selected.size        : orders.length;
  const waveValue       = useSubset
    ? selectedOrders.reduce((s, o) => s + Number(o.total_price), 0)
    : orders.reduce((s, o) => s + Number(o.total_price), 0);
  const waveLineItems   = useSubset
    ? selectedOrders.reduce((s, o) => s + o.line_item_count, 0)
    : orders.reduce((s, o) => s + o.line_item_count, 0);
  const waveUnits       = useSubset
    ? selectedOrders.reduce((s, o) => s + o.unit_count, 0)
    : orders.reduce((s, o) => s + o.unit_count, 0);
  const allZones = (src: PoolOrder[]) =>
    [...new Set(src.flatMap(o => Array.isArray(o.zone_distribution) ? o.zone_distribution : []))].join(' · ') || '—';
  const waveZones = useSubset ? allZones(selectedOrders) : allZones(orders);

  const ceilingPct = Math.min(100, Math.round((waveLineItems / maxLineItems) * 100));

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected(prev =>
      prev.size === orders.length && orders.length > 0
        ? new Set()
        : new Set(orders.map(o => o.lasyncro_order_id))
    );
  }, [orders]);

  const handleRelease = async () => {
    try {
      const result = await releaseBatch.mutateAsync({
        priority_order_ids: selected.size > 0 ? [...selected] : undefined,
        assigned_operator_id: operatorId ? Number(operatorId) : undefined,
      });
      setSelected(new Set());
      setOperatorId('');
      setReleaseSuccess({ batchId: result.pick_batch_id, orderCount: result.order_count });
      setTimeout(() => setReleaseSuccess(null), 6000);
    } catch {
      // error shown via releaseBatch.isError
    }
  };

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%' }}>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />

      <Box sx={{ p: '32px 40px' }}>

        {/* HEADER */}
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }}>
            Release queue
          </Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
            {isLoading ? '—' : `${data?.eligible_order_count ?? 0} orders ready to batch · ceiling ${maxLineItems} line items`}
          </Typography>
        </Box>

        {/* SUCCESS BANNER */}
        {releaseSuccess && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.375, mb: 2, bgcolor: 'rgba(76,175,122,0.07)', border: '1px solid rgba(76,175,122,0.2)', borderRadius: '12px' }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#4CAF7A', flexShrink: 0 }} />
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-2)' }}>
              <Box component="span" sx={{ fontWeight: 600, color: 'var(--ink)' }}>{releaseSuccess.orderCount} orders released</Box>
              {' · '}
              <Box component="a" href="/fulfillment" sx={{ color: 'var(--accent)', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                Batch {releaseSuccess.batchId.slice(0, 8).toUpperCase()} in Fulfillment →
              </Box>
            </Typography>
          </Box>
        )}

        {isError && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, mb: 3, bgcolor: 'rgba(229,72,77,0.07)', border: '1px solid rgba(229,72,77,0.2)', borderRadius: '10px' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink)' }}>Failed to load order pool.</Typography>
          </Box>
        )}

        {/* 2-COLUMN LAYOUT */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 2.5, alignItems: 'start' }}>

          {/* LEFT — POOL TABLE */}
          <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }}>

            {/* Table header */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '36px 40px 1fr 80px 72px 72px 90px 90px', gap: '10px', alignItems: 'center', px: 2, py: 1.25, borderBottom: '1px solid var(--rule)', bgcolor: 'var(--bg-2)' }}>
              <Checkbox
                size="small" sx={{ p: 0 }}
                checked={selected.size === orders.length && orders.length > 0}
                indeterminate={selected.size > 0 && selected.size < orders.length}
                onChange={toggleSelectAll}
              />
              <Box /> {/* flag col */}
              {['Order', 'Value', 'Lines', 'Units', 'Age', 'Zones'].map((col) => (
                <Typography key={col} sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  {col}
                </Typography>
              ))}
            </Box>

            {isLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress size={24} sx={{ color: 'var(--accent)' }} />
              </Box>
            )}

            {!isLoading && orders.length === 0 && (
              <Box sx={{ px: 3, py: 6, textAlign: 'center' }}>
                <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-4)' }}>
                  No orders in pool — all orders are either batched or blocked.
                </Typography>
              </Box>
            )}

            {orders.map(order => {
              const isSelected = selected.has(order.lasyncro_order_id);
              const zones = Array.isArray(order.zone_distribution) ? order.zone_distribution : [];
              const hours = ageHoursFrom(order.order_created_at);
              const ageColor = hours > 48 ? '#E5484D' : 'var(--ink-3)';

              return (
                <Box
                  key={order.lasyncro_order_id}
                  onClick={() => toggleSelect(order.lasyncro_order_id)}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '36px 40px 1fr 80px 72px 72px 90px 90px',
                    gap: '10px',
                    alignItems: 'center',
                    px: 2, py: 1.375,
                    borderTop: '1px solid var(--rule)',
                    cursor: 'pointer',
                    bgcolor: isSelected ? 'rgba(255,107,43,0.06)' : 'transparent',
                    '&:hover': { bgcolor: isSelected ? 'rgba(255,107,43,0.09)' : 'var(--bg-2)' },
                  }}
                >
                  <Checkbox
                    size="small" sx={{ p: 0 }}
                    checked={isSelected}
                    onChange={(e) => { e.stopPropagation(); toggleSelect(order.lasyncro_order_id); }}
                    onClick={e => e.stopPropagation()}
                  />

                  {/* Priority flag */}
                  <Box
                    onClick={e => {
                      e.stopPropagation();
                      setPriority.mutate({ orderId: order.lasyncro_order_id, flagged: !order.is_priority_flagged });
                    }}
                    sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                  >
                    <Flag
                      size={13}
                      color={order.is_priority_flagged ? '#E5484D' : 'var(--ink-4)'}
                      fill={order.is_priority_flagged ? '#E5484D' : 'none'}
                    />
                  </Box>

                  {/* Order ID */}
                  <Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {order.external_order_id ? `#${order.external_order_id}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                    </Typography>
                    {order.is_priority_flagged && (
                      <Typography sx={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#E5484D', mt: 0.125 }}>Priority</Typography>
                    )}
                  </Box>

                  {/* Value */}
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                    {fmt$(Number(order.total_price), order.currency)}
                  </Typography>

                  {/* Lines */}
                  <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
                    {order.line_item_count}
                  </Typography>

                  {/* Units */}
                  <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
                    {order.unit_count}
                  </Typography>

                  {/* Age */}
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, width: 'fit-content' }}>
                    <Clock size={11} color={ageColor} />
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: ageColor }}>
                      {ageLabel(order.order_created_at)}
                    </Typography>
                  </Box>

                  {/* Zones */}
                  <Typography sx={{ fontSize: 11.5, fontWeight: 300, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {zones.length === 0 ? '—' : zones.join(' · ')}
                  </Typography>
                </Box>
              );
            })}
          </Box>

          {/* RIGHT — BATCH BUILDER */}
          <Box sx={{ position: 'sticky', top: '20px', bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '20px' }}>

            <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 2 }}>
              Next batch
            </Typography>

            <Typography sx={{ fontSize: 38, fontWeight: 700, color: 'var(--ink)', lineHeight: 1, letterSpacing: '-0.02em' }}>
              {waveOrders} order{waveOrders !== 1 ? 's' : ''}
            </Typography>
            <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-4)', mt: 0.625, mb: 0.25 }}>
              {waveValue > 0 ? fmt$(waveValue, 'USD') : '—'}
              {waveZones !== '—' && ` · zones ${waveZones}`}
            </Typography>

            {selected.size > 0 && (
              <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'var(--accent)', mt: 0.375 }}>
                {selected.size} handpicked · unselected orders fill ceiling automatically
              </Typography>
            )}

            {/* Stats */}
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

            {/* Floor capacity bar */}
            <Box sx={{ mt: 2.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  Floor capacity
                </Typography>
                <Typography sx={{ fontSize: 11, fontWeight: 600, color: ceilingPct > 90 ? '#E5484D' : 'var(--ink-4)' }}>
                  {ceilingPct}%
                </Typography>
              </Box>
              <Box sx={{ height: 6, borderRadius: '3px', bgcolor: 'var(--bg)', overflow: 'hidden' }}>
                <Box sx={{ height: '100%', width: `${ceilingPct}%`, bgcolor: ceilingPct > 90 ? '#E5484D' : '#4CAF7A', borderRadius: '3px', transition: 'width 0.3s ease' }} />
              </Box>
              <Typography sx={{ fontSize: 10.5, fontWeight: 300, color: 'var(--ink-4)', mt: 0.75 }}>
                {waveLineItems} of {maxLineItems} line item ceiling
              </Typography>
            </Box>

            {/* Operator selector */}
            <Box
              component="select"
              value={operatorId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setOperatorId(e.target.value)}
              sx={{
                width: '100%', mt: 2.5,
                bgcolor: 'var(--bg)', border: '1px solid var(--rule)',
                borderRadius: '8px', px: 1.5, py: 1.125,
                fontSize: 12.5, color: operatorId ? 'var(--ink)' : 'var(--ink-4)',
                cursor: 'pointer', outline: 'none', fontFamily: 'inherit',
                appearance: 'none', display: 'block',
                '&:focus': { borderColor: 'var(--rule-2)' },
              }}
            >
              <option value="">Dispatch to all operators</option>
              {operators.map(op => (
                <option key={op.user_id} value={String(op.user_id)}>
                  {op.first_name} {op.last_name}{op.role === 'owner' ? ' (you)' : ` · ${op.role}`}
                </option>
              ))}
            </Box>

            {releaseBatch.isError && (
              <Typography sx={{ fontSize: 11.5, fontWeight: 500, color: '#E5484D', mt: 1.25 }}>
                Release failed — please retry.
              </Typography>
            )}

            {/* CTA */}
            <Box
              component="button"
              onClick={handleRelease}
              disabled={releaseBatch.isPending || orders.length === 0}
              sx={{
                width: '100%', fontSize: 13, fontWeight: 600,
                color: orders.length > 0 ? '#10151E' : 'var(--ink-4)',
                bgcolor: orders.length > 0 ? 'var(--accent)' : 'var(--bg-2)',
                border: 'none', borderRadius: '8px', py: 1.375,
                textAlign: 'center', cursor: releaseBatch.isPending ? 'not-allowed' : 'pointer',
                mt: 2.5, fontFamily: 'inherit',
                '&:hover': { opacity: orders.length > 0 && !releaseBatch.isPending ? 0.88 : 1 },
                '&:disabled': { opacity: 0.6, cursor: 'not-allowed' },
              }}
            >
              {releaseBatch.isPending ? 'Releasing…' : 'Release wave to floor'}
            </Box>

            <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', textAlign: 'center', mt: 1.5 }}>
              Pickers see it on their mobile instantly
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
