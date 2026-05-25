// apps/frontend/src/pages/ft2-pages/OrdersOutboundPage.tsx
//
// OUTBOUND TAB — Phase 1: Shipped orders ledger
// Route: /orders/outbound
//
// Data source: GET /api/v1/orders/fulfilled
// Phase 2 (carrier tracking) — requires shipping integration workshop.
//
// RULES:
// - No hardcoded hex — CSS variables or theme.palette.* only
// - No inline style={} — MUI sx only
// - No cross-module imports

import { useMemo, useState } from 'react';
import { Box, Typography, CircularProgress, Alert, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Clock, Package, TrendingUp, DollarSign } from 'lucide-react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { axiosInstance } from 'api/axiosConfig';

// ─── TYPES ────────────────────────────────────────────

interface FulfilledOrder {
  lasyncro_order_id: string;
  external_order_id: string | null;
  total_price: string;
  order_created_at: string;
  fulfilled_at: string;
  hours_to_fulfil: string;
}

interface FulfilledOrdersResponse {
  orders: FulfilledOrder[];
  total: number;
  page: number;
  limit: number;
}

// ─── HOOK ─────────────────────────────────────────────

type SortField = 'fulfilled_at' | 'order_created_at' | 'total_price' | 'hours_to_fulfil';
type SortDir = 'asc' | 'desc';
type DateRange = 'week' | 'month' | 'all';

