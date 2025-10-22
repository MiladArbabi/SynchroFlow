/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/themes/overrides/DataGrid.tsx
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
// --- DataGrid Type Imports (Assuming @mui/x-data-grid is installed) ---
// If not installed, these lines will cause errors. Comment them out or install the package.
import { DataGridProps } from '@mui/x-data-grid';
type DataGridComponentConfig = Components<Theme>['MuiDataGrid'];
// --- End DataGrid Type Imports ---

import { withAlpha } from 'utils/colorUtils';

// ==============================|| OVERRIDES - DATA GRID ||============================== //

export default function DataGrid(theme: Theme): DataGridComponentConfig {
    // const schemeTheme = theme.colorSchemes; // Not standard, avoid if possible

    return {
        // Default props from original
        defaultProps: {
            rowHeight: 54,
            // Add other useful defaults if needed:
            // autoHeight: true,
            // density: 'standard',
            // disableColumnMenu: true,
            // hideFooterSelectedRowCount: true,
        },
        styleOverrides: {
            root: {
                borderWidth: 0, // Remove outer border
                // Styles for grouped headers (if used)
                '& .MuiDataGrid-columnHeader--filledGroup': {
                    borderBottomWidth: 0
                },
                '& .MuiDataGrid-columnHeader--emptyGroup': {
                    borderBottomWidth: 0
                },
                // Styles for input fields within the grid (e.g., filters)
                '& .MuiFormControl-root > .MuiInputBase-root': {
                    backgroundColor: `${theme.palette.background.default} !important`, // Use !important carefully
                    borderColor: `${theme.palette.divider} !important`,
                    ...(theme.palette.mode === 'dark' && {
                        borderColor: `${withAlpha(theme.palette.divider, 0.05)} !important`
                    })
                }
            },
            withBorderColor: { // Style for bordered variant
                borderColor: theme.palette.mode === 'dark'
                    ? withAlpha(theme.palette.divider, 0.15) // Use calculated dark border
                    : theme.palette.divider, // Standard divider color
            },
            toolbarContainer: {
                // Padding adjustment for toolbar buttons
                '& .MuiButton-root': {
                    paddingLeft: '16px !important',
                    paddingRight: '16px !important'
                }
            },
            columnHeader: {
                color: theme.palette.grey[600] || '#4b5565', // Header text color with fallback
                paddingLeft: '24px', // Consistent padding
                paddingRight: '24px',
                borderBottom: `1px solid ${theme.palette.divider}`, // Add a subtle bottom border
            },
            footerContainer: {
                // Remove double border at the bottom when bordered
                '&.MuiDataGrid-withBorderColor': {
                    borderBottom: 'none'
                },
                borderTop: `1px solid ${theme.palette.divider}`, // Ensure top border exists
            },
            // Remove extra padding around checkboxes
            columnHeaderCheckbox: {
                paddingLeft: 0,
                paddingRight: 0
            },
            cellCheckbox: {
                paddingLeft: 0,
                paddingRight: 0
            },
            cell: {
                paddingLeft: '24px', // Consistent padding
                paddingRight: '24px',
                borderColor: theme.palette.mode === 'dark'
                    ? withAlpha(theme.palette.divider, 0.15) // Dark mode cell border
                    : theme.palette.divider, // Light mode cell border
                // Styles for custom rendered cells with status indicators
                '&.MuiDataGrid-cell--withRenderer > div': {
                    // Base styles (can be adjusted)
                    borderRadius: '4px',
                    padding: '2px 8px',
                    color: theme.palette.mode === 'dark' ? theme.palette.grey[50] : theme.palette.text.primary, // Adjust text color for dark

                    // Status background colors
                    '& > .high': {
                        background: theme.palette.mode === 'dark' ? theme.palette.success.dark : theme.palette.success.light
                    },
                    '& > .medium': {
                        background: theme.palette.mode === 'dark' ? theme.palette.warning.dark : theme.palette.warning.light
                    },
                    '& > .low': {
                        background: theme.palette.mode === 'dark' ? theme.palette.error.dark : theme.palette.error.light
                    },
                },
                 // Ensure cell has bottom border (DataGrid defaults might vary)
                 borderBottom: `1px solid ${theme.palette.mode === 'dark'
                    ? withAlpha(theme.palette.divider, 0.15)
                    : theme.palette.divider}`,

            },
            // Ensure the last row doesn't have a bottom border if not needed
            // '& .MuiDataGrid-row:last-child > .MuiDataGrid-cell': {
            //    borderBottom: 'none',
            // }
        }
    };
}