// modules/shared/src/activation/types.ts
// INTERNAL activation domain types (no dependency on contracts)

/**
 * ⚠️ Activation-only FT0 phase
 * Describes integration technical readiness.
 * NOT a user lifecycle phase.
 */


export type EntryChannel = 'SHOPIFY_APP' | 'WEB';

export type SyncStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED';

export type IntegrationSnapshot = {
  platform: string;
  syncStatus: SyncStatus;
};

export type IdentitySnapshot = {
  userId: number | null;
  shopId: number | null;
  entryChannel: EntryChannel | null;
};

export type EntitlementSnapshot = {
  moduleKey: string;
  enabled: boolean;
};

export type FT0Phase = 'PRE_INTEGRATION' | 'SYNCING' | 'COMPLETED';

export interface ActivationSurfaceContext {
  moduleId?: string;
  quotaExceeded?: boolean;
  ux?: {
    hasSeenFT0Modal: boolean;
  };
}

export type ActivationVerdict =
  | {
      verdict: 'BLOCKED';
      reason: 'NOT_AUTHENTICATED' | 'NO_SHOP' | 'NO_INTEGRATION';
      explanation: string;
      retryable: boolean;
    }
  | {
      verdict: 'PENDING';
      reason: 'FT0_SYNCING' | 'ENTITLEMENT_PENDING';
      explanation: string;
      retryable: boolean;
    }
  | {
      verdict: 'ACTIVE';
      activatedModules: string[];
    };
