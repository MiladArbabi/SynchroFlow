//packages/ui/src/layout/MainLayout/Header/NotificationSection/NotificationList.tsx
import React from 'react';
import { Box, Typography } from '@mui/material';

const NotificationList: React.FC = () => {
  return (
    <Box sx={{ p: 1, border: '1px dashed grey', borderRadius: 1 }}>
      <Typography variant="caption" color="textSecondary">NotificationList</Typography>
    </Box>
  );
};

export default NotificationList;