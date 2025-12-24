// apps/backend/src/services/lifecycle.contract.ts

/**
 * 🚨 SINGLE SOURCE OF TRUTH — LIFECYCLE CONTRACT
 *
 * No service, controller, or UI is allowed to redefine lifecycle phases.
 */
export type LifecyclePhase =
  | 'FT_MINUS_ONE'
  | 'FT0'
  | 'FT1'
  | 'FT2';

export const LIFECYCLE_PHASES: LifecyclePhase[] = [
  'FT_MINUS_ONE',
  'FT0',
  'FT1',
  'FT2',
];

export type LifecycleSnapshot = {
  phase: LifecyclePhase;
  updatedAt: string;
};