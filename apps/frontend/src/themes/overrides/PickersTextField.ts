/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/themes/overrides/PickersTextField.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
import { outlinedInputClasses } from '@mui/material/OutlinedInput'; // Import class keys

// Use 'any' or augment mui.d.ts
type PickersTextFieldComponentConfig = any;

export default function PickersTextField(theme: Theme, borderRadius: number, outlinedFilled: boolean): PickersTextFieldComponentConfig {
    const isDark = theme.palette.mode === 'dark';
    const lightBg = outlinedFilled ? theme.palette.grey[50] || '#f8fafc' : 'transparent';
    const darkBg = outlinedFilled ? theme.palette.dark?.[800] || '#1a223f' : 'transparent';

    return {
        // Key might need verification, check DatePicker internals
        MuiPickersTextField: {
            styleOverrides: {
                root: {
                    background: isDark ? darkBg : lightBg,
                    borderRadius: `${borderRadius}px`,
                    // Target underlying OutlinedInput root
                    [`& .${outlinedInputClasses.root}`]: {
                         borderRadius: `${borderRadius}px`
                     },
                     // Target internal section container - INSPECT RENDERED HTML if not working
                     '& .MuiInputBase-input > div[class*="sectionsContainer"]': {
                        fontWeight: 500
                     },
                }
            }
        }
    };
}