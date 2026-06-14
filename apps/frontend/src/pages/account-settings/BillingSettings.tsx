// apps/frontend/src/pages/account-settings/BillingSettings.tsx
//
// BILLING SETTINGS (UX-02)
// -------------------------
// Shows current tier, trial status, seat usage, upgrade options.
// Reads from GET /api/v1/billing/subscription.
// Stripe Portal for payment management.
// Annual savings callout (UX-08 — built together).

import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Chip, Button, Divider,
  Alert, CircularProgress, ToggleButton, ToggleButtonGroup,
  LinearProgress,
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { CheckCircle, Zap, ArrowRight, ExternalLink } from 'lucide-react';
import { axiosInstance } from '../../api/axiosConfig';
import { TIER_MONTHLY_ORDER_CAP, TIER_SHIPPED_ORDER_CAP, type Tier } from '../../config/tiers';
import { PEGGED_DISPLAY_PRICES, formatDisplayPrice, annualSavings, type BillingCurrency } from '../../config/pricingDisplay';
import { useEntitlements } from '../../contexts/EntitlementsContext';

// ─────────────────────────────────────────────
// TIER CONFIG (mirrors tiers.ts — display only)
// ─────────────────────────────────────────────
function buildTiers(currency: BillingCurrency) {
  return [
    {
      id: 'core' as const,
      label: 'Core',
      monthlyPrice: PEGGED_DISPLAY_PRICES.core[currency].monthly,
      annualPrice: PEGGED_DISPLAY_PRICES.core[currency].annual / 12,
      seats: '2 seats',
      orders: '2,000 orders/mo',
      highlight: false,
      features: ['WMS Lite', 'Returns', 'Products', 'Problem Center', '200 shipped orders/mo'],
    },
    {
      id: 'growth' as const,
      label: 'Growth',
      monthlyPrice: PEGGED_DISPLAY_PRICES.growth[currency].monthly,
      annualPrice: PEGGED_DISPLAY_PRICES.growth[currency].annual / 12,
      seats: '5 seats',
      orders: '10,000 orders/mo',
      highlight: true,
      features: ['Cash Flow', 'Customer LTV', 'Demand Forecasting', 'Specter', '1,000 shipped orders/mo'],
    },
    {
      id: 'scale' as const,
      label: 'Scale',
      monthlyPrice: PEGGED_DISPLAY_PRICES.scale[currency].monthly,
      annualPrice: PEGGED_DISPLAY_PRICES.scale[currency].annual / 12,
      seats: 'Unlimited seats',
      orders: 'Unlimited orders',
      highlight: false,
      features: ['Floor Planning', 'Barcodes', 'WMS Advanced', 'Unlimited shipped orders'],
    },
  ];
}

interface SubscriptionData {
  tier: string;
  status: string;
  billing_interval: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
}

interface UsageData {
  ingested_orders: number;
  shipped_orders: number;
  tier: string;
  period_starts_at: string | null;
}

// ─────────────────────────────────────────────
// TRIAL COUNTDOWN
// ─────────────────────────────────────────────
function TrialBadge({ trialEndsAt }: { trialEndsAt: string }) {
  const theme = useTheme();
  const daysLeft = Math.max(0, Math.ceil(
    (new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  ));
  const isUrgent = daysLeft <= 3;

  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 1,
      px: 2, py: 1, borderRadius: '8px',
      background: isUrgent
        ? alpha(theme.palette.error.main, 0.1)
        : alpha(theme.palette.warning.main, 0.1),
      border: `1px solid ${isUrgent ? alpha(theme.palette.error.main, 0.3) : alpha(theme.palette.warning.main, 0.3)}`,
    }}>
      <Zap size={14} color={isUrgent ? theme.palette.error.main : theme.palette.warning.main} />
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: isUrgent ? theme.palette.error.main : theme.palette.warning.main }}>
        {daysLeft === 0 ? 'Trial expires today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in trial`}
      </Typography>
    </Box>
  );
}

