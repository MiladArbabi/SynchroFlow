//apps/frontend/src/lifecycle/ShopLifecycleContext.ts
import React from 'react';
import { UILifecyclePhase } from './types';

export interface ShopLifecycleContextValue {
  phase: UILifecyclePhase;
}

export const ShopLifecycleContext =
  React.createContext<ShopLifecycleContextValue | null>(null);

export function useShopLifecycle(): ShopLifecycleContextValue {
  const ctx = React.useContext(ShopLifecycleContext);

  if (!ctx) {
    throw new Error(
      'useShopLifecycle must be used inside ShopLifecycleShell'
    );
  }

  if (import.meta.env.DEV && !ctx.phase) {
    throw new Error(
      '[Lifecycle Violation] ShopLifecycleContext resolved without a phase'
    );
  }

  console.log('[useShopLifecycle] hook called');

  if (import.meta.env.DEV) {
    console.log('[UI_LIFECYCLE_RENDER]', {
      phase: ctx.phase,
      ts: performance.now(),
    });
  }

  return ctx;
}
