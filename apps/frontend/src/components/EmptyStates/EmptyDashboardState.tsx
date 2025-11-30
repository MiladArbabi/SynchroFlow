/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/components/EmptyStates/EmptyDashboardState.tsx
import React from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import { ConnectStoreBanner } from '../ConnectStoreBanner';

interface EmptyDashboardStateProps {
  onConnectStore: () => void;
  userState?: {
    shopify_connected: boolean;
    first_insight_delivered: boolean;
  };
}

export const EmptyDashboardState: React.FC<EmptyDashboardStateProps> = ({ 
  onConnectStore, 
  userState 
}) => {
  if (!userState?.shopify_connected) {
    return (
      <Box sx={{ p: 3 }}>
        <ConnectStoreBanner onOpenModal={onConnectStore} />
        <Paper 
          sx={{ 
            p: 4, 
            mt: 2, 
            textAlign: 'center',
            backgroundColor: 'background.default'
          }}
        >
          <Typography variant="h5" gutterBottom color="text.secondary">
            Welcome to SynchroFlow!
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            Connect your Shopify store to unlock powerful insights about your business.
          </Typography>
        </Paper>
      </Box>
    );
  }

  if (!userState?.first_insight_delivered) {
    return (
      <Paper 
        sx={{ 
          p: 4, 
          m: 3, 
          textAlign: 'center',
          backgroundColor: 'background.default'
        }}
      >
        <Typography variant="h5" gutterBottom color="text.secondary">
          Analyzing Your Data
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          We're crunching the numbers to deliver your first insight. This usually takes just a few minutes.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper 
      sx={{ 
        p: 4, 
        m: 3, 
        textAlign: 'center',
        backgroundColor: 'background.default'
      }}
    >
      <Typography variant="h5" gutterBottom color="text.secondary">
        Dashboard Loading
      </Typography>
      <Typography variant="body1" color="text.secondary">
        Preparing your personalized dashboard...
      </Typography>
    </Paper>
  );
};