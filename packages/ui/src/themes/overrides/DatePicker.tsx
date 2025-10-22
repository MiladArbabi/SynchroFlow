/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/themes/overrides/DatePicker.tsx
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
import React from 'react'; // Import React for JSX

// assets
import CalendarTodayTwoToneIcon from '@mui/icons-material/CalendarTodayTwoTone'; // Correct import name

// --- DatePicker Type Imports (Assuming @mui/x-date-pickers is installed) ---
// If not installed, these lines will cause errors. Comment them out or install the package.
import { DatePickerProps } from '@mui/x-date-pickers/DatePicker';
type DatePickerComponentConfig = Components<Theme>['MuiDatePicker'];
// --- End DatePicker Type Imports ---

// ==============================|| OVERRIDES - DATE PICKER ||============================== //

export default function DatePicker(): DatePickerComponentConfig {
    return {
        // Apply default props for MuiDatePicker
        defaultProps: {
            // Use slots prop to customize the icon
            slots: {
                openPickerIcon: () => <CalendarTodayTwoToneIcon />
            },
            // Add other useful defaults:
            // slotProps: {
            //     textField: { size: 'small' }, // Example: Default to small text field
            //     actionBar: { actions: ['clear', 'today'] } // Example: Customize actions
            // },
        },
        // Add styleOverrides here if needed
        // styleOverrides: {
        //    root: { ... },
        //    input: { ... },
        // }
    };
}

// You might need overrides for related components like MuiPickersLayout, MuiPickersToolbar, etc.
// Example:
// export function PickersLayoutOverrides(theme: Theme): Components<Theme>['MuiPickersLayout'] {
//     return { styleOverrides: { root: { ... } } };
// }