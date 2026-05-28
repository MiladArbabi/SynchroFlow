// apps/frontend/src/pages/ft2-pages/ReleaseQueuePage.tsx
import { useState, useCallback, useMemo } from 'react';
import {
  Box, Typography, Checkbox, Button, CircularProgress,
  Alert, Chip, Dialog, DialogTitle, DialogContent,
  DialogActions, MenuItem, Select, FormControl, LinearProgress,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import { Flag, Package, Clock, Zap } from 'lucide-react';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { axiosInstance } from 'api/axiosConfig';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWmsOperators } from '../wms/useWmsOperators';

interface PoolOrder {
  lasyncro_order_id: string;
  external_order_id: string | null;
  total_price: string;
  currency: string;
  order_created_at: string;
  is_priority_flagged: boolean;
  customer_name: string | null;
  line_item_count: number;
  unit_count: number;
  zone_distribution: string[] | string;
}

interface OrderPool {
  eligible_order_count: number;
  max_batch_line_items: number;
  orders: PoolOrder[];
}

function useOrderPool() {
  return useQuery<OrderPool>({
    queryKey: ['wms', 'order-pool'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/order-pool');
      return data;
    },
    refetchInterval: 30_000,
  });
}

function useSetPriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, flagged }: { orderId: string; flagged: boolean }) => {
      await axiosInstance.post(`/api/v1/wms/orders/${orderId}/priority`, { flagged });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wms', 'order-pool'] }),
  });
}

function useReleaseBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      priority_order_ids?: string[];
      assigned_operator_id?: number;
    }) => {
      const { data } = await axiosInstance.post('/api/v1/wms/batch/release', payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wms', 'order-pool'] });
      qc.invalidateQueries({ queryKey: ['wms', 'batches'] });
    },
  });
}