// ─────────────────────────────────────────────
// TIER CARD
// ─────────────────────────────────────────────
function TierCard({
  tier,
  isCurrent,
  interval,
  onUpgrade,
  upgrading,
}: {
  tier: ReturnType<typeof buildTiers>[number];
  isCurrent: boolean;
  interval: 'monthly' | 'annual';
  onUpgrade: (tierId: string) => void;
  upgrading: string | null;
}) {
  const theme = useTheme();
  const { billingCurrency } = useEntitlements();
  const currency = (billingCurrency ?? 'USD') as BillingCurrency;
  const price = interval === 'annual' ? tier.annualPrice : tier.monthlyPrice;
  const savings = annualSavings(tier.id, currency);

  return (
    <Box sx={{
      border: `1px solid ${isCurrent ? theme.palette.primary.main : tier.highlight ? alpha(theme.palette.primary.main, 0.3) : theme.palette.divider}`,
      borderRadius: '12px',
      p: 2.5,
      flex: 1,
      minWidth: 0,
      position: 'relative',
      background: isCurrent
        ? alpha(theme.palette.primary.main, 0.04)
        : tier.highlight
        ? alpha(theme.palette.primary.main, 0.02)
        : 'transparent',
    }}>
      {tier.highlight && !isCurrent && (
        <Chip
          label="Most popular"
          size="small"
          sx={{
            position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
            fontSize: 10, fontWeight: 700, height: 22,
            bgcolor: theme.palette.primary.main,
            color: theme.palette.primary.contrastText,
          }}
        />
      )}
      {isCurrent && (
        <Chip
          label="Current plan"
          size="small"
          sx={{
            position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
            fontSize: 10, fontWeight: 700, height: 22,
            bgcolor: theme.palette.success.main,
            color: '#fff',
          }}
        />
      )}

      <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
        {tier.label}
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, mb: 0.5 }}>
        <Typography sx={{ fontSize: 24, fontWeight: 700, color: 'text.primary' }}>
          {formatDisplayPrice(price, currency)}
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>/mo</Typography>
      </Box>
      {interval === 'annual' && (
        <Typography sx={{ fontSize: 11, color: 'success.main', fontWeight: 600, mb: 1 }}>
          Save {formatDisplayPrice(savings, currency)}/year
        </Typography>
      )}

      <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 2 }}>
        {tier.seats} · {tier.orders}
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 2.5 }}>
        {tier.features.map((f) => (
          <Box key={f} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <CheckCircle size={12} color={theme.palette.success.main} />
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{f}</Typography>
          </Box>
        ))}
      </Box>

      {!isCurrent && (
        <Button
          fullWidth
          variant={tier.highlight ? 'contained' : 'outlined'}
          size="small"
          disabled={upgrading !== null}
          onClick={() => onUpgrade(tier.id)}
          endIcon={upgrading === tier.id ? <CircularProgress size={12} /> : <ArrowRight size={14} />}
          sx={{ borderRadius: '8px', fontWeight: 600, fontSize: 12 }}
        >
          {upgrading === tier.id ? 'Redirecting...' : `Upgrade to ${tier.label}`}
        </Button>
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
const BillingSettings: React.FC = () => {
  const theme = useTheme();
  const { tier: currentTier, trialEndsAt, billingCurrency } = useEntitlements();
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [sub, setSub] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly');
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    axiosInstance.get('/api/v1/billing/subscription')
      .then((r) => setSub(r.data))
      .catch(() => setError('Failed to load billing information.'))
      .finally(() => setLoading(false));
  }, []);

  axiosInstance.get('/api/v1/billing/usage')
      .then((r) => setUsage(r.data))
      .catch(() => {}); // non-fatal

  const handleUpgrade = async (tierId: string) => {
    setUpgrading(tierId);
    try {
      const { data } = await axiosInstance.post('/api/v1/billing/checkout', {
        tier: tierId,
        interval,
      });
      if (data.url) window.location.href = data.url;
    } catch {
      setError('Failed to start checkout. Please try again.');
      setUpgrading(null);
    }
  };

  const handlePortal = async () => {
    setOpeningPortal(true);
    try {
      const { data } = await axiosInstance.post('/api/v1/billing/portal');
      if (data.url) window.location.href = data.url;
    } catch {
      setError('Failed to open billing portal.');
      setOpeningPortal(false);
    }
  };

  if (loading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
      <CircularProgress size={24} />
    </Box>
  );

  const isOnTrial = sub?.status === 'trialing';
  const currency = (billingCurrency ?? 'USD') as BillingCurrency;
  const TIERS = buildTiers(currency);
  const annualSavingsGrowth = annualSavings('growth', currency);

  return (
    <Box>
      {/* HEADER */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Typography variant="h6" fontWeight={600}>Billing & Plan</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Manage your subscription, seats, and payment method.
          </Typography>
        </Box>
        {sub && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<ExternalLink size={14} />}
            disabled={openingPortal}
            onClick={handlePortal}
          >
            {openingPortal ? 'Opening...' : 'Manage billing'}
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* CURRENT PLAN */}
      <Box sx={{
        p: 2, borderRadius: '10px', mb: 3,
        border: `1px solid ${theme.palette.divider}`,
        background: alpha(theme.palette.primary.main, 0.03),
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2,
      }}>
        <Box>
          <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.07em', mb: 0.5 }}>
            Current plan
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography sx={{ fontSize: 20, fontWeight: 700, color: 'text.primary', textTransform: 'capitalize' }}>
              {currentTier}
            </Typography>
            <Chip
              label={sub?.status ?? 'active'}
              size="small"
              color={isOnTrial ? 'warning' : 'success'}
              sx={{ textTransform: 'capitalize', fontSize: 10 }}
            />
          </Box>
          {sub?.current_period_end && (
            <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.5 }}>
              Renews {new Date(sub.current_period_end).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </Typography>
          )}
        </Box>
        {isOnTrial && trialEndsAt && <TrialBadge trialEndsAt={trialEndsAt} />}
      </Box>

      {/* ORDER USAGE */}
      {usage && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1.5 }}>
            This month's usage
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {(() => {
              const ingestedCap = TIER_MONTHLY_ORDER_CAP[currentTier as Tier] ?? 50;
              const shippedCap = TIER_SHIPPED_ORDER_CAP[currentTier as Tier] ?? 0;
              const ingestedPct = ingestedCap === Infinity ? 0 : (usage.ingested_orders / ingestedCap) * 100;
              const shippedPct = shippedCap === Infinity || shippedCap === 0 ? 0 : (usage.shipped_orders / shippedCap) * 100;
              const ingestedWarning = ingestedPct >= 80;
              const shippedWarning = shippedPct >= 80;
              return (
                <>
                  <Box sx={{ flex: 1, minWidth: 200 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
                      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Orders ingested</Typography>
                      <Typography sx={{ fontSize: 12, fontWeight: 600, color: ingestedWarning ? 'error.main' : 'text.primary' }}>
                        {usage.ingested_orders.toLocaleString()} {ingestedCap !== Infinity ? `/ ${ingestedCap.toLocaleString()}` : '/ ∞'}
                      </Typography>
                    </Box>
                    {ingestedCap !== Infinity && (
                      <LinearProgress variant="determinate" value={Math.min(ingestedPct, 100)}
                        color={ingestedPct >= 100 ? 'error' : ingestedWarning ? 'warning' : 'primary'}
                        sx={{ borderRadius: 4, height: 5 }} />
                    )}
                  </Box>
                  {shippedCap > 0 && (
                    <Box sx={{ flex: 1, minWidth: 200 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
                        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Orders shipped</Typography>
                        <Typography sx={{ fontSize: 12, fontWeight: 600, color: shippedWarning ? 'error.main' : 'text.primary' }}>
                          {usage.shipped_orders.toLocaleString()} {shippedCap !== Infinity ? `/ ${shippedCap.toLocaleString()}` : '/ ∞'}
                        </Typography>
                      </Box>
                      <LinearProgress variant="determinate" value={Math.min(shippedPct, 100)}
                        color={shippedPct >= 100 ? 'error' : shippedWarning ? 'warning' : 'primary'}
                        sx={{ borderRadius: 4, height: 5 }} />
                    </Box>
                  )}
                </>
              );
            })()}
          </Box>
        </Box>
      )}

      <Divider sx={{ mb: 3 }} />

      {/* ANNUAL SAVINGS CALLOUT (UX-08) */}
      <Box sx={{
        p: 1.5, borderRadius: '8px', mb: 3,
        background: alpha(theme.palette.success.main, 0.07),
        border: `1px solid ${alpha(theme.palette.success.main, 0.2)}`,
        display: 'flex', alignItems: 'center', gap: 1.5,
      }}>
        <Zap size={16} color={theme.palette.success.main} />
        <Typography sx={{ fontSize: 12, color: 'success.main', fontWeight: 600 }}>
          Switch to annual billing and save ${annualSavingsGrowth}/year on Growth — that's 2 months free.
        </Typography>
      </Box>

      {/* BILLING INTERVAL TOGGLE */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.primary' }}>Billing interval</Typography>
        <ToggleButtonGroup
          value={interval}
          exclusive
          onChange={(_, v) => v && setInterval(v)}
          size="small"
        >
          <ToggleButton value="monthly" sx={{ fontSize: 12, px: 2 }}>Monthly</ToggleButton>
          <ToggleButton value="annual" sx={{ fontSize: 12, px: 2 }}>
            Annual
            <Chip label="Save 20%" size="small" sx={{ ml: 1, fontSize: 9, height: 18, bgcolor: 'success.main', color: '#fff' }} />
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* TIER CARDS */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {TIERS.map((t) => (
          <TierCard
            key={t.id}
            tier={t}
            isCurrent={currentTier === t.id}
            interval={interval}
            onUpgrade={handleUpgrade}
            upgrading={upgrading}
          />
        ))}
      </Box>
    </Box>
  );
};

export default BillingSettings;