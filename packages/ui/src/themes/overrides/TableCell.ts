// packages/ui/src/themes/overrides/TableCell.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
import { tableCellClasses } from '@mui/material/TableCell'; // Import class keys
import { withAlpha } from 'utils/colorUtils'; // Ensure typed later

// Type for the config entry
type TableCellComponentConfig = Components<Theme>['MuiTableCell'];

// ==============================|| OVERRIDES - TABLE CELL ||============================== //

export default function TableCell(theme: Theme): TableCellComponentConfig {
    const isDark = theme.palette.mode === 'dark';

    return {
        styleOverrides: {
            // Target the root class key
            root: {
                borderColor: isDark
                    ? withAlpha(theme.palette.text.primary || '#bdc8f0', 0.15) // Dark mode border
                    : theme.palette.grey[200] || '#e3e8ef', // Light mode border
                // Apply head styles using the head class key selector
                [`&.${tableCellClasses.head}`]: { // Use class key for specificity
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: isDark
                        ? theme.palette.grey[600] || '#4b5565' // Dark mode head text
                        : theme.palette.grey[900] || '#121926', // Light mode head text
                },
                // Add overrides for body, footer, sizeSmall, paddingCheckbox etc. if needed
                // Example for body:
                // [`&.${tableCellClasses.body}`]: {
                //    color: theme.palette.text.secondary,
                // }
            },
             // Add specific overrides for class keys if root function isn't enough
             // head: {
             //      fontSize: '0.875rem', ...etc
             // },
             // body: { ... },
        }
    };
}