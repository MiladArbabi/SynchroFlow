import { Box } from '@mui/material';
import { FT2_TOKENS } from '../layout/ft2.tokens';

export type FT2LegendItem = {
  label: string;
};

export type FT2LegendProps = {
  items: FT2LegendItem[] | null;
};

/**
 * FT2Legend
 * ---------
 * Categorical context only.
 * Never instructional. Never semantic.
 */
export function FT2Legend({ items }: FT2LegendProps) {
  if (!items || items.length === 0) return null;

  return (
    <Box
      data-ft2-legend
      sx={{
        display: 'flex',
        gap: 1.25,
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}
    >
      {items.map((item, idx) => (
        <Box
          key={idx}
          data-ft2-legend-item
          sx={{
            ...FT2_TOKENS.typography.hint,
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}
        >
          {item.label}
        </Box>
      ))}
    </Box>
  );
}
