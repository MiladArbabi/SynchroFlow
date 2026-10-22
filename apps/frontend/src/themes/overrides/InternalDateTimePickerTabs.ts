/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/themes/overrides/InternalDateTimePickerTabs.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

// --- Type Imports for Date Pickers (Assuming @mui/x-date-pickers) ---
// This internal component might not have explicit theme augmentation.
// We might need to use 'any' or define a custom type if needed.
// type InternalDateTimePickerTabsComponentConfig = Components<Theme>['MuiInternalDateTimePickerTabs']; // This key likely won't exist
type InternalDateTimePickerTabsComponentConfig = any; // Use 'any' for now
// --- End Type Imports ---


// ==============================|| OVERRIDES - INTERNAL DATE TIME PICKER TABS ||============================== //

export default function InternalDateTimePickerTabs(_theme: Theme): InternalDateTimePickerTabsComponentConfig {
    return {
        // Key for the internal component (might change between MUI versions)
        MuiInternalDateTimePickerTabs: {
            styleOverrides: {
                // Target the 'tabs' class key
                tabs: {
                    backgroundColor: 'var(--bg-2)',

                    '& .MuiTabs-flexContainer': {
                        borderColor: 'var(--rule)',
                    },
                    '& .MuiTab-root': {
                        color: 'var(--ink-3)',
                    },
                    '& .MuiTabs-indicator': {
                        backgroundColor: 'var(--accent)',
                    },
                    '& .Mui-selected': {
                        color: 'var(--accent-text)',
                    },
                }
                // Add overrides for other class keys if necessary
            }
        }
    };
}