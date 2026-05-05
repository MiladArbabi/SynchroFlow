// modules/finances/src/ui/pages/FinancesModuleFT2.tsx
import { Box, Typography, ToggleButtonGroup, ToggleButton, useTheme } from '@mui/material';
import { useState } from 'react';
import { FT2Layout, FT2Row } from '@lasyncro/ui-ft2';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

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

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ flex: 1, p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, textAlign: 'center' }}>
      <Typography variant="h5" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
        {label}
      </Typography>
    </Box>
  );
}

function MarginBar({ min, avg, max }: { min: number; avg: number; max: number }) {
  const theme = useTheme();
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="overline" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
        Margin Distribution
      </Typography>
      <Box sx={{ position: 'relative', height: 8, borderRadius: 4, bgcolor: 'action.hover' }}>
        <Box sx={{ position: 'absolute', left: `${min}%`, width: `${max - min}%`, height: '100%', borderRadius: 4, bgcolor: theme.palette.primary.main, opacity: 0.3 }} />
        <Box sx={{ position: 'absolute', left: `${avg - 1}%`, width: '2%', height: '100%', borderRadius: 4, bgcolor: theme.palette.primary.main }} />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">Min {min}%</Typography>
        <Typography variant="caption" color="primary.main" fontWeight={600}>Avg {avg}%</Typography>
        <Typography variant="caption" color="text.secondary">Max {max}%</Typography>
      </Box>
    </Box>
  );
}

