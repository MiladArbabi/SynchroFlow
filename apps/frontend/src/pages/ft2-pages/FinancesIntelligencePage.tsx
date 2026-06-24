// apps/frontend/src/pages/ft2-pages/FinancesIntelligencePage.tsx
//
// Intelligence — answers "How am I doing?" for SMB commerce owners.
// UX-sweep 2026-06-23: conformed to canonical FT2 triage + pulse layout
// (Overview/Orders/Inbound pattern). Five-`PulseCard` grid + standalone
// Cost-Coverage block + Signals header collapsed into:
//   (1) headline sentence with vs-prior delta
//   (2) "Needs a decision" triage card (left)
//   (3) Profit pulse rail with deltas (right)
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { AlertTriangle, TrendingDown, Lock, CheckCircle, Truck } from 'lucide-react';
import { FT2DateRangeBar, type FT2DateRange } from '@lasyncro/ui-ft2';
import { useFinancesIntelligence } from '../finances/useFinancesIntelligence';
import { useColorScheme } from '@mui/material/styles';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';

const __DEV__ = import.meta.env.DEV;

function useIntelligenceTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return {
    isDark,
    pageBg:      isDark ? '#151D29' : '#F8F9FA',
    cardBg:      isDark ? '#1C2740' : '#FFFFFF',
    border:      isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)',
    textPrimary: isDark ? '#F0EEE8' : '#0F0E0D',
    textSecond:  isDark ? '#8B8F9A' : '#6B7280',
    tileBg:      isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
  };
}

/** Maps FT2 preset to ISO date range for Intelligence API. */
function presetToRange(range: FT2DateRange): { from: string | null; to: string | null } {
  const now = new Date();
  const startOf = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
  switch (range.preset) {
    case 'today':         return { from: startOf(now).toISOString(),    to: now.toISOString() };
    case 'this_week':
    case 'past_7_days':   return { from: daysAgo(7).toISOString(),      to: now.toISOString() };
    case 'this_month':
    case 'past_30_days':  return { from: daysAgo(30).toISOString(),     to: now.toISOString() };
    case 'custom':        return { from: range.from ?? null,            to: range.to ?? null };
    default:              return { from: null, to: null }; // server default
  }
}

/** Canonical pulse-rail row (PulseRow pattern from Orders/Catalog). */
function PulseRow({ label, value, delta, sub, valueColor }: {
  label: string; value: string; delta?: number | null; sub?: string; valueColor?: string;
}) {
  const pal = useIntelligenceTheme();
  const deltaColor =
    delta == null ? pal.textSecond :
    delta > 0     ? '#22C55E' :
    delta < 0     ? '#EF4444' : pal.textSecond;
  const deltaText =
    delta == null ? '' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', py: 1.25 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 12, color: pal.textSecond }}>{label}</Typography>
        {sub && <Typography sx={{ fontSize: 11, color: pal.textSecond, mt: 0.25 }}>{sub}</Typography>}
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0, ml: 2 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: valueColor ?? pal.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Typography>
        {delta != null && (
          <Typography sx={{ fontSize: 11, color: deltaColor, mt: 0.25, fontVariantNumeric: 'tabular-nums' }}>
            {deltaText} vs prior
          </Typography>
        )}
      </Box>
    </Box>
  );
}

/** Triage row (canonical "Needs a decision" anatomy). */
function SignalRow({ icon, title, detail, cta, onClick, severity }: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  cta?: string;
  onClick?: () => void;
  severity: 'critical' | 'warning' | 'ok';
}) {
  const pal = useIntelligenceTheme();
  const sevColor =
    severity === 'critical' ? '#EF4444' :
    severity === 'warning'  ? '#F59E0B' :
                              '#22C55E';
  return (
    <Box sx={{
      display: 'flex', alignItems: 'flex-start', gap: 2,
      px: 2.5, py: 2,
      borderTop: `0.5px solid ${pal.border}`,
    }}>
      <Box sx={{ mt: 0.25, color: sevColor, flexShrink: 0 }}>{icon}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: pal.textPrimary }}>{title}</Typography>
        <Typography sx={{ fontSize: 11, color: pal.textSecond, mt: 0.25 }}>{detail}</Typography>
      </Box>
      {cta && onClick && (
        <Box
          onClick={onClick}
          sx={{
            display: 'inline-flex', alignItems: 'center',
            px: 1.25, py: 0.5,
            fontSize: 11, fontWeight: 600,
            color: 'var(--accent)',
            border: '0.5px solid var(--accent)',
            borderRadius: '6px',
            cursor: 'pointer', flexShrink: 0,
            '&:hover': { opacity: 0.75 },
          }}
        >
          {cta} →
        </Box>
      )}
    </Box>
  );
}

