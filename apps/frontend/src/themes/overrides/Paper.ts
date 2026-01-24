// apps/frontend/src/themes/overrides/Paper.ts
import { Theme } from '@mui/material/styles';
import { Components } from '@mui/material/styles';

type PaperComponentConfig = Components<Theme>['MuiPaper'];

export default function Paper(borderRadius: number): PaperComponentConfig {
  return {
    defaultProps: {
      elevation: 0,
    },
    styleOverrides: {
      root: {
        backgroundImage: 'none',

        /**
         * Structural shadow only.
         * Must match FT2 surface compression.
         * No semantic elevation.
         */
        boxShadow: 'var(--ft2-surface-shadow)',

        '&:hover': {
          boxShadow: 'var(--ft2-surface-shadow-hover)',
        },
      },
      rounded: {
        borderRadius: `${borderRadius}px`,
      },
    },
  };
};