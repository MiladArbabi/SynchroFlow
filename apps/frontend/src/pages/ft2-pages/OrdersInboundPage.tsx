// apps/frontend/src/pages/ft2-pages/OrdersInboundPage.tsx
//
// INBOUND TAB — inbound control tower (FT2 decision + pulse)
// Route: /orders/inbound
//
// Inbound is read-and-route glass over the receive pipeline. It surfaces
// receiving risk ($-ranked) and routes Receive → into the canonical WMS
// session. It never creates POs (Suppliers owns that) and never executes
// receiving (WMS owns that). Reads only — touches no change-controlled writes.
//
// RULES: No alpha(). No useTheme(). No fontFamily overrides. 1px borders. 14px table.
import { useMemo, useState, useCallback } from 'react';
import { Box, Typography, CircularProgress, Collapse } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Package, Plus, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { axiosInstance } from 'api/axiosConfig';

const TRIAGE_PREVIEW_LIMIT = 4;

// ─── TYPES ────────────────────────────────────────────

interface PurchaseOrder {
  id: string;
  status: string;
  supplier_name: string;
  expected_delivery_date: string | null;
  line_items_count: string;
  total_units_ordered: string;
  total_units_received: string;
  total_cost_cents: string;
  unlinked_lines_count: string;
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

interface StowTask {
  stow_task_id: string;
  quantity: number;
  status: string;
}

interface DecisionItem {
  poId: string;
  supplier: string;
  poRef: string;
  reason: string;
  costCents: number;
  tier: 'critical' | 'watch';
  receivable: boolean;
  jobId?: string;
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

function useStowTasks() {
  return useQuery<{ stow_tasks: StowTask[] }>({
    queryKey: ['wms', 'stow-tasks'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/stow-tasks');
      return data;
    },
    refetchInterval: 60_000,
  });
}

// ─── STATUS CONFIG — hex baked in to avoid alpha() (file convention) ──────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; bdColor: string }> = {
  shipped:            { label: 'Arrived',            color: '#3B82F6', bgColor: 'rgba(59,130,246,0.1)',  bdColor: 'rgba(59,130,246,0.35)'  },
  partially_received: { label: 'Receiving',          color: '#F59E0B', bgColor: 'rgba(245,158,11,0.1)',  bdColor: 'rgba(245,158,11,0.35)'  },
  confirmed:          { label: 'On the way',         color: '#10B981', bgColor: 'rgba(16,185,129,0.1)',  bdColor: 'rgba(16,185,129,0.35)'  },
  in_production:      { label: 'On the way',         color: '#8B5CF6', bgColor: 'rgba(139,92,246,0.1)',  bdColor: 'rgba(139,92,246,0.35)'  },
  ordered:            { label: 'Sent',               color: '#6B7280', bgColor: 'rgba(107,114,128,0.1)', bdColor: 'rgba(107,114,128,0.35)' },
  draft:              { label: 'Draft',              color: '#9CA3AF', bgColor: 'rgba(156,163,175,0.1)', bdColor: 'rgba(156,163,175,0.35)' },
  received:           { label: 'Received',           color: '#4CAF7A', bgColor: 'rgba(76,175,122,0.1)',  bdColor: 'rgba(76,175,122,0.35)'  },
  cancelled:          { label: 'Cancelled',          color: '#E5484D', bgColor: 'rgba(229,72,77,0.1)',   bdColor: 'rgba(229,72,77,0.35)'   },
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const daysUntil = (iso: string | null): number | null => {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
};

const fmtMoney = (cents: number): string =>
  '$' + (cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });

const isActionable = (status: string) => status === 'shipped' || status === 'partially_received';
const isOpen = (status: string) => !['received', 'cancelled'].includes(status);

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
  const isUrgent = days >= 0 && days <= 2;
  const color = isOverdue ? '#E5484D' : isUrgent ? '#D9A23B' : 'var(--ink-3)';
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 300, color }}>{fmtDate(expectedDate)}</Typography>
      <Typography sx={{ fontSize: 10, fontWeight: 500, color }}>
        {isOverdue ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `In ${days}d`}
      </Typography>
    </Box>
  );
}

// ─── PULSE ROW ────────────────────────────────────────

