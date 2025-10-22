// project imports
import { withAlpha } from 'utils/colorUtils';

// ==============================|| OVERRIDES - LIST ITEM BUTTON ||============================== //

export default function ListItemButton(theme) {
  return {
    MuiListItemButton: {
      styleOverrides: {
        root: {
          color: theme.vars.palette.text.primary,
          paddingTop: '10px',
          paddingBottom: '10px',

          '&.Mui-selected': {
            color: theme.vars.palette.secondary.dark,
            backgroundColor: theme.vars.palette.secondary.light,
            '&:hover': {
              backgroundColor: theme.vars.palette.secondary.light
            },
            '& .MuiListItemIcon-root': {
              color: theme.vars.palette.secondary.dark
            },

            ...theme.applyStyles('dark', {
              color: theme.vars.palette.secondary.main,
              '& .MuiListItemIcon-root': {
                color: theme.vars.palette.secondary.main
              },
              backgroundColor: withAlpha(theme.vars.palette.secondary.main, 0.15),
              '&:hover': {
                backgroundColor: withAlpha(theme.vars.palette.secondary.main, 0.15)
              }
            })
          },

          '&:hover': {
            backgroundColor: theme.vars.palette.secondary.light,
            color: theme.vars.palette.secondary.dark,
            '& .MuiListItemIcon-root': {
              color: theme.vars.palette.secondary.dark
            },

            ...theme.applyStyles('dark', {
              color: theme.vars.palette.secondary.main,
              backgroundColor: withAlpha(theme.vars.palette.secondary.main, 0.15),
              '& .MuiListItemIcon-root': {
                color: theme.vars.palette.secondary.main
              }
            })
          }
        }
      }
    }
  };
}
