import { useReducer, useState, useMemo } from 'react';
import {
  Stack,
  Button,
  Typography,
  TextField,
} from '@mui/material';

import {
  DatePicker,
  LocalizationProvider,
} from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';

import { Dayjs } from 'dayjs';

import type { FT2DateRange } from '../contracts/ft2DateRange';
import { FT2PresetSelector } from './FT2PresetSelector';
import {
  ft2PresetReducer,
  FT2PresetSelectorState,
} from './FT2PresetSelector.state';

// ─────────────────────────────────────────────
// Initial reducer state
// ─────────────────────────────────────────────
const INITIAL_STATE: FT2PresetSelectorState = {
  kind: 'semantic',
  preset: 'past_7_days',
};

export interface FT2DateRangeBarProps {
  value: FT2DateRange;
  onChange: (range: FT2DateRange) => void;
}

export function FT2DateRangeBar({
  value,
  onChange,
}: FT2DateRangeBarProps) {
  const [state, dispatch] = useReducer(
    ft2PresetReducer,
    INITIAL_STATE
  );

  // Draft state (UI-only, never inferred)
  const [draftFrom, setDraftFrom] = useState<Dayjs | null>(null);
  const [draftTo, setDraftTo] = useState<Dayjs | null>(null);

  // Tracks currently visible calendar month
  const [activeMonth, setActiveMonth] = useState<Dayjs | null>(null);

  // ─────────────────────────────────────────────
  // Validation (UI-only)
  // ─────────────────────────────────────────────
  const validationError = useMemo(() => {
    if (!draftFrom || !draftTo) return null;

    if (!draftFrom.isValid() || !draftTo.isValid()) {
      return 'Invalid date';
    }

    if (!draftFrom.isBefore(draftTo)) {
      return '"From" must be earlier than "To"';
    }

    return null;
  }, [draftFrom, draftTo]);

  const canApply =
    !!draftFrom &&
    !!draftTo &&
    validationError === null;

  // ─────────────────────────────────────────────
  // Restrict selection to visible month only
  // ─────────────────────────────────────────────
  function restrictToVisibleMonth(date: Dayjs) {
    if (!activeMonth) return false;

    return (
      date.month() !== activeMonth.month() ||
      date.year() !== activeMonth.year()
    );
  }

  // ─────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────
  function handlePresetSelect(
    preset: FT2DateRange['preset']
  ) {
    dispatch({ type: 'SELECT_PRESET', preset });

    if (preset === 'custom') {
      return;
    }

    // Semantic presets only
    setDraftFrom(null);
    setDraftTo(null);
    setActiveMonth(null);

    onChange({
      preset,
      from: null,
      to: null,
    });
  }

  function confirmCustom() {
    if (!canApply || !draftFrom || !draftTo) return;

    onChange({
      preset: 'custom',
      from: draftFrom.toISOString(),
      to: draftTo.toISOString(),
    });
  }

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Stack spacing={1} pt={1}>
        <FT2PresetSelector
          preset={value.preset}
          onSelect={handlePresetSelect}
        />

        {state.kind === 'custom' && (
          <Stack spacing={1} px={4}>
            <Stack direction="row" spacing={2} alignItems="flex-end">
              <DatePicker
                label="From"
                value={draftFrom}
                onChange={(v) => setDraftFrom(v)}
                onMonthChange={(month) =>
                  setActiveMonth(month.startOf('month'))
                }
                shouldDisableDate={restrictToVisibleMonth}
                slotProps={{
                  textField: {
                    size: 'small',
                    error: !!validationError,
                    placeholder: '',
                  },
                }}
              />

              <DatePicker
                label="To"
                value={draftTo}
                onChange={(v) => setDraftTo(v)}
                onMonthChange={(month) =>
                  setActiveMonth(month.startOf('month'))
                }
                shouldDisableDate={restrictToVisibleMonth}
                slotProps={{
                  textField: {
                    size: 'small',
                    error: !!validationError,
                    placeholder: '',
                  },
                }}
              />

              <Button
                variant="contained"
                disabled={!canApply}
                onClick={confirmCustom}
              >
                Apply
              </Button>
            </Stack>

            {validationError && (
              <Typography
                variant="caption"
                color="error"
              >
                {validationError}
              </Typography>
            )}
          </Stack>
        )}
      </Stack>
    </LocalizationProvider>
  );
}