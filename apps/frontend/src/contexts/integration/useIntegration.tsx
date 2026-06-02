// apps/frontend/src/contexts/integration/useIntegration.tsx
//
// Canonical public Integration API
// --------------------------------
//
// Consumers MUST use this hook instead of IntegrationContext directly.
//
// This hook intentionally:
// - hides transient backend states
// - hides auth churn
// - removes nullable fields
// - exposes only stable, semantic integration facts
//

import { useContext } from 'react';
import {
  IntegrationContext,
  IntegrationExistence,
  IntegrationSyncState,
} from './_internal/IntegrationContext';

/* -------------------------------------------------------------------------- */
/* Public return type                                                          */
/* -------------------------------------------------------------------------- */

export interface UseIntegrationResult {
  bootResolved: boolean;
  isResolved: boolean;
  existence: IntegrationExistence;
  syncStatus: IntegrationSyncState;
  hasIntegration: boolean;
  isSyncComplete: boolean;
  integrationId: number | null;
  refresh: () => void;
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                        */
/* -------------------------------------------------------------------------- */

export function useIntegration(): UseIntegrationResult {
  const ctx = useContext(IntegrationContext);

  if (!ctx) {
    throw new Error(
      'useIntegration must be used within IntegrationProvider'
    );
  }

  const existence: IntegrationExistence =
    ctx.existence ?? 'NONE';

  const syncStatus: IntegrationSyncState =
    ctx.syncState ?? 'IDLE';

  return {
    bootResolved: ctx.bootState === 'READY',
    isResolved: ctx.bootState === 'READY',
    existence,
    syncStatus,
    hasIntegration: existence === 'EXISTS',
    isSyncComplete: syncStatus === 'COMPLETED',
    integrationId: ctx.integrationId ?? null,
    refresh: ctx.refresh,
  };
}
