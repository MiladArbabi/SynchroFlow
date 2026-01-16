import { useState } from 'react';
import { Box, Stack } from '@mui/material';
import { FT2_TOKENS } from './tokens';
import type { FT2DateRange, FT2DateRangePreset } from '../contracts/ft2DateRange';

export type FT2DateRangeBarProps = {
  value: FT2DateRange;
  onChange: (range: FT2DateRange) => void;
};

const PRESET_LABELS: Record<FT2DateRangePreset, string> = {
  today: 'Today',
  this_week: 'This week',
  last_week: 'Last week',
  past_7_days: 'Past 7 days',
  this_month: 'This month',
  last_month: 'Last month',
  past_30_days: 'Past 30 days',
  custom: 'Custom range',
};

const PRESETS: FT2DateRangePreset[] = [
  'today',
  'this_week',
  'last_week',
  'past_7_days',
  'this_month',
  'last_month',
  'past_30_days',
  'custom',
];

export function FT2DateRangeBar({ value, onChange }: FT2DateRangeBarProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (preset: FT2DateRangePreset) => {
    setOpen(false);

    if (preset === 'custom') {
      return;
    }

    onChange({
      preset,
      from: null,
      to: null,
    });
  };

  return (
    <Box
      data-ft2-date-range-bar
      sx={{
        height: FT2_TOKENS.controlZoneHeight,
        display: 'flex',
        alignItems: 'center',
        px: FT2_TOKENS.padding.desktop / 8,
      }}
    >
      {!open && (
        <Box
          role="button"
          aria-hidden={open}
          onClick={() => setOpen(true)}
          sx={{ cursor: 'pointer' }}
        >
          {PRESET_LABELS[value.preset]}
        </Box>
      )}

      {open && (
        <Stack
          sx={{
            position: 'absolute',
            mt: FT2_TOKENS.controlZoneHeight / 8,
            backgroundColor: 'background.paper',
            zIndex: 1,
          }}
        >
          {PRESETS.map((preset) => (
            <Box
              key={preset}
              onClick={() => handleSelect(preset)}
              sx={{ cursor: 'pointer' }}
            >
              {PRESET_LABELS[preset]}
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
