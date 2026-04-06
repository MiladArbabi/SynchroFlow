// apps/frontend/src/components/SystemHealthBanner.tsx

import { Box, Typography, useTheme } from '@mui/material';
import { AlertTriangle, XCircle, Clock } from 'lucide-react';
import type { SystemHealthStatus } from 'hooks/useSystemHealth';

/**
 * SYSTEM HEALTH BANNER (H-01)
 * ---------------------------
 * Theme-aware — uses MUI semantic tokens exclusively.
 * No hardcoded colors. Correct in both light and dark mode.
 *
 * Design rules:
 * - Calm authority — not alarming, informative
 * - Operator vocabulary — never system language
 * - Auto-resolves when system recovers
 * - Never blocks interaction
 *
 * States:
 * - warning  → warning.main — "Data may be a few minutes behind"
 * - critical → error.main (dimmed) — "Data is significantly delayed"
 * - stalled  → error.main — "Data is not updating"
 */

type SystemHealthBannerProps = {
  status: SystemHealthStatus;
  lagSeconds?: number | null;
};

export function SystemHealthBanner({ status, lagSeconds }: SystemHealthBannerProps) {
  const theme = useTheme();

  if (status === 'healthy' || status === 'unknown') return null;

  /**
   * TOKEN MAP
   * ---------
   * All colors derived from MUI theme palette.
   * Works correctly in both light and dark mode.
   */
  const config = {
    warning: {
      color: theme.palette.warning.main,
      bgcolor: theme.palette.mode === 'dark'
        ? 'rgba(250,204,21,0.08)'
        : 'rgba(202,138,4,0.06)',
      icon: <Clock size={14} />,
      message: 'Data may be a few minutes behind',
      submessage: 'Your figures are updating. Refresh in a moment for the latest state.',
    },
    critical: {
      color: theme.palette.error.main,
      bgcolor: theme.palette.mode === 'dark'
        ? 'rgba(248,113,113,0.08)'
        : 'rgba(220,38,38,0.06)',
      icon: <AlertTriangle size={14} />,
      message: 'Data is significantly delayed',
      submessage: 'The system is catching up. Some figures may not reflect recent activity.',
    },
    stalled: {
      color: theme.palette.error.main,
      bgcolor: theme.palette.mode === 'dark'
        ? 'rgba(248,113,113,0.12)'
        : 'rgba(220,38,38,0.08)',
      icon: <XCircle size={14} />,
      message: 'Data is not updating',
      submessage: 'The system has stopped processing. Engineering has been alerted.',
    },
  }[status];

  if (!config) return null;

  const lagText =
    lagSeconds != null && lagSeconds > 60
      ? ` (${Math.round(lagSeconds / 60)}m behind)`
      : '';

  return (
    <Box
      sx={{
        px: 3,
        py: 0.75,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        bgcolor: config.bgcolor,
        borderBottom: `1px solid ${config.color}`,
        borderLeft: `3px solid ${config.color}`,
      }}
    >
      <Box sx={{ color: config.color, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        {config.icon}
      </Box>
      <Box>
        <Typography variant="caption" fontWeight={600} sx={{ color: config.color }}>
          {config.message}{lagText}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
          {config.submessage}
        </Typography>
      </Box>
    </Box>
  );
}