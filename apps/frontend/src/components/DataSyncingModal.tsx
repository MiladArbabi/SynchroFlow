/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/components/DataSyncingModal.tsx
import React, { useEffect, useMemo } from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
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
  CircularProgress,
  LinearProgress
} from '@mui/material';
import { styled } from '@mui/material/styles';
import Check from '@mui/icons-material/Check';
import { useIntegration } from 'contexts/IntegrationContext';

// Define the steps
const steps = ['Products', 'Customers', 'Completed'];

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
  const { syncStatus, progress } = useIntegration();

  // Map the real API status to the stepper's activeStep
  const activeStep = React.useMemo(() => {
    switch (syncStatus) {
      case 'SYNCING_PRODUCTS':
        return 0;
      case 'SYNCING_CUSTOMERS':
        return 1;
      case 'COMPLETED':
        return 2;
      default:
        return 0;
    }
  }, [syncStatus]);

  useEffect(() => {
    if (syncStatus === 'COMPLETED') {
      // Wait 1.5s to let the user see the "Completed" checkmark
      const timer = setTimeout(() => {
        onClose();
      }, 1500);
      return () => clearTimeout(timer);
     }
  }, [syncStatus, onClose]);

  return (
    // We disable backdrop click and escape key to make it a celebratory "moment"
    <Dialog open={open} disableEscapeKeyDown={true} fullWidth maxWidth="sm">
      {/* FIXED: Remove Typography wrapper to avoid hydration error */}
      <DialogTitle 
        component="div" 
        sx={{ 
          textAlign: 'center', 
          mt: 2,
          typography: 'h4' // Apply h4 styling without nesting headings
        }}
      >
        Connection Successful!
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: 4 }}>
        <Typography variant="body1" align="center" sx={{ mb: 4 }}>
          We're syncing your data from Shopify. This may take a few minutes.
        </Typography>

        <Box sx={{ width: '100%' }}>
          <Stepper activeStep={activeStep} alternativeLabel data-testid="stepper">
            {steps.map((label) => (
              <Step key={label}>
                <StepLabel StepIconComponent={StepIcon}>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>
        {/* Add the real progress bar */}
        <Box sx={{ width: '100%', mt: 4 }}>
          <LinearProgress variant="determinate" value={progress.percentage} data-testid="linear-progress"/>
          <Typography variant="body2" align="center" sx={{ mt: 1 }}>
            {progress.percentage}%
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  );
};