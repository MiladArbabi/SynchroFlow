// apps/frontend/src/pages/ft2-pages/OrdersInboundPage.tsx
//
// INBOUND TAB — PO status board
// Route: /orders/inbound
//
// RULES: No alpha(). No useTheme(). No fontFamily overrides. 1px borders. 12px inner cards, 14px table.
import { useMemo } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Package, Truck, Clock, AlertTriangle, CheckCircle, Plus } from 'lucide-react';
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

// ─── STATUS CONFIG — bgColor/bdColor baked in to avoid alpha() ────────────────

const STATUS_CONFIG: Record<string, {
  label: string;
  color: string;
  bgColor: string;
  bdColor: string;
  group: string;
}> = {
  shipped:            { label: 'In transit',         color: '#3B82F6', bgColor: 'rgba(59,130,246,0.1)',   bdColor: 'rgba(59,130,246,0.35)',   group: 'action'  },
  partially_received: { label: 'Partially received', color: '#F59E0B', bgColor: 'rgba(245,158,11,0.1)',   bdColor: 'rgba(245,158,11,0.35)',   group: 'action'  },
  confirmed:          { label: 'Confirmed',           color: '#10B981', bgColor: 'rgba(16,185,129,0.1)',   bdColor: 'rgba(16,185,129,0.35)',   group: 'transit' },
  in_production:      { label: 'In production',       color: '#8B5CF6', bgColor: 'rgba(139,92,246,0.1)',  bdColor: 'rgba(139,92,246,0.35)',   group: 'transit' },
  ordered:            { label: 'Ordered',             color: '#6B7280', bgColor: 'rgba(107,114,128,0.1)', bdColor: 'rgba(107,114,128,0.35)', group: 'pending' },
  draft:              { label: 'Draft',               color: '#9CA3AF', bgColor: 'rgba(156,163,175,0.1)', bdColor: 'rgba(156,163,175,0.35)', group: 'pending' },
  received:           { label: 'Received',            color: '#4CAF7A', bgColor: 'rgba(76,175,122,0.1)',  bdColor: 'rgba(76,175,122,0.35)',   group: 'done'    },
  cancelled:          { label: 'Cancelled',           color: '#E5484D', bgColor: 'rgba(229,72,77,0.1)',   bdColor: 'rgba(229,72,77,0.35)',   group: 'done'    },
};

const GROUP_LABELS: Record<string, string> = {
  action:  'Needs action',
  transit: 'In transit',
  pending: 'Pending',
  done:    'Completed',
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const daysUntil = (iso: string | null): number | null => {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
};

const isActionable = (status: string) =>
  status === 'shipped' || status === 'partially_received';

// ─── STAT CARD ────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, valueColor }: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; valueColor?: string;
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
        <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>{sub}</Typography>
      )}
    </Box>
  );
}

// ─── STATUS BADGE ─────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status];
  if (!cfg) return null;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', px: 1, py: 0.375, borderRadius: '20px', width: 'fit-content', bgcolor: cfg.bgColor, border: `1px solid ${cfg.bdColor}` }}>
      <Typography sx={{ fontSize: 11, fontWeight: 500, color: cfg.color }}>{cfg.label}</Typography>
    </Box>
  );
}

// ─── DELIVERY SIGNAL ──────────────────────────────────

function DeliverySignal({ expectedDate, status }: { expectedDate: string | null; status: string }) {
  const days = daysUntil(expectedDate);

  if (status === 'received' || status === 'cancelled' || days === null) {
    return <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>{fmtDate(expectedDate)}</Typography>;
  }

  const isOverdue = days < 0;
  const isUrgent  = days >= 0 && days <= 2;
  const color     = isOverdue ? '#E5484D' : isUrgent ? '#D9A23B' : 'var(--ink-3)';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 300, color }}>{fmtDate(expectedDate)}</Typography>
      <Typography sx={{ fontSize: 10, fontWeight: 500, color }}>
        {isOverdue ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `In ${days}d`}
      </Typography>
    </Box>
  );
}

// ─── MAIN ─────────────────────────────────────────────

