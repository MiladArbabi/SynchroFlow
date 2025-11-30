//apps/frontend/src/components/ConnectionErrorModal.tsx
import React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Box,
  Typography,
} from '@mui/material';
import IconComponent from './Icon';

interface ConnectionErrorModalProps {
  open: boolean;
  onClose: () => void; // "Skip for Now"
  onRetry: () => void; // "Try Again"
  error: string | null;
}

export const ConnectionErrorModal: React.FC<ConnectionErrorModalProps> = ({
  open,
  onClose,
  onRetry,
  error,
}) => {
  // A helper to open the help docs in a new tab
  const handleHelp = () => {
    window.open('/help/shopify-connection', '_blank');
  };

  return (
   <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth data-testid="connection-error-modal">
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {/* Use a theme-aware error icon */}
          <IconComponent name="AlarmClock" size="xl" color="error" />
          <Typography variant="h3">Connection Failed</Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          There was an issue connecting your store. Please check your credentials
          or store name and try again.
        </DialogContentText>
        {error && (
          <Typography
            color="error"
            variant="body2"
            sx={{ mt: 2, fontStyle: 'italic' }}
          >
            Details: {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 3, pt: 1, justifyContent: 'space-between' }}>
        {/* "Skip for Now" button */}
        <Button onClick={onClose} color="secondary">
          Skip for Now
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {/* "Get Help" button */}
          <Button onClick={handleHelp} variant="outlined" color="secondary">
            Get Help
          </Button>
          {/* "Try Again" button */}
          <Button onClick={onRetry} variant="contained" color="primary" data-testid="retry-button">
            Try Again
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};