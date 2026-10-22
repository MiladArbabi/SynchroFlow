/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/OrdersOutboundPage.tsx
//
// OUTBOUND TAB — Shipped orders — OPERATIONAL CONTEXT
// Route: /orders/outbound
//
// Layout:
//   1. Header — title + permanent orientation + export
//   2. Body   — shared OperationalContextShell:
//               primary Shipped orders ledger | Shipping state rail
//
// Ops Console owns cross-workflow attention: the Shipping state rail
// withdraws while it is open, and this page keeps no local attention inbox
// and no handoff / label execution surfaces.
//
// RULES: No alpha(). No useTheme(). No fontFamily overrides. 1px borders. 12px inner cards, 14px table.
import { useMemo, useState, useCallback, ReactNode, ChangeEvent } from 'react';
import { EntityDetailModal, OperationalContextShell } from '@lasyncro/shared/ui';
import { OrderDetailModalBody } from 'pages/orders/OrderDetailModalBody';
import { useBulkSetPriority } from '../wms/useOrderPool';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { ExportDrawer } from 'components/ExportDrawer';
import useConfig from 'hooks/useConfig';
import {
  Box,
  Typography,
  CircularProgress,
} from '@mui/material';
import { Package } from 'lucide-react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { axiosInstance } from 'api/axiosConfig';
import { useNavigate } from 'react-router-dom';

// ─── TYPES ────────────────────────────────────────────
/** Row of GET /api/v1/orders/outbound — physically shipped orders. */
interface OutboundOrder {
  lasyncro_order_id: string;
  external_order_id: string | null;
  shipped_at: string;
  total_price: string;
  currency: string;
  tracking_number: string | null;
  carrier: string | null;
  carrier_provider: string | null;
  latest_status: string | null;
  latest_event_at: string | null;
  is_stalled: boolean | null;
}

/** Period-scoped Shipping State summary. Never narrowed by state, q or page. */
interface OutboundSummary {
  shipped_count: number;
  with_tracking_count: number;
  missing_tracking_count: number;
  tracking_coverage_pct: number | null;
  avg_time_to_ship_hours: number | null;
}

interface OutboundOrdersResponse {
  orders: OutboundOrder[];
  total: number;
  page: number;
  limit: number;
  summary?: OutboundSummary;
}

/** Response tagged with the period it was requested for (summary compatibility). */
interface OutboundOrdersResult extends OutboundOrdersResponse {
  requestedPeriod: OutboundPeriod;
}

interface CarrierSettingsResponse {
  carriers: { carrier_code: string; is_active: boolean }[];
}

// ─── HOOK ─────────────────────────────────────────────
type SortField = 'shipped_at';
type SortDir   = 'asc' | 'desc';
type OutboundState = 'all' | 'needs_action' | 'missing_tracking' | 'in_transit' | 'delivered';
type OutboundPeriod = 'week' | 'month' | 'all';

const STATE_OPTIONS: { key: OutboundState; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'needs_action', label: 'Needs action' },
  { key: 'missing_tracking', label: 'Missing tracking' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'delivered', label: 'Delivered' },
];

const PERIOD_OPTIONS: { key: OutboundPeriod; label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
];

interface OutboundQuery {
  state: OutboundState;
  period: OutboundPeriod;
  q: string;
  page: number;
  perPage: number;
  sortField: SortField;
  sortDir: SortDir;
}

/**
 * Shipped Orders ledger. The server owns membership, state / period / search
 * filtering, sorting and pagination — the page renders exactly the returned
 * working set and never filters or slices it locally.
 */
