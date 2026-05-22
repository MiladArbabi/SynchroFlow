import React from 'react';
// material-ui
import Box from '@mui/material/Box';

// project imports
import MainCard, { MainCardProps } from 'ui-component/cards/MainCard'; // <-- Import MainCardProps and verify alias

// ==============================|| AUTHENTICATION CARD WRAPPER ||============================== //

// Define props interface
interface AuthCardWrapperProps extends Omit<MainCardProps, 'content'> { // Inherit MainCard props, excluding 'content'
  children: React.ReactNode;
}

export default function AuthCardWrapper({ children, ...other }: AuthCardWrapperProps) {
  return (
    <MainCard
      border
      boxShadow
      sx={{
        maxWidth: { xs: 400, lg: 475 },
        margin: { xs: 2.5, md: 3 },
        bgcolor: 'var(--surface)',
        // Override MainCard's default borderColor (theme.palette.divider) with our design token
        borderColor: 'var(--rule) !important',
        '& > *': {
          flexGrow: 1,
          flexBasis: '50%'
        }
      }}
      content={false}
      {...other}
    >
      <Box sx={{ p: { xs: 2, sm: 3, xl: 5 } }}>{children}</Box>
    </MainCard>
  );
};