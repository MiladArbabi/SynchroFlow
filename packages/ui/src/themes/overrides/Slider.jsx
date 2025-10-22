// project imports
import { withAlpha } from 'utils/colorUtils';

// ==============================|| OVERRIDES - SLIDER ||============================== //

export default function Slider(theme) {
  return {
    MuiSlider: {
      styleOverrides: {
        root: {
          '&.Mui-disabled': {
            color: theme.vars.palette.grey[300],

            ...theme.applyStyles('dark', {
              color: withAlpha(theme.vars.palette.text.primary, 0.5)
            })
          }
        },
        mark: {
          backgroundColor: theme.vars.palette.background.paper,
          width: '4px'
        },
        valueLabel: {
          color: theme.vars.palette.primary.light,

          ...theme.applyStyles('dark', {
            color: theme.vars.palette.primary.main
          })
        }
      }
    }
  };
}
