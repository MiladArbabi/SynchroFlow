/**
 * 🚫 INTERNAL MODULE — DO NOT IMPORT DIRECTLY
 *
 * This context is an implementation detail of the Integration system.
 *
 * Public access MUST go through:
 *   - useIntegration()
 *
 * Violating this boundary WILL cause lifecycle bugs.
 */

/**
 * IntegrationContext is a low-level structural context.
 *
 * ⚠️ DO NOT use this for UI decisions.
 * ⚠️ DO NOT derive lifecycle phases here.
 *
 * ShopLifecycleContext becomes authoritative after FT1.
 */

// apps/frontend/src/contexts/integration/_internal/IntegrationContext.tsx

import { createContext } from 'react';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type IntegrationBootState = 'BOOTING' | 'READY';
export type IntegrationExistence = 'NONE' | 'EXISTS';
export type IntegrationSyncState =
  | 'IDLE'
  | 'PENDING'
  | 'SYNCING'
  | 'COMPLETED'
  | 'FAILED';

export interface IntegrationContextValue {
  bootState: IntegrationBootState;
  existence: IntegrationExistence | null;
  syncState: IntegrationSyncState | null;

  hasIntegration: boolean;
  isSyncComplete: boolean;

  refresh: () => void;
}

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

export const IntegrationContext =
  createContext<IntegrationContextValue | undefined>(undefined);
