import { Grid } from '@mui/material';
import type { ReactNode } from 'react';
import { FT2_TOKENS } from './tokens';

export type FT2RowProps = {
  children: ReactNode;
  /**
   * Semantic column count for FT2 grammar
   * Example: 3 → 3 equal surfaces on desktop
   */
  columns?: number;
};

export function FT2Row({ children, columns }: FT2RowProps) {
  const columnCount = columns ?? 1;
  const size = Math.floor(12 / columnCount);

  return (
    <Grid
      columns={12}
      spacing={FT2_TOKENS.colGap / 8}
      data-ft2-row
      data-ft2-columns={columns ?? 'auto'}
    >
      {Array.isArray(children)
        ? children.map((child, index) => (
            <Grid
              key={index}
              size={{ xs: 12, md: size }}
            >
              {child}
            </Grid>
          ))
        : (
          <Grid size={12}>
            {children}
          </Grid>
        )}
    </Grid>
  );
}