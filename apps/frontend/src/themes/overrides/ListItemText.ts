// apps/frontend/src/themes/overrides/ListItemText.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

// Type for the config entry
type ListItemTextComponentConfig = Components<Theme>['MuiListItemText'];

// ==============================|| OVERRIDES - LIST ITEM TEXT ||============================== //

export default function ListItemText(theme: Theme): ListItemTextComponentConfig {
    return {
        styleOverrides: {
            // Target the 'primary' class key for the main text
            primary: {
                // Use standard theme palette key. Assuming 'text.dark' meant primary text.
                color: theme.palette.text.primary // Adjusted from text.dark
            },
            // Add overrides for 'secondary' class key if needed
            // secondary: {
            //     color: theme.palette.text.secondary,
            // }
        }
    };
}