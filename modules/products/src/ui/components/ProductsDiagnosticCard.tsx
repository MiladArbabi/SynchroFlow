// modules/products/src/ui/components/ProductsDiagnosticCard.tsx

import { Paper, Stack, Typography, Button, Box } from '@mui/material';

export type ProductsDiagnosticCardProps = {
  title: string;
  message: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
  testId?: string;
};

/**
 * ProductsDiagnosticCard
 * ----------------------
 * FT1-presentational diagnostic surface.
 *
 * Invariants:
 * - No logic
 * - No routing
 * - No lifecycle awareness
 * - One message, one optional CTA
 */
export function ProductsDiagnosticCard({
  title,
  message,
  ctaLabel,
  onCtaClick,
  testId,
}: ProductsDiagnosticCardProps) {
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
          bgcolor: 'warning.main',
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
            onClick={() => onCtaClick?.()}
            sx={{ alignSelf: 'flex-start', mt: 1 }}
          >
            {ctaLabel}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}