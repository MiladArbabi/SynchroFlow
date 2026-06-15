// apps/frontend/src/pages/ft2-pages/OrdersOutboundPage.tsx
//
// OUTBOUND TAB — Shipped orders ledger
// Route: /orders/outbound
//
// RULES: No alpha(). No useTheme(). No fontFamily overrides. 1px borders. 12px inner cards, 14px table.
import { useMemo, useState } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { Clock, Package, TrendingUp, DollarSign } from 'lucide-react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { axiosInstance } from 'api/axiosConfig';
import { useNavigate } from 'react-router-dom';

// ─── TYPES ────────────────────────────────────────────

interface FulfilledOrder {
  lasyncro_order_id: string;
  external_order_id: string | null;
  total_price: string;
  order_created_at: string;
  fulfilled_at: string;
  hours_to_fulfil: string;
  tracking_number: string | null;
  tracking_url: string | null;
  carrier_code: string | null;
}

interface FulfilledOrdersResponse {
  orders: FulfilledOrder[];
  total: number;
  page: number;
  limit: number;
}

// ─── HOOK ─────────────────────────────────────────────

type SortField = 'fulfilled_at' | 'order_created_at' | 'total_price' | 'hours_to_fulfil';
type SortDir   = 'asc' | 'desc';
type DateRange = 'week' | 'month' | 'all';

