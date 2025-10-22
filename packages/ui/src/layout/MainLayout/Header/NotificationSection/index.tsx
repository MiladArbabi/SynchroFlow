//packages/ui/src/layout/MainLayout/Header/NotificationSection/index.tsx
import React from 'react';
import { Box, Typography } from '@mui/material';

const NotificationSection: React.FC = () => {
  return (
    <Box sx={{ p: 1, border: '1px dashed grey', borderRadius: 1 }}>
      <Typography variant="caption" color="textSecondary">NotificationSection</Typography>
    </Box>
  );
};

export default NotificationSection;