import { Button, ButtonGroup, Box } from '@mui/material';
import type { FT2DateRangePreset } from '../contracts/ft2DateRange';

const PRESETS: { label: string; value: FT2DateRangePreset }[] = [
  { label: 'Today', value: 'today' },
  { label: 'This week', value: 'this_week' },
  { label: 'Past 7 days', value: 'past_7_days' },
  { label: 'This month', value: 'this_month' },
  { label: 'Past 30 days', value: 'past_30_days' },
  { label: 'Custom', value: 'custom' },
];

export interface FT2PresetSelectorProps {
  preset: FT2DateRangePreset;
  onSelect: (preset: FT2DateRangePreset) => void;
}

export function FT2PresetSelector({
  preset,
  onSelect,
}: FT2PresetSelectorProps) {
  return (
    <Box px={4}>
      <ButtonGroup size="small" aria-label="FT2 preset selector">
        {PRESETS.map(({ label, value }) => {
          const active = preset === value;

          return (
            <Button
              key={value}
              variant={active ? 'contained' : 'outlined'}
              aria-pressed={active}
              onClick={() => onSelect(value)}
            >
              {value === 'custom' ? `${label}…` : label}
            </Button>
          );
        })}
      </ButtonGroup>
    </Box>
  );
}
