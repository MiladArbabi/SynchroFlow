// apps/frontend/src/components/ExitIntentModal.tsx
import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  IconButton,
  Box,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useExitIntent } from 'hooks/useExitIntent';

interface ExitIntentModalProps {
  onClose: () => void;
  onAccept: (offer: string) => void;
  offer: string;
}

export const ExitIntentModal: React.FC<ExitIntentModalProps> = ({
  onClose,
  onAccept,
  offer,
}) => {
  const { shouldShowOffer, resetExitIntent } = useExitIntent();

  const handleClose = () => {
    resetExitIntent();
    onClose();
  };

  const handleAccept = () => {
    resetExitIntent();
    onAccept(offer);
  };

  if (!shouldShowOffer) {
    return null;
  }

  return (
    <Dialog 
      open={true} 
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          boxShadow: 24,
        }
      }}
    >
      <DialogTitle sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        borderBottom: 1,
        borderColor: 'divider',
        pb: 2
      }}>
        <Typography variant="h5" component="div" fontWeight="bold">
          Don't Go Yet!
        </Typography>
        <IconButton
          aria-label="close"
          onClick={handleClose}
          sx={{
            color: (theme) => theme.palette.grey[500],
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <DialogContent sx={{ py: 3 }}>
        <Box textAlign="center">
          <Typography variant="h6" color="primary" gutterBottom>
            Special Offer Just For You!
          </Typography>
          <Typography variant="body1" color="text.secondary" paragraph>
            We see you're about to leave. How about a special offer to complete your purchase?
          </Typography>
          <Box
            sx={{
              backgroundColor: 'primary.light',
              color: 'primary.contrastText',
              py: 2,
              px: 3,
              borderRadius: 1,
              my: 2
            }}
          >
            <Typography variant="h4" fontWeight="bold">
              {offer}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            This offer is only available for a limited time!
          </Typography>
        </Box>
      </DialogContent>
      
      <DialogActions sx={{ 
        justifyContent: 'center', 
        gap: 2,
        borderTop: 1,
        borderColor: 'divider',
        pt: 2,
        pb: 3
      }}>
        <Button 
          onClick={handleClose} 
          variant="outlined" 
          color="secondary"
          size="large"
        >
          No, thanks
        </Button>
        <Button 
          onClick={handleAccept} 
          variant="contained" 
          color="primary"
          size="large"
          sx={{ px: 4 }}
        >
          Yes, claim my offer!
        </Button>
      </DialogActions>
    </Dialog>
  );
};