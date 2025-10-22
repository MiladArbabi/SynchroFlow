//packages/ui/src/layout/MainLayout/Header/MobileSection/index.tsx
import React from 'react';
import { Box, Typography } from '@mui/material';

const MobileSection: React.FC = () => {
  return (
    <Box sx={{ p: 1, border: '1px dashed grey', borderRadius: 1 }}>
      <Typography variant="caption" color="textSecondary">MobileSection</Typography>
    </Box>
  );
};

export default MobileSection;