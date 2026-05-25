// apps/frontend/src/pages/ft2-pages/OrdersInboundPage.tsx
//
// INBOUND TAB — Phase 1: PO status board
// Route: /orders/inbound
//
// Data source: GET /api/v1/suppliers/purchase-orders
//              GET /api/v1/suppliers/receive-jobs
//
// RULES:
// - No hardcoded hex — CSS variables or theme.palette.* only
// - No inline style={} — MUI sx only
// - No cross-module imports

import { useMemo } from 'react';
import {
  Box, Typography, CircularProgress, Alert, useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Package, Truck, Clock, AlertTriangle, CheckCircle, Plus,
} from 'lucide-react';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { axiosInstance } from 'api/axiosConfig';

// ─── TYPES ────────────────────────────────────────────

interface PurchaseOrder {
  id: string;
  status: string;
  supplier_name: string;
  expected_delivery_date: string | null;
  line_items_count: string;
  total_units_ordered: string;
  total_units_received: string;
  notes?: string | null;
}

interface ReceiveJob {
  receive_job_id: string;
  status: string;
  supplier_name: string;
  po_id: string;
  total_units: number;
  units_accepted: number;
  units_rejected: number;
  started_at: string | null;
  closed_at: string | null;
}

// ─── HOOKS ────────────────────────────────────────────

function usePurchaseOrders() {
  return useQuery<{ purchase_orders: PurchaseOrder[] }>({
    queryKey: ['suppliers', 'purchase-orders'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/suppliers/purchase-orders');
      return data;
    },
    refetchInterval: 60_000,
  });
}

function useReceiveJobs() {
  return useQuery<{ receive_jobs: ReceiveJob[] }>({
    queryKey: ['suppliers', 'receive-jobs'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/suppliers/receive-jobs');
      return data;
    },
    refetchInterval: 60_000,
  });
}

// ─── HELPERS ──────────────────────────────────────────

const STATUS_CONFIG: Record<string, {
  label: string;
  color: string;
  bgVar: string;
  group: string;
  order: number;
}> = {
  shipped:            { label: 'In transit',          color: '#3B82F6', bgVar: 'info',    group: 'action',  order: 0 },
  partially_received: { label: 'Partially received',  color: '#F59E0B', bgVar: 'warning', group: 'action',  order: 1 },
  confirmed:          { label: 'Confirmed',            color: '#10B981', bgVar: 'success', group: 'transit', order: 2 },
  in_production:      { label: 'In production',        color: '#8B5CF6', bgVar: 'info',    group: 'transit', order: 3 },
  ordered:            { label: 'Ordered',              color: '#6B7280', bgVar: 'default', group: 'pending', order: 4 },
  draft:              { label: 'Draft',                color: '#9CA3AF', bgVar: 'default', group: 'pending', order: 5 },
  received:           { label: 'Received',             color: '#10B981', bgVar: 'success', group: 'done',    order: 6 },
  cancelled:          { label: 'Cancelled',            color: '#EF4444', bgVar: 'error',   group: 'done',    order: 7 },
};

const GROUP_LABELS: Record<string, string> = {
  action:  'Needs action',
  transit: 'In transit',
  pending: 'Pending',
  done:    'Completed',
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
};

const daysUntil = (iso: string | null): number | null => {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.round(diff / (1000 * 60 * 60 * 24));
};

const isActionable = (status: string) =>
  status === 'shipped' || status === 'partially_received';

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
        <Typography sx={{
          fontSize: 10, fontWeight: 500, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--ink-4)',
        }}>
          {label}
        </Typography>
      </Box>
      <Typography sx={{
        fontSize: 24, fontWeight: 500,
        color: valueColor ?? 'var(--ink)',
        lineHeight: 1.1, fontVariantNumeric: 'tabular-nums',
      }}>
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

