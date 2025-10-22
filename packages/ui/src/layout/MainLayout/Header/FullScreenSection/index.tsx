//packages/ui/src/layout/MainLayout/Header/FullScreenSection/index.tsx
import React from 'react';
import { Box, Typography } from '@mui/material';

const FullScreenSection: React.FC = () => {
  return (
    <Box sx={{ p: 1, border: '1px dashed grey', borderRadius: 1 }}>
      <Typography variant="caption" color="textSecondary">FullScreenSection</Typography>
    </Box>
  );
};

export default FullScreenSection;