function useOutboundOrders({ state, period, q, page, perPage, sortField, sortDir }: OutboundQuery) {
  return useQuery<OutboundOrdersResult, Error, OutboundOrdersResult>({
    queryKey: ['orders', 'outbound', { state, period, q, page, perPage, sortField, sortDir }],
    queryFn: async (): Promise<OutboundOrdersResult> => {
      const params = new URLSearchParams({
        state,
        period,
        page: String(page),
        limit: String(perPage),
        sort: sortField,
        dir: sortDir,
      });
      if (q) params.set('q', q);
      const { data } = await axiosInstance.get<OutboundOrdersResponse>(`/api/v1/orders/outbound?${params}`);
      return { ...data, requestedPeriod: period };
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

// ─── HELPERS ──────────────────────────────────────────

/**
 * Each order is formatted in its own stored currency. Malformed currency data
 * falls back to amount + the provided code — never silently to USD.
 */
const fmtMoney = (price: string, currency: string, locale: string): string => {
  const amount = Number(price);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency ?? ''}`.trim();
  }
};

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
  unknown: 'Unknown',
};

/** Carrier states where a missing recent event means the parcel may be stuck. */
const STALL_CAN_APPLY = new Set(['announced', 'in_transit', 'out_for_delivery']);

type LiveTone = 'good' | 'warn' | 'critical' | 'neutral';

/**
 * Live carrier status presentation. is_stalled adds staleness context to an
 * in-flight state; it never replaces the carrier's state, and a carrier
 * exception stays an exception.
 */
function liveStatus(order: OutboundOrder): { label: string; tone: LiveTone } {
  const status = order.latest_status;

  if (!status) {
    return order.tracking_number
      ? { label: 'Status unavailable', tone: 'neutral' }
      : { label: '—', tone: 'neutral' };
  }

  const base = STATUS_LABEL[status] ?? 'Unknown';

  if (order.is_stalled && STALL_CAN_APPLY.has(status)) {
    return { label: `${base} · No recent update`, tone: 'critical' };
  }

  switch (status) {
    case 'delivered':
      return { label: base, tone: 'good' };
    case 'exception':
    case 'returned':
      return { label: base, tone: 'critical' };
    case 'unknown':
      return { label: base, tone: 'neutral' };
    default:
      return { label: base, tone: 'warn' };
  }
}

const LIVE_TONE_STYLE: Record<LiveTone, { bg: string; ink: string }> = {
  good: { bg: 'var(--good-ghost)', ink: 'var(--good-ink)' },
  warn: { bg: 'var(--warning-ghost)', ink: 'var(--warning-text)' },
  critical: { bg: 'var(--critical-ghost)', ink: 'var(--critical-text)' },
  neutral: { bg: 'var(--bg-2)', ink: 'var(--ink-3)' },
};

/** Human-readable duration; semantics unchanged (hours). */
const fmtHours = (hours: number): string => {
  if (hours < 1) return '<1h';
  const hr = Math.round(hours);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  const rem = hr % 24;
  return rem === 0 ? `${d}d` : `${d}d ${rem}h`;
};

const fmtPct = (pct: number): string => `${Math.round(pct * 10) / 10}%`;

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// ─── SHIPPING STATE RAIL ──────────────────────────────
// Contextual state only — same section anatomy as the Order health and
// Inventory state rails. No remediation queue; the single contextual CTA is
// carrier setup navigation.

type StateTone = 'critical' | 'good' | 'neutral';

const STATE_TONE_COLOR: Record<StateTone, string> = {
  critical: 'var(--critical-ink)',
  good: 'var(--good-ink)',
  neutral: 'var(--ink)',
};

const STATE_GROUP_SX = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  py: '10px',
  borderTop: '0.5px solid var(--rule)',
  '&:first-of-type': { borderTop: 'none', pt: 0 },
} as const;

function StateMetric({ label, value, tone = 'neutral' }: { label: string; value: ReactNode; tone?: StateTone }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
      <Typography component="span" sx={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
        {label}
      </Typography>
      <Typography component="span" sx={{ fontSize: 13, fontWeight: 500, color: STATE_TONE_COLOR[tone], fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
}

// ─── LEDGER FILTER CHIPS ──────────────────────────────

function FilterChipGroup<T extends string>({ label, options, active, onSelect }: {
  label: string;
  options: { key: T; label: string }[];
  active: T;
  onSelect: (key: T) => void;
}) {
  return (
    <Box role="group" aria-label={label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {options.map(option => (
        <Box
          key={option.key}
          component="button"
          type="button"
          aria-pressed={active === option.key}
          onClick={() => onSelect(option.key)}
          sx={{
            px: 1.5, py: 0.625, borderRadius: '6px', cursor: 'pointer',
            fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
            bgcolor: active === option.key ? 'var(--accent)' : 'var(--surface)',
            color: active === option.key ? 'var(--accent-ink)' : 'var(--ink-3)',
            border: '1px solid',
            borderColor: active === option.key ? 'var(--accent)' : 'var(--rule)',
            transition: 'all 0.12s ease',
          }}
        >
          {option.label}
        </Box>
      ))}
    </Box>
  );
}

// ─── MAIN ─────────────────────────────────────────────
export default function OrdersOutboundPage() {
  const navigate = useNavigate();
  const { state: { isOpsConsoleOpen } } = useConfig();
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [sortField, setSortField] = useState<SortField>('shipped_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  // Independent dimensions: operational state and shipped period intersect;
  // search narrows within both. Each change returns the ledger to page 1.
  const [shippingState, setShippingState] = useState<OutboundState>('all');
  const [period, setPeriod] = useState<OutboundPeriod>('week');
  const [search, setSearch] = useState('');
  // ISS-05 FIX: replaces 4× navigate('/orders/:id') full-page routes with
  // the standardized EntityDetailModal, matching OrdersFT2Page.tsx exactly
  // (entity-detail-modal-playbook.md §2). OrderDetailPage.tsx removed 2026-07-11
  // (ISS-OD-01) — modal is now the single order detail surface.
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const handleCloseOrderDetail = useCallback(() => {
    setSelectedOrderId(null);
  }, []);
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

  const { data, isLoading, isError } = useOutboundOrders({
    state: shippingState,
    period,
    q: search.trim(),
    page,
    perPage,
    sortField,
    sortDir,
  });
  const {
    data: carrierSettings,
    isError: carrierSettingsError,
  } = useCarrierSettings();

  /**
   * Carrier setup truth: readiness requires an ACTIVE carrier. Unresolved and
   * failed lookups are their own states — never "Not configured".
   */
  const carrierSetup: 'checking' | 'unavailable' | 'not_configured' | 'ready' = carrierSettings
    ? (carrierSettings.carriers ?? []).some(c => c.is_active === true) ? 'ready' : 'not_configured'
    : carrierSettingsError ? 'unavailable' : 'checking';

  const handleSort = (field: SortField) => {
    if (field === sortField) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
    setPage(1);
  };

  // ISS-03 FIX: was a hardcoded blob-download bypassing the established
  // ExportDrawer pattern (export_system_playbook.md §6) — same bug class
  // as ORDM-01, never applied here. 'orders-outbound' report ID added to
  // exportReports.ts to carry the fulfilled-status filter.
  const { tier, locale } = useEntitlements();
  const [exportDrawerOpen, setExportDrawerOpen] = useState(false);
  const handleExportOutbound = async () => setExportDrawerOpen(true);

  // Ledger rows, total and paging are exactly the server response.
  const ledgerRows = useMemo(() => data?.orders ?? [], [data?.orders]);
  const ledgerTotal = data?.total ?? 0;

  const handleStateChange = (next: OutboundState) => {
    setShippingState(next);
    setPage(1);
  };

  const handlePeriodChange = (next: OutboundPeriod) => {
    setPeriod(next);
    setPage(1);
  };

  const handleSearchChange = (next: string) => {
    setSearch(next);
    setPage(1);
  };

  /**
   * Shipping State comes only from the canonical response's summary, which is
   * PERIOD-scoped. Placeholder data kept across a state / search / page change
   * carries the same period and stays valid; placeholder data from another
   * period is not current truth, so the rail reads as unresolved until the
   * selected period's response arrives. Errors and absent summaries are
   * unknown — never zero.
   */
  const summary: OutboundSummary | null =
    !isError && data?.summary && data.requestedPeriod === period ? data.summary : null;

  const handleReviewMissingTracking = () => handleStateChange('missing_tracking');

  // Empty-state truth: never-shipped only when nothing narrows the population.
  const isUnfiltered = shippingState === 'all' && period === 'all' && search.trim() === '';

  return (
    // VIEWPORT GEOMETRY — from lg the page is a bounded flex chain inside the
    // AppLayout content area (Order Flow precedent): root height:100% →
    // content flex:1/minHeight:0 → workspace flex:1/minHeight:0 → shell row
    // minmax(0,1fr). Primary and rail share one track height; only the ledger
    // rows viewport scrolls. Below lg everything keeps its natural height and
    // the AppLayout content area owns vertical scrolling.
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%', height: { lg: '100%' }, display: 'flex', flexDirection: 'column' }}>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />

      <Box sx={{ p: { xs: 2, md: '24px 40px' }, flex: { lg: 1 }, minHeight: { lg: 0 }, display: 'flex', flexDirection: 'column' }}>

        {/* HEADER — H1 + permanent orientation + utility, same anatomy and
            breakpoint wrap as the Orders and Inventory domain headers. Live
            shipping state belongs to the Shipping state rail. */}
        <Box sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1.5,
          mb: 2.5,
          flexShrink: 0,
        }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }}>
              Outbound
            </Typography>
            <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
              Shipped orders, tracking and carrier state after fulfillment
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5, flexShrink: 0 }}>
            <Box
              onClick={handleExportOutbound}
              sx={{ display: 'inline-flex', alignItems: 'center', px: '12px', py: '6px', fontSize: 12, fontWeight: 500, color: 'var(--accent-text)', border: '0.5px solid var(--accent-border)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
            >
              Export →
            </Box>
          </Box>
        </Box>

        {/* OUTBOUND OPERATIONAL CONTEXT — PRIMARY: Shipped orders ledger |
            RAIL: Shipping state, withdrawn while the Ops Console is open. */}
        {/* Operational workspace: owns the remaining height from lg. The shared
            shell is untouched; its root (data-operational-context-shell) is
            given the bounded height and a single minmax(0,1fr) row here so
            both tracks stretch to the same top and bottom edge. */}
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            flex: { lg: 1 },
            minHeight: { lg: 0 },
            '& > [data-operational-context-shell]': {
              flex: { lg: 1 },
              minHeight: { lg: 0 },
              gridTemplateRows: { lg: 'minmax(0, 1fr)' },
            },
          }}
        >
        <OperationalContextShell
          suppressRail={isOpsConsoleOpen}
          primary={
            <Box
              component="section"
              role="region"
              aria-label="Shipped orders"
              sx={{ minWidth: 0, height: { lg: '100%' }, display: 'flex', flexDirection: 'column' }}
            >

              {isError && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, mb: 2, flexShrink: 0, bgcolor: 'rgba(229,72,77,0.07)', border: '1px solid rgba(229,72,77,0.2)', borderRadius: '10px' }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink)' }}>Couldn't load shipped orders.</Typography>
                </Box>
              )}

        {/* SHIPPED ORDERS FILTERS */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2, flexShrink: 0 }}>
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', mb: 0.25 }}>
              Shipped orders
            </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            {/* Operational state and shipped period are separate, simultaneously
                selected dimensions. */}
            <FilterChipGroup label="Shipping state filter" options={STATE_OPTIONS} active={shippingState} onSelect={handleStateChange} />
            <FilterChipGroup label="Shipped period" options={PERIOD_OPTIONS} active={period} onSelect={handlePeriodChange} />
          </Box>

          {/* Search runs server-side and intersects the state and period above. */}
          <Box
            component="input"
            type="search"
            placeholder="Search by order number, SKU, or customer"
            aria-label="Search by order number, SKU, or customer"
            value={search}
            onChange={(e: ChangeEvent<HTMLInputElement>) => handleSearchChange(e.target.value)}
            sx={{
              mt: 1, width: '100%', maxWidth: 360, px: 1.25, py: 0.625,
              bgcolor: 'var(--bg)', border: '1px solid var(--rule)',
              borderRadius: '8px', color: 'var(--ink)',
              fontSize: 12, fontFamily: 'inherit', outline: 'none',
            }}
          />
          </Box>
      </Box>

        {/* SHIPPED ORDERS TABLE */}
        <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', overflow: 'hidden', flex: { lg: 1 }, minHeight: { lg: 0 }, display: 'flex', flexDirection: 'column' }}>
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
                flexShrink: 0,
              }}
            >
              {([
                { label: 'Order',    field: null },
                { label: 'Shipped',  field: 'shipped_at' },
                { label: 'Tracking', field: null },
                { label: 'Carrier',  field: null },
                { label: 'Live status', field: null },
                { label: 'Action',   field: null },
              ] as { label: string; field: SortField | null }[]).map(({ label, field }) => (
              <Box key={label} onClick={() => field && handleSort(field)} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: field ? 'pointer' : 'default' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: field && sortField === field ? 'var(--accent)' : 'var(--ink-4)' }}>
                  {label}
                </Typography>
                {field && sortField === field && (
                  <Typography sx={{ fontSize: 9, color: 'var(--accent-text)' }}>
                    {sortDir === 'desc' ? '↓' : '↑'}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>

          {/* Rows viewport — the only vertically scrolling region of the page
              from lg; header controls, column header and footer stay fixed. */}
          <Box sx={{ flex: { lg: 1 }, minHeight: { lg: 0 }, overflowY: { lg: 'auto' } }}>

          {/* Loading */}
          {isLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={24} sx={{ color: 'var(--accent-text)' }} />
            </Box>
          )}

          {/* Empty — only for a successful response. Never-shipped only when
              nothing narrows the population; otherwise the filters are empty. */}
          {!isLoading && !isError && data && ledgerTotal === 0 && (
            <Box sx={{ px: 3, py: 6, textAlign: 'center' }}>
              <Package size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
              <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-4)' }}>
                {isUnfiltered ? 'No shipped orders yet.' : 'No orders match these filters.'}
              </Typography>
            </Box>
          )}

          {/* Rows */}
          {!isError && ledgerRows.map(order => {
            const live = liveStatus(order);
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
                    {fmtMoney(order.total_price, order.currency, locale)}
                  </Typography>
                </Box>

                {/* Shipped */}
                <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>
                  {fmtDate(order.shipped_at)}
                </Typography>

                {/* Tracking — the canonical tracking number, or Missing. */}
                {order.tracking_number ? (
                  <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'var(--ink-3)', letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {order.tracking_number}
                  </Typography>
                ) : (
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', px: 1, py: 0.25, borderRadius: '4px', width: 'fit-content', bgcolor: 'rgba(255,107,43,0.1)' }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'var(--accent-text)' }}>
                      Missing
                    </Typography>
                  </Box>
                )}

                {/* Carrier — the physical carrier only; the label provider
                    (sendcloud / shippo) is not carrier identity. */}
                <Typography sx={{ fontSize: 12, fontWeight: 300, color: order.carrier ? 'var(--ink-3)' : 'var(--ink-4)' }}>
                  {order.carrier ? order.carrier.toUpperCase() : '—'}
                </Typography>

                {/* Live status */}
                {order.latest_status ? (
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: '4px', bgcolor: LIVE_TONE_STYLE[live.tone].bg, width: 'fit-content' }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 500, color: LIVE_TONE_STYLE[live.tone].ink }}>
                      {live.label}
                      {order.latest_event_at ? ` · ${fmtRelative(order.latest_event_at)}` : ''}
                    </Typography>
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>{live.label}</Typography>
                )}

                {/* Action */}
                <Box
                  component="button"
                  onClick={() => setSelectedOrderId(order.lasyncro_order_id)}
                  sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent-text)', bgcolor: 'transparent', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
                >
                  View order →
                </Box>
              </Box>
            );
          })}

          </Box>

          {/* Footer + pagination */}
          {!isLoading && !isError && ledgerTotal > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, bgcolor: 'var(--bg-2)', borderTop: '1px solid var(--rule)', flexShrink: 0 }}>

              {/* Left: count + page size */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Typography sx={{ fontSize: 11, fontWeight: 300, color: 'var(--ink-4)' }}>
                  {`${((page - 1) * perPage) + 1}-${Math.min(page * perPage, ledgerTotal)} of ${ledgerTotal} orders`}
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
          }
          rail={
            <Box
              component="section"
              role="region"
              aria-label="Shipping state"
              sx={{
                minWidth: 0,
                boxSizing: 'border-box',
                bgcolor: 'var(--surface)',
                border: '0.5px solid var(--rule)',
                borderRadius: '14px',
                px: '18px',
                py: '14px',
                display: 'flex',
                flexDirection: 'column',
                alignSelf: 'start',
                // From lg the rail surface fills the shared track height, so
                // its top and bottom edges match the Shipped Orders surface.
                height: { lg: '100%' },
                overflowY: { lg: 'auto' },
              }}
            >
              <Typography component="h2" sx={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', lineHeight: 1, mb: '12px' }}>
                Shipping state
              </Typography>

              {/* Period-scoped summary. '—' = not known for the selected period
                  (loading, failed, or absent); 0 only when the server says 0. */}
              <Box sx={STATE_GROUP_SX}>
                <StateMetric label="Shipped orders" value={summary ? summary.shipped_count : '—'} />
                <StateMetric
                  label="With tracking"
                  value={summary ? summary.with_tracking_count : '—'}
                  tone={summary && summary.shipped_count > 0 ? (summary.with_tracking_count > 0 ? 'good' : 'critical') : 'neutral'}
                />
                <StateMetric
                  label="Missing tracking"
                  value={summary ? summary.missing_tracking_count : '—'}
                  tone={summary ? (summary.missing_tracking_count > 0 ? 'critical' : 'good') : 'neutral'}
                />
                <StateMetric
                  label="Tracking coverage"
                  value={summary?.tracking_coverage_pct != null ? fmtPct(summary.tracking_coverage_pct) : '—'}
                  tone={summary?.tracking_coverage_pct != null ? (summary.tracking_coverage_pct > 0 ? 'good' : 'critical') : 'neutral'}
                />
                <StateMetric
                  label="Avg time to ship"
                  value={summary?.avg_time_to_ship_hours != null ? fmtHours(summary.avg_time_to_ship_hours) : '—'}
                />
                {/* Navigation into the ledger only — no remediation here. */}
                {summary && summary.missing_tracking_count > 0 && (
                  <Box
                    component="button"
                    type="button"
                    onClick={handleReviewMissingTracking}
                    sx={{ alignSelf: 'flex-start', p: 0, border: 'none', bgcolor: 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }}
                  >
                    Review missing tracking →
                  </Box>
                )}
              </Box>

              {/* Contextual navigation only — carrier setup is owned by Settings. */}
              <Box sx={STATE_GROUP_SX}>
                <StateMetric
                  label="Carrier setup"
                  value={{
                    checking: 'Checking',
                    unavailable: 'Unavailable',
                    not_configured: 'Not configured',
                    ready: 'Ready',
                  }[carrierSetup]}
                  tone={carrierSetup === 'ready' ? 'good' : carrierSetup === 'not_configured' ? 'critical' : 'neutral'}
                />
                {carrierSetup === 'not_configured' && (
                  <Box
                    component="button"
                    type="button"
                    onClick={() => navigate('/settings/carriers')}
                    sx={{ alignSelf: 'flex-start', p: 0, border: 'none', bgcolor: 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', color: 'var(--accent-text)', '&:hover': { opacity: 0.75 } }}
                  >
                    Set up →
                  </Box>
                )}
              </Box>
            </Box>
          }
        />
        </Box>
      </Box>

      <ExportDrawer
        open={exportDrawerOpen}
        onClose={() => setExportDrawerOpen(false)}
        reportIds={['orders-outbound']}
      />
      <EntityDetailModal
        entityId={selectedOrderId}
        onClose={handleCloseOrderDetail}
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
              onClose={handleCloseOrderDetail}
            />
        )}
      </EntityDetailModal>
    </Box>
  );
}
