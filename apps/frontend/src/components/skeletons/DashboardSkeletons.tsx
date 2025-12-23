// apps/frontend/src/components/skeletons/DashboardSkeletons.tsx
import React from 'react';
import { Box, Skeleton } from '@mui/material';

export const DashboardSkeletons: React.FC = () => {
  return (
    <Box sx={{ p: 3 }}>
      {/* Top summary row */}
      <Skeleton
        variant="rectangular"
        height={120}
        sx={{ borderRadius: 2, mb: 2 }}
      />

      {/* Secondary widgets */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
        <Skeleton variant="rectangular" height={180} sx={{ borderRadius: 2 }} />
        <Skeleton variant="rectangular" height={180} sx={{ borderRadius: 2 }} />
      </Box>

      {/* Main chart / table */}
      <Skeleton
        variant="rectangular"
        height={320}
        sx={{ borderRadius: 2 }}
      />
    </Box>
  );
};
