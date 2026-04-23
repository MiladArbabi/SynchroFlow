// apps/frontend/src/components/TrialCountdownBanner.tsx
//
// TRIAL COUNTDOWN BANNER (UX-03)
// --------------------------------
// Shown during active trial period.
// Dismissible per session — re-appears on next session.
// CTA navigates to /settings/billing (account settings tab 5).
//
// Design rules (mirrors SystemHealthBanner pattern):
// - Theme-aware — MUI semantic tokens only
// - Calm urgency — not alarming, action-oriented
// - Never blocks interaction
// - Auto-hides when not on trial

import { useState } from 'react';
import { Box, Typography, Button, IconButton, useTheme, alpha } from '@mui/material';
import { Zap, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const DISMISS_KEY = 'trial_banner_dismissed_date';

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
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

  // Not on trial — render nothing
  if (!trialEndsAt) return null;

  const daysLeft = Math.max(0, Math.ceil(
    (new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  ));

  // Trial expired — nothing to show
  if (daysLeft === 0 && new Date(trialEndsAt) < new Date()) return null;

  // Dismissed today
  if (dismissed) return null;

  const isUrgent = daysLeft <= 3;

  const bg = isUrgent
    ? alpha(theme.palette.error.main, 0.1)
    : alpha(theme.palette.warning.main, 0.08);

  const borderColor = isUrgent
    ? alpha(theme.palette.error.main, 0.25)
    : alpha(theme.palette.warning.main, 0.25);

  const accentColor = isUrgent
    ? theme.palette.error.main
    : theme.palette.warning.main;

  const message = daysLeft === 0
    ? 'Your Growth trial expires today'
    : daysLeft === 1
    ? '1 day left in your Growth trial'
    : `${daysLeft} days left in your Growth trial`;

  const handleDismiss = () => {
    dismissToday();
    setDismissed(true);
  };

  const handleUpgrade = () => {
    // Navigate to account settings, billing tab (index 5)
    navigate('/account/settings?tab=billing');
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        px: 2.5,
        py: 1,
        background: bg,
        borderBottom: `1px solid ${borderColor}`,
        flexShrink: 0,
      }}
    >
      {/* Left: icon + message */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Zap size={14} color={accentColor} style={{ flexShrink: 0 }} />
        <Typography
          sx={{
            fontSize: 12,
            fontWeight: 500,
            color: accentColor,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {message}
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>
          — unlock Cash Flow, LTV, Demand & Specter permanently.
        </Typography>
      </Box>

      {/* Right: CTA + dismiss */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        <Button
          size="small"
          variant="contained"
          onClick={handleUpgrade}
          sx={{
            fontSize: 11,
            fontWeight: 700,
            py: 0.5,
            px: 1.5,
            minWidth: 0,
            borderRadius: '6px',
            bgcolor: accentColor,
            color: '#fff',
            '&:hover': { bgcolor: accentColor, opacity: 0.9 },
          }}
        >
          Upgrade now
        </Button>
        <IconButton
          size="small"
          onClick={handleDismiss}
          sx={{ color: 'text.secondary', p: 0.5 }}
          aria-label="Dismiss trial banner"
        >
          <X size={14} />
        </IconButton>
      </Box>
    </Box>
  );
}

export default TrialCountdownBanner;