// modules/finances/src/ui/pages/FinancesModuleFT2.tsx
import { useState } from 'react';
import { Box, Typography, ToggleButtonGroup, ToggleButton, useTheme, alpha, LinearProgress } from '@mui/material';
import { FT2Layout } from '@lasyncro/ui-ft2';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { ModuleErrorBoundary } from '@lasyncro/shared/ui';

/**
 * LOCAL MARGIN TYPE
 * -----------------
 * Mirrors MarginResponse from the frontend hook.
 * Defined locally to avoid cross-rootDir import.
 */
export type MarginSummary = {
  order_count: number;
  total_revenue: number;
  total_cost: number;
  total_margin: number;
  avg_margin_pct: number;
  min_margin_pct: number;
  max_margin_pct: number;
};

export type MarginOrder = {
  order_id: string;
  gross_revenue: string;
  estimated_cost: string;
  gross_margin: string;
  margin_pct: string;
  fulfillment_status: string | null;
  evaluated_at: string;
};

export type SkuMarginRow = {
  lasyncro_variant_id: string;
  sku: string | null;
  title: string | null;
  image_url: string | null;
  total_units_sold: number;
  gross_revenue: number;
  estimated_cost: number;
  gross_margin: number;
  margin_pct: number;
};

export type SkuMarginData = {
  data: SkuMarginRow[];
} | null;

export type MarginTrendPoint = {
  date: string;
  avg_margin_pct: number;
  total_margin: number;
  total_revenue: number;
  order_count: number;
};

export type MarginTrendData = {
  data: MarginTrendPoint[];
  days: number;
} | null;

export type MarginData = {
  summary: MarginSummary;
  orders: MarginOrder[];
  pagination: { page: number; limit: number };
} | null;

export interface FinancesModuleFT2DataProps {
  context: {
    revenueObserved: number | null;
    netObserved: number | null;
  };
  timeAwareness: { history: 'sufficient' | 'insufficient' } | null;
  timeline: {
    bucket: 'day';
    points: Array<{ from: string; to: string; revenueObserved: number | null }>;
  } | null;
  blindSpots: {
    costs: 'unknown' | 'known';
    refunds: 'unknown' | 'known';
    history: 'insufficient' | 'sufficient';
  } | null;
  decisionSafety: { status: 'safe' | 'unsafe' | 'unknown' } | null;
  profitPreconditions: { status: 'ready' | 'not_ready' } | null;
  refundReality: { status: 'known' | 'unknown' } | null;
  costReality: { status: 'known' | 'partial' | 'unknown' } | null;
  refundImpact: { status: 'material' | 'immaterial' | 'unknown' } | null;
  financialConsistency: { status: 'stable' | 'volatile' | 'unknown' } | null;
  /**
   * MARGIN INTELLIGENCE (MG-04)
   * ---------------------------
   * Injected from FinancesFT2Page via useMargin hook.
   * null when data is loading or unavailable.
   */
  margin: MarginData;
  /**
   * PER-SKU MARGIN (MG-05)
   * ----------------------
   * Injected from FinancesFT2Page via useSkuMargin hook.
   * null when loading or unavailable.
   */
  skuMargin: SkuMarginData;
  /**
   * MARGIN TREND (MG-06)
   * --------------------
   * Daily margin trend for 30/90-day chart.
   * null when loading or unavailable.
   */
  marginTrend: MarginTrendData;
}

export type FinancesModuleFT2Props = FinancesModuleFT2DataProps & {
  /** CURRENCY LAYER 3 — pass from EntitlementsContext, never hardcode */
  currency?: CurrencyContext;
};

type StatusFilter = 'all' | 'pending' | 'fulfilled';
type ViewMode = 'orders' | 'sku';

