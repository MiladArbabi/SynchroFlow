// material-ui
import { styled, Theme } from '@mui/material/styles';

// ==============================|| AUTHENTICATION 1 WRAPPER ||============================== //

const AuthWrapper1 = styled('div')(({ theme }: { theme: Theme }) => ({
  backgroundColor: (theme as any).vars?.palette?.grey?.[100] ?? theme.palette.background.paper,
    ...theme.applyStyles('dark', { backgroundColor: (theme as any).vars?.palette?.background?.default ?? theme.palette.background.default }),
  minHeight: '100vh'
}));

export default AuthWrapper1;
