// modules/analytics/src/ui/components/AnalyticsDiagnosticCard.tsx
import { Paper, Stack, Typography, Button } from '@mui/material';

export type AnalyticsDiagnosticCardProps = {
  title: string;
  message: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
  testId?: string;
};

export function AnalyticsDiagnosticCard({
  title,
  message,
  ctaLabel,
  onCtaClick,
  testId,
}: AnalyticsDiagnosticCardProps) {
  return (
    <Paper elevation={1} sx={{ p: 2 }} data-testid={testId}>
      <Stack spacing={1}>
        <Typography variant="h6">{title}</Typography>

        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>

        {ctaLabel && onCtaClick && (
          <Button
            type="button"
            size="small"
            variant="contained"
            onClick={(e) => {
              console.debug('[AnalyticsDiagnosticCard] CTA clicked', {
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
