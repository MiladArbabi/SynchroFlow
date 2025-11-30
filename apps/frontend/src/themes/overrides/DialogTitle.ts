// apps/frontend/src/themes/overrides/DialogTitle.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

// Type for the config entry
type DialogTitleComponentConfig = Components<Theme>['MuiDialogTitle'];

// ==============================|| OVERRIDES - DIALOG TITLE ||============================== //

export default function DialogTitle(): DialogTitleComponentConfig {
    return {
        styleOverrides: {
            root: {
                fontSize: '1.25rem', // Keep font size override
                padding: '16px 24px', // Standard MUI padding, adjust if needed
            }
        }
    };
}