function PulseRow({ label, value, valueColor, sub }: { label: string; value: string; valueColor?: string; sub?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', py: 1, borderBottom: '1px solid var(--rule)' }}>
      <Box>
        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>{label}</Typography>
        {sub && <Typography sx={{ fontSize: 10, fontWeight: 300, color: 'var(--ink-4)', mt: 0.125 }}>{sub}</Typography>}
      </Box>
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: valueColor ?? 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
    </Box>
  );
}

// ─── DECISION ROW ─────────────────────────────────────

function DecisionRow({ item, onReceive, onViewJob }: {
  item: DecisionItem;
  onReceive: (poId: string) => void;
  onViewJob: (jobId: string) => void;
}) {
  const accent = item.tier === 'critical' ? '#E5484D' : '#D9A23B';
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', alignItems: 'center', gap: 2, px: 2.5, py: 1.75, borderTop: '1px solid var(--rule)', '&:hover': { bgcolor: 'var(--bg-2)' } }}>
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: accent, flexShrink: 0 }} />
          <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }} noWrap>{item.supplier}</Typography>
          <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>{item.poRef}</Typography>
        </Box>
        <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-3)', mt: 0.375, ml: 1.75 }} noWrap>{item.reason}</Typography>
      </Box>
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {item.costCents > 0 ? fmtMoney(item.costCents) : '—'}
      </Typography>
      {item.receivable ? (
        item.jobId ? (
          <Box onClick={() => onViewJob(item.jobId!)} sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', '&:hover': { opacity: 0.75 } }}>
            View job →
          </Box>
        ) : (
          <Box onClick={() => onReceive(item.poId)} sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, bgcolor: 'var(--accent)', color: theme => theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', '&:hover': { opacity: 0.88 } }}>
            Receive →
          </Box>
        )
      ) : (
        <Box sx={{ width: 1 }} />
      )}
    </Box>
  );
}

// ─── DECISION BAND (Critical / Watch + reveal) ────────

function DecisionBand({ label, accent, items, onReceive, onViewJob }: {
  label: string; accent: string; items: DecisionItem[];
  onReceive: (poId: string) => void; onViewJob: (jobId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const visible = items.slice(0, TRIAGE_PREVIEW_LIMIT);
  const hidden = items.slice(TRIAGE_PREVIEW_LIMIT);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2.5, py: 1.25, borderTop: '1px solid var(--rule)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: accent }} />
          <Typography sx={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent }}>{label}</Typography>
        </Box>
        <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>{items.length} {items.length === 1 ? 'item' : 'items'}</Typography>
      </Box>
      {visible.map(it => <DecisionRow key={it.poId} item={it} onReceive={onReceive} onViewJob={onViewJob} />)}
      <Collapse in={expanded} timeout={180} unmountOnExit>
        {hidden.map(it => <DecisionRow key={it.poId} item={it} onReceive={onReceive} onViewJob={onViewJob} />)}
      </Collapse>
      {hidden.length > 0 && (
        <Box onClick={() => setExpanded(v => !v)} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: 2.5, py: 1.125, borderTop: '1px solid var(--rule)', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }}>
          <Typography sx={{ fontSize: 11, fontWeight: 500 }}>{expanded ? 'Show less' : `See ${hidden.length} more`}</Typography>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </Box>
      )}
    </Box>
  );
}

// ─── MAIN ─────────────────────────────────────────────

