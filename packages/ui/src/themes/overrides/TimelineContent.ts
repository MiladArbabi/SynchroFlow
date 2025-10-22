/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/themes/overrides/TimelineContent.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
// Import TimelineContent specific types if available and needed after installing @mui/lab
// import { TimelineContentProps } from '@mui/lab/TimelineContent';

// Use a generic type or 'any' if specific type augmentation isn't set up for @mui/lab
type TimelineContentComponentConfig = Components<Theme>['MuiTimelineContent'] | any;

// ==============================|| OVERRIDES - TIMELINE CONTENT ||============================== //

export default function TimelineContent(theme: Theme): TimelineContentComponentConfig {
    return {
        // Target the MuiTimelineContent component key
        MuiTimelineContent: {
            styleOverrides: {
                // Target the root class key
                root: {
                    // Use standard theme palette key (assuming text.dark meant primary text)
                    color: theme.palette.text.primary,
                    fontSize: '1rem' // Use rem units ('16px' is equivalent)
                }
                // Add overrides for positionLeft, positionRight, positionAlternate if needed
            }
        }
    };
}