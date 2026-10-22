/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/themes/overrides/DataGrid.tsx
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
// --- DataGrid Type Imports (Assuming @mui/x-data-grid is installed) ---
// If not installed, these lines will cause errors. Comment them out or install the package.
import { DataGridProps } from '@mui/x-data-grid';
type DataGridComponentConfig = Components<Theme>['MuiDataGrid'];
// --- End DataGrid Type Imports ---


// ==============================|| OVERRIDES - DATA GRID ||============================== //

export default function DataGrid(_theme: Theme): DataGridComponentConfig {
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
                    backgroundColor: 'var(--bg) !important',
                    borderColor: 'var(--rule) !important',
                }
            },
            withBorderColor: { // Style for bordered variant
                borderColor: 'var(--rule)',
            },
            toolbarContainer: {
                // Padding adjustment for toolbar buttons
                '& .MuiButton-root': {
                    paddingLeft: '16px !important',
                    paddingRight: '16px !important'
                }
            },
            columnHeader: {
                color: 'var(--ink-3)', // Header text color with fallback
                paddingLeft: '24px', // Consistent padding
                paddingRight: '24px',
                borderBottom: '1px solid var(--rule)',
            },
            footerContainer: {
                // Remove double border at the bottom when bordered
                '&.MuiDataGrid-withBorderColor': {
                    borderBottom: 'none'
                },
                borderTop: '1px solid var(--rule)',
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
                borderColor: 'var(--rule)',
                // Styles for custom rendered cells with status indicators
                '&.MuiDataGrid-cell--withRenderer > div': {
                    // Base styles (can be adjusted)
                    borderRadius: '4px',
                    padding: '2px 8px',
                    color: 'var(--ink)', // Adjust text color for dark

                    // Status background colors
                    '& > .high': {
                        background: 'var(--good-ghost)'
                    },
                    '& > .medium': {
                        background: 'var(--warning-ghost)'
                    },
                    '& > .low': {
                        background: 'var(--critical-ghost)'
                    },
                },
                 // Ensure cell has bottom border (DataGrid defaults might vary)
                 borderBottom: '1px solid var(--rule)',

            },
            // Ensure the last row doesn't have a bottom border if not needed
            // '& .MuiDataGrid-row:last-child > .MuiDataGrid-cell': {
            //    borderBottom: 'none',
            // }
        }
    };
}