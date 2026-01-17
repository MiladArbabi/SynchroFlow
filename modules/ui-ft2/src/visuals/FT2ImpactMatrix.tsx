import { Fragment } from 'react';
import { Box, Typography } from '@mui/material';

export type FT2ImpactCell = {
  x: string;
  y: string;
  value: number | null;
};

export type FT2ImpactMatrixProps = {
  xLabels: string[] | null;
  yLabels: string[] | null;
  cells: FT2ImpactCell[] | null;
};

export function FT2ImpactMatrix({
  xLabels,
  yLabels,
  cells,
}: FT2ImpactMatrixProps) {
  if (
    !xLabels ||
    !yLabels ||
    !cells ||
    xLabels.length === 0 ||
    yLabels.length === 0
  ) {
    return (
      <Box
        data-testid="ft2-empty-state"
        sx={{ width: '100%', height: '100%' }}
      />
    );
  }

  const cellMap = new Map<string, number | null>();
  cells.forEach((cell) => {
    cellMap.set(`${cell.x}::${cell.y}`, cell.value);
  });

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `auto repeat(${xLabels.length}, 1fr)`,
        gap: 1,
      }}
    >
      {/* Top-left empty corner */}
      <Box />

      {/* X axis labels */}
      {xLabels.map((x) => (
        <Typography key={x} variant="caption">
          {x}
        </Typography>
      ))}

      {/* Rows */}
      {yLabels.map((y) => (
        <Fragment key={y}>
          {/* Y axis label */}
          <Typography variant="caption">{y}</Typography>

          {/* Cells */}
          {xLabels.map((x) => {
            const value = cellMap.get(`${x}::${y}`) ?? null;

            return (
              <Box
                key={`${x}-${y}`}
                data-testid="ft2-impact-cell"
                sx={{
                  border: '1px solid rgba(0,0,0,0.12)',
                  minHeight: 24,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="caption">
                  {value ?? '—'}
                </Typography>
              </Box>
            );
          })}
        </Fragment>
      ))}
    </Box>
  );
}