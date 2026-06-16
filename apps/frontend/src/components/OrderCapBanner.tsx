// apps/frontend/src/components/OrderCapBanner.tsx
//
// ORDER CAP BANNER (MON-08)
// -------------------------
// Inline on Orders and Fulfillment pages.
// Amber nudge at ≥80%, hard red block at 100%.
// Self-fetches /api/v1/billing/usage — renders nothing below 80%.

import { useEffect, useState } from 'react';
import { Box, Typography, useTheme, alpha } from '@mui/material';
import { AlertTriangle, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEntitlements } from '../contexts/EntitlementsContext';
import { TIER_MONTHLY_ORDER_CAP, type Tier } from '../config/tiers';
import { axiosInstance } from '../api/axiosConfig';

// Field names must match GET /api/v1/billing/usage response exactly.
// API returns: ingested_orders, shipped_orders, tier, period_starts_at
// No cycle_end is returned — banner omits reset date when unavailable.
interface UsageSummary {
  ingested_orders: number;
  period_starts_at?: string;
}

const NEXT_TIER: Partial<Record<Tier, Tier>> = {
  starter: 'core',
  core:    'growth',
  growth:  'scale',
};

function formatResetDate(isoDate: string | undefined): string {
  if (!isoDate) return 'your next cycle';
  return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function nextTierCap(tier: Tier): string {
  const next = NEXT_TIER[tier];
  if (!next) return 'unlimited';
  const cap = TIER_MONTHLY_ORDER_CAP[next];
  return cap === Infinity ? 'unlimited' : cap.toLocaleString();
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function OrderCapBanner() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { tier } = useEntitlements();
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    axiosInstance.get('/api/v1/billing/usage')
      .then(r => setUsage(r.data))
      .catch(() => {}); // non-fatal
  }, []);

  if (!usage || !tier || tier === 'scale') return null;

  const ordersCap = TIER_MONTHLY_ORDER_CAP[tier as Tier];
  if (ordersCap === Infinity) return null;

  const ordersUsed = usage.ingested_orders;
  const pct = ordersUsed / ordersCap;
  if (pct < 0.8) return null;

  const isBlocked = pct >= 1;
  const nextTier  = NEXT_TIER[tier as Tier];

  const tokens = isBlocked
    ? {
        bg:         alpha(theme.palette.error.main, 0.08),
        border:     alpha(theme.palette.error.main, 0.25),
        tileBg:     alpha(theme.palette.error.main, 0.08),
        tileBorder: alpha(theme.palette.error.main, 0.25),
        iconColor:  theme.palette.error.main,
        barColor:   theme.palette.error.main,
        pillBg:     alpha(theme.palette.error.main, 0.08),
        pillBorder: alpha(theme.palette.error.main, 0.25),
        pillColor:  theme.palette.error.main,
      }
    : {
        bg:         alpha(theme.palette.warning.main, 0.12),
        border:     alpha(theme.palette.warning.main, 0.30),
        tileBg:     alpha(theme.palette.warning.main, 0.12),
        tileBorder: alpha(theme.palette.warning.main, 0.30),
        iconColor:  theme.palette.warning.main,
        barColor:   theme.palette.warning.main,
        pillBg:     '',
        pillBorder: '',
        pillColor:  '',
      };

  const handleUpgrade = () => navigate('/account/settings?tab=billing');

  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      p: '16px 18px',
      background: tokens.bg,
      border: `1px solid ${tokens.border}`,
      borderRadius: '12px',
      mb: 3,
    }}>
      {/* Icon tile */}
      <Box sx={{
        width: 40,
        height: 40,
        borderRadius: '10px',
        background: tokens.tileBg,
        border: `1px solid ${tokens.tileBorder}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        {isBlocked
          ? <XCircle size={20} color={tokens.iconColor} strokeWidth={1.8} />
          : <AlertTriangle size={20} color={tokens.iconColor} strokeWidth={1.8} />}
      </Box>

      {/* Text + progress */}
      <Box sx={{ flex: 1 }}>
        {isBlocked ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.primary' }}>
              Monthly order limit reached
            </Typography>
            <Box sx={{
              fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: tokens.pillColor,
              background: tokens.pillBg,
              border: `1px solid ${tokens.pillBorder}`,
              px: '7px', py: '2px',
              borderRadius: '100px',
              whiteSpace: 'nowrap',
            }}>
              Paused
            </Box>
          </Box>
        ) : (
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.primary' }}>
            You've used {ordersUsed.toLocaleString()} of your {ordersCap.toLocaleString()} monthly orders
          </Typography>
        )}

        <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'text.secondary', mt: '2px' }}>
          {isBlocked
            ? `New orders are paused until your cycle resets on ${formatResetDate(usage.period_starts_at)}, or upgrade now to keep ingesting.`
            : nextTier
            ? `Upgrade to ${capitalize(nextTier)} for ${nextTierCap(tier as Tier)} orders/mo and avoid an interruption when you hit the cap.`
            : 'Upgrade your plan to increase your monthly order limit.'}
        </Typography>

        {/* Progress bar */}
        <Box sx={{
          height: 6,
          width: '100%',
          maxWidth: 380,
          borderRadius: '100px',
          background: theme.palette.action.hover,
          overflow: 'hidden',
          mt: '9px',
        }}>
          <Box sx={{
            height: '100%',
            width: `${Math.min(100, Math.round(pct * 100))}%`,
            borderRadius: '100px',
            background: tokens.barColor,
          }} />
        </Box>
      </Box>

      {/* CTA — always accent regardless of urgency level */}
      <Box
        onClick={handleUpgrade}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 40,
          px: '18px',
          background: theme.palette.primary.main,
          color: '#FFF',
          borderRadius: '8px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          '&:hover': { opacity: 0.88 },
        }}
      >
        {isBlocked ? 'Upgrade now' : 'Upgrade plan'}
      </Box>
    </Box>
  );
}

export default OrderCapBanner;
