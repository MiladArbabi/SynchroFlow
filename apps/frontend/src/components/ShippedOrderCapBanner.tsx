// apps/frontend/src/components/ShippedOrderCapBanner.tsx
//
// MON-REM-01B-4
// Paid warehouse tiers continue execution above their included processed-order
// allowance. This surface informs the merchant about usage and automatic
// overage; it never presents the allowance as an execution stop.

import { useEffect, useState } from 'react';
import { Box, Typography, useTheme, alpha } from '@mui/material';
import { AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  PLAN_PROCESSED_ORDER_OVERAGE_CENTS,
  standardLimits,
} from '@lasyncro/commercial-policy';
import { useEntitlements } from '../contexts/EntitlementsContext';
import type { Tier } from '../config/tiers';
import { axiosInstance } from '../api/axiosConfig';

interface UsageSummary {
  shipped_orders: number;
}

const NEXT_TIER: Partial<Record<Tier, Tier>> = {
  core: 'growth',
  growth: 'scale',
};

export function ShippedOrderCapBanner() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { tier } = useEntitlements();
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    axiosInstance.get('/api/v1/billing/usage')
      .then((response) => setUsage(response.data))
      .catch(() => {});
  }, []);

  if (!usage || !tier || tier === 'starter') return null;

  const paidTier = tier as Tier;
  const { shippedOrderCap: included } = standardLimits(paidTier);
  const overageCents =
    PLAN_PROCESSED_ORDER_OVERAGE_CENTS[
      paidTier as keyof typeof PLAN_PROCESSED_ORDER_OVERAGE_CENTS
    ];

  if (
    !Number.isFinite(included) ||
    included <= 0 ||
    overageCents == null
  ) {
    return null;
  }

  const used = usage.shipped_orders;
  const ratio = used / included;

  if (ratio < 0.75) return null;

  const overageUnits = Math.max(0, used - included);
  const isOverAllowance = overageUnits > 0;
  const isNearAllowance = !isOverAllowance && ratio >= 0.9;
  const nextTier = NEXT_TIER[paidTier];
  const overageRate = overageCents / 100;

  const tone =
    isOverAllowance || isNearAllowance
      ? theme.palette.warning.main
      : theme.palette.info.main;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        p: '16px 18px',
        background: alpha(tone, 0.08),
        border: `1px solid ${alpha(tone, 0.25)}`,
        borderRadius: '12px',
        mb: 3,
      }}
    >
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: '10px',
          background: alpha(tone, 0.08),
          border: `1px solid ${alpha(tone, 0.25)}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <AlertTriangle
          size={20}
          color={tone}
          strokeWidth={1.8}
        />
      </Box>

      <Box sx={{ flex: 1 }}>
        <Typography
          sx={{
            fontSize: 14,
            fontWeight: 600,
            color: 'text.primary',
          }}
        >
          {isOverAllowance
            ? `${overageUnits.toLocaleString()} processed order${overageUnits === 1 ? '' : 's'} above your included monthly allowance`
            : `You've processed ${used.toLocaleString()} of ${included.toLocaleString()} included monthly orders`}
        </Typography>

        <Typography
          sx={{
            fontSize: 12.5,
            fontWeight: 300,
            color: 'text.secondary',
            mt: '2px',
          }}
        >
          {isOverAllowance
            ? `Warehouse execution continues normally. Additional processed orders are billed at $${overageRate.toFixed(2)} each.`
            : `Warehouse execution continues normally above the allowance at $${overageRate.toFixed(2)} per additional processed order.`}
        </Typography>

        <Box
          sx={{
            height: 6,
            width: '100%',
            maxWidth: 380,
            borderRadius: '100px',
            background: theme.palette.action.hover,
            overflow: 'hidden',
            mt: '9px',
          }}
        >
          <Box
            sx={{
              height: '100%',
              width: `${Math.min(ratio * 100, 100)}%`,
              borderRadius: '100px',
              background: tone,
            }}
          />
        </Box>
      </Box>

      {nextTier && (
        <Box
          onClick={() => navigate('/settings/billing')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 36,
            px: '16px',
            color: 'var(--accent-text)',
            border: '0.5px solid var(--accent)',
            borderRadius: '8px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            '&:hover': { opacity: 0.75 },
          }}
        >
          View plans
        </Box>
      )}
    </Box>
  );
}

export default ShippedOrderCapBanner;
