// project imports
import { withAlpha } from 'utils/colorUtils';

// ==============================|| OVERRIDES - INTERNAL DATE TIME PICKER TABS ||============================== //

export default function InternalDateTimePickerTabs(theme) {
  return {
    MuiInternalDateTimePickerTabs: {
      styleOverrides: {
        tabs: {
          backgroundColor: theme.vars.palette.primary.light,

          '& .MuiTabs-flexContainer': {
            borderColor: theme.vars.palette.primary[200]
          },

          '& .MuiTab-root': {
            color: theme.vars.palette.grey[900]
          },

          '& .MuiTabs-indicator': {
            backgroundColor: theme.vars.palette.primary.dark
          },

          '& .Mui-selected': {
            color: theme.vars.palette.primary.dark
          },

          ...theme.applyStyles('dark', {
            backgroundColor: theme.vars.palette.dark[900],

            '& .MuiTabs-flexContainer': {
              borderColor: withAlpha(theme.vars.palette.text.primary, 0.2)
            },

            '& .MuiTab-root': {
              color: theme.vars.palette.text.secondary
            }
          })
        }
      }
    }
  };
}
