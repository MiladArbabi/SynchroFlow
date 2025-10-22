/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/themes/overrides/Select.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
import { selectClasses } from '@mui/material/Select'; // Import class keys

// Type for the config entry
type SelectComponentConfig = Components<Theme>['MuiSelect'];

// ==============================|| OVERRIDES - SELECT ||============================== //

export default function Select(): SelectComponentConfig {
    return {
        styleOverrides: {
            // Target the 'select' class key (the input element itself)
            select: {
                // Remove background color change on focus (if using OutlinedInput/InputBase background)
                '&:focus': {
                    backgroundColor: 'transparent'
                }
            },
            // Add overrides for 'icon', 'iconOpen', 'nativeInput' etc. if needed
            // Example: Style the dropdown icon
            // icon: {
            //    color: theme.palette.action.active,
            // }
        }
    };
}