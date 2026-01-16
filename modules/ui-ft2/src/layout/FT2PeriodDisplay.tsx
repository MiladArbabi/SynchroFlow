import { Typography } from '@mui/material';

interface FT2PeriodDisplayProps {
  from: string | null;
  to: string | null;
}

export function FT2PeriodDisplay({
  from,
  to,
}: FT2PeriodDisplayProps) {
  if (!from || !to) {
    return (
      <Typography variant="caption" color="text.secondary">
        Period resolved by backend
      </Typography>
    );
  }

  return (
    <Typography variant="caption" color="text.secondary">
      {from} → {to}
    </Typography>
  );
}