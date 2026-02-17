import { Box } from '@mui/material';
import { FT2EmptyState } from './FT2EmptyState.js';
import { FT2_TOKENS } from '../layout/ft2.tokens.js';

export type FT2RatioProps = {
  numerator: number | null;
  denominator: number | null;
  label?: string;
};

export function FT2Ratio({
  numerator,
  denominator,
  label,
}: FT2RatioProps) {
  if (numerator === null && denominator === null) {
    return <FT2EmptyState />;
  }

  return (
    <Box
      data-ft2-ratio
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minWidth: 0,
      }}
    >
      {/* Ratio values */}
      <Box
        data-ft2-ratio-values
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 0.75,
        }}
      >
        {numerator !== null && (
          <Box
            data-ft2-ratio-numerator
            sx={{
              ...FT2_TOKENS.typography.kpiValue,
              whiteSpace: 'nowrap',
            }}
          >
            {numerator}
          </Box>
        )}

        {denominator !== null && (
          <Box
            data-ft2-ratio-denominator
            sx={{
              ...FT2_TOKENS.typography.kpiUnit,
              whiteSpace: 'nowrap',
            }}
          >
            / {denominator}
          </Box>
        )}
      </Box>

      {/* Optional label */}
      {label && (
        <Box
          data-ft2-ratio-label
          sx={{
            ...FT2_TOKENS.typography.hint,
            mt: 0.5,
          }}
        >
          {label}
        </Box>
      )}
    </Box>
  );
}