import React from 'react';
import { ActivationUIState } from './activation/activation-mapper.js';
import { ActivationSurfaceProps } from './activation/types.js';
export interface ModuleActivationBoundaryProps {
    activation: ActivationUIState;
    children: React.ReactNode;
    /** Frontend-owned renderer for blocked state */
    renderBlocked?: (surface: ActivationSurfaceProps) => React.ReactNode;
}
export declare const ModuleActivationBoundary: React.FC<ModuleActivationBoundaryProps>;
//# sourceMappingURL=ModuleActivationBoundary.d.ts.map