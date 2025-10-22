// project imports
import { withAlpha } from 'utils/colorUtils';

// ==============================|| OVERRIDES - TABLE CELL ||============================== //

export default function TableCell(theme) {
  return {
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: theme.vars.palette.grey[200],

          '&.MuiTableCell-head': {
            fontSize: '0.875rem',
            color: theme.vars.palette.grey[900],
            fontWeight: 500
          },

          ...theme.applyStyles('dark', {
            borderColor: withAlpha(theme.vars.palette.text.primary, 0.15),

            '&.MuiTableCell-head': {
              color: theme.vars.palette.grey[600]
            }
          })
        }
      }
    }
  };
}
