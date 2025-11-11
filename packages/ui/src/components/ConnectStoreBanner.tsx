// packages/ui/src/components/ConnectStoreBanner.tsx - ADD THIS
import React from 'react';
import { Alert, AlertTitle, Button, Box } from '@mui/material';

interface ConnectStoreBannerProps {
  onOpenModal: () => void;
}

export const ConnectStoreBanner: React.FC<ConnectStoreBannerProps> = ({ onOpenModal }) => {
  return (
    <Box sx={{ width: '100%', p: 2, position: 'relative', zIndex: 1250 }} data-testid="connect-store-banner">
      <Alert
        severity="info"
        action={
          <Button 
            color="primary" 
            variant="contained" 
            size="small" 
            onClick={onOpenModal}
            data-testid="connect-store-button"
          >
            Connect Store
          </Button>
        }
        sx={{
          '.MuiAlert-message': {
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }
        }}
      >
        <AlertTitle>Welcome to SynchroFlow!</AlertTitle>
        Connect your data source to get started.
      </Alert>
    </Box>
  );
};