/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/OrdersOutboundPage.tsx
//
// OUTBOUND TAB — Shipped orders
// Route: /orders/outbound
//
// RULES: No alpha(). No useTheme(). No fontFamily overrides. 1px borders. 12px inner cards, 14px table.
import { useMemo, useRef, useState, useCallback, ReactNode } from 'react';
import { EntityDetailModal, PulseCard } from '@lasyncro/shared/ui';
import { OrderDetailModalBody } from 'pages/orders/OrderDetailModalBody';
import { useBulkSetPriority } from '../wms/useOrderPool';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { ExportDrawer } from 'components/ExportDrawer';
import { Box, Collapse, Typography, CircularProgress } from '@mui/material';
import { ChevronDown, ChevronUp, Clock, Package } from 'lucide-react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
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
  latest_status: string | null;
  latest_location: string | null;
  latest_event_at: string | null;
  is_stalled: boolean;
}

interface FulfilledOrdersResponse {
  orders: FulfilledOrder[];
  total: number;
  page: number;
  limit: number;
}

interface CarrierSettingsResponse {
  carriers: unknown[];
}

interface PackedHandoffOrder {
  lasyncro_order_id: string;
  external_order_id: string | null;
  pick_batch_id: string | null;
  packed_at: string;
  total_price: string;
  currency: string;
  carrier_code: string | null;
  tracking_number: string | null;
  latest_status: string | null;
}

interface PackedHandoffResponse {
  orders: PackedHandoffOrder[];
  total: number;
}

// ─── HOOK ─────────────────────────────────────────────
type SortField = 'fulfilled_at' | 'order_created_at' | 'total_price' | 'hours_to_fulfil';
type SortDir   = 'asc' | 'desc';
type DateRange = 'week' | 'month' | 'all';
type LedgerFilter = 'needs_action' | DateRange;

/**
 * Outbound SLA signal: once an order is fulfilled, long creation→fulfilment
 * time is surfaced as operational risk, not hidden inside the ledger.
 */
const OUTBOUND_SLA_BREACH_HOURS = 72;
const TRIAGE_PREVIEW_LIMIT = 3;

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

/**
 * Temporary summary source until `/orders/fulfilled` returns server-side outbound aggregates.
 * Keeps decision cards from being distorted by the visible ledger page size.
 */