export default function OrdersInboundPage() {
  const navigate = useNavigate();
  const { data: poData, isLoading: poLoading, isError: poError } = usePurchaseOrders();
  const { data: rjData } = useReceiveJobs();

  const orders = useMemo(() => poData?.purchase_orders ?? [], [poData]);
  const receiveJobs = useMemo(() => rjData?.receive_jobs ?? [], [rjData]);

  const pulse = useMemo(() => {
    const open = orders.filter(o => !['received', 'cancelled'].includes(o.status));
    const unitsExpected = open.reduce((s, o) => s + Number(o.total_units_ordered), 0);
    const arrivingSoon  = open.filter(o => {
      const d = daysUntil(o.expected_delivery_date);
      return d !== null && d >= 0 && d <= 7;
    }).length;
    const activeJobs = receiveJobs.filter(j => ['pending', 'in_progress'].includes(j.status)).length;
    return { openPos: open.length, unitsExpected, arrivingSoon, activeJobs };
  }, [orders, receiveJobs]);

  const grouped = useMemo(() => {
    const groups: Record<string, PurchaseOrder[]> = { action: [], transit: [], pending: [], done: [] };
    for (const po of orders) {
      const group = STATUS_CONFIG[po.status]?.group ?? 'pending';
      groups[group].push(po);
    }
    for (const g of Object.values(groups)) {
      g.sort((a, b) => {
        if (!a.expected_delivery_date) return 1;
        if (!b.expected_delivery_date) return -1;
        return new Date(a.expected_delivery_date).getTime() - new Date(b.expected_delivery_date).getTime();
      });
    }
    return groups;
  }, [orders]);

  const hasReceiveJob = (poId: string) => receiveJobs.some(j => j.po_id === poId);

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%' }}>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />

      <Box sx={{ p: '32px 40px' }}>

        {/* HEADER */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3 }}>
          <Box>
            <Typography sx={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }}>
              Inbound
            </Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
              {poLoading
                ? '—'
                : `${pulse.openPos} open POs · ${pulse.unitsExpected} units expected · ${pulse.arrivingSoon} arriving this week`}
            </Typography>
          </Box>
          <Box
            onClick={() => navigate('/suppliers-portal')}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.875, borderRadius: '8px', bgcolor: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#10151E', '&:hover': { opacity: 0.88 } }}
          >
            <Plus size={13} />
            New PO
          </Box>
        </Box>

        {poError && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, mb: 3, bgcolor: 'rgba(229,72,77,0.07)', border: '1px solid rgba(229,72,77,0.2)', borderRadius: '10px' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink)' }}>Failed to load purchase orders.</Typography>
          </Box>
        )}

        {/* PULSE CARDS */}
        <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
          <StatCard
            label="Open POs"
            value={poLoading ? '—' : String(pulse.openPos)}
            sub="awaiting receipt"
            icon={Package}
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
            valueColor={pulse.arrivingSoon > 0 ? '#D9A23B' : undefined}
          />
          <StatCard
            label="Active receive jobs"
            value={poLoading ? '—' : String(pulse.activeJobs)}
            sub="operators receiving now"
            icon={CheckCircle}
            valueColor={pulse.activeJobs > 0 ? '#4CAF7A' : undefined}
          />
        </Box>

        {/* PO STATUS BOARD */}
        {poLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
            <CircularProgress size={24} sx={{ color: 'var(--accent)' }} />
          </Box>
        ) : orders.length === 0 ? (
          <Box sx={{ py: 8, textAlign: 'center', border: '1px solid var(--rule)', borderRadius: '14px', bgcolor: 'var(--surface)' }}>
            <Package size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-4)', mb: 1.5 }}>
              No purchase orders yet.
            </Typography>
            <Box
              onClick={() => navigate('/suppliers-portal')}
              sx={{ display: 'inline-flex', alignItems: 'center', px: 1.5, py: 0.75, fontSize: 12, fontWeight: 600, bgcolor: 'var(--accent)', color: '#10151E', borderRadius: '8px', cursor: 'pointer', '&:hover': { opacity: 0.88 } }}
            >
              Create your first PO in the Suppliers portal →
            </Box>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {(['action', 'transit', 'pending', 'done'] as const).map(groupKey => {
              const group = grouped[groupKey];
              if (group.length === 0) return null;

              return (
                <Box key={groupKey}>
                  {/* Group label */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    {groupKey === 'action' && (
                      <AlertTriangle size={13} color="#D9A23B" />
                    )}
                    <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: groupKey === 'action' ? '#D9A23B' : 'var(--ink-4)' }}>
                      {GROUP_LABELS[groupKey]}
                    </Typography>
                    <Box sx={{ px: 0.875, py: 0.125, borderRadius: '20px', bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)' }}>
                      <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-4)' }}>{group.length}</Typography>
                    </Box>
                  </Box>

                  {/* Table */}
                  <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }}>

                    {/* Table header */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 140px 140px 110px 100px 110px', px: 2, py: 1.25, bgcolor: 'var(--bg-2)', borderBottom: '1px solid var(--rule)' }}>
                      {['Supplier · PO', 'Status', 'Expected', 'Units', 'Progress', 'Action'].map(col => (
                        <Typography key={col} sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                          {col}
                        </Typography>
                      ))}
                    </Box>

                    {/* Rows */}
                    {group.map(po => {
                      const unitsOrdered  = Number(po.total_units_ordered);
                      const unitsReceived = Number(po.total_units_received);
                      const progressPct   = unitsOrdered > 0 ? Math.round((unitsReceived / unitsOrdered) * 100) : 0;
                      const jobExists     = hasReceiveJob(po.id);

                      return (
                        <Box
                          key={po.id}
                          sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 140px 140px 110px 100px 110px', alignItems: 'center', px: 2, py: 2, borderTop: '1px solid var(--rule)', '&:hover': { bgcolor: 'var(--bg-2)' }, minHeight: 72 }}
                        >
                          {/* Supplier + PO ID */}
                          <Box>
                            <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                              {po.supplier_name}
                            </Typography>
                            <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.125 }}>
                              {po.id.slice(0, 8).toUpperCase()}
                            </Typography>
                            {po.notes && (
                              <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }} noWrap>
                                {po.notes}
                              </Typography>
                            )}
                          </Box>

                          {/* Status */}
                          <StatusBadge status={po.status} />

                          {/* Expected delivery */}
                          <DeliverySignal expectedDate={po.expected_delivery_date} status={po.status} />

                          {/* Units */}
                          <Box>
                            <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                              {unitsReceived > 0 ? `${unitsReceived} / ${unitsOrdered}` : `${unitsOrdered}`}
                            </Typography>
                            <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                              {po.line_items_count} SKU{Number(po.line_items_count) !== 1 ? 's' : ''}
                            </Typography>
                          </Box>

                          {/* Progress bar */}
                          <Box sx={{ pr: 2 }}>
                            <Box sx={{ height: 5, borderRadius: '3px', bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)', overflow: 'hidden', mb: 0.5 }}>
                              <Box sx={{ height: '100%', width: `${progressPct}%`, bgcolor: progressPct === 100 ? '#4CAF7A' : '#3B82F6', borderRadius: '3px', transition: 'width 0.3s ease' }} />
                            </Box>
                            <Typography sx={{ fontSize: 10, fontWeight: 300, color: 'var(--ink-4)' }}>
                              {progressPct}% received
                            </Typography>
                          </Box>

                          {/* Action */}
                          {isActionable(po.status) ? (
                            <Box
                              onClick={() => navigate('/suppliers-portal')}
                              sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.625, bgcolor: jobExists ? 'transparent' : 'var(--accent)', color: jobExists ? 'var(--ink-3)' : '#10151E', border: jobExists ? '1px solid var(--rule)' : 'none', borderRadius: '6px', cursor: 'pointer', fontSize: 11, fontWeight: 600, width: 'fit-content', '&:hover': { opacity: 0.88 } }}
                            >
                              {jobExists ? 'View job →' : 'Receive →'}
                            </Box>
                          ) : (
                            <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>—</Typography>
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