const ageLabel = (iso: string): string => {
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

const fmt$ = (price: string, currency: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(price));

export default function ReleaseQueuePage() {
  const theme = useTheme();
  const { data, isLoading, isError } = useOrderPool();
  const setPriority = useSetPriority();
  const releaseBatch = useReleaseBatch();
  const { data: operatorsData } = useWmsOperators();
  const operators = operatorsData?.operators ?? [];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [operatorId, setOperatorId] = useState<string>('');
  const [releaseSuccess, setReleaseSuccess] = useState<{ batchId: string; orderCount: number } | null>(null);

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const maxLineItems = data?.max_batch_line_items ?? 108;

  const selectedLineItems = orders
    .filter(o => selected.has(o.lasyncro_order_id))
    .reduce((sum, o) => sum + o.line_item_count, 0);

  const ceilingPct = Math.min(100, Math.round((selectedLineItems / maxLineItems) * 100));

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selected.size === orders.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(orders.map(o => o.lasyncro_order_id)));
    }
  }, [selected, orders]);

  const handleRelease = async () => {
    try {
      const result = await releaseBatch.mutateAsync({
        priority_order_ids: selected.size > 0 ? [...selected] : undefined,
        assigned_operator_id: operatorId ? Number(operatorId) : undefined,
      });
      setReleaseOpen(false);
      setSelected(new Set());
      setReleaseSuccess({ batchId: result.pick_batch_id, orderCount: result.order_count });
      setTimeout(() => setReleaseSuccess(null), 5000);
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
          <Box sx={{ mb: 0.5 }}>
            <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, color: 'var(--ink)', display: 'inline' }}>
              Release queue.{' '}
            </Typography>
            <Typography sx={{ fontFamily: '"DM Serif Display", serif', fontSize: 36, fontWeight: 400, fontStyle: 'italic', color: 'var(--accent)', display: 'inline' }}>
              Pick what ships next.
            </Typography>
          </Box>
          <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
            {isLoading ? '—' : `${data?.eligible_order_count ?? 0} orders ready to batch · ceiling ${maxLineItems} line items`}
          </Typography>
        </Box>

        {/* SUCCESS BANNER */}
        {releaseSuccess && (
          <Alert severity="success" sx={{ mb: 3 }}>
            Batch released — {releaseSuccess.orderCount} orders · operators notified.
          </Alert>
        )}

        {isError && <Alert severity="error" sx={{ mb: 3 }}>Failed to load order pool.</Alert>}

        {/* SELECTION TOOLBAR */}
        {selected.size > 0 && (
          <Box sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            px: 2, py: 1.5, mb: 2,
            bgcolor: alpha(theme.palette.primary.main, 0.06),
            border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
            borderRadius: '10px',
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                {selected.size} order{selected.size !== 1 ? 's' : ''} selected
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 160 }}>
                <LinearProgress
                  variant="determinate"
                  value={ceilingPct}
                  sx={{ flex: 1, height: 6, borderRadius: 3 }}
                  color={ceilingPct > 90 ? 'error' : 'primary'}
                />
                <Typography sx={{ fontSize: 11, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                  {selectedLineItems}/{maxLineItems} lines
                </Typography>
              </Box>
            </Box>
            <Button
              variant="contained"
              size="small"
              startIcon={<Zap size={14} />}
              onClick={() => setReleaseOpen(true)}
              sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, borderRadius: '6px', fontWeight: 600 }}
            >
              Release batch
            </Button>
          </Box>
        )}

        {/* ORDER TABLE */}
        <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '10px', overflow: 'hidden' }}>

          {/* Table header */}
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: '36px 40px 1fr 80px 80px 80px 100px 80px',
            px: 2, py: 1.25,
            bgcolor: 'var(--bg-2)',
            borderBottom: '1px solid var(--rule)',
          }}>
            <Checkbox
              size="small" sx={{ p: 0 }}
              checked={selected.size === orders.length && orders.length > 0}
              indeterminate={selected.size > 0 && selected.size < orders.length}
              onChange={toggleSelectAll}
            />
            {['', 'ORDER', 'VALUE', 'LINES', 'UNITS', 'AGE', 'ZONES'].map((col, i) => (
              <Typography key={i} sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', display: 'flex', alignItems: 'center' }}>
                {col}
              </Typography>
            ))}
          </Box>

          {isLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={24} />
            </Box>
          )}

          {!isLoading && orders.length === 0 && (
            <Box sx={{ px: 3, py: 6, textAlign: 'center' }}>
              <Package size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
              <Typography sx={{ fontSize: 13, color: 'var(--ink-4)' }}>
                No orders in pool — all orders are either batched or blocked.
              </Typography>
            </Box>
          )}

          {orders.map((order) => {
            const isSelected = selected.has(order.lasyncro_order_id);
            const zones = Array.isArray(order.zone_distribution)
              ? order.zone_distribution
              : [];
            const age = ageLabel(order.order_created_at);
            const ageHours = Math.round((Date.now() - new Date(order.order_created_at).getTime()) / 3_600_000);

            return (
              <Box
                key={order.lasyncro_order_id}
                onClick={() => toggleSelect(order.lasyncro_order_id)}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '36px 40px 1fr 80px 80px 80px 100px 80px',
                  alignItems: 'center',
                  px: 2, py: 1.5,
                  borderBottom: '1px solid var(--rule)',
                  cursor: 'pointer',
                  bgcolor: isSelected ? alpha(theme.palette.primary.main, 0.04) : 'transparent',
                  '&:hover': { bgcolor: isSelected ? alpha(theme.palette.primary.main, 0.06) : 'var(--bg-2)' },
                  '&:last-child': { borderBottom: 'none' },
                }}
              >

                <Checkbox size="small" sx={{ p: 0 }} checked={isSelected} onChange={(e) => { e.stopPropagation(); toggleSelect(order.lasyncro_order_id); }} onClick={e => e.stopPropagation()} />

                {/* Priority flag */}
                <Box onClick={e => { e.stopPropagation(); setPriority.mutate({ orderId: order.lasyncro_order_id, flagged: !order.is_priority_flagged }); }}>
                  <Flag
                    size={14}
                    color={order.is_priority_flagged ? theme.palette.error.main : 'var(--ink-4)'}
                    fill={order.is_priority_flagged ? theme.palette.error.main : 'none'}
                    style={{ cursor: 'pointer', display: 'block' }}
                  />
                </Box>

                {/* Order ID */}
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontFamily: 'monospace' }}>
                    {order.external_order_id ? `#${order.external_order_id}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                  </Typography>
                  {order.is_priority_flagged && (
                    <Typography sx={{ fontSize: 10, color: theme.palette.error.main, fontWeight: 600 }}>PRIORITY</Typography>
                  )}
                </Box>

                {/* Value */}
                <Typography sx={{ fontSize: 13, color: 'var(--ink)' }}>
                  {fmt$(order.total_price, order.currency)}
                </Typography>

                {/* Lines */}
                <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
                  {order.line_item_count}
                </Typography>

                {/* Units */}
                <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
                  {order.unit_count}
                </Typography>

                {/* Age */}
                <Box sx={{
                  display: 'inline-flex', alignItems: 'center', gap: 0.5,
                  px: 1, py: 0.25, borderRadius: '4px', width: 'fit-content',
                  bgcolor: ageHours > 48 ? alpha(theme.palette.error.main, 0.08) : 'transparent',
                }}>
                  <Clock size={11} color={ageHours > 48 ? theme.palette.error.main : 'var(--ink-4)'} />
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: ageHours > 48 ? theme.palette.error.main : 'var(--ink-3)' }}>
                    {age}
                  </Typography>
                </Box>

                {/* Zones */}
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {zones.length === 0
                    ? <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>—</Typography>
                    : zones.map(z => (
                        <Chip key={z} label={z} size="small" sx={{ fontSize: 9, height: 18, fontWeight: 600 }} />
                      ))
                  }
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* RELEASE DIALOG */}
      <Dialog open={releaseOpen} onClose={() => setReleaseOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>
          Release batch
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {selected.size > 0
                ? `${selected.size} selected order${selected.size !== 1 ? 's' : ''} will be prioritised. Remaining ceiling filled automatically.`
                : 'Orders will be selected automatically — oldest first, priority-flagged first.'}
            </Typography>
            <Box sx={{ px: 2, py: 1.5, bgcolor: 'var(--bg-2)', borderRadius: 1, border: '1px solid var(--rule)' }}>
              <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mb: 0.5 }}>LINE ITEM CEILING</Typography>
              <LinearProgress variant="determinate" value={ceilingPct} sx={{ height: 6, borderRadius: 3, mb: 0.5 }} />
              <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>
                {selectedLineItems} of {maxLineItems} line items selected
              </Typography>
            </Box>
            <FormControl size="small" fullWidth>
              <Select
                value={operatorId}
                onChange={e => setOperatorId(e.target.value)}
                label="Assign operator (optional)"
                displayEmpty
                renderValue={(val) => val === ''
                  ? <em style={{ color: 'var(--ink-3)' }}>Dispatch to all</em>
                  : (() => {
                      const op = operators.find(o => String(o.user_id) === val);
                      return op ? `${op.first_name} ${op.last_name}${op.role === 'owner' ? ' (you)' : ''}` : val;
                    })()
                }
              >
                <MenuItem value=""><em>Dispatch to all</em></MenuItem>
                {operators.map(op => (
                  <MenuItem key={op.user_id} value={String(op.user_id)}>
                    {op.first_name} {op.last_name}
                    {op.role === 'owner' ? ' (you)' : ` · ${op.role}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {releaseBatch.isError && (
              <Alert severity="error" sx={{ py: 0.5 }}>Release failed. Please retry.</Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setReleaseOpen(false)}>Cancel</Button>
          <Button
            size="small"
            variant="contained"
            onClick={handleRelease}
            disabled={releaseBatch.isPending}
            startIcon={<Zap size={14} />}
          >
            {releaseBatch.isPending ? 'Releasing…' : 'Release'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}