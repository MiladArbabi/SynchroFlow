/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/themes/overrides/TimelineDot.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
// Import TimelineDot specific types if available and needed
// import { TimelineDotProps } from '@mui/lab/TimelineDot';

// Use a generic type or 'any'
type TimelineDotComponentConfig = Components<Theme>['MuiTimelineDot'] | any;

// ==============================|| OVERRIDES - TIMELINE DOT ||============================== //

export default function TimelineDot(): TimelineDotComponentConfig {
    return {
        // Target the MuiTimelineDot component key
        MuiTimelineDot: {
            styleOverrides: {
                // Target the root class key
                root: {
                    boxShadow: 'none' // Remove default shadow
                }
                // Add overrides for filled, outlined, filledGrey, outlinedGrey etc. if needed
            }
        }
    };
}