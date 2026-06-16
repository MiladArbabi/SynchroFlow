// apps/frontend/src/pages/ft2-pages/BlockedOrdersPage.tsx
//
// BLOCKED ORDERS — flat triage table, sorted oldest first
// Design: Orders / Blocked tab — flat bulk-select table, severity reading order top-to-bottom
//
// RULES: No hardcoded hex except severity tokens. No alpha(). No fontFamily overrides.
import { useState } from 'react';
import { Box, Typography, CircularProgress, Checkbox } from '@mui/material';
import { Package } from 'lucide-react';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { axiosInstance } from 'api/axiosConfig';
import { useQuery } from '@tanstack/react-query';

interface ConstrainedOrder {
  order_id: string;
  external_order_id: string | null;
  constraint_type: 'inventory' | 'customer' | 'operational';
  block_type: string | null;
  constrained_since: string | null;
  revenue: string;
  recommended_action: string | null;
  is_shipping_sla_breached: boolean | null;
  age_since_creation_seconds: number | null;
}

function useConstrainedOrders() {
  return useQuery<{ orders: ConstrainedOrder[]; total: number }>({
    queryKey: ['orders', 'constrained'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/orders/constrained?limit=50');
      return { orders: data.data ?? [], total: data.data?.length ?? 0 };
    },
    refetchInterval: 60_000,
  });
}

const ageHours = (seconds: number | null): number =>
  seconds == null ? 0 : Math.round(seconds / 3600);

const fmtAge = (hours: number): string => {
  if (hours < 24) return `${hours}h`;
  const d = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem === 0 ? `${d}d` : `${d}d ${rem}h`;
};

const fmt$ = (price: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(price));

const REASON_LABEL: Record<string, string> = {
  inventory:   'Out of stock',
  customer:    'Address issue',
  operational: 'SLA breach',
};

const RESOLVE_HREF: Record<string, string> = {
  inventory:   '/inventory',
  customer:    '/orders',
  operational: '/fulfillment',
};

