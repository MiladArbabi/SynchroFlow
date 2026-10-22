/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/themes/overrides/Autocomplete.tsx
import { Theme } from '@mui/material/styles';
import { AutocompleteProps, autocompleteClasses, AutocompleteClassKey } from '@mui/material/Autocomplete'; // Import props type
import { Components } from '@mui/material/styles';
import { chipClasses } from '@mui/material/Chip';

// Define the component override object structure for merging
type AutocompleteComponentConfig = Components<Theme>['MuiAutocomplete'];

// ==============================|| OVERRIDES - AUTOCOMPLETE ||============================== //

// Add borderRadius parameter
export default function Autocomplete(theme: Theme, borderRadius: number): AutocompleteComponentConfig {
    return {
        // No defaultProps specified in original
        styleOverrides: {
            root: { // Override root styles if needed
                // Example: Adjust padding if necessary
                // padding: '...'
            },
            tag: { // Override styles for the tag class key
                background: 'var(--bg-3)',
                borderRadius: 4, // Keep border radius
                color: theme.palette.text.primary, // Use primary text color in both modes? Adjust if needed.
                // Target delete icon within the tag
                [`.${autocompleteClasses.popupIndicator}, .${autocompleteClasses.clearIndicator}`]: { // Targeting internal classes might be brittle
                     color: 'var(--ink-3)',
                },
                // Specific class for delete icon
                 [`.${chipClasses.deleteIcon}`]: { // Targeting Chip's class is more stable
                       color: 'var(--ink-3)',
                       '&:hover': { color: 'var(--ink)' }
                 }
            },
            popper: { // Override styles for the popper class key
                borderRadius: `${borderRadius}px`, // Use passed borderRadius
                // Use standard theme shadows
                boxShadow: theme.shadows[8] // Example using shadow scale
            },
             listbox: { // Override listbox styles if needed
                 // padding: theme.spacing(1), // Example padding
             },
             option: { // Override option styles if needed
                 // '&:hover': { backgroundColor: theme.palette.action.hover }
             }
        }
    };
}