import { Typography } from '@mui/material';

export type FT2AxisLabelProps = {
  label: string | null;
};

export function FT2AxisLabel({ label }: FT2AxisLabelProps) {
  if (!label) return null;

  return (
    <Typography
      variant="caption"
      data-testid="ft2-axis-label"
    >
      {label}
    </Typography>
  );
}