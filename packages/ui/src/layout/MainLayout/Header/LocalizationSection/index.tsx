//packages/ui/src/layout/MainLayout/Header/LocalizationSection/index.tsx
import React from 'react';
import { Box, Typography } from '@mui/material';

const LocalizationSection: React.FC = () => {
  return (
    <Box sx={{ p: 1, border: '1px dashed grey', borderRadius: 1 }}>
      <Typography variant="caption" color="textSecondary">LocalizationSection</Typography>
    </Box>
  );
};

export default LocalizationSection;