function useOutboundSignalOrders() {
  return useQuery<FulfilledOrdersResponse, Error, FulfilledOrdersResponse>({
    queryKey: ['orders', 'fulfilled', 'outbound-signals'],
    queryFn: async (): Promise<FulfilledOrdersResponse> => {
      const params = new URLSearchParams({ limit: '100', page: '1', sort: 'fulfilled_at', dir: 'desc', range: 'all' });
      const { data } = await axiosInstance.get<FulfilledOrdersResponse>(`/api/v1/orders/fulfilled?${params}`);
      return data;
    },
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Carrier state is a separate operational truth from shipment rows.
 * Do not infer carrier setup from missing tracking numbers.
 */
function useCarrierSettings() {
  return useQuery<CarrierSettingsResponse, Error, CarrierSettingsResponse>({
    queryKey: ['carrier-settings'],
    queryFn: async (): Promise<CarrierSettingsResponse> => {
      const { data } = await axiosInstance.get<CarrierSettingsResponse>('/api/v1/wms/carrier-settings');
      return data;
    },
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

function usePackedHandoffQueue() {
  return useQuery<PackedHandoffResponse>({
    queryKey: ['outbound', 'handoff-queue'],
    queryFn: async () => {
      const { data } = await axiosInstance.get<PackedHandoffResponse>(
        '/api/v1/wms/outbound/handoff-queue'
      );
      return data;
    },
    refetchInterval: 30_000,
  });
}

function useConfirmCarrierHandoff() {
  const queryClient = useQueryClient();

  return useMutation<
    void,
    Error,
    { pickBatchId: string; orderId: string }
  >({
    mutationFn: async ({ pickBatchId, orderId }) => {
      await axiosInstance.post(`/api/v1/wms/batch/${pickBatchId}/ship`, {
        lasyncro_order_id: orderId,
        partial_shipment: false,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['outbound', 'handoff-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['orders', 'fulfilled'] }),
      ]);
    },
  });
}

function useBulkBackfillLabels() {
  const queryClient = useQueryClient();
  return useMutation<
    { summary: { total: number; succeeded: number; failed: number }; results: Array<{ orderId: string; success: boolean; error?: string }> },
    Error,
    string[]
  >({
    mutationFn: async (orderIds) => {
      const { data } = await axiosInstance.post('/api/v1/wms/orders/bulk-generate-label', { order_ids: orderIds });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders', 'fulfilled'] });
    },
  });
}
// ─── HELPERS ──────────────────────────────────────────

const fmt$ = (price: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(price));

const fmtRelative = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diffMs / 3_600_000);
  if (h < 1) return '<1h ago';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const STATUS_LABEL: Record<string, string> = {
  announced: 'Label created',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  exception: 'Exception',
  returned: 'Returned',
};

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

// ─── MAIN ─────────────────────────────────────────────
export default function OrdersOutboundPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [sortField, setSortField] = useState<SortField>('fulfilled_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>('needs_action');
  const ledgerRef = useRef<HTMLDivElement>(null);
  // ISS-05 FIX: replaces 4× navigate('/orders/:id') full-page routes with
  // the standardized EntityDetailModal, matching OrdersFT2Page.tsx exactly
  // (entity-detail-modal-playbook.md §2). OrderDetailPage.tsx removed 2026-07-11
  // (ISS-OD-01) — modal is now the single order detail surface.
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [modalTitle, setModalTitle] = useState('');
  const [modalSubtitle, setModalSubtitle] = useState<string | undefined>(undefined);
  const [modalFooter, setModalFooter] = useState<ReactNode>(null);
  const bulkSetPriority = useBulkSetPriority();
  const onPriorityFlag = useCallback(
  async (orderIds: string[], flagged: boolean) => {
    await bulkSetPriority.mutateAsync(orderIds);
  },
  [bulkSetPriority]
);
  const [watchExpanded, setWatchExpanded] = useState(false);
  const [backfillExpanded, setBackfillExpanded] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{
    summary: { total: number; succeeded: number; failed: number };
    results: Array<{ orderId: string; success: boolean; error?: string }>;
  } | null>(null);

  const { mutate: runBulkBackfill, isPending: backfillRunning } = useBulkBackfillLabels();
  const { data, isLoading, isError } = useFulfilledOrders(page, perPage, sortField, sortDir, dateRange);
  const { data: signalData } = useOutboundSignalOrders();
  const { data: carrierSettings } = useCarrierSettings();
  const {
    data: handoffData,
    isLoading: handoffLoading,
    isError: handoffError,
  } = usePackedHandoffQueue();
  const confirmCarrierHandoff = useConfirmCarrierHandoff();

  const carriersConfigured = (carrierSettings?.carriers?.length ?? 0) > 0;
  const packedHandoffOrders = handoffData?.orders ?? [];

  const handleConfirmBackfill = () => {
    const orderIds = outboundSignals.missingTracking.map(o => o.lasyncro_order_id);
    runBulkBackfill(orderIds, {
      onSuccess: (data) => setBackfillResult(data),
    });
  };

  const handleSort = (field: SortField) => {
    if (field === sortField) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
    setPage(1);
  };

  // Date filters were removed from the Outbound UI. The shipped-orders list stays action-first.
  // ISS-03 FIX: was a hardcoded blob-download bypassing the established
  // ExportDrawer pattern (export_system_playbook.md §6) — same bug class
  // as ORDM-01, never applied here. 'orders-outbound' report ID added to
  // exportReports.ts to carry the fulfilled-status filter.
  const { tier } = useEntitlements();
  const [exportDrawerOpen, setExportDrawerOpen] = useState(false);
  const handleExportOutbound = async () => setExportDrawerOpen(true);

  const orders = useMemo(() => data?.orders ?? [], [data?.orders]);
  const signalOrders = useMemo(() => signalData?.orders ?? orders, [signalData?.orders, orders]);

  /**
    * Exception-first ledger filter. Backend currently supports date ranges only,
    * so needs-action is derived from the loaded fulfilled ledger rows.
    */
  const visibleOrders = useMemo(() => {
    if (ledgerFilter !== 'needs_action') return orders;

    return signalOrders.filter(order =>
      !order.tracking_number || Number(order.hours_to_fulfil) > OUTBOUND_SLA_BREACH_HOURS
    );
  }, [orders, signalOrders, ledgerFilter]);

    const sortedLedgerSource = useMemo(() => {
  if (ledgerFilter !== 'needs_action') return visibleOrders;

  return [...visibleOrders].sort((a, b) => {
    const direction = sortDir === 'asc' ? 1 : -1;

    if (sortField === 'total_price' || sortField === 'hours_to_fulfil') {
      return (Number(a[sortField]) - Number(b[sortField])) * direction;
    }

    return (new Date(a[sortField]).getTime() - new Date(b[sortField]).getTime()) * direction;
      });
    }, [visibleOrders, ledgerFilter, sortField, sortDir]);

    const ledgerTotal = ledgerFilter === 'needs_action' ? sortedLedgerSource.length : (data?.total ?? 0);
    const ledgerRows = ledgerFilter === 'needs_action'
      ? sortedLedgerSource.slice((page - 1) * perPage, page * perPage)
      : sortedLedgerSource;

    const pulse = useMemo(() => {
    const thisWeek = orders.filter(o => isThisWeek(o.fulfilled_at));
    const revenueThisWeek = thisWeek.reduce((s, o) => s + Number(o.total_price), 0);
    const allHours = orders.map(o => Number(o.hours_to_fulfil)).filter(h => !isNaN(h) && h > 0);
    const avgHours = allHours.length > 0 ? allHours.reduce((s, h) => s + h, 0) / allHours.length : null;

    return {
      shippedThisWeek: thisWeek.length,
      revenueThisWeek,
      avgFulfilHours: avgHours,
      total: data?.total ?? 0,
      trackedCount: thisWeek.filter(o => o.tracking_number).length,
    };
  }, [orders, data?.total]);

  const outboundSignals = useMemo(() => {
  const stalled = signalOrders.filter(o => o.is_stalled);
  const missingTracking = signalOrders.filter(o => !o.tracking_number);
  const breachedSla = signalOrders.filter(o => Number(o.hours_to_fulfil) > OUTBOUND_SLA_BREACH_HOURS);
  const needsAction = Array.from(
    new Map([...stalled, ...missingTracking, ...breachedSla].map(order => [order.lasyncro_order_id, order])).values()
  );

    return {
      stalled,
      missingTracking,
      breachedSla,
      needsAction,
      needsActionCount: needsAction.length,
      stalledCount: stalled.length,
      missingTrackingCount: missingTracking.length,
      breachedSlaCount: breachedSla.length,
    };
  }, [signalOrders]);

  const handleRangeChange = (filter: LedgerFilter) => {
    setLedgerFilter(filter);
    setDateRange(filter === 'needs_action' ? 'all' : filter);
    setPage(1);
  };

  const visibleBreachedSla = outboundSignals.breachedSla.slice(0, TRIAGE_PREVIEW_LIMIT);
  const hiddenBreachedSla = outboundSignals.breachedSla.slice(TRIAGE_PREVIEW_LIMIT);

  const outboundTotal = signalData?.total ?? pulse.total;
  const trackingCoverage = outboundTotal > 0
    ? Math.round(((outboundTotal - outboundSignals.missingTrackingCount) / outboundTotal) * 100)
    : 0;

  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%' }}>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />

      <Box sx={{ p: '32px 40px' }}>

                {/* HEADER */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 3 }}>
          <Box>
            <Typography sx={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }}>
              Outbound
            </Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-3)' }}>
              {isLoading
                ? '—'
                : `${outboundTotal} shipped · ${outboundSignals.missingTrackingCount} missing tracking · ${carriersConfigured ? 'carrier connected' : 'carrier not configured'}`}
            </Typography>
          </Box>

          <Box
            onClick={handleExportOutbound}
            sx={{ display: 'inline-flex', alignItems: 'center', px: '12px', py: '6px', fontSize: 12, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent-border)', borderRadius: '6px', cursor: 'pointer', flexShrink: 0, mt: '6px', '&:hover': { opacity: 0.75 } }}
          >
            Export →
          </Box>
        </Box>

        {(handoffLoading || handoffError || packedHandoffOrders.length > 0) && (
          <Box sx={{
            mb: 3,
            bgcolor: 'var(--surface)',
            border: '1px solid var(--rule)',
            borderRadius: '14px',
            overflow: 'hidden',
          }}>
            <Box sx={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 2,
              px: 2.5,
              py: 1.75,
              borderBottom: '1px solid var(--rule)',
            }}>
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', mb: 0.375 }}>
                  Awaiting carrier handoff
                </Typography>
                <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                  {carriersConfigured
                    ? 'Carrier movement clears this queue automatically. Confirm manually only after physical pickup.'
                    : 'Confirm only after parcels physically leave the warehouse.'}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'var(--ink-4)', flexShrink: 0 }}>
                {handoffLoading ? 'Loading…' : `${packedHandoffOrders.length} packed`}
              </Typography>
            </Box>

            {handoffError && (
              <Typography sx={{ px: 2.5, py: 1.5, fontSize: 12, color: '#E5484D' }}>
                Failed to load packed orders.
              </Typography>
            )}

            {confirmCarrierHandoff.isError && (
              <Typography sx={{ px: 2.5, py: 1.5, fontSize: 12, color: '#E5484D', borderTop: '1px solid var(--rule)' }}>
                Handoff confirmation failed. The order was not marked shipped.
              </Typography>
            )}

            {packedHandoffOrders.map(order => {
              const isConfirming =
                confirmCarrierHandoff.isPending &&
                confirmCarrierHandoff.variables?.orderId === order.lasyncro_order_id;

              return (
                <Box
                  key={order.lasyncro_order_id}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0,1fr) 150px',
                    gap: 2,
                    alignItems: 'center',
                    px: 2.5,
                    py: 1.5,
                    borderTop: '1px solid var(--rule)',
                  }}
                >
                  <Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', mb: 0.375 }}>
                      {order.external_order_id
                        ? `#${order.external_order_id}`
                        : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                    </Typography>
                    <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                      Packed {fmtRelative(order.packed_at)}
                      {order.tracking_number ? ` · ${order.tracking_number}` : ' · tracking pending'}
                    </Typography>
                  </Box>

                  <Box
                    component="button"
                    type="button"
                    disabled={!order.pick_batch_id || isConfirming}
                    onClick={() => {
                      if (!order.pick_batch_id) return;
                      confirmCarrierHandoff.mutate({
                        pickBatchId: order.pick_batch_id,
                        orderId: order.lasyncro_order_id,
                      });
                    }}
                    sx={{
                      border: '1px solid var(--accent-border)',
                      bgcolor: 'transparent',
                      color: 'var(--accent)',
                      borderRadius: '6px',
                      px: 1.5,
                      py: 0.75,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: order.pick_batch_id && !isConfirming ? 'pointer' : 'not-allowed',
                      opacity: order.pick_batch_id && !isConfirming ? 1 : 0.5,
                    }}
                  >
                    {!order.pick_batch_id
                      ? 'Batch unavailable'
                      : isConfirming
                        ? 'Confirming…'
                        : 'Confirm handoff'}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}

        {isError && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, mb: 3, bgcolor: 'rgba(229,72,77,0.07)', border: '1px solid rgba(229,72,77,0.2)', borderRadius: '10px' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink)' }}>Failed to load fulfilled orders.</Typography>
          </Box>
        )}

        {/* TRIAGE-FIRST OUTBOUND SNAPSHOT */}
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, flexWrap: { xs: 'nowrap', lg: 'wrap' }, gap: 2.25, alignItems: 'stretch', mb: 3 }}>
          <Box sx={{ flex: { xs: '1 1 auto', lg: '1 1 0' }, minWidth: 0, bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', p: '16px 20px 14px', borderBottom: '1px solid var(--rule)' }}>
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', mb: 0.375 }}>
                  Needs attention
                </Typography>
                <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                  Fix missing tracking, carrier setup, or delayed shipping before customers ask
                </Typography>
              </Box>
              <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }}>
                {isLoading ? 'Syncing…' : 'Live'}
              </Typography>
            </Box>

            {outboundSignals.stalledCount > 0 && (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1, bgcolor: 'rgba(229,72,77,0.09)' }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#E5484D', flexShrink: 0 }} />
                  <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#F2555A' }}>
                    Critical — stalled in transit
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                    {outboundSignals.stalledCount} shipments
                  </Typography>
                </Box>

                {outboundSignals.stalled.slice(0, TRIAGE_PREVIEW_LIMIT).map(order => (
                  <Box
                    key={order.lasyncro_order_id}
                    sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 118px', gap: 1.75, alignItems: 'center', px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)' }}
                  >
                    <Box>
                      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', mb: 0.375 }}>
                        {order.external_order_id ? `#${order.external_order_id}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                      </Typography>
                      <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                        No carrier update{order.latest_event_at ? ` since ${fmtRelative(order.latest_event_at)}` : ''}
                      </Typography>
                    </Box>
                    <Box
                      component="button"
                      onClick={() => setSelectedOrderId(order.lasyncro_order_id)}
                      sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
                    >
                      View order →
                    </Box>
                  </Box>
                ))}
              </>
            )}

            {outboundSignals.missingTrackingCount > 0 && (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1, bgcolor: 'rgba(229,72,77,0.07)' }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#E5484D', flexShrink: 0 }} />
                  <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#F2555A' }}>
                    Critical — tracking missing
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                    {outboundSignals.missingTrackingCount} affected
                  </Typography>
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 118px', gap: 1.75, alignItems: 'center', px: 2.5, py: 1.75, borderTop: '1px solid var(--rule)' }}>
                  <Box>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', mb: 0.375 }}>
                      Tracking missing
                    </Typography>
                    <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                      {carriersConfigured
                        ? 'These shipped orders are missing customer-visible tracking. Review the shipped orders below.'
                        : 'Carrier settings are not configured, so fulfilled orders cannot receive customer-visible tracking yet.'}
                    </Typography>
                  </Box>
                   <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, width: 130 }}>
                    <Box
                      component="button"
                      onClick={() => carriersConfigured
                        ? (setLedgerFilter('needs_action'), ledgerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
                        : navigate('/settings/carriers')}
                      sx={{ width: '100%', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
                    >
                      {carriersConfigured ? 'Review orders →' : 'Configure →'}
                    </Box>
                    {carriersConfigured && (
                      <Box
                        component="button"
                        onClick={() => { setBackfillExpanded(v => !v); setBackfillResult(null); }}
                        sx={{ width: '100%', boxSizing: 'border-box', border: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, color: 'var(--accent-ink)', bgcolor: 'var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.88 } }}
                      >
                        Backfill labels
                        {backfillExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </Box>
                    )}
                  </Box>
                </Box>
                <Collapse in={backfillExpanded} timeout={180} unmountOnExit>
                  <Box sx={{ px: 2.5, py: 1.75, borderTop: '1px solid var(--rule)', bgcolor: 'var(--bg-2)' }}>
                    {!backfillResult ? (
                      <>
                        <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', mb: 0.75 }}>
                          Generate labels for {outboundSignals.missingTrackingCount} orders?
                        </Typography>
                        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)', mb: 1.25 }}>
                          {outboundSignals.missingTracking.map(o =>
                            o.external_order_id ? `#${o.external_order_id}` : o.lasyncro_order_id.slice(0, 8).toUpperCase()
                          ).join(', ')}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Box
                            component="button"
                            onClick={handleConfirmBackfill}
                            disabled={backfillRunning}
                            sx={{ border: 'none', px: 1.5, py: 0.625, fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)', bgcolor: 'var(--accent)', borderRadius: '6px', cursor: backfillRunning ? 'wait' : 'pointer', '&:hover': { opacity: 0.88 } }}
                          >
                            {backfillRunning ? 'Generating…' : `Confirm — generate ${outboundSignals.missingTrackingCount} labels`}
                          </Box>
                          <Box
                            component="button"
                            onClick={() => setBackfillExpanded(false)}
                            sx={{ px: 1.5, py: 0.625, fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', bgcolor: 'transparent', border: '0.5px solid var(--rule)', borderRadius: '6px', cursor: 'pointer' }}
                          >
                            Cancel
                          </Box>
                        </Box>
                      </>
                    ) : (
                      <>
                        <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', mb: 0.5 }}>
                          {backfillResult.summary.succeeded} of {backfillResult.summary.total} labels generated
                          {backfillResult.summary.failed > 0 ? `, ${backfillResult.summary.failed} failed` : ''}
                        </Typography>
                        {backfillResult.results.filter(r => !r.success).length > 0 && (
                          <Box sx={{ mb: 1 }}>
                            {backfillResult.results.filter(r => !r.success).map(r => (
                              <Typography key={r.orderId} sx={{ fontSize: 11.5, fontWeight: 300, color: '#E5484D' }}>
                                {r.orderId.slice(0, 8).toUpperCase()} — {r.error}
                              </Typography>
                            ))}
                          </Box>
                        )}
                        <Box
                          component="button"
                          onClick={() => { setBackfillExpanded(false); setBackfillResult(null); }}
                          sx={{ px: 1.5, py: 0.625, fontSize: 12, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer' }}
                        >
                          Done
                        </Box>
                      </>
                    )}
                  </Box>
                </Collapse>
              </>
            )}

            {outboundSignals.breachedSlaCount > 0 && (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1, bgcolor: 'rgba(217,162,59,0.06)', borderTop: '1px solid var(--rule)' }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#D9A23B', flexShrink: 0 }} />
                  <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#D9A23B' }}>
                    Watch — customer promise impact
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                    {outboundSignals.breachedSlaCount} orders
                  </Typography>
                </Box>

                {visibleBreachedSla.map(order => (
                  <Box
                    key={order.lasyncro_order_id}
                    sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 118px', gap: 1.75, alignItems: 'center', px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)' }}
                  >
                    <Box>
                      <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', mb: 0.375 }}>
                        {order.external_order_id ? `#${order.external_order_id}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                      </Typography>
                      <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                        Delayed before shipping · {fmtFulfilTime(order.hours_to_fulfil)}
                      </Typography>
                    </Box>
                    <Box
                      component="button"
                      onClick={() => setSelectedOrderId(order.lasyncro_order_id)}
                      sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
                    >
                      View order →
                    </Box>
                  </Box>
                ))}

                {hiddenBreachedSla.length > 0 && (
                  <>
                    <Collapse in={watchExpanded} timeout={180} unmountOnExit>
                      {hiddenBreachedSla.map(order => (
                        <Box
                          key={order.lasyncro_order_id}
                          sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 118px', gap: 1.75, alignItems: 'center', px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)' }}
                        >
                          <Box>
                            <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', mb: 0.375 }}>
                              {order.external_order_id ? `#${order.external_order_id}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                            </Typography>
                            <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                              Delayed before shipping · {fmtFulfilTime(order.hours_to_fulfil)}
                            </Typography>
                          </Box>
                          <Box
                            component="button"
                            onClick={() => setSelectedOrderId(order.lasyncro_order_id)}
                            sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
                          >
                            View order →
                          </Box>
                        </Box>
                      ))}
                    </Collapse>

                    <Box
                      onClick={() => setWatchExpanded(v => !v)}
                      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: 2.5, py: 1.125, borderTop: '1px solid var(--rule)', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }}
                    >
                      <Typography sx={{ fontSize: 11, fontWeight: 500 }}>
                        {watchExpanded ? 'Show less' : `See ${hiddenBreachedSla.length} more`}
                      </Typography>
                      {watchExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </Box>
                  </>
                )}
              </>
            )}

            {carriersConfigured && outboundSignals.needsActionCount === 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1, bgcolor: 'rgba(76,175,122,0.06)' }}>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#4CAF7A', flexShrink: 0 }} />
                <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#4CAF7A' }}>
                  All clear — outbound is healthy
                </Typography>
              </Box>
            )}

            <Box sx={{ px: 2.5, py: 1.5, borderTop: '1px solid var(--rule)' }}>
              <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-4)' }}>
                {outboundSignals.missingTrackingCount} missing tracking · {outboundSignals.breachedSlaCount} breached 72h+ · {pulse.total} shipped total
              </Typography>
            </Box>
          </Box>

          <Box sx={{ flex: { xs: '1 0 300px', lg: '0 0 300px' }, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <PulseCard
              title="Shipping health"
              rows={[
                {
                  id: 'shipped-orders',
                  label: 'Shipped orders',
                  value: outboundTotal,
                },
                {
                  id: 'with-tracking',
                  label: 'With tracking',
                  value: Math.max(outboundTotal - outboundSignals.missingTrackingCount, 0),
                  tone: outboundTotal - outboundSignals.missingTrackingCount > 0 ? 'good' : 'critical',
                },
                {
                  id: 'missing-tracking',
                  label: 'Missing tracking',
                  value: outboundSignals.missingTrackingCount,
                  tone: outboundSignals.missingTrackingCount > 0 ? 'critical' : 'good',
                },
                {
                  id: 'tracking-coverage',
                  label: 'Tracking coverage',
                  value: `${trackingCoverage}%`,
                  tone: trackingCoverage > 0 ? 'good' : 'critical',
                },
                carriersConfigured
                  ? { id: 'carrier-setup', label: 'Carrier setup', value: 'Ready', tone: 'good' }
                  : { id: 'carrier-setup', label: 'Carrier setup', value: '', action: { label: 'Set up →', onClick: () => navigate('/settings/carriers') } },
                {
                  id: 'value-shipped-week',
                  label: 'Value shipped this week',
                  value: fmt$(String(pulse.revenueThisWeek)),
                  group: 'context',
                },
                {
                  id: 'avg-time-to-ship',
                  label: 'Avg time to ship',
                  value: pulse.avgFulfilHours === null ? '—' : fmtFulfilTime(String(pulse.avgFulfilHours)),
                  // TODO: tone once fulfillment_sla_hours is threaded to this page — see follow-up issue
                  group: 'context',
                },
              ]}
            />
          </Box>
        </Box>

        {/* SHIPPED ORDERS FILTERS */}
        <Box ref={ledgerRef} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2 }}>
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', mb: 0.25 }}>
              Shipped orders
            </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {([
              { key: 'needs_action', label: 'Needs action' },
              { key: 'week', label: 'This week' },
              { key: 'month', label: 'This month' },
              { key: 'all', label: 'All time' },
            ] as { key: LedgerFilter; label: string }[]).map(({ key, label }) => (
            <Box
              key={key}
              onClick={() => handleRangeChange(key)}
              sx={{
                px: 1.5, py: 0.625, borderRadius: '6px', cursor: 'pointer',
                fontSize: 12, fontWeight: 500,
                bgcolor: ledgerFilter === key ? 'var(--accent)' : 'var(--surface)',
                color: ledgerFilter === key ? 'var(--accent-ink)' : 'var(--ink-3)',
                border: '1px solid',
                borderColor: ledgerFilter === key ? 'var(--accent)' : 'var(--rule)',
                transition: 'all 0.12s ease',
              }}
            >
              {label}
            </Box>
          ))}
        </Box>
          </Box>
      </Box>

        {/* SHIPPED ORDERS TABLE */}
        <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden' }}>
          {/* Fulfilled is not enough unless tracking and handoff are clear. */}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'minmax(96px,1fr) 88px 78px 82px 96px 96px',
                  lg: 'minmax(0,1fr) 130px 140px 120px 140px 118px',
                },
                px: 2,
                py: 1.25,
                bgcolor: 'var(--bg-2)',
                borderBottom: '1px solid var(--rule)',
              }}
            >
              {([
                { label: 'Order',    field: null },
                { label: 'Shipped',  field: 'fulfilled_at' },
                { label: 'Proof',    field: null },
                { label: 'Carrier',  field: null },
                { label: 'Live status', field: null },
                { label: 'Action',   field: null },
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
          {!isLoading && visibleOrders.length === 0 && (
            <Box sx={{ px: 3, py: 6, textAlign: 'center' }}>
              <Package size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
              <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-4)' }}>
                No shipped orders yet.
              </Typography>
            </Box>
          )}

          {/* Rows */}
          {ledgerRows.map(order => {
            return (
              <Box
                key={order.lasyncro_order_id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: 'minmax(96px,1fr) 88px 78px 82px 96px 96px',
                    lg: 'minmax(0,1fr) 130px 140px 120px 140px 118px',
                  },
                  alignItems: 'center',
                  px: 2,
                  py: 1.25,
                  borderTop: '1px solid var(--rule)',
                  '&:hover': { bgcolor: 'var(--bg-2)' },
                }}
              >
                {/* Order */}
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {order.external_order_id ? `#${order.external_order_id}` : order.lasyncro_order_id.slice(0, 8).toUpperCase()}
                  </Typography>
                  <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)', mt: 0.25 }}>
                    {fmt$(order.total_price)}
                  </Typography>
                </Box>

                {/* Shipped */}
                <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
                  {fmtDate(order.fulfilled_at)}
                </Typography>

                {/* Proof */}
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: '4px', width: 'fit-content', bgcolor: order.tracking_number ? 'rgba(76,175,122,0.1)' : 'rgba(255,107,43,0.1)' }}>
                  <Clock size={10} color={order.tracking_number ? '#4CAF7A' : 'var(--accent)'} />
                  <Typography sx={{ fontSize: 12, fontWeight: 500, color: order.tracking_number ? '#4CAF7A' : 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                    {order.tracking_number ? 'Confirmed' : 'Missing'}
                  </Typography>
                </Box>

                {/* Carrier */}
                <Typography sx={{ fontSize: 12, fontWeight: 300, color: order.carrier_code ? 'var(--ink-3)' : 'var(--ink-4)' }}>
                  {order.carrier_code ?? 'No carrier'}
                </Typography>

                {/* Live status */}
                {order.is_stalled ? (
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: '4px', bgcolor: 'rgba(229,72,77,0.1)', width: 'fit-content' }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 500, color: '#E5484D' }}>
                      No update{order.latest_event_at ? ` · ${fmtRelative(order.latest_event_at)}` : ''}
                    </Typography>
                  </Box>
                ) : order.latest_status === 'delivered' ? (
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: '4px', bgcolor: 'rgba(76,175,122,0.1)', width: 'fit-content' }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 500, color: '#4CAF7A' }}>
                      Delivered{order.latest_location ? ` · ${order.latest_location}` : ''}
                    </Typography>
                  </Box>
                ) : order.latest_status ? (
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: '4px', bgcolor: 'rgba(217,162,59,0.1)', width: 'fit-content' }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 500, color: '#D9A23B' }}>
                      {STATUS_LABEL[order.latest_status] ?? order.latest_status}
                      {order.latest_location ? ` · ${order.latest_location}` : ''}
                      {order.latest_event_at ? ` · ${fmtRelative(order.latest_event_at)}` : ''}
                    </Typography>
                  </Box>
                ) : order.tracking_number ? (
                  order.tracking_url ? (
                    <Box component="a" href={order.tracking_url} target="_blank" rel="noopener noreferrer"
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
                  <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>Not sent</Typography>
                )}

                {/* Action */}
                <Box
                  component="button"
                  onClick={() => setSelectedOrderId(order.lasyncro_order_id)}
                  sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
                >
                  View order →
                </Box>
              </Box>
            );
          })}

          {/* Footer + pagination */}
          {!isLoading && data && data.total > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, bgcolor: 'var(--bg-2)', borderTop: '1px solid var(--rule)' }}>

              {/* Left: count + page size */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                  {ledgerFilter === 'needs_action'
                    ? `${ledgerTotal === 0 ? 0 : ((page - 1) * perPage) + 1}-${Math.min(page * perPage, ledgerTotal)} of ${ledgerTotal} orders needing action`
                    : `${((page - 1) * perPage) + 1}-${Math.min(page * perPage, data.total)} of ${data.total} orders`}
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
                const pageCount = Math.ceil(ledgerTotal / perPage);
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
                        sx={{ px: 1.5, py: 0.5, fontSize: 11, border: '1px solid', borderColor: i + 1 === page ? 'var(--accent)' : 'var(--rule)', borderRadius: '6px', bgcolor: i + 1 === page ? 'var(--accent)' : 'var(--surface)', color: i + 1 === page ? 'var(--accent-ink)' : 'var(--ink-3)', cursor: 'pointer', fontWeight: i + 1 === page ? 600 : 400 }}
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
      <ExportDrawer
        open={exportDrawerOpen}
        onClose={() => setExportDrawerOpen(false)}
        userTier={tier}
        reportIds={['orders-outbound']}
      />
      <EntityDetailModal
        entityId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        title={modalTitle}
        subtitle={modalSubtitle}
        maxWidth="md"
        footerActions={modalFooter}
      >
        {selectedOrderId && (
          <OrderDetailModalBody
              orderId={selectedOrderId}
              onTitleReady={setModalTitle}
              onSubtitleReady={setModalSubtitle}
              onNavigateToOrder={setSelectedOrderId}
              onFooterReady={setModalFooter}
              onPriorityFlag={onPriorityFlag}
              onClose={() => setSelectedOrderId(null)}
            />
        )}
      </EntityDetailModal>
    </Box>
  );
}
