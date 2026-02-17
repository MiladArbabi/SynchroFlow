// modules/shared/src/ui/ModuleActivationBoundary.tsx

import React from 'react';
import { ActivationUIState } from './activation/activation-mapper.js';
import { ActivationSurfaceProps } from './activation/types.js';

export interface ModuleActivationBoundaryProps {
  activation: ActivationUIState;
  children: React.ReactNode;

  /** Frontend-owned renderer for blocked state */
  renderBlocked?: (surface: ActivationSurfaceProps) => React.ReactNode;
}

export const ModuleActivationBoundary: React.FC<
  ModuleActivationBoundaryProps
> = ({ activation, children, renderBlocked }) => {
  if (activation.state === 'BLOCKED') {
    return renderBlocked ? renderBlocked(activation.surface) : null;
  }

  return <>{children}</>;
};
