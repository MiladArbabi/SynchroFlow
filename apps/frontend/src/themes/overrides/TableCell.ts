// apps/frontend/src/themes/overrides/TableCell.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';
import { tableCellClasses } from '@mui/material/TableCell';

type TableCellComponentConfig = Components<Theme>['MuiTableCell'];

// CSS vars (themes/tokens.ts): overrides are built once, so palette.mode
// branches never see the dark scheme.
export default function TableCell(): TableCellComponentConfig {

    return {
        styleOverrides: {
            root: {
                borderColor: 'var(--rule)',
                [`&.${tableCellClasses.head}`]: {
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: 'var(--ink-2)',
                },
            },
        }
    };
}