export default function BlockedOrdersPage() {
  const { data, isLoading, isError } = useConstrainedOrders();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // SLA-breached first, then oldest first within each group
  const orders = [...(data?.orders ?? [])].sort((a, b) => {
    const aBreached = a.is_shipping_sla_breached ? 1 : 0;
    const bBreached = b.is_shipping_sla_breached ? 1 : 0;
    if (bBreached !== aBreached) return bBreached - aBreached;
    return ageHours(b.age_since_creation_seconds) - ageHours(a.age_since_creation_seconds);
  });

  const totalRevenue = orders.reduce((sum, o) => sum + Number(o.revenue), 0);
  const breachedCount = orders.filter(o => o.is_shipping_sla_breached).length;

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(prev =>
      prev.size === orders.length && orders.length > 0
        ? new Set()
        : new Set(orders.map(o => o.order_id))
    );
  };

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%' }}>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />

      <Box sx={{ p: '32px 40px' }}>

        {/* HEADER */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3 }}>
          <Box>
            <Typography sx={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }}>
              Blocked orders
            </Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
              {isLoading
                ? '—'
                : `${orders.length} orders blocked · ${fmt$(String(totalRevenue))} held · sorted oldest first`}
            </Typography>
          </Box>
          {/* Export blocked orders — Core+ (GH #1014) */}
          <Box
            onClick={async () => {
              try {
                const res = await axiosInstance.post('/api/v1/exports/orders', { filters: { status: ['blocked'] } }, { responseType: 'blob' });
                const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = `lasyncro-blocked-orders-${new Date().toISOString().split('T')[0]}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              } catch { console.error('[BlockedOrders] export failed'); }
            }}
            sx={{ display: 'inline-flex', alignItems: 'center', px: '12px', py: '6px', fontSize: 12, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent-border)', borderRadius: '6px', cursor: 'pointer', flexShrink: 0, mt: '6px', '&:hover': { opacity: 0.75 } }}
          >
            Export →
          </Box>
        </Box>

        {isError && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, mb: 3, bgcolor: 'rgba(229,72,77,0.07)', border: '1px solid rgba(229,72,77,0.2)', borderRadius: '10px' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink)' }}>Failed to load blocked orders.</Typography>
          </Box>
        )}

        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
            <CircularProgress size={24} sx={{ color: 'var(--accent)' }} />
          </Box>
        )}

        {!isLoading && orders.length === 0 && !isError && (
          <Box sx={{ py: 8, textAlign: 'center', border: '1px solid var(--rule)', borderRadius: '14px', bgcolor: 'var(--surface)' }}>
            <Package size={36} style={{ opacity: 0.15, marginBottom: 12 }} />
            <Typography sx={{ fontSize: 14, fontWeight: 300, color: 'var(--ink-4)' }}>
              No blocked orders — queue is clear.
            </Typography>
          </Box>
        )}

        {/* ALERT BANNER */}
        {orders.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.375, mb: 2, bgcolor: 'rgba(229,72,77,0.07)', border: '1px solid rgba(229,72,77,0.2)', borderRadius: '12px' }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#E5484D', flexShrink: 0 }} />
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-2)' }}>
              <Box component="span" sx={{ fontWeight: 600, color: 'var(--ink)' }}>{orders.length} orders blocked</Box>
              {' · '}{fmt$(String(totalRevenue))} in paid revenue held
              {breachedCount > 0 && `. ${breachedCount} SLA breached — oldest is ${fmtAge(ageHours(orders[0]?.age_since_creation_seconds))}.`}
            </Typography>
          </Box>
        )}

        {/* BULK SELECTION TOOLBAR */}
        {selected.size > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, mb: 1.5, bgcolor: 'var(--bg-3)', border: '1px solid var(--rule)', borderRadius: '10px' }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>
              {selected.size} selected
            </Typography>
            <Box
              component="a"
              href="/fulfillment"
              sx={{ fontSize: 12, fontWeight: 600, color: '#10151E', bgcolor: 'var(--accent)', border: 'none', borderRadius: '8px', px: 1.75, py: 0.75, cursor: 'pointer', textDecoration: 'none', '&:hover': { opacity: 0.88 } }}
            >
              Release to floor
            </Box>
            <Box sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', bgcolor: 'transparent', border: '1px solid var(--rule)', borderRadius: '8px', px: 1.75, py: 0.75, cursor: 'pointer', '&:hover': { bgcolor: 'var(--bg-2)' } }}>
              Notify customers
            </Box>
            <Box sx={{ fontSize: 12, fontWeight: 500, color: '#F2555A', bgcolor: 'transparent', border: '1px solid rgba(229,72,77,0.3)', borderRadius: '8px', px: 1.75, py: 0.75, cursor: 'pointer', '&:hover': { bgcolor: 'rgba(229,72,77,0.07)' } }}>
              Refund &amp; cancel
            </Box>
            <Box onClick={() => setSelected(new Set())} sx={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-4)', px: 1, py: 0.75, cursor: 'pointer', '&:hover': { color: 'var(--ink)' } }}>
              Clear
            </Box>
          </Box>
        )}

        {/* TABLE */}
        {orders.length > 0 && (
          <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }}>

            {/* Table header */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '34px minmax(0,1.5fr) 130px 100px 110px 90px', gap: '12px', alignItems: 'center', px: 2.5, py: 1.25, borderBottom: '1px solid var(--rule)' }}>
              <Checkbox
                size="small" sx={{ p: 0 }}
                checked={selected.size === orders.length && orders.length > 0}
                indeterminate={selected.size > 0 && selected.size < orders.length}
                onChange={toggleAll}
              />
              {['Order', 'Reason', 'Value', 'Blocked for', ''].map((col, i) => (
                <Typography key={i} sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  {col}
                </Typography>
              ))}
            </Box>

            {/* Rows */}
            {orders.map(order => {
              const hours = ageHours(order.age_since_creation_seconds);
              const isBreached = !!order.is_shipping_sla_breached;
              const ageColor = hours > 168 ? '#E5484D' : hours > 48 ? '#D9A23B' : 'var(--ink-3)';

              return (
                <Box
                  key={order.order_id}
                  sx={{ display: 'grid', gridTemplateColumns: '34px minmax(0,1.5fr) 130px 100px 110px 90px', gap: '12px', alignItems: 'center', px: 2.5, py: 1.375, borderTop: '1px solid var(--rule)', '&:hover': { bgcolor: 'var(--bg-2)' } }}
                >
                  <Checkbox
                    size="small" sx={{ p: 0 }}
                    checked={selected.has(order.order_id)}
                    onChange={() => toggleSelect(order.order_id)}
                    onClick={e => e.stopPropagation()}
                  />

                  <Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {order.external_order_id ? `#${order.external_order_id}` : order.order_id.slice(0, 8).toUpperCase()}
                    </Typography>
                    {isBreached && (
                      <Typography sx={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.08em', color: '#E5484D', textTransform: 'uppercase', mt: 0.25 }}>
                        SLA breached
                      </Typography>
                    )}
                  </Box>

                  <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'var(--ink-3)' }}>
                    {REASON_LABEL[order.constraint_type] ?? order.constraint_type}
                  </Typography>

                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', textAlign: 'right' }}>
                    {fmt$(order.revenue)}
                  </Typography>

                  <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: ageColor, textAlign: 'right' }}>
                    {fmtAge(hours)}
                  </Typography>

                  <Box sx={{ textAlign: 'right' }}>
                    <Box
                      component="a"
                      href={`${RESOLVE_HREF[order.constraint_type]}?order=${order.order_id}`}
                      sx={{ fontSize: 12, fontWeight: 500, color: 'var(--accent-hover)', cursor: 'pointer', textDecoration: 'none', '&:hover': { color: 'var(--accent)' } }}
                    >
                      Resolve →
                    </Box>
                  </Box>
                </Box>
              );
            })}

            {/* Footer */}
            <Box sx={{ px: 2.5, py: 1.25, borderTop: '1px solid var(--rule)', bgcolor: 'var(--bg-2)' }}>
              <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                Sorted oldest first — the queue empties from the top
              </Typography>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
