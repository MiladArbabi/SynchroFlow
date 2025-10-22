//packages/ui/src/layout/MainLayout/Header/MegaMenuSection/index.tsx
import React from 'react';
import { Box, Typography } from '@mui/material';

const MegaMenuSection: React.FC = () => {
  return (
    <Box sx={{ p: 1, border: '1px dashed grey', borderRadius: 1 }}>
      <Typography variant="caption" color="textSecondary">MegaMenuSection</Typography>
    </Box>
  );
};

export default MegaMenuSection;