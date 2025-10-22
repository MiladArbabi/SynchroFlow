// packages/ui/src/themes/overrides/CardHeader.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

// Type for the config entry
type CardHeaderComponentConfig = Components<Theme>['MuiCardHeader'];

// ==============================|| OVERRIDES - CARD HEADER ||============================== //

export default function CardHeader(theme: Theme): CardHeaderComponentConfig {
    return {
        styleOverrides: {
            root: {
                // Use standard palette keys. 'text.primary' or 'text.secondary' are common.
                // Berry's 'text.dark' might map to 'text.primary' in standard MUI dark mode.
                color: theme.palette.text.primary, // Adjusted from theme.vars.palette.text.dark
                padding: '24px' // Keep padding override
            },
            title: {
                fontSize: '1.125rem' // Keep font size override
            }
            // Add overrides for 'subheader', 'avatar', 'action' if needed
        }
    };
}