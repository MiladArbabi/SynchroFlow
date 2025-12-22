// apps/frontend/src/components/DataSyncingModal.tsx

/**
 * DataSyncingModal — FT-0 Emotional Buffer
 * --------------------------------------
 *
 * PURPOSE:
 * - Short-lived UX buffer during FT-0 SYNCING
 * - Smooths emotional transition after store connection
 * - Does NOT represent backend truth
 *
 * HARD BOUNDARY:
 * - FT-0 only
 * - ft0Phase === 'SYNCING' only
 * - MUST NEVER render once syncStatus === 'COMPLETED'
 */

import React, { useEffect, useMemo, useState } from 'react';
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
  LinearProgress,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import Check from '@mui/icons-material/Check';

import { useIntegration } from 'contexts/IntegrationContext';
import { Ft0Phase } from 'types/onboarding';

// -----------------------------------------------------------------------------
// Emotional steps (NON-TECHNICAL)
// -----------------------------------------------------------------------------

const steps = ['Preparing data', 'Finalizing setup', 'Almost there'];

// -----------------------------------------------------------------------------
// Step icon styling
// -----------------------------------------------------------------------------

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
    boxShadow: '0 4px 10px 0 rgba(0,0,0,.25)',
  }),
  ...(ownerState.completed && {
    backgroundColor: theme.palette.success.main,
  }),
}));

function StepIcon(props: StepIconProps) {
  const { active, completed, className, icon } = props;

  return (
    <StepIconRoot ownerState={{ completed, active }} className={className}>
      {completed ? (
        <Check />
      ) : active ? (
        <CircularProgress size={24} sx={{ color: 'white' }} />
      ) : (
        <Typography sx={{ color: 'white', fontWeight: 'bold' }}>
          {String(icon)}
        </Typography>
      )}
    </StepIconRoot>
  );
}

// -----------------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------------

interface DataSyncingModalProps {
  open: boolean;
  ft0Phase: Ft0Phase;

  /** Required by parent, intentionally unused */
  onClose: () => void;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const DataSyncingModal: React.FC<DataSyncingModalProps> = ({
  open,
  ft0Phase,
  onClose,
}) => {
  
  const { syncStatus } = useIntegration();
  
  // Hooks MUST come before guards
  const [displayPercent, setDisplayPercent] = useState<number>(0);
  
  const isAllowedToRender = ft0Phase === 'SYNCING';
  
  const activeStep = useMemo(() => {
    if (displayPercent < 34) return 0;
    if (displayPercent < 67) return 1;
    return 2;
  }, [displayPercent]);

  useEffect(() => {
    if (open && ft0Phase !== 'SYNCING') {
      onClose();
    }
  }, [open, ft0Phase, onClose]);

  useEffect(() => {
    if (!open || !isAllowedToRender) {
      setDisplayPercent(0);
      return;
    }

    const START_AT = 1;
    const TARGET = 99;
    const DURATION_MS = 2800;
    const TICK_MS = 50;

    const ticks = Math.floor(DURATION_MS / TICK_MS);
    const delta = (TARGET - START_AT) / ticks;

    let current = START_AT;
    setDisplayPercent(START_AT);

    const timer = window.setInterval(() => {
      current += delta;

      if (current >= TARGET) {
        console.debug('[DSM.progress.done]', { syncStatus });
        current = TARGET;
        window.clearInterval(timer);
      }

      setDisplayPercent(Math.round(current));
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, [open, isAllowedToRender, syncStatus]);

  if (!open || !isAllowedToRender) {
    return null;
  }

  if (import.meta.env.MODE !== 'production') {
    console.debug('[DataSyncingModal.guard]', {
      open,
      ft0Phase,
      syncStatus,
      allowed: isAllowedToRender,
    });
  }

    console.debug('[DSM.render]', {
      open,
      ft0Phase,
      syncStatus,
      isAllowedToRender,
    });

  return (
    <Dialog open={open} disableEscapeKeyDown fullWidth maxWidth="sm">
      <DialogTitle sx={{ textAlign: 'center', mt: 2, typography: 'h4' }}>
        Connection Successful!
      </DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: 4 }}>
        <Typography variant="body1" align="center" sx={{ mb: 4 }}>
          We're preparing your dashboard. This will only take a moment.
        </Typography>

        <Box sx={{ width: '100%' }}>
          <Stepper activeStep={activeStep} alternativeLabel>
            {steps.map(label => (
              <Step key={label}>
                <StepLabel StepIconComponent={StepIcon}>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>

        <Box sx={{ width: '100%', mt: 4 }}>
          <LinearProgress variant="determinate" value={displayPercent} />
          <Typography variant="body2" align="center" sx={{ mt: 1 }}>
            {displayPercent}%
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  );
};
