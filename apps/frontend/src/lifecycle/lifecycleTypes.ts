//apps/frontend/src/lifecycle/lifecycleTypes.ts

import { UILifecyclePhase } from './types';

export type LifecycleState = {
  phase: UILifecyclePhase;
  bootResolved: boolean;
  integrationExists: boolean;

  hasSeenFT0: boolean;
  hasLatchedFT1: boolean;
  hasLatchedFT2: boolean;
  ft0DwellCompleted: boolean;
};

export const initialLifecycleState: LifecycleState = {
  phase: 'FT_MINUS_ONE',
  bootResolved: false,
  integrationExists: false,

  hasSeenFT0: false,
  hasLatchedFT1: false,
  hasLatchedFT2: false,
  ft0DwellCompleted: false,
};

export type LifecycleEvent =
  | { type: 'BOOT_RESOLVED' }
  | { type: 'BOOT_UNRESOLVED' }
  | { type: 'INTEGRATION_CREATED' }
  | { type: 'INTEGRATION_DELETED' }
  | { type: 'FT0_DWELL_ELAPSED' }
  | { type: 'FT1_BACKEND_COMPLETE' }
  | { type: 'FT2_BACKEND_COMPLETE' };
