// packages/ui/src/components/DataSyncingModal.tsx
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  Stepper,
  Step,
  StepLabel,
  StepIconProps,
  CircularProgress
} from '@mui/material';
import { styled } from '@mui/material/styles';
import Check from '@mui/icons-material/Check';

// Define the steps
const steps = ['Authenticating', 'Fetching Products', 'Fetching Orders', 'Finalizing'];

// Custom Step Icon styling
const StepIconRoot = styled('div')<{
  ownerState: { completed?: boolean; active?: boolean };
}>(({ theme, ownerState }) => ({
  backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[700] : '#ccc',
  zIndex: 1,
  color: '#fff',
  width: 40,
  height: 40,
  display: 'flex',
  borderRadius: '50%',
  justifyContent: 'center',
  alignItems: 'center',
  ...(ownerState.active && {
    backgroundColor: theme.palette.primary.main,
    boxShadow: '0 4px 10px 0 rgba(0,0,0,.25)'
  }),
  ...(ownerState.completed && {
    backgroundColor: theme.palette.success.main
  })
}));

// Custom Icon component
function StepIcon(props: StepIconProps) {
  const { active, completed, className, icon } = props;

  return (
    <StepIconRoot ownerState={{ completed, active }} className={className}>
      {completed ? (
        <Check />
      ) : active ? (
        <CircularProgress size={24} sx={{ color: 'white' }} />
      ) : (
        <Typography sx={{ color: 'white', fontWeight: 'bold' }}>{String(icon)}</Typography>
      )}
    </StepIconRoot>
  );
}

interface DataSyncingModalProps {
  open: boolean;
  onClose: () => void;
}

export const DataSyncingModal: React.FC<DataSyncingModalProps> = ({ open, onClose }) => {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    if (open) {
      // Reset step on open
      setActiveStep(0);

      // Simulate the sync progress
      const timers: number[] = [];
      steps.forEach((_, index) => {
        const timer = setTimeout(() => {
          setActiveStep(index + 1);
        }, (index + 1) * 2000); // 2 seconds per step
        timers.push(timer);
      });

      // After all steps, auto-close the modal
      const closeTimer = setTimeout(() => {
        onClose();
      }, (steps.length + 1) * 2000);
      timers.push(closeTimer);

      return () => {
        timers.forEach(clearTimeout);
      };
    }
  }, [open, onClose]);

  return (
    // We disable backdrop click and escape key to make it a celebratory "moment"
    <Dialog open={open} disableEscapeKeyDown={true} fullWidth maxWidth="sm">
      <DialogTitle>
        <Typography variant="h3" align="center" gutterBottom sx={{ mt: 2 }}>
          Connection Successful!
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: 4 }}>
        <Typography variant="body1" align="center" sx={{ mb: 4 }}>
          We're syncing your data from Shopify. This may take a few minutes.
        </Typography>
        <Box sx={{ width: '100%' }}>
          <Stepper activeStep={activeStep} alternativeLabel>
            {steps.map((label) => (
              <Step key={label}>
                <StepLabel StepIconComponent={StepIcon}>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>
      </DialogContent>
    </Dialog>
  );
};