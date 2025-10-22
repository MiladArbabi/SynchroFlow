//packages/ui/src/layout/Customization/BoxContainer.tsx
import React from 'react';
import { Box, Typography } from '@mui/material';

const BoxContainer: React.FC = () => {
  return (
    <Box sx={{ p: 1, my: 1, border: '1px dashed grey', borderRadius: 1 }}>
      <Typography variant="caption" color="textSecondary">
        FontFamily Options (Placeholder)
      </Typography>
      {/* Add basic structure if needed for layout testing */}
    </Box>
  );
};

export default BoxContainer;