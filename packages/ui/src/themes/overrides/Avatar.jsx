// ==============================|| OVERRIDES - AVATAR ||============================== //

export default function Avatar(theme) {
  return {
    MuiAvatar: {
      styleOverrides: {
        root: {
          // Define CSS variables for default colors
          '--avatar-default-color': theme.vars.palette.primary.dark,
          '--avatar-default-bg': theme.vars.palette.primary[200],

          // Apply dark mode variables
          ...theme.applyStyles('dark', {
            '--avatar-default-color': theme.vars.palette.dark.main,
            '--avatar-default-bg': theme.vars.palette.text.primary
          }),

          // Use the variables
          color: 'var(--avatar-default-color)',
          backgroundColor: 'var(--avatar-default-bg)'
        }
      }
    }
  };
}
