// packages/ui/src/themes/overrides/PaginationItem.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

// Type for the config entry
type PaginationItemComponentConfig = Components<Theme>['MuiPaginationItem'];

// ==============================|| OVERRIDES - PAGINATION ITEM ||============================== //

export default function PaginationItem(): PaginationItemComponentConfig {
    return {
        styleOverrides: {
            // Target the root class key
            root: {
                margin: '3px' // Keep margin override
            },
            // Add overrides for other class keys like 'page', 'sizeSmall', 'sizeLarge', 'circular', 'outlined', 'text', 'disabled', 'selected' if needed
            // Example:
            // selected: {
            //     fontWeight: 'bold',
            // }
        }
    };
}