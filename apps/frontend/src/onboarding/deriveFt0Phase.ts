// apps/frontend/src/onboarding/deriveFt0Phase.ts
import { Ft0Phase } from 'types/onboarding';

export interface DeriveFt0PhaseInput {
  hasIntegrations: boolean;
  isConnectModalOpen: boolean;
  isSyncModalOpen: boolean;
  syncStatus: string;
  showPostSyncSkeleton: boolean;
}

export function deriveFt0Phase({
  hasIntegrations,
  isConnectModalOpen,
  isSyncModalOpen,
  syncStatus,
  showPostSyncSkeleton,
}: DeriveFt0PhaseInput): Ft0Phase {
  // PRE-CONNECT
  if (!hasIntegrations && !isConnectModalOpen && !isSyncModalOpen) {
    return 'PRE_CONNECT';
  }

  // CONNECTING
  if (isConnectModalOpen) {
    return 'CONNECTING';
  }

  // SYNCING — explicit modal
  if (isSyncModalOpen) {
    return 'SYNCING';
  }

  // SYNCING — background
  if (hasIntegrations && syncStatus !== 'COMPLETED') {
    return 'SYNCING';
  }

  // POST-SYNC SKELETON
  if (showPostSyncSkeleton) {
    return 'POST_SYNC_SKELETON';
  }

  // STEADY STATE
  return 'STEADY_STATE';
}