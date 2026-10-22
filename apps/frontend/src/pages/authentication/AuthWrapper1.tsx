/* eslint-disable @typescript-eslint/no-unused-vars */
// material-ui
import { styled, Theme } from '@mui/material/styles';
import { CSSProperties } from 'react';
import { tokenCssVars } from '../../themes/tokens';

// ==============================|| AUTHENTICATION 1 WRAPPER ||============================== //

// AUTH-V2 (2026-07-19): auth is ALWAYS dark, regardless of app color scheme.
// Light/dark toggle applies post-login (AppLayout) only — see auth_blueprint
// "Target Design — Auth v2". Instead of hardcoding colors in every auth
// component, this wrapper locally re-declares the scheme-scoped tokens to
// their dark values (generated from themes/tokens.ts, so they cannot drift)
// so all children inherit dark rendering automatically.
const AuthWrapper1 = styled('div')({
  position: 'relative', // C3': anchor for AuthGridBackdrop (absolute-positioned)
  minHeight: '100vh',
  backgroundColor: 'var(--bg)',
  // Dark values straight from themes/tokens.ts — no hand-copied hex to drift.
  ...tokenCssVars('dark'),
} as CSSProperties);

export default AuthWrapper1;