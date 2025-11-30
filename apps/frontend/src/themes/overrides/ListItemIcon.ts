// apps/frontend/src/themes/overrides/ListItemIcon.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

// Type for the config entry
type ListItemIconComponentConfig = Components<Theme>['MuiListItemIcon'];

// ==============================|| OVERRIDES - LIST ITEM ICON ||============================== //

export default function ListItemIcon(theme: Theme): ListItemIconComponentConfig {
    return {
        styleOverrides: {
            root: {
                // Use standard theme palette key
                color: theme.palette.text.primary,
                minWidth: '36px' // Keep minWidth override
            }
        }
    };
}