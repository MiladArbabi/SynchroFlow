import { Box, Typography, Button } from '@mui/material';

export type FT2SignalBannerSeverity =
  | 'critical'
  | 'warning'
  | 'info';

export type FT2SignalBannerProps = {
  severity?: FT2SignalBannerSeverity;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

/**
 * FT2 SIGNAL BANNER
 * -----------------
 * Reusable operational signal surface.
 *
 * Design purpose:
 * - highlight operational incidents
 * - surface actionable system signals
 * - support rapid operator scanning
 *
 * Used across FT2 modules (orders, inventory, finance, etc).
 */
export function FT2SignalBanner({
  severity = 'info',
  title,
  description,
  actionLabel,
  onAction,
}: FT2SignalBannerProps) {

  const color =
    severity === 'critical'
      ? '#C62828'
      : severity === 'warning'
      ? '#F9A825'
      : '#1976D2';

  return (
    <Box
      data-ft2-signal-banner
      data-severity={severity}
      sx={{
        borderLeft: `4px solid ${color}`,
        borderRadius: 1,
        border: '1px solid var(--ft2-surface-divider)',
        px: 2,
        py: 1.5,
        mb: 1.5,
        background: 'var(--ft2-surface-bg)',
      }}
    >
      <Typography fontWeight={600}>
        {title}
      </Typography>

      {description && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {description}
        </Typography>
      )}

      {actionLabel && (
        <Button
          size="small"
          sx={{ mt: 1 }}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      )}
    </Box>
  );
}