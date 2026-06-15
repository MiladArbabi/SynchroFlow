// apps/frontend/src/components/TrialCountdownChip.tsx
//
// TRIAL COUNTDOWN CHIP (TC-08)
// ----------------------------
// Shows days remaining on Growth trial in the topnav.
//
// DISPLAY RULES:
// - Only shown when tier = 'growth' AND trialEndsAt is set (trialing status)
// - > 7 days  → neutral chip (no urgency)
// - 4–7 days  → warning orange
// - 1–3 days  → critical red + pulse
// - 0 days    → "Trial ended" (expiry worker may not have run yet)
//
// Clicking navigates to /settings/billing.
// Reads from EntitlementsContext — zero additional network calls.

import React, { useMemo } from 'react';
import { Box, Typography, Tooltip, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';

function getDaysRemaining(trialEndsAt: string): number {
  const now = Date.now();
  const end = new Date(trialEndsAt).getTime();
  return Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
}

type Urgency = 'neutral' | 'warning' | 'critical';

function getUrgency(days: number): Urgency {
  if (days <= 3) return 'critical';
  if (days <= 7) return 'warning';
  return 'neutral';
}

export const TrialCountdownChip: React.FC = () => {
  const theme = useTheme();
  const { tier, trialEndsAt } = useEntitlements();
  const navigate = useNavigate();

  const daysRemaining = useMemo(
    () => (trialEndsAt ? getDaysRemaining(trialEndsAt) : null),
    [trialEndsAt]
  );

  // Only render for trialing Growth merchants during FT2
  const { phase } = useShopLifecycle();
  if (phase !== 'FT2_READY' || tier !== 'growth' || daysRemaining === null) return null;

  const urgency = getUrgency(daysRemaining);
  const paletteColor = {
    neutral:  theme.palette.primary.main,
    warning:  theme.palette.warning.main,
    critical: theme.palette.error.main,
  }[urgency];
  const bg     = alpha(paletteColor, urgency === 'neutral' ? 0.08 : 0.10);
  const border = alpha(paletteColor, urgency === 'neutral' ? 0.20 : 0.30);
  const color  = paletteColor;

  const label = daysRemaining === 0
    ? 'Trial ended'
    : daysRemaining === 1
    ? '1 day left'
    : `${daysRemaining} days left`;

  const tooltip = daysRemaining === 0
    ? 'Your trial has ended. Upgrade to keep access.'
    : `Growth trial ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}. Click to upgrade.`;

  return (
    <Tooltip title={tooltip} placement="bottom">
      <Box
        onClick={() => navigate('/account/settings?tab=billing')}
        sx={{
          display:        'inline-flex',
          alignItems:     'center',
          gap:            0.5,
          px:             1.25,
          py:             0.4,
          borderRadius:   '20px',
          backgroundColor: bg,
          border:         `1px solid ${border}`,
          cursor:         'pointer',
          userSelect:     'none',
          // Pulse on critical urgency
          '@keyframes trialPulse': {
            '0%, 100%': { opacity: 1 },
            '50%':      { opacity: 0.65 },
          },
          animation: urgency === 'critical' ? 'trialPulse 2s ease-in-out infinite' : 'none',
          transition: 'opacity 0.15s ease',
          '&:hover': { opacity: 0.8 },
        }}
      >
        {/* Dot indicator */}
        <Box
          sx={{
            width:           6,
            height:          6,
            borderRadius:    '50%',
            backgroundColor: color,
            flexShrink:      0,
          }}
        />
        <Typography
          sx={{
            fontSize:      '0.7rem',
            fontWeight:    700,
            color,
            letterSpacing: '0.02em',
            lineHeight:    1,
          }}
        >
          {label}
        </Typography>
      </Box>
    </Tooltip>
  );
};

export default TrialCountdownChip;