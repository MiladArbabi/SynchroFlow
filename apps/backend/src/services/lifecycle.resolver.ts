// apps/backend/src/services/lifecycle.resolver.ts

import { UserLifecyclePhase } from './lifecycle.service';

export function resolveLifecyclePhase(input: {
  hasShop: boolean;
  hasIntegration: boolean;
  ft0Completed: boolean;
  ft1Complete: boolean;
  hasPaidEntitlements: boolean;
}): UserLifecyclePhase {
  const {
    hasShop,
    hasIntegration,
    ft0Completed,
    ft1Complete,
    hasPaidEntitlements,
  } = input;

  // FT-1: no shop or no integration
  if (!hasShop || !hasIntegration) {
    return 'FT_MINUS_ONE';
  }

  // FT0: integration exists but FT0 or FT1 not complete
  if (!ft0Completed || !ft1Complete) {
    return 'FT0';
  }

  // FT2: FT1 complete + paid
  if (hasPaidEntitlements) {
    return 'FT2';
  }

  // FT1: FT1 complete, unpaid
  return 'FT1';
}