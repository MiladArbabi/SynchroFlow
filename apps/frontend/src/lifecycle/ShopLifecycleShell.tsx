// apps/frontend/src/lifecycle/ShopLifecycleShell.tsx

import React from 'react';
import { useIntegrationSyncStatus } from 'contexts/IntegrationContext';
import { ShopLifecycleContext } from './ShopLifecycleContext';
import { useOnboardingReadiness } from './useOnboardingReadiness';
import { ShopLifecyclePhase } from './types';
import { useAuth } from 'contexts/AuthContext'; // ← or correct source of shopId

export function ShopLifecycleShell({ children }: { children: React.ReactNode }) {
  const { status, isLoading } = useIntegrationSyncStatus();
  const { user } = useAuth();

  const shopId = user?.shop_id ?? null;
  const syncCompleted = status === 'COMPLETED';

  const { data: readiness } = useOnboardingReadiness(
    syncCompleted,
    shopId
  );

  let phase: ShopLifecyclePhase;

  if (isLoading || !shopId) {
    phase = 'FT_MINUS_ONE';
  } else {
    switch (status) {
      case 'NOT_FOUND':
        phase = 'FT_MINUS_ONE';
        break;

      case 'PENDING':
      case 'SYNCING_PRODUCTS':
      case 'SYNCING_ORDERS':
      case 'SYNCING_LINE_ITEMS':
      case 'SYNCING_INVENTORY':
      case 'SYNCING_SHOP':
      case 'COMPLETING':
        phase = 'FT0_SYNCING';
        break;

      case 'COMPLETED':
        phase =
          readiness?.ft1?.isComplete === true
            ? 'FT1_READY'
            : 'FT0_PREPARING';
        break;

      default:
        phase = 'FT_MINUS_ONE';
    }
  }

  if (import.meta.env.DEV) {
    console.info('[ShopLifecycle]', {
      shopId,
      integrationStatus: status,
      readiness: readiness?.ft1,
      resolvedPhase: phase,
    });
  }

  return (
    <ShopLifecycleContext.Provider value={{ phase }}>
      {children}
    </ShopLifecycleContext.Provider>
  );
}
