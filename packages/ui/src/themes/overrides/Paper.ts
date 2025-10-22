// packages/ui/src/themes/overrides/Paper.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

// Type for the config entry
type PaperComponentConfig = Components<Theme>['MuiPaper'];

// ==============================|| OVERRIDES - PAPER ||============================== //

// Add borderRadius parameter type
export default function Paper(borderRadius: number): PaperComponentConfig {
    return {
        // Keep defaultProps
        defaultProps: {
            elevation: 0 // Default to no elevation
        },
        styleOverrides: {
            // Target the root class key
            root: {
                backgroundImage: 'none' // Remove background image by default
            },
            // Target the rounded class key
            rounded: {
                borderRadius: `${borderRadius}px` // Apply theme border radius
            }
            // Add overrides for elevation class keys ('elevation0', 'elevation1', etc.) if needed
        }
    };
}