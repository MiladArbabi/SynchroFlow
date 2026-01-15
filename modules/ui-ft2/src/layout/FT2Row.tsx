import { Grid } from '@mui/material';
import type { ReactNode, ReactElement } from 'react';
import { FT2_TOKENS } from './tokens';
import type { FT2SurfaceProps } from './FT2Surface';

export type FT2RowIntent = 'kpi' | 'analysis' | 'support';

export type FT2RowProps = {
  children: ReactNode;
  intent: FT2RowIntent;
};

export function FT2Row({ children, intent }: FT2RowProps) {
  const rowConfig = FT2_TOKENS.row[intent];

  const items = Array.isArray(children) ? children : [children];

  // 1️⃣ Extract spans (default = 1)
  const spans = items.map((child) => {
    if (
      typeof child === 'object' &&
      child !== null &&
      'props' in child
    ) {
      const props = (child as ReactElement<FT2SurfaceProps>).props;
      return props.span ?? 1;
    }
    return 1;
  });

  // 2️⃣ Compute proportional width
  const totalSpan = spans.reduce((a, b) => a + b, 0);
  const unitSize = 12 / totalSpan;

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
      {items.map((child, index) => (
        <Grid
          key={index}
          size={{
            xs: 12,
            md: Math.round(unitSize * spans[index]),
          }}
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
      ))}
    </Grid>
  );
}