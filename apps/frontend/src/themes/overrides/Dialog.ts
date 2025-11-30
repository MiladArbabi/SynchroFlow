// apps/frontend/src/themes/overrides/Dialog.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

// Type for the config entry
type DialogComponentConfig = Components<Theme>['MuiDialog'];

// ==============================|| OVERRIDES - DIALOG ||============================== //

export default function Dialog(): DialogComponentConfig {
    return {
        styleOverrides: {
            // Target the 'paper' class key for styling the dialog container
            paper: {
                padding: '12px 0 12px 0', // Keep padding override
                // Add other paper styles if needed, e.g., borderRadius
                // borderRadius: theme.shape.borderRadius * 2,
            }
        }
    };
}