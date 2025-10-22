// ==============================|| OVERRIDES - PICKERS TEXT FIELD ||============================== //

export default function PickersTextField(theme, borderRadius, outlinedFilled) {
  return {
    MuiPickersTextField: {
      styleOverrides: {
        root: {
          borderRadius: `${borderRadius}px`,
          '& .MuiPickersOutlinedInput-root': {
            borderRadius: `${borderRadius}px`
          },
          background: outlinedFilled ? theme.vars.palette.grey[50] : 'transparent',
          '& .MuiPickersInputBase-sectionsContainer': {
            fontWeight: 500
          },

          ...theme.applyStyles('dark', {
            background: outlinedFilled ? theme.vars.palette.dark[800] : 'transparent'
          })
        }
      }
    }
  };
}
