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

  // Local display progress (purely visual – decoupled from backend speed).
  // Backend sync is effectively instant in FT0, so we simulate a smooth ramp
  // so the user *feels* like data is being prepared.
  const [displayPercent, setDisplayPercent] = React.useState(0);

  // Drive the stepper from the *visual* progress instead of raw syncStatus.
  // Backend goes to COMPLETED almost instantly in FT0, so if we tie the steps
  // to syncStatus we skip straight to the last step and lose the "journey".
  const activeStep = React.useMemo(() => {
    if (displayPercent < 34) {
      return 0; // "Products"
    }
    if (displayPercent < 67) {
      return 1; // "Customers"
    }
    return 2;   // "Completed"
  }, [displayPercent]);

    // Smoothly animate 1% -> 99% over ~2.8s whenever the modal opens.
  // We deliberately ignore how fast the backend completes; this is a UX affordance,
  // not a literal progress bar.
  useEffect(() => {
    /* console.log('[DataSyncingModal] open changed', {
      open,
      syncStatus,
      backendProgress: progress?.percentage,
    }); */

    if (!open) {
      setDisplayPercent(0);
      return;
    }

    const START_AT = 1;
    const TARGET = 99;
    const DURATION_MS = 2800;
    const TICK_MS = 50;

    const steps = Math.floor(DURATION_MS / TICK_MS);
    const delta = (TARGET - START_AT) / steps;

    let current = START_AT;
    setDisplayPercent(START_AT);

    const timer = window.setInterval(() => {
      current += delta;

      if (current >= TARGET) {
        current = TARGET;
        window.clearInterval(timer);
      }

      setDisplayPercent(Math.round(current));
    }, TICK_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [open, syncStatus, progress?.percentage]);

  // Use purely visual progress for FT0 onboarding.
  // Backend is effectively instant; showing 100% immediately ruins the UX.
  const effectivePercent = displayPercent;

  return (
    <Dialog
      open={open}
      disableEscapeKeyDown
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle
        component="div"
        sx={{
          textAlign: 'center',
          mt: 2,
          typography: 'h4',
        }}
      >
        Connection Successful!
      </DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: 4 }}
      >
        <Typography variant="body1" align="center" sx={{ mb: 4 }}>
          We're syncing your data from Shopify. This may take a few moments.
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

        <Box sx={{ width: '100%', mt: 4 }}>
          <LinearProgress
            variant="determinate"
            value={effectivePercent}
            data-testid="linear-progress"
          />
          <Typography variant="body2" align="center" sx={{ mt: 1 }}>
            {effectivePercent}%
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  );
};
