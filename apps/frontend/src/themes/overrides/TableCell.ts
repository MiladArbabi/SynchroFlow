// apps/frontend/src/themes/overrides/TableCell.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
import { tableCellClasses } from '@mui/material/TableCell';
import { withAlpha } from 'utils/colorUtils';

type TableCellComponentConfig = Components<Theme>['MuiTableCell'];

export default function TableCell(theme: Theme): TableCellComponentConfig {
    const isDark = theme.palette.mode === 'dark';

    return {
        styleOverrides: {
            root: {
                borderColor: isDark
                    ? withAlpha(theme.palette.text.primary || '#bdc8f0', 0.15)
                    : theme.palette.grey[200] || '#e3e8ef',
                [`&.${tableCellClasses.head}`]: {
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: isDark
                        ? theme.palette.grey[600] || '#4b5565'
                        : theme.palette.grey[900] || '#121926',
                },
            },
        }
    };
}