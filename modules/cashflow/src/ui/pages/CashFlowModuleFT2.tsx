// modules/cashflow/src/ui/pages/CashFlowModuleFT2.tsx
import { useState } from 'react';
import { ModuleErrorBoundary, ModuleLoadingSkeleton } from '@lasyncro/shared/ui';
import {
  Box, Typography, useTheme,
  TextField, Button, Collapse,
} from '@mui/material';
import { useColorScheme, alpha } from '@mui/material/styles';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  TrendingUp, ArrowRight, Truck,
} from 'lucide-react';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
export type CashFlowSummary = {
  realized_revenue: number;
  pending_revenue: number;
  at_risk_revenue: number;
  total_refunded: number;
  inventory_value: number;
  net_cash_position: number;
  working_capital_locked: number;
};

export type CashFlowBucket = {
  label: string;
  orders: number;
  revenue: number;
  description: string;
};

export type CashFlowByConstraint = {
  constraint_type: string;
  orders: number;
  revenue_blocked: number;
};

export type PoOutflow = {
  supplier_name: string;
  po_id: string;
  expected_delivery_date: string | null;
  total_cost: number;
  status: string;
};

export type CashFlowSettings = {
  monthly_overhead_amount: number | null;
  starting_cash_balance: number | null;
  starting_cash_balance_set_at: string | null;
};

export type ProjectionPoint = {
  week: string;
  conservative: number;
  base: number;
  optimistic: number;
};

export type GrossProfit = {
  gross_revenue: number;
  total_cogs: number;
  gross_profit: number;
  gross_margin_pct: number | null;
};

export type CashFlowData = {
  summary: CashFlowSummary;
  gross_profit: GrossProfit;
  buckets: CashFlowBucket[];
  by_constraint: CashFlowByConstraint[];
  po_outflows: PoOutflow[];
  projection_60d: ProjectionPoint[];
  computed_at: string;
} | null;

export type CashFlowModuleFT2Props = {
  data: CashFlowData;
  isLoading: boolean;
  isError: boolean;
  currency?: CurrencyContext;
  settings?: CashFlowSettings | null;
  onSaveSettings?: (updates: { monthly_overhead_amount?: number; starting_cash_balance?: number }) => Promise<void>;
};

// ─────────────────────────────────────────────
// THEME HOOK
// ─────────────────────────────────────────────
function useCashFlowTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return {
    isDark,
    cardBg:      isDark ? '#1C2740' : '#FFFFFF',
    border:      isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)',
    textPrimary: isDark ? '#F0EEE8' : '#0F0E0D',
    textSecond:  isDark ? '#8B8F9A' : '#6B7280',
    tileBg:      isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    gridColor:   isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
  };
}