export default function FinancesModuleFT2({ currency, ...props }: FinancesModuleFT2Props) {
  const theme = useTheme();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('orders');
  const { margin, skuMargin, marginTrend } = props;
  const trendPoints = marginTrend?.data ?? [];

  const summary = margin?.summary;
  const orders = (margin?.orders ?? []).filter(o =>
    statusFilter === 'all' ? true : o.fulfillment_status === statusFilter
  );

  const fmt = (n: number) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  return (
    <FT2Layout>
      <Box sx={{ p: 3 }}>

        {/* HEADER */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h5" fontWeight={700}>Finances</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Gross margin and contribution intelligence across your orders.
          </Typography>
        </Box>

        {!summary && (
          <Typography variant="body2" color="text.secondary">Loading margin data…</Typography>
        )}

        {summary && (
          <>
            {/* ZONE 1 — MARGIN PULSE */}
            <FT2Row intent="kpi">
              <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', width: '100%' }}>
                <StatBox label="Avg Gross Margin" value={`${summary.avg_margin_pct}%`} />
                <StatBox label="Total Margin" value={fmt(summary.total_margin)} />
                <StatBox label="Total Revenue" value={fmt(summary.total_revenue)} />
                <StatBox label="Total Cost" value={fmt(summary.total_cost)} />
                <StatBox label="Orders Analysed" value={String(summary.order_count)} />
              </Box>
            </FT2Row>

            {/* ZONE 2 — DISTRIBUTION */}
            <MarginBar min={summary.min_margin_pct} avg={summary.avg_margin_pct} max={summary.max_margin_pct} />

            {/* ZONE 3 — MARGIN TREND CHART */}
            {trendPoints.length > 0 && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="overline" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
                  Margin Trend — {marginTrend?.days}d
                </Typography>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={trendPoints} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: 'var(--ink-3)' }}
                      tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--ink-3)' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${v}%`}
                      domain={[0, 100]}
                    />
                    <Tooltip
                      formatter={(value) => [`${Number(value)}%`, 'Avg Margin']}
                      labelFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      contentStyle={{
                        background: theme.palette.background.paper,
                        border: `1px solid ${theme.palette.divider}`,
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <ReferenceLine y={40} stroke={theme.palette.warning.main} strokeDasharray="4 2" strokeWidth={1} />
                    <Line
                      type="monotone"
                      dataKey="avg_margin_pct"
                      stroke={theme.palette.primary.main}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  Dashed line = 40% margin threshold
                </Typography>
              </Box>
            )}

            {/* ZONE 4 — VIEW TOGGLE + BREAKDOWN */}
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <ToggleButtonGroup value={viewMode} exclusive onChange={(_e, val) => val && setViewMode(val)} size="small">
                  <ToggleButton value="orders">By Order</ToggleButton>
                  <ToggleButton value="sku">By SKU</ToggleButton>
                </ToggleButtonGroup>
                {viewMode === 'orders' && (
                  <ToggleButtonGroup value={statusFilter} exclusive onChange={(_e, val) => val && setStatusFilter(val)} size="small">
                    <ToggleButton value="all">All</ToggleButton>
                    <ToggleButton value="pending">Pending</ToggleButton>
                    <ToggleButton value="fulfilled">Fulfilled</ToggleButton>
                  </ToggleButtonGroup>
                )}
              </Box>

              {/* SKU TABLE */}
              {viewMode === 'sku' && (
                <>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '2.5fr 80px 1fr 1fr 1fr 80px', px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                    {['Product / SKU', 'Units', 'Revenue', 'Cost', 'Margin', 'Margin %'].map(h => (
                      <Typography key={h} variant="caption" color="text.secondary" fontWeight={600}>{h}</Typography>
                    ))}
                  </Box>
                  {(skuMargin?.data ?? []).map((row) => {
                    const marginColor =
                      row.margin_pct >= 60 ? theme.palette.success.main :
                      row.margin_pct >= 40 ? theme.palette.warning.main :
                      theme.palette.error.main;
                    return (
                      <Box key={row.lasyncro_variant_id} sx={{ display: 'grid', gridTemplateColumns: '2.5fr 80px 1fr 1fr 1fr 80px', px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', '&:hover': { bgcolor: 'action.hover' } }}>
                        <Box>
                          <Typography variant="body2" fontWeight={500}>{row.title ?? '—'}</Typography>
                          {row.sku && <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{row.sku}</Typography>}
                        </Box>
                        <Typography variant="body2">{row.total_units_sold}</Typography>
                        <Typography variant="body2">{fmt(row.gross_revenue)}</Typography>
                        <Typography variant="body2">{fmt(row.estimated_cost)}</Typography>
                        <Typography variant="body2">{fmt(row.gross_margin)}</Typography>
                        <Typography variant="body2" fontWeight={600} sx={{ color: marginColor }}>{row.margin_pct}%</Typography>
                      </Box>
                    );
                  })}
                  {(skuMargin?.data ?? []).length === 0 && (
                    <Box sx={{ py: 4, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary">No SKU margin data available.</Typography>
                    </Box>
                  )}
                </>
              )}

              {/* ORDER TABLE */}
              {viewMode === 'orders' && (
                <>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                    {['Order', 'Revenue', 'Cost', 'Margin', 'Margin %', 'Status'].map(h => (
                      <Typography key={h} variant="caption" color="text.secondary" fontWeight={600}>{h}</Typography>
                    ))}
                  </Box>
                  {orders.map((order) => {
                    const marginPct = Number(order.margin_pct);
                    const marginColor = marginPct >= 60 ? theme.palette.success.main : marginPct >= 40 ? theme.palette.warning.main : theme.palette.error.main;
                    return (
                      <Box key={order.order_id} sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', '&:hover': { bgcolor: 'action.hover' } }}>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{order.order_id.slice(0, 8).toUpperCase()}</Typography>
                        <Typography variant="body2">{fmt(Number(order.gross_revenue))}</Typography>
                        <Typography variant="body2">{fmt(Number(order.estimated_cost))}</Typography>
                        <Typography variant="body2">{fmt(Number(order.gross_margin))}</Typography>
                        <Typography variant="body2" fontWeight={600} sx={{ color: marginColor }}>{marginPct}%</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{order.fulfillment_status ?? '—'}</Typography>
                      </Box>
                    );
                  })}
                  {orders.length === 0 && (
                    <Box sx={{ py: 4, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary">No orders match this filter.</Typography>
                    </Box>
                  )}
                </>
              )}
            </Box>
          </>
        )}
      </Box>
    </FT2Layout>
  );
}