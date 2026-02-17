import { Box } from '@mui/material';
import { FT2_TOKENS } from '../layout/ft2.tokens.js';

/**
 * FT2EmptyState
 * -------------
 * Epistemic absence indicator.
 *
 * Rules:
 * - Always neutral
 * - Never attention-grabbing
 * - Same footprint as KPI content
 * - No color semantics
 */
export function FT2EmptyState() {
  return (
    <Box
      data-ft2-empty-state
      sx={{
        ...FT2_TOKENS.typography.kpiValue,
        opacity: 0.38,          // Matches MUI disabled text density
        textAlign: 'center',
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      —
    </Box>
  );
}
