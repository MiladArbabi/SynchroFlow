// packages/ui/src/components/ConnectionErrorModal.tsx
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
  onClose: () => void; // "Skip for Now" or backdrop click
  onRetry: () => void; // "Try Again"
  error: string | null;
}

export const ConnectionErrorModal: React.FC<ConnectionErrorModalProps> = ({
  open,
  onClose,
  onRetry,
  error,
}) => {
  console.log('[ConnectionErrorModal] Rendering with:', { open, error });

  const handleSkip = () => {
    console.log('[ConnectionErrorModal] "Skip for Now" CLICKED - calling onClose');
    onClose();
  };

  const handleRetryClick = () => {
    console.log('[ConnectionErrorModal] "Try Again" CLICKED - calling onRetry');
    onRetry();
  };

  // A helper to open the help docs in a new tab
  const handleHelp = () => {
    // This will be wired up by issue #655
    window.open('/help/connection-errors', '_blank');
  };

  return (
    // We pass the onClose prop to the Dialog for backdrop/escape key closing
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="xs" 
      fullWidth
      data-testid="connection-error-modal"
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <IconComponent name="AlarmClockOff" size="xl" color="error" />
          <Typography variant="h3" component="span">Connection Failed</Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          There was an issue connecting your store. Please check your credentials
          or store name and try again.
        </DialogContentText>
        {error && (
          <Typography
            color="text.secondary" // More subtle than bright red
            variant="body2"
            sx={{ mt: 2, fontStyle: 'italic', wordBreak: 'break-word' }}
          >
            Details: {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 3, pt: 1, justifyContent: 'space-between' }}>
        {/* "Skip for Now" button */}
        <Button 
          onClick={handleSkip}
          variant="outlined" 
          color="info"
          data-testid="skip-button"
        >
          Skip for Now
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {/* "Get Help" button */}
          <Button 
            onClick={handleHelp} 
            variant="outlined" 
            color="info"
            data-testid="help-button"
          >
            Get Help
          </Button>
          {/* "Try Again" button */}
          <Button 
            onClick={handleRetryClick} 
            variant="contained" 
            color="primary"
            data-testid="retry-button"
          >
            Try Again
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};