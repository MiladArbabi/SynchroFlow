// project imports
import { withAlpha } from 'utils/colorUtils';

// ==============================|| OVERRIDES - AUTOCOMPLETE ||============================== //

export default function Autocomplete(theme, borderRadius) {
  return {
    MuiAutocomplete: {
      styleOverrides: {
        root: {
          '& .MuiAutocomplete-tag': {
            background: theme.vars.palette.secondary.light,
            borderRadius: 4,
            color: theme.vars.palette.text.dark,
            '.MuiChip-deleteIcon': {
              color: theme.vars.palette.secondary[200],

              ...theme.applyStyles('dark', {
                color: withAlpha(theme.vars.palette.text.primary, 0.8)
              })
            },

            ...theme.applyStyles('dark', {
              background: withAlpha(theme.vars.palette.text.primary, 0.2)
            })
          }
        },
        popper: {
          borderRadius: `${borderRadius}px`,
          boxShadow: '0px 8px 10px -5px rgb(0 0 0 / 20%), 0px 16px 24px 2px rgb(0 0 0 / 14%), 0px 6px 30px 5px rgb(0 0 0 / 12%)'
        }
      }
    }
  };
}
