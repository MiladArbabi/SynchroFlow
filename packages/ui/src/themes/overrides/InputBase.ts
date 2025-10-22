// packages/ui/src/themes/overrides/InputBase.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

// Type for the config entry
type InputBaseComponentConfig = Components<Theme>['MuiInputBase'];

// ==============================|| OVERRIDES - INPUT BASE ||============================== //

export default function InputBase(theme: Theme): InputBaseComponentConfig {
    return {
        styleOverrides: {
            // Target the 'input' class key
            input: {
                // Use standard palette keys ('text.primary' or 'text.secondary')
                color: theme.palette.text.primary, // Adjusted from text.dark
                // Style the placeholder pseudo-element
                '&::placeholder': {
                    color: theme.palette.text.secondary,
                    fontSize: '0.875rem',
                    opacity: 0.75 // Example: Adjust opacity if needed
                }
            },
            // Add overrides for 'root', 'adornedStart', 'adornedEnd', etc. if needed
            // root: { ... },
        }
    };
}