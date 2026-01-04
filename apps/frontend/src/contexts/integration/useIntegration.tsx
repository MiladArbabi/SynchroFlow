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
  /**
   * True once the integration model has resolved at least once.
   * While false, consumers must assume NOTHING.
   */
  bootResolved: boolean;

  isResolved: boolean;

  /**
   * Structural existence of an integration.
   * - NONE    → no integration record exists
   * - EXISTS  → integration exists (regardless of sync progress)
   */
  existence: IntegrationExistence;

  /**
   * High-level sync status.
   * Collapsed, stable, and UI-safe.
   */
  syncStatus: IntegrationSyncState;

  /**
   * Convenience booleans (derived, non-authoritative).
   */
  hasIntegration: boolean;
  isSyncComplete: boolean;

  /**
   * Manual refresh escape hatch.
   */
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

    refresh: ctx.refresh,
  };
}
