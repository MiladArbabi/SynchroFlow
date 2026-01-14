import { Grid } from '@mui/material';
import type { ReactNode } from 'react';
import { FT2_TOKENS } from './tokens';

/**
 * FT2RowIntent
 * ------------
 * Semantic layout intent for FT2 rows.
 * Determines column count and vertical height.
 */
export type FT2RowIntent = 'kpi' | 'analysis' | 'support';

export type FT2RowProps = {
  children: ReactNode;
  intent: FT2RowIntent;
};

export function FT2Row({ children, intent }: FT2RowProps) {
  const rowConfig = FT2_TOKENS.row[intent];
  const columnSize = Math.floor(12 / rowConfig.columns);

  return (
    <Grid
      container
      columns={12}
      spacing={FT2_TOKENS.colGap / 8}
      data-ft2-row
      data-ft2-intent={intent}
      sx={{
        height: {
          xs: 'auto',
          md: rowConfig.height,
        },
        alignItems: 'stretch',
      }}
    >
      {Array.isArray(children)
        ? children.map((child, index) => (
            <Grid
              key={index}
              size={{ xs: 12, md: columnSize }}
              sx={{
                height: {
                  xs: 'auto',
                  md: '100%',
                },
                display: 'flex',
                minWidth: 0,
              }}
            >
              {child}
            </Grid>
          ))
        : (
          <Grid
            size={12}
            sx={{
              height: {
                xs: 'auto',
                md: '100%',
              },
              display: 'flex',
              minWidth: 0,
            }}
          >
            {children}
          </Grid>
        )}
    </Grid>
  );
}