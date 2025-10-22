//packages/ui/src/layout/Customization/SidebarDrawer.tsx
import React from 'react';
import { Box, Typography } from '@mui/material';

const SidebarDrawer: React.FC = () => {
  return (
    <Box sx={{ p: 1, my: 1, border: '1px dashed grey', borderRadius: 1 }}>
      <Typography variant="caption" color="textSecondary">
        FontFamily Options (Placeholder)
      </Typography>
      {/* Add basic structure if needed for layout testing */}
    </Box>
  );
};

export default SidebarDrawer;