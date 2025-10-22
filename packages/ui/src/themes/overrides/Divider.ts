// packages/ui/src/themes/overrides/Divider.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

// Type for the config entry
type DividerComponentConfig = Components<Theme>['MuiDivider'];

// ==============================|| OVERRIDES - DIVIDER ||============================== //

export default function Divider(theme: Theme): DividerComponentConfig {
    return {
        styleOverrides: {
            root: {
                // Use standard theme palette divider color
                borderColor: theme.palette.divider,
                opacity: 0.6 // Example: Match original Berry opacity if needed
            }
        }
    };
}