// ─── STATUS BADGE ─────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const theme = useTheme();
  const cfg = STATUS_CONFIG[status];
  if (!cfg) return null;
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center',
      px: 1, py: 0.375, borderRadius: '20px',
      width: 'fit-content',
      bgcolor: alpha(cfg.color, theme.palette.mode === 'dark' ? 0.2 : 0.1),
      border: `0.5px solid ${alpha(cfg.color, 0.35)}`,
    }}>
      <Typography sx={{ fontSize: 11, fontWeight: 500, color: cfg.color }}>
        {cfg.label}
      </Typography>
    </Box>
  );
}

// ─── DELIVERY SIGNAL ──────────────────────────────────

function DeliverySignal({ expectedDate, status }: {
  expectedDate: string | null;
  status: string;
}) {
  const theme = useTheme();
  const days = daysUntil(expectedDate);

  if (status === 'received' || status === 'cancelled' || days === null) {
    return (
      <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>
        {fmtDate(expectedDate)}
      </Typography>
    );
  }

  const isOverdue  = days < 0;
  const isUrgent   = days >= 0 && days <= 2;
  const color = isOverdue
    ? theme.palette.error.main
    : isUrgent
      ? theme.palette.warning.main
      : 'var(--ink-3)';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography sx={{ fontSize: 12, color }}>
        {fmtDate(expectedDate)}
      </Typography>
      <Typography sx={{ fontSize: 10, fontWeight: 500, color }}>
        {isOverdue
          ? `${Math.abs(days)}d overdue`
          : days === 0
            ? 'Due today'
            : `In ${days}d`}
      </Typography>
    </Box>
  );
}

// ─── MAIN ─────────────────────────────────────────────

