import { Box, Typography } from '@mui/material';

export type FT2ScatterPoint = {
  x: number | null;
  y: number | null;
};

export type FT2ScatterProps = {
  points: FT2ScatterPoint[] | null;
  xLabel?: string;
  yLabel?: string;
};

export function FT2Scatter({
  points,
  xLabel,
  yLabel,
}: FT2ScatterProps) {
  const validPoints =
    points?.filter(
      (p): p is { x: number; y: number } =>
        p.x !== null && p.y !== null
    ) ?? [];

  if (!validPoints.length) {
    return (
      <Box
        data-testid="ft2-empty-state"
        sx={{ width: '100%', height: '100%' }}
      />
    );
  }

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      {(xLabel || yLabel) && (
        <Box sx={{ mb: 1 }}>
          {xLabel && (
            <Typography
              variant="caption"
              data-testid="ft2-x-axis-label"
            >
              {xLabel}
            </Typography>
          )}
          {yLabel && (
            <Typography
              variant="caption"
              data-testid="ft2-y-axis-label"
            >
              {yLabel}
            </Typography>
          )}
        </Box>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, 6px)',
          gap: '6px',
        }}
      >
        {validPoints.map((_, i) => (
          <Box
            key={i}
            data-testid="ft2-scatter-point"
            sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: 'currentColor',
            }}
          />
        ))}
      </Box>
    </Box>
  );
}