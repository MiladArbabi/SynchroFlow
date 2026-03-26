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

  /**
   * Extended lifecycle payload (v2)
   * ------------------------------
   * Adds subphase + progress for FT0.
   *
   * Backwards compatible:
   * - phase remains primary key
   */
  export type LifecycleStateDTO = {
    phase: LifecyclePhase;

    /**
     * Only present when phase === 'FT0'
     */
    subphase?: 'SYNCING' | 'PREPARING';

    /**
     * Optional progress signal (future-safe)
     */
    progress?: {
      current: number;
      total: number;
      message?: string;
    };
  };

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