export default function OrdersInboundPage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { data: poData, isLoading: poLoading, isError: poError } = usePurchaseOrders();
  const { data: rjData } = useReceiveJobs();

  const orders = useMemo(() => poData?.purchase_orders ?? [], [poData]);
  const receiveJobs = useMemo(() => rjData?.receive_jobs ?? [], [rjData]);

  // ── Pulse ───────────────────────────────────────────
  const pulse = useMemo(() => {
    const open = orders.filter(o =>
      !['received', 'cancelled'].includes(o.status)
    );
    const unitsExpected = open.reduce((s, o) => s + Number(o.total_units_ordered), 0);
    const arrivingSoon = open.filter(o => {
      const d = daysUntil(o.expected_delivery_date);
      return d !== null && d >= 0 && d <= 7;
    }).length;
    const activeJobs = receiveJobs.filter(j =>
      ['pending', 'in_progress'].includes(j.status)
    ).length;
    return { openPos: open.length, unitsExpected, arrivingSoon, activeJobs };
  }, [orders, receiveJobs]);

  // ── Grouped POs ─────────────────────────────────────
  const grouped = useMemo(() => {
    const groups: Record<string, PurchaseOrder[]> = {
      action: [], transit: [], pending: [], done: [],
    };
    for (const po of orders) {
      const cfg = STATUS_CONFIG[po.status];
      const group = cfg?.group ?? 'pending';
      groups[group].push(po);
    }
    // Sort each group by expected_delivery_date asc
    for (const g of Object.values(groups)) {
      g.sort((a, b) => {
        if (!a.expected_delivery_date) return 1;
        if (!b.expected_delivery_date) return -1;
        return new Date(a.expected_delivery_date).getTime() -
               new Date(b.expected_delivery_date).getTime();
      });
    }
    return groups;
  }, [orders]);

  const hasReceiveJob = (poId: string) =>
    receiveJobs.some(j => j.po_id === poId);

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%' }}>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />

      <Box sx={{ p: '24px 40px' }}>

        {/* ── HEADER ─────────────────────────────────── */}
        <Box sx={{
          display: 'flex', alignItems: 'flex-start',
          justifyContent: 'space-between', mb: 3,
        }}>
          <Box>
            <Typography sx={{
              fontSize: 22, fontWeight: 500,
              color: 'var(--ink)', lineHeight: 1.2, mb: 0.25,
            }}>
              Inbound
            </Typography>
            <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {poLoading
                ? '—'
                : `${pulse.openPos} open POs · ${pulse.unitsExpected} units expected · ${pulse.arrivingSoon} arriving this week`}
            </Typography>
          </Box>
          <Box
            onClick={() => navigate('/suppliers-portal')}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.75,
              px: 1.5, py: 0.75, borderRadius: '8px',
              bgcolor: 'var(--accent)', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, color: theme.palette.common.white,
              '&:hover': { opacity: 0.88 },
            }}
          >
            <Plus size={13} />
            New PO
          </Box>
        </Box>

        {poError && (
          <Alert severity="error" sx={{ mb: 3 }}>
            Failed to load purchase orders.
          </Alert>
        )}

        {/* ── PULSE ──────────────────────────────────── */}
        <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
          <StatCard
            label="Open POs"
            value={poLoading ? '—' : String(pulse.openPos)}
            sub="awaiting receipt"
            icon={Package}
            valueColor={pulse.openPos > 0 ? 'var(--ink)' : undefined}
          />
          <StatCard
            label="Units expected"
            value={poLoading ? '—' : String(pulse.unitsExpected)}
            sub="across open POs"
            icon={Truck}
          />
          <StatCard
            label="Arriving this week"
            value={poLoading ? '—' : String(pulse.arrivingSoon)}
            sub="expected within 7 days"
            icon={Clock}
            valueColor={pulse.arrivingSoon > 0 ? theme.palette.warning.main : undefined}
          />
          <StatCard
            label="Active receive jobs"
            value={poLoading ? '—' : String(pulse.activeJobs)}
            sub="operators receiving now"
            icon={CheckCircle}
            valueColor={pulse.activeJobs > 0 ? theme.palette.success.main : undefined}
          />
        </Box>

        {/* ── PO STATUS BOARD ────────────────────────── */}
        {poLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
            <CircularProgress size={24} />
          </Box>
        ) : orders.length === 0 ? (
          <Box sx={{
            py: 8, textAlign: 'center',
            border: '0.5px solid var(--rule)',
            borderRadius: '10px', bgcolor: 'var(--surface)',
          }}>
            <Package size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
            <Typography sx={{ fontSize: 13, color: 'var(--ink-4)', mb: 1 }}>
              No purchase orders yet.
            </Typography>
            <Typography
              onClick={() => navigate('/suppliers-portal')}
              sx={{
                fontSize: 12, color: 'var(--accent)',
                cursor: 'pointer', '&:hover': { textDecoration: 'underline' },
              }}
            >
              Create your first PO in the Suppliers portal →
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {(['action', 'transit', 'pending', 'done'] as const).map(groupKey => {
              const group = grouped[groupKey];
              if (group.length === 0) return null;

              return (
                <Box key={groupKey}>
                  {/* Group label */}
                  <Box sx={{
                    display: 'flex', alignItems: 'center', gap: 1, mb: 1,
                  }}>
                    {groupKey === 'action' && (
                      <AlertTriangle size={13} color={theme.palette.warning.main} />
                    )}
                    <Typography sx={{
                      fontSize: 10, fontWeight: 500,
                      letterSpacing: '0.08em', textTransform: 'uppercase',
                      color: groupKey === 'action' ? theme.palette.warning.main : 'var(--ink-4)',
                    }}>
                      {GROUP_LABELS[groupKey]}
                    </Typography>
                    <Box sx={{
                      px: 0.75, py: 0.125, borderRadius: '20px',
                      bgcolor: 'var(--bg-2)',
                      border: '0.5px solid var(--rule)',
                    }}>
                      <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-4)' }}>
                        {group.length}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Table */}
                  <Box sx={{
                    bgcolor: 'var(--surface)',
                    border: '0.5px solid var(--rule)',
                    borderRadius: '10px',
                    overflow: 'hidden',
                  }}>
                    {/* Table header */}
                    <Box sx={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) 140px 140px 110px 100px 110px',
                      px: 2, py: 1.25,
                      bgcolor: 'var(--bg-2)',
                      borderBottom: '0.5px solid var(--rule)',
                    }}>
                      {['Supplier · PO', 'Status', 'Expected', 'Units', 'Progress', 'Action'].map(col => (
                        <Typography key={col} sx={{
                          fontSize: 10, fontWeight: 500,
                          letterSpacing: '0.08em', textTransform: 'uppercase',
                          color: 'var(--ink-4)',
                        }}>
                          {col}
                        </Typography>
                      ))}
                    </Box>

                    {/* Rows */}
                    {group.map(po => {
                      const unitsOrdered  = Number(po.total_units_ordered);
                      const unitsReceived = Number(po.total_units_received);
                      const progressPct   = unitsOrdered > 0
                        ? Math.round((unitsReceived / unitsOrdered) * 100)
                        : 0;
                      const jobExists = hasReceiveJob(po.id);

                      return (
                        <Box
                          key={po.id}
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 120px 130px 130px 110px 120px',
                            alignItems: 'center',
                            px: 2, py: 2,
                            borderBottom: '0.5px solid var(--rule)',
                            '&:last-child': { borderBottom: 'none' },
                            '&:hover': { bgcolor: 'var(--bg-2)' },
                            minHeight: 72,
                          }}
                        >
                          {/* Supplier + PO ID */}
                          <Box>
                            <Typography sx={{
                              fontSize: 13, fontWeight: 500, color: 'var(--ink)',
                            }}>
                              {po.supplier_name}
                            </Typography>
                            <Typography sx={{
                              fontSize: 11, color: 'var(--ink-4)',
                              fontFamily: 'monospace',
                            }}>
                              {po.id.slice(0, 8).toUpperCase()}
                            </Typography>
                            {po.notes && (
                              <Typography sx={{
                                fontSize: 11, color: 'var(--ink-4)',
                                mt: 0.25,
                              }} noWrap>
                                {po.notes}
                              </Typography>
                            )}
                          </Box>

                          {/* Status */}
                          <StatusBadge status={po.status} />

                          {/* Expected delivery */}
                          <DeliverySignal
                            expectedDate={po.expected_delivery_date}
                            status={po.status}
                          />

                          {/* Units */}
                          <Box>
                            <Typography sx={{
                              fontSize: 13, fontWeight: 500, color: 'var(--ink)',
                              fontVariantNumeric: 'tabular-nums',
                            }}>
                              {unitsReceived > 0
                                ? `${unitsReceived} / ${unitsOrdered}`
                                : `${unitsOrdered}`}
                            </Typography>
                            <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                              {po.line_items_count} SKU{Number(po.line_items_count) !== 1 ? 's' : ''}
                            </Typography>
                          </Box>

                          {/* Progress bar */}
                          <Box sx={{ pr: 2 }}>
                            <Box sx={{
                              height: 4, borderRadius: '2px',
                              bgcolor: 'var(--bg-2)',
                              border: '0.5px solid var(--rule)',
                              overflow: 'hidden',
                              mb: 0.5,
                            }}>
                              <Box sx={{
                                height: '100%',
                                width: `${progressPct}%`,
                                bgcolor: progressPct === 100
                                  ? theme.palette.success.main
                                  : theme.palette.info.main,
                                borderRadius: '2px',
                                transition: 'width 0.3s ease',
                              }} />
                            </Box>
                            <Typography sx={{ fontSize: 10, color: 'var(--ink-4)' }}>
                              {progressPct}% received
                            </Typography>
                          </Box>

                          {/* Action */}
                          {isActionable(po.status) ? (
                            <Box
                              onClick={() => navigate('/suppliers-portal')}
                              sx={{
                                display: 'inline-flex', alignItems: 'center',
                                px: 1.25, py: 0.625,
                                bgcolor: jobExists ? 'transparent' : 'var(--accent)',
                                color: jobExists
                                  ? 'var(--ink-3)'
                                  : theme.palette.common.white,
                                border: jobExists
                                  ? '0.5px solid var(--rule)'
                                  : 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: 11, fontWeight: 600,
                                '&:hover': { opacity: 0.88 },
                              }}
                            >
                              {jobExists ? 'View job →' : 'Receive →'}
                            </Box>
                          ) : (
                            <Typography sx={{ 
                              fontSize: 11,
                              color: 'var(--ink-4)' }}>
                              —
                            </Typography>
                          )}
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}