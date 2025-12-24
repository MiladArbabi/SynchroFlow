// apps/frontend/src/components/EmptyStates/EmptyDashboardState.tsx

import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { ConnectStoreBanner } from '../ConnectStoreBanner';

interface EmptyDashboardStateProps {
  onConnectStore: () => void;
}

export const EmptyDashboardState: React.FC<EmptyDashboardStateProps> = ({
  onConnectStore,
}) => {
  return (
    <Box sx={{ p: 3 }}>
      <ConnectStoreBanner onOpenModal={onConnectStore} />
      <Paper
        sx={{
          p: 4,
          mt: 2,
          textAlign: 'center',
          backgroundColor: 'background.default',
        }}
      >
        <Typography variant="h5" gutterBottom color="text.secondary">
          Preparing your dashboard
        </Typography>
        <Typography variant="body1" color="text.secondary">
          We’re syncing and analyzing your data. This will only take a moment.
        </Typography>
      </Paper>
    </Box>
  );
};