export default function OrdersInboundPage() {
  const navigate = useNavigate();
  const { data: poData, isLoading: poLoading, isError: poError } = usePurchaseOrders();
  const { data: rjData } = useReceiveJobs();
  const { data: stowData } = useStowTasks();

  const orders = useMemo(() => poData?.purchase_orders ?? [], [poData]);
  const receiveJobs = useMemo(() => rjData?.receive_jobs ?? [], [rjData]);
  const stowTasks = useMemo(() => stowData?.stow_tasks ?? [], [stowData]);

  // ── Receive action — inlined from SuppliersPortalPage (incl. 409 handling) ──
  const createReceiveJob = useCallback(async (poId: string) => {
    try {
      const { data } = await axiosInstance.post(`/api/v1/suppliers/purchase-orders/${poId}/receive-jobs`);
      return data;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number; data?: { receive_job_id?: string } } })?.response?.status;
      const existingJobId = (err as { response?: { data?: { receive_job_id?: string } } })?.response?.data?.receive_job_id;
      if (status === 409 && existingJobId) return { receive_job_id: existingJobId };
      throw err;
    }
  }, []);

  const handleReceive = useCallback(async (poId: string) => {
    try {
      const { receive_job_id } = await createReceiveJob(poId);
      navigate(`/wms?receiveJobId=${receive_job_id}`);
    } catch {
      // create failed — PO not in receivable state; no-op (row stays)
    }
  }, [createReceiveJob, navigate]);

  const handleViewJob = useCallback((jobId: string) => {
    navigate(`/wms?receiveJobId=${jobId}`);
  }, [navigate]);

  // ── Pulse ──
  const pulse = useMemo(() => {
    const open = orders.filter(o => isOpen(o.status));
    const unitsExpected = open.reduce((s, o) => s + Number(o.total_units_ordered), 0);
    const arrivingSoon = open.filter(o => {
      const d = daysUntil(o.expected_delivery_date);
      return d !== null && d >= 0 && d <= 7;
    }).length;
    const activeJobs = receiveJobs.filter(j => ['pending', 'in_progress'].includes(j.status)).length;
    const rejected = receiveJobs.reduce((s, j) => s + Number(j.units_rejected || 0), 0);
    const stowUnits = stowTasks.reduce((s, t) => s + Number(t.quantity || 0), 0);
    return { openPos: open.length, unitsExpected, arrivingSoon, activeJobs, rejected, stowUnits };
  }, [orders, receiveJobs, stowTasks]);

  // ── Decision items ──
  const { critical, watch, atRiskCents } = useMemo(() => {
    const crit: DecisionItem[] = [];
    const wat: DecisionItem[] = [];

    for (const po of orders) {
      if (!isOpen(po.status)) continue;
      const days = daysUntil(po.expected_delivery_date);
      const costCents = Number(po.total_cost_cents || 0);
      const unlinked = Number(po.unlinked_lines_count || 0);
      const job = receiveJobs.find(j => j.po_id === po.id);
      const rejected = Number(job?.units_rejected || 0);
      const receivable = isActionable(po.status);
      const base = {
        poId: po.id,
        supplier: po.supplier_name,
        poRef: po.id.slice(0, 8).toUpperCase(),
        costCents,
        receivable,
        jobId: job?.receive_job_id,
      };

      if (po.status === 'shipped' && days !== null && days < 0) {
        crit.push({ ...base, tier: 'critical', reason: `Overdue at dock · ${Math.abs(days)}d late` });
      } else if (rejected > 0) {
        crit.push({ ...base, tier: 'critical', reason: `Short received · ${rejected} unit${rejected === 1 ? '' : 's'} rejected` });
      } else if (unlinked > 0) {
        crit.push({ ...base, tier: 'critical', reason: `${unlinked} unlinked line${unlinked === 1 ? '' : 's'} · stock won't update on receive` });
      } else if (po.status === 'shipped') {
        wat.push({ ...base, tier: 'watch', reason: 'Arrived · ready to receive' });
      } else if (po.status === 'partially_received') {
        wat.push({ ...base, tier: 'watch', reason: 'Receiving in progress' });
      } else if (days !== null && days >= 0 && days <= 7) {
        wat.push({ ...base, tier: 'watch', reason: days === 0 ? 'Arriving today' : `Arriving in ${days}d` });
      }
    }

    const byCost = (a: DecisionItem, b: DecisionItem) => b.costCents - a.costCents;
    crit.sort(byCost);
    wat.sort(byCost);
    const atRisk = crit.reduce((s, i) => s + i.costCents, 0);
    return { critical: crit, watch: wat, atRiskCents: atRisk };
  }, [orders, receiveJobs]);

  const hasDecisions = critical.length > 0 || watch.length > 0;

  // ── Table rows (all POs, open first by ETA) ──
  const tableRows = useMemo(() => {
    return [...orders].sort((a, b) => {
      const ao = isOpen(a.status) ? 0 : 1;
      const bo = isOpen(b.status) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      if (!a.expected_delivery_date) return 1;
      if (!b.expected_delivery_date) return -1;
      return new Date(a.expected_delivery_date).getTime() - new Date(b.expected_delivery_date).getTime();
    });
  }, [orders]);

  const COLS = { xs: 'minmax(0,1fr) 110px 96px', lg: 'minmax(0,1fr) 120px 120px 88px 150px 104px' };

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
              {poLoading ? '—' : `${pulse.openPos} open POs · ${pulse.unitsExpected} units expected · ${pulse.arrivingSoon} arriving this week`}
            </Typography>
          </Box>
          <Box onClick={() => navigate('/suppliers-portal')} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.875, borderRadius: '8px', bgcolor: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: theme => theme.palette.common.white, '&:hover': { opacity: 0.88 } }}>
            <Plus size={13} />
            New PO
          </Box>
        </Box>

        {poError && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, mb: 3, bgcolor: 'rgba(229,72,77,0.07)', border: '1px solid rgba(229,72,77,0.2)', borderRadius: '10px' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink)' }}>Failed to load purchase orders.</Typography>
          </Box>
        )}

        {poLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
            <CircularProgress size={24} sx={{ color: 'var(--accent)' }} />
          </Box>
        ) : (
          <>
            {/* DECISION + PULSE */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.25, alignItems: 'start', mb: 3 }}>

              {/* Decision card */}
              <Box sx={{ flex: '1 0 300px', minWidth: 0, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }}>
                <Box sx={{ px: 2.5, pt: 2.25, pb: 1.5 }}>
                  <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>Needs attention</Typography>
                  <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', mt: 0.25 }}>
                    Catch supplier and receiving issues before they reach your stock
                  </Typography>
                </Box>
                {hasDecisions ? (
                  <>
                    <DecisionBand label="Critical — receive today" accent="#E5484D" items={critical} onReceive={handleReceive} onViewJob={handleViewJob} />
                    <DecisionBand label="Watch" accent="#D9A23B" items={watch} onReceive={handleReceive} onViewJob={handleViewJob} />
                  </>
                ) : (
                  <Box sx={{ px: 2.5, py: 4, textAlign: 'center', borderTop: '1px solid var(--rule)' }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-4)' }}>All inbound on track — nothing needs receiving action.</Typography>
                  </Box>
                )}
              </Box>

              {/* Pulse card */}
              <Box sx={{ flex: { xs: '1 0 300px', lg: '0 0 300px' }, minWidth: 0, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '18px 20px' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
                  Receiving health
                </Typography>
                <PulseRow label="At risk" value={atRiskCents > 0 ? fmtMoney(atRiskCents) : '$0'} valueColor={atRiskCents > 0 ? '#E5484D' : undefined} sub="value in critical POs" />
                <PulseRow label="Open POs" value={String(pulse.openPos)} />
                <PulseRow label="Units expected" value={String(pulse.unitsExpected)} />
                <PulseRow label="Arriving this week" value={String(pulse.arrivingSoon)} valueColor={pulse.arrivingSoon > 0 ? '#D9A23B' : undefined} />
                <PulseRow label="Short / rejected" value={String(pulse.rejected)} valueColor={pulse.rejected > 0 ? '#E5484D' : undefined} />
                <PulseRow label="Awaiting stow" value={String(pulse.stowUnits)} valueColor={pulse.stowUnits > 0 ? '#D9A23B' : undefined} sub="received, not yet in a pickable bin" />
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 1 }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>Receiving now</Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: pulse.activeJobs > 0 ? '#4CAF7A' : 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{pulse.activeJobs}</Typography>
                </Box>
              </Box>
            </Box>

            {/* INCOMING STOCK TABLE */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>Incoming stock</Typography>
              <Box sx={{ px: 0.875, py: 0.125, borderRadius: '20px', bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-4)' }}>{tableRows.length}</Typography>
              </Box>
            </Box>

            {tableRows.length === 0 ? (
              <Box sx={{ py: 8, textAlign: 'center', border: '1px solid var(--rule)', borderRadius: '14px', bgcolor: 'var(--surface)' }}>
                <Package size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
                <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-4)', mb: 1.5 }}>No purchase orders yet.</Typography>
                <Box onClick={() => navigate('/suppliers-portal')} sx={{ display: 'inline-flex', alignItems: 'center', px: 1.5, py: 0.75, fontSize: 12, fontWeight: 600, bgcolor: 'var(--accent)', color: theme => theme.palette.common.white, borderRadius: '8px', cursor: 'pointer', '&:hover': { opacity: 0.88 } }}>
                  Create your first PO in the Suppliers portal →
                </Box>
              </Box>
            ) : (
              <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }}>
                {/* Header */}
                <Box sx={{ display: 'grid', gridTemplateColumns: COLS, px: 2, py: 1.25, bgcolor: 'var(--bg-2)', borderBottom: '1px solid var(--rule)' }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Supplier · PO</Typography>
                  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Status</Typography>
                  <Typography sx={{ display: { xs: 'none', lg: 'block' }, fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Expected</Typography>
                  <Typography sx={{ display: { xs: 'none', lg: 'block' }, fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Units</Typography>
                  <Typography sx={{ display: { xs: 'none', lg: 'block' }, fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Received</Typography>
                  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Action</Typography>
                </Box>

                {/* Rows */}
                {tableRows.map(po => {
                  const unitsOrdered = Number(po.total_units_ordered);
                  const unitsReceived = Number(po.total_units_received);
                  const progressPct = unitsOrdered > 0 ? Math.round((unitsReceived / unitsOrdered) * 100) : 0;
                  const job = receiveJobs.find(j => j.po_id === po.id);
                  return (
                    <Box key={po.id} sx={{ display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', px: 2, py: 2, borderTop: '1px solid var(--rule)', '&:hover': { bgcolor: 'var(--bg-2)' }, minHeight: 72 }}>
                      {/* Supplier + PO */}
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }} noWrap>{po.supplier_name}</Typography>
                        <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.125 }}>{po.id.slice(0, 8).toUpperCase()}</Typography>
                        {po.notes && <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }} noWrap>{po.notes}</Typography>}
                      </Box>
                      {/* Status */}
                      <StatusBadge status={po.status} />
                      {/* Expected */}
                      <Box sx={{ display: { xs: 'none', lg: 'block' } }}>
                        <DeliverySignal expectedDate={po.expected_delivery_date} status={po.status} />
                      </Box>
                      {/* Units */}
                      <Box sx={{ display: { xs: 'none', lg: 'block' } }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{unitsOrdered}</Typography>
                        <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>{po.line_items_count} SKU{Number(po.line_items_count) !== 1 ? 's' : ''}</Typography>
                      </Box>
                      {/* Received */}
                      <Box sx={{ display: { xs: 'none', lg: 'block' }, pr: 2 }}>
                        <Box sx={{ height: 5, borderRadius: '3px', bgcolor: 'var(--bg-2)', border: '1px solid var(--rule)', overflow: 'hidden', mb: 0.5 }}>
                          <Box sx={{ height: '100%', width: `${progressPct}%`, bgcolor: progressPct === 100 ? '#4CAF7A' : '#3B82F6', borderRadius: '3px', transition: 'width 0.3s ease' }} />
                        </Box>
                        <Typography sx={{ fontSize: 10, fontWeight: 300, color: 'var(--ink-4)' }}>{unitsReceived > 0 ? `${unitsReceived} / ${unitsOrdered}` : `${progressPct}%`}</Typography>
                      </Box>
                      {/* Action */}
                      {isActionable(po.status) ? (
                        job ? (
                          <Box onClick={() => handleViewJob(job.receive_job_id)} sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.625, color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', fontSize: 11, fontWeight: 500, width: 'fit-content', '&:hover': { opacity: 0.75 } }}>
                            View job →
                          </Box>
                        ) : (
                          <Box onClick={() => handleReceive(po.id)} sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.625, bgcolor: 'var(--accent)', color: theme => theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', fontSize: 11, fontWeight: 600, width: 'fit-content', '&:hover': { opacity: 0.88 } }}>
                            Receive →
                          </Box>
                        )
                      ) : (
                        <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>—</Typography>
                      )}
                    </Box>
                  );
                })}
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}