// modules/shared/src/ui/ModuleActivationBoundary.tsx
import React from 'react';
import {
  ActivationSurface,
  ActivationSurfaceProps
} from './activation/ActivationSurface';

export interface ModuleActivationBoundaryProps {
  /**
   * Whether the module is active (FT-1 resolved by host)
   */
  active: boolean;

  /**
   * ActivationSurface configuration (required when inactive)
   */
  config: ActivationSurfaceProps;

  /**
   * The actual module UI
   */
  children: React.ReactNode;
}

/**
 * ModuleActivationBoundary
 *
 * HARD GUARANTEES:
 * - If active === false → ONLY ActivationSurface renders
 * - If active === true  → ONLY module children render
 * - Never both
 * - No side effects
 */
export const ModuleActivationBoundary: React.FC<
  ModuleActivationBoundaryProps
> = ({ active, config, children }) => {
  if (!active) {
    return <ActivationSurface {...config} />;
  }

  return <>{children}</>;
};