// ─────────────────────────────────────────────
// CUSTOM TOOLTIP
// ─────────────────────────────────────────────
function ProjectionTooltip({ active, payload, label, fmt }: any) {
  const pal = useCashFlowTheme();
  if (!active || !payload?.length) return null;
  const date = new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <Box sx={{
      background: pal.cardBg, border: `1px solid ${pal.border}`,
      borderRadius: '8px', p: 1.5, minWidth: 160,
    }}>
      <Typography sx={{ fontSize: 11, color: pal.textSecond, mb: 1 }}>{date}</Typography>
      {payload.map((entry: any) => (
        <Box key={entry.name} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 0.25 }}>
          <Typography sx={{ fontSize: 11, color: entry.color }}>{entry.name}</Typography>
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: entry.color }}>
            {entry.value >= 0 ? '+' : ''}{fmt(entry.value)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

// ─────────────────────────────────────────────
// METRIC TILE
// ─────────────────────────────────────────────
function MetricTile({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: 'positive' | 'negative' | 'warning' | 'neutral';
}) {
  const theme = useTheme();
  const pal = useCashFlowTheme();
  const color = tone === 'positive' ? theme.palette.success.main
    : tone === 'negative' ? theme.palette.error.main
    : tone === 'warning' ? theme.palette.warning.main
    : pal.textPrimary;

  return (
    <Box sx={{ background: pal.tileBg, borderRadius: '6px', p: '0.6rem 0.75rem', flex: 1, minWidth: 0 }}>
      <Typography sx={{ fontSize: 16, fontWeight: 600, color, lineHeight: 1.2 }}>{value}</Typography>
      <Typography sx={{ fontSize: 10, color: pal.textSecond, mt: '2px' }}>{label}</Typography>
      {sub && <Typography sx={{ fontSize: 10, color, mt: '1px' }}>{sub}</Typography>}
    </Box>
  );
}

// ─────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────
function CashFlowModuleFT2Inner({
  data, 
  isLoading, 
  isError, 
  currency, 
  settings, 
  onSaveSettings 
}: CashFlowModuleFT2Props) {
  const theme = useTheme();
  const pal = useCashFlowTheme();
  const [activeScenario, setActiveScenario] = useState<'all' | 'base'>('all');
  const [whatIfOpen, setWhatIfOpen] = useState(false);
  const [whatIfAmount, setWhatIfAmount] = useState('');
  const [whatIfDate, setWhatIfDate] = useState('');

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [overheadInput, setOverheadInput] = useState('');
  const [balanceInput, setBalanceInput] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);

  const fmt = (n: number) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  const summary = data?.summary;
  const gp = data?.gross_profit;
  const projection = data?.projection_60d ?? [];
  const poOutflows = data?.po_outflows ?? [];
  const byConstraint = data?.by_constraint ?? [];

  const totalPoCommitments = poOutflows.reduce((s, p) => s + p.total_cost, 0);
  const atRiskRevenue = summary?.at_risk_revenue ?? 0;

  // Chart data — format week label
  const chartData = projection.map(p => ({
    ...p,
    label: new Date(p.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

  // WHAT-IF OVERLAY
  // Subtract hypothetical PO cost from all projection points after the delivery date
  const whatIfImpact = Number(whatIfAmount) || 0;
  const whatIfChartData = chartData.map(p => {
    if (!whatIfOpen || whatIfImpact === 0) return p;
    const pointDate = new Date(p.week);
    const deliveryDate = whatIfDate ? new Date(whatIfDate) : null;
    if (deliveryDate && pointDate < deliveryDate) return p;
    return {
      ...p,
      conservative: p.conservative - whatIfImpact,
      base: p.base - whatIfImpact,
      optimistic: p.optimistic - whatIfImpact,
    };
  });

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>

      {/* ── PO IMPACT CALCULATOR ── */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <Button
          size="small"
          variant={whatIfOpen ? 'contained' : 'outlined'}
          onClick={() => { setWhatIfOpen(v => !v); setWhatIfAmount(''); setWhatIfDate(''); }}
          sx={{
            fontSize: 12, borderRadius: '8px',
            bgcolor: whatIfOpen ? 'var(--accent)' : 'transparent',
            borderColor: 'var(--accent)',
            color: whatIfOpen ? '#fff' : 'var(--accent)',
            '&:hover': { bgcolor: whatIfOpen ? 'var(--accent-hover)' : 'var(--accent-ghost)' },
          }}
        >
          {whatIfOpen ? '✕ Close' : '＋ Plan a new order'}
        </Button>
      </Box>

      <Collapse in={whatIfOpen}>
        <Box sx={{
          mb: 2, p: '1rem 1.25rem',
          background: 'var(--accent-ghost)',
          border: '1px solid var(--accent-border)',
          borderRadius: '12px',
        }}>
          {/* HEADER */}
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', mb: '4px' }}>
            Plan a new stock order
          </Typography>
          <Typography sx={{ fontSize: 11, color: pal.textSecond, mb: '1rem' }}>
            Enter your order details below to see how it affects your cash over the next 60 days.
          </Typography>

          {/* INPUTS */}
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <TextField
              size="small"
              label="Total cost of order"
              placeholder="e.g. 5000"
              type="number"
              value={whatIfAmount}
              onChange={e => setWhatIfAmount(e.target.value)}
              sx={{ width: 180 }}
              inputProps={{ min: 0 }}
              helperText="How much you'll pay the supplier"
            />
            <TextField
              size="small"
              label="Payment due date"
              type="date"
              value={whatIfDate}
              onChange={e => setWhatIfDate(e.target.value)}
              sx={{ width: 180 }}
              InputLabelProps={{ shrink: true }}
              helperText="When the payment leaves your account"
            />
          </Box>

          {/* RESULT */}
          {whatIfImpact > 0 && (() => {
            const lowestPoint = whatIfChartData.reduce((min, p) =>
              p.base < min.base ? p : min, whatIfChartData[0]);
            const goesNegative = whatIfChartData.some(p => p.base < 0);
            return (
              <Box sx={{
                mt: '1rem', p: '0.75rem 1rem',
                bgcolor: goesNegative ? 'rgba(220,38,38,0.08)' : 'rgba(22,163,74,0.08)',
                border: `1px solid ${goesNegative ? '#DC2626' : '#16A34A'}`,
                borderRadius: '8px',
              }}>
                <Typography sx={{
                  fontSize: 13, fontWeight: 700,
                  color: goesNegative ? '#DC2626' : '#16A34A',
                  mb: '2px',
                }}>
                  {goesNegative
                    ? '⚠ This order may put you in the red'
                    : '✓ You can afford this order'}
                </Typography>
                <Typography sx={{ fontSize: 11, color: pal.textSecond }}>
                  {goesNegative
                    ? `Your lowest cash point would be ${fmt(lowestPoint?.base ?? 0)} around ${lowestPoint ? new Date(lowestPoint.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}. Consider waiting or splitting the order.`
                    : `Your cash stays above zero. Lowest point: ${fmt(lowestPoint?.base ?? 0)} around ${lowestPoint ? new Date(lowestPoint.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}.`
                  }
                </Typography>
                <Typography sx={{ fontSize: 10, color: pal.textSecond, mt: '4px', opacity: 0.7 }}>
                  Based on your order revenue only — does not include rent, salaries, or other fixed costs.
                </Typography>
              </Box>
            );
          })()}
        </Box>
      </Collapse>

      {/* ── OVERHEAD SETTINGS ── */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <Button
          size="small"
          variant="text"
          onClick={() => {
            setSettingsOpen(v => !v);
            setOverheadInput(String(settings?.monthly_overhead_amount ?? ''));
            setBalanceInput(String(settings?.starting_cash_balance ?? ''));
          }}
          sx={{ fontSize: 11, color: pal.textSecond }}
        >
          ⚙ Adjust for your costs
        </Button>
      </Box>

      <Collapse in={settingsOpen}>
        <Box sx={{
          mb: 2, p: '1rem 1.25rem',
          background: pal.tileBg,
          border: `0.5px solid ${pal.border}`,
          borderRadius: '12px',
        }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: pal.textPrimary, mb: '4px' }}>
            Make this projection more accurate
          </Typography>
          <Typography sx={{ fontSize: 11, color: pal.textSecond, mb: '1rem' }}>
            Add your fixed monthly costs and current bank balance. This stays private and only affects your chart.
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <TextField
              size="small"
              label="Monthly fixed costs"
              placeholder="e.g. 5000"
              type="number"
              value={overheadInput}
              onChange={e => setOverheadInput(e.target.value)}
              sx={{ width: 200 }}
              inputProps={{ min: 0 }}
              helperText="Rent, salaries, subscriptions"
            />
            <TextField
              size="small"
              label="Current bank balance"
              placeholder="e.g. 25000"
              type="number"
              value={balanceInput}
              onChange={e => setBalanceInput(e.target.value)}
              sx={{ width: 200 }}
              helperText="Your cash today"
            />
            <Button
              size="small"
              variant="contained"
              disabled={settingsSaving}
              onClick={async () => {
                if (!onSaveSettings) return;
                setSettingsSaving(true);
                try {
                  await onSaveSettings({
                    ...(overheadInput !== '' ? { monthly_overhead_amount: Number(overheadInput) } : {}),
                    ...(balanceInput !== '' ? { starting_cash_balance: Number(balanceInput) } : {}),
                  });
                  setSettingsOpen(false);
                } finally {
                  setSettingsSaving(false);
                }
              }}
              sx={{
                bgcolor: 'var(--accent)', color: '#fff',
                '&:hover': { bgcolor: 'var(--accent-hover)' },
                borderRadius: '8px', mb: '20px',
              }}
            >
              {settingsSaving ? 'Saving…' : 'Save'}
            </Button>
          </Box>
          {settings?.monthly_overhead_amount && (
            <Typography sx={{ fontSize: 10, color: pal.textSecond, mt: '4px' }}>
              Currently deducting {fmt(settings.monthly_overhead_amount / 4.33)}/week from projection
              {settings.starting_cash_balance ? ` · Starting balance: ${fmt(settings.starting_cash_balance)}` : ''}
            </Typography>
          )}
        </Box>
      </Collapse>

      {/* ── ZONE 1: 60-DAY PROJECTION ── */}
      <Box sx={{ background: pal.cardBg, border: `0.5px solid ${pal.border}`, borderRadius: '12px', overflow: 'hidden', mb: 2 }}>
        <Box sx={{ p: '1rem 1.25rem', borderBottom: `0.5px solid ${pal.border}` }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '4px' }}>
            <Typography sx={{ fontSize: 10, fontWeight: 500, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              60-Day Cash Projection
            </Typography>
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              {[
                { key: '#DC2626', label: 'Conservative' },
                { key: '#2563EB', label: 'Base' },
                { key: '#16A34A', label: 'Optimistic' },
              ].map(({ key, label }) => (
                <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Box sx={{ width: 12, height: 2, background: key, borderRadius: 1 }} />
                  <Typography sx={{ fontSize: 10, color: pal.textSecond }}>{label}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
          <Typography sx={{ fontSize: 12, color: pal.textSecond }}>
            Projected cumulative cash change from today — based on current velocity and known PO commitments.
          </Typography>
        </Box>

        <Box sx={{ p: '1rem 0.5rem 0.5rem' }}>
          {isLoading ? (
            <ModuleLoadingSkeleton rows={3} height={32} />
          ) : chartData.length === 0 ? (
            <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ fontSize: 13, color: pal.textSecond }}>Not enough data for projection.</Typography>
            </Box>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={whatIfChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={pal.gridColor} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: pal.textSecond }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: pal.textSecond }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => fmt(v)}
                />
                <Tooltip content={<ProjectionTooltip fmt={fmt} />} />
                <ReferenceLine y={0} stroke={pal.border} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="conservative" name="Conservative" stroke="#DC2626" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="base" name="Base" stroke="#2563EB" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="optimistic" name="Optimistic" stroke="#16A34A" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                {whatIfOpen && whatIfImpact > 0 && (
                  <>
                    <Line type="monotone" dataKey="base" name="Base (with PO)" stroke="#FF6B2B" strokeWidth={2} dot={false} strokeDasharray="6 3" />
                  </>
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </Box>
      </Box>

      {/* ── ZONE 2: GROSS PROFIT ── */}
      {gp && (
        <Box sx={{ background: pal.cardBg, border: `0.5px solid ${pal.border}`, borderRadius: '12px', overflow: 'hidden', mb: 2 }}>
          <Box sx={{ p: '0.75rem 1.25rem', borderBottom: `0.5px solid ${pal.border}` }}>
            <Typography sx={{ fontSize: 10, fontWeight: 500, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Gross Profit Reality
            </Typography>
          </Box>
          <Box sx={{ p: '0.85rem 1.25rem', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <MetricTile label="Gross Revenue" value={fmt(gp.gross_revenue)} tone="neutral" />
            <MetricTile label="Cost of Goods" value={`−${fmt(gp.total_cogs)}`} tone="negative" />
            <MetricTile
              label="Gross Profit"
              value={fmt(gp.gross_profit)}
              sub={gp.gross_margin_pct != null ? `${gp.gross_margin_pct}% margin` : undefined}
              tone={gp.gross_margin_pct != null && gp.gross_margin_pct < 20 ? 'warning' : 'positive'}
            />
            <MetricTile label="Net Position" value={fmt(summary?.net_cash_position ?? 0)} tone="neutral" />
          </Box>
        </Box>
      )}

      {/* ── ZONE 3: ACTION IMPACT ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>

        {/* Blocked order release */}
        {atRiskRevenue > 0 && (
          <Box sx={{ background: pal.cardBg, border: `0.5px solid ${alpha(theme.palette.success.main, 0.3)}`, borderRadius: '12px', p: '0.85rem 1.25rem' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <TrendingUp size={14} color={theme.palette.success.main} />
              <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'success.main' }}>Release blocked orders</Typography>
            </Box>
            <Typography sx={{ fontSize: 20, fontWeight: 700, color: 'success.main' }}>+{fmt(atRiskRevenue)}</Typography>
            <Typography sx={{ fontSize: 11, color: pal.textSecond, mt: '2px' }}>
              {byConstraint.reduce((s, c) => s + c.orders, 0)} constrained orders — resolve to unblock revenue
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1, cursor: 'pointer' }}
              component="a" href="/orders?filter=blocked">
              <Typography sx={{ fontSize: 11, color: theme.palette.primary.main, fontWeight: 500 }}>Review blocked orders</Typography>
              <ArrowRight size={11} color={theme.palette.primary.main} />
            </Box>
          </Box>
        )}

        {/* PO commitments */}
        <Box sx={{ background: pal.cardBg, border: `0.5px solid ${pal.border}`, borderRadius: '12px', p: '0.85rem 1.25rem' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Truck size={14} color={theme.palette.warning.main} />
            <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'warning.main' }}>Upcoming PO commitments</Typography>
          </Box>
          {totalPoCommitments > 0 ? (
            <>
              <Typography sx={{ fontSize: 20, fontWeight: 700, color: 'warning.main' }}>−{fmt(totalPoCommitments)}</Typography>
              <Typography sx={{ fontSize: 11, color: pal.textSecond, mt: '2px', mb: 1 }}>
                {poOutflows.length} open PO{poOutflows.length > 1 ? 's' : ''} — upcoming cash outflows
              </Typography>
              {poOutflows.slice(0, 3).map(p => (
                <Box key={p.po_id} sx={{ display: 'flex', justifyContent: 'space-between', py: '3px', borderTop: `0.5px solid ${pal.border}` }}>
                  <Typography sx={{ fontSize: 11, color: pal.textPrimary }}>{p.supplier_name}</Typography>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'warning.main' }}>−{fmt(p.total_cost)}</Typography>
                    {p.expected_delivery_date && (
                      <Typography sx={{ fontSize: 10, color: pal.textSecond }}>
                        {new Date(p.expected_delivery_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}
              {poOutflows.length > 3 && (
                <Typography sx={{ fontSize: 10, color: pal.textSecond, mt: 0.5 }}>
                  +{poOutflows.length - 3} more POs
                </Typography>
              )}
            </>
          ) : (
            <Typography sx={{ fontSize: 13, color: pal.textSecond }}>No open PO commitments.</Typography>
          )}
        </Box>
      </Box>

      {/* ── ZONE 4: CURRENT SNAPSHOT ── */}
      {summary && (
        <Box sx={{ background: pal.cardBg, border: `0.5px solid ${pal.border}`, borderRadius: '12px', overflow: 'hidden' }}>
          <Box sx={{ p: '0.75rem 1.25rem', borderBottom: `0.5px solid ${pal.border}` }}>
            <Typography sx={{ fontSize: 10, fontWeight: 500, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Current Snapshot
            </Typography>
          </Box>
          <Box sx={{ p: '0.85rem 1.25rem', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <MetricTile label="Realized" value={fmt(summary.realized_revenue)} tone="positive" />
            <MetricTile label="Pending" value={fmt(summary.pending_revenue)} tone="neutral" />
            <MetricTile label="At Risk" value={fmt(summary.at_risk_revenue)} tone={summary.at_risk_revenue > 0 ? 'warning' : 'neutral'} />
            <MetricTile label="Refunded" value={fmt(summary.total_refunded)} tone="negative" />
            <MetricTile label="Inventory" value={fmt(summary.inventory_value)} tone="neutral" />
            <MetricTile label="Working Capital" value={fmt(summary.working_capital_locked)} tone="neutral" />
          </Box>
        </Box>
      )}

      {isLoading && !data && <ModuleLoadingSkeleton />}

    </Box>
  );
}

export default function CashFlowModuleFT2(props: CashFlowModuleFT2Props) {
  return (
    <ModuleErrorBoundary moduleName="cashflow">
      <CashFlowModuleFT2Inner {...props} />
    </ModuleErrorBoundary>
  );
}