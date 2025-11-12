//packages/ui/src/components/widgets/EnhancedWidgetShell.tsx
import React from 'react';
import { EnhancedWidgetShellProps } from './types';
import { Box, Typography } from '@mui/material';

export const EnhancedWidgetShell: React.FC<EnhancedWidgetShellProps> = (props) => {
  const { title, children } = props;

  return (
    <Box>
      {/* This 'h3' role is what our test is looking for */}
      <Typography variant="h3" component="h3">
        {title}
      </Typography>
      
      {/* Render the content */}
      <Box>
        {children}
      </Box>
    </Box>
  );
};