import { Box } from '@mui/material';
import { FT2_TOKENS } from '../layout/tokens';

export type FT2AxisLabelProps = {
  label: string | null;
};

/**
 * FT2AxisLabel
 * ------------
 * Structural annotation only.
 * Never semantic. Never emphasized.
 */
export function FT2AxisLabel({ label }: FT2AxisLabelProps) {
  if (!label) return null;

  return (
    <Box
      data-ft2-axis-label
      sx={{
        ...FT2_TOKENS.typography.hint,
        textAlign: 'center',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Box>
  );
}
