/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/themes/overrides/Button.tsx
// NOTE: Contains Slider overrides.

import { Theme } from '@mui/material/styles';
// Import the specific types needed
import { ComponentsOverrides } from '@mui/material/styles';
import { SliderClassKey } from '@mui/material/Slider'; // Import the specific class keys
import { withAlpha } from 'utils/colorUtils';

// ==============================|| OVERRIDES - SLIDER (in Button.tsx) ||============================== //

// Define the specific return type matching ComponentsOverrides['MuiSlider']
// which is Partial<OverridesStyleRules<SliderClassKey, 'MuiSlider', Theme>>
type MuiSliderOverride = Partial<Record<SliderClassKey, Record<string, any>>>;

// Define the component override object structure for merging
type SliderComponentOverrides = Pick<ComponentsOverrides, 'MuiSlider'>;


export default function SliderOverrides(theme: Theme): SliderComponentOverrides {
    // --- FIX: Structure the return value to match OverridesStyleRules ---
    // The keys should be the Slider class keys ('root', 'mark', etc.) directly
    const sliderStyleOverrides: MuiSliderOverride = {
        root: { // Class key 'root'
            '&.Mui-disabled': {
                color: theme.palette.mode === 'dark'
                    ? withAlpha(theme.palette.text.primary || '#bdc8f0', 0.5)
                    : theme.palette.grey[300] || '#cdd5df',
            }
        },
        mark: { // Class key 'mark'
            backgroundColor: theme.palette.background.paper,
            width: '4px'
        },
        valueLabel: { // Class key 'valueLabel'
            color: theme.palette.mode === 'dark'
                ? theme.palette.primary.main
                : theme.palette.primary.light,
        }
        // Add other SliderClassKey overrides here if needed
    };

    // Return the object expected by the merge function in index.ts
    return {
        MuiSlider: sliderStyleOverrides // Assign the overrides object to the MuiSlider key
    };
}

/*
// --- Example MuiButton Overrides (Correct Structure based on types) ---
import { ButtonClassKey } from '@mui/material/Button';
type MuiButtonOverride = Partial<Record<ButtonClassKey, Record<string, any>>>;
type ButtonComponentOverrides = Pick<ComponentsOverrides, 'MuiButton'>;

export function ButtonOverrides(theme: Theme): ButtonComponentOverrides {
    const buttonStyleOverrides: MuiButtonOverride = {
        root: {
            // textTransform: 'none',
        },
        // other ButtonClassKey overrides...
    };
    return {
        MuiButton: buttonStyleOverrides
    };
}
*/