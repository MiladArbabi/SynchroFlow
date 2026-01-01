import { Paper, Stack, Typography, Button, Box } from '@mui/material';

export type FinancesDiagnosticCardProps = {
  title: string;
  message: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
  testId?: string;
};

/**
 * FinancesDiagnosticCard
 * ------------------------
 * FT1-presentational diagnostic surface for finances.
 *
 * Invariants:
 * - No logic
 * - No routing
 * - No lifecycle awareness
 * - One message, one optional CTA
 */
export function FinancesDiagnosticCard({
  title,
  message,
  ctaLabel,
  onCtaClick,
  testId,
}: FinancesDiagnosticCardProps) {
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
              console.debug('[FinancesDiagnosticCard] CTA clicked', {
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