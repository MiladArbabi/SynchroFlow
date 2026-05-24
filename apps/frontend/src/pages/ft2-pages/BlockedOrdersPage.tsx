// apps/frontend/src/pages/ft2-pages/BlockedOrdersPage.tsx
import { useState } from 'react';
import {
  Box, Typography, CircularProgress, Alert, Chip, Button,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import { AlertTriangle, Clock, Package, ArrowRight } from 'lucide-react';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { axiosInstance } from 'api/axiosConfig';
import { useQuery } from '@tanstack/react-query';

interface ConstrainedOrder {
  order_id: string;
  constraint_type: 'inventory' | 'customer' | 'operational';
  block_type: string | null;
  constrained_since: string | null;
  revenue: string;
  recommended_action: string | null;
  is_shipping_sla_breached: boolean | null;
  age_since_creation_seconds: number | null;
}

const CONSTRAINT_CONFIG = {
  inventory: {
    label: 'Out of Stock',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.25)',
    description: 'Items ordered are unavailable in current inventory.',
    action: 'View stock levels',
    actionHref: '/inventory',
  },
  customer: {
    label: 'Customer Action',
    color: '#3B82F6',
    bg: 'rgba(59,130,246,0.08)',
    border: 'rgba(59,130,246,0.25)',
    description: 'Awaiting customer confirmation — address, payment, or communication.',
    action: 'View order',
    actionHref: '/orders',
  },
  operational: {
    label: 'Operational Block',
    color: '#EF4444',
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.25)',
    description: 'SLA breach or carrier/operational issue blocking fulfillment.',
    action: 'Review & escalate',
    actionHref: '/orders',
  },
} as const;

function useConstrainedOrders() {
  return useQuery<{ orders: ConstrainedOrder[]; total: number }>({
    queryKey: ['orders', 'constrained'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/orders/constrained?limit=50');
      return data;
    },
    refetchInterval: 60_000,
  });
}

const ageHours = (seconds: number | null): number =>
  seconds == null ? 0 : Math.round(seconds / 3600);

const fmt$ = (price: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(price));

type GroupKey = 'inventory' | 'customer' | 'operational';

