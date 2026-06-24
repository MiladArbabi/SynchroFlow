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
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
export type CashFlowComparison = {
  period: { from: string; to: string };
  prior:  { from: string; to: string };
  prior_totals: {
    realized_revenue: number;
    pending_revenue:  number;
    total_refunded:   number;
  };
  delta: {
    realized_pct: number | null;
    pending_pct:  number | null;
    refunds_pct:  number | null;
  };
};

export type CashFlowSummary = {
  realized_revenue: number;
  pending_revenue: number;
  at_risk_revenue: number;
  total_refunded: number;
  inventory_value: number;
  net_cash_position: number;
  working_capital_locked: number;
  // UX-sweep 2026-06-23: days of cash at current burn (null when cash positive).
  runway_days: number | null;
  comparison: CashFlowComparison | null;
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
};

function PulseRow({ label, value, delta, sub, valueColor }: {
  label: string; value: string; delta?: number | null; sub?: string; valueColor?: string;
}) {
  const deltaColor =
    delta == null ? 'var(--ink-4)' :
    delta > 0     ? '#22C55E' :
    delta < 0     ? '#EF4444' : 'var(--ink-4)';
  const deltaText = delta == null ? '' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', py: 1.25 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>{label}</Typography>
        {sub && <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }}>{sub}</Typography>}
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0, ml: 2 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: valueColor ?? 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
        {delta != null && (
          <Typography sx={{ fontSize: 11, color: deltaColor, mt: 0.25, fontVariantNumeric: 'tabular-nums' }}>
            {deltaText} vs prior
          </Typography>
        )}
      </Box>
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
  const [whatIfAmount, setWhatIfAmount] = useState('');
  const [whatIfDate, setWhatIfDate] = useState('');
  // UX-sweep 2026-06-24: PO list decision-group reveal (4 visible + "See X more").
  // Follows modules-ux-playbook §Decision Group Reveal Pattern.
  const [poExpanded, setPoExpanded] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [overheadInput, setOverheadInput] = useState('');
  const [balanceInput, setBalanceInput] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);

  const fmt = (n: number) => formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  const summary = data?.summary;
  const gp = data?.gross_profit;
  const projection = data?.projection_60d ?? [];
  const poOutflows = data?.po_outflows ?? [];
  const PO_PREVIEW_LIMIT = 3;
  const visiblePos = poOutflows.slice(0, PO_PREVIEW_LIMIT);
  const hiddenPos  = poOutflows.slice(PO_PREVIEW_LIMIT);
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
  // UX-sweep 2026-06-24: form is always visible now; gate solely on impact > 0.
  const whatIfChartData = chartData.map(p => {
    if (whatIfImpact === 0) return p;
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

  // UX-sweep 2026-06-23: derive headline + triage signals.
  const runwayDays = summary?.runway_days ?? null;
  const netPosition = summary?.net_cash_position ?? 0;
  const comparison = summary?.comparison ?? null;
  const realizedDelta = comparison?.delta?.realized_pct ?? null;
  const refundsDelta = comparison?.delta?.refunds_pct ?? null;

  // Overdue POs = expected_delivery_date in the past (FIN-10 semantics).
  const now = new Date();
  const overduePos = poOutflows.filter(p =>
    p.expected_delivery_date && new Date(p.expected_delivery_date) < now
  );
  const overdueValue = overduePos.reduce((s, p) => s + p.total_cost, 0);

  // Projection cross — first week where base goes negative.
  const negativeCrossover = chartData.find(p => p.base < 0);

  // Triage flags.
  const hasRunwayConcern = runwayDays != null && runwayDays < 30;
  const hasOverduePos = overduePos.length > 0;
  const hasNegativeCross = !!negativeCrossover;
  const hasRefundLeakage = (summary?.total_refunded ?? 0) > 0;
  const allClear = !hasRunwayConcern && !hasOverduePos && !hasNegativeCross;

  // Headline copy.
  const headline =
    runwayDays == null ? 'Cash positive — no runway concern'
    : runwayDays >= 90 ? `${runwayDays} days of cash at current burn — comfortable`
    : runwayDays >= 30 ? `${runwayDays} days of cash at current burn — watch your spending`
    :                    `${runwayDays} days of cash at current burn — act now`;


      return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      {/* HEADLINE — answers "Will I survive the next 60 days?"
          UX-sweep 2026-06-24: triage card removed. Alerts inline as
          colored chips below the subline — no empty pulse-gap, no scroll. */}
      <Box sx={{ mb: 2.5 }}>
        <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2, mb: 0.5 }}>
          {headline}
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          {fmt(netPosition)} on hand{overdueValue > 0 ? ` · ${fmt(overdueValue)} of POs overdue` : ''}{poOutflows.length > 0 ? ` · ${poOutflows.length} open PO${poOutflows.length === 1 ? '' : 's'} ${fmt(totalPoCommitments)} committed` : ''}
        </Typography>

        {/* Inline alert chips — replace the triage card. */}
        {(hasOverduePos || hasNegativeCross || atRiskRevenue > 0) && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
            {hasOverduePos && (
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: theme.palette.error.main, bgcolor: alpha(theme.palette.error.main, 0.08), border: `0.5px solid ${alpha(theme.palette.error.main, 0.3)}`, borderRadius: '6px' }}>
                <Truck size={12} strokeWidth={2} />
                {fmt(overdueValue)} overdue · {overduePos.length} PO{overduePos.length === 1 ? '' : 's'}
              </Box>
            )}
            {hasNegativeCross && negativeCrossover && (
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: theme.palette.warning.main, bgcolor: alpha(theme.palette.warning.main, 0.08), border: `0.5px solid ${alpha(theme.palette.warning.main, 0.3)}`, borderRadius: '6px' }}>
                <AlertTriangle size={12} strokeWidth={2} />
                Cash turns negative {new Date(negativeCrossover.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </Box>
            )}
            {atRiskRevenue > 0 && (
              <Box component="a" href="/orders?filter=blocked" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: theme.palette.success.main, bgcolor: alpha(theme.palette.success.main, 0.08), border: `0.5px solid ${alpha(theme.palette.success.main, 0.3)}`, borderRadius: '6px', textDecoration: 'none', cursor: 'pointer' }}>
                <TrendingUp size={12} strokeWidth={2} />
                +{fmt(atRiskRevenue)} unlockable from {byConstraint.reduce((s, c) => s + c.orders, 0)} blocked orders →
              </Box>
            )}
          </Box>
        )}
      </Box>

      {/* PO LIST + PULSE RAIL — canonical FT2 layout, no triage card. */}
      {summary && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.25, alignItems: 'start', mb: 2.5 }}>
          {/* LEFT — PO COMMITMENTS (was below, now beside pulse) */}
          <Box sx={{ flex: '1 0 300px', minWidth: 0, bgcolor: 'background.paper', border: '0.5px solid', borderColor: 'divider', borderRadius: '14px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
                  {visiblePos.map(p => (
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
                {hiddenPos.length > 0 && (
                  <>
                    <Collapse in={poExpanded} timeout={180} unmountOnExit>
                      {hiddenPos.map(p => (
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
                    </Collapse>
                    <Box
                      onClick={() => setPoExpanded(v => !v)}
                      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, py: 1.125, mt: 0.5, borderTop: '1px solid var(--rule)', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }}
                    >
                      <Typography sx={{ fontSize: 11, fontWeight: 500 }}>
                        {poExpanded ? 'Show less' : `See ${hiddenPos.length} more`}
                      </Typography>
                      {poExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </Box>
                  </>
                )}
                </>
              ) : (
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>No open PO commitments.</Typography>
              )}
            </Box>
          </Box>

          {/* RIGHT — Cash Pulse rail */}
          <Box sx={{ flex: '0 0 300px', bgcolor: 'background.paper', border: '0.5px solid', borderColor: 'divider', borderRadius: '14px', p: '18px 20px' }}>
            <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 0.5 }}>
              Cash pulse
            </Typography>
            <PulseRow label="Net Position"    value={fmt(netPosition)} valueColor={netPosition > 0 ? theme.palette.success.main : theme.palette.error.main} />
            <PulseRow label="Realized"        value={fmt(summary.realized_revenue)} delta={realizedDelta} />
            <PulseRow label="Pending"         value={fmt(summary.pending_revenue)} />
            <PulseRow label="Refunded"        value={fmt(summary.total_refunded)} delta={refundsDelta} valueColor={summary.total_refunded > 0 ? theme.palette.warning.main : undefined} />
            <PulseRow label="Working Capital" value={fmt(summary.working_capital_locked)} />
            <PulseRow label="Inventory"       value={fmt(summary.inventory_value)} />
          </Box>
        </Box>
      )}

      {/* 60-DAY PROJECTION CHART — full width below */}
      {/* CHART + PLAN ORDER — 2-column. Chart is the proof; plan-order
          sits beside as the action surface. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: 2, mb: 2.5 }}>
        {/* LEFT — 60-DAY PROJECTION CHART */}
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
                  <Line type="monotone" dataKey="conservative" name="Conservative" stroke="#DC2626" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  <Line type="monotone" dataKey="base"         name="Base"         stroke="#2563EB" strokeWidth={2}   dot={false} />
                  <Line type="monotone" dataKey="optimistic"   name="Optimistic"   stroke="#16A34A" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  {whatIfImpact > 0 && (
                    <Line type="monotone" dataKey="base" name="Base (with PO)" stroke="#FF6B2B" strokeWidth={2} dot={false} strokeDasharray="6 3" />
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </Box>
        </Box>

        {/* RIGHT — PLAN A NEW ORDER (always visible, beside chart).
            UX-sweep 2026-06-24: "⚙ Adjust" toggle is now inline here,
            revealing accent-tinted overhead/balance fields in the same card. */}
        <Box sx={{ bgcolor: 'background.paper', border: '0.5px solid', borderColor: 'divider', borderRadius: '12px', overflow: 'hidden', p: '1rem 1.25rem' }}>
          <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', mb: '4px' }}>
            Plan a new stock order
          </Typography>
          <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: '1rem' }}>
            See how a new PO shifts your 60-day outlook.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              size="small" label="Total cost" placeholder="e.g. 5000"
              type="number" value={whatIfAmount} onChange={e => setWhatIfAmount(e.target.value)}
              fullWidth inputProps={{ min: 0 }} helperText="Supplier payment"
            />
            <TextField
              size="small" label="Payment due date" type="date"
              value={whatIfDate} onChange={e => setWhatIfDate(e.target.value)}
              fullWidth InputLabelProps={{ shrink: true }}
            />
            {/* Inline Adjust toggle — reveals accent-tinted overhead/balance fields. */}
            <Box
              onClick={() => setSettingsOpen(v => !v)}
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, alignSelf: 'flex-start', cursor: 'pointer', color: 'var(--accent)', '&:hover': { opacity: 0.75 } }}
            >
              <Typography sx={{ fontSize: 11, fontWeight: 500 }}>
                {settingsOpen ? '− Hide fixed costs & balance' : '+ Adjust fixed costs & balance'}
              </Typography>
              {settingsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </Box>
            <Collapse in={settingsOpen} timeout={180} unmountOnExit>
              <Box sx={{
                display: 'flex', flexDirection: 'column', gap: 2,
                p: '0.875rem 1rem', mt: 0.5,
                bgcolor: 'var(--accent-ghost)',
                border: '0.5px solid var(--accent-border)',
                borderRadius: '8px',
              }}>
                <Typography sx={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500 }}>
                  Make projection more accurate
                </Typography>
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
                {settings?.monthly_overhead_amount && (
                  <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>
                    Deducting {fmt(settings.monthly_overhead_amount / 4.33)}/week from projection
                    {settings.starting_cash_balance ? ` · Starting balance: ${fmt(settings.starting_cash_balance)}` : ''}
                  </Typography>
                )}
              </Box>
            </Collapse>
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
                <Typography sx={{ fontSize: 12, fontWeight: 500, color: goesNegative ? 'error.main' : 'success.main', mb: '2px' }}>
                  {goesNegative ? '⚠ May put you in the red' : '✓ You can afford this'}
                </Typography>
                <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>
                  Low point: {fmt(lowestPoint?.base ?? 0)} around {lowestPoint ? new Date(lowestPoint.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                </Typography>
              </Box>
            );
          })()}
        </Box>
      </Box>

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