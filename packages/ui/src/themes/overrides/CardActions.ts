// packages/ui/src/themes/overrides/CardActions.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

// Type for the config entry
type CardActionsComponentConfig = Components<Theme>['MuiCardActions'];

// ==============================|| OVERRIDES - CARD ACTIONS ||============================== //

// No theme needed for this specific override
export default function CardActions(): CardActionsComponentConfig {
    return {
        styleOverrides: {
            root: {
                padding: '16px 24px' // Adjust padding (original just had '24px')
                // Add alignment overrides if needed (e.g., justifyContent: 'flex-end')
            }
        }
    };
}