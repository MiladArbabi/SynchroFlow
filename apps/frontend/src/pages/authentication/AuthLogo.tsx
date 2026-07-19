// apps/frontend/src/pages/authentication/AuthLogo.tsx
//
// Renders the correct logo for the active color scheme.
// logo-dark.png = white logo (dark backgrounds)
// logo.png      = dark logo  (light backgrounds)
//
// Drop-in replacement for all hardcoded logo-dark.png refs on auth pages.

import React from 'react';
import Box from '@mui/material/Box';

interface AuthLogoProps {
  height?: number;
}

// AUTH-V2 (2026-07-19): auth surfaces are always dark (AuthWrapper1 token
// override) — always render the white logo here regardless of app scheme.
// The scheme-aware behavior below is intentionally removed for auth; if this
// component is ever reused outside auth, reintroduce a `forceDark` prop
// instead of reviving the hook.
export const AuthLogo: React.FC<AuthLogoProps> = ({ height = 28 }) => {
  return (
    <Box
      component="img"
      src="/logo-dark.png"
      alt="LaSyncro"
      sx={{ height, width: 'auto' }}
    />
  );
};