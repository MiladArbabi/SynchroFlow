// packages/ui/src/components/DataSyncingModal.tsx
import React, { useEffect } from 'react';
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
const steps = ['Products', 'Orders', 'Finances', 'Completed'];

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
  onClose: (error?: string | null) => void;
}

export const DataSyncingModal: React.FC<DataSyncingModalProps> = ({ open, onClose }) => {
  const { syncStatus, progress, lastError } = useIntegration();
  const hasCalledOnCloseRef = React.useRef(false);

  // Map the real API status to the stepper's activeStep
  const activeStep = React.useMemo(() => {
    switch (syncStatus) {
      case 'SYNCING_PRODUCTS':
        return 0;
      case 'SYNCING_ORDERS':
        return 1;
      case 'SYNCING_FINANCES':
        return 2;
      case 'COMPLETED':
        return 3;
      case 'FAILED':
        return 0; // Show the error at the first step
      default:
        return 0; // Default to the first step
    }
  }, [syncStatus]);

  useEffect(() => {
    // Reset the ref when modal opens
    if (open) {
      hasCalledOnCloseRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (syncStatus === 'COMPLETED' && !hasCalledOnCloseRef.current) {
      hasCalledOnCloseRef.current = true;
      const timer = setTimeout(() => {
        onClose(null);
      }, 1500);
      return () => clearTimeout(timer);
    } else if (syncStatus === 'FAILED' && !hasCalledOnCloseRef.current) {
      hasCalledOnCloseRef.current = true;
      onClose(lastError || 'An unknown sync error occurred.');
    }
  }, [syncStatus, lastError, onClose]);

  useEffect(() => {
    if (syncStatus === 'COMPLETED') {
      // Wait 1.5s to let the user see the "Completed" checkmark
      const timer = setTimeout(() => {
        onClose(null);
      }, 1500);
      return () => clearTimeout(timer);
     } else if (syncStatus === 'FAILED') {
       // 4. On fail, close immediately and pass the error
       onClose(lastError || 'An unknown sync error occurred.');
     }
  }, [syncStatus, lastError, onClose]);

  return (
    // We disable backdrop click and escape key to make it a celebratory "moment"
    <Dialog open={open} disableEscapeKeyDown={true} fullWidth maxWidth="sm">
      <DialogTitle
          variant="h3" 
          align="center" 
          gutterBottom 
          sx={{ mt: 2 }}>
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