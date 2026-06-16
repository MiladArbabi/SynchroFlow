// apps/frontend/src/components/TrialCountdownBanner.tsx
//
// TRIAL COUNTDOWN BANNER (UX-03)
// --------------------------------
// Shown during active trial period.
// Dismissible per session — re-appears on next session.
// CTA navigates to /settings/billing (FT2 ShopSettingsPage).
//
// 3-state escalation: calm (≥4 days) → amber (2-3 days) → red (0-1 days)

import { useState } from 'react';
import { Box, useTheme, alpha } from '@mui/material';
import { Clock, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const DISMISS_KEY = 'trial_banner_dismissed_date';

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function isDismissedToday(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === getTodayKey();
  } catch {
    return false;
  }
}

function dismissToday(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, getTodayKey());
  } catch {
    // ignore
  }
}

interface TrialCountdownBannerProps {
  trialEndsAt: string | null;
}

export function TrialCountdownBanner({ trialEndsAt }: TrialCountdownBannerProps) {
  const theme = useTheme();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => isDismissedToday());

  if (!trialEndsAt || dismissed) return null;

  const daysLeft = Math.max(0, Math.ceil(
    (new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  ));

  // Trial already expired
  if (daysLeft === 0 && new Date(trialEndsAt) < new Date()) return null;

  const state = daysLeft <= 1 ? 'red' : daysLeft <= 3 ? 'amber' : 'calm';

  const tokens = {
    calm: {
      bg: alpha(theme.palette.primary.main, 0.07),
      border: alpha(theme.palette.primary.main, 0.22),
      iconColor: theme.palette.primary.main,
      strongColor: theme.palette.primary.main,
      ctaBg: theme.palette.background.paper,
      ctaBorder: alpha(theme.palette.primary.main, 0.30),
      ctaColor: theme.palette.primary.main,
    },
    amber: {
      bg: alpha(theme.palette.warning.main, 0.12),
      border: alpha(theme.palette.warning.main, 0.30),
      iconColor: theme.palette.warning.main,
      strongColor: theme.palette.warning.main,
      ctaBg: theme.palette.background.paper,
      ctaBorder: alpha(theme.palette.warning.main, 0.40),
      ctaColor: theme.palette.warning.main,
    },
    red: {
      bg: alpha(theme.palette.error.main, 0.08),
      border: alpha(theme.palette.error.main, 0.25),
      iconColor: theme.palette.error.main,
      strongColor: theme.palette.text.primary,
      ctaBg: theme.palette.error.main,
      ctaBorder: theme.palette.error.main,
      ctaColor: '#FFF',
    },
  }[state];

  const dayWord = daysLeft === 1 ? 'day' : 'days';
  const lead = daysLeft === 0
    ? 'Trial ends today'
    : `${daysLeft} ${dayWord} left`;
  const rest = state === 'calm'
    ? 'on your Growth trial — add payment to keep your momentum.'
    : state === 'amber'
    ? 'on your Growth trial — forecasting, cash flow & LTV switch off soon.'
    : daysLeft === 0
    ? '— add payment now to keep access.'
    : 'on your Growth trial.';

  const handleDismiss = () => {
    dismissToday();
    setDismissed(true);
  };

  const handleAddPayment = () => {
    navigate('/settings/billing');
  };

  return (
    <Box
      sx={{
        px: '16px',
        py: '11px',
        background: tokens.bg,
        borderBottom: `1px solid ${tokens.border}`,
        flexShrink: 0,
      }}
    >
      {/* Main row: icon · text · [desktop CTA] · dismiss */}
      <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, gap: '14px' }}>
        <Clock
          size={18}
          color={tokens.iconColor}
          strokeWidth={1.8}
          style={{ flexShrink: 0, marginTop: 1 }}
        />

        {/* Text */}
        <Box sx={{ flex: 1, fontSize: 13.5, lineHeight: 1.4 }}>
          <Box component="span" sx={{ fontWeight: 600, color: tokens.strongColor }}>
            {lead}
          </Box>
          <Box
            component="span"
            sx={{ fontWeight: 300, color: 'text.secondary', display: { xs: 'none', sm: 'inline' } }}
          >
            {' '}{rest}
          </Box>
          {/* Mobile: shorter trailing text */}
          <Box
            component="span"
            sx={{ fontWeight: 300, color: 'text.secondary', display: { xs: 'inline', sm: 'none' } }}
          >
            {state === 'red'
              ? (daysLeft === 0 ? '' : ' on your Growth trial.')
              : ' on your Growth trial.'}
          </Box>
        </Box>

        {/* Desktop CTA */}
        <Box
          onClick={handleAddPayment}
          sx={{
            display: { xs: 'none', sm: 'flex' },
            alignItems: 'center',
            justifyContent: 'center',
            height: 34,
            px: '16px',
            background: tokens.ctaBg,
            color: tokens.ctaColor,
            border: `1px solid ${tokens.ctaBorder}`,
            borderRadius: '7px',
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            '&:hover': { opacity: 0.85 },
          }}
        >
          Add payment
        </Box>

        {/* Dismiss */}
        <Box
          onClick={handleDismiss}
          sx={{
            width: 26,
            height: 26,
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            color: 'text.secondary',
            '&:hover': { background: 'rgba(0,0,0,0.05)' },
          }}
        >
          <X size={14} strokeWidth={1.8} />
        </Box>
      </Box>

      {/* Mobile CTA — full width below */}
      <Box
        onClick={handleAddPayment}
        sx={{
          display: { xs: 'flex', sm: 'none' },
          alignItems: 'center',
          justifyContent: 'center',
          height: 40,
          mt: '11px',
          background: tokens.ctaBg,
          color: tokens.ctaColor,
          border: `1px solid ${tokens.ctaBorder}`,
          borderRadius: '7px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Add payment method
      </Box>
    </Box>
  );
}

export default TrialCountdownBanner;
