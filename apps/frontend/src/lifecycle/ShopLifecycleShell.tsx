// apps/frontend/src/lifecycle/ShopLifecycleShell.tsx

import React from 'react';
import { useIntegrationSyncStatus } from 'contexts/IntegrationContext';
import { ShopLifecycleContext } from './ShopLifecycleContext';

export type ShopLifecyclePhase =
  | 'FT_MINUS_ONE'
  | 'FT0_SYNCING'
  | 'FT0_PREPARING'
  | 'FT1_READY'; // reserved, not entered yet

interface ShopLifecycleShellProps {
  children: React.ReactNode;
}

export function ShopLifecycleShell({ children }: ShopLifecycleShellProps) {
  const { status, isLoading } = useIntegrationSyncStatus();

  if (isLoading) {
    return null;
  }

  let phase: ShopLifecyclePhase;

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
      phase = 'FT0_PREPARING';
      break;

    case 'FAILED':
    default:
      phase = 'FT_MINUS_ONE';
  }

  if (import.meta.env.DEV) {
    console.debug('[ShopLifecycleShell]', {
      integrationSyncStatus: status,
      resolvedPhase: phase,
    });
  }

  return (
    <ShopLifecycleContext.Provider value={{ phase }}>
      {children}
    </ShopLifecycleContext.Provider>
  );
}
