/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/themes/overrides/PickersTextField.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
import { outlinedInputClasses } from '@mui/material/OutlinedInput'; // Import class keys

// Use 'any' or augment mui.d.ts
type PickersTextFieldComponentConfig = any;

export default function PickersTextField(_theme: Theme, borderRadius: number, outlinedFilled: boolean): PickersTextFieldComponentConfig {
    // CSS var (themes/tokens.ts) so the filled background follows the scheme.
    const filledBg = outlinedFilled ? 'var(--bg-2)' : 'transparent';

    return {
        // Key might need verification, check DatePicker internals
        MuiPickersTextField: {
            styleOverrides: {
                root: {
                    background: filledBg,
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