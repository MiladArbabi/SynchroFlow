// apps/frontend/src/pages/authentication/AuthLogo.tsx
//
// Renders the correct logo for the active color scheme.
// logo-dark.png = white logo (dark backgrounds)
// logo.png      = dark logo  (light backgrounds)
//
// Drop-in replacement for all hardcoded logo-dark.png refs on auth pages.

import React from 'react';
import Box from '@mui/material/Box';
import { useColorScheme } from '@mui/material/styles';
import { ThemeMode } from 'config';

interface AuthLogoProps {
  height?: number;
}

export const AuthLogo: React.FC<AuthLogoProps> = ({ height = 28 }) => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === ThemeMode.DARK;
  return (
    <Box
      component="img"
      src={isDark ? '/logo-dark.png' : '/logo.png'}
      alt="LaSyncro"
      sx={{ height, width: 'auto' }}
    />
  );
};