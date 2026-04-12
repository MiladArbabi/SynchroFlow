// modules/wms/src/ui/components/WmsConnectionBadge.tsx
import { Box, Typography, useTheme } from '@mui/material';
import { Wifi, WifiOff } from 'lucide-react';

/**
 * WMS CONNECTION BADGE (WM-24)
 * -----------------------------
 * Always-visible connection indicator for WMS operator UI.
 * Shows queued scan count when offline so operator knows
 * scans are safely stored and will sync on reconnect.
 *
 * Renders inline — place in pick/pack session header.
 */

interface WmsConnectionBadgeProps {
  isOnline: boolean;
  queuedCount: number;
}

export function WmsConnectionBadge({ isOnline, queuedCount }: WmsConnectionBadgeProps) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.25,
        borderRadius: 1,
        bgcolor: isOnline
          ? theme.palette.success.light + '22'
          : theme.palette.warning.light + '33',
        border: '1px solid',
        borderColor: isOnline
          ? theme.palette.success.light
          : theme.palette.warning.main,
      }}
    >
      {isOnline ? (
        <Wifi size={12} color={theme.palette.success.main} />
      ) : (
        <WifiOff size={12} color={theme.palette.warning.main} />
      )}
      <Typography
        variant="caption"
        sx={{
          color: isOnline ? theme.palette.success.main : theme.palette.warning.main,
          fontWeight: 600,
          fontSize: 11,
        }}
      >
        {isOnline
          ? 'Online'
          : queuedCount > 0
          ? `Offline — ${queuedCount} scan${queuedCount > 1 ? 's' : ''} queued`
          : 'Offline'}
      </Typography>
    </Box>
  );
}