/* eslint-disable @typescript-eslint/no-unused-vars */
// material-ui
import { styled, Theme } from '@mui/material/styles';
import { CSSProperties } from 'react';

// ==============================|| AUTHENTICATION 1 WRAPPER ||============================== //

// AUTH-V2 (2026-07-19): auth is ALWAYS dark, regardless of app color scheme.
// Light/dark toggle applies post-login (AppLayout) only — see auth_blueprint
// "Target Design — Auth v2". Instead of hardcoding colors in every auth
// component, this wrapper locally re-declares the scheme-scoped tokens to
// their dark values (copied verbatim from themes/index.tsx dark block) so all
// children inherit dark rendering automatically. Keep in sync with the theme's
// dark block if those values ever change.
const AuthWrapper1 = styled('div')({
  position: 'relative', // C3': anchor for AuthGridBackdrop (absolute-positioned)
  minHeight: '100vh',
  backgroundColor: '#151D29', // --space-1 / dark --bg
  '--bg':            '#151D29',
  '--bg-2':          '#1C2740',
  '--bg-3':          '#243050',
  '--surface':       '#1C2740',
  '--ink':           '#F0EEE8',
  '--ink-2':         '#C8C4BB',
  '--ink-3':         '#8B8F9A',
  '--ink-4':         '#5A5F6E',
  '--rule':          'rgba(255,255,255,0.08)',
  '--rule-2':        'rgba(255,255,255,0.14)',
  '--accent-ghost':  'rgba(255,107,43,0.12)',
  '--accent-border': 'rgba(255,107,43,0.25)',
   // --accent / --accent-hover / --accent-ink identical in both modes — no override needed
} as CSSProperties);

export default AuthWrapper1;