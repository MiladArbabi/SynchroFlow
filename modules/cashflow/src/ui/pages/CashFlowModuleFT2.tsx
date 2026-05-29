// modules/cashflow/src/ui/pages/CashFlowModuleFT2.tsx
import { useState } from 'react';
import { ModuleErrorBoundary, ModuleLoadingSkeleton } from '@lasyncro/shared/ui';
import {
  Box, Typography, useTheme, alpha,
  TextField, Button, Collapse,
} from '@mui/material';
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

// surface tokens → theme.palette.* and MUI sx shorthands throughout (no custom theme hook)

// ─────────────────────────────────────────────
// CUSTOM TOOLTIP
// ─────────────────────────────────────────────
function ProjectionTooltip({ active, payload, label, fmt }: any) {
  const theme = useTheme();
  if (!active || !payload?.length) return null;
  const date = new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <Box sx={{
      bgcolor: 'background.paper',
      border: '0.5px solid',
      borderColor: 'divider',
      borderRadius: '8px', p: 1.5, minWidth: 160,
    }}>
      <Typography sx={{ fontSize: 11, color: theme.palette.text.secondary, mb: 1 }}>{date}</Typography>
      {payload.map((entry: any) => (
        <Box key={entry.name} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 0.25 }}>
          <Typography sx={{ fontSize: 11, color: entry.color }}>{entry.name}</Typography>
          <Typography sx={{ fontSize: 11, fontWeight: 500, color: entry.color }}>
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
  const muiColor =
    tone === 'positive' ? 'success.main' :
    tone === 'negative' ? 'error.main'   :
    tone === 'warning'  ? 'warning.main' :
    'text.primary';

  return (
    <Box sx={{ bgcolor: 'background.paper', border: '0.5px solid', borderColor: 'divider', borderRadius: 2, p: 2.5, flex: 1, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary"
        sx={{ fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.75, display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="h5" fontWeight={500} color={muiColor} sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{value}</Typography>
      {sub && <Typography variant="caption" color={muiColor} sx={{ display: 'block', mt: 0.5 }}>{sub}</Typography>}
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
  onSaveSettings,
}: CashFlowModuleFT2Props) {
  const theme = useTheme();
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
        <Box>
          <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2, py: 2 }}>
            Cash Flow
          </Typography>
        </Box>

      {/* ── ROW 1: PRIMARY KPIs ── */}
      {summary && gp && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, mb: 1 }}>
          <MetricTile label="Net position"    value={fmt(summary.net_cash_position)}   tone="positive" />
          <MetricTile
            label="Gross profit"
            value={fmt(gp.gross_profit)}
            sub={gp.gross_margin_pct != null ? `${gp.gross_margin_pct}% margin` : undefined}
            tone={gp.gross_margin_pct != null && gp.gross_margin_pct < 20 ? 'warning' : 'positive'}
          />
          <MetricTile label="Working capital" value={fmt(summary.working_capital_locked)} tone="neutral" />
          <MetricTile label="Inventory value" value={fmt(summary.inventory_value)}      tone="neutral" />
        </Box>
      )}

      {/* ── ROW 2: SNAPSHOT STRIP ── */}
      {summary && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, mb: 2 }}>
          <MetricTile label="Realized"     value={fmt(summary.realized_revenue)}                                        tone="positive" />
          <MetricTile label="Pending"      value={fmt(summary.pending_revenue)}                                         tone="neutral" />
          <MetricTile label="At risk"      value={fmt(summary.at_risk_revenue)}  tone={summary.at_risk_revenue > 0 ? 'warning' : 'neutral'} />
          <MetricTile label="Refunded"     value={fmt(summary.total_refunded)}                                          tone="negative" />
          {gp && <MetricTile label="Cost of goods"  value={`−${fmt(gp.total_cogs)}`}   tone="negative" />}
          {gp && <MetricTile label="Gross revenue"  value={fmt(gp.gross_revenue)}       tone="neutral"  />}
        </Box>
      )}

      {/* ── BLOCKED ORDERS SIGNAL (conditional) ── */}
      {atRiskRevenue > 0 && (
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          mb: 2, p: '0.65rem 1.25rem',
          bgcolor: alpha(theme.palette.success.main, 0.06),
          border: '0.5px solid', borderColor: alpha(theme.palette.success.main, 0.25),
          borderRadius: '10px',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TrendingUp size={14} color={theme.palette.success.main} />
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              <Box component="span" sx={{ fontWeight: 500, color: 'success.main' }}>+{fmt(atRiskRevenue)}</Box>
              {' '}unlockable — {byConstraint.reduce((s, c) => s + c.orders, 0)} constrained orders blocking revenue
            </Typography>
          </Box>
          <Box component="a" href="/orders?filter=blocked"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', textDecoration: 'none' }}>
            <Typography sx={{ fontSize: 11, color: 'primary.main', fontWeight: 500 }}>Review blocked orders</Typography>
            <ArrowRight size={11} color={theme.palette.primary.main} />
          </Box>
        </Box>
      )}

      {/* ── TWO-COLUMN MAIN ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 3fr' }, gap: 2, alignItems: 'stretch' }}>

        {/* LEFT — PO COMMITMENTS */}
        <Box sx={{ bgcolor: 'background.paper', border: '0.5px solid', borderColor: 'divider', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ p: '0.75rem 1.25rem', borderBottom: '0.5px solid', borderBottomColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Truck size={13} color={theme.palette.warning.main} />
              <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Upcoming PO commitments
              </Typography>
            </Box>
          </Box>
          <Box sx={{ p: '0.85rem 1.25rem', flex: 1 }}>
            {totalPoCommitments > 0 ? (
              <>
                <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'warning.main' }}>−{fmt(totalPoCommitments)}</Typography>
                <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: '2px', mb: 1.5 }}>
                  {poOutflows.length} open PO{poOutflows.length > 1 ? 's' : ''} — upcoming cash outflows
                </Typography>
                {poOutflows.map(p => (
                  <Box key={p.po_id} sx={{ display: 'flex', justifyContent: 'space-between', py: '6px', borderTop: '0.5px solid', borderColor: 'divider' }}>
                    <Typography sx={{ fontSize: 12, color: 'text.primary' }}>{p.supplier_name}</Typography>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'warning.main' }}>−{fmt(p.total_cost)}</Typography>
                      {p.expected_delivery_date && (
                        <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>
                          {new Date(p.expected_delivery_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                ))}
              </>
            ) : (
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>No open PO commitments.</Typography>
            )}
          </Box>
          {/* Plan a new order — contextually placed in PO card footer */}
          <Box sx={{ p: '0.75rem 1.25rem', borderTop: '0.5px solid', borderTopColor: 'divider' }}>
             <Button
              size="small" fullWidth variant="outlined"
              onClick={() => { setWhatIfOpen(v => !v); setWhatIfAmount(''); setWhatIfDate(''); }}
              sx={{ fontSize: 12, borderRadius: '6px', borderColor: 'var(--accent)', color: 'var(--accent)',
                '&:hover': { borderColor: 'var(--accent)', bgcolor: 'var(--accent-ghost)' } }}
            >
              {whatIfOpen ? '✕ Cancel' : '+ Plan a new order'}
            </Button>
          </Box>
        </Box>

        {/* RIGHT — 60-DAY PROJECTION CHART */}
        <Box sx={{ bgcolor: 'background.paper', border: '0.5px solid', borderColor: 'divider', borderRadius: '12px', overflow: 'hidden' }}>
          <Box sx={{ p: '0.75rem 1.25rem', borderBottom: '0.5px solid', borderBottomColor: 'divider' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '4px' }}>
              <Typography sx={{ fontSize: 10, fontWeight: 500, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                60-Day Cash Projection
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                  {[
                    { stroke: '#DC2626', label: 'Conservative' },
                    { stroke: '#2563EB', label: 'Base' },
                    { stroke: '#16A34A', label: 'Optimistic' },
                  ].map(({ stroke, label }) => (
                    <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Box sx={{ width: 12, height: 2, background: stroke, borderRadius: 1 }} />
                      <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>{label}</Typography>
                    </Box>
                  ))}
                </Box>
                {/* Adjust for costs — subtle link in chart header */}
                <Button size="small" variant="text"
                  onClick={() => { setWhatIfOpen(v => !v); setWhatIfAmount(''); setWhatIfDate(''); }}
                  sx={{ fontSize: 10, color: 'text.secondary', minWidth: 0, p: '2px 6px' }}
                >
                  ⚙ Adjust
                </Button>
              </Box>
            </Box>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
              Projected cumulative cash change from today — based on current velocity and known PO commitments.
            </Typography>
          </Box>
          <Box sx={{ p: '1rem 0.5rem 0.5rem' }}>
            {isLoading ? (
              <ModuleLoadingSkeleton rows={3} height={32} />
            ) : chartData.length === 0 ? (
              <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Not enough data for projection.</Typography>
              </Box>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={whatIfChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: theme.palette.text.secondary }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: theme.palette.text.secondary }} axisLine={false} tickLine={false} tickFormatter={(v) => fmt(v)} />
                  <Tooltip content={<ProjectionTooltip fmt={fmt} />} />
                  <ReferenceLine y={0} stroke={theme.palette.divider} strokeDasharray="4 2" />
                  {/* FIN-10: recharts stroke must be a resolved color value, CSS vars unsupported */}
                  <Line type="monotone" dataKey="conservative" name="Conservative" stroke="#DC2626" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  <Line type="monotone" dataKey="base"         name="Base"         stroke="#2563EB" strokeWidth={2}   dot={false} />
                  <Line type="monotone" dataKey="optimistic"   name="Optimistic"   stroke="#16A34A" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  {whatIfOpen && whatIfImpact > 0 && (
                    <Line type="monotone" dataKey="base" name="Base (with PO)" stroke="#FF6B2B" strokeWidth={2} dot={false} strokeDasharray="6 3" />
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </Box>
        </Box>

      </Box>

      {/* ── PLAN ORDER + PROJECTION ACCURACY — merged two-column panel ── */}
      <Collapse in={whatIfOpen}>
        <Box sx={{ mt: 2, border: '0.5px solid var(--accent-border)', borderRadius: '12px', overflow: 'hidden' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 0 }}>

            {/* LEFT — Plan a new order */}
            <Box sx={{ p: '1rem 1.25rem', background: 'var(--accent-ghost)', borderRight: { md: '0.5px solid var(--accent-border)' } }}>
              <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)', mb: '4px' }}>
                Plan a new stock order
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: '1rem' }}>
                Enter order details to see how it shifts your 60-day cash outlook.
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  size="small" label="Total cost of order" placeholder="e.g. 5000"
                  type="number" value={whatIfAmount} onChange={e => setWhatIfAmount(e.target.value)}
                  fullWidth inputProps={{ min: 0 }} helperText="How much you'll pay the supplier"
                />
                <TextField
                  size="small" label="Payment due date" type="date"
                  value={whatIfDate} onChange={e => setWhatIfDate(e.target.value)}
                  fullWidth InputLabelProps={{ shrink: true }}
                  helperText="When the payment leaves your account"
                />
              </Box>
              {whatIfImpact > 0 && (() => {
                const lowestPoint = whatIfChartData.reduce((min, p) => p.base < min.base ? p : min, whatIfChartData[0]);
                const goesNegative = whatIfChartData.some(p => p.base < 0);
                return (
                  <Box sx={{
                    mt: '1rem', p: '0.75rem 1rem',
                    bgcolor: goesNegative ? alpha(theme.palette.error.main, 0.08) : alpha(theme.palette.success.main, 0.08),
                    border: '0.5px solid', borderColor: goesNegative ? 'error.main' : 'success.main',
                    borderRadius: '8px',
                  }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: goesNegative ? 'error.main' : 'success.main', mb: '2px' }}>
                      {goesNegative ? '⚠ This order may put you in the red' : '✓ You can afford this order'}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                      {goesNegative
                        ? `Lowest cash point: ${fmt(lowestPoint?.base ?? 0)} around ${lowestPoint ? new Date(lowestPoint.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}. Consider waiting or splitting.`
                        : `Cash stays above zero. Lowest point: ${fmt(lowestPoint?.base ?? 0)} around ${lowestPoint ? new Date(lowestPoint.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}.`
                      }
                    </Typography>
                    <Typography sx={{ fontSize: 10, color: 'text.secondary', mt: '4px', opacity: 0.7 }}>
                      Based on order revenue only — excludes rent, salaries, or other fixed costs.
                    </Typography>
                  </Box>
                );
              })()}
            </Box>

            {/* RIGHT — Projection accuracy */}
            <Box sx={{ p: '1rem 1.25rem', bgcolor: 'action.hover' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.primary', mb: '4px' }}>
                Make this projection more accurate
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: '1rem' }}>
                Add fixed monthly costs and your current bank balance. Stays private, only affects your chart.
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  size="small" label="Monthly fixed costs" placeholder="e.g. 5000"
                  type="number" value={overheadInput} onChange={e => setOverheadInput(e.target.value)}
                  fullWidth inputProps={{ min: 0 }} helperText="Rent, salaries, subscriptions"
                />
                <TextField
                  size="small" label="Current bank balance" placeholder="e.g. 25000"
                  type="number" value={balanceInput} onChange={e => setBalanceInput(e.target.value)}
                  fullWidth helperText="Your cash today"
                />
                <Button
                  size="small" variant="contained" disabled={settingsSaving}
                  onClick={async () => {
                    if (!onSaveSettings) return;
                    setSettingsSaving(true);
                    try {
                      await onSaveSettings({
                        ...(overheadInput !== '' ? { monthly_overhead_amount: Number(overheadInput) } : {}),
                        ...(balanceInput  !== '' ? { starting_cash_balance:   Number(balanceInput)  } : {}),
                      });
                    } finally { setSettingsSaving(false); }
                  }}
                  sx={{ bgcolor: 'var(--accent)', color: '#fff', '&:hover': { bgcolor: 'var(--accent-hover)' }, borderRadius: '8px', alignSelf: 'flex-start' }}
                >
                  {settingsSaving ? 'Saving…' : 'Save'}
                </Button>
              </Box>
              {settings?.monthly_overhead_amount && (
                <Typography sx={{ fontSize: 10, color: 'text.secondary', mt: '1rem' }}>
                  Deducting {fmt(settings.monthly_overhead_amount / 4.33)}/week from projection
                  {settings.starting_cash_balance ? ` · Starting balance: ${fmt(settings.starting_cash_balance)}` : ''}
                </Typography>
              )}
            </Box>

          </Box>
        </Box>
      </Collapse>

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