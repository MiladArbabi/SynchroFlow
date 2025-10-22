/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/themes/overrides/PickersTextField.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
// Import TextField classes if needed for selectors
import { outlinedInputClasses } from '@mui/material/OutlinedInput';


// --- Type Imports for Date Pickers (Assuming @mui/x-date-pickers) ---
// This internal component might not have explicit theme augmentation.
// We'll use 'any' or a custom type.
type PickersTextFieldComponentConfig = any; // Use 'any' for now
// --- End Type Imports ---


// ==============================|| OVERRIDES - PICKERS TEXT FIELD ||============================== //

export default function PickersTextField(theme: Theme, borderRadius: number, outlinedFilled: boolean): PickersTextFieldComponentConfig {
    const isDark = theme.palette.mode === 'dark';

    // Define conditional background colors
    const lightBg = outlinedFilled ? theme.palette.grey[50] || '#f8fafc' : 'transparent';
    const darkBg = outlinedFilled ? theme.palette.dark?.[800] || '#1a223f' : 'transparent';

    return {
        // Key for the internal component (might change)
        MuiPickersTextField: { // Note: Check if this key actually exists in theme.components after creation
            styleOverrides: {
                // Target the root (likely corresponds to the TextField root)
                root: {
                    background: isDark ? darkBg : lightBg,
                    borderRadius: `${borderRadius}px`,

                    // Target the underlying OutlinedInput root for border radius
                     // Use specific class from date pickers if available, otherwise fallback
                    [`& .${outlinedInputClasses.root}`]: { // Targeting OutlinedInput's root
                         borderRadius: `${borderRadius}px`
                     },
                     // Target internal section container for font weight
                     // This selector might be brittle - inspect element if it doesn't work
                     '& .MuiInputBase-input > div[class*="sectionsContainer"]': { // Example selector, adjust based on inspection
                        fontWeight: 500
                     },
                     // Add hover/focus styles if needed
                     // '&:hover': { ... }
                }
            }
        }
    };
}