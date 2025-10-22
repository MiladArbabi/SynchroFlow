// packages/ui/src/themes/overrides/OutlinedInput.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
import { outlinedInputClasses } from '@mui/material/OutlinedInput'; // Import class keys if needed for specific selectors
import { inputBaseClasses } from '@mui/material/InputBase'; // Import InputBase classes
import { withAlpha } from 'utils/colorUtils'; // Ensure typed later

// Type for the config entry
type OutlinedInputComponentConfig = Components<Theme>['MuiOutlinedInput'];

// ==============================|| OVERRIDES - OUTLINED INPUT ||============================== //

export default function OutlinedInput(theme: Theme, borderRadius: number, outlinedFilled: boolean): OutlinedInputComponentConfig {
    const isDark = theme.palette.mode === 'dark';

    // Define conditional background colors
    const lightBg = outlinedFilled ? theme.palette.grey[50] || '#f8fafc' : 'transparent';
    const darkBg = outlinedFilled ? theme.palette.dark?.[800] || '#1a223f' : 'transparent'; // Use augmented dark or fallback

    return {
        styleOverrides: {
            root: {
                background: isDark ? darkBg : lightBg,
                borderRadius: `${borderRadius}px`,
                // Use standard pseudo-class for hover on root
                '&:hover': {
                    [`& .${outlinedInputClasses.notchedOutline}`]: { // Target notchedOutline on hover
                        borderColor: theme.palette.primary.light // Keep light primary on hover
                    }
                },
                // Style when focused
                [`&.${outlinedInputClasses.focused}`]: {
                    [`& .${outlinedInputClasses.notchedOutline}`]: {
                         borderColor: theme.palette.primary.main // Standard focus color
                    }
                },
                // Style when disabled
                [`&.${outlinedInputClasses.disabled}`]: {
                     background: isDark ? theme.palette.grey[800] : theme.palette.grey[100], // Example disabled background
                     [`& .${outlinedInputClasses.notchedOutline}`]: {
                        borderColor: theme.palette.action.disabledBackground
                     }
                },
                // Style multiline variant
                [`&.${inputBaseClasses.multiline}`]: {
                    padding: 1 // Keep padding override (might need units '1px'?)
                },
            },
            // Style the input element itself
            input: {
                fontWeight: 500,
                background: isDark ? darkBg : lightBg, // Apply background here too? Check visual effect
                padding: '15.5px 14px', // Keep padding
                borderRadius: `${borderRadius}px`, // Apply borderRadius here too

                // Style placeholder within input
                '&::placeholder': {
                    color: theme.palette.text.secondary,
                    fontSize: '0.875rem',
                    opacity: 0.75
                },

                // Style adjustments for small size
                [`&.${inputBaseClasses.inputSizeSmall}`]: {
                    padding: '10px 14px',
                    [`&.${inputBaseClasses.inputAdornedStart}`]: {
                        paddingLeft: 0 // Remove left padding when start adornment is present
                    }
                }
            },
            // Style when there's a start adornment
            inputAdornedStart: {
                paddingLeft: 4 // Keep padding override
            },
             // Style when there's an end adornment
             inputAdornedEnd: {
                 // Add styles if needed, e.g., paddingRight: 4
             },
            // Style the notched outline element
            notchedOutline: {
                borderRadius: `${borderRadius}px`,
                borderColor: isDark
                    ? withAlpha(theme.palette.text.primary || '#bdc8f0', 0.28) // Dark mode border
                    : theme.palette.grey[400] || '#cdd5df', // Light mode border
                // Ensure border color changes on error state
                [`&.${outlinedInputClasses.error}`]: {
                     borderColor: theme.palette.error.main
                }
            }
        }
    };
}