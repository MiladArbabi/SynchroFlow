import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useReducer, useState, useMemo } from 'react';
import { Stack, Button, Typography, } from '@mui/material';
import { DatePicker, LocalizationProvider, } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { FT2PresetSelector } from './FT2PresetSelector.js';
import { ft2PresetReducer, } from './FT2PresetSelector.state.js';
// ─────────────────────────────────────────────
// Initial reducer state
// ─────────────────────────────────────────────
const INITIAL_STATE = {
    kind: 'semantic',
    preset: 'past_30_days',
};
export function FT2DateRangeBar({ value, onChange, }) {
    const [state, dispatch] = useReducer(ft2PresetReducer, INITIAL_STATE);
    // Draft state (UI-only, never inferred)
    const [draftFrom, setDraftFrom] = useState(null);
    const [draftTo, setDraftTo] = useState(null);
    // Tracks currently visible calendar month
    const [activeMonth, setActiveMonth] = useState(null);
    // ─────────────────────────────────────────────
    // Validation (UI-only)
    // ─────────────────────────────────────────────
    const validationError = useMemo(() => {
        if (!draftFrom || !draftTo)
            return null;
        if (!draftFrom.isValid() || !draftTo.isValid()) {
            return 'Invalid date';
        }
        if (!draftFrom.isBefore(draftTo)) {
            return '"From" must be earlier than "To"';
        }
        return null;
    }, [draftFrom, draftTo]);
    const canApply = !!draftFrom &&
        !!draftTo &&
        validationError === null;
    // ─────────────────────────────────────────────
    // Restrict selection to visible month only
    // ─────────────────────────────────────────────
    function restrictToVisibleMonth(date) {
        if (!activeMonth)
            return false;
        return (date.month() !== activeMonth.month() ||
            date.year() !== activeMonth.year());
    }
    // ─────────────────────────────────────────────
    // Handlers
    // ─────────────────────────────────────────────
    function handlePresetSelect(preset) {
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
        if (!canApply || !draftFrom || !draftTo)
            return;
        onChange({
            preset: 'custom',
            from: draftFrom.toISOString(),
            to: draftTo.toISOString(),
        });
    }
    // ─────────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────────
    return (_jsx(LocalizationProvider, { dateAdapter: AdapterDayjs, children: _jsxs(Stack, { spacing: 1, pt: 1, children: [_jsx(FT2PresetSelector, { preset: value.preset, onSelect: handlePresetSelect }), state.kind === 'custom' && (_jsxs(Stack, { spacing: 1, px: 4, children: [_jsxs(Stack, { direction: "row", spacing: 2, alignItems: "flex-end", children: [_jsx(DatePicker, { label: "From", value: draftFrom, onChange: (v) => setDraftFrom(v), onMonthChange: (month) => setActiveMonth(month.startOf('month')), shouldDisableDate: restrictToVisibleMonth, slotProps: {
                                        textField: {
                                            size: 'small',
                                            error: !!validationError,
                                            placeholder: '',
                                        },
                                    } }), _jsx(DatePicker, { label: "To", value: draftTo, onChange: (v) => setDraftTo(v), onMonthChange: (month) => setActiveMonth(month.startOf('month')), shouldDisableDate: restrictToVisibleMonth, slotProps: {
                                        textField: {
                                            size: 'small',
                                            error: !!validationError,
                                            placeholder: '',
                                        },
                                    } }), _jsx(Button, { variant: "contained", disabled: !canApply, onClick: confirmCustom, children: "Apply" })] }), validationError && (_jsx(Typography, { variant: "caption", color: "error", children: validationError }))] }))] }) }));
}
//# sourceMappingURL=FT2DateRangeBar.js.map