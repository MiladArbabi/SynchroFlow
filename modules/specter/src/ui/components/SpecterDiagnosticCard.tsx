// ⚠️ HARD RULE:
// This component MUST stay API-compatible with OrderNexusDiagnosticCard.
// Any prop change must be applied to BOTH.

import { Paper, Stack, Typography, Button } from '@mui/material';

export type SpecterDiagnosticCardProps = {
  title: string;
  message: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
  testId?: string;
};

/**
 * SpecterDiagnosticCard
 * ---------------------
 * FT1-presentational diagnostic surface.
 *
 * MUST mirror OrderNexusDiagnosticCard exactly.
 */
export function SpecterDiagnosticCard({
  title,
  message,
  ctaLabel,
  onCtaClick,
  testId,
}: SpecterDiagnosticCardProps) {
  return (
    <Paper elevation={1} sx={{ p: 2 }} data-testid={testId}>
      <Stack spacing={1}>
        <Typography variant="h6">{title}</Typography>

        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>

        {ctaLabel && onCtaClick && (
          <Button
            size="small"
            variant="contained"
            onClick={onCtaClick}
            sx={{ alignSelf: 'flex-start', mt: 1 }}
          >
            {ctaLabel}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
