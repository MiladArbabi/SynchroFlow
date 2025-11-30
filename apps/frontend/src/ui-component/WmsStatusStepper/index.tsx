// apps/frontend/src/ui-component/WmsStatusStepper/index.tsx
import React from 'react';
import { Stepper, Step, StepLabel } from '@mui/material';

// Define the standard order flow
const STEPS = ['Pending', 'Picking', 'Packed', 'Shipped'];

// Define a type for the status prop
export type OrderStatus = 'Pending' | 'Picking' | 'Packed' | 'Shipped';

interface WmsStatusStepperProps {
  currentStatus: OrderStatus;
}

/**
 * A visual stepper component to show the current fulfillment
 * status of an order.
 */
const WmsStatusStepper: React.FC<WmsStatusStepperProps> = ({ currentStatus }) => {
  // Find the index of the current status
  const activeStep = STEPS.indexOf(currentStatus);

  return (
    <Stepper activeStep={activeStep} alternativeLabel>
      {STEPS.map((label) => (
        <Step key={label}>
          <StepLabel>{label}</StepLabel>
        </Step>
      ))}
    </Stepper>
  );
};

export default WmsStatusStepper;