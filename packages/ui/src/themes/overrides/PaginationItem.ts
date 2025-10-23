// packages/ui/src/themes/overrides/PaginationItem.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

type PaginationItemComponentConfig = Components<Theme>['MuiPaginationItem'];

export default function PaginationItem(): PaginationItemComponentConfig {
    return {
        styleOverrides: {
            root: {
                margin: '3px'
            }
        }
    };
}