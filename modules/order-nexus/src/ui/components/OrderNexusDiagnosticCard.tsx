// modules/order-nexus/src/ui/components/OrderNexusDiagnosticCard.tsx

import { Paper, Stack, Typography, Button, Box } from '@mui/material';

export type OrderNexusDiagnosticCardProps = {
  title: string;
  message: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
  testId?: string;
};

/**
 * OrderNexusDiagnosticCard
 * ------------------------
 * FT1-presentational diagnostic surface.
 *
 * Invariants:
 * - No logic
 * - No routing
 * - No lifecycle awareness
 * - One message, one optional CTA
 */
export function OrderNexusDiagnosticCard({
  title,
  message,
  ctaLabel,
  onCtaClick,
  testId,
}: OrderNexusDiagnosticCardProps) {
  return (
   <Paper
      elevation={0}
      data-testid={testId}
      sx={{
        display: 'flex',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      {/* Left diagnostic rail */}
      <Box
        sx={{
          width: 4,
          bgcolor: 'info.main',
        }}
      />

      {/* Content */}
      <Stack spacing={1.25} sx={{ p: 2, flex: 1 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {title}
        </Typography>

        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>

        {ctaLabel && onCtaClick && (
          <Button
            type="button"
            size="small"
            variant="contained"
            onClick={(e) => {
              console.debug('[OrderNexusDiagnosticCard] CTA clicked', {
                hasHandler: Boolean(onCtaClick),
                eventType: e.type,
              });
              onCtaClick?.();
            }}
            sx={{ alignSelf: 'flex-start', mt: 1 }}
          >
            {ctaLabel}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
