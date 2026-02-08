import { Box } from '@mui/material';
import { FT2_TOKENS } from './ft2.tokens';

export type FT2TextProps = {
  children: React.ReactNode;
  align?: 'left' | 'center' | 'right';
};

/**
 * FT2Text
 * -------
 * Non-KPI prose inside FT2 surfaces.
 *
 * Rules:
 * - Observational only
 * - No emphasis, no decoration
 * - Must not compete with KPI values
 * - Typography is locked to FT2 tokens
 */
export function FT2Text({
  children,
  align = 'left',
}: FT2TextProps) {
  return (
    <Box
      data-ft2-text
      sx={{
        ...FT2_TOKENS.typography.body,
        textAlign: align,
        whiteSpace: 'normal',
        wordBreak: 'break-word',
      }}
    >
      {children}
    </Box>
  );
}