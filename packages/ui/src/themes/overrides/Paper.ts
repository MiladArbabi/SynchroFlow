// packages/ui/src/themes/overrides/Paper.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

type PaperComponentConfig = Components<Theme>['MuiPaper'];

export default function Paper(borderRadius: number): PaperComponentConfig {
    return {
        defaultProps: {
            elevation: 0
        },
        styleOverrides: {
            root: {
                backgroundImage: 'none'
            },
            rounded: {
                borderRadius: `${borderRadius}px`
            }
        }
    };
}