import React from 'react';
import Box, { BoxProps } from '@mui/material/Box';

interface AuthCardWrapperProps extends Omit<BoxProps, 'children'> {
  children: React.ReactNode;
}

export default function AuthCardWrapper({ children, ...other }: AuthCardWrapperProps) {
  return (
    <Box
      {...other}
      sx={{
        width: '100%',
        maxWidth: 426,
        mx: 'auto',
        bgcolor: 'transparent',
        border: 0,
        boxShadow: 'none',
        p: 0
      }}
    >
      {children}
    </Box>
  );
}