export default function BlockedOrdersPage() {
  const theme = useTheme();
  const { data, isLoading, isError } = useConstrainedOrders();
  const [expanded, setExpanded] = useState<GroupKey | null>('inventory');

  const orders = data?.orders ?? [];

  const grouped = {
    inventory:   orders.filter(o => o.constraint_type === 'inventory'),
    customer:    orders.filter(o => o.constraint_type === 'customer'),
    operational: orders.filter(o => o.constraint_type === 'operational'),
  };

  const totalRevenue = orders.reduce((sum, o) => sum + Number(o.revenue), 0);

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%' }}>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />

      <Box sx={{ p: '32px 40px' }}>

        {/* HEADER */}
        <Box sx={{ mb: 3 }}>
          <Box sx={{ mb: 0.5 }}>
            <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, color: 'var(--ink)', display: 'inline' }}>
              Blocked orders.{' '}
            </Typography>
            <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, fontStyle: 'italic', color: 'var(--accent)', display: 'inline' }}>
              Resolve to release.
            </Typography>
          </Box>
          <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
            {isLoading ? '—' : `${orders.length} orders blocked · ${fmt$(String(totalRevenue))} held up`}
          </Typography>
        </Box>

        {isError && <Alert severity="error" sx={{ mb: 3 }}>Failed to load blocked orders.</Alert>}

        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {!isLoading && orders.length === 0 && (
          <Box sx={{
            py: 8, textAlign: 'center',
            border: '1px solid var(--rule)', borderRadius: '12px',
            bgcolor: 'var(--surface)',
          }}>
            <Package size={40} style={{ opacity: 0.2, marginBottom: 12 }} />
            <Typography sx={{ fontSize: 14, color: 'var(--ink-3)' }}>
              No blocked orders — queue is clear.
            </Typography>
          </Box>
        )}

        {/* GROUPED SECTIONS */}
        {(['inventory', 'customer', 'operational'] as GroupKey[]).map((type) => {
          const group = grouped[type];
          if (group.length === 0) return null;
          const cfg = CONSTRAINT_CONFIG[type];
          const isOpen = expanded === type;
          const groupRevenue = group.reduce((s, o) => s + Number(o.revenue), 0);
          const breachedCount = group.filter(o => o.is_shipping_sla_breached).length;

          return (
            <Box key={type} sx={{ mb: 2 }}>
              {/* Group header */}
              <Box
                onClick={() => setExpanded(isOpen ? null : type)}
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  px: 2.5, py: 1.75,
                  bgcolor: cfg.bg,
                  border: `1px solid ${cfg.border}`,
                  borderRadius: isOpen ? '10px 10px 0 0' : '10px',
                  cursor: 'pointer',
                  '&:hover': { opacity: 0.9 },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <AlertTriangle size={16} color={cfg.color} />
                  <Typography sx={{ fontSize: 14, fontWeight: 700, color: cfg.color }}>
                    {cfg.label}
                  </Typography>
                  <Chip
                    label={group.length}
                    size="small"
                    sx={{ fontSize: 11, height: 20, bgcolor: cfg.color, color: '#fff', fontWeight: 700 }}
                  />
                  {breachedCount > 0 && (
                    <Chip
                      label={`${breachedCount} SLA breached`}
                      size="small"
                      sx={{ fontSize: 10, height: 20, bgcolor: alpha(theme.palette.error.main, 0.15), color: theme.palette.error.main, fontWeight: 600 }}
                    />
                  )}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography sx={{ fontSize: 13, color: cfg.color, fontWeight: 600 }}>
                    {fmt$(String(groupRevenue))} held
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: cfg.color }}>
                    {isOpen ? '▲' : '▼'}
                  </Typography>
                </Box>
              </Box>

              {/* Group body */}
              {isOpen && (
                <Box sx={{
                  border: `1px solid ${cfg.border}`,
                  borderTop: 'none',
                  borderRadius: '0 0 10px 10px',
                  overflow: 'hidden',
                  bgcolor: 'var(--surface)',
                }}>
                  {/* Description + action */}
                  <Box sx={{
                    px: 2.5, py: 1.5,
                    bgcolor: 'var(--bg-2)',
                    borderBottom: '1px solid var(--rule)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      {cfg.description}
                    </Typography>
                    <Button
                      size="small"
                      href={cfg.actionHref}
                      endIcon={<ArrowRight size={12} />}
                      sx={{ fontSize: 11, fontWeight: 600, color: cfg.color, whiteSpace: 'nowrap' }}
                    >
                      {cfg.action}
                    </Button>
                  </Box>

                  {/* Column headers */}
                  <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 100px 80px 80px',
                    px: 2.5, py: 1,
                    borderBottom: '1px solid var(--rule)',
                  }}>
                    {['ORDER', 'VALUE', 'AGE', 'ACTION'].map(col => (
                      <Typography key={col} sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                        {col}
                      </Typography>
                    ))}
                  </Box>

                  {/* Rows */}
                  {group.map(order => {
                    const hours = ageHours(order.age_since_creation_seconds);
                    return (
                      <Box
                        key={order.order_id}
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 100px 80px 80px',
                          alignItems: 'center',
                          px: 2.5, py: 1.25,
                          borderBottom: '1px solid var(--rule)',
                          '&:last-child': { borderBottom: 'none' },
                          '&:hover': { bgcolor: 'var(--bg-2)' },
                        }}
                      >
                        <Box>
                          <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontFamily: 'monospace' }}>
                            {order.order_id.slice(0, 8).toUpperCase()}
                          </Typography>
                          {order.block_type && (
                            <Typography sx={{ fontSize: 10, color: 'var(--ink-4)' }}>{order.block_type}</Typography>
                          )}
                        </Box>
                        <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>
                          {fmt$(order.revenue)}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Clock size={11} color={order.is_shipping_sla_breached ? theme.palette.error.main : 'var(--ink-4)'} />
                          <Typography sx={{
                            fontSize: 12, fontWeight: 600,
                            color: order.is_shipping_sla_breached ? theme.palette.error.main : 'var(--ink-3)',
                          }}>
                            {hours}h
                          </Typography>
                        </Box>
                        <Typography
                          component="a"
                          href={`${cfg.actionHref}?order=${order.order_id}`}
                          sx={{
                            fontSize: 11, fontWeight: 500, color: 'var(--ink-3)',
                            border: '1px solid var(--rule)', borderRadius: '4px',
                            px: 1.25, py: 0.5, textDecoration: 'none',
                            display: 'inline-block',
                            '&:hover': { borderColor: cfg.color, color: cfg.color },
                          }}
                        >
                          Resolve →
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}