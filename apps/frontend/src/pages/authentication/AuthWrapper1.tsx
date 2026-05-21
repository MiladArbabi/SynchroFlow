// material-ui
import { styled, Theme } from '@mui/material/styles';

// ==============================|| AUTHENTICATION 1 WRAPPER ||============================== //

// THEME-003: use LaSyncro CSS token var(--bg) — not MUI grey[100] (undefined in palette).
// var(--bg) is scheme-scoped in themes/index.tsx → correct in both light and dark.
const AuthWrapper1 = styled('div')({
  backgroundColor: 'var(--bg)',
  minHeight: '100vh',
});

export default AuthWrapper1;