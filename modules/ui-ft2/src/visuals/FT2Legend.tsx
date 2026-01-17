import { Box, Typography } from '@mui/material';

export type FT2LegendItem = {
  label: string;
};

export type FT2LegendProps = {
  items: FT2LegendItem[] | null;
};

export function FT2Legend({ items }: FT2LegendProps) {
  if (!items || items.length === 0) return null;

  return (
    <Box
      data-testid="ft2-legend"
      sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}
    >
      {items.map((item, idx) => (
        <Typography
          key={idx}
          variant="caption"
          data-testid="ft2-legend-item"
        >
          {item.label}
        </Typography>
      ))}
    </Box>
  );
}