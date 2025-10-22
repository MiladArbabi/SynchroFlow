// project imports
import { withAlpha } from 'utils/colorUtils';

// ==============================|| OVERRIDES - OUTLINED INPUT ||============================== //

export default function OutlinedInput(theme, borderRadius, outlinedFilled) {
  return {
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          background: outlinedFilled ? theme.vars.palette.grey[50] : 'transparent',
          borderRadius: `${borderRadius}px`,

          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: theme.vars.palette.grey[400],
            ...theme.applyStyles('dark', {
              borderColor: withAlpha(theme.vars.palette.text.primary, 0.28)
            })
          },

          '&:hover $notchedOutline': {
            borderColor: theme.vars.palette.primary.light
          },

          '&.MuiInputBase-multiline': {
            padding: 1
          },

          ...theme.applyStyles('dark', {
            background: outlinedFilled ? theme.vars.palette.dark[800] : 'transparent'
          })
        },
        input: {
          fontWeight: 500,
          background: outlinedFilled ? theme.vars.palette.grey[50] : 'transparent',
          padding: '15.5px 14px',
          borderRadius: `${borderRadius}px`,

          '&.MuiInputBase-inputSizeSmall': {
            padding: '10px 14px',

            '&.MuiInputBase-inputAdornedStart': {
              paddingLeft: 0
            }
          },

          ...theme.applyStyles('dark', {
            background: outlinedFilled ? theme.vars.palette.dark[800] : 'transparent'
          })
        },
        inputAdornedStart: {
          paddingLeft: 4
        },
        notchedOutline: {
          borderRadius: `${borderRadius}px`
        }
      }
    }
  };
}
