// apps/frontend/src/themes/overrides/Tooltip.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

// Type for the config entry
type TooltipComponentConfig = Components<Theme>['MuiTooltip'];

// ==============================|| OVERRIDES - TOOLTIP ||============================== //

export default function Tooltip(theme: Theme): TooltipComponentConfig {
    return {
        styleOverrides: {
            // Target the 'tooltip' class key
            tooltip: {
                margin: 0,
                lineHeight: 1.4,
                // Use standard theme palette keys
                color: theme.palette.background.paper, // Text color
                backgroundColor: theme.palette.text.primary // Background color
            },
            // Add overrides for 'arrow' if needed
            // arrow: {
            //     color: theme.palette.text.primary,
            // }
        }
    };
}