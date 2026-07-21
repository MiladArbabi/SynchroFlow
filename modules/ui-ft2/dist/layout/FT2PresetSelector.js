import { jsx as _jsx } from "react/jsx-runtime";
import { Button, ButtonGroup, Box } from '@mui/material';
const PRESETS = [
    { label: 'Today', value: 'today' },
    { label: 'This week', value: 'this_week' },
    { label: 'Past 7 days', value: 'past_7_days' },
    { label: 'This month', value: 'this_month' },
    { label: 'Past 30 days', value: 'past_30_days' },
    { label: 'Custom', value: 'custom' },
];
export function FT2PresetSelector({ preset, onSelect, }) {
    return (_jsx(Box, { px: 4, children: _jsx(ButtonGroup, { size: "small", "aria-label": "FT2 preset selector", children: PRESETS.map(({ label, value }) => {
                const active = preset === value;
                return (_jsx(Button, { variant: active ? 'contained' : 'outlined', "aria-pressed": active, onClick: () => onSelect(value), children: value === 'custom' ? `${label}…` : label }, value));
            }) }) }));
}
//# sourceMappingURL=FT2PresetSelector.js.map