export default function FinancesIntelligencePage() {
  const navigate = useNavigate();
  const pal = useIntelligenceTheme();

  const [range, setRange] = useState<FT2DateRange>({ preset: 'past_30_days', from: null, to: null });
  const apiRange = presetToRange(range);
  const intelligenceQuery = useFinancesIntelligence(apiRange);
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();

  const currency: CurrencyContext = { displayCurrency, locale, rates };
  const fmt = (n: number) => formatCurrencyCompact(n, currency.displayCurrency, currency.locale, currency.rates);

  if (!intelligenceQuery.isSuccess) {
    if (__DEV__) console.debug('[FinancesIntelligencePage] awaiting intelligence data');
    return <Box sx={{ p: 4 }}><Typography color="text.secondary">Loading financial intelligence…</Typography></Box>;
  }

  const d = intelligenceQuery.data;
  const coveragePct = d.costCoverage.coveragePct ?? 0;
  const missingCosts = d.costCoverage.zeroCostCount;
  const netMarginPct = d.netMarginPct ?? 0;

  // FIN-01 (2026-06-23): honest margin headline. GROSS until carrier
  // cost is known, then TRUE (revenue − COGS − shipping).
  const hasCarrier = d.hasCarrierData === true && d.trueMarginPct != null;
  const marginLabel = hasCarrier ? 'True Margin' : 'Gross Margin';
  const marginPct = hasCarrier ? (d.trueMarginPct ?? 0) : netMarginPct;
  const marginValue = hasCarrier ? d.trueMargin : d.netMargin;

  // Period delta narrative — "How am I doing?".
  const c = d.comparison;
  const revenueDelta = c?.delta?.revenuePct ?? null;
  const marginDelta  = c?.delta?.netMarginPct ?? null;
  const refundsDelta = c?.delta?.refundsPct ?? null;
  const headlineDelta =
    marginDelta == null ? 'first period of activity' :
    marginDelta > 0     ? `↑ ${marginDelta.toFixed(1)}% vs prior period` :
    marginDelta < 0     ? `↓ ${Math.abs(marginDelta).toFixed(1)}% vs prior period` :
                          'flat vs prior period';

  // Triage signals — count to know if "all clear" footer shows.
  const hasNegMargin = d.negativemarginOrders > 0;
  const hasRefunds   = d.totalRefunds > 0;
  const hasBlocked   = d.blockedMarginValue != null && d.blockedMarginValue > 0 && d.constrainedOrders != null && d.constrainedOrders > 0;
  const hasShipping  = d.totalShippingCost != null && d.totalShippingCost > 0;
  const hasMissingCosts = missingCosts > 0;
  const allClear = !hasNegMargin && !hasRefunds && !hasBlocked && !hasMissingCosts;

  return (
    <Box sx={{ background: pal.pageBg, minHeight: '100%' }}>
      <FT2DateRangeBar value={range} onChange={setRange} />

      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* HEADLINE — answers "How am I doing?" in one sentence. */}
        <Box>
          <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2, mb: 0.5 }}>
            How am I doing?
          </Typography>
          <Typography sx={{ fontSize: 13, color: pal.textSecond, lineHeight: 1.5 }}>
            {fmt(marginValue ?? 0)} {marginLabel.toLowerCase()} · {marginPct}% · {headlineDelta}
          </Typography>
        </Box>

        {/* TRIAGE + PULSE — canonical FT2 layout (Overview/Orders pattern). */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.25, alignItems: 'start' }}>
          {/* LEFT: Needs a decision */}
          <Box sx={{ flex: '1 0 300px', minWidth: 0, bgcolor: pal.cardBg, border: `1px solid ${pal.border}`, borderRadius: '14px', overflow: 'hidden' }}>
            <Box sx={{ px: 2.5, py: 2 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 500, color: pal.textPrimary }}>Needs a decision</Typography>
              <Typography sx={{ fontSize: 11, color: pal.textSecond, mt: 0.25 }}>Ranked by margin impact</Typography>
            </Box>

            {hasNegMargin && (
              <SignalRow
                severity="critical"
                icon={<TrendingDown size={16} />}
                title={`${d.negativemarginOrders} orders selling at a loss`}
                detail="Cost exceeds revenue. Review SKU costs or pricing."
                cta="Review"
                onClick={() => navigate('/finances/margin')}
              />
            )}
            {hasRefunds && (
              <SignalRow
                severity="warning"
                icon={<AlertTriangle size={16} />}
                title={`${fmt(d.totalRefunds)} lost to refunds`}
                detail={`${((d.totalRefunds / Math.max(1, d.totalRevenue)) * 100).toFixed(1)}% of gross revenue${refundsDelta != null ? ` · ${refundsDelta > 0 ? '+' : ''}${refundsDelta.toFixed(1)}% vs prior` : ''}`}
                cta="View Margin"
                onClick={() => navigate('/finances/margin')}
              />
            )}
            {hasBlocked && (
              <SignalRow
                severity="warning"
                icon={<Lock size={16} />}
                title={`${fmt(d.blockedMarginValue!)} gross profit trapped in ${d.constrainedOrders} blocked orders`}
                detail={`${fmt(d.blockedRevenue ?? 0)} blocked at ${d.avgMarginPct}% avg margin`}
                cta="Unblock"
                onClick={() => navigate('/orders')}
              />
            )}
            {hasMissingCosts && (
              <SignalRow
                severity="warning"
                icon={<AlertTriangle size={16} />}
                title={`${missingCosts} SKUs missing cost data`}
                detail={`Margin coverage at ${coveragePct}%. Enter costs to unlock full intelligence.`}
                cta="Fix in Catalog"
                onClick={() => navigate('/inventory/catalog')}
              />
            )}
            {hasShipping && (
              <SignalRow
                severity="warning"
                icon={<Truck size={16} />}
                title={`${fmt(d.totalShippingCost!)} spent on carrier labels`}
                detail="Shipping deducted from gross margin. See true margin per order."
                cta="View Margin"
                onClick={() => navigate('/finances/margin')}
              />
            )}
            {allClear && (
              <SignalRow
                severity="ok"
                icon={<CheckCircle size={16} />}
                title="Finances look healthy"
                detail="No negative-margin orders, no refund leakage, all costs entered."
              />
            )}
          </Box>

          {/* RIGHT: Profit Pulse rail */}
          <Box sx={{ flex: '0 0 300px', bgcolor: pal.cardBg, border: `1px solid ${pal.border}`, borderRadius: '14px', p: '18px 20px' }}>
            <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: pal.textSecond, mb: 0.5 }}>
              Profit pulse
            </Typography>
            <PulseRow label="Gross Revenue"   value={fmt(d.totalRevenue)} delta={revenueDelta} />
            <PulseRow label={marginLabel}     value={fmt(marginValue ?? 0)} delta={marginDelta} sub={`${marginPct}%`} valueColor={marginPct >= 40 ? '#22C55E' : marginPct >= 20 ? '#F59E0B' : '#EF4444'} />
            <PulseRow label="Refund Leakage"  value={fmt(d.totalRefunds)} delta={refundsDelta} valueColor={d.totalRefunds > 0 ? '#F59E0B' : undefined} />
            <PulseRow label="Avg Gross Margin" value={`${d.avgMarginPct}%`} delta={c?.delta?.avgMarginPtDelta ?? null} />
            <PulseRow label="Cost Coverage"   value={`${coveragePct}%`} sub={`${d.costCoverage.totalVariants - missingCosts}/${d.costCoverage.totalVariants} SKUs costed`} valueColor={coveragePct === 100 ? '#22C55E' : coveragePct >= 70 ? '#F59E0B' : '#EF4444'} />
            <Box
              onClick={() => navigate('/finances/margin')}
              sx={{
                display: 'inline-flex', alignItems: 'center',
                mt: 1.5, px: 1.25, py: 0.5,
                fontSize: 11, fontWeight: 500,
                color: 'var(--accent)',
                border: '0.5px solid var(--accent)',
                borderRadius: '6px',
                cursor: 'pointer',
                '&:hover': { opacity: 0.75 },
              }}
            >
              View Margin →
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}