// surface tokens → theme.palette.* and MUI sx shorthands throughout (no custom theme hook)
function StatBox({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: 'positive' | 'negative' | 'warning' | 'neutral';
}) {
  const muiColor =
    accent === 'positive' ? 'success.main' :
    accent === 'negative' ? 'error.main'   :
    accent === 'warning'  ? 'warning.main' :
    'text.primary';

  return (
    <Box sx={{ flex: 1, minWidth: 140, p: 2.5, bgcolor: 'background.paper', border: '0.5px solid', borderColor: 'divider', borderRadius: 2 }}>
      <Typography variant="caption" color="text.secondary"
        sx={{ fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.75, display: 'block' }}>
        {label}
      </Typography>
      <Typography color={muiColor}
        sx={{ fontSize: 22, fontWeight: 500, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
        {value}
      </Typography>
      {sub && <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>{sub}</Typography>}
    </Box>
  );
}

function MarginBar({ min, avg, max }: { min: number; avg: number; max: number }) {
  const theme = useTheme();
  const barColor =
    avg >= 40 ? theme.palette.success.main :
    avg >= 20 ? theme.palette.warning.main :
                theme.palette.error.main;

  return (
    <Box>
      <Typography variant="caption" color="text.secondary"
        sx={{ fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', mb: 1, display: 'block' }}>
        Margin Distribution
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.primary' }}>
          {avg}% average gross margin
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={avg}
        sx={{
          height: 6, borderRadius: 3,
          bgcolor: 'action.hover',
          '& .MuiLinearProgress-bar': {
            bgcolor: barColor,
            borderRadius: 3,
          },
        }}
      />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.75 }}>
        <Typography variant="caption" color="text.secondary">Min {min}%</Typography>
        <Typography variant="caption" sx={{ color: barColor, fontWeight: 500 }}>Avg {avg}%</Typography>
        <Typography variant="caption" color="text.secondary">Max {max}%</Typography>
      </Box>
    </Box>
  );
}

function FinancesModuleFT2Inner({ currency, ...props }: FinancesModuleFT2Props) {
  const theme = useTheme();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('orders');
  const { margin, skuMargin, marginTrend } = props;
  const trendPoints = marginTrend?.data ?? [];

  const summary = margin?.summary;
  const [orderSort, setOrderSort] = useState<{ field: 'margin_pct' | 'gross_margin' | 'gross_revenue' | 'estimated_cost' | 'fulfillment_status'; dir: 'asc' | 'desc' }>({ field: 'gross_margin', dir: 'asc' });
  const sortedOrders = [...(margin?.orders ?? [])].filter(o =>
    statusFilter === 'all' ? true : o.fulfillment_status === statusFilter
  ).sort((a, b) => {
    if (orderSort.field === 'fulfillment_status') {
      const av = a.fulfillment_status ?? '';
      const bv = b.fulfillment_status ?? '';
      return orderSort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    const av = Number(a[orderSort.field]);
    const bv = Number(b[orderSort.field]);
    return orderSort.dir === 'asc' ? av - bv : bv - av;
  });
  /* PAG-001: perPage is user-controlled — default 10, options 10/25/50/100 */
  const [perPage, setPerPage] = useState(10);
  const [orderPage, setOrderPage] = useState(0);
  const visibleOrders = sortedOrders.slice(orderPage * perPage, (orderPage + 1) * perPage);
  const orderPageCount = Math.ceil(sortedOrders.length / perPage);
  const toggleOrderSort = (field: 'margin_pct' | 'gross_margin' | 'gross_revenue' | 'estimated_cost' | 'fulfillment_status') => {
    setOrderSort(prev =>
      prev.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' }
    );
  };

  type SortField = 'margin_pct' | 'gross_margin' | 'gross_revenue' | 'total_units_sold' | 'estimated_cost';
  type SortDir = 'asc' | 'desc';
  const [skuSort, setSkuSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'gross_margin', dir: 'asc' });
  const [skuPage, setSkuPage] = useState(0);

  const sortedSkus = [...(skuMargin?.data ?? [])].sort((a, b) => {
    const av = Number(a[skuSort.field]);
    const bv = Number(b[skuSort.field]);
    return skuSort.dir === 'asc' ? av - bv : bv - av;
  });
  const visibleSkus = sortedSkus.slice(skuPage * perPage, (skuPage + 1) * perPage);
  const skuPageCount = Math.ceil(sortedSkus.length / perPage);

  const toggleSkuSort = (field: SortField) => {
    setSkuSort(prev =>
      prev.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' }
    );
  };

  const fmt = (n: number) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  return (
    <FT2Layout>
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        <Box>
          <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2, py: 2 }}>
            Margin
          </Typography>
        </Box>

        {!summary && (
          <Typography variant="body2" color="text.secondary">Loading margin data…</Typography>
        )}

        {summary && (
          <>
            {/* ZONE 1 — STAT CARDS */}
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              <StatBox label="Avg Gross Margin" value={`${summary.avg_margin_pct}%`} accent={summary.avg_margin_pct >= 40 ? 'positive' : summary.avg_margin_pct >= 20 ? 'warning' : 'negative'} />
              <StatBox label="Total Margin"     value={fmt(summary.total_margin)}    accent="positive" />
              <StatBox label="Total Revenue"    value={fmt(summary.total_revenue)}   accent="neutral" />
              <StatBox label="Total Cost"       value={fmt(summary.total_cost)}      accent="neutral" />
              <StatBox label="Orders Analysed"  value={String(summary.order_count)}  accent="neutral" />
            </Box>

            {/* ZONE 2 — DISTRIBUTION + TREND SIDE BY SIDE */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
              <Box sx={{ p: 2.5, bgcolor: 'background.paper', border: '0.5px solid', borderColor: 'divider', borderRadius: 2 }}>
                <MarginBar min={summary.min_margin_pct} avg={summary.avg_margin_pct} max={summary.max_margin_pct} />
              </Box>
              <Box sx={{ p: 2.5, bgcolor: 'background.paper', border: '0.5px solid', borderColor: 'divider', borderRadius: 2 }}>
                <Typography variant="overline" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
                  Margin Trend — {marginTrend?.days ?? 30}d
                </Typography>
                {trendPoints.length > 1 ? (
                  <>
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={trendPoints} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                        <XAxis dataKey="date" tick={{ fontSize: 9, fill: theme.palette.text.secondary }}
                          tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 9, fill: theme.palette.text.secondary }}
                          axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                        <Tooltip
                          formatter={(value) => [`${Number(value)}%`, 'Avg Margin']}
                          labelFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          contentStyle={{ background: theme.palette.background.paper, border: `0.5px solid ${theme.palette.divider}`, borderRadius: 8, fontSize: 12 }}
                        />
                        <ReferenceLine y={40} stroke={theme.palette.warning.main} strokeDasharray="4 2" strokeWidth={1} />
                        <Line type="monotone" dataKey="avg_margin_pct" stroke={theme.palette.primary.main} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      Dashed line = 40% margin threshold
                    </Typography>
                  </>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    More trend data available after 7 days of activity.
                  </Typography>
                )}
              </Box>
            </Box>

            {/* ZONE 3 — TABLE */}
            <Box sx={{ bgcolor: 'background.paper', border: '0.5px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>

              {/* TABLE CONTROLS */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1.5, borderBottom: '0.5px solid', borderColor: 'divider' }}>
                <ToggleButtonGroup value={viewMode} exclusive onChange={(_e, val) => { if (val) { setViewMode(val); setOrderPage(0); setSkuPage(0); } }} size="small">
                  <ToggleButton value="orders">By Order</ToggleButton>
                  <ToggleButton value="sku">By SKU</ToggleButton>
                </ToggleButtonGroup>
                {viewMode === 'orders' && (
                  <ToggleButtonGroup value={statusFilter} exclusive onChange={(_e, val) => { if (val) { setStatusFilter(val); setOrderPage(0); } }} size="small">
                    <ToggleButton value="all">All</ToggleButton>
                    <ToggleButton value="pending">Pending</ToggleButton>
                    <ToggleButton value="fulfilled">Fulfilled</ToggleButton>
                  </ToggleButtonGroup>
                )}
              </Box>

              {/* SKU TABLE */}
              {viewMode === 'sku' && (
                <>
                  <Box sx={{ display: 'grid', bgcolor: 'background.paper', gridTemplateColumns: '36px 2.5fr 80px 1fr 1fr 1fr 80px', px: 2, py: 1, borderBottom: '0.5px solid', borderColor: 'divider' }}>
                    {([
                      { label: '',              field: null },
                      { label: 'Product / SKU', field: null },
                      { label: 'Units',         field: 'total_units_sold' },
                      { label: 'Revenue',       field: 'gross_revenue' },
                      { label: 'Cost',          field: 'estimated_cost' },
                      { label: 'Margin',        field: 'gross_margin' },
                      { label: 'Margin %',      field: 'margin_pct' },
                    ] as { label: string; field: SortField | null }[]).map(({ label, field }) => (
                      <Box key={label} onClick={() => field && toggleSkuSort(field)}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: field ? 'pointer' : 'default', '&:hover': { opacity: field ? 0.7 : 1 } }}>
                        <Typography variant="caption" color="text.secondary" fontWeight={500}>{label}</Typography>
                        {field && skuSort.field === field && (
                          <Typography variant="caption" sx={{ color: skuSort.dir === 'asc' ? theme.palette.success.main : theme.palette.error.main }}>
                            {skuSort.dir === 'asc' ? '↑' : '↓'}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Box>
                  {visibleSkus.map((row) => {
                    const isNegative = row.margin_pct < 0;
                    const marginColor =
                      isNegative           ? theme.palette.error.main :
                      row.margin_pct >= 60 ? theme.palette.success.main :
                      row.margin_pct >= 40 ? theme.palette.warning.main :
                                             theme.palette.error.main;
                    return (
                      <Box key={row.lasyncro_variant_id} sx={{
                        display: 'grid', gridTemplateColumns: '36px 2.5fr 80px 1fr 1fr 1fr 80px',
                        px: 2, py: 1.5, borderBottom: '0.5px solid', borderColor: 'divider',
                        borderLeft: isNegative ? `3px solid ${theme.palette.error.main}` : '3px solid transparent',
                        bgcolor: isNegative ? alpha(theme.palette.error.main, 0.06) : 'transparent',
                        '&:hover': { bgcolor: isNegative ? alpha(theme.palette.error.main, 0.10) : 'action.hover' },
                      }}>
                        {/* Product thumbnail */}
                        <Box sx={{ width: 36, height: 36, borderRadius: '6px', flexShrink: 0, bgcolor: 'var(--bg)', border: '0.5px solid var(--rule)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {row.image_url
                            ? <img src={row.image_url} alt={row.title ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'var(--ink-4)' }}>{(row.title ?? '?').charAt(0).toUpperCase()}</Typography>
                          }
                        </Box>
                        <Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" fontWeight={500}>{row.title ?? '—'}</Typography>
                            {isNegative && (
                              <Box component="span" sx={{ px: '5px', py: '1px', bgcolor: alpha(theme.palette.error.main, 0.12), border: `0.5px solid ${alpha(theme.palette.error.main, 0.3)}`, borderRadius: '4px', fontSize: 9, fontWeight: 500, color: theme.palette.error.main, letterSpacing: '0.04em' }}>
                                LOSING MONEY
                              </Box>
                            )}
                          </Box>
                          {row.sku && <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{row.sku}</Typography>}
                        </Box>
                        <Typography variant="body2">{row.total_units_sold}</Typography>
                        <Typography variant="body2">{fmt(row.gross_revenue)}</Typography>
                        <Typography variant="body2">{fmt(row.estimated_cost)}</Typography>
                        <Typography variant="body2">{fmt(row.gross_margin)}</Typography>
                        <Typography variant="body2" fontWeight={500} sx={{ color: marginColor }}>{row.margin_pct}%</Typography>
                      </Box>
                    );
                  })}
                  {sortedSkus.length === 0 && (
                    <Box sx={{ py: 4, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary">No SKU margin data available.</Typography>
                    </Box>
                  )}
                </>
              )}

              {/* ORDER TABLE */}
              {viewMode === 'orders' && (
                <>
                  <Box sx={{ display: 'grid', bgcolor: 'background.paper', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', px: 2, py: 1, borderBottom: '0.5px solid', borderColor: 'divider' }}>
                    {([
                      { label: 'Order',    field: null },
                      { label: 'Revenue',  field: 'gross_revenue' },
                      { label: 'Cost',     field: 'estimated_cost' },
                      { label: 'Margin',   field: 'gross_margin' },
                      { label: 'Margin %', field: 'margin_pct' },
                      { label: 'Status',   field: 'fulfillment_status' },
                    ] as { label: string; field: 'margin_pct' | 'gross_margin' | 'gross_revenue' | null }[]).map(({ label, field }) => (
                      <Box key={label} onClick={() => field && toggleOrderSort(field)}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: field ? 'pointer' : 'default', '&:hover': { opacity: field ? 0.7 : 1 } }}>
                        <Typography variant="caption" color="text.secondary" fontWeight={500}>{label}</Typography>
                        {field && orderSort.field === field && (
                          <Typography variant="caption" sx={{ color: orderSort.dir === 'asc' ? theme.palette.success.main : theme.palette.error.main }}>
                            {orderSort.dir === 'asc' ? '↑' : '↓'}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Box>
                  {visibleOrders.map((order) => {
                    const marginPct = Number(order.margin_pct);
                    const marginColor = marginPct >= 60 ? theme.palette.success.main : marginPct >= 40 ? theme.palette.warning.main : theme.palette.error.main;
                    return (
                      <Box key={order.order_id} sx={{ display: 'grid', bgcolor: 'background.default', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', px: 2, py: 1.5, borderBottom: '0.5px solid', borderColor: 'divider', '&:hover': { bgcolor: 'action.hover' } }}>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{order.order_id.slice(0, 8).toUpperCase()}</Typography>
                        <Typography variant="body2">{fmt(Number(order.gross_revenue))}</Typography>
                        <Typography variant="body2">{fmt(Number(order.estimated_cost))}</Typography>
                        <Typography variant="body2">{fmt(Number(order.gross_margin))}</Typography>
                        <Typography variant="body2" fontWeight={500} sx={{ color: marginColor }}>{marginPct}%</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{order.fulfillment_status ?? '—'}</Typography>
                      </Box>
                    );
                  })}
                  {visibleOrders.length === 0 && (
                    <Box sx={{ py: 4, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary">No orders match this filter.</Typography>
                    </Box>
                  )}
                </>
              )}

              {/* PAGINATION FOOTER */}
              {(() => {
                const pageCount = viewMode === 'orders' ? orderPageCount : skuPageCount;
                const page      = viewMode === 'orders' ? orderPage     : skuPage;
                const setPage   = viewMode === 'orders' ? setOrderPage  : setSkuPage;
                const total     = viewMode === 'orders' ? sortedOrders.length : sortedSkus.length;
                if (total === 0) return null;
                return (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1, borderTop: '0.5px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
                    {/* Left: count + page size selector */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Typography variant="caption" color="text.secondary">
                        {page * perPage + 1}–{Math.min((page + 1) * perPage, total)} of {total}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {[10, 25, 50, 100].map(n => (
                          <Box key={n} component="button" onClick={() => { setPerPage(n); setOrderPage(0); setSkuPage(0); }}
                            sx={{ px: 1, py: 0.25, fontSize: 10, border: '0.5px solid', borderColor: n === perPage ? 'var(--accent)' : 'divider', borderRadius: '4px', bgcolor: n === perPage ? 'var(--accent-ghost)' : 'background.paper', color: n === perPage ? 'var(--accent)' : 'text.secondary', cursor: 'pointer', fontWeight: n === perPage ? 600 : 400 }}>
                            {n}
                          </Box>
                        ))}
                      </Box>
                    </Box>
                    {/* Right: prev / page numbers / next — hidden when all items fit */}
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {pageCount > 1 && <Box component="button" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                        sx={{ px: 1.5, py: 0.5, fontSize: 11, border: '0.5px solid', borderColor: 'divider', borderRadius: '6px', bgcolor: 'background.paper', color: 'text.secondary', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>
                        ← Prev
                      </Box>
                      }
                      {pageCount > 1 && Array.from({ length: pageCount }, (_, i) => (
                        <Box key={i} component="button" onClick={() => setPage(i)}
                          sx={{ px: 1.5, py: 0.5, fontSize: 11, border: '0.5px solid', borderColor: i === page ? 'var(--accent)' : 'divider', borderRadius: '6px', bgcolor: i === page ? 'var(--accent)' : 'background.paper', color: i === page ? '#fff' : 'text.secondary', cursor: 'pointer', fontWeight: i === page ? 600 : 400 }}>
                          {i + 1}
                        </Box>
                      ))}
                      {pageCount > 1 && <Box component="button" onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={page === pageCount - 1}
                        sx={{ px: 1.5, py: 0.5, fontSize: 11, border: '0.5px solid', borderColor: 'divider', borderRadius: '6px', bgcolor: 'background.paper', color: 'text.secondary', cursor: page === pageCount - 1 ? 'default' : 'pointer', opacity: page === pageCount - 1 ? 0.4 : 1 }}>
                        Next →
                      </Box>}
                    </Box>
                  </Box>
                );
              })()}

            </Box>
          </>
        )}
      </Box>
    </FT2Layout>
  );
}

export default function FinancesModuleFT2(props: FinancesModuleFT2Props) {
  return <ModuleErrorBoundary moduleName="finances"><FinancesModuleFT2Inner {...props} /></ModuleErrorBoundary>;
}