function useFulfilledOrders(page: number, perPage: number, sortField: SortField, sortDir: SortDir, dateRange: DateRange) {
  return useQuery<FulfilledOrdersResponse, Error, FulfilledOrdersResponse>({
    queryKey: ['orders', 'fulfilled', page, perPage, sortField, sortDir, dateRange],
    queryFn: async (): Promise<FulfilledOrdersResponse> => {
      const params = new URLSearchParams({ limit: String(perPage), page: String(page), sort: sortField, dir: sortDir, range: dateRange });
      const { data } = await axiosInstance.get<FulfilledOrdersResponse>(`/api/v1/orders/fulfilled?${params}`);
      return data;
    },
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

// ─── HELPERS ──────────────────────────────────────────

const fmt$ = (price: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(price));

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const fmtFulfilTime = (hours: string): string => {
  const h = Number(hours);
  if (h < 1) return '<1h';
  const hr = Math.round(h);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  const rem = hr % 24;
  return rem === 0 ? `${d}d` : `${d}d ${rem}h`;
};

const isThisWeek = (iso: string): boolean => {
  const date = new Date(iso);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return date >= weekAgo;
};

// ─── STAT CARD ────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, valueColor, onSubClick }: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; valueColor?: string;
  onSubClick?: () => void;
}) {
  return (
    <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '12px', p: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <Icon size={12} color="var(--ink-4)" />
        <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          {label}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: 28, fontWeight: 700, color: valueColor ?? 'var(--ink)', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      {sub && (
        <Typography
          onClick={onSubClick}
          sx={{ fontSize: 11, fontWeight: 300, color: onSubClick ? 'var(--accent)' : 'var(--ink-4)', cursor: onSubClick ? 'pointer' : 'default', '&:hover': onSubClick ? { opacity: 0.75 } : {} }}
        >
          {sub}
        </Typography>
      )}
    </Box>
  );
}

// ─── MAIN ─────────────────────────────────────────────

export default function OrdersOutboundPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [sortField, setSortField] = useState<SortField>('fulfilled_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [dateRange, setDateRange] = useState<DateRange>('all');

  const { data, isLoading, isError } = useFulfilledOrders(page, perPage, sortField, sortDir, dateRange);

  const handleSort = (field: SortField) => {
    if (field === sortField) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
    setPage(1);
  };

  const handleRangeChange = (range: DateRange) => { setDateRange(range); setPage(1); };

  const orders = useMemo(() => data?.orders ?? [], [data?.orders]);

  const pulse = useMemo(() => {
    const thisWeek       = orders.filter(o => isThisWeek(o.fulfilled_at));
    const revenueThisWeek = thisWeek.reduce((s, o) => s + Number(o.total_price), 0);
    const allHours       = orders.map(o => Number(o.hours_to_fulfil)).filter(h => !isNaN(h) && h > 0);
    const avgHours       = allHours.length > 0 ? allHours.reduce((s, h) => s + h, 0) / allHours.length : null;
    return {
      shippedThisWeek: thisWeek.length,
      revenueThisWeek,
      avgFulfilHours: avgHours,
      total: data?.total ?? 0,
      trackedCount: thisWeek.filter(o => o.tracking_number).length,
    };
  }, [orders, data?.total]);

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%' }}>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />

      <Box sx={{ p: '32px 40px' }}>

        {/* HEADER */}
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }}>
            Outbound
          </Typography>
          <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
            {isLoading
              ? '—'
              : `${pulse.shippedThisWeek} shipped this week · ${fmt$(String(pulse.revenueThisWeek))} collected · ${pulse.total} total`}
          </Typography>
        </Box>

        {isError && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, mb: 3, bgcolor: 'rgba(229,72,77,0.07)', border: '1px solid rgba(229,72,77,0.2)', borderRadius: '10px' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink)' }}>Failed to load fulfilled orders.</Typography>
          </Box>
        )}

        {/* PULSE CARDS */}
        <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
          <StatCard
            label="Shipped this week"
            value={isLoading ? '—' : String(pulse.shippedThisWeek)}
            sub="last 7 days"
            icon={Package}
            valueColor={pulse.shippedThisWeek > 0 ? '#4CAF7A' : undefined}
          />
          <StatCard
            label="Revenue collected"
            value={isLoading ? '—' : fmt$(String(pulse.revenueThisWeek))}
            sub="fulfilled this week"
            icon={DollarSign}
            valueColor="#4CAF7A"
          />
          <StatCard
            label="Avg time to fulfil"
            value={isLoading || pulse.avgFulfilHours == null ? '—' : fmtFulfilTime(String(pulse.avgFulfilHours))}
            sub="creation to shipped"
            icon={Clock}
          />
          <StatCard
            label="Carrier tracking"
            value={isLoading ? '—' : pulse.trackedCount > 0 ? `${pulse.trackedCount} tracked` : 'Not configured'}
            sub={pulse.trackedCount > 0 ? `of ${pulse.shippedThisWeek} shipped this week` : 'Connect a carrier in Settings →'}
            icon={TrendingUp}
            valueColor={pulse.trackedCount > 0 ? '#4CAF7A' : 'var(--ink-4)'}
            onSubClick={pulse.trackedCount === 0 ? () => navigate('/settings/carriers') : undefined}
          />
        </Box>

        {/* FILTER BAR */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          {(['week', 'month', 'all'] as DateRange[]).map(range => (
            <Box
              key={range}
              onClick={() => handleRangeChange(range)}
              sx={{
                px: 1.5, py: 0.625, borderRadius: '6px', cursor: 'pointer',
                fontSize: 12, fontWeight: 500,
                bgcolor: dateRange === range ? 'var(--accent)' : 'var(--surface)',
                color: dateRange === range ? '#10151E' : 'var(--ink-3)',
                border: '1px solid',
                borderColor: dateRange === range ? 'var(--accent)' : 'var(--rule)',
                transition: 'all 0.12s ease',
              }}
            >
              {range === 'week' ? 'This week' : range === 'month' ? 'This month' : 'All time'}
            </Box>
          ))}
        </Box>

        {/* LEDGER TABLE */}
        <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }}>

          {/* Sortable table header */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 100px 130px 130px 100px 120px', px: 2, py: 1.25, bgcolor: 'var(--bg-2)', borderBottom: '1px solid var(--rule)' }}>
            {([
              { label: 'Order',          field: null                    },
              { label: 'Value',          field: 'total_price'           },
              { label: 'Ordered',        field: 'order_created_at'      },
              { label: 'Fulfilled',      field: 'fulfilled_at'          },
              { label: 'Time to fulfil', field: 'hours_to_fulfil'       },
              { label: 'Tracking',       field: null                    },
            ] as { label: string; field: SortField | null }[]).map(({ label, field }) => (
              <Box key={label} onClick={() => field && handleSort(field)} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: field ? 'pointer' : 'default' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: field && sortField === field ? 'var(--accent)' : 'var(--ink-4)' }}>
                  {label}
                </Typography>
                {field && sortField === field && (
                  <Typography sx={{ fontSize: 9, color: 'var(--accent)' }}>
                    {sortDir === 'desc' ? '↓' : '↑'}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>

          {/* Loading */}
          {isLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={24} sx={{ color: 'var(--accent)' }} />
            </Box>
          )}

          {/* Empty */}
          {!isLoading && orders.length === 0 && (
            <Box sx={{ px: 3, py: 6, textAlign: 'center' }}>
              <Package size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
              <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-4)' }}>
                No fulfilled orders yet.
              </Typography>
            </Box>
          )}

          {/* Rows */}
          {orders.map(order => {
            const hours  = Number(order.hours_to_fulfil);
            const isFast = hours <= 48;
            const ttfBg  = isFast ? 'rgba(76,175,122,0.1)' : 'rgba(245,158,11,0.1)';
            const ttfColor = isFast ? '#4CAF7A' : '#D9A23B';

            return (
              <Box
                key={order.lasyncro_order_id}
                sx={{ display: 'grid', gridTemplateColumns: '1fr 100px 130px 130px 100px 120px', alignItems: 'center', px: 2, py: 1.25, borderTop: '1px solid var(--rule)', '&:hover': { bgcolor: 'var(--bg-2)' } }}
              >
                {/* Order ID */}
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {order.external_order_id ? `#${order.external_order_id}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                </Typography>

                {/* Value */}
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt$(order.total_price)}
                </Typography>

                {/* Ordered */}
                <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
                  {fmtDate(order.order_created_at)}
                </Typography>

                {/* Fulfilled */}
                <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
                  {fmtDate(order.fulfilled_at)}
                </Typography>

                {/* Time to fulfil */}
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: '4px', width: 'fit-content', bgcolor: ttfBg }}>
                  <Clock size={10} color={ttfColor} />
                  <Typography sx={{ fontSize: 12, fontWeight: 500, color: ttfColor, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtFulfilTime(order.hours_to_fulfil)}
                  </Typography>
                </Box>

                {/* Tracking */}
                {order.tracking_number ? (
                  order.tracking_url ? (
                    <Box
                      component="a"
                      href={order.tracking_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: '4px', bgcolor: 'var(--accent-ghost)', border: '1px solid var(--accent-border)', width: 'fit-content', textDecoration: 'none', '&:hover': { opacity: 0.8 } }}
                    >
                      <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'var(--accent)', letterSpacing: '0.04em' }}>
                        {order.tracking_number}
                      </Typography>
                    </Box>
                  ) : (
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', px: 1, py: 0.25, borderRadius: '4px', bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)', width: 'fit-content' }}>
                      <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
                        {order.tracking_number}
                      </Typography>
                    </Box>
                  )
                ) : (
                  <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>—</Typography>
                )}
              </Box>
            );
          })}

          {/* Footer + pagination */}
          {!isLoading && data && data.total > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, bgcolor: 'var(--bg-2)', borderTop: '1px solid var(--rule)' }}>

              {/* Left: count + page size */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                  {((page - 1) * perPage) + 1}–{Math.min(page * perPage, data.total)} of {data.total} orders
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  {[10, 25, 50, 100].map(n => (
                    <Box
                      key={n}
                      onClick={() => { setPerPage(n); setPage(1); }}
                      sx={{ px: 1, py: 0.25, fontSize: 10, border: '1px solid', borderColor: n === perPage ? 'var(--accent)' : 'var(--rule)', borderRadius: '4px', bgcolor: n === perPage ? 'var(--accent-ghost)' : 'var(--surface)', color: n === perPage ? 'var(--accent)' : 'var(--ink-4)', cursor: 'pointer', fontWeight: n === perPage ? 600 : 400 }}
                    >
                      {n}
                    </Box>
                  ))}
                </Box>
              </Box>

              {/* Right: prev / pages / next */}
              {(() => {
                const pageCount = Math.ceil(data.total / perPage);
                return (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {pageCount > 1 && (
                      <Box
                        onClick={() => page > 1 && setPage(p => p - 1)}
                        sx={{ px: 1.5, py: 0.5, borderRadius: '6px', cursor: page > 1 ? 'pointer' : 'not-allowed', border: '1px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12, fontWeight: 300, color: page > 1 ? 'var(--ink-3)' : 'var(--ink-4)', opacity: page > 1 ? 1 : 0.4 }}
                      >
                        ← Prev
                      </Box>
                    )}
                    {pageCount > 1 && Array.from({ length: pageCount }, (_, i) => (
                      <Box
                        key={i}
                        onClick={() => setPage(i + 1)}
                        sx={{ px: 1.5, py: 0.5, fontSize: 11, border: '1px solid', borderColor: i + 1 === page ? 'var(--accent)' : 'var(--rule)', borderRadius: '6px', bgcolor: i + 1 === page ? 'var(--accent)' : 'var(--surface)', color: i + 1 === page ? '#10151E' : 'var(--ink-3)', cursor: 'pointer', fontWeight: i + 1 === page ? 600 : 400 }}
                      >
                        {i + 1}
                      </Box>
                    ))}
                    {pageCount > 1 && (
                      <Box
                        onClick={() => page < pageCount && setPage(p => p + 1)}
                        sx={{ px: 1.5, py: 0.5, borderRadius: '6px', cursor: page < pageCount ? 'pointer' : 'not-allowed', border: '1px solid var(--rule)', bgcolor: 'var(--surface)', fontSize: 12, fontWeight: 300, color: page < pageCount ? 'var(--ink-3)' : 'var(--ink-4)', opacity: page < pageCount ? 1 : 0.4 }}
                      >
                        Next →
                      </Box>
                    )}
                  </Box>
                );
              })()}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
