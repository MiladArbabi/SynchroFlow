/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/themes/overrides/Autocomplete.tsx
import { Theme } from '@mui/material/styles';
import { AutocompleteProps, autocompleteClasses, AutocompleteClassKey } from '@mui/material/Autocomplete'; // Import props type
import { Components } from '@mui/material/styles';
import { withAlpha } from 'utils/colorUtils';
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
                background: theme.palette.mode === 'dark'
                     ? withAlpha(theme.palette.text.primary || '#bdc8f0', 0.2) // Dark mode background
                     : theme.palette.secondary.light, // Light mode background
                borderRadius: 4, // Keep border radius
                color: theme.palette.text.primary, // Use primary text color in both modes? Adjust if needed.
                // Target delete icon within the tag
                [`.${autocompleteClasses.popupIndicator}, .${autocompleteClasses.clearIndicator}`]: { // Targeting internal classes might be brittle
                     color: theme.palette.mode === 'dark'
                          ? withAlpha(theme.palette.text.primary || '#bdc8f0', 0.8)
                          : theme.palette.secondary[200] || '#b39ddb', // Light mode icon color
                },
                // Specific class for delete icon
                 [`.${chipClasses.deleteIcon}`]: { // Targeting Chip's class is more stable
                       color: theme.palette.mode === 'dark'
                           ? withAlpha(theme.palette.text.primary || '#bdc8f0', 0.8)
                           : theme.palette.secondary[200] || '#b39ddb',
                       '&:hover': {
                           color: theme.palette.mode === 'dark'
                              ? theme.palette.text.primary // Dark hover
                              : theme.palette.secondary.main // Light hover
                       }
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