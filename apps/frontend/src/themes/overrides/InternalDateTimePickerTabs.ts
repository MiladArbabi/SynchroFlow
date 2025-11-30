/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/themes/overrides/InternalDateTimePickerTabs.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
import { withAlpha } from 'utils/colorUtils'; // Ensure typed later

// --- Type Imports for Date Pickers (Assuming @mui/x-date-pickers) ---
// This internal component might not have explicit theme augmentation.
// We might need to use 'any' or define a custom type if needed.
// type InternalDateTimePickerTabsComponentConfig = Components<Theme>['MuiInternalDateTimePickerTabs']; // This key likely won't exist
type InternalDateTimePickerTabsComponentConfig = any; // Use 'any' for now
// --- End Type Imports ---


// ==============================|| OVERRIDES - INTERNAL DATE TIME PICKER TABS ||============================== //

export default function InternalDateTimePickerTabs(theme: Theme): InternalDateTimePickerTabsComponentConfig {
    return {
        // Key for the internal component (might change between MUI versions)
        MuiInternalDateTimePickerTabs: {
            styleOverrides: {
                // Target the 'tabs' class key
                tabs: {
                    backgroundColor: theme.palette.mode === 'dark'
                        ? theme.palette.dark?.[900] || '#111936' // Use augmented dark or fallback
                        : theme.palette.primary.light, // Light mode background

                    '& .MuiTabs-flexContainer': {
                        borderColor: theme.palette.mode === 'dark'
                            ? withAlpha(theme.palette.text.primary || '#bdc8f0', 0.2) // Dark border
                            : theme.palette.primary[200] || '#90caf9', // Light border
                    },
                    '& .MuiTab-root': {
                        color: theme.palette.mode === 'dark'
                            ? theme.palette.text.secondary // Dark text
                            : theme.palette.grey[900] || '#121926', // Light text
                    },
                    '& .MuiTabs-indicator': {
                        backgroundColor: theme.palette.primary.dark, // Keep dark in both modes?
                    },
                    '& .Mui-selected': {
                        color: theme.palette.primary.dark, // Keep dark in both modes?
                    },
                }
                // Add overrides for other class keys if necessary
            }
        }
    };
}