function useFulfilledOrders(page: number, sortField: SortField, sortDir: SortDir, dateRange: DateRange) {
  return useQuery<FulfilledOrdersResponse, Error, FulfilledOrdersResponse>({
    queryKey: ['orders', 'fulfilled', page, sortField, sortDir, dateRange],
    queryFn: async (): Promise<FulfilledOrdersResponse> => {
      const params = new URLSearchParams({
        limit: '25',
        page: String(page),
        sort: sortField,
        dir: sortDir,
        range: dateRange,
      });
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
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return date >= weekAgo;
};

// ─── STAT CARD ────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, valueColor }: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  valueColor?: string;
}) {
  return (
    <Box sx={{
      bgcolor: 'var(--surface)',
      border: '0.5px solid var(--rule)',
      borderRadius: '10px',
      p: '14px 16px',
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 0.5,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <Icon size={12} color="var(--ink-4)" />
        <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          {label}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: 24, fontWeight: 500, color: valueColor ?? 'var(--ink)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      {sub && (
        <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
          {sub}
        </Typography>
      )}
    </Box>
  );
}

// ─── MAIN ─────────────────────────────────────────────

export default function OrdersOutboundPage() {
  const theme = useTheme();
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('fulfilled_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [dateRange, setDateRange] = useState<DateRange>('all');

  const { data, isLoading, isError } = useFulfilledOrders(page, sortField, sortDir, dateRange);

  // Reset to page 1 when filters/sort change
  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
    setPage(1);
  };

  const handleRangeChange = (range: DateRange) => {
    setDateRange(range);
    setPage(1);
  };

  const orders = useMemo(() => data?.orders ?? [], [data?.orders]);

  // ── Pulse stats ────────────────────────────────────
  const pulse = useMemo(() => {
    const thisWeek = orders.filter(o => isThisWeek(o.fulfilled_at));
    const revenueThisWeek = thisWeek.reduce((s, o) => s + Number(o.total_price), 0);
    const allHours = orders
      .map(o => Number(o.hours_to_fulfil))
      .filter(h => !isNaN(h) && h > 0);
    const avgHours = allHours.length > 0
      ? allHours.reduce((s, h) => s + h, 0) / allHours.length
      : null;

    return {
      shippedThisWeek: thisWeek.length,
      revenueThisWeek,
      avgFulfilHours: avgHours,
      total: data?.total ?? 0,
    };
  }, [orders, data?.total]);

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%' }}>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />

      <Box sx={{ p: '24px 40px' }}>

        {/* ── HEADER ─────────────────────────────────── */}
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2, mb: 0.25 }}>
            Outbound
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
            {isLoading
              ? '—'
              : `${pulse.shippedThisWeek} shipped this week · ${fmt$(String(pulse.revenueThisWeek))} collected · ${pulse.total} total`}
          </Typography>
        </Box>

        {isError && (
          <Alert severity="error" sx={{ mb: 3 }}>Failed to load fulfilled orders.</Alert>
        )}

        {/* ── PULSE ──────────────────────────────────── */}
        <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
          <StatCard
            label="Shipped this week"
            value={isLoading ? '—' : String(pulse.shippedThisWeek)}
            sub="last 7 days"
            icon={Package}
            valueColor={pulse.shippedThisWeek > 0 ? theme.palette.success.main : undefined}
          />
          <StatCard
            label="Revenue collected"
            value={isLoading ? '—' : fmt$(String(pulse.revenueThisWeek))}
            sub="fulfilled this week"
            icon={DollarSign}
            valueColor={theme.palette.success.main}
          />
          <StatCard
            label="Avg time to fulfil"
            value={isLoading || pulse.avgFulfilHours == null ? '—' : fmtFulfilTime(String(pulse.avgFulfilHours))}
            sub="creation to shipped"
            icon={Clock}
          />
          <StatCard
            label="Carrier tracking"
            value="Coming soon"
            sub="requires shipping integration"
            icon={TrendingUp}
            valueColor="var(--ink-4)"
          />
        </Box>

        {/* ── FILTER BAR ─────────────────────────────── */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          {(['week', 'month', 'all'] as DateRange[]).map(range => (
            <Box
              key={range}
              onClick={() => handleRangeChange(range)}
              sx={{
                px: 1.5, py: 0.625, borderRadius: '6px', cursor: 'pointer',
                fontSize: 12, fontWeight: 500,
                bgcolor: dateRange === range ? 'var(--accent)' : 'var(--surface)',
                color: dateRange === range ? theme.palette.common.white : 'var(--ink-3)',
                border: '0.5px solid',
                borderColor: dateRange === range ? 'var(--accent)' : 'var(--rule)',
                transition: 'all 0.12s ease',
              }}
            >
              {range === 'week' ? 'This week' : range === 'month' ? 'This month' : 'All time'}
            </Box>
          ))}
        </Box>

        {/* ── LEDGER TABLE ───────────────────────────── */}
        <Box sx={{
          bgcolor: 'var(--surface)',
          border: '0.5px solid var(--rule)',
          borderRadius: '10px',
          overflow: 'hidden',
        }}>
          {/* Sortable table header */}
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: '1fr 100px 130px 130px 100px 120px',
            px: 2, py: 1.25,
            bgcolor: 'var(--bg-2)',
            borderBottom: '0.5px solid var(--rule)',
          }}>
            {([
              { label: 'Order',          field: null                    },
              { label: 'Value',          field: 'total_price'           },
              { label: 'Ordered',        field: 'order_created_at'      },
              { label: 'Fulfilled',      field: 'fulfilled_at'          },
              { label: 'Time to fulfil', field: 'hours_to_fulfil'       },
              { label: 'Tracking',       field: null                    },
            ] as { label: string; field: SortField | null }[]).map(({ label, field }) => (
              <Box
                key={label}
                onClick={() => field && handleSort(field)}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: field ? 'pointer' : 'default' }}
              >
                <Typography sx={{
                  fontSize: 10, fontWeight: 500, letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: field && sortField === field ? 'var(--accent)' : 'var(--ink-4)',
                }}>
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
              <CircularProgress size={24} />
            </Box>
          )}

          {/* Empty */}
          {!isLoading && orders.length === 0 && (
            <Box sx={{ px: 3, py: 6, textAlign: 'center' }}>
              <Package size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
              <Typography sx={{ fontSize: 13, color: 'var(--ink-4)' }}>
                No fulfilled orders yet.
              </Typography>
            </Box>
          )}

          {/* Rows */}
          {orders.map((order) => {
            const hours = Number(order.hours_to_fulfil);
            const isFast = hours <= 48;
            return (
              <Box
                key={order.lasyncro_order_id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 100px 130px 130px 100px 120px',
                  alignItems: 'center',
                  px: 2, py: 1.25,
                  borderBottom: '0.5px solid var(--rule)',
                  '&:last-child': { borderBottom: 'none' },
                  '&:hover': { bgcolor: 'var(--bg-2)' },
                }}
              >
                {/* Order ID */}
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', fontFamily: 'monospace' }}>
                    {order.external_order_id ? `#${order.external_order_id}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                  </Typography>
                </Box>

                {/* Value */}
                <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt$(order.total_price)}
                </Typography>

                {/* Ordered */}
                <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {fmtDate(order.order_created_at)}
                </Typography>

                {/* Fulfilled */}
                <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {fmtDate(order.fulfilled_at)}
                </Typography>

                {/* Time to fulfil */}
                <Box sx={{
                  display: 'inline-flex', alignItems: 'center', gap: 0.5,
                  px: 1, py: 0.25, borderRadius: '4px', width: 'fit-content',
                  bgcolor: isFast
                    ? alpha(theme.palette.success.main, 0.08)
                    : alpha(theme.palette.warning.main, 0.08),
                }}>
                  <Clock size={10} color={isFast ? theme.palette.success.main : theme.palette.warning.main} />
                  <Typography sx={{
                    fontSize: 12, fontWeight: 500,
                    color: isFast ? theme.palette.success.main : theme.palette.warning.main,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {fmtFulfilTime(order.hours_to_fulfil)}
                  </Typography>
                </Box>

                {/* Tracking — Phase 2 placeholder */}
                <Box sx={{
                  display: 'inline-flex', alignItems: 'center',
                  px: 1, py: 0.25, borderRadius: '4px',
                  bgcolor: 'var(--bg-2)',
                  border: '0.5px solid var(--rule)',
                  width: 'fit-content',
                }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                    Not integrated
                  </Typography>
                </Box>
              </Box>
            );
          })}

          {/* Footer + pagination */}
          {!isLoading && data && data.total > 0 && (
            <Box sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              px: 2, py: 1,
              bgcolor: 'var(--bg-2)',
              borderTop: '0.5px solid var(--rule)',
            }}>
              <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                {((page - 1) * 25) + 1}–{Math.min(page * 25, data.total)} of {data.total} orders
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box
                  onClick={() => page > 1 && setPage(p => p - 1)}
                  sx={{
                    px: 1.5, py: 0.5, borderRadius: '6px', cursor: page > 1 ? 'pointer' : 'not-allowed',
                    border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
                    fontSize: 12, color: page > 1 ? 'var(--ink-3)' : 'var(--ink-4)',
                    opacity: page > 1 ? 1 : 0.4,
                  }}
                >
                  ← Prev
                </Box>
                <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', minWidth: 60, textAlign: 'center' }}>
                  Page {page} of {Math.ceil(data.total / 25)}
                </Typography>
                <Box
                  onClick={() => page < Math.ceil(data.total / 25) && setPage(p => p + 1)}
                  sx={{
                    px: 1.5, py: 0.5, borderRadius: '6px',
                    cursor: page < Math.ceil(data.total / 25) ? 'pointer' : 'not-allowed',
                    border: '0.5px solid var(--rule)', bgcolor: 'var(--surface)',
                    fontSize: 12, color: page < Math.ceil(data.total / 25) ? 'var(--ink-3)' : 'var(--ink-4)',
                    opacity: page < Math.ceil(data.total / 25) ? 1 : 0.4,
                  }}
                >
                  Next →
                </Box>
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}