// apps/frontend/src/pages/ft2-pages/FinancesIntelligencePage.tsx
//
// Intelligence tab — daily financial pulse for SMB commerce owners.
// Signals: net margin pulse, cost coverage gap, refund leakage,
// blocked revenue at margin, negative margin SKU alert.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, LinearProgress, Chip } from '@mui/material';
import { AlertTriangle, TrendingDown, Lock, CheckCircle } from 'lucide-react';
import { FT2DateRangeBar, type FT2DateRange } from '@lasyncro/ui-ft2';
import { useFinancesIntelligence } from '../finances/useFinancesIntelligence';
import { useColorScheme, useTheme } from '@mui/material/styles';
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

function PulseCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: 'positive' | 'negative' | 'warning' | 'neutral';
}) {
  const pal = useIntelligenceTheme();
  const accentColor =
    accent === 'positive' ? '#22C55E' :
    accent === 'negative' ? '#EF4444' :
    accent === 'warning'  ? '#F59E0B' :
    pal.textPrimary;

  return (
    <Box sx={{ flex: 1, minWidth: 140, p: 2.5, background: pal.cardBg, border: `1px solid ${pal.border}`, borderRadius: 2 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 600, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.75 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 700, color: accentColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
        {value}
      </Typography>
      {sub && (
        <Typography sx={{ fontSize: 11, color: pal.textSecond, mt: 0.5 }}>{sub}</Typography>
      )}
    </Box>
  );
}

function SignalRow({ icon, title, detail, cta, onClick, severity }: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  cta?: string;
  onClick?: () => void;
  severity: 'critical' | 'warning' | 'ok';
}) {
  const theme = useTheme();
  const pal = useIntelligenceTheme();
  const borderColor =
    severity === 'critical' ? '#EF4444' :
    severity === 'warning'  ? '#F59E0B' :
    '#22C55E';

  return (
    <Box sx={{
      display: 'flex', alignItems: 'flex-start', gap: 2,
      p: 2, background: pal.cardBg,
      border: `1px solid ${pal.border}`,
      borderLeft: `3px solid ${borderColor}`,
      borderRadius: 2,
    }}>
      <Box sx={{ mt: 0.25, color: borderColor, flexShrink: 0 }}>{icon}</Box>
      <Box sx={{ flex: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: pal.textPrimary }}>{title}</Typography>
        <Typography sx={{ fontSize: 12, color: pal.textSecond, mt: 0.25 }}>{detail}</Typography>
      </Box>
      {cta && onClick && (
        <Box
          onClick={onClick}
          sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 12, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', flexShrink: 0, mt: 0.25, '&:hover': { opacity: 0.88 } }}
        >
          {cta} →
        </Box>
      )}
    </Box>
  );
}

export default function FinancesIntelligencePage() {
  const theme = useTheme();
  const [range, setRange] = useState<FT2DateRange>({ preset: 'past_30_days', from: null, to: null });
  const intelligenceQuery = useFinancesIntelligence();
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();
  const pal = useIntelligenceTheme();
  const navigate = useNavigate();

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

  return (
    <Box sx={{ background: pal.pageBg, minHeight: '100%' }}>
      <FT2DateRangeBar value={range} onChange={setRange} />

      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box>
          <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }}>
            Finances
          </Typography>
        </Box>

        {/* ZONE 1 — NET MARGIN PULSE */}
        <Box>
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1.5 }}>
            Financial Pulse
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <PulseCard
              label="Net Margin"
              value={`${netMarginPct}%`}
              sub={`${fmt(d.netMargin)} after refunds`}
              accent={netMarginPct >= 40 ? 'positive' : netMarginPct >= 20 ? 'warning' : 'negative'}
            />
            <PulseCard label="Gross Revenue"   value={fmt(d.totalRevenue)}  accent="neutral" />
            <PulseCard label="Total Cost"       value={fmt(d.totalCost)}     accent="neutral" />
            <PulseCard label="Refund Leakage"   value={fmt(d.totalRefunds)}
              sub="revenue lost to returns"
              accent={d.totalRefunds > 0 ? 'warning' : 'positive'}
            />
            <PulseCard label="Avg Gross Margin" value={`${d.avgMarginPct}%`} accent="neutral" />
          </Box>
        </Box>

        {/* ZONE 2 — COST COVERAGE */}
        <Box>
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1.5 }}>
            Cost Coverage
          </Typography>
          <Box sx={{ p: 2.5, background: pal.cardBg, border: `1px solid ${pal.border}`, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: pal.textPrimary }}>
                {coveragePct}% of SKUs have cost entered
              </Typography>
              <Chip
                label={missingCosts > 0 ? `${missingCosts} missing` : 'Complete'}
                size="small"
                sx={{
                  bgcolor: missingCosts > 0 ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)',
                  color: missingCosts > 0 ? '#F59E0B' : '#22C55E',
                  fontWeight: 700, fontSize: 11,
                }}
              />
            </Box>
            <LinearProgress
              variant="determinate"
              value={coveragePct}
              sx={{
                height: 6, borderRadius: 3,
                bgcolor: pal.tileBg,
                '& .MuiLinearProgress-bar': {
                  bgcolor: coveragePct === 100 ? '#22C55E' : coveragePct >= 70 ? '#F59E0B' : '#EF4444',
                  borderRadius: 3,
                },
              }}
            />
            {missingCosts > 0 && (
              <Box
                onClick={() => navigate('/inventory/costs')}
                sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 12, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', mt: 1, '&:hover': { opacity: 0.88 } }}
              >
                Enter missing costs to unlock full margin intelligence →
              </Box>
            )}
          </Box>
        </Box>

        {/* ZONE 3 — ACTIONABLE SIGNALS */}
        <Box>
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1.5 }}>
            Signals
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>

            {/* Negative margin orders */}
            {d.negativemarginOrders > 0 && (
              <SignalRow
                severity="critical"
                icon={<TrendingDown size={16} />}
                title={`${d.negativemarginOrders} orders with negative margin`}
                detail="You are losing money on these orders. Review SKU costs or pricing."
                cta="Review in Margin"
                onClick={() => navigate('/finances/margin')}
              />
            )}

            {/* Refund leakage */}
            {d.totalRefunds > 0 && (
              <SignalRow
                severity="warning"
                icon={<AlertTriangle size={16} />}
                title={`${fmt(d.totalRefunds)} lost to refunds`}
                detail="Refund leakage is reducing your net margin. Review return patterns."
                cta="View Margin"
                onClick={() => navigate('/finances/margin')}
              />
            )}

            {/* Blocked revenue at margin */}
            {d.blockedRevenue != null && d.blockedMarginValue != null && (
              <SignalRow
                severity="warning"
                icon={<Lock size={16} />}
                title={`${fmt(d.blockedMarginValue)} gross profit trapped in ${d.constrainedOrders} blocked orders`}
                detail={`${fmt(d.blockedRevenue)} blocked at ${d.avgMarginPct}% avg margin — resolve constraints to unlock.`}
                cta="Unblock Orders"
                onClick={() => navigate('/orders')}
              />
            )}

            {/* Carrier shipping spend */}
            {d.totalShippingCost != null && d.totalShippingCost > 0 && (
              <SignalRow
                severity="warning"
                icon={<TrendingDown size={16} />}
                title={`${fmt(d.totalShippingCost)} spent on carrier labels`}
                detail="Shipping cost deducted from gross margin. True margin shown in Margin tab."
                cta="View True Margin"
                onClick={() => navigate('/finances/margin')}
              />
            )}
            {/* Missing costs */}
            {missingCosts > 0 && (
              <SignalRow
                severity="warning"
                icon={<AlertTriangle size={16} />}
                title={`${missingCosts} SKUs missing cost data`}
                detail="Margin calculations are incomplete. Enter costs to get accurate net margin."
                cta="Fix in Products"
                onClick={() => navigate('/inventory/costs')}
              />
            )}

            {/* All clear */}
            {d.negativemarginOrders === 0 && d.totalRefunds === 0 && missingCosts === 0 && (
              <SignalRow
                severity="ok"
                icon={<CheckCircle size={16} />}
                title="Finances look healthy"
                detail="No negative margin orders, no refund leakage, all costs entered."
              />
            )}
          </Box>
        </Box>

      </Box>
    </Box>
  );
}