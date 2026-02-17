import { Box } from '@mui/material';
import { FT2EmptyState } from './FT2EmptyState.js';
import { FT2_TOKENS } from '../layout/ft2.tokens.js';

export type FT2StatProps = {
  value: number | string | null;
  label?: string;
  unit?: string;
};

export function FT2Stat({ value, label, unit }: FT2StatProps) {
  if (value === null) {
    return <FT2EmptyState />;
  }

  return (
    <Box
      data-ft2-stat
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minWidth: 0,
      }}
    >
      {/* KPI Value */}
      <Box
        data-ft2-stat-value
        sx={{
          ...FT2_TOKENS.typography.kpiValue,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </Box>

      {/* Optional Unit */}
      {unit && (
        <Box
          data-ft2-stat-unit
          sx={FT2_TOKENS.typography.kpiUnit}
        >
          {unit}
        </Box>
      )}

      {/* Optional Label */}
      {label && (
        <Box
          data-ft2-stat-label
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