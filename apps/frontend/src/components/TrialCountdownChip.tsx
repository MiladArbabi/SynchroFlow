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
import { Box, Typography, Tooltip } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { ThemeMode } from 'config';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';

function useTrialTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === ThemeMode.DARK;
  return { isDark };
}

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

const URGENCY_STYLES: Record<Urgency, { bg: string; border: string; color: string; darkBg: string; darkBorder: string; darkColor: string }> = {
  neutral:  { bg: 'rgba(255,107,43,0.08)', border: 'rgba(255,107,43,0.2)',  color: '#FF6B2B', darkBg: 'rgba(255,107,43,0.12)', darkBorder: 'rgba(255,107,43,0.3)',  darkColor: '#FF8C5A' },
  warning:  { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.3)',  color: '#B45309', darkBg: 'rgba(245,158,11,0.15)', darkBorder: 'rgba(245,158,11,0.4)',  darkColor: '#F59E0B' },
  critical: { bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.3)',   color: '#B91C1C', darkBg: 'rgba(239,68,68,0.15)',  darkBorder: 'rgba(239,68,68,0.4)',   darkColor: '#EF4444' },
};

export const TrialCountdownChip: React.FC = () => {
  const { tier, trialEndsAt } = useEntitlements();
  console.log('[TrialChip]', { tier, trialEndsAt });
  const { isDark } = useTrialTheme();
  const navigate = useNavigate();

  const daysRemaining = useMemo(
    () => (trialEndsAt ? getDaysRemaining(trialEndsAt) : null),
    [trialEndsAt]
  );

  // Only render for trialing Growth merchants during FT2
  const { phase } = useShopLifecycle();
  if (phase !== 'FT2_READY' || tier !== 'growth' || daysRemaining === null) return null;

  const urgency = getUrgency(daysRemaining);
  const styles = URGENCY_STYLES[urgency];
  const bg     = isDark ? styles.darkBg     : styles.bg;
  const border = isDark ? styles.darkBorder  : styles.border;
  const color  = isDark ? styles.darkColor   : styles.color;

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
        onClick={() => navigate('/settings/billing')}
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