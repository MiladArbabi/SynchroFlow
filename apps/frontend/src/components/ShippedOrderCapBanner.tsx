// apps/frontend/src/components/ShippedOrderCapBanner.tsx
//
// SHIPPED ORDER CAP BANNER (SEG-023)
// -----------------------------------
// Inline on Orders/Order Flow page. Watches shipped_orders (pack-complete
// count) against TIER_SHIPPED_ORDER_CAP — distinct from OrderCapBanner,
// which watches ingested_orders. Two-stage thresholds (75%/90%) per
// product decision, vs. OrderCapBanner's single 80% stage — do not
// merge these two components, they intentionally differ.
//
// Self-fetches /api/v1/billing/usage — renders nothing below 75%.
// "Shipped" here means pack-complete, not carrier-confirmed ship — see
// wms.controller.ts httpPackComplete. Copy says "packed" to stay accurate.

import { useEffect, useState } from 'react';
import { Box, Typography, useTheme, alpha } from '@mui/material';
import { AlertTriangle, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEntitlements } from '../contexts/EntitlementsContext';
import { TIER_SHIPPED_ORDER_CAP, type Tier } from '../config/tiers';
import { useCapStatus } from '../hooks/useCapStatus';
import { axiosInstance } from '../api/axiosConfig';

interface UsageSummary {
  shipped_orders: number;
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

export function ShippedOrderCapBanner() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { tier } = useEntitlements();
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    axiosInstance.get('/api/v1/billing/usage')
      .then(r => setUsage(r.data))
      .catch(() => {}); // non-fatal
  }, []);

  const shippedCap = tier ? TIER_SHIPPED_ORDER_CAP[tier as Tier] : 0;
  const { pct, level } = useCapStatus(usage?.shipped_orders ?? 0, shippedCap, [0.75, 0.9]);

  if (!usage || !tier || tier === 'scale') return null;
  if (shippedCap === Infinity) return null;
  if (level === 'ok') return null;

  const isBlocked = level === 'blocked';
  const isUrgent = level === 'urgent';
  const nextTier = NEXT_TIER[tier as Tier];

  const tokens = isBlocked || isUrgent
    ? {
        bg:         alpha(theme.palette.error.main, 0.08),
        border:     alpha(theme.palette.error.main, 0.25),
        tileBg:     alpha(theme.palette.error.main, 0.08),
        tileBorder: alpha(theme.palette.error.main, 0.25),
        iconColor:  theme.palette.error.main,
        barColor:   theme.palette.error.main,
      }
    : {
        bg:         alpha(theme.palette.warning.main, 0.12),
        border:     alpha(theme.palette.warning.main, 0.30),
        tileBg:     alpha(theme.palette.warning.main, 0.12),
        tileBorder: alpha(theme.palette.warning.main, 0.30),
        iconColor:  theme.palette.warning.main,
        barColor:   theme.palette.warning.main,
      };

  const handleUpgrade = () => navigate('/settings/billing');
  // Placeholder destination until the pay-per-order Stripe Customer flow
  // (SEG-022-B) exists — routes to the same billing page for now.
  const handlePayPerOrder = () => navigate('/settings/billing');

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: '16px', p: '16px 18px',
      background: tokens.bg, border: `1px solid ${tokens.border}`,
      borderRadius: '12px', mb: 3,
    }}>
      <Box sx={{
        width: 40, height: 40, borderRadius: '10px',
        background: tokens.tileBg, border: `1px solid ${tokens.tileBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {isBlocked
          ? <XCircle size={20} color={tokens.iconColor} strokeWidth={1.8} />
          : <AlertTriangle size={20} color={tokens.iconColor} strokeWidth={1.8} />}
      </Box>

      <Box sx={{ flex: 1 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.primary' }}>
          {isBlocked
            ? 'Monthly pack limit reached'
            : `You've packed ${usage.shipped_orders.toLocaleString()} of your ${shippedCap.toLocaleString()} monthly orders`}
        </Typography>

        <Typography sx={{ fontSize: 12.5, fontWeight: 300, color: 'text.secondary', mt: '2px' }}>
          {isBlocked
            ? `New packs are paused until your cycle resets on ${formatResetDate(usage.period_starts_at)} — enable pay-per-order to keep shipping, or upgrade your plan.`
            : isUrgent
            ? `You're close to your limit. Enable pay-per-order to avoid an interruption, or upgrade${nextTier ? ` to ${nextTier}` : ''}.`
            : `Enable pay-per-order for orders past your limit, or upgrade your plan for more headroom.`}
        </Typography>

        <Box sx={{
          height: 6, width: '100%', maxWidth: 380, borderRadius: '100px',
          background: theme.palette.action.hover, overflow: 'hidden', mt: '9px',
        }}>
          <Box sx={{ height: '100%', width: `${pct}%`, borderRadius: '100px', background: tokens.barColor }} />
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
        <Box
          onClick={handlePayPerOrder}
          sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', height: 36, px: '16px',
            background: theme.palette.primary.main, color: '#FFF', borderRadius: '8px',
            fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            '&:hover': { opacity: 0.88 },
          }}
        >
          Enable pay-per-order
        </Box>
        {nextTier && (
          <Box
            onClick={handleUpgrade}
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', height: 30, px: '16px',
              color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '8px',
              fontSize: 11.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
              '&:hover': { opacity: 0.75 },
            }}
          >
            Upgrade plan
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default ShippedOrderCapBanner;